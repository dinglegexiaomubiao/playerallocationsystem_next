/**
 * 进程内的简单 TTL 缓存，给「跑起来比较贵、短时间重复调用没意义」的接口用。
 *
 * 目前用于：
 *   - /api/players 列表（要跑全员参赛记录的聚合查询，45s）
 *   - /api/avatars/sync 同步完成后主动 clear()，避免刚同步完还要等缓存过期才看到头像
 *
 * 单进程内存，重启即清空。不要放任何用户私有、需要强一致的数据。
 */

const PRESETS = {
  playersList: 45 * 1000, // 群友列表
};

const store = new Map();

/** 取缓存；过期或不存在返回 null */
function get(scope, key = '') {
  const k = scope + '|' + key;
  const item = store.get(k);
  if (!item) return null;
  if (Date.now() - item.at > item.ttl) {
    store.delete(k);
    return null;
  }
  return item.value;
}

/** 写缓存，ttl 不传就用预设值 */
function set(scope, key, value, ttl) {
  const k = scope + '|' + key;
  store.set(k, { at: Date.now(), ttl: ttl === undefined ? PRESETS[scope] || 30 * 1000 : ttl, value });
  return value;
}

/** 清空某个 scope 的全部条目（不传 scope 就是全清） */
function clear(scope) {
  if (!scope) {
    store.clear();
    return;
  }
  const prefix = scope + '|';
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

function stats() {
  return { size: store.size, scopes: Array.from(new Set(Array.from(store.keys()).map((k) => k.split('|')[0]))) };
}

module.exports = { get, set, clear, stats, PRESETS };
