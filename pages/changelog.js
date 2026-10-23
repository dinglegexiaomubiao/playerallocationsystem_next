import Head from 'next/head';
import Link from 'next/link';
import { getSession, isAdminName } from '../lib/auth';
import { changelogByVersion, LATEST_VERSION } from '../lib/changelog';

/**
 * 更新日志页。
 *
 * 为什么要独立一页：首页右栏只摆 6 条，而且每条压成一行，装不下「版本 + 日期 + 说明」。
 * 这里按版本分组，能写清楚「哪个版本、哪天、改了什么」。
 *
 * 管理员条目在 getServerSideProps 就过滤掉了 —— 前端隐藏不算隐藏，
 * 数据已经在 HTML 里了，看一眼源码就有。
 */
export default function Changelog({ groups, latestVersion }) {
  return (
    <>
      <Head>
        <title>更新日志 · 深圳LaRoja Dota2社区</title>
        <meta name="description" content="社区站每次改了什么，按版本记录" />
      </Head>

      <section className="page-hero">
        <div className="wrap hero-bar">
          <div className="hero-bar-main">
            <h1>
              更新<span className="hl">日志</span>
            </h1>
            <p>
              社区站每个版本改了什么，按时间倒序。当前版本 {latestVersion}
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {groups.length === 0 && <div className="empty">还没有更新记录</div>}

          <div className="changelog-list">
            {groups.map((g) => (
              <article className="changelog-group" key={g.version}>
                <header className="changelog-head">
                  <span className="changelog-ver">{g.version}</span>
                  <time className="changelog-date" dateTime={g.date}>
                    {g.date}
                  </time>
                  <span className="changelog-summary">{g.title}</span>
                </header>
                <ul className="changelog-items">
                  {g.items.map((it, i) => (
                    <li className="changelog-item" key={i}>
                      <span className="changelog-dot" aria-hidden="true" />
                      {it.href ? (
                        <Link href={it.href}>{it.title}</Link>
                      ) : (
                        <span>{it.title}</span>
                      )}
                      {/* 这条只对管理员可见（服务端已经过滤过，能渲染到这里的都是管理员） */}
                      {it.adminOnly && <span className="changelog-admin">管理</span>}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <p className="changelog-foot">
            更早的改动没有存档。想看最近的动态，回<Link href="/">首页</Link>右栏，或者去
            <Link href="/members">群友信息</Link>看看。
          </p>
        </div>
      </section>
    </>
  );
}

export async function getServerSideProps(ctx) {
  const session = getSession(ctx.req);
  const isAdmin = !!session && isAdminName(session.name);
  return {
    props: {
      groups: changelogByVersion({ isAdmin }),
      latestVersion: LATEST_VERSION,
    },
  };
}
