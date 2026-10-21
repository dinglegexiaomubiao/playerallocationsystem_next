import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPut, apiDelete } from '../../lib/api-client.mjs';
import { PARTY_STATUS } from '../../lib/options.mjs';

const STATUS_KEYS = Object.keys(PARTY_STATUS);

function issuesOf(p) {
  const out = [];
  if (!p.play_time) out.push({ t: '缺时间', lv: 'mid' });
  if (!p.account_name) out.push({ t: '缺发起人', lv: 'mid' });
  if (!p.want_score_min && !p.want_score_max && !p.want_rank) out.push({ t: '无组队要求', lv: 'low' });
  return out;
}

const TAG_COLOR = {
  mid: { bg: '#FEF4E6', fg: '#B9770E', bd: '#F8DCB4' },
  low: { bg: '#F1F2F4', fg: '#6B7280', bd: '#E3E5E8' },
};

function Tag({ children, lv = 'mid' }) {
  const c = TAG_COLOR[lv] || TAG_COLOR.mid;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        marginRight: 5,
        borderRadius: 5,
        fontSize: 11,
        lineHeight: '18px',
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const EDIT_FIELDS = [
  { k: 'mode', label: '模式', ph: '普通 / 排位 / 中单…' },
  { k: 'account_name', label: '发起账号', ph: '登录账号名' },
  { k: 'my_score', label: '我的天梯分', type: 'number' },
  { k: 'my_rank', label: '我的段位', ph: '万古 / 超凡…' },
  { k: 'want_score_min', label: '期望最低分', type: 'number' },
  { k: 'want_score_max', label: '期望最高分', type: 'number' },
  { k: 'want_rank', label: '期望段位', ph: '不限 / 传奇以上' },
  { k: 'play_time', label: '开黑时间', ph: '今晚 20:00 起' },
  { k: 'voice_app', label: '语音软件', ph: 'KOOK / 微信' },
];

const AREA_FIELDS = [
  { k: 'my_positions', label: '我的位置' },
  { k: 'want_positions', label: '期望位置' },
  { k: 'note', label: '备注' },
];

export default function AdminPartyPage({ denied }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/party');
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
    const open = posts.filter((p) => p.status === 'open').length;
    const closed = posts.filter((p) => p.status === 'closed').length;
    const withSign = posts.filter((p) => (p.signup_count || 0) > 0).length;
    return { total, open, closed, withSign };
  }, [posts]);

  const filtered = useMemo(() => {
    if (filter === 'all') return posts;
    return posts.filter((p) => p.status === filter);
  }, [posts, filter]);

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiPut('/api/admin/party', {
        id: editing.id,
        mode: editing.mode,
        account_name: editing.account_name,
        my_score: editing.my_score,
        my_rank: editing.my_rank,
        my_positions: editing.my_positions,
        want_score_min: editing.want_score_min,
        want_score_max: editing.want_score_max,
        want_rank: editing.want_rank,
        want_positions: editing.want_positions,
        play_time: editing.play_time,
        voice_app: editing.voice_app,
        has_voice: editing.has_voice,
        note: editing.note,
        status: editing.status,
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

  const remove = async (p) => {
    const n = p.signup_count || 0;
    if (!window.confirm(`确认删除这张开黑卡？\n\n发起人：${p.account_name || '未知'}\n模式：${p.mode}\n${n ? `已有 ${n} 人报名，会一起删除。\n` : ''}不可恢复。`)) return;
    try {
      await apiDelete('/api/admin/party', { id: p.id });
      setMsg({ type: 'ok', text: '已删除' });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '删除失败：' + e.message });
    }
  };

  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }

  const statBox = (n, label, color) => (
    <div
      key={label}
      style={{
        flex: '1 1 130px',
        background: '#fff',
        border: '1px solid var(--border, #e5e5e5)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: color || 'inherit' }}>{n}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 2 }}>{label}</div>
    </div>
  );

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border-strong, #ddd)',
    borderRadius: 8,
    fontSize: 14,
  };

  return (
    <>
      <Head>
        <title>开黑管理 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>
            开黑<span className="hl">管理</span>
          </h1>
          <p>组队卡片维护 · 状态调整 · 增删改查</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-tabs" style={{ marginBottom: 16 }}>
            <Link className="adm-tab" href="/admin">赛事管理</Link>
            <Link className="adm-tab" href="/admin/members">群友管理</Link>
            <Link className="adm-tab" href="/admin/food">美食管理</Link>
            <span className="adm-tab active">开黑管理</span>
            <Link className="adm-tab" href="/main">阵容分配</Link>
            <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
            <Link className="adm-tab" href="/admin/support">群友反馈</Link>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {statBox(stats.total, '卡片总数')}
            {statBox(stats.open, '招募中', '#1E8449')}
            {statBox(stats.closed, '已关闭', '#888')}
            {statBox(stats.withSign, '有人报名')}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border-strong, #ddd)' }}
            >
              <option value="all">全部（{posts.length}）</option>
              {STATUS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PARTY_STATUS[k].label}（{posts.filter((p) => p.status === k).length}）
                </option>
              ))}
            </select>
          </div>

          {msg && (
            <div
              className={msg.type === 'err' ? 'adm-error' : ''}
              style={msg.type === 'err' ? { marginBottom: 12 } : { marginBottom: 12, color: '#1E8449', fontSize: 13 }}
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
                    <th>模式</th>
                    <th>发起人</th>
                    <th>我的</th>
                    <th>期望</th>
                    <th>时间</th>
                    <th>状态</th>
                    <th style={{ textAlign: 'right' }}>报名</th>
                    <th>缺漏</th>
                    <th style={{ width: 100 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3, #888)', padding: 30 }}>
                        没有符合条件的卡片
                      </td>
                    </tr>
                  )}
                  {filtered.map((p, i) => {
                    const iss = issuesOf(p);
                    const st = PARTY_STATUS[p.status] || { label: p.status };
                    const want = [
                      p.want_score_min || p.want_score_max
                        ? `${p.want_score_min || 0}~${p.want_score_max || '∞'}`
                        : null,
                      p.want_rank || null,
                    ]
                      .filter(Boolean)
                      .join(' / ');
                    return (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--text-3, #999)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.mode}</td>
                        <td>
                          {p.account_name || <span style={{ color: '#B9770E' }}>未知</span>}
                          {p.creator_nickname && (
                            <span style={{ color: 'var(--text-3, #999)', fontSize: 11 }}>
                              {' '}
                              ·{p.creator_nickname}
                            </span>
                          )}
                        </td>
                        <td>
                          {p.my_rank || p.my_score ? `${p.my_rank || ''}${p.my_score ? ' ' + p.my_score : ''}` : '—'}
                        </td>
                        <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {want || <span style={{ color: 'var(--text-3, #aaa)' }}>不限</span>}
                        </td>
                        <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.play_time || <span style={{ color: '#B9770E' }}>未填</span>}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 12,
                              color: p.status === 'open' ? '#1E8449' : p.status === 'full' ? '#B9770E' : '#888',
                            }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{p.signup_count || 0}</td>
                        <td>
                          {iss.length === 0 ? (
                            <span style={{ color: '#1E8449', fontSize: 12 }}>完整</span>
                          ) : (
                            iss.map((x) => (
                              <Tag key={x.t} lv={x.lv}>
                                {x.t}
                              </Tag>
                            ))
                          )}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...p })}>
                            编辑
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: '#C0392B' }}
                            onClick={() => remove(p)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3, #888)' }}>
            共 {filtered.length} 条｜这里是管理入口，可改任意字段；前台「我的开黑」仍只有发起人能关自己的卡
          </p>
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
          <div className="modal-card" style={{ maxWidth: 640 }}>
            <div className="modal-head">
              <h3>编辑开黑卡片</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="modal-body" style={{ padding: '4px 2px 8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {EDIT_FIELDS.map((f) => (
                  <div key={f.k}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                      {f.label}
                    </label>
                    <input
                      type={f.type || 'text'}
                      value={editing[f.k] == null ? '' : editing[f.k]}
                      placeholder={f.ph}
                      onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                ))}

                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                    状态
                  </label>
                  <select
                    value={editing.status || 'open'}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                    style={inputStyle}
                  >
                    {STATUS_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {PARTY_STATUS[k].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                    有语音
                  </label>
                  <select
                    value={editing.has_voice ? '1' : '0'}
                    onChange={(e) => setEditing({ ...editing, has_voice: e.target.value === '1' })}
                    style={inputStyle}
                  >
                    <option value="1">是</option>
                    <option value="0">否</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                {AREA_FIELDS.map((f) => (
                  <div key={f.k} style={{ marginBottom: 10 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                      {f.label}
                    </label>
                    <textarea
                      value={editing[f.k] || ''}
                      onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })}
                      rows={f.k === 'note' ? 2 : 2}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </div>
                ))}
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
    return { redirect: { destination: '/login?from=/admin/party', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
