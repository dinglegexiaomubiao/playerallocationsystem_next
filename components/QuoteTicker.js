import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { tickerText } from '../lib/quotes-view.mjs';

/**
 * 底部语录悬浮栏（全站，挂在 _app 里）。
 *
 * 几个必须照顾到的点：
 *
 * 1. **右下角已经有反馈浮球**（.fb-fab，fixed bottom:20px）。通栏贴底会正好压住
 *    它的位置和语录栏的关闭按钮。所以整条栏的高度写进 CSS 变量 --quote-bar-h，
 *    浮球和它的面板都用 calc(原有 bottom + 这个变量) 让位。栏关掉时变量归零，
 *    浮球自己落回去。
 * 2. **关闭要记，但不能永久记**。永久记住等于新语录再也触达不了关过的人。
 *    这里存关闭时刻，14 天后重新出现一次。
 * 3. **随机顺序必须在客户端算**。服务端随机会让 SSR 文本和 hydration 文本对不上
 *    （React 会整段重渲染并告警），而且 ticker 接口有 60 秒缓存，服务端打乱也没意义。
 * 4. **少于 3 条不显示**。一两条语录来回轮播，反而让人觉得站很空。
 * 5. 语录页自己不显示 —— 用户正在看语录，底部再滚一遍同样的内容只是打扰。
 */

const KEY = 'laroja-quotes-bar';
const TTL = 14 * 24 * 60 * 60 * 1000; // 关掉后 14 天再出现
const PERIOD = 7000;
const BAR_H = 48;
const BAR_H_MOBILE = 52;

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const closedRecently = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const t = Number(raw);
    return Number.isFinite(t) && t > 0 && Date.now() - t < TTL;
  } catch {
    return false;
  }
};

export default function QuoteTicker() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);
  const itemsRef = useRef([]);
  const lastId = useRef('');

  const path = router.pathname || '';
  const skip =
    path === '/quotes' ||
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/admin');

  // 拉数据：延迟 800ms，不跟首屏抢带宽
  useEffect(() => {
    if (skip) return undefined;
    if (typeof window === 'undefined' || closedRecently()) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/quotes/ticker');
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        const list = (d.quotes || []).filter((q) => q && q.content);
        if (list.length < 3) return;
        const first = shuffle(list);
        itemsRef.current = first;
        lastId.current = first[0].id;
        setItems(first);
        setIdx(0);
        setShow(true);
      } catch {
        /* 语录栏是锦上添花，拉不到就整条不出现 */
      }
    }, 800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [skip]);

  // 高度写进变量，反馈浮球靠它让位
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    if (!show) {
      root.style.removeProperty('--quote-bar-h');
      return undefined;
    }
    const h = window.innerWidth <= 640 ? BAR_H_MOBILE : BAR_H;
    root.style.setProperty('--quote-bar-h', h + 'px');
    return () => root.style.removeProperty('--quote-bar-h');
  }, [show]);

  // 轮播：一轮放完重新洗牌，且保证洗牌后第一条不是刚放完的那条
  useEffect(() => {
    if (!show) return undefined;
    let i = 0;
    const timer = setInterval(() => {
      const list = itemsRef.current;
      if (list.length < 2) return;
      i += 1;
      if (i >= list.length) {
        const next = shuffle(list);
        if (next.length > 1 && next[0].id === lastId.current) {
          next.push(next.shift());
        }
        itemsRef.current = next;
        setItems(next);
        i = 0;
      }
      const cur = itemsRef.current[i];
      if (cur) lastId.current = cur.id;
      setIdx(i);
    }, PERIOD);
    return () => clearInterval(timer);
  }, [show]);

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* 隐私模式下写不进去，下次还会出现，可以接受 */
    }
  };

  if (!show || !items.length) return null;
  const cur = items[idx] || items[0];
  if (!cur) return null;
  const label = cur.source.type === 'player' ? cur.source.nickname : cur.source.text;

  return (
    <aside className="quote-ticker" aria-label="群友语录">
      <div className="wrap quote-ticker-inner">
        <span className="quote-ticker-label">群友语录</span>
        <Link href="/quotes" className="quote-ticker-body">
          <span className="quote-ticker-line" key={cur.id}>
            <span className="quote-ticker-text">{tickerText(cur.content)}</span>
            <span className="quote-ticker-from">— {label}</span>
          </span>
        </Link>
        <button type="button" className="quote-ticker-x" onClick={close} aria-label="关闭语录栏">
          ×
        </button>
      </div>
    </aside>
  );
}
