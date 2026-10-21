import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPut, apiDelete } from '../../lib/api-client.mjs';
import PositionPicker from '../../components/PositionPicker';
import MultiSelectFilter from '../../components/MultiSelectFilter';
import UnregisteredAccounts from '../../components/admin/UnregisteredAccounts';
import DuplicatePlayers from '../../components/admin/DuplicatePlayers';
import IdentityEditor from '../../components/IdentityEditor';
import heroIdToName from '../../lib/heroMapping';

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

const TAG_COLOR = {
  high: { bg: '#FDECEC', fg: '#C0392B', bd: '#F5C6C2' },
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

export default function AdminMembersPage({ denied }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | issues | nosteam | unbound
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

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
      return (
        String(p.nickname || '').toLowerCase().includes(kw) ||
        String(p.group_nickname || '').toLowerCase().includes(kw) ||
        String(p.game_id || '').includes(kw) ||
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

  const remove = async (p) => {
    const ok = window.confirm(
      `确认删除选手「${p.nickname}」？\n\n这会同时移除他与所有赛事队伍的关系，不可恢复。\n如果只是想修正信息，请用「编辑」。`
    );
    if (!ok) return;
    try {
      await apiDelete('/api/players', { id: p.id });
      setMsg({ type: 'ok', text: `已删除「${p.nickname}」` });
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
        flex: '1 1 140px',
        // 深色页面：不能再用白底（原来写死 #fff，四个白块很刺眼）
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: color || 'inherit' }}>{n}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <>
      <Head>
        <title>群友管理 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>
            群友<span className="hl">管理</span>
          </h1>
          <p>补全资料 · 标注缺失 · 增删改查</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-tabs" style={{ marginBottom: 16 }}>
            <Link className="adm-tab" href="/admin">赛事管理</Link>
            <span className="adm-tab active">群友管理</span>
            <Link className="adm-tab" href="/admin/food">美食管理</Link>
            <Link className="adm-tab" href="/admin/party">开黑管理</Link>
            <Link className="adm-tab" href="/main">阵容分配</Link>
            <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {statBox(stats.total, '选手总数')}
            {statBox(stats.noSteam, '缺 SteamID', '#C0392B')}
            {statBox(stats.unbound, '未绑账号', '#B9770E')}
            {statBox(stats.hasIssue, '存在缺漏', '#B9770E')}
          </div>

          {/* 打了比赛但没绑定群友的账号：补录后赛程里的裸账号立刻变成昵称 */}
          <UnregisteredAccounts onChanged={load} />

          {/* 同一个人留下两条（导入 + 补录各一条）：合并后报名/入队/场次并到一处 */}
          <DuplicatePlayers onChanged={load} />

          <div className="adm-bar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <input
              className="search-box"
              style={{
                flex: '1 1 240px',
                padding: '9px 12px',
                border: '1px solid var(--border-strong, #ddd)',
                borderRadius: 9,
                fontSize: 14,
              }}
              placeholder="搜索昵称 / 群昵称 / SteamID / 账号"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border-strong, #ddd)' }}
            >
              <option value="all">全部（{players.length}）</option>
              <option value="issues">有缺漏（{stats.hasIssue}）</option>
              <option value="nosteam">缺 SteamID（{stats.noSteam}）</option>
              <option value="unbound">未绑账号（{stats.unbound}）</option>
            </select>
          </div>

          {msg && (
            <div
              className={msg.type === 'err' ? 'adm-error' : ''}
              style={
                msg.type === 'err'
                  ? { marginBottom: 12 }
                  : { marginBottom: 12, color: '#1E8449', fontSize: 13 }
              }
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
                    <th style={{ width: 46 }}>#</th>
                    <th>昵称</th>
                    <th>群昵称</th>
                    <th>SteamID</th>
                    <th style={{ textAlign: 'right' }}>分数</th>
                    <th>位置</th>
                    <th>绑定账号</th>
                    <th>缺漏</th>
                    <th style={{ width: 100 }}>操作</th>
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
                        <td style={{ fontWeight: 600 }}>{p.nickname || <span style={{ color: '#C0392B' }}>未命名</span>}</td>
                        <td style={{ color: p.group_nickname ? 'inherit' : '#C0392B' }}>
                          {p.group_nickname || '—'}
                        </td>
                        <td
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 12,
                            color: p.game_id ? 'inherit' : '#C0392B',
                          }}
                        >
                          {p.game_id || '未填写'}
                        </td>
                        <td style={{ textAlign: 'right', color: p.score ? 'inherit' : '#B9770E' }}>
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
                            <span style={{ color: '#B9770E' }}>未绑定</span>
                          )}
                        </td>
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
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing({
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
                          })}>
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
            共 {filtered.length} 条
            {filter !== 'all' || q ? `（已筛选，总计 ${players.length}）` : ''}
            ｜「分数为0」多见于历史迁移的选手，补 SteamID 后可重新同步资料
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
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h3>编辑选手</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>

            <div style={{ padding: '4px 2px 8px' }}>
              {[
                { k: 'nickname', label: '昵称', ph: '正式昵称' },
                { k: 'score', label: '天梯分', ph: '0', type: 'number' },
                { k: 'region', label: '地区', ph: '深圳' },
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

              {editing.account_name && (
                <p style={{ fontSize: 12, color: 'var(--text-3, #888)' }}>
                  已绑定登录账号：<b>{editing.account_name}</b>（登录 {editing.login_count} 次）
                </p>
              )}
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
    return { redirect: { destination: '/login?from=/admin/members', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
