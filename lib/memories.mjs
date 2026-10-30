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
 */
export const listMemories = async ({ limit = 12, before = null, tag = null } = {}) => {
  await ensureMemoryTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 30);
  const cur = before && /^\d+$/.test(String(before)) ? String(before) : null;
  const want = typeof tag === 'string' && isValidTag(tag) ? tag.trim().replace(/^#+/, '') : null;

  const rows = await pool.query(
    `SELECT ${LIST_FIELDS} ${LIST_JOINS}
      WHERE m.deleted_at IS NULL
        AND ($1::bigint IS NULL OR m.id < $1::bigint)
        AND ($3::text IS NULL OR m.tags @> ARRAY[$3::text])
      ORDER BY m.id DESC
      LIMIT $2`,
    [cur, lim + 1, want]
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

export const createMemory = async ({ authorId, authorName, content, photos, tags }) => {
  await ensureMemoryTables();
  const list = (Array.isArray(photos) ? photos : [])
    .filter((x) => isPhotoPath(x && x.p))
    .slice(0, MAX_PHOTOS)
    .map((x) => ({ p: x.p, w: Number(x.w) || 0, h: Number(x.h) || 0 }));

  const text = String(content || '').slice(0, TEXT_LIMIT);
  if (!text.trim() && !list.length) throw new Error('写点什么或者传张照片');

  const r = await pool.query(
    `INSERT INTO public.memories (author_id, author_name, content, photos, tags)
     VALUES ($1::bigint, $2, $3, $4::jsonb, $5::text[])
     RETURNING id`,
    [
      authorId ? String(authorId) : null,
      String(authorName || '群友').slice(0, 60),
      text,
      JSON.stringify(list),
      normalizeTags(tags),
    ]
  );
  return memoryById(r.rows[0].id);
};

/**
 * 改正文与标签。照片不在这里改 —— 单张增删照片要重算九宫格档位和宽高比，
 * 是另一件事，现在只让作者改字和标签。
 *
 * 两个字段都是「传了才改」（undefined 表示保持原值）：
 * 只改标签时不该顺手把正文写空，只改正文时也不该把标签清掉。
 * 用 COALESCE 是为了让一条 SQL 同时支持这两种部分更新。
 *
 * 允许把正文改成空字符串（只留照片），但**不允许把一条回忆改成图字全空**：
 * 那个判断在接口层做，因为它要看这条还剩几张照片。
 */
export const updateMemory = async (id, { content, tags } = {}) => {
  await ensureMemoryTables();
  if (!/^\d+$/.test(String(id))) return null;

  const hasContent = content !== undefined;
  const hasTags = tags !== undefined;
  const text = hasContent ? String(content === null ? '' : content).slice(0, TEXT_LIMIT) : null;

  const r = await pool.query(
    `UPDATE public.memories
        SET content = COALESCE($2::text, content),
            tags    = COALESCE($3::text[], tags)
      WHERE id = $1 AND deleted_at IS NULL`,
    [String(id), text, hasTags ? normalizeTags(tags) : null]
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
    `SELECT ${LIST_FIELDS}, m.deleted_at, m.deleted_by ${LIST_JOINS}
      WHERE ($1::boolean OR m.deleted_at IS NULL)
      ORDER BY m.id DESC
      LIMIT $2`,
    [!!includeDeleted, lim]
  );
  return r.rows.map((row) => ({
    ...shapeMemory(row),
    deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : row.deleted_at || null,
    deletedBy: row.deleted_by || '',
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

/* ---------------- 「可以改别人文案」的名单 ---------------- */
const normAccount = (s) => String(s || '').trim().toLowerCase();

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
