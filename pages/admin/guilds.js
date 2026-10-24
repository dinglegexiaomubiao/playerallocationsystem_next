import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSession, isAdmin } from '../../lib/auth';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';
import { GUILD_COLORS, guildColor } from '../../lib/guild-colors.mjs';
import { LIMITS } from '../../lib/moderation.mjs';

/**
 * 帮派管理。
 *
 * 群友自助建帮，名字和配色全站唯一（数据库唯一索引），所以后台必须有越权处置手段：
 * 违规帮名、专占配色、帮主跑路的空壳帮，以前只能进库改。
 *
 * 页面结构上刻意只做一件事：**一眼看完整局**。
 * 所以不折叠、不弹二级页 —— 每个帮派的成员直接摊在行下面（帮派最多 10 人，摊得下）。
 */
export default function AdminGuildsPage({ denied }) {
  const [data, setData] = useState({ guilds: [], colors: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/guilds');
      setData({ guilds: d.guilds || [], colors: d.colors || [] });
    } catch (e) {
      setFlash({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const guilds = data.guilds;
  const stats = useMemo(() => {
    const people = guilds.reduce((n, g) => n + g.memberCount, 0);
    const invites = guilds.reduce((n, g) => n + g.pendingInvites, 0);
    const alone = guilds.filter((g) => g.memberCount <= 1).length;
    return { total: guilds.length, people, invites, alone };
  }, [guilds]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return guilds;
    return guilds.filter(
      (g) =>
        g.name.toLowerCase().includes(kw) ||
        g.leaderName.toLowerCase().includes(kw) ||
        (g.slogan || '').toLowerCase().includes(kw) ||
        g.members.some((m) => (m.nickname || '').toLowerCase().includes(kw))
    );
  }, [guilds, q]);

  const run = async (key, fn, okText) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      if (okText) setFlash({ type: 'ok', text: okText });
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  const dissolve = (g) => {
    const ok = window.confirm(
      `解散「${g.name}」？\n\n${g.memberCount} 个人会被移出帮派，待回的 ${g.pendingInvites} 条邀请一起作废。\n这支配色会空出来给别人用。群友的档案、战绩都不受影响。`
    );
    if (!ok) return;
    run('dis-' + g.id, () => apiDelete('/api/admin/guilds', { id: g.id }), `「${g.name}」已解散`);
  };

  const kick = (g, m) => {
    const ok = window.confirm(`把「${m.nickname}」移出「${g.name}」？他自己还能重新加别的帮。`);
    if (!ok) return;
    run('kick-' + m.playerId, () =>
      apiPost('/api/admin/guilds', { action: 'kick', guildId: g.id, playerId: m.playerId }), `${m.nickname} 已移出`
    );
  };

  const transfer = (g) => {
    const target = window.prompt(`把帮主转给谁？填群友昵称或 ID（当前帮主：${g.leaderName}）`);
    if (!target) return;
    const hit = g.members.find(
      (m) => m.nickname === target.trim() || String(m.playerId) === target.trim()
    );
    if (!hit) {
      setFlash({ type: 'err', text: `「${target}」不在这个帮里` });
      return;
    }
    run('tr-' + g.id, () =>
      apiPost('/api/admin/guilds', { action: 'transfer', guildId: g.id, playerId: hit.playerId }), `帮主换成 ${hit.nickname}`);
  };

  const save = async () => {
    if (!editing) return;
    setBusy('save');
    setFlash(null);
    try {
      await apiPut('/api/admin/guilds', {
        id: editing.id,
        name: editing.name,
        slogan: editing.slogan,
        colorKey: editing.colorKey,
      });
      setFlash({ type: 'ok', text: `「${editing.name}」改好了` });
      setEditing(null);
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  if (denied) return <AdminDenied hint="要看帮派数据，得用管理员账号。" />;

  return (
    <AdminShell
      title="帮派"
      accent="管理"
      active="guilds"
      lead="群友自己拉的小团体。名字和配色全站唯一 —— 占着不走、帮主跑路、名字不合适的，在这处理。"
      preview={{ href: '/members', label: '看群友卡片' }}
      metrics={[
        { n: stats.total, label: '个帮派' },
        { n: stats.people, label: '人在帮里' },
        { n: stats.invites, label: '条邀请还没回' },
        { n: stats.alone, label: '个只有帮主一个', warn: stats.alone > 0 },
      ]}
      actions={
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          刷新
        </button>
      }
    >
      {flash && <div className={'adm-flash is-' + (flash.type === 'ok' ? 'ok' : 'err')}>{flash.text}</div>}

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜帮名 / 帮主 / 口号 / 成员"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="adm-tool-note">
          {list.length} / {guilds.length}
        </span>
      </div>

      {loading ? (
        <div className="adm-empty">读着呢…</div>
      ) : list.length === 0 ? (
        <div className="adm-empty">
          {guilds.length === 0 ? '还没有人建帮派。' : '没有符合的帮派。'}
          {guilds.length === 0 && <span>群友在「个人信息」页可以自己建。</span>}
        </div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th style={{ width: 190 }}>帮派</th>
                <th>口号</th>
                <th style={{ width: 110 }}>帮主</th>
                <th className="is-num" style={{ width: 60 }}>人</th>
                <th className="is-num" style={{ width: 74 }}>待回邀请</th>
                <th style={{ width: 96 }}>建帮</th>
                <th style={{ width: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const c = guildColor(g.colorKey);
                const open = openId === g.id;
                return (
                  <Fragment key={g.id}>
                    <tr>
                      <td className="is-strong">
                        <span
                          className="adm-dot"
                          style={{ background: c ? c.solid : 'var(--text-3)', marginRight: 6 }}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className="adm-link-btn"
                          style={{ fontWeight: 600, padding: 0 }}
                          onClick={() => setOpenId(open ? null : g.id)}
                          title={open ? '收起成员' : '看看都有谁'}
                        >
                          {g.name}
                        </button>
                        {!c && <span className="adm-chip is-bad" style={{ marginLeft: 6 }}>配色失效</span>}
                        {g.memberCount >= 10 && <span className="adm-chip is-warn" style={{ marginLeft: 6 }}>满员</span>}
                      </td>
                      <td className="is-weak">{g.slogan || '—'}</td>
                      <td>{g.leaderName}</td>
                      <td className="is-num">{g.memberCount}</td>
                      <td className="is-num">{g.pendingInvites || '—'}</td>
                      <td className="is-weak is-nowrap">{String(g.createdAt || '').slice(0, 10)}</td>
                      <td>
                        <div className="adm-ops">
                          <button className="adm-link-btn" onClick={() => setEditing({ ...g })}>
                            改
                          </button>
                          <button className="adm-link-btn" onClick={() => transfer(g)} disabled={busy === 'tr-' + g.id}>
                            换帮主
                          </button>
                          <button
                            className="adm-link-btn adm-danger-btn"
                            style={{ color: 'var(--accent)' }}
                            onClick={() => dissolve(g)}
                            disabled={busy === 'dis-' + g.id}
                          >
                            解散
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--bg-subtle)', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            {g.members.map((m) => (
                              <span
                                key={m.playerId}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  background: 'var(--bg-card)',
                                  border: '1px solid var(--border)',
                                  fontSize: 12,
                                }}
                              >
                                <Link href={'/members/' + m.playerId} style={{ color: 'inherit', fontWeight: 600 }}>
                                  {m.nickname}
                                </Link>
                                {m.role === 'leader' ? (
                                  <span className="adm-chip is-ok">帮主</span>
                                ) : (
                                  <button
                                    className="adm-link-btn"
                                    style={{ fontSize: 11 }}
                                    onClick={() => kick(g, m)}
                                    disabled={busy === 'kick-' + m.playerId}
                                    title="移出帮派"
                                  >
                                    踢
                                  </button>
                                )}
                                <span className="is-weak" style={{ fontSize: 11 }}>
                                  {m.region || ''}
                                </span>
                              </span>
                            ))}
                            {g.members.length === 0 && <span className="is-weak">这个帮里没人了（数据异常）</span>}
                            {g.invites.length > 0 && (
                              <button
                                className="adm-link-btn"
                                style={{ fontSize: 12 }}
                                onClick={() =>
                                  run('ci-' + g.id, () =>
                                    apiPost('/api/admin/guilds', { action: 'clearInvites', guildId: g.id })
                                  , '邀请清掉了')
                                }
                              >
                                清掉 {g.invites.length} 条待回邀请
                              </button>
                            )}
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

      {editing && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h3>改帮派</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="adm-field">
                <label className="adm-label">帮派名（最多 {LIMITS.guildName} 字）</label>
                <input
                  className="adm-input"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <div className="adm-input-hint">判重不看大小写和空格，「ＬａＲｏｊａ」和「laroja」算同一个人抢注。</div>
              </div>
              <div className="adm-field">
                <label className="adm-label">口号（最多 {LIMITS.guildSlogan} 字）</label>
                <input
                  className="adm-input"
                  value={editing.slogan || ''}
                  onChange={(e) => setEditing({ ...editing, slogan: e.target.value })}
                />
              </div>
              <div className="adm-field">
                <label className="adm-label">配色</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {GUILD_COLORS.map((c) => {
                    const on = c.key === editing.colorKey;
                    const used = guilds.some((g) => g.colorKey === c.key && g.id !== editing.id);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => !used && setEditing({ ...editing, colorKey: c.key })}
                        disabled={used}
                        title={used ? c.label + '（已经被别的帮用了）' : c.label}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 9px',
                          borderRadius: 4,
                          cursor: used ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                          background: on ? 'var(--bg-subtle)' : 'transparent',
                          border: '1px solid ' + (on ? c.solid : 'var(--border)'),
                          color: used ? 'var(--text-3)' : 'var(--text-2)',
                          opacity: used ? 0.45 : 1,
                        }}
                      >
                        <span className="adm-dot" style={{ background: c.solid }} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy === 'save'}>
                算了
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy === 'save'}>
                {busy === 'save' ? '存着…' : '保存'}
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
  if (!session) return { redirect: { destination: '/login?from=/admin/guilds', permanent: false } };
  return { props: { denied: !isAdmin(req) } };
}
