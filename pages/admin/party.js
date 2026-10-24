import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPut, apiDelete } from '../../lib/api-client.mjs';
import { PARTY_STATUS } from '../../lib/options.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

const STATUS_KEYS = Object.keys(PARTY_STATUS);

function issuesOf(p) {
  const out = [];
  if (!p.play_time) out.push({ t: '缺时间', lv: 'mid' });
  if (!p.account_name) out.push({ t: '缺发起人', lv: 'mid' });
  if (!p.want_score_min && !p.want_score_max && !p.want_rank) out.push({ t: '无组队要求', lv: 'low' });
  return out;
}

const TAG_CLASS = { mid: ' is-warn', low: '' };

function Tag({ children, lv = 'mid' }) {
  return <span className={'adm-chip' + (TAG_CLASS[lv] ?? TAG_CLASS.mid)}>{children}</span>;
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
  const [q, setQ] = useState('');
  // 展开哪一张卡的报名名单（一次只开一张，后台屏幕上同时开多张会看串行）
  const [openSign, setOpenSign] = useState(null);
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
    const kw = q.trim().toLowerCase();
    return posts.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (!kw) return true;
      return (
        String(p.mode || '').toLowerCase().includes(kw) ||
        String(p.account_name || '').toLowerCase().includes(kw) ||
        String(p.creator_nickname || '').toLowerCase().includes(kw) ||
        String(p.play_time || '').toLowerCase().includes(kw) ||
        String(p.note || '').toLowerCase().includes(kw) ||
        (p.signups || []).some((s) => String(s.account_name || '').toLowerCase().includes(kw))
      );
    });
  }, [posts, filter, q]);

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

  /* 踢掉一个报名的人：卡留着，只把人从名单里拿掉 */
  const kickSignup = async (post, s) => {
    const who = s.account_name || '这个人';
    if (!window.confirm(`把「${who}」从这张卡里踢掉？\n\n他要是想再报，可以自己去前台重新点。`)) return;
    try {
      await apiDelete('/api/admin/party', { signupId: s.id });
      setPosts((list) =>
        list.map((x) =>
          String(x.id) === String(post.id)
            ? {
                ...x,
                signups: (x.signups || []).filter((y) => String(y.id) !== String(s.id)),
                signup_count: Math.max(0, (x.signup_count || 0) - 1),
              }
            : x
        )
      );
      setMsg({ type: 'ok', text: `已把「${who}」踢掉` });
    } catch (e) {
      setMsg({ type: 'err', text: '踢人失败：' + e.message });
    }
  };

  if (denied) return <AdminDenied hint="开黑要改要删，得用管理员账号。" />;

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border-strong, #ddd)',
    borderRadius: 8,
    fontSize: 14,
  };

  return (
    <AdminShell
      title="开黑"
      accent="管理"
      active="party"
      lead="群里喊着「来两个」的那种卡片。开完了记得关掉，不然会一直挂在招募中。"
      preview={{ href: '/party', label: '看开黑页' }}
      metrics={[
        { n: stats.total, label: '张卡片' },
        { n: stats.open, label: '还在招' },
        { n: stats.withSign, label: '有人报名' },
        { n: stats.closed, label: '已关掉' },
      ]}
      actions={
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          刷新
        </button>
      }
    >
      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜模式 / 发起人 / 开黑时间 / 备注 / 报名的人"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="adm-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部（{posts.length}）</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {PARTY_STATUS[k].label}（{posts.filter((p) => p.status === k).length}）
            </option>
          ))}
        </select>
        <span className="adm-tool-note">{filtered.length} 张</span>
      </div>

      {msg && <div className={'adm-flash is-' + (msg.type === 'err' ? 'err' : 'ok')}>{msg.text}</div>}

          {loading ? (
            <div className="empty">加载中…</div>
          ) : (
            <div className="adm-scroll">
              <table className="adm-data">
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
                    <th style={{ width: 128 }}>操作</th>
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
                    const signs = p.signups || [];
                    const signOpen = String(openSign) === String(p.id);
                    return (
                      <Fragment key={p.id}>
                      <tr>
                        <td style={{ color: 'var(--text-3, #999)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.mode}</td>
                        <td>
                          {p.account_name || <span className="adm-chip is-warn">未知</span>}
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
                          {p.play_time || <span className="adm-chip is-warn">未填</span>}
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
                        <td style={{ textAlign: 'right' }}>
                          {signs.length === 0 ? (
                            <span style={{ color: 'var(--text-3)' }}>0</span>
                          ) : (
                            <button
                              type="button"
                              className="adm-link-btn"
                              onClick={() => setOpenSign(signOpen ? null : p.id)}
                              title="看看是谁报的"
                            >
                              {signs.length} {signOpen ? '▴' : '▾'}
                            </button>
                          )}
                        </td>
                        <td>
                          {iss.length === 0 ? (
                            <span className="adm-chip is-ok">完整</span>
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
                            style={{ color: 'var(--brand)' }}
                            onClick={() => remove(p)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                      {signOpen && (
                        <tr className="adm-subrow">
                          <td colSpan={10}>
                            <div className="adm-signups">
                              <span className="adm-signups-label">报名的人</span>
                              {signs.map((sn) => (
                                <span className="adm-signups-item" key={sn.id}>
                                  <span className="adm-signups-name">{sn.account_name || '未登录'}</span>
                                  {sn.note && <span className="adm-signups-note">{sn.note}</span>}
                                  {sn.created_at_ts && (
                                    <span className="adm-signups-time">
                                      {String(sn.created_at_ts).slice(5, 10)} {String(sn.created_at_ts).slice(11, 16)}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    className="adm-link-btn"
                                    onClick={() => kickSignup(p, sn)}
                                  >
                                    踢掉
                                  </button>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

      <p className="adm-tool-note" style={{ marginTop: 12 }}>
        这里能改任意字段；前台「我的开黑」还是只有发起人能关自己的卡。
      </p>

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
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/party', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
