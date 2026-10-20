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
            <div className="empty" style={{ padding: '40px 0' }}>
              赛程编排将在后续版本开放
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
