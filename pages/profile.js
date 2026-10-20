import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../hooks/useSession';
import PlayerPicker from '../components/PlayerPicker';
import PlayerBind from '../components/PlayerBind';
import MyTournamentTable from '../components/MyTournamentTable';
import { mergeMyTournaments } from '../lib/tournament-format.mjs';
import { POSITIONS } from '../lib/options.mjs';

const POSITION_OPTIONS = POSITIONS;

export default function Profile() {
  const router = useRouter();
  const { me, ready } = useSession();

  const [bound, setBound] = useState(true);
  const [profile, setProfile] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

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
          setRegions(d.regions || []);
          if (d.profile) {
            setForm({
              group_nickname: d.profile.group_nickname || '',
              region: d.profile.region || '',
              score: d.profile.score ?? '',
              positions: d.profile.positions || [],
              heroes: (d.profile.heroes || []).join('，'),
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
    setSaving(true);
    setMsg('');
    const body = {
      group_nickname: form.group_nickname || null,
      region: form.region || null,
      score: form.score === '' || form.score === null ? null : Number(form.score),
      positions: form.positions || [],
      heroes: String(form.heroes || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
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
              <button className="btn btn-primary" onClick={startEdit} style={{ marginLeft: 'auto' }}>
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
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-field">
                  <label>群昵称</label>
                  <input value={form.group_nickname || ''} onChange={(e) => setForm({ ...form, group_nickname: e.target.value })} />
                </div>
                <div className="form-field">
                  <label>所处地区（可选已有或新增）</label>
                  <input list="region-options" value={form.region || ''} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="选择或输入新地区" />
                  <datalist id="region-options">
                    {regions.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-field">
                  <label>天梯分数</label>
                  <input type="number" value={form.score ?? ''} onChange={(e) => setForm({ ...form, score: e.target.value })} />
                </div>
                <div className="form-field">
                  <label>自报胜率（%）</label>
                  <input type="number" value={form.win_rate ?? ''} onChange={(e) => setForm({ ...form, win_rate: e.target.value })} />
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-field">
                  <label>擅长位置</label>
                  <select value={form.positions?.[0] || '中单'} onChange={(e) => setForm({ ...form, positions: [e.target.value] })}>
                    {POSITION_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>擅长英雄（逗号分隔）</label>
                  <input value={form.heroes || ''} onChange={(e) => setForm({ ...form, heroes: e.target.value })} />
                </div>
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>自我评价</label>
                <textarea value={form.self_intro || ''} onChange={(e) => setForm({ ...form, self_intro: e.target.value })} rows={2} />
              </div>
              <PlayerPicker label="默契队友" value={synergy} onChange={setSynergy} placeholder="搜索昵称或 SteamID 添加" />
              <div style={{ height: 14 }} />
              <PlayerPicker label="仇人" hint="仅趣味展示，无实际影响" value={enemies} onChange={setEnemies} placeholder="搜索昵称或 SteamID 添加" />
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
                <button className="btn btn-ghost" onClick={cancelEdit} disabled={saving}>取消</button>
              </div>
            </div>
          ) : (
            <div className="profile-cards">
              <div className="side-card">
                <h4>基本信息</h4>
                <div className="kv"><span className="k">所处地区</span><span className="v">{profile.region || '未填写'}</span></div>
                <div className="kv"><span className="k">天梯分</span><span className="v">{profile.score || '未填写'}</span></div>
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

          <h2 className="sec-title">我的赛事（{tournaments.length}）</h2>
          <MyTournamentTable items={tournaments} />
        </div>
      </section>
    </>
  );
}
