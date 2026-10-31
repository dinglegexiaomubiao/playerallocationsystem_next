/**
 * 群友回忆（/memories）：一条回忆 = 一段文字 + 最多 9 张照片 + 若干评论。
 *
 * 三条必须记住的约定：
 *
 * 1. **照片只存相对路径，不存完整 URL**。jsonb 里存的是
 *    `{ p: 'memories/2026/10/xxx.jpg', w: 1600, h: 1200 }`，
 *    对外访问统一拼 `/api/media/<p>`。这样以后换存储（OSS / Nginx 直出）
 *    只改一个拼接函数，数据库里的历史数据不用动。
 *
 * 2. **作者名与作者 id 都冗余存**。作者名取玩家主昵称（players.nickname），
 *    不是登录账号名；同时存 author_id，删人之后老回忆还留得住名字，
 *    不会变成「未命名」或者整条消失。
 *
 * 3. **删除一律软删**（deleted_at + deleted_by）。照片文件不跟着删 ——
 *    誤删之后还能人工恢复；磁盘上多留几张图比丢回忆便宜得多。
 *    所有列表查询都必须带 `deleted_at IS NULL`，漏一个就等于删不掉。
 */

import { pool } from './db.js';
import { normalizeTags, isValidTag, TAG_LIMIT } from './memories-tags.mjs';
import { normalizeShotOn, normalizePlace, PLACE_LIMIT } from './memories-fields.mjs';
import { checkInput, moderationMessage } from './moderation.mjs';

/** 一条回忆最多几张图。九宫格是上限，再多就不适合在列表里扫了。 */
export const MAX_PHOTOS = 9;
/** 单张图解码后的字节上限（客户端会压到 1600px / q0.82，正常 200~400KB）。 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** 正文与评论的字数上限，和 lib/moderation.mjs 的 LIMITS 对齐。 */
export const TEXT_LIMIT = 800;
export const COMMENT_LIMIT = 300;

/** 允许的存储相对路径形状：memories/YYYY/MM/<uuid>.<ext> */
const PHOTO_PATH_RE = /^memories\/\d{4}\/\d{2}\/[a-z0-9-]{8,64}\.(jpg|png|webp)$/;

export const isPhotoPath = (p) => typeof p === 'string' && PHOTO_PATH_RE.test(p);

/** 照片对外要访问的 URL。唯一的拼接点，改存储只改这里。 */
export const photoUrl = (p) => (isPhotoPath(p) ? '/api/media/' + p : '');

let tablesReady = false;

/**
 * 建表。⚠ 必须由应用账号（laroja）执行 —— 用 postgres 建会让属主变成 postgres，
 * 接口随后必然 `permission denied`（这个坑踩过好几次）。
 */
