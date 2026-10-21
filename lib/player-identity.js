/**
 * 群友身份（SteamID / 群昵称）的统一读写层。
 *
 * 背景：一个群友在现实里常常有多个 Steam 号（小号、换号），群昵称也常有好几个
 * （群名片改过、不同群不同叫法）。但 players.game_id / group_nickname 是单值列，
 * 而且被 30 多个文件引用，直接改成数组会炸一片。
 *
 * 采用的策略是「主号缓存 + 子表存全量」：
 *   - player_steam_accounts / player_group_nicknames 两张子表存全部身份；
 *   - players.game_id / players.group_nickname 保留，含义降级为「主号缓存」，
 *     由 syncPrimary(db, playerId) 从子表回写。
 *
 * 这样所有既有读点（头像、赛程、战绩、卡片）零改动，只有「写身份」的地方
 * 和「凭 SteamID/群昵称 认人」的地方需要走本模块。
 *
 * ⚠ 约定：任何人不得再直接 `UPDATE players SET game_id = ...`。
 *   一律调 replaceIdentities()，否则子表和主号缓存会不一致。
 *
 * 本模块刻意不 import lib/db（db.js 会反向依赖它，避免循环依赖），
 * 所有函数第一个参数传 pool 或事务里的 client 即可。
 */

export class IdentityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IdentityError';
    this.code = code || 'IDENTITY_ERROR';
  }
}

/** 群昵称归一化：去所有空白 + 小写。"刘 哥" 与 "刘哥" 视为同一个 */
export const normNickname = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');

let tablesReady = false;

/**
 * 建表 + 把现有 players.game_id / group_nickname 迁进子表（幂等）。
 * 每个进程只真正执行一次，之后直接返回。
 */
export async function ensureIdentityTables(db) {
  if (tablesReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.player_steam_accounts (
      id           serial PRIMARY KEY,
      player_id    bigint NOT NULL,
      account_id   bigint NOT NULL,
      persona_name varchar(120) NULL,
      is_primary   bool DEFAULT false NOT NULL,
      source       varchar(20) DEFAULT 'admin' NULL,
      created_at   timestamptz DEFAULT now() NOT NULL
    );
  `);
  // 一个 SteamID 只能归一个群友：否则比赛明细回填时无法判断归属
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS player_steam_accounts_account_uniq
      ON public.player_steam_accounts (account_id);
  `);
  // 每个群友最多一个主号（0 个也允许：还没填号的新人）
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS player_steam_accounts_primary_uniq
      ON public.player_steam_accounts (player_id) WHERE is_primary;
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS player_steam_accounts_player_idx
      ON public.player_steam_accounts (player_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.player_group_nicknames (
      id         serial PRIMARY KEY,
      player_id  bigint NOT NULL,
      nickname   varchar(50) NOT NULL,
      is_primary bool DEFAULT false NOT NULL,
      source     varchar(20) DEFAULT 'admin' NULL,
      created_at timestamptz DEFAULT now() NOT NULL
    );
  `);
  // 群昵称允许「不同人重名」（群里真有这种情况），但同一个人不该重复登记同一条
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS player_group_nicknames_player_norm_uniq
      ON public.player_group_nicknames (player_id, lower(regexp_replace(btrim(nickname), '\\s+', '', 'g')));
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS player_group_nicknames_primary_uniq
      ON public.player_group_nicknames (player_id) WHERE is_primary;
  `);

  // ---------- 迁移：现有单值 → 子表 ----------
  await db.query(`
    INSERT INTO public.player_steam_accounts (player_id, account_id, is_primary, source)
    SELECT p.id, p.game_id, true, 'migrated'
      FROM public.players p
     WHERE p.game_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.player_steam_accounts s WHERE s.player_id = p.id)
    ON CONFLICT DO NOTHING;
  `);
  await db.query(`
    INSERT INTO public.player_group_nicknames (player_id, nickname, is_primary, source)
    SELECT p.id, btrim(p.group_nickname), true, 'migrated'
      FROM public.players p
     WHERE coalesce(btrim(p.group_nickname), '') <> ''
       AND NOT EXISTS (SELECT 1 FROM public.player_group_nicknames n WHERE n.player_id = p.id);
  `);

  tablesReady = true;
}

/**
 * 把子表里的主号回写到 players.game_id / group_nickname（主号缓存）。
 * 没有主号时写 NULL —— 这代表「这个人还没填 SteamID」，是全站各处已有的判空逻辑。
 */
export async function syncPrimary(db, playerId) {
  await db.query(
    `UPDATE public.players p SET
       game_id = (SELECT s.account_id FROM public.player_steam_accounts s
                   WHERE s.player_id = p.id ORDER BY s.is_primary DESC, s.id ASC LIMIT 1),
       group_nickname = (SELECT n.nickname FROM public.player_group_nicknames n
                          WHERE n.player_id = p.id ORDER BY n.is_primary DESC, n.id ASC LIMIT 1)
     WHERE p.id = $1`,
    [String(playerId)]
  );
}

