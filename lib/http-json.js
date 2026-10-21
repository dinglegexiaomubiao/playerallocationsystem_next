import http from 'node:http';
import https from 'node:https';

/**
 * 极简 JSON 请求（node:https 直连）。
 *
 * 不用 global fetch 的原因：Next 会给 fetch 打补丁（缓存/去重），
 * 之前排查 AI 分析卡死时踩过一次，外部数据源统一走这里更可控，
 * 而且能自己定死超时——外站挂了不应该把我们的接口一起拖住。
 */
export function fetchJson(url, { timeoutMs = 12000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      reject(new Error('地址不合法：' + url));
      return;
    }

    const transport = u.protocol === 'http:' ? http : https;
    const req = transport.get(
      {
        host: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        headers: { Accept: 'application/json', 'User-Agent': 'laroja-site/1.0 (+community site)' },
      },
      (res) => {
        // 外站偶发跳转，跟一次
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          fetchJson(next, { timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
          return;
        }

        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`上游返回 ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error('上游返回的不是合法 JSON'));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`));
    });
    req.on('error', (e) => reject(new Error(e.message || '网络错误')));
  });
}
