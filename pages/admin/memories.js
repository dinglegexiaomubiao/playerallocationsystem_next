import { useCallback, useEffect, useState } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiDelete, apiGet } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

/**
 * 群友回忆管理。
 *
 * 这里没有审核队列（发出来就直接公开），后台要解决的是「删」：
 *   - 照片是公开可访问的，删错人比删错字严重，所以删除前把正文摘要打在确认框里；
 *   - 软删的也要列出来（灰一行 + 已删标记），否则管理员没法确认自己刚刚删掉了什么。
 */
const SUMMARY = 46;

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

export default function AdminMemoriesPage({ denied }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [deleted, setDeleted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/memories');
      if (d && d.success) {
        setRows(d.memories || []);
        setTotal(d.total || 0);
        setDeleted(d.deleted || 0);
      } else {
        setFlash({ type: 'err', text: (d && d.error) || '没读出来' });
      }
    } catch (e) {
      setFlash({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const drop = async (m) => {
    const tail = (m.content || '').slice(0, SUMMARY) || `（${m.photos.length} 张照片）`;
    if (!window.confirm(`删掉这条回忆？\n\n${m.author.name}：${tail}`)) return;
    setBusy(m.id);
    try {
      await apiDelete('/api/admin/memories', { id: m.id });
      await load();
      setFlash({ type: 'ok', text: '删了（软删，照片还在磁盘上）' });
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  if (denied) return <AdminDenied />;

  return (
    <AdminShell
      title="群友"
      accent="回忆"
      active="memories"
      lead="照片发出来即公开，这里只做删除"
      metrics={[
        { n: total, label: '未删' },
        { n: deleted, label: '已删', warn: deleted > 0 },
      ]}
      preview={{ href: '/memories', label: '去前台看看' }}
      actions={
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? '读着…' : '刷新'}
        </button>
      }
    >
      {flash && <p className={flash.type === 'err' ? 'adm-flash is-bad' : 'adm-flash'}>{flash.text}</p>}

      {!loading && rows.length === 0 ? (
        <p className="adm-empty">还没有人发回忆。</p>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th>照片</th>
                <th>作者</th>
                <th>正文</th>
                <th className="is-num">评论</th>
                <th className="is-nowrap">时间</th>
                <th className="is-nowrap">状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={m.deletedAt ? { opacity: 0.55 } : undefined}>
                  <td>
                    {m.photos.length ? (
                      <img
                        src={m.photos[0].url}
                        alt=""
                        style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4 }}
                      />
                    ) : (
                      <span className="is-weak">—</span>
                    )}
                  </td>
                  <td className="is-strong is-nowrap">{m.author.name}</td>
                  <td>
                    {(m.content || '').slice(0, SUMMARY) || <span className="is-weak">（只有照片）</span>}
                    {m.photos.length > 1 && (
                      <span className="is-weak"> ＋{m.photos.length - 1} 图</span>
                    )}
                  </td>
                  <td className="is-num">{m.commentCount}</td>
                  <td className="is-nowrap">{when(m.createdAt)}</td>
                  <td className="is-nowrap">
                    {m.deletedAt ? (
                      <span className="adm-chip is-bad">已删 {m.deletedBy || ''}</span>
                    ) : (
                      <span className="adm-chip is-ok">在线</span>
                    )}
                  </td>
                  <td className="adm-ops">
                    {!m.deletedAt && (
                      <button
                        className="adm-link-btn"
                        onClick={() => drop(m)}
                        disabled={busy === m.id}
                      >
                        {busy === m.id ? '删…' : '删掉'}
                      </button>
                    )}
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
  if (!session) return { redirect: { destination: '/login?from=/admin/memories', permanent: false } };
  return { props: { denied: !isAdmin(req) } };
}
