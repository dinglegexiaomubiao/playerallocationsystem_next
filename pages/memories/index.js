import { useState } from 'react';
import Head from 'next/head';
import MemoryComposer from '../../components/MemoryComposer';
import MemoryItem from '../../components/MemoryItem';
import useSession from '../../hooks/useSession';

/**
 * 群友回忆。
 *
 * ⚠ 本页**不要**再包一层 <Layout>：_app.js 已经全局包了，再包会出现两个 header。
 *
 * 版式：编辑式流式列表 —— 作者行 / 正文 / 九宫格 / 评论，条目之间一条细线。
 * 不套卡片、不做瀑布流：回忆的价值在「往下翻」，不是在首屏摆造型。
 *
 * 数据两条腿：首屏走 getServerSideProps（有没有登录都能直接看到内容，不用等接口），
 * 翻页和评论走客户端请求。
 */
export default function MemoriesPage({ initial, myPlayerId, canEditAll, loadError }) {
  const { me, ready } = useSession();
  const [items, setItems] = useState((initial && initial.memories) || []);
  const [total, setTotal] = useState((initial && initial.total) || 0);
  const [allTotal, setAllTotal] = useState((initial && initial.allTotal) || (initial && initial.total) || 0);
  const [tagStats, setTagStats] = useState((initial && initial.tags) || []);
  const [activeTag, setActiveTag] = useState((initial && initial.tag) || '');
  const [hasMore, setHasMore] = useState(!!(initial && initial.hasMore));
  const [cursor, setCursor] = useState((initial && initial.nextCursor) || null);
  const [loading, setLoading] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [err, setErr] = useState(loadError || '');

  const loadMore = async () => {
    if (loading || !cursor) return;
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ limit: '12', before: cursor });
      if (activeTag) qs.set('tag', activeTag);
      const r = await fetch(`/api/memories?${qs}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setErr(d.error || '没加载出来，再点一次');
        return;
      }
      setItems((prev) => [...prev, ...(d.memories || [])]);
      setHasMore(!!d.hasMore);
      setCursor(d.nextCursor || null);
      setTotal(d.total || 0);
    } catch {
      setErr('网络不太行，再点一次');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 切标签走客户端拉数据，不整页跳转：
   * 筛选只是换一屏照片，整页 SSR 会白闪一下、还会丢滚动位置之外的焦点。
   * URL 用 replaceState 同步，刷新和转发链接仍然能落在同一个筛选上。
   */
  const pickTag = async (tag) => {
    const next = !tag || tag === activeTag ? '' : tag;
    setFiltering(true);
    setErr('');
    try {
      const qs = new URLSearchParams({ limit: '12' });
      if (next) qs.set('tag', next);
      const r = await fetch(`/api/memories?${qs}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || '没筛出来');
      setItems(d.memories || []);
      setTotal(d.total || 0);
      setAllTotal(typeof d.allTotal === 'number' ? d.allTotal : d.total || 0);
      setHasMore(!!d.hasMore);
      setCursor(d.nextCursor || null);
      setTagStats(d.tags || []);
      setActiveTag(next);
      window.history.replaceState(
        window.history.state,
        '',
        next ? `/memories?tag=${encodeURIComponent(next)}` : '/memories'
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr((e && e.message) || '没筛出来，再点一次');
    } finally {
      setFiltering(false);
    }
  };

  /** 改完标签后同步筛选条上的计数（发布/编辑都可能改变某个标签的用量）。 */
  const refreshTags = async () => {
    try {
      const r = await fetch('/api/memories?limit=1', { cache: 'no-store' });
      const d = await r.json();
      if (d && d.success) {
        setTagStats(d.tags || []);
        if (typeof d.allTotal === 'number') setAllTotal(d.allTotal);
      }
    } catch {
      // 计数不准不影响主流程，静默就好
    }
  };

  const onCreated = (memory) => {
    // 当前在筛选状态时，新发的不一定属于这个标签 —— 先只在「全部」视图里插进去
    if (!activeTag) {
      setItems((prev) => [memory, ...prev]);
      setTotal((n) => n + 1);
      setAllTotal((n) => n + 1);
    } else {
      setTotal((n) => (memory.tags && memory.tags.includes(activeTag) ? n + 1 : n));
      setAllTotal((n) => n + 1);
      if (memory.tags && memory.tags.includes(activeTag)) setItems((prev) => [memory, ...prev]);
    }
    refreshTags();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onDeleted = () => {
    setTotal((n) => Math.max(0, n - 1));
    setAllTotal((n) => Math.max(0, n - 1));
    refreshTags();
  };

  return (
    <>
      <Head>
        <title>群友回忆 · LaRoja</title>
        <meta name="description" content="群友聚过的场合、翻过的盘、拍过的照片，都在这里。" />
      </Head>

      <main className="wrap mem-page">
        <header className="mem-head">
          <h1 className="mem-title">群友回忆</h1>
          <p className="mem-lede">
            聚过的饭、打过的比赛、谁的键盘冒过烟 —— 都值得留一张图。
          </p>
          <div className="mem-meta">
            <span className="mem-meta-n">{total}</span> {activeTag ? `条带着「${activeTag}」` : '条回忆'}
            <span className="mem-dot" aria-hidden="true">
              ·
            </span>
            照片最多 9 张，评论谁都能写
          </div>
        </header>

        {ready && me ? (
          <MemoryComposer onCreated={onCreated} />
        ) : (
          <p className="mem-guest">登录后可以发照片、写评论；不登录也能看。</p>
        )}

        {tagStats.length > 0 && (
          <nav className="mem-filter" aria-label="按标签筛选">
            <button
              type="button"
              className={'mem-fbtn' + (activeTag ? '' : ' is-on')}
              onClick={() => pickTag('')}
              disabled={filtering}
            >
              全部<em>{allTotal}</em>
            </button>
            {tagStats.map((t) => (
              <button
                key={t.tag}
                type="button"
                className={'mem-fbtn' + (activeTag === t.tag ? ' is-on' : '')}
                onClick={() => pickTag(t.tag)}
                disabled={filtering}
              >
                {t.tag}
                <em>{t.count}</em>
              </button>
            ))}
            {filtering && <span className="mem-filter-wait">筛…</span>}
          </nav>
        )}

        {err && <p className="mem-err mem-err-block">{err}</p>}

        {items.length === 0 ? (
          <p className="mem-empty">
            {activeTag ? `没有带「${activeTag}」的回忆。` : '还没有回忆。第一张照片，等你来放。'}
          </p>
        ) : (
          <div className="mem-feed">
            {items.map((m) => (
              <MemoryItem
                key={m.id}
                memory={m}
                me={me}
                myPlayerId={myPlayerId}
                isAdmin={!!(me && me.isAdmin)}
                canEditAll={canEditAll}
                activeTag={activeTag}
                onTag={pickTag}
                onDeleted={onDeleted}
                onTagsChange={refreshTags}
              />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mem-more">
            <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={loading}>
              {loading ? '翻…' : '再往前翻'}
            </button>
          </div>
        )}
      </main>
    </>
  );
}

export async function getServerSideProps(ctx) {
  try {
    const { listMemories, authorOfAccount, isMemoryEditor } = await import('../../lib/memories.mjs');
    const { getSession } = await import('../../lib/auth');
    const { toSerializable } = await import('../../lib/serialize.mjs');

    // ?tag= 直接进 SSR：刷新、转发链接都要能落在同一个筛选上，
    // 只在客户端过滤的话，别人打开链接看到的是全量。
    const session = getSession(ctx.req);
    // viewer 让每条回忆带上「我被单独指定改这一条」的标记（granted）
    const data = await listMemories({ limit: 12, tag: ctx.query.tag, viewer: (session && session.name) || '' });
    const mine = session ? await authorOfAccount(session.name) : null;
    // 站长指定的「哪条都能改」的校对名单：前端据此把编辑入口放出来，服务端还会再判一次
    const canEditAll = session ? await isMemoryEditor(session.name) : false;

    return {
      props: toSerializable({
        initial: data,
        myPlayerId: (mine && mine.playerId) || null,
        canEditAll,
        loadError: null,
      }),
    };
  } catch (e) {
    return {
      props: {
        initial: { memories: [], total: 0, allTotal: 0, tags: [], hasMore: false, nextCursor: null, tag: null },
        myPlayerId: null,
        canEditAll: false,
        loadError: (e && e.message) || '未知错误',
      },
    };
  }
}