export const ensureMemoryTables = async () => {
  if (tablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.memories (
      id bigserial PRIMARY KEY,
      author_id bigint NULL,
      author_name varchar(60) NOT NULL,
      content text NOT NULL DEFAULT '',
      photos jsonb NOT NULL DEFAULT '[]'::jsonb,
      tags text[] NOT NULL DEFAULT '{}'::text[],
      created_at timestamptz NOT NULL DEFAULT now(),
      shot_on date NULL,
      place varchar(60) NOT NULL DEFAULT '',
      consent_at timestamptz NULL,
      deleted_at timestamptz NULL,
      deleted_by varchar(60) NULL
    );
  `);

  // 列表就是「未删的按时间倒序」，部分索引正好卡在这个查询上
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_live_created_idx
      ON public.memories (created_at DESC, id DESC)
      WHERE deleted_at IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_author_idx
      ON public.memories (author_id)
      WHERE deleted_at IS NULL;
  `);

  /**
   * 标签。用 text[] 而不是再开一张「标签 ↔ 回忆」的关联表：
   * 一条回忆最多 5 个、标签只用来筛选、不需要改名或统计热度，
   * 关联表带来的 join 和一致性维护在这里全是成本，没有收益。
   *
   * ⚠ 老库上表已经存在，所以必须是 ADD COLUMN IF NOT EXISTS，
   *    否则 CREATE TABLE IF NOT EXISTS 会整句跳过，新列永远加不上。
   */
  await pool.query(`ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];`);
  // GIN 是数组包含查询（`tags @> ARRAY['聚会']` / `= ANY`）唯一有效的索引类型
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_tags_idx
      ON public.memories USING gin (tags)
      WHERE deleted_at IS NULL;
  `);

  /**
   * 照片拍的日期与地点，以及「出镜同意」的留痕时间。
   *
   * shot_on 用 date 不用 timestamptz：群友回忆只记得「哪一天」，
   * 强要时分秒只会让人随便选一个，反而更不准；date 也没有时区换算的问题。
   * consent_at 是发布者点「都同意了」那一刻，出问题时能说清是何时确认的 ——
   * 只有作者本人在发布时能写，改文案不动它。
   */
  await pool.query(`ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS shot_on date NULL;`);
  await pool.query(`ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS place varchar(60) NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS consent_at timestamptz NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.memory_comments (
      id bigserial PRIMARY KEY,
      memory_id bigint NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
      author_id bigint NULL,
      author_name varchar(60) NOT NULL,
      content varchar(300) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz NULL,
      deleted_by varchar(60) NULL
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memory_comments_live_idx
      ON public.memory_comments (memory_id, created_at)
      WHERE deleted_at IS NULL;
  `);

  /**
   * 「可以改别人回忆文案」的名单。
   *
   * 存在库里而不是环境变量：加个人不该登服务器改 .env 再重启。
   * 键是**登录账号名**（play_score.name），一律小写存 —— 登录名大小写不固定，
   * 而权限判断不能因为打了个大写就失效。
   *
   * 这个名单只解锁「改文案」，不解锁删除、发帖、后台 —— 能改字不等于能毁内容。
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.memory_editors (
      account_name varchar(60) PRIMARY KEY,
      added_by varchar(60) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  /**
   * 「**这一条**回忆」单独授权的改文案名单。
   *
   * 和上面那张全站名单是两回事：
   *   - memory_editors  = 校对/版主，哪一条都能改；
   *   - memory_grants   = 只针对 memory_id 这一条，别的一律改不了。
   *
   * 为什么不用「授权表 + 全局用 memory_id = 0 表示」：那样每条记录的语义都靠一个
   * 魔法值撑着，查询里到处要写 `memory_id = 0 OR memory_id = m.id`，
   * 一旦有人忘了写，权限就静默失效。两张表，两种语义，各自一条 SQL 说清楚。
   *
   * 主键 (memory_id, account_name) 顺手当唯一约束用；回忆硬删时跟着 CASCADE 走。
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.memory_grants (
      memory_id bigint NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
      account_name varchar(60) NOT NULL,
      added_by varchar(60) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (memory_id, account_name)
    );
  `);

  tablesReady = true;
};

/**
 * 把数据库行拍成前端要的形状。
 *
 * 时间统一给 ISO 字符串：timestamptz 读出来是 Date 对象，直接塞进 props
 * 会在 SSR/CSR 之间序列化成不同格式（也踩过），这里一开始就转成字符串。
 */
// 头像一律走站内代理 /api/avatar/{playerId}：players.avatar_url 是 steamstatic 的外链，
// 会被 CSP 的 img-src 'self' 拦掉（页面上就是一个破图），也省得把访客 IP 送去第三方。
const avatarOf = (authorId, rawUrl) => (rawUrl && authorId ? `/api/avatar/${String(authorId)}` : '');