/** 读某人的全部身份 */
export async function listIdentities(db, playerId) {
  const pid = String(playerId);
  const [steam, nicks] = await Promise.all([
    db.query(
      `SELECT account_id::text AS "accountId", persona_name AS "personaName",
              is_primary AS "isPrimary", source, created_at AS "createdAt"
         FROM public.player_steam_accounts WHERE player_id = $1
        ORDER BY is_primary DESC, id ASC`,
      [pid]
    ),
    db.query(
      `SELECT nickname, is_primary AS "isPrimary", source, created_at AS "createdAt"
         FROM public.player_group_nicknames WHERE player_id = $1
        ORDER BY is_primary DESC, id ASC`,
      [pid]
    ),
  ]);
  return { steam: steam.rows, nicknames: nicks.rows };
}

/** 批量读（列表页用，避免 N+1） */
export async function identitiesForPlayers(db, playerIds) {
  const ids = (playerIds || []).map(String);
  const out = new Map();
  if (ids.length === 0) return out;
  ids.forEach((id) => out.set(id, { steam: [], nicknames: [] }));

  const [steam, nicks] = await Promise.all([
    db.query(
      `SELECT player_id::text AS pid, account_id::text AS account, is_primary AS "isPrimary"
         FROM public.player_steam_accounts WHERE player_id = ANY($1::bigint[])
        ORDER BY is_primary DESC, id ASC`,
      [ids]
    ),
    db.query(
      `SELECT player_id::text AS pid, nickname, is_primary AS "isPrimary"
         FROM public.player_group_nicknames WHERE player_id = ANY($1::bigint[])
        ORDER BY is_primary DESC, id ASC`,
      [ids]
    ),
  ]);
  steam.rows.forEach((r) =>
    out.get(String(r.pid))?.steam.push({ accountId: r.account, isPrimary: !!r.isPrimary })
  );
  nicks.rows.forEach((r) =>
    out.get(String(r.pid))?.nicknames.push({ nickname: r.nickname, isPrimary: !!r.isPrimary })
  );
  return out;
}

/**
 * 覆盖式写入某人的全部身份，并同步主号缓存。
 *
 * @param {object} db        pool 或事务 client
 * @param {string} playerId
 * @param {object} data
 *   steamIds:  [{ accountId, isPrimary?, personaName? }] 或纯字符串/数字数组
 *   nicknames: [{ nickname, isPrimary? }] 或纯字符串数组
 *   source:    'self' | 'admin' | 'register' | 'match' | 'import'
 *   requirePrimary: 自助场景传 true —— 已有主号时不允许把主号删空，只能替换
 */
