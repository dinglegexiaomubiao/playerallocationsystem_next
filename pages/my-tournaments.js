import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

/**
 * 「我的赛事」已经并入 /tournaments 的第二个 Tab（?tab=mine）。
 *
 * 这里保留路由只做重定向：老链接、书签、外部引用都还能进得来，
 * 但内容不再维护两份 —— 两套页面各写一遍筛选逻辑迟早会走样。
 *
 * 用 replace 而不是 push，避免用户点返回又弹回这个空壳页。
 */
export default function MyTournaments() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    router.replace('/tournaments?tab=mine');
  }, [router.isReady]);

  return (
    <>
      <Head>
        <title>我的赛事 · 深圳LaRoja Dota2社区</title>
      </Head>
      <div className="empty" style={{ padding: '110px 0' }}>
        正在前往「我的赛事」…
      </div>
    </>
  );
}
