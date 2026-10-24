/**
 * 群友语录（/quotes）。
 *
 * 三个必须记住的点：
 *
 * 1. **玩家 id 全程走字符串**。players.id 是 17 位雪花号（17924949338839183），
 *    超过 2^53，任何一次 Number() 都会静默把末位舍入成另一个数。帮派页已经因为这个
 *    404 过一次（见 pitfalls 第 16 节），这里一开始就不碰 Number。
 *
 * 2. **said_at 是 date，不能让 JS 碰**。node-postgres 会把 date 解析成「本地零点」的
 *    Date，再 toISOString() 就退到前一天（UTC+8）。所以 SQL 里直接 to_char 成
 *    'YYYY-MM-DD' 字符串，整条链路只有字符串。
 *
 * 3. **content_key 是去重的地基**。同一句话常被好几个人收，落库前要能判断是不是同一条。
 *    归一化（全角转半角 + 去大小写 + 去空白标点符号）后建唯一索引，重复时不当错误处理，
 *    而是回一句「这条已经有人收过了」并把已有 id 带回去。
 */

import { pool } from './db.js';

const LIMIT = 120; // 语录正文上限，与 LIMITS.quote 对齐
const SOURCE_LIMIT = 40; // 自定义出处上限，与 LIMITS.quoteSource 对齐

/**
 * 归一化：全角转半角（NFKC）、小写、去掉所有空白 + 标点 + 符号。
 *
 * 「打得菜，就多练。」和「打得菜就多练」必须算同一条，否则去重等于没做。
 * 用 Unicode 的 \p{P}（标点）\p{S}（符号）而不是手写字符集，中文标点才盖得全。
 */
