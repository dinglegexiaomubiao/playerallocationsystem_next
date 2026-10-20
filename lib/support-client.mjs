/**
 * 前端异常采集：把「加载失败 / 超时 / 一直转圈 / JS 报错」自动写进售后表。
 *
 * 设计取舍：
 *   - 用包一层 window.fetch 的方式抓网络问题，因为各页面有的走 apiFetch、有的裸 fetch，
 *     只有在这一层才能一网打尽；
 *   - 同一类问题在同一个会话里只报一次（signature 去重），每页最多 6 条，
 *     否则用户网络一抖就会把表刷满；
 *   - 上报本身用 keepalive，页面正在跳转/关闭也能发出去；
 *   - 任何情况下都不抛异常、不打扰用户 —— 采集失败就静默放弃。
 *
 * 隐私：只上报排查必需的字段（接口、状态码、耗时、错误名、UA、页面地址），
 * 不碰 cookie、不碰请求体、不碰 localStorage。
 */

const ENDPOINT = '/api/support';
const MAX_PER_PAGE = 6;
const SLOW_MS = 12000; // 超过这个耗时的成功请求也记一笔，便于定位「慢到以为没加载」
const STUCK_CHECK_MS = 8000; // 8 秒后页面还在「加载中…」就认为卡住了

let installed = false;
let sentCount = 0;
const seen = new Set();

function signature(category, extra, message) {
  // 带上错误内容的前 60 个字符：否则同一页面里所有 JS 报错会共用一个签名，
  // 只剩第一条能上报，后面的都被当成重复丢掉
  return `${category}|${extra || ''}|${String(message || '').slice(0, 60)}`;
}

function clip(s, n = 500) {
  if (s === null || s === undefined) return null;
  return String(s).slice(0, n);
}

/** 主动上报一条（feedback = 用户提交，error = 自动采集）。永不抛异常。 */
export function submitReport(payload, { keepalive = true } = {}) {
  try {
    const body = JSON.stringify({
      kind: payload.kind || 'feedback',
      category: payload.category || null,
      message: clip(payload.message, 4000),
      contact: payload.contact || null,
      page_url: typeof location !== 'undefined' ? location.href : null,
      detail: payload.detail || null,
    });
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive,
      credentials: 'same-origin',
    })
      .then((r) => r.json().catch(() => ({})))
      .catch(() => ({ success: false }));
  } catch (e) {
    return Promise.resolve({ success: false });
  }
}

function autoReport(category, message, detail) {
  if (typeof window === 'undefined') return;
  if (sentCount >= MAX_PER_PAGE) return;
  const sig = signature(category, detail && (detail.api || detail.errorName || ''), message);
  if (seen.has(sig)) return;
  seen.add(sig);
  sentCount += 1;
  submitReport({
    kind: 'error',
    category,
    message,
    detail: {
      ...detail,
      page: location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      online: navigator.onLine,
    },
  });
}

function shouldIgnore(url) {
  if (!url) return true;
  // 自己上报自己 = 死循环
  if (url.indexOf(ENDPOINT) !== -1) return true;
  // 头像/英雄图标这类静态资源失败不值得我们打电话叫醒自己
  if (/\/api\/(avatar|hero-icon)/.test(url)) return true;
  return false;
}

/**
 * 装上全局采集。只能在浏览器里调用，重复调用无副作用。
 */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // --- 1. JS 运行时错误 ---
  window.addEventListener('error', (ev) => {
    // 资源加载失败（img/script）也会触发 error，但没有 message，用 target 区分
    if (ev && ev.target && ev.target !== window && ev.target.tagName) {
      const tag = ev.target.tagName.toLowerCase();
      if (tag !== 'script' && tag !== 'link') return;
      autoReport('resource', `${tag} 加载失败：${ev.target.src || ev.target.href || ''}`, {
        api: clip(ev.target.src || ev.target.href, 300),
      });
      return;
    }
    const err = ev && ev.error;
    autoReport(
      'js',
      (err && err.message) || ev.message || 'JavaScript 运行时错误',
      {
        errorName: (err && err.name) || 'Error',
        stack: clip((err && err.stack) || '', 800),
        source: clip(ev.filename, 200),
        line: ev.lineno,
      }
    );
  }, true);

  // --- 2. 未处理的 Promise 异常 ---
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev && ev.reason;
    const msg = (r && (r.message || r.toString())) || '未捕获的异步异常';
    autoReport('js', msg, {
      errorName: (r && r.name) || 'UnhandledRejection',
      stack: clip((r && r.stack) || '', 800),
    });
  });

  // --- 3. 网络层：包一层 fetch ---
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = async function patchedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const started = Date.now();
      try {
        const res = await origFetch.apply(this, arguments);
        const ms = Date.now() - started;

        if (!shouldIgnore(url)) {
          // 5xx 一定是我们的问题；401/403 是权限，不算故障
          if (res.status >= 500) {
            autoReport('http', `接口 ${res.status}：${url}`, { api: url, method, status: res.status, durationMs: ms });
          } else if (res.ok && method === 'GET' && ms > SLOW_MS) {
            autoReport('slow', `接口响应很慢（${(ms / 1000).toFixed(1)}s）：${url}`, {
              api: url,
              method,
              status: res.status,
              durationMs: ms,
            });
          }
        }
        return res;
      } catch (err) {
        const ms = Date.now() - started;
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        if (!shouldIgnore(url)) {
          autoReport(
            aborted ? 'timeout' : 'network',
            aborted
              ? `请求超时（${(ms / 1000).toFixed(1)}s）：${url}`
              : `网络请求失败：${url}（${(err && err.message) || '未知原因'}）`,
            {
              api: url,
              method,
              durationMs: ms,
              errorName: (err && err.name) || 'TypeError',
              message: clip((err && err.message) || '', 300),
            }
          );
        }
        throw err;
      }
    };
  }

  // --- 4. 一直转圈：页面 8 秒后还停在「加载中」就报一笔 ---
  window.setTimeout(() => {
    try {
      const txt = (document.body && document.body.innerText) || '';
      if (/加载中|Loading/.test(txt)) {
        autoReport('stuck', `页面 ${location.pathname} 超过 ${STUCK_CHECK_MS / 1000}s 仍在加载中`, {
          hint: '可能是接口一直没返回，或返回后渲染失败',
        });
      }
    } catch (e) {
      /* 忽略 */
    }
  }, STUCK_CHECK_MS);
}

/** 给反馈表单用：当前页面的只读环境信息，展示给用户看，让他知道会附带什么 */
export function clientEnv() {
  if (typeof navigator === 'undefined') return { platform: '', ua: '' };
  const ua = navigator.userAgent || '';
  let os = '未知系统';
  if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10/11';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let br = '未知浏览器';
  if (/MicroMessenger/i.test(ua)) br = '微信内置浏览器';
  else if (/\bQQ\//.test(ua)) br = 'QQ 内置浏览器';
  else if (/Edg\//.test(ua)) br = 'Edge';
  else if (/Firefox\//.test(ua)) br = 'Firefox';
  else if (/Chrome\//.test(ua)) br = 'Chrome';
  else if (/Safari\//.test(ua)) br = 'Safari';
  return { platform: `${os} · ${br}`, ua };
}
