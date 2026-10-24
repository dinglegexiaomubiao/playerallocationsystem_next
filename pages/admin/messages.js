import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiDelete, apiGet } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

/**
 * 留言管理。
 *
 * 这张表是「阵容分配」老工具的副产品：/main 页面上的留言板，谁都能发（不需要登录），
 * 但接口一直没有 DELETE —— 被刷屏时只能进库删。这里补上列表 + 批量删。
 *
 * 文案上要交代清楚它出现在哪：不写的话，光看「留言」两个字会以为是群友档案里的签名。
 */
export default function AdminMessagesPage({ denied }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/messages');
      setRows(Array.isArray(d) ? d : []);
      setPicked(new Set());
    } catch (e) {
      setFlash({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const stats = useMemo(() => {
    const likes = rows.reduce((n, r) => n + (r.likes || 0), 0);
    const longOne = rows.reduce((n, r) => Math.max(n, String(r.content || '').length), 0);
    return { total: rows.length, likes, longOne };
  }, [rows]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (r) => String(r.username || '').toLowerCase().includes(kw) || String(r.content || '').toLowerCase().includes(kw)
    );
  }, [rows, q]);

  const toggle = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPicked = list.length > 0 && list.every((r) => picked.has(r.id));

  const del = async (ids, label) => {
    const ok = window.confirm(
      ids.length === 1
        ? `删掉这条留言？\n\n${label}\n\n${ids.length} 条，删了找不回来。`
        : `删掉这 ${ids.length} 条留言？删了找不回来。`
    );
    if (!ok) return;
    setBusy(true);
    setFlash(null);
    try {
      const r = await apiDelete('/api/messages', { ids });
      setFlash({
        type: 'ok',
        text: `删了 ${r.deleted} 条${r.missing && r.missing.length ? `（${r.missing.length} 条已经被别人删了）` : ''}`,
      });
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <AdminDenied hint="留言板是管理员页面上的东西，删留言也需要管理员账号。" />;

  return (
    <AdminShell
      title="留言"
      accent="板"
      active="messages"
      lead="「阵容分配」页下面那块留言板。谁都能发、不用登录 —— 所以被刷屏时得有人能删。"
      preview={{ href: '/main', label: '看留言板' }}
      metrics={[
        { n: stats.total, label: '条留言' },
        { n: stats.likes, label: '个赞' },
        { n: stats.longOne, label: '最长一条字数' },
      ]}
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            刷新
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={picked.size === 0 || busy}
            onClick={() => del([...picked], '')}
          >
            删掉选中的 {picked.size || ''}
          </button>
        </>
      }
    >
      {flash && <div className={'adm-flash is-' + (flash.type === 'ok' ? 'ok' : 'err')}>{flash.text}</div>}

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜留言内容 / 昵称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="adm-tool-note">
          {list.length} / {rows.length}
        </span>
      </div>

      {loading ? (
        <div className="adm-empty">读着呢…</div>
      ) : list.length === 0 ? (
        <div className="adm-empty">{rows.length === 0 ? '留言板还是空的。' : '没有符合的留言。'}</div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allPicked}
                    onChange={() =>
                      setPicked(allPicked ? new Set() : new Set(list.map((r) => r.id)))
                    }
                    aria-label="全选"
                  />
                </th>
                <th style={{ width: 108 }}>时间</th>
                <th style={{ width: 110 }}>谁</th>
                <th>说了什么</th>
                <th className="is-num" style={{ width: 56 }}>
                  赞
                </th>
                <th style={{ width: 60 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`选中 ${r.username} 的留言`}
                    />
                  </td>
                  <td className="is-weak is-nowrap">{String(r.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                  <td className="is-strong">{r.username || '匿名'}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{r.content}</td>
                  <td className="is-num">{r.likes || 0}</td>
                  <td>
                    <div className="adm-ops">
                      <button
                        className="adm-link-btn"
                        style={{ color: 'var(--accent)' }}
                        onClick={() => del([r.id], `${r.username}：${r.content}`)}
                        disabled={busy}
                      >
                        删
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) return { redirect: { destination: '/login?from=/admin/messages', permanent: false } };
  return { props: { denied: !isAdmin(req) } };
}