export async function replaceIdentities(db, playerId, data = {}) {
  const pid = String(playerId);
  const source = data.source || 'admin';

  // ---------- 1. 规范化 SteamID ----------
  const accounts = [];
  const seenAcc = new Set();
  for (const raw of data.steamIds || []) {
    const accountId = String(raw && typeof raw === 'object' ? raw.accountId : raw).trim();
    if (!accountId) continue;
    if (!/^\d+$/.test(accountId)) {
      throw new IdentityError(`SteamID「${accountId}」只能是纯数字（好友码）`, 'BAD_STEAMID');
    }
    if (seenAcc.has(accountId)) continue;
    seenAcc.add(accountId);
    accounts.push({
      accountId,
      isPrimary: !!(raw && typeof raw === 'object' && raw.isPrimary),
      personaName: (raw && typeof raw === 'object' && raw.personaName) || null,
    });
  }

  // ---------- 2. 规范化群昵称 ----------
  const nicks = [];
  const seenNick = new Set();
  for (const raw of data.nicknames || []) {
    const nickname = String(raw && typeof raw === 'object' ? raw.nickname : raw).trim();
    if (!nickname) continue;
    const key = normNickname(nickname);
    if (seenNick.has(key)) continue;
    seenNick.add(key);
    nicks.push({
      nickname: nickname.slice(0, 50),
      isPrimary: !!(raw && typeof raw === 'object' && raw.isPrimary),
    });
  }

  // ---------- 3. 主号规则 ----------
  const pickPrimary = (list, label, requireOne) => {
    if (list.length === 0) return null;
    let chosen = list.findIndex((x) => x.isPrimary);
    if (chosen === -1) chosen = 0; // 没指定就第一个当主号
    list.forEach((x, i) => {
      x.isPrimary = i === chosen;
    });
    if (requireOne && !list[chosen]) throw new IdentityError(`${label}至少要留一个`, 'NO_PRIMARY');
    return list[chosen];
  };

  // 自助场景：原本有主号，这次一个都没给 → 拒绝（主号只能替换，不能删空）
  if (data.requirePrimary) {
    const cur = await listIdentities(db, pid);
    const hadSteam = cur.steam.length > 0;
    const hadNick = cur.nicknames.length > 0;
    if (hadSteam && accounts.length === 0) {
      throw new IdentityError(
        '主号 SteamID 不能直接删空。要换号请先添加新的 SteamID，再把它设为主号。',
        'PRIMARY_REQUIRED'
      );
    }
    if (hadNick && nicks.length === 0) {
      throw new IdentityError('群昵称至少要保留一个，不能全部删掉。', 'PRIMARY_REQUIRED');
    }
  }

  pickPrimary(accounts, 'SteamID', !!data.requirePrimary);
  pickPrimary(nicks, '群昵称', !!data.requirePrimary);

  // ---------- 4. 一个 SteamID 只能归一个人 ----------
  if (accounts.length > 0) {
    const taken = await db.query(
      `SELECT s.account_id::text AS account, p.nickname
         FROM public.player_steam_accounts s
         JOIN public.players p ON p.id = s.player_id
        WHERE s.account_id = ANY($1::bigint[]) AND s.player_id <> $2`,
      [accounts.map((a) => a.accountId), pid]
    );
    if (taken.rowCount > 0) {
      const list = taken.rows.map((r) => `${r.account}（已属于「${r.nickname || '未命名'}」）`).join('、');
      throw new IdentityError(
        `这个 SteamID 已经被别人登记了：${list}。一个 SteamID 只能属于一个群友，请先在对方资料里删掉。`,
        'STEAMID_TAKEN'
      );
    }
  }

  // ---------- 5. 覆盖写：先清空这个人的，再插新的 ----------
  // 不用 upsert 是为了让「删掉某条」和「改名」走同一条路径，逻辑只有一份。
  await db.query('DELETE FROM public.player_steam_accounts WHERE player_id = $1', [pid]);
  for (const a of accounts) {
    await db.query(
      `INSERT INTO public.player_steam_accounts (player_id, account_id, persona_name, is_primary, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [pid, a.accountId, a.personaName, a.isPrimary, source]
    );
  }

  await db.query('DELETE FROM public.player_group_nicknames WHERE player_id = $1', [pid]);
  for (const n of nicks) {
    await db.query(
      `INSERT INTO public.player_group_nicknames (player_id, nickname, is_primary, source)
       VALUES ($1, $2, $3, $4)`,
      [pid, n.nickname, n.isPrimary, source]
    );
  }

  // ---------- 6. 回写主号缓存 ----------
  await syncPrimary(db, pid);

  return {
    steam: accounts.map((a) => ({ accountId: a.accountId, isPrimary: a.isPrimary })),
    nicknames: nicks.map((n) => ({ nickname: n.nickname, isPrimary: n.isPrimary })),
  };
}

/** 凭 SteamID（任意主副号）找人，返回 playerId 字符串或 null */
export async function playerIdBySteamId(db, accountId) {
  const raw = String(accountId ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const r = await db.query(
    'SELECT player_id::text AS pid FROM public.player_steam_accounts WHERE account_id = $1 LIMIT 1',
    [raw]
  );
  return r.rows[0]?.pid || null;
}

/** 批量：SteamID → playerId（导入/回填用，避免逐条查库） */
export async function playerIdMapBySteamIds(db, accountIds) {
  const ids = [...new Set((accountIds || []).map((x) => String(x ?? '').trim()).filter((x) => /^\d+$/.test(x)))];
  const map = new Map();
  if (ids.length === 0) return map;
  const r = await db.query(
    `SELECT account_id::text AS account, player_id::text AS pid
       FROM public.player_steam_accounts WHERE account_id = ANY($1::bigint[])`,
    [ids]
  );
  r.rows.forEach((row) => map.set(String(row.account), String(row.pid)));
  return map;
}

/**
 * 凭群昵称找人。群昵称允许不同人重名，所以返回**数组**：
 * 命中 1 条 → 可以认定；命中多条 → 导入时应当报歧义，不能瞎猜。
 */
export async function playersByGroupNickname(db, nickname) {
  const key = normNickname(nickname);
  if (!key) return [];
  const r = await db.query(
    `SELECT n.player_id::text AS id, n.nickname, p.nickname AS "playerName", p.game_id::text AS "gameId"
       FROM public.player_group_nicknames n
       JOIN public.players p ON p.id = n.player_id
      WHERE lower(regexp_replace(btrim(n.nickname), '\\s+', '', 'g')) = $1
      ORDER BY n.is_primary DESC, n.id ASC`,
    [key]
  );
  return r.rows;
}

/** 批量：群昵称集合 → Map(归一昵称, 候选人数组) */
export async function playerCandidatesByGroupNicknames(db, nicknames) {
  const keys = [...new Set((nicknames || []).map(normNickname).filter(Boolean))];
  const map = new Map();
  if (keys.length === 0) return map;
  const r = await db.query(
    `SELECT n.player_id::text AS id, n.nickname, p.nickname AS "playerName"
       FROM public.player_group_nicknames n
       JOIN public.players p ON p.id = n.player_id
      WHERE lower(regexp_replace(btrim(n.nickname), '\\s+', '', 'g')) = ANY($1::text[])
      ORDER BY n.is_primary DESC, n.id ASC`,
    [keys]
  );
  r.rows.forEach((row) => {
    const key = normNickname(row.nickname);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ id: String(row.id), playerName: row.playerName });
  });
  return map;
}
