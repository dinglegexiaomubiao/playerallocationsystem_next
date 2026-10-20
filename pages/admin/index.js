import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import { getSession, isAdmin } from '../../lib/auth';

// 7 态状态机
const STATUS_LIST = [
  { value: 'planning', label: '筹办中', color: '#6b7280', bg: '#f1f5f9' },
  { value: 'ongoing', label: '进行中', color: '#185FA5', bg: '#E6F1FB' },
  { value: 'elimination', label: '淘汰赛', color: '#0F6E56', bg: '#E1F5EE' },
  { value: 'semifinal', label: '半决赛', color: '#534AB7', bg: '#EEEDFE' },
  { value: 'final', label: '决赛', color: '#A32D2D', bg: '#FCEBEB' },
  { value: 'finished', label: '已完赛', color: '#3B6D11', bg: '#EAF3DE' },
  { value: 'postponed', label: '延期', color: '#854F0B', bg: '#FAEEDA' },
];
const STATUS_MAP = Object.fromEntries(STATUS_LIST.map((s) => [s.value, s]));

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status || '未知', color: '#6b7280', bg: '#f1f5f9' };
  return (
    <span className="adm-status" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

export default function Admin({ denied }) {
  const { me, isAdmin, ready } = useSession();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', start_date: '', end_date: '', sponsor_info: '', champion_prize: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/tournaments')
      .then((r) => r.json())
      .then((d) => {
        setTournaments(d.tournaments || []);
        setLoading(false);
      })
      .catch(() => {
        setError('加载失败');
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    const r = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createForm.name.trim(),
        start_date: createForm.start_date || null,
        end_date: createForm.end_date || null,
        sponsor_info: createForm.sponsor_info || null,
        champion_prize: createForm.champion_prize || null,
      }),
    });
    const d = await r.json();
    if (r.ok) {
      setShowCreate(false);
      setCreateForm({ name: '', start_date: '', end_date: '', sponsor_info: '', champion_prize: '' });
      load();
    } else {
      setError(d.error || d.message || '创建失败');
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
  if (!ready) {
    return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  }
  if (!me) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        请先
        <Link href="/login?from=/admin" style={{ color: 'var(--brand)', fontWeight: 600 }}>登录</Link>
        后再进入管理后台。
      </div>
    );
  }
  if (!isAdmin) {
    return <div className="empty" style={{ padding: '110px 0' }}>无权访问管理后台</div>;
  }

  return (
    <>
      <Head>
        <title>管理后台 · DOTA 群英荟</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>管理<span className="hl">后台</span></h1>
          <p>赛事管理 · 报名名单 · 队伍与队长 · 赛程结果</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-bar">
            <div className="adm-tabs">
              <span className="adm-tab active">赛事管理</span>
              <span className="adm-tab">群友管理</span>
              <span className="adm-tab">美食管理</span>
            </div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              ＋ 新建赛季
            </button>
          </div>

          {showCreate && (
            <div className="adm-create">
              <form onSubmit={handleCreate}>
                <div className="adm-create-head">
                  <span>新建赛季</span>
                  <button type="button" className="adm-close" onClick={() => setShowCreate(false)}>×</button>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>赛季名称</label>
                    <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="例如 第十届" />
                  </div>
                  <div className="form-field">
                    <label>开始日期</label>
                    <input type="date" value={createForm.start_date} onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>结束日期</label>
                    <input type="date" value={createForm.end_date} onChange={(e) => setCreateForm({ ...createForm, end_date: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>赞助信息</label>
                    <input value={createForm.sponsor_info} onChange={(e) => setCreateForm({ ...createForm, sponsor_info: e.target.value })} placeholder="赞助商 / 赞助内容" />
                  </div>
                  <div className="form-field">
                    <label>冠军奖金</label>
                    <input value={createForm.champion_prize} onChange={(e) => setCreateForm({ ...createForm, champion_prize: e.target.value })} placeholder="例如 ¥500" />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary">创建</button>
              </form>
            </div>
          )}

          {error && <div className="adm-error">{error}</div>}
          {loading && <div className="empty">加载中…</div>}

          <div className="adm-table">
            <div className="adm-row adm-head">
              <div>赛季</div>
              <div>状态</div>
              <div>起止</div>
              <div>操作</div>
            </div>
            {tournaments.map((t) => (
              <div className="adm-row" key={t.id}>
                <div className="adm-name">{t.name}</div>
                <div><StatusBadge status={t.status} /></div>
                <div className="adm-date">
                  {t.start_date ? String(t.start_date).slice(0, 10) : '—'} ~ {t.end_date ? String(t.end_date).slice(0, 10) : '—'}
                </div>
                <div>
                  <Link className="adm-link" href={'/admin/tournaments/' + t.id}>管理</Link>
                </div>
              </div>
            ))}
            {!loading && tournaments.length === 0 && (
              <div className="empty">暂无赛事，点击右上角新建</div>
            )}
          </div>
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
