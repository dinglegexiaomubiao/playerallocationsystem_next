/**
 * 前端统一的请求封装：超时 + 可读的错误信息。
 *
 * 站内所有「要等云端返回」的操作（报名、保存赛事、同步头像、增删队伍…）
 * 都应该走这里，理由：
 *   1. fetch 默认没有超时，网差的时候按钮会一直转圈，用户不知道发生了什么；
 *   2. 后端返回的错误信息在 body 里，非 2xx 时 fetch 不会抛，容易被静默吞掉。
 *
 * 约定：成功返回解析后的 JSON；失败抛 Error，message 直接可以拿去 toast。
 */

export const DEFAULT_TIMEOUT = 15000;

export class TimeoutError extends Error {
  constructor(message = '请求超时，请检查网络后重试') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function apiFetch(url, options = {}) {
  const { method = 'GET', body, timeout = DEFAULT_TIMEOUT, headers = {}, signal: outerSignal } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeout);

  // 外部如果传了 signal，两个一起生效
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', () => controller.abort(outerSignal.reason), { once: true });
  }

  const finalHeaders = { ...headers };
  let payload;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
    }
  }

  try {
    const res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: payload,
      signal: controller.signal,
      credentials: 'same-origin',
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }

    if (!res.ok) {
      const msg =
        (json && (json.error || json.message)) ||
        (res.status === 401 ? '请先登录' : res.status === 403 ? '没有权限执行此操作' : `请求失败（${res.status}）`);
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new TimeoutError();
    }
    if (error && error.name === 'TypeError') {
      // fetch 层面失败：断网、DNS、跨域等
      throw new Error('网络连接失败，请检查网络后重试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const apiGet = (url, options) => apiFetch(url, { ...options, method: 'GET' });
export const apiPost = (url, body, options) => apiFetch(url, { ...options, method: 'POST', body });
export const apiPut = (url, body, options) => apiFetch(url, { ...options, method: 'PUT', body });
export const apiDelete = (url, body, options) => apiFetch(url, { ...options, method: 'DELETE', body });