const shapeMemory = (r) => ({
  id: String(r.id),
  content: r.content || '',
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
  // 拍摄日期用 to_char 取成字符串（见 LIST_FIELDS）：pg 会把 date 读成
  // 本地午夜的 Date，再序列化一次就可能差一天。
  shotOn: r.shot_on ? String(r.shot_on) : '',
  place: r.place || '',
  author: {
    playerId: r.author_id === null || r.author_id === undefined ? '' : String(r.author_id),
    name: r.author_name || '群友',
    avatar: avatarOf(r.author_id, r.author_avatar),
  },
  photos: (Array.isArray(r.photos) ? r.photos : []).map((x) => ({
    url: photoUrl(x && x.p),
    w: Number(x && x.w) || 0,
    h: Number(x && x.h) || 0,
  })).filter((x) => x.url),
  tags: (Array.isArray(r.tags) ? r.tags : []).filter((t) => typeof t === 'string' && t),
  commentCount: Number(r.comment_count) || 0,
  // 「我是被单独指定改这一条的人」。只有 listMemories 按查看者算过这一列，
  // 其它查询没有这个字段，一律当 false —— 前端还会再和服务端的判断对一次。
  granted: !!r.i_can_edit,
  // 这一条一共指定了几个人能改（后台列表用，前台不下发）
  grantCount: Number(r.grant_count) || 0,
});

const shapeComment = (r) => ({
  id: String(r.id),
  memoryId: String(r.memory_id),
  content: r.content || '',
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
  author: {
    playerId: r.author_id === null || r.author_id === undefined ? '' : String(r.author_id),
    name: r.author_name || '群友',
    avatar: avatarOf(r.author_id, r.author_avatar),
  },
});

const LIST_FIELDS = `
  m.id, m.content, m.photos, m.tags, m.created_at, m.author_id, m.author_name,
  to_char(m.shot_on, 'YYYY-MM-DD') AS shot_on, m.place,
  p.avatar_url AS author_avatar,
  (SELECT count(*)::int FROM public.memory_comments c
    WHERE c.memory_id = m.id AND c.deleted_at IS NULL) AS comment_count
`;
const LIST_JOINS = `
  FROM public.memories m
  LEFT JOIN public.players p ON p.id = m.author_id
`;

/**
 * 列表。用 id 做游标而不是 offset：翻页期间有人发新的，
 * offset 会让同一条被看两遍或者直接跳过。
 *
 * `tag` 非空时只返回带这个标签的回忆。`@>` 是 text[] 上唯一能用 GIN 索引的操作符，
 * 换成 `= ANY(tags)` 就会退化成全表扫。
 *
 * `viewer` 是当前登录账号名（没登录传空）。它只影响每条上的 `granted` 字段 ——
 * 「这条回忆单独指定了我」时前端才放出编辑入口。**这不是权限判断**，
 * 服务端在 PATCH 里还会再查一次，前端字段只是用来别把按钮画给不该看见的人。
 */
export const listMemories = async ({ limit = 12, before = null, tag = null, viewer = '' } = {}) => {
  await ensureMemoryTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 30);
  const cur = before && /^\d+$/.test(String(before)) ? String(before) : null;
  const want = typeof tag === 'string' && isValidTag(tag) ? tag.trim().replace(/^#+/, '') : null;
  const who = normAccount(viewer) || null;

  const rows = await pool.query(
    `SELECT ${LIST_FIELDS},
            EXISTS(
              SELECT 1 FROM public.memory_grants g
               WHERE g.memory_id = m.id AND g.account_name = $4
            ) AS i_can_edit
       ${LIST_JOINS}
      WHERE m.deleted_at IS NULL
        AND ($1::bigint IS NULL OR m.id < $1::bigint)
        AND ($3::text IS NULL OR m.tags @> ARRAY[$3::text])
      ORDER BY m.id DESC
      LIMIT $2`,
    [cur, lim + 1, want, who]
  );

  const hasMore = rows.rows.length > lim;
  const page = rows.rows.slice(0, lim).map(shapeMemory);

  // total 是「当前筛选下有几条」，allTotal 是「一共几条」——
  // 筛选条上的「全部 8」和标题下的「3 条回忆」是两个不同的数，不能混用。
  const all = await pool.query(
    `SELECT count(*)::int AS n FROM public.memories WHERE deleted_at IS NULL`
  );
  const allTotal = all.rows[0]?.n || 0;

  let total = allTotal;
  if (want) {
    const m = await pool.query(
      `SELECT count(*)::int AS n
         FROM public.memories m
        WHERE m.deleted_at IS NULL AND m.tags @> ARRAY[$1::text]`,
      [want]
    );
    total = m.rows[0]?.n || 0;
  }

  return {
    memories: page,
    hasMore,
    total,
    allTotal,
    nextCursor: hasMore && page.length ? page[page.length - 1].id : null,
    tag: want,
    tags: await listMemoryTags(),
  };
};

