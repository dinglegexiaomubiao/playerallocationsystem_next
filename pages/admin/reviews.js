import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSession, isAdmin } from '../../lib/auth';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';
import { LIMITS } from '../../lib/moderation.mjs';

/**
 * 美食评价管理。
 *
 * 评价本来是前台「附在店下面」的东西：只能一条条去 /food 点 ×，删除入口还藏在
 * 展开的评论列表里。量少时够用，但一旦有人刷差评、或者要把群里聊出来的评价补上去，
 * 就得有张能搜、能按店筛、能代写的表。
 *
 * 「只有分数没有文字」的那批单独给个计数：群友围观时随手点星是最常见的半条评价，
 * 管理员看一眼就知道值不值得补一句。
 */
const STAR = (n) => {
  if (!n) return '—';
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
};

export default function AdminReviewsPage({ denied }) {
  const [data, setData] = useState({ reviews: [], foods: [], noContent: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [foodId, setFoodId] = useState('');
  const [editing, setEditing] = useState(null); // null | {新增/编辑}
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/reviews');
      setData({ reviews: d.reviews || [], foods: d.foods || [], noContent: d.noContent || 0 });
    } catch (e) {
      setFlash({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const { reviews, foods, noContent } = data;

  const stats = useMemo(() => {
    const shops = new Set(reviews.map((r) => r.foodId)).size;
    return { total: reviews.length, noContent, shops };
  }, [reviews, noContent]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return reviews.filter((r) => {
      if (foodId && r.foodId !== foodId) return false;
      if (!kw) return true;
      return (
        (r.foodName || '').toLowerCase().includes(kw) ||
        (r.reviewer || '').toLowerCase().includes(kw) ||
        (r.content || '').toLowerCase().includes(kw)
      );
    });
  }, [reviews, q, foodId]);

  const remove = async (r) => {
    const ok = window.confirm(
      `删掉这条评价？\n\n${r.foodName} · ${r.reviewer || '没留名'}\n${r.content || '（只打了分）'}\n\n删了就找不回来了。`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await apiDelete('/api/admin/reviews', { id: r.id });
      setFlash({ type: 'ok', text: '删掉了' });
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setFlash(null);
    try {
      if (editing.id) {
        await apiPut('/api/admin/reviews', {
          id: editing.id,
          reviewer: editing.reviewer,
          content: editing.content,
          rating: editing.rating,
        });
        setFlash({ type: 'ok', text: '改好了' });
      } else {
        await apiPost('/api/admin/reviews', {
          foodId: editing.foodId,
          reviewer: editing.reviewer,
          content: editing.content,
          rating: editing.rating,
        });
        setFlash({ type: 'ok', text: '补上了' });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <AdminDenied hint="评价要删要改，得用管理员账号。" />;

  return (
    <AdminShell
      title="美食"
      accent="评价"
      active="reviews"
      lead="群友吃完写的那句话。刷屏的、写错的、该补一条的，都在这张表里处理。"
      preview={{ href: '/food', label: '看美食页' }}
      metrics={[
        { n: stats.total, label: '条评价' },
        { n: stats.noContent, label: '只有打分没写字' },
        { n: stats.shops, label: '家店被评过' },
      ]}
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            刷新
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setEditing({ foodId: foods[0] ? foods[0].id : '', reviewer: '', content: '', rating: 4 })
            }
            disabled={foods.length === 0}
          >
            ＋ 补一条评价
          </button>
        </>
      }
    >
      {flash && <div className={'adm-flash is-' + (flash.type === 'ok' ? 'ok' : 'err')}>{flash.text}</div>}

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜店名 / 评价人 / 内容"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="adm-select" value={foodId} onChange={(e) => setFoodId(e.target.value)}>
          <option value="">全部店铺（{foods.length}）</option>
          {foods.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <span className="adm-tool-note">
          {list.length} / {reviews.length}
        </span>
      </div>

      {loading ? (
        <div className="adm-empty">读着呢…</div>
      ) : list.length === 0 ? (
        <div className="adm-empty">{reviews.length === 0 ? '还没有人写评价。' : '没有符合的评价。'}</div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th style={{ width: 170 }}>店</th>
                <th style={{ width: 62 }}>分</th>
                <th style={{ width: 96 }}>谁写的</th>
                <th>内容</th>
                <th style={{ width: 96 }}>时间</th>
                <th style={{ width: 86 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="is-strong">
                    <Link href="/food" style={{ color: 'inherit' }}>
                      {r.foodName}
                    </Link>
                  </td>
                  <td className="is-nowrap" title={r.rating ? r.rating + ' 分' : '没打分'}>
                    {r.rating ? <span style={{ color: 'var(--gold)' }}>{STAR(r.rating)}</span> : <span className="is-weak">—</span>}
                  </td>
                  <td className="is-weak">{r.reviewer || '没留名'}</td>
                  <td>
                    {r.content || <span className="adm-chip">只打了分</span>}
                  </td>
                  <td className="is-weak is-nowrap">{String(r.createdAt || '').slice(0, 10)}</td>
                  <td>
                    <div className="adm-ops">
                      <button className="adm-link-btn" onClick={() => setEditing({ ...r })}>
                        编辑
                      </button>
                      <button
                        className="adm-link-btn"
                        style={{ color: 'var(--accent)' }}
                        onClick={() => remove(r)}
                        disabled={busy}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3>{editing.id ? '改评价' : '补一条评价'}</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {!editing.id && (
                <div className="adm-field">
                  <label className="adm-label">哪家店</label>
                  <select
                    className="adm-input"
                    value={editing.foodId || ''}
                    onChange={(e) => setEditing({ ...editing, foodId: e.target.value })}
                  >
                    {foods.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="adm-field">
                <label className="adm-label">谁说的（群昵称，留空就当没留名）</label>
                <input
                  className="adm-input"
                  value={editing.reviewer || ''}
                  onChange={(e) => setEditing({ ...editing, reviewer: e.target.value })}
                />
                <div className="adm-input-hint">代群友补的时候写清是谁，别让人以为是匿名黑评。</div>
              </div>
              <div className="adm-field">
                <label className="adm-label">打几分</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={'btn btn-sm ' + (editing.rating === n ? 'btn-primary' : 'btn-ghost')}
                      onClick={() => setEditing({ ...editing, rating: editing.rating === n ? null : n })}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="adm-tool-note" style={{ alignSelf: 'center', marginLeft: 4 }}>
                    {editing.rating ? STAR(editing.rating) : '不打分也行'}
                  </span>
                </div>
              </div>
              <div className="adm-field">
                <label className="adm-label">
                  内容（最多 {LIMITS.review} 字，{String(editing.content || '').length}）
                </label>
                <textarea
                  className="adm-input"
                  rows={4}
                  value={editing.content || ''}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                算了
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? '存着…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) return { redirect: { destination: '/login?from=/admin/reviews', permanent: false } };
  return { props: { denied: !isAdmin(req) } };
}
