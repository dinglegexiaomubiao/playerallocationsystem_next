import { useCallback, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Avatar from '../../components/Avatar';
import GuildPanel from '../../components/GuildPanel';
import { guildColor, hexToRgba, GUILD_BORDER_ALPHA } from '../../lib/guild-colors.mjs';
import { ensureGuildTables } from '../../lib/db';
import { getSession } from '../../lib/auth';
import { listGuilds, playerIdOfAccount } from '../../lib/guild.mjs';
import { toSerializable } from '../../lib/serialize.mjs';

/**
 * 帮派（Tab 页）。
 *
 * 这一页要同时回答两个问题：「我自己在哪个帮」和「群里都有哪些帮」。
 * 所以上半是操作区（GuildPanel，管着创建 / 管理 / 退出 / 待处理邀请），
 * 下半是全景列表。两块不合并 —— 操作区要弹窗要渐变，列表只要一行信息，
 * 硬塞在一起两边都不好用。
 *
 * 没有搜索和筛选：配色互斥（guilds_color_key_uniq）意味着帮派最多 12 个，
 * 十二行以内加筛选器是给自己找事。
 */
export async function getServerSideProps(ctx) {
  try {
    await ensureGuildTables();

    const session = getSession(ctx.req);
    const playerId = session && session.name ? await playerIdOfAccount(session.name) : null;

    // isMine 要按「我是谁」算，所以登录状态会影响排序（自己的帮派置顶）
    const guilds = await listGuilds({ viewerPlayerId: playerId });

    // createdAt / joined_at 都是 timestamptz，pg 给的是 Date 对象。
    // 不转 ISO 会报「Error serializing .guilds[0].createdAt」——
    // 而且只有 dev 下炸、线上正常，最容易误判成「本地坏了」（见 pitfalls 第 15 节）
    return { props: { initialGuilds: toSerializable(guilds) } };
  } catch (e) {
    console.error('帮派列表页取数失败:', e);
    // 帮派表挂了不该让整页 500：GuildPanel 会自己显示错误并提供重试
    return { props: { initialGuilds: [] } };
  }
}

export default function GuildsPage({ initialGuilds }) {
  const [list, setList] = useState(initialGuilds || []);

  // GuildPanel 里创建 / 解散 / 转让 / 退出之后调这里，把列表拉回最新的
  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/guilds', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) setList(d.guilds || []);
    } catch {
      /* 拉不到就保持现状，下次操作还会再拉 */
    }
  }, []);

  const total = list.length;
  const people = list.reduce((n, g) => n + (g.memberCount || 0), 0);

  return (
    <>
      <Head>
        <title>帮派 · 深圳LaRoja Dota2社区</title>
        <meta
          name="description"
          content="群里的小团体都在这里：谁跟谁一伙、几个人、什么颜色。也可以自己拉一支。"
        />
      </Head>

      <section className="page-hero">
        <div className="wrap hero-bar">
          <div className="hero-bar-main">
            <h1>
              群友<span className="hl">帮派</span>
            </h1>
            <p>
              {total > 0
                ? `${total} 个帮派 · ${people} 位群友已经抱团`
                : '还没有人建帮派，第一个建的人先挑颜色'}
            </p>
          </div>
          <div className="hero-actions">
            <span className="guild-hero-note">一支配色只能一个帮派占着</span>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {/* ---- 我的帮派（操作区） ---- */}
          <GuildPanel variant="page" label="我的帮派" onChanged={reload} />

          {/* ---- 全部帮派 ---- */}
          <div className="guild-list-head">
            <h2>所有帮派</h2>
            <span className="guild-list-count">
              {total} / 12<span className="guild-list-count-note">配色用满就没了</span>
            </span>
          </div>

          {total === 0 ? (
            <div className="guild-list-empty">
              <p>一个帮派都还没有。</p>
              <p className="guild-list-empty-hint">
                上面建一个试试 —— 起个名字、挑支配色，群友卡片上就会带上你们的颜色。
              </p>
            </div>
          ) : (
            <ul className="guild-list">
              {list.map((g) => {
                const c = guildColor(g.colorKey);
                const faces = g.headAvatars || [];
                const more = (g.memberCount || 0) - faces.length;
                return (
                  <li key={g.id} className={'guild-row' + (g.isMine ? ' is-mine' : '')}>
                    <Link href={'/guild/' + g.id} className="guild-row-link">
                      <span
                        className="guild-row-bar"
                        style={
                          c
                            ? {
                                background: c.solid,
                                boxShadow: `0 0 0 1px ${hexToRgba(c.solid, GUILD_BORDER_ALPHA)}`,
                              }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                      <span className="guild-row-body">
                        <span className="guild-row-top">
                          <span className="guild-row-name">{g.name}</span>
                          {g.isMine && <span className="guild-row-mine">我的</span>}
                          {g.memberCount >= g.maxMembers && (
                            <span className="guild-row-full">满了</span>
                          )}
                        </span>
                        {g.slogan ? (
                          <span className="guild-row-slogan">「{g.slogan}」</span>
                        ) : (
                          <span className="guild-row-slogan is-quiet">还没写口号</span>
                        )}
                      </span>

                      <span className="guild-row-faces">
                        {faces.map((a) => (
                          <Avatar
                            key={a.playerId}
                            className="guild-face"
                            src={a.avatar}
                            name={a.nickname}
                            alt={`${g.name} 的成员 ${a.nickname}`}
                          />
                        ))}
                        {more > 0 && <span className="guild-face-more">+{more}</span>}
                      </span>

                      <span className="guild-row-count">
                        <b>{g.memberCount}</b>
                        <span>/{g.maxMembers}</span>
                      </span>
                      <span className="guild-row-go" aria-hidden="true">
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="src-note">
            帮派是群里自己拉的小团体，和赛事队伍是两回事 —— 队伍打比赛，帮派只是「我们几个一伙」。
            帮主可以邀请人、改名字和颜色；一人只能在一个帮里。
          </p>
        </div>
      </section>
    </>
  );
}
