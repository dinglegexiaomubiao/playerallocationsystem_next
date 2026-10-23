import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../hooks/useSession';
import PlayerPicker from '../components/PlayerPicker';
import PlayerBind from '../components/PlayerBind';
import MyTournamentTable from '../components/MyTournamentTable';
import MatchHistory from '../components/member/MatchHistory';
import AiPanel from '../components/member/AiPanel';
import OrderedChips from '../components/OrderedChips';
import PositionPicker from '../components/PositionPicker';
import IdentityEditor from '../components/IdentityEditor';
import HeroPicker from '../components/HeroPicker';
import RegionPicker from '../components/RegionPicker';
import { mergeMyTournaments } from '../lib/tournament-format.mjs';
import { regionFull } from '../lib/regions';
import { checkText, LIMITS } from '../lib/moderation.mjs';

export default function Profile() {
  const router = useRouter();
  const { me, ready } = useSession();

  const [bound, setBound] = useState(true);
  const [profile, setProfile] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [heroOpen, setHeroOpen] = useState(false);

  // 编辑表单
  const [form, setForm] = useState({});
  const [synergy, setSynergy] = useState([]);
  const [enemies, setEnemies] = useState([]);

  useEffect(() => {
    if (!ready) return;
    if (!me) {
      router.replace('/login?from=/profile');
      return;
    }
    load();
  }, [ready, me]);

  const load = () => {
    setLoading(true);
    // 两个来源各有各的字段：/api/profile 给名次与担任位置，
    // /api/my-tournaments 给队长身份、报名状态、所在队伍，合并后才是完整的「我的赛事」。
    Promise.all([
      fetch('/api/profile').then((r) => r.json()).catch(() => ({})),
      fetch('/api/my-tournaments').then((r) => r.json()).catch(() => ({})),
    ])
      .then(([d, mine]) => {
        if (d.success) {
          setBound(d.bound !== false);
          setProfile(d.profile || null);
          setTournaments(mergeMyTournaments(d.tournaments || [], mine.tournaments || []));
          if (d.profile) {
            setForm({
              group_nickname: d.profile.group_nickname || '',
              // 多值身份：一个群友可以有多个 SteamID / 多个群昵称
              steam_ids: (d.profile.steamIds || []).map((s) => ({
                value: String(s.accountId),
                isPrimary: !!s.isPrimary,
              })),
              group_nicknames_all: (d.profile.groupNicknames || []).map((n) => ({
                value: n.nickname,
                isPrimary: !!n.isPrimary,
              })),
              region: d.profile.region || '',
              score: d.profile.score ?? '',
              peak_score: d.profile.peak_score ?? '',
              positions: d.profile.positions || [],
              heroes: d.profile.heroes || [],
              self_intro: d.profile.self_intro || '',
              win_rate: d.profile.win_rate ?? '',
            });
            setSynergy((d.profile.synergy_players || []).map((id) => ({ id: String(id), nickname: String(id) })));
            setEnemies((d.profile.enemies || []).map((id) => ({ id: String(id), nickname: String(id) })));
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // 默契队友/仇人 id → 昵称（从全局群友列表解析）
  const [allPlayers, setAllPlayers] = useState([]);
  useEffect(() => {
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => setAllPlayers(d.players || []))
      .catch(() => {});
  }, []);

  const nameMap = useMemo(() => {
    const m = new Map();
    allPlayers.forEach((p) => m.set(String(p.id), p.nickname || p.group_nickname));
    return m;
  }, [allPlayers]);

  // 回填选择器的昵称显示
  useEffect(() => {
    if (!profile) return;
    setSynergy((prev) => prev.map((x) => ({ ...x, nickname: nameMap.get(x.id) || x.nickname })));
    setEnemies((prev) => prev.map((x) => ({ ...x, nickname: nameMap.get(x.id) || x.nickname })));
  }, [nameMap]);

  const startEdit = () => setEditing(true);
  const cancelEdit = () => {
    setEditing(false);
    load();
  };

  const save = async () => {
    // 天梯分 / 最高分 / 胜率在库里都是整数列，小数会让接口 500。
    // 先在本地拦下并给出可读提示，别让用户对着「个人信息操作失败」发懵。
    const intFields = [
      { key: 'score', label: '当前天梯分', max: 20000 },
      { key: 'peak_score', label: '历史最高分', max: 20000 },
      { key: 'win_rate', label: '自报胜率', max: 100 },
    ];
    for (const { key, label, max } of intFields) {
      const v = form[key];
      if (v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        setMsg(`${label}请填 0 ~ ${max} 之间的数字`);
        return;
      }
      if (!Number.isInteger(n)) {
        setMsg(`${label}请填整数（例如 ${key === 'win_rate' ? 55 : 4950}），不能带小数点`);
        return;
      }
    }

    // 文本合规初筛：群昵称（含多个备用）、自我评价；命中违禁词直接提醒
    const textChecks = [
      { label: '群昵称', value: form.group_nickname },
      ...(form.group_nicknames_all || []).map((n, i) => ({ label: `群昵称${i > 0 ? '（备用' + (i) + '）' : ''}`, value: n && n.value })),
      { label: '自我评价', value: form.self_intro },
    ];
    for (const { label, value } of textChecks) {
      if (!value) continue;
      const hit = checkText(value);
      if (!hit.ok) {
        setMsg(`「${label}」里检测到不合适的内容（${hit.category}），请修改后再提交`);
        return;
      }
    }
    if (form.self_intro && [...form.self_intro].length > LIMITS.selfIntro) {
      setMsg(`自我评价最多 ${LIMITS.selfIntro} 字，请精简一下`);
      return;
    }

    setSaving(true);
    setMsg('');
    // 身份数组里可能有空行（点了「添加」还没填），先滤掉再提交
    const steamIds = (form.steam_ids || [])
      .map((s) => ({ accountId: String(s.value ?? '').trim(), isPrimary: !!s.isPrimary }))
      .filter((s) => s.accountId);
    const badId = steamIds.find((s) => !/^\d+$/.test(s.accountId));
    if (badId) {
      setMsg(`SteamID「${badId.accountId}」只能是数字（Steam 好友码）`);
      return;
    }
    const groupNicknames = (form.group_nicknames_all || [])
      .map((n) => ({ nickname: String(n.value ?? '').trim(), isPrimary: !!n.isPrimary }))
      .filter((n) => n.nickname);
    if (groupNicknames.length === 0) {
      setMsg('群昵称至少要留一个');
      return;
    }

    const body = {
      group_nickname: groupNicknames.find((n) => n.isPrimary)?.nickname || groupNicknames[0].nickname,
      steamIds,
      groupNicknames,
      region: form.region || null,
      score: form.score === '' || form.score === null ? null : Number(form.score),
      peak_score: form.peak_score === '' || form.peak_score === null ? null : Number(form.peak_score),
      positions: form.positions || [],
      heroes: form.heroes || [],
      self_intro: form.self_intro || null,
      win_rate: form.win_rate === '' || form.win_rate === null ? null : Number(form.win_rate),
      synergy_players: synergy.map((x) => x.id),
      enemies: enemies.map((x) => x.id),
    };
    const r = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setSaving(false);
    if (r.ok) {
      setMsg('已保存');
      setEditing(false);
      load();
    } else {
      setMsg(d.error || '保存失败');
    }
  };

  if (!ready || loading) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;

  if (!bound || !profile) {
    return (
      <>
        <Head><title>补填选手资料 · 深圳LaRoja Dota2社区</title></Head>
        <section className="page-hero">
          <div className="wrap">
            <h1>补填<span className="hl">选手资料</span></h1>
            <p>老账号可以用 SteamID 继承库里已有的历史战绩，无需重新录入</p>
          </div>
        </section>
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <PlayerBind
              onBound={(d) => {
                // 绑定成功后重新拉一次资料，页面直接切到正常态
                setMsg(d && d.inherited ? '已继承历史资料' : '资料已创建，继续完善吧');
                load();
              }}
            />
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{profile.nickname || '个人信息'} · 个人信息 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <div className="detail-head">
            <div className="detail-avatar">{(profile.nickname || '?').slice(0, 1)}</div>
            <div>
              <h1 style={{ fontSize: '1.9rem' }}>{profile.nickname || '未命名'}</h1>
              <div className="detail-sub">
                steamID {profile.game_id || '—'}
                {profile.group_nickname ? ' · 群昵称 ' + profile.group_nickname : ''}
              </div>
            </div>
            {!editing && (
              <Link href="/change-password" className="btn btn-ghost" style={{ marginLeft: 'auto' }}>
                修改密码
              </Link>
            )}
            {!editing && (
              <button className="btn btn-primary" onClick={startEdit} style={{ marginLeft: 8 }}>
                编辑资料
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {msg && <div className="adm-msg">{msg}</div>}

          {editing ? (
            <div className="side-card" style={{ marginBottom: 22 }}>
              <h4>编辑资料</h4>
              {/* 群昵称与 SteamID 都是「一或多」：改名/换号时把旧的也留着，
                  导入和赛程认人时多一个匹配路径。主号决定头像与战绩取自哪个号。 */}
              <div className="form-field" style={{ marginBottom: 16 }}>
                <label>群昵称（可多个）</label>
                <IdentityEditor
                  kind="nickname"
                  items={form.group_nicknames_all || []}
                  onChange={(next) => setForm((prev) => ({ ...prev, group_nicknames_all: next }))}
                  hint="「主」是群友卡片和列表上显示的那个。改过群名片就把旧的也留着，方便从 Excel 认人。"
                />
              </div>

              <div className="form-field" style={{ marginBottom: 16 }}>
                <label>SteamID（可多个）</label>
                <IdentityEditor
                  kind="steam"
                  items={form.steam_ids || []}
                  onChange={(next) => setForm((prev) => ({ ...prev, steam_ids: next }))}
                  hint="填 Steam 好友码（纯数字）。主号决定头像与天梯分；主号只能替换不能删空，要换号请先添加新的再设为主。"
                />
              </div>

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-field">
                  <label>所处地区</label>
                  <RegionPicker
                    value={form.region || ''}
                    onChange={(next) => setForm((prev) => ({ ...prev, region: next }))}
                    hint="选到区一级更准 —— 同城约线下局、找队友都靠它"
                  />
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-field">
                  <label>当前天梯分</label>
                  <input type="number" step="1" min="0" max="20000" value={form.score ?? ''} onChange={(e) => setForm({ ...form, score: e.target.value })} />
                  <span className="field-note">填现在的分数，掉了就跟着改</span>
                </div>
                <div className="form-field">
                  <label>历史最高分</label>
                  <input type="number" step="1" min="0" max="20000" value={form.peak_score ?? ''} onChange={(e) => setForm({ ...form, peak_score: e.target.value })} />
                  <span className="field-note">填打上过的最好成绩，不随掉分变化</span>
                  {Number(form.peak_score) > 0 &&
                    Number(form.score) > 0 &&
                    Number(form.peak_score) < Number(form.score) && (
                      <span className="field-note warn">最高分不应低于当前分，确认一下</span>
                    )}
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-field">
                  <label>自报胜率（%）</label>
                  <input type="number" step="1" min="0" max="100" value={form.win_rate ?? ''} onChange={(e) => setForm({ ...form, win_rate: e.target.value })} />
                </div>
              </div>
              <div className="form-field" style={{ marginBottom: 16 }}>
                <label>擅长位置</label>
                <PositionPicker
                  value={form.positions || []}
                  onChange={(next) => setForm({ ...form, positions: next })}
                />
              </div>
              <div className="form-field" style={{ marginBottom: 16 }}>
                <label>擅长英雄</label>
                <div className="hero-pick-row">
                  <OrderedChips
                    items={form.heroes || []}
                    onChange={(next) => setForm({ ...form, heroes: next })}
                    empty="还没选英雄，点右侧「选择英雄」从英雄列表里挑"
                    label="擅长英雄（按顺序）"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost hero-pick-btn"
                    onClick={() => setHeroOpen(true)}
                  >
                    选择英雄
                  </button>
                </div>
                <div className="pos-hint">
                  点「选择英雄」打开英雄列表，可搜索名字/别称，也能按力量、敏捷、智力、全才筛选。
                  群友卡片只展示前 4 个，用 ‹ › 调整顺序。
                </div>
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>自我评价</label>
                <textarea value={form.self_intro || ''} onChange={(e) => setForm({ ...form, self_intro: e.target.value })} rows={2} maxLength={300} />
              </div>
              <PlayerPicker label="默契队友" value={synergy} onChange={setSynergy} placeholder="搜索昵称或 SteamID 添加" />
              <div style={{ height: 14 }} />
              <PlayerPicker label="仇人" hint="仅趣味展示，无实际影响" value={enemies} onChange={setEnemies} placeholder="搜索昵称或 SteamID 添加" />
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
                <button className="btn btn-ghost" onClick={cancelEdit} disabled={saving}>取消</button>
              </div>

              <HeroPicker
                open={heroOpen}
                value={form.heroes || []}
                onClose={() => setHeroOpen(false)}
                onConfirm={(next) => {
                  setForm((prev) => ({ ...prev, heroes: next }));
                  setHeroOpen(false);
                }}
              />
            </div>
          ) : (
            <div className="profile-cards">
              <div className="side-card">
                <h4>基本信息</h4>
                <div className="kv"><span className="k">所处地区</span><span className="v">{regionFull(profile.region) || '未填写'}</span></div>
                <div className="kv"><span className="k">当前天梯分</span><span className="v">{profile.score || '未填写'}</span></div>
                <div className="kv"><span className="k">历史最高分</span><span className="v">{profile.peak_score || '未填写'}</span></div>
                <div className="kv"><span className="k">擅长位置</span><span className="v">{(profile.positions || []).join(' / ') || '未填写'}</span></div>
                <div className="kv"><span className="k">自报胜率</span><span className="v">{profile.win_rate || 0}%</span></div>
                {profile.self_intro && (
                  <div className="kv" style={{ alignItems: 'flex-start' }}><span className="k">自我评价</span><span className="v">{profile.self_intro}</span></div>
                )}
              </div>
              <div className="side-card">
                <h4>擅长英雄</h4>
                <div className="hero-chips">
                  {(profile.heroes || []).length > 0 ? profile.heroes.map((h, i) => <span className="hero-chip" key={i}>{h}</span>) : <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>未填写</span>}
                </div>
              </div>
              <div className="side-card">
                <h4>默契队友</h4>
                <div className="hero-chips">
                  {(profile.synergy_players || []).length > 0 ? profile.synergy_players.map((sid, i) => <Link className="hero-chip" href={'/members/' + sid} key={i}>{nameMap.get(String(sid)) || sid}</Link>) : <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>暂无</span>}
                </div>
              </div>
              <div className="side-card">
                <h4>仇人</h4>
                <div className="hero-chips">
                  {(profile.enemies || []).length > 0 ? profile.enemies.map((sid, i) => <Link className="hero-chip hero-chip-enemy" href={'/members/' + sid} key={i}>{nameMap.get(String(sid)) || sid}</Link>) : <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>暂无</span>}
                </div>
              </div>
            </div>
          )}

          {/* 最近比赛 + AI 战力分析：与群友详情页（/members/[id]）同一套组件 */}
          <div className="detail-grid" style={{ marginTop: 18 }}>
            <div className="detail-main">
              <MatchHistory accountId={profile.game_id} accounts={profile.steamIds} />
            </div>
            <div className="detail-aside">
              <AiPanel
                player={profile}
                nameMap={nameMap}
                me={me}
                sessionReady={ready}
                loginHref="/login?from=/profile"
              />
            </div>
          </div>

          <h2 className="sec-title">我的赛事（{tournaments.length}）</h2>
          <MyTournamentTable items={tournaments} />
        </div>
      </section>
    </>
  );
}