/**
 * 全站标签及用量，给筛选条用。按用量降序 —— 用得最多的标签最可能是人想点的那个。
 * 不用缓存：这是回忆页每次都会被问一次的小查询，一次分组扫描，快得多余去上缓存。
 */
export const listMemoryTags = async () => {
  await ensureMemoryTables();
  const r = await pool.query(
    `SELECT t.tag, count(*)::int AS n
       FROM public.memories m, unnest(m.tags) AS t(tag)
      WHERE m.deleted_at IS NULL
      GROUP BY t.tag
      ORDER BY n DESC, t.tag ASC
      LIMIT 200`
  );
  return r.rows.map((row) => ({ tag: row.tag, count: Number(row.n) || 0 }));
};

export const memoryById = async (id) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    `SELECT ${LIST_FIELDS} ${LIST_JOINS} WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [String(id)]
  );
  return r.rows[0] ? shapeMemory(r.rows[0]) : null;
};

export const createMemory = async ({ authorId, authorName, content, photos, tags, shotOn, place, consent }) => {
  await ensureMemoryTables();
  const list = (Array.isArray(photos) ? photos : [])
    .filter((x) => isPhotoPath(x && x.p))
    .slice(0, MAX_PHOTOS)
    .map((x) => ({ p: x.p, w: Number(x.w) || 0, h: Number(x.h) || 0 }));

  const text = String(content || '').slice(0, TEXT_LIMIT);
  if (!text.trim() && !list.length) throw new Error('写点什么或者传张照片');

  // 日期/地点由接口层先校验过，这里再归一化一次是防守：
  // 直接调这个函数的脚本也要拿不到非法值
  const day = normalizeShotOn(shotOn);
  if (day === null) throw new Error('拍摄日期格式不对');

  const r = await pool.query(
    `INSERT INTO public.memories (author_id, author_name, content, photos, tags, shot_on, place, consent_at)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5::text[], $6::date, $7,
             CASE WHEN $8::boolean THEN now() ELSE NULL END)
     RETURNING id`,
    [
      authorId ? String(authorId) : null,
      String(authorName || '群友').slice(0, 60),
      text,
      JSON.stringify(list),
      normalizeTags(tags),
      day || null,
      normalizePlace(place),
      // 只有作者本人在发布时勾了「都同意了」才留痕；没照片的纯文字回忆不需要
      !!consent && list.length > 0,
    ]
  );
  return memoryById(r.rows[0].id);
};

/**
 * 改正文、标签、拍摄日期与地点。照片不在这里改 —— 单张增删照片要重算九宫格
 * 档位和宽高比，是另一件事。
 *
 * 四个字段都是「传了才改」（undefined 表示保持原值）：
 * 只改标签时不该顺手把正文写空，只改正文时也不该把标签清掉。
 *
 * 为什么从 `COALESCE($2, content)` 改成拼 SET：COALESCE 表达不了「把日期清空」
 * —— 清空要写 NULL，而 NULL 在 COALESCE 里正好是「保持原值」。
 * 四个字段各有各的语义，拼 SQL 反而最不会出错，参数仍然全部走占位符。
 *
 * 允许把正文改成空字符串（只留照片），但**不允许把一条回忆改成图字全空**：
 * 那个判断在接口层做，因为它要看这条还剩几张照片。
 */
export const updateMemory = async (id, { content, tags, shotOn, place } = {}) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(id))) return null;

  const sets = [];
  const vals = [String(id)];
  const set = (col, value, cast = '') => {
    vals.push(value);
    sets.push(`${col} = $${vals.length}${cast}`);
  };

  if (content !== undefined) set('content', String(content === null ? '' : content).slice(0, TEXT_LIMIT));
  if (tags !== undefined) set('tags', normalizeTags(tags), '::text[]');
  if (shotOn !== undefined) {
    const day = normalizeShotOn(shotOn);
    if (day === null) throw new Error('拍摄日期格式不对');
    set('shot_on', day || null, '::date');
  }
  if (place !== undefined) set('place', normalizePlace(place));

  if (!sets.length) return memoryById(id);

  const r = await pool.query(
    `UPDATE public.memories SET ${sets.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL`,
    vals
  );
  if (!r.rowCount) return null;
  return memoryById(id);
};

/** 只改正文的老入口，保留给已有调用方，内部就是 updateMemory。 */
export const updateMemoryContent = (id, content) => updateMemory(id, { content });

/** 软删。返回 false 表示这条本来就不在（或者已经被删过）。 */
export const softDeleteMemory = async (id, by) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(id))) return false;
  const r = await pool.query(
    `UPDATE public.memories
        SET deleted_at = now(), deleted_by = $2
      WHERE id = $1 AND deleted_at IS NULL`,
    [String(id), String(by || '').slice(0, 60)]
  );
  return r.rowCount > 0;
};

export const listComments = async (memoryId) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(memoryId))) return [];
  const r = await pool.query(
    `SELECT c.id, c.memory_id, c.content, c.created_at, c.author_id, c.author_name,
            p.avatar_url AS author_avatar
       FROM public.memory_comments c
       LEFT JOIN public.players p ON p.id = c.author_id
      WHERE c.memory_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC`,
    [String(memoryId)]
  );
  return r.rows.map(shapeComment);
};

export const createComment = async ({ memoryId, authorId, authorName, content }) => {
  await ensureMemoryTables();
  const text = String(content || '').trim().slice(0, COMMENT_LIMIT);
  if (!text) throw new Error('评论不能是空的');
  const r = await pool.query(
    `INSERT INTO public.memory_comments (memory_id, author_id, author_name, content)
     VALUES ($1::bigint, $2::bigint, $3, $4)
     RETURNING id, memory_id, content, created_at, author_id, author_name`,
    [String(memoryId), authorId ? String(authorId) : null, String(authorName || '群友').slice(0, 60), text]
  );
  const row = r.rows[0];
  const avatar = authorId
    ? (await pool.query('SELECT avatar_url FROM public.players WHERE id = $1', [String(authorId)]))
        .rows[0]?.avatar_url || ''
    : '';
  return shapeComment({ ...row, author_avatar: avatar });
};

export const commentById = async (id) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(id))) return null;
  const r = await pool.query(
    `SELECT id, memory_id, author_id, content, deleted_at FROM public.memory_comments WHERE id = $1`,
    [String(id)]
  );
  const row = r.rows[0];
  if (!row || row.deleted_at) return null;
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    authorId: row.author_id === null || row.author_id === undefined ? '' : String(row.author_id),
  };
};

export const softDeleteComment = async (id, by) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(id))) return false;
  const r = await pool.query(
    `UPDATE public.memory_comments
        SET deleted_at = now(), deleted_by = $2
      WHERE id = $1 AND deleted_at IS NULL`,
    [String(id), String(by || '').slice(0, 60)]
  );
  return r.rowCount > 0;
};

/**
 * 后台用：连已删的一起列出来，方便确认「到底删没删掉」。
 * 前台永远拿不到这个函数。
 */
export const adminListMemories = async ({ limit = 50, includeDeleted = true } = {}) => {
  await ensureMemoryTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const r = await pool.query(
    `SELECT ${LIST_FIELDS}, m.deleted_at, m.deleted_by, m.consent_at,
            (SELECT count(*)::int FROM public.memory_grants g
              WHERE g.memory_id = m.id) AS grant_count
       ${LIST_JOINS}
      WHERE ($1::boolean OR m.deleted_at IS NULL)
      ORDER BY m.id DESC
      LIMIT $2`,
    [!!includeDeleted, lim]
  );
  return r.rows.map((row) => ({
    ...shapeMemory(row),
    deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : row.deleted_at || null,
    deletedBy: row.deleted_by || '',
    // 「发布者点了都同意」的时间。只在后台下发 —— 前台没有理由显示，
    // 但删图起争议时它是唯一能查的记录。
    consentedAt: row.consent_at instanceof Date ? row.consent_at.toISOString() : row.consent_at || null,
  }));
};

/**
 * 极简频率限制（内存版，和登录限流同一思路：单人部署不需要 Redis）。
 * 用来挡「按住上传按钮不放」和脚本刷图，不是防恶意攻击的强手段。
 */
const buckets = new Map();
export function allowAction(key, max, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { n: 1, resetAt: now + windowMs });
    return { ok: true, left: max - 1 };
  }
  if (b.n >= max) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.n += 1;
  return { ok: true, left: max - b.n };
}

/**
 * 按登录账号解析出「作者是谁」：优先玩家主昵称，没绑定玩家就用登录名。
 * 站内一律只显示主昵称（players.nickname），这里也一样。
 */
export const authorOfAccount = async (accountName) => {
  const name = String(accountName || '').trim();
  if (!name) return { playerId: '', name: '群友' };
  try {
    const r = await pool.query(
      `SELECT p.id, p.nickname
         FROM public.play_score s
         JOIN public.players p ON p.id = s.player_id
        WHERE s.name = $1
        LIMIT 1`,
      [name]
    );
    const row = r.rows[0];
    if (row) {
      return { playerId: String(row.id), name: row.nickname || name };
    }
  } catch {
    // play_score.player_id 在某些历史库上可能不存在，退回登录名，不让发帖失败
  }
  return { playerId: '', name };
};

/* ---------------- 标签 ---------------- */

/**
 * 校验并清洗一组标签。标签是公开展示的筛选词，所以也要过词表 ——
 * 只在接口层做：标签短，词表命中直接拒绝比替换成星号更好，
 * 否则会留下一个永远筛不到东西的 `**` 标签。
 *
 * 没走 AI 复审：四个字的分类词给模型判断既慢又没意义，词表够用。
 */
export const checkTags = (raw) => {
  const tags = normalizeTags(raw);
  for (const t of tags) {
    const hit = checkInput({ content: t }, { content: TAG_LIMIT });
    if (!hit.ok) return { ok: false, error: moderationMessage(hit) };
  }
  return { ok: true, tags };
};

/**
 * 拍摄地点：公开可见的短文本，和标签一样只过词表、不走 AI 复审
 * （「深圳南山」这种词给模型判断既慢又没意义）。
 * 词表命中直接拒，不做星号替换 —— 免得留下一条「XX 广场」看得出被拦过的痕迹。
 */
export const checkPlace = (raw) => {
  const place = normalizePlace(raw);
  if (!place) return { ok: true, place: '' };
  const hit = checkInput({ place }, { place: PLACE_LIMIT });
  if (!hit.ok) return { ok: false, error: moderationMessage(hit) };
  return { ok: true, place: normalizePlace(hit.cleaned.place) };
};

/* ---------------- 「可以改别人文案」的名单 ---------------- */
const normAccount = (s) => String(s || '').trim().toLowerCase();

/**
 * 把「一个人」解析成登录账号 —— 指定名单的唯一入口。
 *
 * 先按账号名精确匹配，匹配不上再按**玩家昵称**找一次：群友平时说的是「阿强」，
 * 没人记得自己当年登录时打的是不是 qiang1994。昵称重名就拒绝并要求填账号 ——
 * 指定错人比指定不上更麻烦（他能改别人的字，还看不出来哪里不对）。
 */
export const resolveAccount = async (raw) => {
  const typed = String(raw === null || raw === undefined ? '' : raw).trim();
  const name = normAccount(typed);
  if (!name) throw new Error('填个账号名');
  if (name.length > 60) throw new Error('账号名太长了');
  await ensureMemoryTables();

  const direct = await pool.query(
    'SELECT lower(name) AS account FROM public.play_score WHERE lower(name) = $1 LIMIT 1',
    [name]
  );
  if (direct.rowCount) return direct.rows[0].account;

  const nick = await pool.query(
    `SELECT lower(s.name) AS account
       FROM public.players p
       JOIN public.play_score s ON s.player_id = p.id
      WHERE p.nickname = $1`,
    [typed]
  );
  if (nick.rowCount === 1) return nick.rows[0].account;
  if (nick.rowCount > 1) throw new Error('这个昵称对应好几个账号，改填登录账号');
  throw new Error('没有这个账号');
};

/**
 * 按账号或昵称搜人，给「谁能改」的输入框做候选。
 *
 * 只返回账号、昵称、玩家 id 三样 —— 这个接口任何登录用户都能调（要在发布框里
 * 找人），所以不能顺手把等级、分数、地区一起带出来。每次最多 8 条，
 * 够选就行，不做分页。
 */
export const searchAccounts = async (q, limit = 8) => {
  const raw = String(q === null || q === undefined ? '' : q).trim().slice(0, 40);
  if (!raw) return [];
  await ensureMemoryTables();
  const like = '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  const r = await pool.query(
    `SELECT DISTINCT ON (lower(s.name))
            lower(s.name) AS account, p.nickname, p.id AS player_id
       FROM public.play_score s
       JOIN public.players p ON p.id = s.player_id
      WHERE s.name ILIKE $1 OR p.nickname ILIKE $1
      ORDER BY lower(s.name)
      LIMIT 40`,
    [like]
  );

  const rank = (x) => (x.account === normAccount(raw) ? 0 : x.nickname === raw ? 1 : 2);
  return r.rows
    .map((row) => ({
      account: row.account,
      nickname: row.nickname || '',
      playerId: row.player_id === null || row.player_id === undefined ? '' : String(row.player_id),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.account.localeCompare(b.account))
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 20));
};

/** 这个账号在不在改文案名单里。管理员不走这张表，由 isAdmin 单独判。 */
export const isMemoryEditor = async (accountName) => {
  const name = normAccount(accountName);
  if (!name) return false;
  await ensureMemoryTables();
  const r = await pool.query('SELECT 1 FROM public.memory_editors WHERE account_name = $1', [name]);
  return r.rowCount > 0;
};

/** 名单 + 昵称。昵称只是为了在后台确认「这个人是谁」，权限只认账号名。 */
export const listMemoryEditors = async () => {
  await ensureMemoryTables();
  const r = await pool.query(
    `SELECT e.account_name, e.added_by, e.created_at, p.id AS player_id, p.nickname
       FROM public.memory_editors e
       LEFT JOIN public.play_score s ON lower(s.name) = e.account_name
       LEFT JOIN public.players p ON p.id = s.player_id
      ORDER BY e.created_at ASC`
  );
  return r.rows.map((row) => ({
    account: row.account_name,
    nickname: row.nickname || '',
    playerId: row.player_id === null || row.player_id === undefined ? '' : String(row.player_id),
    addedBy: row.added_by || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  }));
};

/**
 * 加人。账号必须真的存在 —— 拼错一个字母就多一条永远不会命中的记录，
 * 后台还看不出来，最后变成「明明加了他却改不了」。
 */
export const addMemoryEditor = async (accountName, by) => {
  const name = normAccount(accountName);
  if (!name) throw new Error('填个账号名');
  if (name.length > 60) throw new Error('账号名太长了');
  await ensureMemoryTables();

  const exists = await pool.query('SELECT 1 FROM public.play_score WHERE lower(name) = $1', [name]);
  if (!exists.rowCount) throw new Error('没有这个账号');

  await pool.query(
    `INSERT INTO public.memory_editors (account_name, added_by)
     VALUES ($1, $2)
     ON CONFLICT (account_name) DO NOTHING`,
    [name, String(by || '').slice(0, 60)]
  );
  return true;
};

/** 移除。返回 false 表示本来就不在名单里。 */
export const removeMemoryEditor = async (accountName) => {
  const name = normAccount(accountName);
  if (!name) return false;
  await ensureMemoryTables();
  const r = await pool.query('DELETE FROM public.memory_editors WHERE account_name = $1', [name]);
  return r.rowCount > 0;
};

/* ---------------- 单条回忆的授权名单 ---------------- */

/** 这一条单独指定了谁。返回账号 + 昵称，昵称只用来在界面上认人。 */
export const listMemoryGrants = async (memoryId) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(memoryId))) return [];
  const r = await pool.query(
    `SELECT g.account_name, g.added_by, g.created_at, p.id AS player_id, p.nickname
       FROM public.memory_grants g
       LEFT JOIN public.play_score s ON lower(s.name) = g.account_name
       LEFT JOIN public.players p ON p.id = s.player_id
      WHERE g.memory_id = $1
      ORDER BY g.created_at ASC`,
    [String(memoryId)]
  );
  return r.rows.map((row) => ({
    account: row.account_name,
    nickname: row.nickname || '',
    playerId: row.player_id === null || row.player_id === undefined ? '' : String(row.player_id),
    addedBy: row.added_by || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  }));
};

/**
 * 给某一条加一个人。账号必须是真的存在的 —— 和老名单同一个理由：
 * 拼错一个字母就多一条永远不命中的记录，界面上还看不出错。
 */
export const addMemoryGrant = async (memoryId, accountName, by) => {
  if (!/^\d+$/.test(String(memoryId))) throw new Error('回忆不存在');
  const name = await resolveAccount(accountName);
  await ensureMemoryTables();

  await pool.query(
    `INSERT INTO public.memory_grants (memory_id, account_name, added_by)
     VALUES ($1::bigint, $2, $3)
     ON CONFLICT (memory_id, account_name) DO NOTHING`,
    [String(memoryId), name, String(by || '').slice(0, 60)]
  );
  return true;
};

/**
 * 批量加人（发布时一次性指定几个）。逐个加，失败的那个记下来给用户看 ——
 * 一个人填错不该让整条回忆发不出去，也不该悄悄消失。
 */
export const addMemoryGrants = async (memoryId, accounts, by) => {
  const list = (Array.isArray(accounts) ? accounts : []).slice(0, 20);
  const rejected = [];
  for (const raw of list) {
    try {
      await addMemoryGrant(memoryId, raw, by);
    } catch {
      const typed = String(raw === null || raw === undefined ? '' : raw).trim().slice(0, 60);
      if (typed) rejected.push(typed);
    }
  }
  return { rejected, editors: await listMemoryGrants(memoryId) };
};

/** 从某一条里移除。返回 false 表示本来就没给这条授权。 */
export const removeMemoryGrant = async (memoryId, accountName) => {
  const name = normAccount(accountName);
  if (!name) return false;
  await ensureMemoryTables();
  const r = await pool.query(
    'DELETE FROM public.memory_grants WHERE memory_id = $1 AND account_name = $2',
    [String(memoryId), name]
  );
  return r.rowCount > 0;
};

/** 这个账号是不是被单独指定改这一条。 */
export const isMemoryGranted = async (memoryId, accountName) => {
  const name = normAccount(accountName);
  if (!name) return false;
  await ensureMemoryTables();
  const r = await pool.query(
    'SELECT 1 FROM public.memory_grants WHERE memory_id = $1 AND account_name = $2',
    [String(memoryId), name]
  );
  return r.rowCount > 0;
};

/**
 * 「改这一条文案」的总判断：全站名单 ∪ 这一条的授权名单。
 * 管理员和作者本人由调用方单独判（前者看 env，后者要比 player_id）。
 */
export const canEditMemoryText = async (memoryId, accountName) => {
  if (await isMemoryEditor(accountName)) return true;
  return isMemoryGranted(memoryId, accountName);
};
