import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../../../hooks/useSession';
import { getSession, isAdmin } from '../../../lib/auth';

const STATUS_LIST = [
  { value: 'planning', label: '筹办中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'elimination', label: '淘汰赛' },
  { value: 'semifinal', label: '半决赛' },
  { value: 'final', label: '决赛' },
  { value: 'finished', label: '已完赛' },
  { value: 'postponed', label: '延期' },
];

export default function AdminTournament({ denied }) {
  const router = useRouter();
  const { id } = router.query;
  const { me, isAdmin, ready } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('signups');
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  // 赛程编排状态
  const [rounds, setRounds] = useState([]);
  const [matches, setMatches] = useState([]);
  const [newRoundName, setNewRoundName] = useState('');
  const [newMatch, setNewMatch] = useState({ round_id: '', team_a_id: '', team_b_id: '' });

  const load = () => {
    if (!id) return;
    setLoading(true);
    fetch('/api/tournaments/' + id)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setData(d);
          setForm({ ...d.tournament, start_date: (d.tournament.start_date || '').slice(0, 10), end_date: (d.tournament.end_date || '').slice(0, 10) });
        } else {
          setError(d.message || '加载失败');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('加载失败');
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, [id]);

  // 加载赛程
  const loadMatches = () => {
    if (!id) return;
    fetch('/api/tournaments/' + id + '/matches')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setRounds(d.rounds || []);
          setMatches(d.matches || []);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadMatches();
  }, [id]);

  const addRound = async () => {
    if (!newRoundName.trim()) return;
    const r = await fetch('/api/tournaments/' + id + '/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'round', name: newRoundName.trim(), order_no: rounds.length }),
    });
    const d = await r.json();
    if (r.ok) {
      setNewRoundName('');
      loadMatches();
    } else {
      setMsg(d.error || '新建阶段失败');
    }
  };

  const addMatch = async () => {
    if (!newMatch.team_a_id || !newMatch.team_b_id) {
      setMsg('请选择对阵双方队伍');
      return;
    }
    const r = await fetch('/api/tournaments/' + id + '/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team_a_id: newMatch.team_a_id,
        team_b_id: newMatch.team_b_id,
        round_id: newMatch.round_id || null,
        order_no: matches.length,
      }),
    });
    const d = await r.json();
    if (r.ok) {
      setNewMatch({ round_id: '', team_a_id: '', team_b_id: '' });
      loadMatches();
    } else {
      setMsg(d.error || '新建对阵失败');
    }
  };

  const saveScore = async (matchId, field, value) => {
    const body = { matchId, [field]: value };
    // 录入比分后，若能判定胜者则一并写入
    const r = await fetch('/api/tournaments/' + id + '/matches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || '保存失败');
    else loadMatches();
  };

  const saveWinner = async (matchId, winnerTeamId) => {
    const body = { matchId, winner_team_id: winnerTeamId, status: winnerTeamId ? 'finished' : 'scheduled' };
    const r = await fetch('/api/tournaments/' + id + '/matches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || '保存失败');
    else loadMatches();
  };

  const removeMatch = async (matchId) => {
    if (!confirm('确定删除该场对阵？')) return;
    const r = await fetch('/api/tournaments/' + id + '/matches', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || '删除失败');
    else loadMatches();
  };

  const saveInfo = async () => {
    setSaving(true);
    setMsg('');
    const r = await fetch('/api/tournaments/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const d = await r.json();
    setSaving(false);
    if (r.ok) {
      setMsg('已保存');
      load();
    } else {
      setMsg(d.message || d.error || '保存失败');
    }
  };

  const changeStatus = async (status) => {
    const r = await fetch('/api/tournaments/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg('状态已更新为 ' + (STATUS_LIST.find((s) => s.value === status)?.label || status));
      load();
    } else {
      setMsg(d.message || d.error || '切换失败');
    }
  };

  const setCaptain = async (playerId) => {
    setMsg('');
    const r = await fetch('/api/tournaments/' + id + '/captain', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg('已设为队长并生成队伍「' + (d.team?.name || '') + '」');
      load();
    } else {
      setMsg(d.error || '操作失败');
    }
  };

  const unsetCaptain = async (playerId) => {
    setMsg('');
    const r = await fetch('/api/tournaments/' + id + '/captain', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg('已卸任队长');
      load();
    } else {
      setMsg(d.error || '操作失败');
    }
  };

  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问管理后台
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }
  if (!ready) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (!me) {
    return <div className="empty" style={{ padding: '110px 0' }}>请先 <Link href="/login?from=/admin" style={{ color: 'var(--brand)' }}>登录</Link></div>;
  }
  if (!isAdmin) return <div className="empty" style={{ padding: '110px 0' }}>无权访问</div>;

  if (loading) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (error && !data) return <div className="empty" style={{ padding: '110px 0' }}>{error}</div>;

  const signups = data?.signups || [];
  const teams = data?.teams || [];

  return (
    <>
      <Head>
        <title>{data?.tournament?.name || '赛事'} · 管理 · DOTA 群英荟</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <Link href="/admin" className="back-link">← 返回赛事列表</Link>
          <div className="adm-detail-head">
            <h1 style={{ fontSize: '1.7rem' }}>{data?.tournament?.name}</h1>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {msg && <div className="adm-msg">{msg}</div>}

          <div className="side-card" style={{ marginBottom: 18 }}>
            <h4>赛季信息</h4>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-field">
                <label>赛季名称</label>
                <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-field">
                <label>比赛状态</label>
                <select value={form.status || ''} onChange={(e) => changeStatus(e.target.value)}>
                  {STATUS_LIST.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-field">
                <label>开始日期</label>
                <input type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="form-field">
                <label>结束日期</label>
                <input type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-field">
                <label>赞助信息</label>
                <input value={form.sponsor_info || ''} onChange={(e) => setForm({ ...form, sponsor_info: e.target.value })} />
              </div>
              <div className="form-field">
                <label>冠军奖金</label>
                <input value={form.champion_prize || ''} onChange={(e) => setForm({ ...form, champion_prize: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary" onClick={saveInfo} disabled={saving}>
              {saving ? '保存中…' : '保存修改'}
            </button>
          </div>

          <div className="adm-tabs" style={{ marginBottom: 14 }}>
            <button className={`adm-tab ${tab === 'signups' ? 'active' : ''}`} onClick={() => setTab('signups')}>
              报名名单（{signups.length}）
            </button>
            <button className={`adm-tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
              队伍与队长（{teams.length}）
            </button>
            <button className={`adm-tab ${tab === 'matches' ? 'active' : ''}`} onClick={() => setTab('matches')}>
              赛程与结果
            </button>
          </div>

          {tab === 'signups' && (
            <div className="adm-table">
              <div className="adm-row adm-head">
                <div>选手</div><div>分数</div><div>位置</div><div>地区</div><div>操作</div>
              </div>
              {signups.map((s) => (
                <div className="adm-row" key={s.id}>
                  <div className="adm-name">{s.nickname || s.group_nickname || '未命名'}</div>
                  <div>{s.score || '—'}</div>
                  <div>{s.positions || '—'}</div>
                  <div>{s.region || '—'}</div>
                  <div>
                    {s.is_captain ? (
                      <>
                        <span className="adm-captain-tag">队长</span>
                        <button className="adm-link-btn" onClick={() => unsetCaptain(s.player_id)}>卸任</button>
                      </>
                    ) : (
                      <button className="adm-link-btn" onClick={() => setCaptain(s.player_id)}>设为队长</button>
                    )}
                  </div>
                </div>
              ))}
              {signups.length === 0 && <div className="empty">暂无报名</div>}
            </div>
          )}

          {tab === 'teams' && (
            <div className="adm-table">
              <div className="adm-row adm-head">
                <div>队伍</div><div>队长</div><div>成员</div>
              </div>
              {teams.map((t) => (
                <div className="adm-row" key={t.id}>
                  <div className="adm-name">{t.name}</div>
                  <div>{t.captain_nickname || '—'}</div>
                  <div>{t.member_count || 0} 人</div>
                </div>
              ))}
              {teams.length === 0 && <div className="empty">暂无队伍（在报名名单里设为队长可自动建队）</div>}
            </div>
          )}

          {tab === 'matches' && (
            <div>
              <div className="side-card" style={{ marginBottom: 18 }}>
                <h4>赛程编排</h4>
                {teams.length === 0 && (
                  <div className="empty" style={{ padding: '12px 0' }}>暂无队伍，请先在「队伍与队长」里生成队伍</div>
                )}
                {teams.length > 0 && (
                  <>
                    <div className="form-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
                      <div className="form-field">
                        <label>新阶段名</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input value={newRoundName} onChange={(e) => setNewRoundName(e.target.value)} placeholder="例如 淘汰赛 / 半决赛 / 决赛" />
                          <button className="btn btn-primary" onClick={addRound}>＋ 阶段</button>
                        </div>
                      </div>
                      <div className="form-field">
                        <label>所属阶段</label>
                        <select value={newMatch.round_id} onChange={(e) => setNewMatch({ ...newMatch, round_id: e.target.value })}>
                          <option value="">— 不分组 —</option>
                          {rounds.map((rd) => (
                            <option key={rd.id} value={rd.id}>{rd.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="form-row" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
                      <div className="form-field">
                        <label>A 队</label>
                        <select value={newMatch.team_a_id} onChange={(e) => setNewMatch({ ...newMatch, team_a_id: e.target.value })}>
                          <option value="">选择队伍</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>B 队</label>
                        <select value={newMatch.team_b_id} onChange={(e) => setNewMatch({ ...newMatch, team_b_id: e.target.value })}>
                          <option value="">选择队伍</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field">
                        <button className="btn btn-primary" onClick={addMatch}>＋ 对阵</button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="adm-table">
                <div className="adm-row adm-head">
                  <div>阶段</div><div>对阵</div><div>比分</div><div>胜者</div><div>恩怨</div><div>操作</div>
                </div>
                {matches.map((m) => {
                  const rd = rounds.find((r) => r.id === m.round_id);
                  return (
                    <div className="adm-row" key={m.id}>
                      <div>{rd ? rd.name : '—'}</div>
                      <div className="adm-name">
                        {m.team_a_name || '?'} vs {m.team_b_name || '?'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          value={m.team_a_score ?? ''}
                          placeholder="—"
                          style={{ width: 54 }}
                          onChange={(e) => saveScore(m.id, 'team_a_score', e.target.value === '' ? null : Number(e.target.value))}
                        />
                        <span>:</span>
                        <input
                          type="number"
                          value={m.team_b_score ?? ''}
                          placeholder="—"
                          style={{ width: 54 }}
                          onChange={(e) => saveScore(m.id, 'team_b_score', e.target.value === '' ? null : Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <select value={m.winner_team_id || ''} onChange={(e) => saveWinner(m.id, e.target.value === '' ? null : e.target.value)}>
                          <option value="">—</option>
                          <option value={m.team_a_id}>{m.team_a_name}</option>
                          <option value={m.team_b_id}>{m.team_b_name}</option>
                        </select>
                      </div>
                      <div>
                        {m.is_grudge ? <span className="grudge-tag">⚔ 恩怨局</span> : '—'}
                      </div>
                      <div>
                        <button className="adm-link-btn" onClick={() => removeMatch(m.id)}>删除</button>
                      </div>
                    </div>
                  );
                })}
                {matches.length === 0 && <div className="empty">暂无对阵，请在上方编排</div>}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
