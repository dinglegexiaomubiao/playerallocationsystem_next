import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Avatar from '../../components/Avatar';
import GuildManageButton from '../../components/GuildManageButton';
import {
  guildColor,
  GUILD_ALPHA_START,
  GUILD_ALPHA_END,
  GUILD_BORDER_ALPHA,
  hexToRgba,
} from '../../lib/guild-colors.mjs';
import { regionShort } from '../../lib/regions';
import { ensureGuildTables } from '../../lib/db';
import { getSession } from '../../lib/auth';
import { guildById, playerIdOfAccount } from '../../lib/guild.mjs';
import { toSerializable } from '../../lib/serialize.mjs';

/** ISO → 2026-10-23。只在服务端跑，见下面 why。 */
const dayOf = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function getServerSideProps(ctx) {
  try {
    await ensureGuildTables();

    const guild = await guildById(ctx.params.id);
    if (!guild) {
      // 走友好提示而不是 Next 内置 404：这个站没写 pages/404.js，
      // 内置那页是光秃秃的黑底白字，掉出去就回不来了
      ctx.res.statusCode = 404;
      return { props: { guild: null, notFound: true } };
    }

    const session = getSession(ctx.req);
    const viewerId = session && session.name ? await playerIdOfAccount(session.name) : null;
    const me = viewerId ? guild.members.find((m) => m.playerId === Number(viewerId)) : null;

    // 日期在服务端就格式化成字符串：
    // 放到客户端算会因时区不同导致 SSR 与 hydration 的文本对不上（React 报 mismatch），
    // 而且服务器在 Asia/Shanghai、用户在深圳，服务端算出来的日期才是他们眼里的日期
    return {
      props: {
        guild: toSerializable(guild),
        myRole: me ? me.role : null,
        joinedDays: guild.members.map((m) => dayOf(m.joinedAt)),
        foundedDay: dayOf(guild.createdAt),
      },
    };
  } catch (e) {
    console.error('帮派主页取数失败:', e);
    return { props: { guild: null, notFound: false, loadError: true } };
  }
}

export default function GuildDetailPage({ guild, myRole, joinedDays = [], foundedDay = '', notFound, loadError }) {
  const router = useRouter();

  if (!guild) {
    return (
      <>
        <Head>
          <title>{notFound ? '没有这个帮派' : '帮派加载失败'} · 深圳LaRoja Dota2社区</title>
        </Head>
        <section className="page-hero">
          <div className="wrap hero-bar">
            <div className="hero-bar-main">
              <h1>{notFound ? '没有这个帮派' : '帮派没加载出来'}</h1>
              <p>
                {notFound
                  ? '要么名字被改过，要么已经解散了。'
                  : '可能是网络抽了一下，刷新试试。'}
              </p>
            </div>
          </div>
        </section>
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Link href="/guilds" className="btn btn-ghost btn-sm">
              ← 回帮派列表
            </Link>
          </div>
        </section>
      </>
    );
  }

  const c = guildColor(guild.colorKey);
  const isMine = !!myRole;
  const isLeader = myRole === 'leader';
  const members = guild.members || [];

  const gradient = c
    ? {
        backgroundImage: `linear-gradient(135deg, ${hexToRgba(c.solid, GUILD_ALPHA_START)}, ${hexToRgba(
          c.solid,
          GUILD_ALPHA_END
        )})`,
      }
    : undefined;

  return (
    <>
      <Head>
        <title>{`${guild.name} · 帮派 · 深圳LaRoja Dota2社区`}</title>
        <meta
          name="description"
          content={
            guild.slogan
              ? `${guild.name}：${guild.slogan}。${guild.memberCount} 人。`
              : `${guild.name}，${guild.memberCount} 人的帮派。`
          }
        />
      </Head>

      <section className="guild-hero" style={gradient}>
        <div className="wrap">
          <Link href="/guilds" className="guild-hero-back">
            ← 所有帮派
          </Link>

          <div className="guild-hero-title">
            <span
              className="guild-hero-dot"
              style={c ? { background: c.solid, borderColor: hexToRgba(c.solid, GUILD_BORDER_ALPHA) } : undefined}
              aria-hidden="true"
            />
            <h1>{guild.name}</h1>
            {isMine && (
              <span className={'guild-role' + (isLeader ? '' : ' is-member')}>
                {isLeader ? '我是帮主' : '我在里面'}
              </span>
            )}
          </div>

          {guild.slogan ? (
            <p className="guild-hero-slogan">「{guild.slogan}」</p>
          ) : (
            <p className="guild-hero-slogan is-quiet">这个帮派还没写口号</p>
          )}

          <div className="guild-hero-meta">
            <span>
              帮主{' '}
              <Link href={'/members/' + guild.leaderPlayerId} className="guild-hero-leader">
                {guild.leaderName}
              </Link>
            </span>
            <span className="guild-hero-sep" aria-hidden="true">
              ·
            </span>
            <span>
              <b>{guild.memberCount}</b> / {guild.maxMembers} 人
            </span>
            {foundedDay && (
              <>
                <span className="guild-hero-sep" aria-hidden="true">
                  ·
                </span>
                <span>{foundedDay} 成立</span>
              </>
            )}
          </div>

          {isLeader && (
            <div className="guild-hero-actions">
              {/* 改名 / 解散之后要让 SSR 重新取一遍，否则标题和成员列表还是旧的 */}
              <GuildManageButton guildId={guild.id} onChanged={() => router.replace(router.asPath)} />
            </div>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="guild-list-head">
            <h2>成员</h2>
            <span className="guild-list-count">
              {guild.memberCount} / {guild.maxMembers}
            </span>
          </div>

          <ul className="guild-member-list">
            {members.map((m, i) => {
              const isLeaderRow = m.role === 'leader';
              return (
                <li
                  key={m.playerId}
                  className={'guild-member' + (isLeaderRow ? ' is-leader' : '')}
                >
                  <Link href={'/members/' + m.playerId} className="guild-member-link">
                    <Avatar className="guild-member-avatar" src={m.avatar} name={m.nickname} />
                    {/* 徽标紧贴昵称：飘到右边去就得靠「对齐」找出谁是谁，名单不再像名单 */}
                    <span className="guild-member-main">
                      <span className="guild-member-name">{m.nickname}</span>
                      <span className={'guild-role' + (isLeaderRow ? '' : ' is-member')}>
                        {isLeaderRow ? '帮主' : '成员'}
                      </span>
                    </span>
                    <span className="guild-member-region">{regionShort(m.region) || '—'}</span>
                    <span className="guild-member-since">{joinedDays[i] || '—'} 加入</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {members.length === 0 && (
            <div className="guild-list-empty">
              <p>这个帮派还没有成员 —— 大概是刚建的。</p>
            </div>
          )}

          <p className="src-note">
            {isLeader
              ? '你是帮主：可以邀请群友、改名字和颜色、把人移出去，也可以把帮主位子转给别人。要散伙就解散。'
              : isMine
              ? '要退出这个帮派，回帮派页操作。帮主退出得先转让或解散。'
              : '想加入就找帮主要个邀请 —— 帮派不能自己申请，只能被拉进去。'}
          </p>
        </div>
      </section>
    </>
  );
}
