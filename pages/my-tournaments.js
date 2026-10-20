import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../hooks/useSession';
import MyTournamentTable from '../components/MyTournamentTable';
import { mergeMyTournaments } from '../lib/tournament-format.mjs';

/**
 * 独立版「我的赛事」。
 * 内容已并入 /profile 与 /tournaments 两页，这里保留路由做兜底入口，
 * 表格与口径都走共享组件，避免两处渲染不一致。
 */
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
    Promise.all([
      fetch('/api/profile').then((r) => r.json()).catch(() => ({})),
      fetch('/api/my-tournaments').then((r) => r.json()).catch(() => ({})),
    ])
      .then(([d, m]) => {
        setItems(mergeMyTournaments(d.tournaments || [], m.tournaments || []));
        setBound(m.bound !== false && d.bound !== false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ready, me]);

  if (!ready || loading) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        加载中…
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>我的赛事 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>
            我的<span className="hl">赛事</span>
          </h1>
          <p>我报名的比赛、我的队长身份与所在队伍</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {!bound ? (
            <div className="empty" style={{ padding: '20px 0' }}>
              你的账号还未绑定选手资料，请先
              <Link href="/profile" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                补填选手资料
              </Link>
              。
            </div>
          ) : (
            <MyTournamentTable items={items} />
          )}
        </div>
      </section>
    </>
  );
}
