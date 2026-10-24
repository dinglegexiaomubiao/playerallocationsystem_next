import { useState, useEffect, useMemo, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import ExcelIO from '../../components/ExcelIO';
import useSession from '../../hooks/useSession';
import Avatar from '../../components/Avatar';
import AvatarSync from '../../components/AvatarSync';
import HeroAvatar from '../../components/HeroAvatar';
import MemberFilterPanel from '../../components/member/MemberFilterPanel';
import { PLAYER_COLUMNS, splitList } from '../../lib/excel';
import { tierOf } from '../../lib/tier.mjs';
import { regionFull, regionShort } from '../../lib/regions';
/* 帮派配色：卡片上那层薄渐变和左侧色线都由这个色派生（透明度在 lib 里算过对比度，
   不要在这里另调一个数）。没有帮派时 guildCardStyle 返回 null，卡片按原样渲染。 */
import { guildCardStyle } from '../../lib/guild-colors.mjs';
/* 筛选逻辑统一在 lib/member-filter.mjs（2026-10-23 从本页抽出）。
   帮派的「邀请成员」选择器复用同一份 —— 不要再在这里内联一份筛选条件。 */
import {
  emptyMemberFilters,
  buildRegionHeroFacets,
  buildTierFacets,
  buildScoreFacets,
  buildSearchIndex,
  filterMembers,
  countActiveFilters,
} from '../../lib/member-filter.mjs';

// 天梯分区间、空筛选、搜索哈栈都搬到了 lib/member-filter.mjs —— 帮派邀请选择器要用同一份。
// 本页只负责「持有 filters state」和渲染卡片。

// 复制到剪贴板。navigator.clipboard 只在安全上下文（https / localhost）可用，
// 局域网 IP 访问时会 undefined，所以保留 execCommand 兜底。
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* 落到下面的兜底 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

export default function MembersPage({ initialPlayers = [], initialError = null }) {
  // 首屏数据由 getServerSideProps 直出：弱网 / 手机端 JS 没跑起来时，
  // 群友列表照样能看（以前全靠客户端 fetch，一旦那次请求卡住就是空白 + 永远「加载中」）。
  const [players, setPlayers] = useState(initialPlayers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  // 懒初始化：emptyMemberFilters() 每次返回新对象，避免多页共用同一个被 mutate 的字面量
  const [filters, setFilters] = useState(emptyMemberFilters);
  // 刚复制成功的选手 id，用来把按钮临时切成「已复制」
  const [copiedId, setCopiedId] = useState(null);
  // 当前登录身份，统一走 useSession（登出后所有订阅组件立刻同步）
  const { isAdmin } = useSession();

  const handleCopy = async (e, id, text) => {
    // 卡片整体是个链接，复制按钮必须拦掉冒泡，否则会顺带跳转
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
  };

  // 手动刷新：导入/同步头像后调用，也用于 SSR 失败后的「重试」。
  // 带超时（12s）——弱网下 fetch 可能一直挂着，不给超时就会永远停在加载中。
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    fetch('/api/players', { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`接口返回 ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setPlayers(Array.isArray(d && d.players) ? d.players : []);
        setError(null);
      })
      .catch((e) => {
        setError(
          e && e.name === 'AbortError'
            ? '请求超时（12 秒没有响应），请检查网络后重试'
            : (e && e.message) || '网络异常'
        );
      })
      .finally(() => {
        clearTimeout(timer);
        setLoading(false);
      });
  }, []);

  // 选手 id -> 昵称，用于把「默契选手」里的 id 显示成昵称
  const nameMap = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(String(p.id), p.nickname));
    return m;
  }, [players]);

  // 地区 / 擅长英雄 / 段位 / 分数区间的可选项，以及搜索索引。
  // 计算都搬到了 lib/member-filter.mjs —— 帮派的邀请选择器要用同一份口径，
  // 各写一份迟早漂移（/api/players 当年就是这么变成两套的）。
  const facets = useMemo(() => buildRegionHeroFacets(players), [players]);
  const tierFacets = useMemo(() => buildTierFacets(players), [players]);
  const scoreFacets = useMemo(() => buildScoreFacets(players), [players]);
  const searchIndex = useMemo(() => buildSearchIndex(players), [players]);

  // 筛选 + 排序：同组 OR、跨组 AND。实现在 lib/member-filter.mjs，
  // 与帮派「邀请成员」选择器共用 —— 那边同样要问「谁会打 1 或 5」这类问题。
  const filtered = useMemo(
    () => filterMembers(players, filters, searchIndex),
    [players, filters, searchIndex]
  );

  const activeCount = countActiveFilters(filters);

  const handleImport = async (rows, onProgress) => {
    const list = rows
      .map((row) => ({
        nickname: String(row['昵称'] || '').trim(),
        game_id: String(row['steamID'] || '').trim(),
        group_nickname: String(row['群昵称'] || '').trim(),
        score: Number(row['天梯分']) || 0,
        positions: splitList(row['擅长位置']),
        heroes: splitList(row['擅长英雄']),
        win_rate: Number(row['胜率']) || 0,
        championships: Number(row['冠军数']) || 0,
        synergy_players: splitList(row['默契选手']),
        region: String(row['所处地区'] || '').trim() || null,
        self_intro: String(row['自我评价'] || '').trim() || null,
        enemies: splitList(row['仇人']),
      }))
      .filter((p) => p.nickname);

    if (list.length === 0) {
      alert('没有解析到有效数据，请确认表头与「下载模板」一致');
      return;
    }

    const total = list.length;
    for (let i = 0; i < total; i++) {
      const p = list[i];
      let err = '';
      try {
        const r = await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-excel-import': '1' },
          body: JSON.stringify(p),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) err = d.error || d.message || `请求失败（HTTP ${r.status}）`;
      } catch (e) {
        err = (e && e.message) || '网络错误';
      }
      if (onProgress) onProgress(i + 1, total, { name: p.nickname, error: err });
    }
    reload();
  };

  // 去重：SteamID 相同 或 昵称相同，视为重复。
  // SteamID 要比对「全部号」而不只是主号，否则拿小号重新导入会造出第二条档案。
  const checkDuplicate = (row, existing) => {
    const gid = String(row['steamID'] || '').trim();
    const nick = String(row['昵称'] || '').trim();
    return existing.some((p) => {
      if (nick && (p.nickname || '') === nick) return true;
      if (!gid) return false;
      const all = [p.game_id, ...(p.steamIds || []).map((s) => (s && typeof s === 'object' ? s.accountId : s))]
        .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
        .map(String);
      return all.includes(gid);
    });
  };

  return (
    <>
      <Head>
        <title>群友信息 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap hero-bar">
          <div className="hero-bar-main">
            <h1>
              群友<span className="hl">信息</span>
            </h1>
            <p>共 {players.length} 位群友 · 天梯分、擅长什么位置、爱玩哪些英雄，组队前先摸个底</p>
          </div>
          <div className="hero-actions">
            <AvatarSync isAdmin={isAdmin} onDone={reload} />
            <ExcelIO
              columns={PLAYER_COLUMNS}
              rows={players}
              filename="群友信息.xlsx"
              templateName="群友信息_导入模板.xlsx"
              onImport={handleImport}
              canManage={isAdmin}
              checkDuplicate={checkDuplicate}
            />
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <MemberFilterPanel
            filters={filters}
            onChange={setFilters}
            players={players}
            facets={facets}
            tierFacets={tierFacets}
            scoreFacets={scoreFacets}
            resultCount={filtered.length}
            activeCount={activeCount}
            onReset={() => setFilters(emptyMemberFilters())}
          />

          {loading && <div className="empty">加载中…</div>}
          {error && (
            <div className="empty">
              <div>加载失败：{error}</div>
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>
                  重试
                </button>
              </div>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            activeCount > 0 ? (
              <div className="empty">
                没有符合条件的群友
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 10 }}
                  onClick={() => setFilters(emptyMemberFilters())}
                >
                  清除筛选
                </button>
              </div>
            ) : (
              <div className="empty">还没有群友数据</div>
            )
          )}

          <div className="players-grid">
            {filtered.map((p) => {
              const t = tierOf(p.score || 0);
              const champCount = p.championships || 0;
              // 亚军数优先用接口实算值；老数据（接口未返回该字段）就地按队伍名次兜底
              const runnerUpCount =
                typeof p.runner_up === 'number'
                  ? p.runner_up
                  : (p.records || []).filter((r) => r.team_rank === 2).length;
              const steamId = String(p.game_id || '').trim();
              /* 帮派配色变量：有帮派才挂 style 和 has-guild 类。
                 用 CSS 变量而不是直接拼渐变，是为了让 hover 态的边框、色线也能复用同一个色。 */
              const guildVars = p.guild ? guildCardStyle(p.guild.colorKey) : null;
              return (
                <div className={'p-card' + (guildVars ? ' has-guild' : '')} style={guildVars || undefined} key={p.id}>
                  {/* 整卡可点：绝对定位的链接盖住卡片，复制按钮/steamID 行再浮到它上面 */}
                  <Link
                    href={'/members/' + p.id}
                    className="p-card-hit"
                    aria-label={`查看 ${p.nickname || '选手'} 详情`}
                  />
                  <div className="p-head">
                    <Avatar className="p-avatar" src={p.avatar} name={p.nickname} />
                    <div className="p-head-main">
                      <div className="p-name">{p.nickname || '未命名'}</div>
                      <div className="p-region" title={regionFull(p.region) || '未填写地区'}>
                        <span className="p-region-icon" aria-hidden="true">
                          📍
                        </span>
                        <span className="p-region-val">{regionShort(p.region) || '未填写地区'}</span>
                      </div>
                      {/* 帮派徽标：色点 + 名字。先只做展示，等 P4 有了 /guild/[id]
                          再把它包成链接 —— 现在链出去是 404，不如不给。 */}
                      {p.guild && (
                        <div className="p-guild" title={`所属帮派：${p.guild.name}`}>
                          <span className="p-guild-dot" aria-hidden="true" />
                          <span className="p-guild-name">{p.guild.name}</span>
                        </div>
                      )}
                    </div>
                    <div className={`p-score ${t.cls}`} title={t.label}>
                      {p.score || 0}
                    </div>
                  </div>
                  <div className="p-steam">
                    <span className="p-steam-lbl">steamID</span>
                    <span className="p-steam-val" title={steamId}>
                      {steamId || '未填写'}
                    </span>
                    {steamId && (
                      <button
                        type="button"
                        className={'p-copy' + (copiedId === p.id ? ' is-done' : '')}
                        onClick={(e) => handleCopy(e, p.id, steamId)}
                        title={`复制 steamID：${steamId}`}
                      >
                        {copiedId === p.id ? '已复制' : '复制'}
                      </button>
                    )}
                  </div>
                  <div className="p-tags">
                    {(p.positions || []).length > 0 ? (
                      p.positions.map((x, i) => (
                        <span className="p-tag" key={i}>
                          {x}
                        </span>
                      ))
                    ) : (
                      <span className="p-tag">未填写位置</span>
                    )}
                  </div>
                  {(p.heroes || []).length > 0 && (
                    <div className="p-heroes">
                      <div className="lbl">擅长英雄</div>
                      {p.heroes.slice(0, 4).map((h, i) => (
                        <span className="h" key={i}>
                          <HeroAvatar name={h} className="h-avatar" />
                          {h}
                        </span>
                      ))}
                      {p.heroes.length > 4 && <span className="h h-plain">+{p.heroes.length - 4}</span>}
                    </div>
                  )}
                  {(p.synergy_players || []).length > 0 && (
                    <div className="p-heroes p-synergy">
                      <div className="lbl">默契队友</div>
                      {p.synergy_players.slice(0, 3).map((sid, i) => (
                        <span className="h h-synergy" key={i}>
                          {nameMap.get(String(sid)) || sid}
                        </span>
                      ))}
                      {p.synergy_players.length > 3 && (
                        <span className="h h-synergy">+{p.synergy_players.length - 3}</span>
                      )}
                    </div>
                  )}
                  {(p.enemies || []).length > 0 && (
                    <div className="p-heroes p-enemies">
                      <div className="lbl">仇人</div>
                      {p.enemies.slice(0, 3).map((sid, i) => (
                        <span className="h h-enemy" key={i}>
                          {nameMap.get(String(sid)) || sid}
                        </span>
                      ))}
                      {p.enemies.length > 3 && (
                        <span className="h h-enemy">+{p.enemies.length - 3}</span>
                      )}
                    </div>
                  )}
                  <div className="p-honors">
                    <span className="p-honor gold" title={`冠军 ${champCount} 次`}>
                      <span className="p-honor-icon" aria-hidden="true">
                        🏆
                      </span>
                      <b>{champCount}</b> 冠军
                    </span>
                    <span className="p-honor silver" title={`亚军 ${runnerUpCount} 次`}>
                      <span className="p-honor-icon" aria-hidden="true">
                        🥈
                      </span>
                      <b>{runnerUpCount}</b> 亚军
                    </span>
                  </div>
                  <div className="p-foot">
                    <span>{p.record_count > 0 ? `参赛 ${p.record_count} 届` : '暂无参赛记录'}</span>
                    <span className="p-foot-go">{t.label} →</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * 服务端直出首屏数据。
 *
 * 背景：此前这一页完全靠 useEffect 里 fetch('/api/players')，一旦客户端 JS 没跑起来
 * （微信内置浏览器、弱网、脚本被拦、水合失败），用户看到的就是「空白 + 永远加载中」，
 * 而且 _app 里的埋点也不会发，管理后台访问统计里查无此人。
 * 改成 SSR 后：即使一行 JS 都不执行，HTML 里也已经带着群友列表。
 *
 * 这里用动态 import，确保 lib/player-list（依赖 pg）不会被打进客户端产物。
 */
export async function getServerSideProps(ctx) {
  // 埋点先落：手机端 JS 完全不执行时，管理后台至少还能看到这个人来过。
  // 数据请求（Link 预取 / 客户端跳转）不记，那种情况前端会自己上报。
  const tracked = await (async () => {
    try {
      const { trackServerPageView } = await import('../../lib/server-track');
      return await trackServerPageView(ctx.req, '/members');
    } catch (e) {
      return false;
    }
  })();

  try {
    const { loadPlayerList } = await import('../../lib/player-list');
    const { players } = await loadPlayerList({});
    return {
      props: {
        initialPlayers: players || [],
        initialError: null,
        __pageViewTracked: tracked,
      },
    };
  } catch (e) {
    return {
      props: {
        initialPlayers: [],
        initialError: (e && e.message) || '服务端读取群友列表失败',
        __pageViewTracked: tracked,
      },
    };
  }
}
