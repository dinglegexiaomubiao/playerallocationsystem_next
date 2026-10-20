/**
 * Steam / Dota2 玩家资料查询（走 OpenDota 的公开接口，无需 API key）。
 *
 * 为什么不直接用 Steam Web API：`ISteamUser/GetPlayerSummaries` 要 key，
 * 而 OpenDota 的 `/api/players/{account_id}` 直接给出 personaname + 三档头像，
 * 正好够用。steamcommunity.com 的 `?xml=1` 在国内常被墙（实测 10s 超时），也不可靠。
 *
 * ⚠ OpenDota 免费额度有限（约 60 次/分钟、2000 次/月），
 *   所以调用方必须配合缓存，绝不能每次请求都打过去。
 */

// SteamID64 的固定基数：76561197960265728 = 0x110000100000000
const STEAM64_BASE = 76561197960265728n;

/**
 * Dota2 的 account_id（9 位数字，如 114678450）→ SteamID64
 * 站点里 players.game_id 存的就是 account_id。
 */
function accountIdToSteam64(accountId) {
  const n = BigInt(String(accountId).trim());
  return (STEAM64_BASE + n).toString();
}

/** SteamID64 → account_id；传入非 17 位数字时返回 null */
function steam64ToAccountId(steam64) {
  const s = String(steam64).trim();
  if (!/^7656119\d{10}$/.test(s)) return null;
  const d = BigInt(s) - STEAM64_BASE;
  return d > 0n ? d.toString() : null;
}

/** 站点里 game_id 合法与否：Dota2 account_id 是 1~10 位纯数字 */
function normalizeAccountId(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

const OPENDOTA_BASE = 'https://api.opendota.com';

// ===== 并发闸门 =====
// 群友页一次会渲染 68 个头像，如果每个都直连 OpenDota，瞬间就是 68 个请求，
// 免费额度（约 60 次/分钟）直接打爆。这里限制同时在途的请求数，
// 超出的排队 —— 图片会陆续出现，但接口不会因为限流整体失败。
const MAX_CONCURRENT = 3;
let activeCount = 0;
const waiters = [];

function acquireSlot() {
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  activeCount -= 1;
  if (waiters.length) {
    activeCount += 1;
    const next = waiters.shift();
    next();
  }
}

/**
 * 拉取玩家公开资料。失败一律返回 null（调用方按「暂无头像」处理），不抛异常。
 * @returns {Promise<null | {accountId, steam64, personaname, avatar, avatarmedium, avatarfull, profileurl, country}>}
 */
async function fetchPlayerProfile(accountId, { timeout = 8000 } = {}) {
  const acc = normalizeAccountId(accountId);
  if (!acc) return null;

  const url = `${OPENDOTA_BASE}/api/players/${acc}`;
  await acquireSlot();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { Accept: 'application/json', 'User-Agent': 'playerallocation/1.0' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const p = json && json.profile;
    if (!p) return null;

    const avatarfull = p.avatarfull || p.avatarmedium || p.avatar || null;
    if (!avatarfull) return null;

    return {
      accountId: acc,
      steam64: p.steamid || accountIdToSteam64(acc),
      personaname: p.personaname || null,
      avatar: p.avatar || null,
      avatarmedium: p.avatarmedium || null,
      avatarfull,
      profileurl: p.profileurl || null,
      country: p.loccountrycode || null,
    };
  } catch (error) {
    return null;
  } finally {
    releaseSlot();
  }
}

/** 当前在途请求数（诊断用） */
function inflightCount() {
  return activeCount;
}

module.exports = {
  accountIdToSteam64,
  steam64ToAccountId,
  normalizeAccountId,
  fetchPlayerProfile,
  inflightCount,
  STEAM64_BASE: STEAM64_BASE.toString(),
};
