import { useState, useEffect, useCallback } from 'react';

/**
 * 统一的登录态来源。
 *
 * 页面上有多个组件需要知道「当前是谁」（导航栏、美食页的管理按钮、
 * 群友详情的 AI 按钮…）。它们各自去 fetch /api/auth/me 会各持一份
 * state，登出后无法同步。这里用 window 事件做跨组件广播：
 * 任何一处登出/刷新都会让所有订阅者重新拉一次。
 */

const SESSION_EVENT = 'dd:session-changed';

export default function useSession() {
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      const d = await r.json();
      setMe(d && d.loggedIn ? d : null);
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) load();
    };
    run();
    window.addEventListener(SESSION_EVENT, run);
    return () => {
      alive = false;
      window.removeEventListener(SESSION_EVENT, run);
    };
  }, [load]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/me', { method: 'DELETE' });
    } catch {
      /* 网络失败也当作已登出，清掉本地状态 */
    }
    setMe(null);
    setReady(true);
    window.dispatchEvent(new Event(SESSION_EVENT));
  }, []);

  return {
    me,
    ready,
    name: me ? me.name : null,
    isAdmin: !!(me && me.isAdmin),
    refresh: load,
    logout,
  };
}

export { SESSION_EVENT };
