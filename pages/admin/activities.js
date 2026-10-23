import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPut, apiDelete } from '../../lib/api-client.mjs';
import { ACTIVITY_TYPES, activityTypeLabel } from '../../lib/options.mjs';

const TYPE_KEYS = ACTIVITY_TYPES.map((t) => t.key);
const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-strong, #ddd)',
  background: 'var(--bg-card, #fff)',
  color: 'var(--text, #222)',
  fontSize: 13,
};

// ISO → datetime-local 本地墙钟（编辑回填用）
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// 服务器墙钟文本截到分钟（列表显示用）
const fmtTs = (ts) => (ts ? String(ts).slice(0, 16).replace('T', ' ') : '—');

export default function AdminActivitiesPage({ denied }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/activities');
      setPosts((d && d.posts) || []);
    } catch (e) {
      setMsg({ type: 'err', text: '加载失败：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const stats = useMemo(() => {
    const total = posts.length;
    const open = posts.filter((p) => p.status === 'open' && !p.expired).length;
    const closed = posts.filter((p) => p.status === 'closed').length;
    const expired = posts.filter((p) => p.expired && p.status !== 'closed').length;
    return { total, open, closed, expired };
  }, [posts]);

  const filtered = useMemo(() => {
    if (filter === 'all') return posts;
    if (filter === 'open') return posts.filter((p) => p.status === 'open' && !p.expired);
    if (filter === 'closed') return posts.filter((p) => p.status === 'closed');
    if (filter === 'expired') return posts.filter((p) => p.expired && p.status !== 'closed');
    return posts;
  }, [posts, filter]);

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiPut('/api/admin/activities', {
        id: editing.id,
        title: editing.title,
        type: editing.type,
        status: editing.status,
        region: editing.region,
        location: editing.location,
        note: editing.note,
        need_people: editing.need_people,
        duration_min: editing.duration_min,
        // datetime-local（浏览器本地墙钟）→ 绝对瞬间
        meet_at: editing.meet_at_local ? new Date(editing.meet_at_local).toISOString() : null,
      });
      setMsg({ type: 'ok', text: '已保存' });
      setEditing(null);
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '保存失败：' + e.message });
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (p) => {
    const next = p.status === 'open' ? 'closed' : 'open';
    try {
      await apiPut('/api/admin/activities', { id: p.id, status: next });
      setMsg({ type: 'ok', text: next === 'closed' ? '已关闭' : '已重新开放' });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '操作失败：' + e.message });
    }
  };

  const remove = async (p) => {
    const n = p.signup_count || 0;
    if (
      !window.confirm(
        `确认删除这个活动？\n\n标题：${p.title || '未命名'}\n发起人：${p.account_name || '未知'}\n${n ? `已有 ${n} 人报名，会一起删除。\n` : ''}不可恢复。`
      )
    )
      return;
    try {
      await apiDelete('/api/admin/activities', { id: p.id });
      setMsg({ type: 'ok', text: '已删除' });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '删除失败：' + e.message });
    }
  };

  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问。
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }

  const statBox = (n, label, color) => (
    <div
      style={{
        background: 'var(--bg-card, #fff)',
        border: '1px solid var(--border, #e5e5e5)',
        borderRadius: 10,
        padding: '10px 18px',
        minWidth: 110,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text, #222)' }}>{n}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3, #888)' }}>{label}</div>
    </div>
  );

  return (
    <>
      <Head>
        <title>活动招募管理 · 后台 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <Link href="/admin" className="back-link">← 返回后台首页</Link>
          <h1 style={{ fontSize: '1.6rem' }}>活动招募管理</h1>
          <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3, #888)' }}>
            共 {filtered.length} 条｜这里可改任意字段 / 关帖 / 删帖；前台发起人仍只能操作自己的帖
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-bar">
            <div className="adm-tabs">
              <Link className="adm-tab" href="/admin/members">群友管理</Link>
              <Link className="adm-tab" href="/admin/food">美食管理</Link>
              <Link className="adm-tab" href="/admin/party">开黑管理</Link>
              <span className="adm-tab active">活动管理</span>
              <Link className="adm-tab" href="/main">阵容分配</Link>
              <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
              <Link className="adm-tab" href="/admin/support">群友反馈</Link>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {statBox(stats.total, '活动总数')}
            {statBox(stats.open, '招募中', '#1E8449')}
            {statBox(stats.closed, '已关闭', '#888')}
            {statBox(stats.expired, '已过期(未关)', '#B9770E')}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border-strong, #ddd)' }}
            >
              <option value="all">全部（{posts.length}）</option>
              <option value="open">招募中（{stats.open}）</option>
              <option value="closed">已关闭（{stats.closed}）</option>
              <option value="expired">已过期未关（{stats.expired}）</option>
            </select>
          </div>

          {msg && (
            <div
              className={msg.type === 'err' ? 'adm-error' : ''}
              style={{ marginBottom: 12, ...(msg.type !== 'err' ? { color: '#1E8449', fontSize: 13 } : {}) }}
            >
              {msg.text}
            </div>
          )}

          {loading ? (
            <div className="empty">加载中…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 42 }}>#</th>
                    <th>类型</th>
                    <th>标题</th>
                    <th>发起人</th>
                    <th>集合时间</th>
                    <th>地点</th>
                    <th>人数</th>
                    <th style={{ textAlign: 'right' }}>已约</th>
                    <th>状态</th>
                    <th style={{ width: 168 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3, #888)', padding: 30 }}>
                        没有符合条件的活动
                      </td>
                    </tr>
                  )}
                  {filtered.map((p, i) => (
                    <tr key={p.id} style={p.expired && p.status === 'open' ? { opacity: 0.75 } : undefined}>
                      <td>{i + 1}</td>
                      <td>{activityTypeLabel(p.type) || p.type}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>
                        {p.title || '未命名'}
                        {p.expired && p.status === 'open' ? (
                          <span style={{ marginLeft: 6, fontSize: 11, color: '#B9770E' }}>已过期</span>
                        ) : null}
                      </td>
                      <td>
                        {p.creator_nickname || p.account_name || '—'}
                        {p.account_name ? <span style={{ color: 'var(--text-3, #888)', fontSize: 11 }}> @{p.account_name}</span> : null}
                      </td>
                      <td>{fmtTs(p.meet_at_ts)}</td>
                      <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.location || ''}>
                        {p.location || '—'}
                      </td>
                      <td>{p.need_people || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{p.joined_people || 0}（{p.signup_count || 0}人）</td>
                      <td>{p.status === 'open' ? '招募中' : '已关闭'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="adm-link-btn" onClick={() => setEditing({ ...p, meet_at_local: toLocalInput(p.meet_at) })}>
                          编辑
                        </button>
                        <button className="adm-link-btn" onClick={() => toggleStatus(p)}>
                          {p.status === 'open' ? '关闭' : '重开'}
                        </button>
                        <button className="adm-link-btn adm-danger-btn" onClick={() => remove(p)}>
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ===== 编辑弹窗 ===== */}
      {editing && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card modal-card-sm">
            <div className="modal-head">
              <h3>编辑活动</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="modal-body" style={{ padding: '14px 22px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>标题</label>
                  <input
                    value={editing.title == null ? '' : editing.title}
                    maxLength={80}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>类型</label>
                  <select
                    value={editing.type || 'other'}
                    onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                    style={inputStyle}
                  >
                    {TYPE_KEYS.map((k) => (
                      <option key={k} value={k}>{activityTypeLabel(k)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>状态</label>
                  <select
                    value={editing.status || 'open'}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="open">招募中</option>
                    <option value="closed">已关闭</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>集合时间</label>
                  <input
                    type="datetime-local"
                    value={editing.meet_at_local || ''}
                    onChange={(e) => setEditing({ ...editing, meet_at_local: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>持续（分钟）</label>
                  <input
                    type="number"
                    min="15"
                    max="2880"
                    value={editing.duration_min == null ? '' : editing.duration_min}
                    onChange={(e) => setEditing({ ...editing, duration_min: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>需要人数</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={editing.need_people == null ? '' : editing.need_people}
                    onChange={(e) => setEditing({ ...editing, need_people: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>地区（国 省 市 区）</label>
                  <input
                    value={editing.region == null ? '' : editing.region}
                    maxLength={50}
                    onChange={(e) => setEditing({ ...editing, region: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>具体地点</label>
                  <input
                    value={editing.location == null ? '' : editing.location}
                    maxLength={80}
                    onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>备注</label>
                  <textarea
                    value={editing.note || ''}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/activities', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
