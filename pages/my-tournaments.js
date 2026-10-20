import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../hooks/useSession';

const STATUS_MAP = {
  planning: { label: '筹办中', color: '#6b7280', bg: '#f1f5f9' },
  ongoing: { label: '进行中', color: '#185FA5', bg: '#E6F1FB' },
  elimination: { label: '淘汰赛', color: '#0F6E56', bg: '#E1F5EE' },
  semifinal: { label: '半决赛', color: '#534AB7', bg: '#EEEDFE' },
  final: { label: '决赛', color: '#A32D2D', bg: '#FCEBEB' },
  finished: { label: '已完赛', color: '#3B6D11', bg: '#EAF3DE' },
  postponed: { label: '延期', color: '#854F0B', bg: '#FAEEDA' },
  planned: { label: '筹备中', color: '#6b7280', bg: '#f1f5f9' },
  active: { label: '进行中', color: '#185FA5', bg: '#E6F1FB' },
  done: { label: '已结束', color: '#3B6D11', bg: '#EAF3DE' },
};

export default function MyTournaments() {
  const router = useRouter();
  const { me, ready } = useSession();
  const [items, setItems] = useState([]);
  const [bound, setBound] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    if (!me) {
      router.replace('/login?from=/my-tournaments');
      return;
    }
    fetch('/api/my-tournaments')
      .then((r) => r.json())
      .then((d) => {
        setItems(d.tournaments || []);
        setBound(d.bound !== false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ready, me]);

  if (!ready || loading) {
    return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  }

  return (
    <>
      <Head>
        <title>我的赛事 · DOTA 群英荟</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>我的<span className="hl">赛事</span></h1>
          <p>我报名的比赛、我的队长身份与所在队伍</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {!bound && (
            <div className="empty" style={{ padding: '20px 0' }}>
              你的账号还未绑定选手资料，请先
              <Link href="/register" style={{ color: 'var(--brand)', fontWeight: 600 }}>完成注册</Link>
              。
            </div>
          )}

          {bound && items.length === 0 && (
            <div className="empty">
              还没有报名任何赛事。
              <br />
              <Link href="/tournaments" style={{ color: 'var(--brand)', fontWeight: 600 }}>去看看赛事</Link>
            </div>
          )}

          <div className="adm-table">
            <div className="adm-row adm-head">
              <div>赛事</div><div>状态</div><div>我的身份</div><div>我的队伍</div><div>报名时间</div>
            </div>
            {items.map((it) => {
              const st = STATUS_MAP[it.tournament_status] || { label: it.tournament_status || '未知', color: '#6b7280', bg: '#f1f5f9' };
              return (
                <div className="adm-row" key={it.tournament_id}>
                  <div className="adm-name">
                    <Link className="adm-link" href={'/tournaments/' + it.tournament_id}>{it.tournament_name}</Link>
                  </div>
                  <div>
                    <span className="adm-status" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                  </div>
                  <div>
                    {it.is_captain ? <span className="adm-captain-tag">队长</span> : '队员'}
                  </div>
                  <div>
                    {it.teams.length > 0
                      ? it.teams.map((t) => t.name).join('、')
                      : '—'}
                  </div>
                  <div className="adm-date">{it.signed_at ? String(it.signed_at).slice(0, 10) : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
