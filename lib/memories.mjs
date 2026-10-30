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
  m.id, m.content, m.photos, m.created_at, m.author_id, m.author_name,
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
 */
export const listMemories = async ({ limit = 12, before = null } = {}) => {
  await ensureMemoryTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 30);
  const cur = before && /^\d+$/.test(String(before)) ? String(before) : null;

  const rows = await pool.query(
    `SELECT ${LIST_FIELDS} ${LIST_JOINS}
      WHERE m.deleted_at IS NULL
        AND ($1::bigint IS NULL OR m.id < $1::bigint)
      ORDER BY m.id DESC
      LIMIT $2`,
    [cur, lim + 1]
  );

  const hasMore = rows.rows.length > lim;
  const page = rows.rows.slice(0, lim).map(shapeMemory);

  const total = await pool.query(
    `SELECT count(*)::int AS n FROM public.memories WHERE deleted_at IS NULL`
  );

  return {
    memories: page,
    hasMore,
    total: total.rows[0]?.n || 0,
    nextCursor: hasMore && page.length ? page[page.length - 1].id : null,
  };
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

export const createMemory = async ({ authorId, authorName, content, photos }) => {
  await ensureMemoryTables();
  const list = (Array.isArray(photos) ? photos : [])
    .filter((x) => isPhotoPath(x && x.p))
    .slice(0, MAX_PHOTOS)
    .map((x) => ({ p: x.p, w: Number(x.w) || 0, h: Number(x.h) || 0 }));

  const text = String(content || '').slice(0, TEXT_LIMIT);
  if (!text.trim() && !list.length) throw new Error('写点什么或者传张照片');

  const r = await pool.query(
    `INSERT INTO public.memories (author_id, author_name, content, photos)
     VALUES ($1::bigint, $2, $3, $4::jsonb)
     RETURNING id`,
    [authorId ? String(authorId) : null, String(authorName || '群友').slice(0, 60), text, JSON.stringify(list)]
  );
  return memoryById(r.rows[0].id);
};

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
