import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPost, apiPut, apiDelete } from '../../lib/api-client.mjs';
import PositionPicker from '../../components/PositionPicker';
import MultiSelectFilter from '../../components/MultiSelectFilter';
import UnregisteredAccounts from '../../components/admin/UnregisteredAccounts';
import DuplicatePlayers from '../../components/admin/DuplicatePlayers';
import IdentityEditor from '../../components/IdentityEditor';
import RegionPicker from '../../components/RegionPicker';
import heroIdToName from '../../lib/heroMapping';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

/* 全英雄选项：后台改资料时要能选任意英雄，不能只限已有数据里出现过的 */
const ALL_HEROES = [...new Set(Object.values(heroIdToName))].sort((a, b) =>
  a.localeCompare(b, 'zh')
);
const ALL_HERO_OPTIONS = ALL_HEROES.map((value) => ({ value }));

/* 库里的位置/英雄是逗号分隔字符串，编辑时转数组 */
const splitList = (v) =>
  Array.isArray(v)
    ? v
    : String(v || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

// 缺漏检测：返回该选手缺失/异常的项。high 用红、mid 用橙、low 用灰
function issuesOf(p) {
  const out = [];
  if (!p.game_id) out.push({ t: '缺 SteamID', lv: 'high' });
  if (!p.group_nickname) out.push({ t: '缺群昵称', lv: 'mid' });
  if (!p.positions) out.push({ t: '缺位置', lv: 'mid' });
  if (!p.account_name) out.push({ t: '未绑账号', lv: 'mid' });
  if (!p.score) out.push({ t: '分数为0', lv: 'low' });
  return out;
}

/* 缺漏标签的轻重：high 该马上补（缺 SteamID），mid 该找机会补，low 只是提醒。
   颜色全部走 .adm-chip 的令牌，不再写死 #FDECEC 这类浅底 —— 夜间模式下那些浅底会变成亮块。 */
const TAG_CLASS = { high: ' is-bad', mid: ' is-warn', low: '' };

/* 删人时后端会返回每张子表清了多少行，这里翻成人话 */
const CLEAN_LABEL = {
  player_steam_accounts: 'SteamID',
  player_group_nicknames: '群昵称',
  player_aliases: '别名',
  user_configs: '个人设置',
  play_score: '登录账号',
  team_players: '队伍关系',
  tournament_players: '赛事报名',
  player_tournament_participations: '参赛记录',
  dota_match_players: '对局战绩',
  guild_members: '帮派身份',
  guild_invites: '帮派邀请',
  party_signups: '开黑报名',
  activity_signups: '活动报名',
  party_posts: '开黑帖',
  activity_posts: '活动帖',
};

function Tag({ children, lv = 'mid' }) {
  return <span className={'adm-chip' + (TAG_CLASS[lv] ?? TAG_CLASS.mid)}>{children}</span>;
}

export default function AdminMembersPage({ denied }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | issues | nosteam | unbound
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  /* 重置密码：busy 管按钮，result 装一次性临时密码（关弹窗即丢弃） */
  const [resetState, setResetState] = useState({ busy: false, result: null });
  /* 改用户名（登录账号）：open 展开输入行，done 装结果提示 */
  const [renameState, setRenameState] = useState({ open: false, value: '', busy: false, done: null });
  const [msg, setMsg] = useState(null);
  /* 新建群友：群里直接报个到的人，不用等他自己注册 */
  const [createOpen, setCreateOpen] = useState(false);
  const [newForm, setNewForm] = useState({ nickname: '', group_nickname: '', game_id: '', score: '', positions: [], region: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/members');
      setPlayers((d && d.players) || []);
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
    const total = players.length;
    const noSteam = players.filter((p) => !p.game_id).length;
    const unbound = players.filter((p) => !p.account_name).length;
    const hasIssue = players.filter((p) => issuesOf(p).length > 0).length;
    return { total, noSteam, unbound, hasIssue };
  }, [players]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return players.filter((p) => {
      const iss = issuesOf(p);
      if (filter === 'issues' && iss.length === 0) return false;
      if (filter === 'nosteam' && p.game_id) return false;
      if (filter === 'unbound' && p.account_name) return false;
      if (!kw) return true;
      // 一个人可能有多个 SteamID（主号 + 小号）、多个群昵称，逐个都比一遍，
      // 否则合并之后搜副号会「搜不到这个人」。
      const steamAll = (p.steam_ids || [])
        .map((s) => (s && typeof s === 'object' ? s.accountId : s))
        .filter((x) => x !== null && x !== undefined)
        .map(String);
      const nickAll = (p.group_nicknames_all || [])
        .map((n) => (n && typeof n === 'object' ? n.nickname : n))
        .filter(Boolean)
        .map((x) => String(x).toLowerCase());
      return (
        String(p.nickname || '').toLowerCase().includes(kw) ||
        String(p.group_nickname || '').toLowerCase().includes(kw) ||
        String(p.game_id || '').includes(kw) ||
        steamAll.some((id) => id.includes(kw)) ||
        nickAll.some((n) => n.includes(kw)) ||
        String(p.account_name || '').toLowerCase().includes(kw)
      );
    });
  }, [players, q, filter]);

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const { account_name, login_count, created_at, updated_at, ...rest } = editing;

      // 身份是「一或多」，走数组；主号由子表决定，players 上的单值只是主号缓存，
      // 后端写完会按主号回写一次，所以这里传什么都以数组为准。
      // IdentityEditor 内部统一用 { value, isPrimary }，提交前换回接口字段名
      const steamIds = (editing.steam_ids || [])
        .map((s) => ({ accountId: String(s.value ?? '').trim(), isPrimary: !!s.isPrimary }))
        .filter((s) => s.accountId);
      const groupNicknames = (editing.group_nicknames_all || [])
        .map((n) => ({ nickname: String(n.value ?? '').trim(), isPrimary: !!n.isPrimary }))
        .filter((n) => n.nickname);

      const badId = steamIds.find((s) => !/^\d+$/.test(s.accountId));
      if (badId) {
        setBusy(false);
        setMsg({ type: 'err', text: `SteamID「${badId.accountId}」只能是数字` });
        return;
      }

      // updatePlayer 是全量 UPDATE，这里把完整对象传回去（含前端没展示的 heroes 等）
      await apiPut('/api/players', {
        playerId: editing.id,
        player: {
          nickname: rest.nickname,
          // 单值字段仍带上主号，保持和旧逻辑一致（后端最终会按子表主号覆盖）
          game_id: steamIds.length ? (steamIds.find((s) => s.isPrimary) || steamIds[0]).accountId : null,
          group_nickname: groupNicknames.length
            ? (groupNicknames.find((n) => n.isPrimary) || groupNicknames[0]).nickname
            : null,
          steamIds,
          groupNicknames,
          score: rest.score === '' ? 0 : Number(rest.score),
          // 弹窗里是数组，写库要还原成逗号分隔字符串
          positions: Array.isArray(rest.positions) ? rest.positions.join(',') : (rest.positions || ''),
          heroes: Array.isArray(rest.heroes) ? rest.heroes.join(',') : (rest.heroes || ''),
          win_rate: rest.win_rate,
          championships: rest.championships,
          synergy_players: rest.synergy_players || '',
          region: rest.region || null,
          self_intro: rest.self_intro || null,
          enemies: rest.enemies || null,
        },
      });
      setMsg({ type: 'ok', text: `已保存「${rest.nickname}」` });
      setEditing(null);
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '保存失败：' + e.message });
    } finally {
      setBusy(false);
    }
  };

  // 重置登录密码：旧密码作废，发一个一次性临时密码，本人登录后必须改
  const resetPassword = async (p) => {
    const acc = p.account_name;
    if (!acc || resetState.busy) return;
    const ok = window.confirm(
      `确认重置「${acc}」的登录密码？\n\n` +
        '旧密码会立刻失效，系统会生成一个一次性临时密码。\n' +
        '把临时密码发给本人后，他登录时会被强制先改成自己的密码。'
    );
    if (!ok) return;

    setResetState({ busy: true, result: null });
    setMsg(null);
    try {
      const r = await apiPost('/api/admin/reset-password', { playerId: p.id });
      setResetState({ busy: false, result: r });
    } catch (e) {
      setResetState({ busy: false, result: null });
      setMsg({ type: 'err', text: '重置密码失败：' + e.message });
    }
  };

  /**
   * 修改登录账号（用户名）。
   *
   * 为什么要单独做：账号名是自己注册时填的，拼音手误很常见（lanzihong / landizhong）。
   * 没有这个功能时只能让他重新注册，但他已经绑定 Steam、报名过赛事，换号等于丢掉历史。
   *
   * ⚠ 改的是 play_score.name（主键），改完旧登录态就废了 —— 必须提醒管理员转告本人重新登录。
   */
  const renameAccount = async (p) => {
    const oldName = p.account_name;
    const newName = String(renameState.value || '').trim();
    if (!oldName || renameState.busy) return;
    if (!newName) {
      setMsg({ type: 'err', text: '新用户名不能为空' });
      return;
    }
    if (newName === oldName) {
      setRenameState((s) => ({ ...s, open: false, done: null }));
      return;
    }
    const ok = window.confirm(
      `确认把登录账号从「${oldName}」改成「${newName}」？\n\n` +
        `· 改完他必须用「${newName}」登录，旧的「${oldName}」立刻失效；\n` +
        '· 浏览器里已登录的会话也要重新登录；\n' +
        '· 他以前的反馈、开黑报名、浏览记录会一起迁到新名字上。'
    );
    if (!ok) return;

    setRenameState((s) => ({ ...s, busy: true, done: null }));
    setMsg(null);
    try {
      const r = await apiPost('/api/admin/rename-account', { playerId: p.id, newName });
      setRenameState({ open: false, value: '', busy: false, done: r });
      // 弹窗里的「登录账号」与列表都要立刻反映新名字
      setEditing((prev) => (prev ? { ...prev, account_name: r.newName } : prev));
      setMsg({ type: 'ok', text: `用户名已改为「${r.newName}」，请转告本人用新名字重新登录` });
      await load();
    } catch (e) {
      setRenameState((s) => ({ ...s, busy: false }));
      setMsg({ type: 'err', text: '修改用户名失败：' + e.message });
    }
  };

  const remove = async (p) => {
    const ok = window.confirm(
      `确认删掉「${p.nickname}」？\n\n` +
        '他会从群友列表、报名名单、队伍、帮派、开黑/活动报名和战绩里一起消失，' +
        '绑过的 SteamID 和登录名也一并释放（那个登录名以后可以重新注册）。\n' +
        '这一步不可撤销。只想改资料的话用「编辑」。'
    );
    if (!ok) return;
    try {
      const r = await apiDelete('/api/players', { id: p.id });
      // 把「顺带清掉了什么」说出来：删人不只是从这张表消失
      const gone = Object.entries((r && r.removed) || {})
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${CLEAN_LABEL[t] || t} ${n} 条`);
      setMsg({
        type: 'ok',
        text: `已删掉「${p.nickname}」` + (gone.length ? `，顺带清掉：${gone.join('、')}` : ''),
      });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '删除失败：' + e.message });
    }
  };

  const submitCreate = async () => {
    const nickname = newForm.nickname.trim();
    if (!nickname) {
      setMsg({ type: 'err', text: '昵称至少填一个，其它可以以后补' });
      return;
    }
    const gid = newForm.game_id.trim();
    if (gid && !/^\d+$/.test(gid)) {
      setMsg({ type: 'err', text: 'SteamID 只能是数字（就是 Steam 个人资料页地址里那串）' });
      return;
    }
    setCreating(true);
    setMsg(null);
    try {
      const r = await apiPost('/api/players', {
        nickname,
        group_nickname: newForm.group_nickname.trim() || null,
        game_id: gid || null,
        score: newForm.score === '' ? 0 : Number(newForm.score),
        positions: (newForm.positions || []).join(','),
        region: newForm.region || null,
      });
      setMsg({ type: 'ok', text: `已把「${nickname}」加进群友列表${r && r.player && r.player.id ? '' : ''}` });
      setCreateOpen(false);
      setNewForm({ nickname: '', group_nickname: '', game_id: '', score: '', positions: [], region: '' });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '新建失败：' + e.message });
    } finally {
      setCreating(false);
    }
  };

  if (denied) return <AdminDenied hint="群友资料要改要删，得用管理员账号。" />;


  return (
    <AdminShell
      title="群友"
      accent="管理"
      active="members"
      lead="群里的人。资料缺的补上，账号绑错了的改掉，重复的两条合成一条。"
      preview={{ href: '/members', label: '看群友列表' }}
      metrics={[
        { n: stats.total, label: '位群友' },
        { n: stats.noSteam, label: '缺 SteamID', warn: stats.noSteam > 0 },
        { n: stats.unbound, label: '没绑登录账号', warn: stats.unbound > 0 },
        { n: stats.hasIssue, label: '资料有缺漏', warn: stats.hasIssue > 0 },
      ]}
      actions={
        <>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            ＋ 加个人
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            刷新
          </button>
        </>
      }
    >
          {/* 打了比赛但没绑定群友的账号：补录后赛程里的裸账号立刻变成昵称 */}
          <UnregisteredAccounts onChanged={load} />

          {/* 同一个人留下两条（导入 + 补录各一条）：合并后报名/入队/场次并到一处 */}
          <DuplicatePlayers onChanged={load} />

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜昵称 / 群昵称 / SteamID / 账号"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="adm-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部（{players.length}）</option>
          <option value="issues">有缺漏（{stats.hasIssue}）</option>
          <option value="nosteam">缺 SteamID（{stats.noSteam}）</option>
          <option value="unbound">没绑账号（{stats.unbound}）</option>
        </select>
        <span className="adm-tool-note">{filtered.length} / {players.length}</span>
      </div>

      {msg && <div className={'adm-flash is-' + (msg.type === 'err' ? 'err' : 'ok')}>{msg.text}</div>}

          {loading ? (
            <div className="empty">加载中…</div>
          ) : (
            <div className="adm-scroll">
              <table className="adm-data">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>#</th>
                    <th>昵称</th>
                    <th>群昵称</th>
                    <th>SteamID</th>
                    <th style={{ textAlign: 'right' }}>分数</th>
                    <th>位置</th>
                    <th>绑定账号</th>
                    <th>缺漏</th>
                    <th style={{ width: 128 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-3, #888)', padding: 30 }}>
                        没有符合条件的记录
                      </td>
                    </tr>
                  )}
                  {filtered.map((p, i) => {
                    const iss = issuesOf(p);
                    return (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--text-3, #999)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{p.nickname || <span className="adm-chip is-bad">未命名</span>}</td>
                        <td style={{ color: p.group_nickname ? 'inherit' : 'var(--brand)' }}>
                          {p.group_nickname || '—'}
                        </td>
                        <td
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 12,
                            color: p.game_id ? 'inherit' : 'var(--brand)',
                          }}
                        >
                          {p.game_id || '未填写'}
                        </td>
                        <td style={{ textAlign: 'right', color: p.score ? 'inherit' : 'var(--gold)' }}>
                          {p.score || 0}
                        </td>
                        <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.positions || '—'}
                        </td>
                        <td>
                          {p.account_name ? (
                            <span>
                              {p.account_name}
                              {p.login_count > 0 && (
                                <span style={{ color: 'var(--text-3, #999)', fontSize: 11 }}> ·{p.login_count}次</span>
                              )}
                            </span>
                          ) : (
                            <span className="adm-chip is-warn">未绑定</span>
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
                          <button className="btn btn-ghost btn-sm" onClick={() => {
                            // 临时密码是一次性的，重新打开弹窗必须清掉；
                            // 改名输入行同理，否则会把上一个群友的名字带进来
                            setResetState({ busy: false, result: null });
                            setRenameState({ open: false, value: '', busy: false, done: null });
                            setEditing({
                            ...p,
                            // 位置与英雄在库里是逗号分隔字符串，弹窗里用数组编辑
                            positions: splitList(p.positions),
                            heroes: splitList(p.heroes),
                            // 身份：优先用子表返回的多值，老接口没给就退回单值
                            steam_ids:
                              Array.isArray(p.steam_ids) && p.steam_ids.length > 0
                                ? p.steam_ids.map((s) => ({ value: String(s.accountId ?? s), isPrimary: !!s.isPrimary }))
                                : p.game_id
                                  ? [{ value: String(p.game_id), isPrimary: true }]
                                  : [],
                            group_nicknames_all:
                              Array.isArray(p.group_nicknames_all) && p.group_nicknames_all.length > 0
                                ? p.group_nicknames_all.map((n) => ({ value: String(n.nickname ?? n), isPrimary: !!n.isPrimary }))
                                : p.group_nickname
                                  ? [{ value: String(p.group_nickname), isPrimary: true }]
                                  : [],
                            });
                          }}>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

      <p className="adm-tool-note" style={{ marginTop: 12 }}>
        「分数 0」多半是历史迁移进来的选手，补上 SteamID 后可以重新同步资料。
      </p>

      {/* ===== 编辑弹窗 ===== */}
      {editing && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h3>编辑选手</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="modal-body" style={{ padding: '4px 2px 8px' }}>
              {[
                { k: 'nickname', label: '昵称', ph: '正式昵称' },
                { k: 'score', label: '天梯分', ph: '0', type: 'number' },
              ].map((f) => (
                <div key={f.k} style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                    {f.label}
                  </label>
                  <input
                    type={f.type || 'text'}
                    value={editing[f.k] == null ? '' : editing[f.k]}
                    placeholder={f.ph}
                    onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid var(--border-strong, #ddd)',
                      borderRadius: 8,
                      fontSize: 14,
                    }}
                  />
                </div>
              ))}

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  地区
                </label>
                <RegionPicker
                  value={editing.region || ''}
                  onChange={(next) => setEditing((prev) => ({ ...prev, region: next }))}
                />
              </div>

              {/* ===== 登录账号与重置密码 =====
                  密码在库里是加盐散列，查不到原文，只能「作废 + 发一个一次性临时密码」。
                  临时密码只在这里显示一次，关掉弹窗就没了。 */}
              <div className="pwd-box">
                <div className="pwd-box-head">
                  <span>登录账号</span>
                  {editing.account_name ? (
                    <>
                      <b className="pwd-acct">{editing.account_name}</b>
                      <span className="pwd-meta">已登录 {editing.login_count || 0} 次</span>
                      {/* 和重置密码放一起：两件事都动「登录凭据」，管理员找人时不该跑两个地方 */}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={renameState.busy}
                        onClick={() =>
                          setRenameState((s) =>
                            s.open
                              ? { open: false, value: '', busy: false, done: s.done }
                              : { open: true, value: editing.account_name, busy: false, done: null }
                          )
                        }
                      >
                        {renameState.open ? '取消改名' : '改用户名'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={resetState.busy}
                        onClick={() => resetPassword(editing)}
                      >
                        {resetState.busy ? '重置中…' : '重置密码'}
                      </button>
                    </>
                  ) : (
                    <span className="pwd-none">还没有登录账号，等他注册后再来重置</span>
                  )}
                </div>

                {/* ---- 改用户名：默认填当前账号，直接改错字即可 ---- */}
                {renameState.open && editing.account_name && (
                  <>
                    <div className="pwd-rename">
                      <label htmlFor="pwd-rename-input">新用户名</label>
                      <input
                        id="pwd-rename-input"
                        className="pwd-rename-input"
                        value={renameState.value}
                        maxLength={40}
                        autoFocus
                        placeholder="输入新的登录账号"
                        onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameAccount(editing);
                          if (e.key === 'Escape') setRenameState((s) => ({ ...s, open: false, value: '' }));
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={renameState.busy}
                        onClick={() => renameAccount(editing)}
                      >
                        {renameState.busy ? '保存中…' : '保存'}
                      </button>
                    </div>
                    <p className="pwd-rename-tip">
                      改完他必须用新用户名登录，旧的立刻失效（已登录的会话也要重登）。
                      以前的反馈、开黑报名、浏览记录会一起迁到新名字上，不会丢。
                    </p>
                  </>
                )}

                {renameState.done && renameState.done.ok && renameState.done.oldName && (
                  <div className="pwd-rename-done">
                    已把「{renameState.done.oldName}」改成「{renameState.done.newName}」
                    {renameState.done.moved && Object.keys(renameState.done.moved).length > 0
                      ? `，同步迁移 ${Object.entries(renameState.done.moved)
                          .map(([k, v]) => `${k} ${v} 条`)
                          .join('、')}`
                      : ''}
                    。请转告本人用新名字重新登录。
                  </div>
                )}

                {resetState.result && (
                  <div className="pwd-result">
                    <div className="pwd-result-title">临时密码（只显示这一次）</div>
                    <div className="pwd-result-line">
                      <code>{resetState.result.tempPassword}</code>
                      <button
                        type="button"
                        className="pwd-copy"
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(resetState.result.tempPassword);
                            setMsg({ type: 'ok', text: '临时密码已复制' });
                          } catch {
                            setMsg({ type: 'err', text: '复制失败，请手动选中复制' });
                          }
                        }}
                      >
                        复制
                      </button>
                    </div>
                    <div className="pwd-result-foot">
                      发给本人 → 他登录后会被强制先改成自己的密码。关掉这个弹窗就再也看不到了。
                    </div>
                  </div>
                )}
              </div>

              {/* 群昵称与 SteamID 都是「一或多」：导入匹配、开黑帖、赛程认人都会用到 */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  群昵称（可多个）
                </label>
                <IdentityEditor
                  kind="nickname"
                  items={editing.group_nicknames_all || []}
                  onChange={(next) => setEditing((prev) => ({ ...prev, group_nicknames_all: next }))}
                  hint="改成别的群名片时把旧的也留着：Excel 导入、赛事包导入按群昵称认人，多留一个就多一条命中路径。"
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  SteamID（可多个）
                </label>
                <IdentityEditor
                  kind="steam"
                  items={editing.steam_ids || []}
                  onChange={(next) => setEditing((prev) => ({ ...prev, steam_ids: next }))}
                  hint="「主」决定头像、天梯分和卡片上显示哪个号。一个 SteamID 只能归一个人，撞了会提示。"
                />
              </div>

              {/* 位置：多选 + 排序（顺序决定群友卡片上先展示哪个） */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  擅长位置
                </label>
                <PositionPicker
                  value={Array.isArray(editing.positions) ? editing.positions : []}
                  onChange={(next) => setEditing({ ...editing, positions: next })}
                  hint="可多选，第 1 位是主位置。"
                />
              </div>

              {/* 英雄：选项多，用可滚动下拉，不平铺 */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  擅长英雄
                </label>
                <MultiSelectFilter
                  label="擅长英雄"
                  allLabel="未填写"
                  unit="位群友"
                  options={ALL_HERO_OPTIONS}
                  value={Array.isArray(editing.heroes) ? editing.heroes : []}
                  onChange={(next) => setEditing({ ...editing, heroes: next })}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  自我简介
                </label>
                <textarea
                  value={editing.self_intro || ''}
                  onChange={(e) => setEditing({ ...editing, self_intro: e.target.value })}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border-strong, #ddd)',
                    borderRadius: 8,
                    fontSize: 14,
                    resize: 'vertical',
                  }}
                />
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

      {/* ===== 新建群友 =====
          只留「先能进列表」的字段：昵称 + 群昵称 + SteamID。
          分数、位置、地区以后在编辑弹窗里补 —— 群里刚来的人常常一问三不知，
          卡着必填只会让人随便乱填。 */}
      {createOpen && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setCreateOpen(false);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h3>加个人</h3>
              <button className="modal-close" onClick={() => !creating && setCreateOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: '4px 2px 8px' }}>
              <p className="adm-tool-note" style={{ marginTop: 0 }}>
                只有昵称是必填的。SteamID 填了才能认出他的头像和天梯分。
              </p>

              {[
                { k: 'nickname', label: '昵称', ph: '群里怎么叫他', required: true },
                { k: 'group_nickname', label: '群昵称', ph: '微信群名片，留空就跟昵称一样' },
                { k: 'game_id', label: 'SteamID', ph: '一串数字，可留空', inputMode: 'numeric' },
                { k: 'score', label: '天梯分', ph: '不知道就留空', type: 'number' },
              ].map((f) => (
                <div key={f.k} className="adm-field">
                  <label className="adm-label" htmlFor={'np-' + f.k}>
                    {f.label}
                    {f.required ? '（必填）' : ''}
                  </label>
                  <input
                    id={'np-' + f.k}
                    className="adm-input"
                    type={f.type || 'text'}
                    inputMode={f.inputMode}
                    value={newForm[f.k]}
                    placeholder={f.ph}
                    onChange={(e) => setNewForm((s) => ({ ...s, [f.k]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && f.k === 'score') submitCreate();
                    }}
                  />
                </div>
              ))}

              <div className="adm-field">
                <span className="adm-label">擅长位置</span>
                <PositionPicker
                  value={newForm.positions}
                  onChange={(next) => setNewForm((s) => ({ ...s, positions: next }))}
                  hint="可多选，第 1 位算主位置。"
                />
              </div>

              <div className="adm-field">
                <span className="adm-label">地区</span>
                <RegionPicker
                  value={newForm.region}
                  onChange={(next) => setNewForm((s) => ({ ...s, region: next }))}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                算了
              </button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={creating}>
                {creating ? '加进去中…' : '加进去'}
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
    return { redirect: { destination: '/login?from=/admin/members', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
