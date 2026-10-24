import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPut, apiDelete } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';
import { LIMITS } from '../../lib/moderation.mjs';

/**
 * 群友语录管理。
 *
 * 这里**没有审核队列**：提交时就过了本地词表 + DeepSeek 复审，通过即上线。
 * 后台要解决的是另外两件事 ——
 *   1. 改错字（「按大招」写成「按大找」这种，收录人自己未必发现）
 *   2. 删越界的（审核只拦违法违规，拦不住「让人不舒服」）
 *
 * 出处是群友的那类不允许在这里改成自定义文字：改了会丢掉链接和头像，
 * 变成一条指向不明的语录。要换出处只能删了重收 —— 这句提示要写在界面上。
 */
const PAGE = 100;

export default function AdminQuotesPage({ denied }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [people, setPeople] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet(`/api/quotes?limit=${PAGE}`);
      setRows(d.quotes || []);
      setTotal(d.total || 0);
      setPeople(d.people || 0);
      setFlash(null);
    } catch (e) {
      setFlash({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const monthCount = useMemo(() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return rows.filter((r) => {
      // createdAt 是 ISO（UTC），要先落回本地时区再比月份，否则月底那几条会算错月
      const t = new Date(r.createdAt);
      if (Number.isNaN(t.getTime())) return false;
      const local = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
      return local === key;
    }).length;
  }, [rows]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => {
      const src = r.source.type === 'player' ? r.source.nickname : r.source.text;
      return (
        String(r.content || '').toLowerCase().includes(kw) ||
        String(src || '').toLowerCase().includes(kw) ||
        String(r.submittedBy?.nickname || '').toLowerCase().includes(kw)
      );
    });
  }, [rows, q]);

  const save = async () => {
    if (!editing) return;
    if (!String(editing.content || '').trim()) {
      setFlash({ type: 'err', text: '内容不能空着' });
      return;
    }
    if (editing.source.type === 'text' && !String(editing.sourceText || '').trim()) {
      setFlash({ type: 'err', text: '出处不能空着 —— 不知道谁说的就没法当语录' });
      return;
    }
    setBusy(true);
    try {
      await apiPut('/api/quotes/' + editing.id, {
        content: editing.content,
        saidAt: editing.saidAt,
        sourceText: editing.source.type === 'text' ? editing.sourceText : undefined,
      });
      setEditing(null);
      // 注意顺序：load() 内部会把 flash 清成 null，所以提示必须放在它之后
      await load();
      setFlash({ type: 'ok', text: '改好了' });
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const del = async (r) => {
    const src = r.source.type === 'player' ? r.source.nickname : r.source.text;
    if (!window.confirm(`删掉这条？\n\n「${r.content}」\n— ${src}\n\n删了找不回来。`)) return;
    setBusy(true);
    try {
      await apiDelete('/api/quotes/' + r.id);
      await load();
      setFlash({ type: 'ok', text: '删了' });
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <AdminDenied hint="删语录、改错字需要管理员账号。" />;

  return (
    <AdminShell
      title="群友"
      accent="语录"
      active="quotes"
      lead="前台「群友语录」页收进来的话。提交时就过了词表和 AI 复审，这里主要改错字、删不合适的。"
      preview={{ href: '/quotes', label: '看语录页' }}
      metrics={[
        { n: total, label: '句' },
        { n: people, label: '位群友被引用' },
        { n: monthCount, label: '本月新增' },
      ]}
      actions={
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          刷新
        </button>
      }
    >
      {flash && (
        <div className={'adm-flash is-' + (flash.type === 'ok' ? 'ok' : 'err')}>{flash.text}</div>
      )}

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜内容 / 出处 / 收录人"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="adm-tool-note">
          {list.length} / {rows.length}
          {total > rows.length ? `（只显示最近 ${rows.length} 条）` : ''}
        </span>
      </div>

      {loading ? (
        <div className="adm-empty">读着呢…</div>
      ) : list.length === 0 ? (
        <div className="adm-empty">{rows.length === 0 ? '还一句都没有。' : '没有符合的语录。'}</div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th>说了什么</th>
                <th style={{ width: 130 }}>谁说的</th>
                <th style={{ width: 100 }}>说的日期</th>
                <th style={{ width: 100 }}>收录时间</th>
                <th style={{ width: 92 }}>收录人</th>
                <th style={{ width: 76 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const src = r.source.type === 'player' ? r.source.nickname : r.source.text;
                return (
                  <tr key={r.id}>
                    <td style={{ maxWidth: 420 }}>
                      <span title={r.content}>{r.content}</span>
                    </td>
                    <td className={r.source.type === 'player' ? 'is-strong' : 'is-weak'}>
                      {src}
                    </td>
                    <td className="is-weak is-nowrap">{r.saidAt}</td>
                    <td className="is-weak is-nowrap">{String(r.createdAt || '').slice(0, 10)}</td>
                    <td className="is-weak">{r.submittedBy?.nickname || '—'}</td>
                    <td>
                      <div className="adm-ops">
                        <button
                          className="adm-link-btn"
                          onClick={() =>
                            setEditing({
                              ...r,
                              sourceText: r.source.type === 'text' ? r.source.text : '',
                            })
                          }
                        >
                          改
                        </button>
                        <button
                          className="adm-link-btn"
                          style={{ color: 'var(--accent)' }}
                          onClick={() => del(r)}
                          disabled={busy}
                        >
                          删
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div
          className="modal-mask"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 520 }} role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>改这一条</h3>
              <button className="modal-close" onClick={() => setEditing(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="adm-field">
                <label className="adm-label">
                  说了什么（{String(editing.content || '').length}/{LIMITS.quote}）
                </label>
                <textarea
                  className="adm-input"
                  rows={4}
                  maxLength={LIMITS.quote}
                  value={editing.content || ''}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                />
              </div>
              <div className="adm-field">
                <label className="adm-label">说的日期</label>
                <input
                  className="adm-input"
                  type="date"
                  value={editing.saidAt || ''}
                  onChange={(e) => setEditing({ ...editing, saidAt: e.target.value })}
                />
              </div>
              <div className="adm-field">
                <label className="adm-label">谁说的</label>
                {editing.source.type === 'player' ? (
                  <div className="adm-input-hint">
                    这条挂在群友「{editing.source.nickname}」身上，要换人只能删了让对方重收 ——
                    改成文字会把链接和头像弄丢。
                  </div>
                ) : (
                  <input
                    className="adm-input"
                    value={editing.sourceText || ''}
                    maxLength={LIMITS.quoteSource}
                    onChange={(e) => setEditing({ ...editing, sourceText: e.target.value })}
                  />
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                算了
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? '存着…' : '存'}
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
  if (!session) return { redirect: { destination: '/login?from=/admin/quotes', permanent: false } };
  return { props: { denied: !isAdmin(req) } };
}
