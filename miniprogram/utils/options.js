// 选项常量（场上位置 / 组队模式 / 活动类型 / 时长 …）来自 `/api/options`。
//
// 为什么不在小程序里写死一份：这些常量在服务端 `lib/options.mjs` 里是唯一来源，
// Web 端直接 import 同一份。小程序再抄一次就变成第二份，早晚和校验规则对不上
// （比如服务端只认 PARTY_MODES 的 key，前端写了个新标签就会被拒）。
//
// 故意不做本地兜底：取不到就让表单报错重试，好过拿一份可能过期的常量去提交。
const { request } = require('./api');

let cache = null;
let pending = null;

function loadOptions() {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = request('/api/options', null, { method: 'GET' })
    .then((res) => {
      cache = res;
      pending = null;
      return cache;
    })
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

module.exports = { loadOptions };
