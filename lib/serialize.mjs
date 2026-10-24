/**
 * 把数据洗成「能进 getServerSideProps props」的纯对象。
 *
 * 三件事：Date → ISO 字符串、丢掉 undefined 的键、NaN/Infinity → null。
 *
 * 为什么必须做，而且必须一处做：Next 只在 **dev / 构建期** 检查 props 能不能序列化
 * （`next/dist/server/render.js` 里 `isSerializableProps` 的调用条件是
 * `__NEXT_DEV_SERVER || isBuildTimeSSG`）。线上直接 `JSON.stringify`：
 * Date 悄悄变字符串、undefined 的键被删掉，于是症状是「本地整页 500、线上好好的」，
 * 而且完全不像数据形状的问题 —— 踩过两次（/members 的 avatar_synced_at、/admin 的 created_at）。
 *
 * 为什么不是逐字段：`SELECT *` 出来的列会随时增加，逐字段写法漏一个就再中一次。
 * 新增 SSR 页面时，把查库结果整体过一遍这个函数，比记住哪些列是时间类型可靠。
 *
 * ⚠ 只处理「普通对象 / 数组 / 原始值」。pg 的 Date、Buffer 等实例对象也会被转成
 *   JSON 友好形态，但自定义 class 实例会被当成普通对象拆开 —— 本项目的查询结果
 *   都是 plain object，够用。
 */
export function toSerializable(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : toSerializable(x)));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) continue; // JSON 里本来就没有这个键，别让 props 检查抓到
      out[k] = toSerializable(v[k]);
    }
    return out;
  }
  return v;
}