export const normalizeQuote = (s) =>
  [...String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')].join('');

let tablesReady = false;

/** 建表。建表必须由应用账号执行 —— 用 postgres 建会让属主变成 postgres，接口随后 500。 */
export const ensureQuoteTables = async () => {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.quotes (
      id bigserial PRIMARY KEY,
      content varchar(120) NOT NULL,
      content_key varchar(160) NOT NULL,
      said_at date NOT NULL,
      source_player_id bigint NULL,
      source_text varchar(40) NULL,
      submitted_by bigint NULL,
      created_at timestamptz DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS quotes_content_key_uniq ON public.quotes (content_key);
  `);
  // 按出处筛人、按收录时间倒序都要走索引
  await pool.query(`
    CREATE INDEX IF NOT EXISTS quotes_created_idx ON public.quotes (created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS quotes_source_player_idx ON public.quotes (source_player_id);
  `);
  tablesReady = true;
};

/**
 * 一行 → 接口字段。
 *
 * source 做成「二选一的联合体」而不是两个平铺字段：前端拿到
 * { type:'player' } 就渲染头像 + 链接，拿到 { type:'text' } 就渲染纯文本，
 * 不用在每个渲染点都判一次 sourcePlayerId 有没有值。
 */
const shapeQuote = (r) => ({
  id: String(r.id),
  content: r.content,
  saidAt: r.said_date, // 已经是 'YYYY-MM-DD' 字符串（SQL 里 to_char 过）
  createdAt:
    r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at || null,
  source: r.source_player_id
    ? {
        type: 'player',
        playerId: String(r.source_player_id),
        nickname: r.source_nickname || '已注销的群友',
        // 头像一律走站内代理。直连 steamstatic 会被 CSP 的 img-src 拦掉，
        // 拦掉后 Avatar 会退成首字母色块，看着像「这帮人没头像」。
        avatar: r.source_avatar ? `/api/avatar/${r.source_player_id}` : null,
      }
    : { type: 'text', text: r.source_text || '群里某人' },
  submittedBy: r.submitted_by
    ? { playerId: String(r.submitted_by), nickname: r.submitter_nickname || null }
    : null,
});

const SELECT_FIELDS = `
  q.id, q.content, q.source_player_id, q.source_text, q.submitted_by, q.created_at,
  to_char(q.said_at, 'YYYY-MM-DD') AS said_date,
  p.nickname AS source_nickname,
  p.avatar_url AS source_avatar,
  sp.nickname AS submitter_nickname
`;
const SELECT_JOINS = `
  FROM public.quotes q
  LEFT JOIN public.players p ON p.id = q.source_player_id
  LEFT JOIN public.players sp ON sp.id = q.submitted_by
`;

/**
 * 列表。排序用 created_at 倒序，**不是 said_at** ——
 * 有人补录一条 2023 年的老语录，按 said_at 排会直接沉底，谁也看不见。
 */
export const listQuotes = async ({ limit = 30, offset = 0, sourcePlayerId = null } = {}) => {
  await ensureQuoteTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const src = sourcePlayerId ? String(sourcePlayerId) : null;

  const rows = await pool.query(
    `SELECT ${SELECT_FIELDS} ${SELECT_JOINS}
      WHERE ($1::bigint IS NULL OR q.source_player_id = $1::bigint)
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT $2 OFFSET $3`,
    [src, lim, off]
  );
  const total = await pool.query(
    `SELECT count(*)::int AS n,
            count(DISTINCT q.source_player_id)::int AS people
       FROM public.quotes q
      WHERE ($1::bigint IS NULL OR q.source_player_id = $1::bigint)`,
    [src]
  );

  return {
    quotes: rows.rows.map(shapeQuote),
    total: total.rows[0]?.n || 0,
    people: total.rows[0]?.people || 0,
    hasMore: off + rows.rows.length < (total.rows[0]?.n || 0),
  };
};

/** 悬浮栏专用：只要最近的一批，字段越少越好。 */
export const tickerQuotes = async (limit = 30) => {
  await ensureQuoteTables();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 50);
  const r = await pool.query(
    `SELECT ${SELECT_FIELDS} ${SELECT_JOINS}
      ORDER BY q.created_at DESC, q.id DESC
      LIMIT $1`,
    [lim]
  );
  return r.rows.map(shapeQuote).map(({ id, content, source }) => ({ id, content, source }));
};

/**
 * 自定义出处不能和某位群友的昵称撞 —— 否则等于可以随便以别人的名义发一句话。
 * AI 审核拦不住这种「捏造」，因为文字本身完全合规。
 *
 * 群友总共一百多人，全量拉回来在内存里归一化比对，比在 SQL 里写
 * translate(标点表) 可靠得多，也不值得为它加索引。
 */
export const findPlayerByNickname = async (text) => {
  const key = normalizeQuote(text);
  if (!key) return null;
  const r = await pool.query(`SELECT id, nickname FROM public.players WHERE nickname IS NOT NULL`);
  const hit = r.rows.find((p) => normalizeQuote(p.nickname) === key);
  return hit ? { id: String(hit.id), nickname: hit.nickname } : null;
};

/** 校验出处指向的群友真的存在（防止前端传一个乱写的 id 进来）。 */
export const playerExists = async (playerId) => {
  const r = await pool.query('SELECT 1 FROM public.players WHERE id = $1::bigint LIMIT 1', [
    String(playerId),
  ]);
  return r.rowCount > 0;
};

/**
 * 新建一条。
 * @returns {{ duplicate: true, id: string } | { duplicate: false, quote: object }}
 */
export const createQuote = async ({
  content,
  saidAt,
  sourcePlayerId = null,
  sourceText = null,
  submittedBy = null,
}) => {
  await ensureQuoteTables();
  const text = [...String(content || '').trim()].slice(0, LIMIT).join('');
  const key = normalizeQuote(text).slice(0, 160);

  const exist = await pool.query('SELECT id FROM public.quotes WHERE content_key = $1 LIMIT 1', [key]);
  if (exist.rowCount > 0) {
    return { duplicate: true, id: String(exist.rows[0].id) };
  }

  try {
    const r = await pool.query(
      `INSERT INTO public.quotes (content, content_key, said_at, source_player_id, source_text, submitted_by)
       VALUES ($1, $2, $3::date, $4::bigint, $5, $6::bigint)
       RETURNING id`,
      [
        text,
        key,
        saidAt,
        sourcePlayerId ? String(sourcePlayerId) : null,
        sourceText ? [...String(sourceText).trim()].slice(0, SOURCE_LIMIT).join('') : null,
        submittedBy ? String(submittedBy) : null,
      ]
    );
    const id = String(r.rows[0].id);
    // 回读一次，把 join 出来的出处昵称一起给前端，省得再请求
    const full = await pool.query(`SELECT ${SELECT_FIELDS} ${SELECT_JOINS} WHERE q.id = $1::bigint`, [id]);
    return { duplicate: false, quote: shapeQuote(full.rows[0]) };
  } catch (e) {
    // 并发下两个人同时提交同一句，唯一索引会在这里挡住
    if (e.code === '23505') {
      const again = await pool.query('SELECT id FROM public.quotes WHERE content_key = $1 LIMIT 1', [key]);
      return { duplicate: true, id: String(again.rows[0]?.id || '') };
    }
    throw e;
  }
};

export const quoteById = async (id) => {
  await ensureQuoteTables();
  const r = await pool.query(`SELECT ${SELECT_FIELDS} ${SELECT_JOINS} WHERE q.id = $1::bigint`, [
    String(id),
  ]);
  return r.rowCount ? shapeQuote(r.rows[0]) : null;
};

export const deleteQuote = async (id) => {
  await ensureQuoteTables();
  const r = await pool.query('DELETE FROM public.quotes WHERE id = $1::bigint', [String(id)]);
  return r.rowCount;
};

/** 后台改错字用。只允许改这三样，id / 收录人不动。 */
export const updateQuote = async (id, { content, saidAt, sourceText }) => {
  await ensureQuoteTables();
  const text = [...String(content || '').trim()].slice(0, LIMIT).join('');
  const key = normalizeQuote(text).slice(0, 160);
  const r = await pool.query(
    `UPDATE public.quotes
        SET content = $2, content_key = $3, said_at = $4::date, source_text = $5
      WHERE id = $1::bigint`,
    [String(id), text, key, saidAt, sourceText ? String(sourceText).slice(0, SOURCE_LIMIT) : null]
  );
  return r.rowCount;
};

export { LIMIT as QUOTE_LIMIT, SOURCE_LIMIT as QUOTE_SOURCE_LIMIT };
