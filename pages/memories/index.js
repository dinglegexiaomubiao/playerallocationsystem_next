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
  const [hasMore, setHasMore] = useState(!!(initial && initial.hasMore));
  const [cursor, setCursor] = useState((initial && initial.nextCursor) || null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(loadError || '');

  const loadMore = async () => {
    if (loading || !cursor) return;
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/memories?limit=12&before=${encodeURIComponent(cursor)}`, {
        cache: 'no-store',
      });
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

  const onCreated = (memory) => {
    setItems((prev) => [memory, ...prev]);
    setTotal((n) => n + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onDeleted = () => {
    setTotal((n) => Math.max(0, n - 1));
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
            <span className="mem-meta-n">{total}</span> 条回忆
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

        {err && <p className="mem-err mem-err-block">{err}</p>}

        {items.length === 0 ? (
          <p className="mem-empty">还没有回忆。第一张照片，等你来放。</p>
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
                onDeleted={onDeleted}
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

    const data = await listMemories({ limit: 12 });
    const session = getSession(ctx.req);
    const mine = session ? await authorOfAccount(session.name) : null;
    // 站长指定的「可以改别人文案」的人：前端据此把编辑入口放出来，服务端还会再判一次
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
        initial: { memories: [], total: 0, hasMore: false, nextCursor: null },
        myPlayerId: null,
        canEditAll: false,
        loadError: (e && e.message) || '未知错误',
      },
    };
  }
}
