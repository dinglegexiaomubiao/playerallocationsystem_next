import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import QuoteForm from '../../components/QuoteForm';
import QuoteReviews from '../../components/QuoteReviews';
import useSession from '../../hooks/useSession';
import { groupByMonth, dateLabel } from '../../lib/quotes-view.mjs';

/**
 * 群友语录。
 *
 * ⚠ 本页**不要**再包一层 <Layout>：_app.js 已经全局包了，
 * 再包一次会渲染出两个 header、两个 footer（真踩过一次）。
 *
 * 版式上刻意不像「内容卡片列表」：语录是摘抄，用衬线字 + 左侧大引号，
 * 条目之间只用一条细线分隔，不套卡片。套了卡片之后每条都变成一个盒子，
 * 一屏只能看三条，而语录的价值恰恰在「一屏能扫过很多句」。
 *
 * 分组按收录月份（不是语录月份）—— 和排序依据保持一致，
 * 否则补录一条老语录会出现「同一屏里月份标签来回跳」。
 */
export default function QuotesPage({ initial, myPlayerId, loadError }) {
  const { me, ready } = useSession();
  const [quotes, setQuotes] = useState((initial && initial.quotes) || []);
  const [total, setTotal] = useState((initial && initial.total) || 0);
  const [people, setPeople] = useState((initial && initial.people) || 0);
  const [hasMore, setHasMore] = useState(!!(initial && initial.hasMore));
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [flashId, setFlashId] = useState('');

  const canDelete = (q) =>
    !!me && (me.isAdmin || (q.submittedBy && String(q.submittedBy.playerId) === String(myPlayerId)));

  const loadMore = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/quotes?offset=${quotes.length}&limit=30`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setErr(d.error || '没加载出来，再点一次');
        return;
      }
      setQuotes((prev) => [...prev, ...d.quotes]);
      setHasMore(!!d.hasMore);
      setTotal(d.total || 0);
      setPeople(d.people || 0);
    } catch {
      setErr('网络不太行，再点一次');
    } finally {
      setLoading(false);
    }
  };

  /**
   * onCreated 两种结果：
   *   新增成功   -> quote 有值，插到最前面
   *   重复       -> quote 为 null、给了已有 id，把它翻到眼前并闪一下
   * 重复不当失败处理 —— 收语录本来就会撞车，报错只会让人以为是自己错了。
   */
  const handleCreated = (quote, dupId) => {
    setErr('');
    const target = quote ? String(quote.id) : String(dupId || '');
    if (quote) {
      setQuotes((prev) => [quote, ...prev]);
      setTotal((n) => n + 1);
      setMsg('收好了');
    } else {
      setMsg('这句已经有了，就在下面');
    }
    setShowForm(false);
    setFlashId(target);
    setTimeout(() => {
      const el = document.getElementById('q-' + target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setTimeout(() => setFlashId(''), 2600);
  };

  const remove = async (q) => {
    if (!window.confirm('删掉这条？删了就找不回来了。')) return;
    setBusyId(q.id);
    setErr('');
    try {
      const r = await fetch('/api/quotes/' + q.id, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setErr(d.error || '没删掉，刷新一下再试');
        return;
      }
      setQuotes((prev) => prev.filter((x) => x.id !== q.id));
      setTotal((n) => Math.max(0, n - 1));
      setMsg('删掉了');
    } catch {
      setErr('网络不太行，再点一次');
    } finally {
      setBusyId('');
    }
  };

  const groups = groupByMonth(quotes);

  return (
    <>
      <Head>
        <title>群友语录 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <div className="hero-bar">
            <div className="hero-bar-main">
              <h1>
                群友<span className="hl">语录</span>
              </h1>
              <p>
                {total === 0
                  ? '一句都还没收 · 打游戏时随口说的话，有时候比攻略好看'
                  : `已收录 ${total} 句 · 涉及 ${people} 位群友 · 打游戏时随口说的话，有时候比攻略好看`}
              </p>
            </div>
            <div className="hero-actions">
              {ready && me ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowForm((v) => !v);
                    setMsg('');
                  }}
                >
                  {showForm ? '收起' : '+ 收一句'}
                </button>
              ) : ready ? (
                <Link href="/login?from=/quotes" className="btn btn-primary">
                  登录后收录
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {loadError && <p className="quote-form-error">语录没取出来：{loadError}</p>}
          {msg && <div className="adm-msg">{msg}</div>}
          {err && <p className="quote-form-error">{err}</p>}

          {showForm && <QuoteForm onCreated={handleCreated} onClose={() => setShowForm(false)} />}

          {groups.length === 0 ? (
            <div className="quote-empty">
              <p>还一句都没有。</p>
              <p className="quote-empty-hint">
                {me
                  ? '谁在群里说过什么让人记到现在的话？写下来就是第一条。'
                  : '登录之后就能收 —— 把群里那些让人记到现在的话留下来。'}
              </p>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <div className="quote-month" key={g.key}>
                  <h2 className="quote-month-label">{g.label}</h2>
                  {g.items.map((q) => (
                    <article
                      className={'quote-item' + (flashId === q.id ? ' is-flash' : '')}
                      id={'q-' + q.id}
                      key={q.id}
                    >
                      <p className="quote-text">{q.content}</p>
                      <footer className="quote-meta">
                        <span className="quote-from">
                          —
                          {q.source.type === 'player' ? (
                            <Link href={'/members/' + q.source.playerId} className="quote-who">
                              {q.source.nickname}
                            </Link>
                          ) : (
                            <span className="quote-who is-text">{q.source.text}</span>
                          )}
                        </span>
                        <time className="quote-when" dateTime={q.saidAt}>
                          {dateLabel(q.saidAt)}
                        </time>
                        {q.submittedBy && q.submittedBy.nickname && (
                          <span className="quote-by">由 {q.submittedBy.nickname} 收录</span>
                        )}
                        {canDelete(q) && (
                          <button
                            type="button"
                            className="quote-del"
                            onClick={() => remove(q)}
                            disabled={busyId === q.id}
                          >
                            {busyId === q.id ? '删…' : '删掉'}
                          </button>
                        )}
                      </footer>
                      <QuoteReviews
                        quoteId={q.id}
                        ratingAvg={q.ratingAvg}
                        ratingCount={q.ratingCount}
                        myPlayerId={myPlayerId}
                        isAdmin={!!(me && me.isAdmin)}
                      />
                    </article>
                  ))}
                </div>
              ))}

              {hasMore && (
                <div className="quote-more">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? '翻…' : '再看一批'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

export async function getServerSideProps(ctx) {
  try {
    const { listQuotes } = await import('../../lib/quotes.mjs');
    const { getSession } = await import('../../lib/auth');
    const { playerIdOfAccount } = await import('../../lib/guild.mjs');
    const { toSerializable } = await import('../../lib/serialize.mjs');

    const data = await listQuotes({ limit: 30, offset: 0 });
    const session = getSession(ctx.req);
    const mine = session ? await playerIdOfAccount(session.name) : null;

    return {
      // createdAt 在 lib 里已经转成 ISO 字符串，这里再包一层是防以后有人往 quote 里加 Date 字段
      props: toSerializable({
        initial: data,
        myPlayerId: mine ? String(mine) : null,
        loadError: null,
      }),
    };
  } catch (e) {
    return {
      props: {
        initial: { quotes: [], total: 0, people: 0, hasMore: false },
        myPlayerId: null,
        loadError: (e && e.message) || '未知错误',
      },
    };
  }
}
