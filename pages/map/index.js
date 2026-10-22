import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import MemberMap from '../../components/MemberMap';

/**
 * 群友分布（/map）
 *
 * 三级下钻：全国（省级区）→ 省（各市）→ 市（各区县）。
 * 打开时的落点：**登录了且填了地区的，直接落在自己所在的市；否则落深圳市**。
 * 理由很实际——这个群 90% 的人在深圳，一进来就看见自己那块比先看全国更有用，
 * 「看整个中国」是一次点击的事（面包屑第一级就是全国）。
 *
 * 数据：首屏走 getServerSideProps 直出（和 /members 同样的理由：手机上 JS 没跑起来
 * 时至少还能看见地图和名单）；下钻由浏览器打 /api/map/geo，两者共用 lib/map-data.mjs。
 *
 * ⚠ 「悬停高亮」和「点击选中」是两个独立状态，别合并：
 *   一开始两者共用一个 state，鼠标一移开就 onHover(null) 把点击的结果也清掉了，
 *   于是右侧明细刚出来就消失。现在 hovered 只管描边高亮，active 只管右侧明细。
 *
 * ⚠ 点区块 = 下钻（能下钻时），看名单靠下面「各区人数」的 chip。
 *   两个动作都挂在区块上没有好的区分方式，下钻是主用例，所以优先给它。
 */
export default function MapPage({ initial, initialError }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState((initial && initial.notice) || null); // 下钻失败/无下级的提示
  const [selected, setSelected] = useState([]);
  const [showHeat, setShowHeat] = useState(true);
  const [showFoods, setShowFoods] = useState(true);
  const [active, setActive] = useState(null); // 选中看明细的区块
  const [hovered, setHovered] = useState(null); // 悬停的区块（只影响描边）
  const [kw, setKw] = useState('');

  const scope = view?.scope || null;
  const areas = view?.areas || [];
  const stats = view?.stats || { players: 0, filled: 0, missing: 0, foods: 0 };
  const depth = scope ? scope.depth : 0;
  const ancestors = (scope && scope.ancestors) || [];

  // 能上地图的人：这一级区块下挂着的所有人
  const placeable = useMemo(() => {
    const list = [];
    for (const a of areas) {
      for (const p of a.players || []) list.push({ ...p, area: a.name });
    }
    return list;
  }, [areas]);

  const matches = useMemo(() => {
    const q = kw.trim().toLowerCase();
    if (!q) return [];
    return placeable.filter((p) => String(p.nickname).toLowerCase().includes(q)).slice(0, 8);
  }, [kw, placeable]);

  const ranking = useMemo(
    () => [...areas].sort((a, b) => b.playerCount - a.playerCount || b.foodCount - a.foodCount),
    [areas]
  );

  const activeData = active ? areas.find((a) => a.name === active) : null;
  const covered = areas.filter((a) => a.playerCount || a.foodCount).length;

  const toggleMember = (id) => {
    const key = String(id);
    setSelected((prev) => (prev.some((x) => x === key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  /** 下钻/回退到某一级 */
  const goTo = async (adcode) => {
    const code = String(adcode || '');
    if (!code || loading || (scope && code === String(scope.adcode))) return;
    setLoading(true);
    setNote(null);
    setActive(null);
    try {
      const r = await fetch(`/api/map/geo?adcode=${code}`, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (!j.ok) {
        setNote(
          j.reason === 'no-children'
            ? '这里不设下级区县，没有可以继续往下钻的地图。'
            : j.error || '这一级地图加载失败，稍后再试。'
        );
        return;
      }
      setView({
        scope: j.scope,
        geo: j.geo,
        areas: j.areas,
        here: j.here,
        me: j.me,
        elsewhere: j.elsewhere,
        stats: j.stats,
      });
      // 无下级的城市会退回上一级并带 notice，URL 要跟着实际显示的层级走
      if (j.notice) setNote(j.notice);
      router.replace({ pathname: '/map', query: { adcode: String(j.scope.adcode) } }, undefined, { shallow: true });
    } catch (e) {
      setNote('网络不给力，地图没取到。');
    } finally {
      setLoading(false);
    }
  };

  const onPick = (area) => {
    if (area.canDrill) goTo(area.adcode);
    else setActive((prev) => (prev === area.name ? null : area.name));
  };

  const toggleArea = (name) => setActive((prev) => (prev === name ? null : name));

  const missingRatio = stats.players ? stats.missing / stats.players : 0;
  const hereCount = (view?.here && view.here.players.length) || 0;

  return (
    <>
      <Head>
        <title>群友分布 · 深圳LaRoja Dota2社区</title>
        <meta
          name="description"
          content="群友分布在全国哪些省市区、群友推荐的美食在哪里，按行政区聚合的分布示意图，支持全国 / 省 / 市逐级查看。"
        />
      </Head>

      <section className="page-hero">
        <div className="wrap hero-bar">
          <div className="hero-bar-main">
            <h1>
              群友<span className="hl">分布</span>
            </h1>
            <p>
              {stats.filled} / {stats.players} 位群友填了地区 · {stats.foods} 家美食 ·
              位置只到「区」，不显示任何人的具体住址
            </p>
          </div>
          {missingRatio < 0.3 && (
            <div className="hero-actions">
              <Link href="/profile" className="btn btn-primary">
                补填我的地区
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {initialError ? <div className="map-error">地图数据读取失败：{initialError}</div> : null}

          {missingRatio >= 0.3 && (
            <div className="map-cta">
              <div className="map-cta-main">
                <strong>还有 {stats.missing} 位群友没填地区</strong>
                <span>
                  没填地区的人不会出现在地图上，热力也只能看出个大概。地区由群友自己填，
                  或由管理员在后台补。
                </span>
              </div>
              <div className="map-cta-actions">
                <Link href="/profile" className="btn btn-primary">
                  去补填我的地区
                </Link>
              </div>
            </div>
          )}

          {view ? (
            <>
              {/* ---- 面包屑：全国 › 广东省 › 深圳市 ----
                  已经在「全国」时不重复渲染「全国」链接（否则变成 全国 › 全国） */}
              <nav className="map-crumb" aria-label="行政区层级">
                <ol>
                  {!scope?.isRoot && (
                    <li>
                      <button type="button" className="map-crumb-link" onClick={() => goTo('100000')}>
                        全国
                      </button>
                    </li>
                  )}
                  {ancestors
                    .filter((a) => String(a.adcode) !== '100000')
                    .map((a) => (
                      <li key={a.adcode}>
                        <button type="button" className="map-crumb-link" onClick={() => goTo(a.adcode)}>
                          {a.name}
                        </button>
                      </li>
                    ))}
                  <li>
                    <span className="map-crumb-now" aria-current="page">
                      {scope ? scope.name : '—'}
                    </span>
                  </li>
                </ol>
                {view.me ? (
                  <span className="map-crumb-me">
                    你填的是「{view.me.label}」，已经落在对应的市
                  </span>
                ) : null}
                {loading ? <span className="map-crumb-loading">地图加载中…</span> : null}
              </nav>

              {note ? <div className="map-note">{note}</div> : null}

              <div className="map-layout">
                <div className="map-main">
                  {/* ---- 折叠面板 1：只看这几个人 ---- */}
                  <details className="map-fold" open>
                    <summary>
                      <span className="map-fold-title">只看这几个人</span>
                      <span className="map-fold-meta">
                        {selected.length ? `已选 ${selected.length} 人` : `本图可定位 ${placeable.length} 人`}
                      </span>
                    </summary>
                    <div className="map-fold-body">
                      <input
                        className="map-search"
                        value={kw}
                        onChange={(e) => setKw(e.target.value)}
                        placeholder="搜昵称，选中的人会在地图上标出来"
                      />
                      {matches.length > 0 && (
                        <ul className="map-hits">
                          {matches.map((p) => {
                            const on = selected.includes(String(p.id));
                            return (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  className={'map-hit' + (on ? ' is-on' : '')}
                                  onClick={() => toggleMember(p.id)}
                                >
                                  <span className="map-hit-name">{p.nickname}</span>
                                  <span className="map-hit-district">{p.area}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {kw.trim() && matches.length === 0 && (
                        <p className="map-panel-hint">本图这一级没有他；换到上一级或全国看看。</p>
                      )}
                      {selected.length > 0 && (
                        <div className="map-chips">
                          {selected.map((id) => {
                            const p = placeable.find((x) => String(x.id) === id);
                            const name = p ? p.nickname : (placeable.find((x) => String(x.id) === id) || {}).nickname;
                            return (
                              <button
                                type="button"
                                key={id}
                                className="map-chip"
                                onClick={() => toggleMember(id)}
                                title={p ? '点一下取消' : '这个人不在当前这一级'}
                              >
                                {name || id}
                                <span aria-hidden="true"> ×</span>
                              </button>
                            );
                          })}
                          <button type="button" className="map-chip map-chip-clear" onClick={() => setSelected([])}>
                            清空
                          </button>
                        </div>
                      )}
                    </div>
                  </details>

                  {/* ---- 折叠面板 2：各区块人数（点一下看名单，不是下钻）---- */}
                  <details className="map-fold" open>
                    <summary>
                      <span className="map-fold-title">
                        {depth === 0 ? '各省人数' : depth === 1 ? '各市人数' : '各区人数'}
                      </span>
                      <span className="map-fold-meta">点一下看这里的群友和美食</span>
                    </summary>
                    <div className="map-fold-body">
                      <div className="map-rank-chips">
                        {ranking.map((a) => (
                          <button
                            type="button"
                            key={a.name}
                            className={
                              'map-rank-chip' +
                              (active === a.name ? ' is-active' : '') +
                              (hovered === a.name ? ' is-hover' : '') +
                              (a.playerCount ? '' : ' is-empty')
                            }
                            onClick={() => toggleArea(a.name)}
                            onMouseEnter={() => setHovered(a.name)}
                            onMouseLeave={() => setHovered(null)}
                          >
                            <span className="map-rank-chip-name">{a.name}</span>
                            <span className="map-rank-chip-num">
                              {a.playerCount} 人{a.foodCount ? ` · ${a.foodCount} 家` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </details>

                  <section className="map-canvas-card">
                    <div className="map-toolbar">
                      <label className="map-switch">
                        <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} />
                        群友热力
                      </label>
                      <label className="map-switch">
                        <input type="checkbox" checked={showFoods} onChange={(e) => setShowFoods(e.target.checked)} />
                        美食标注
                      </label>
                      <span className="map-toolbar-hint">
                        {active ? `已选中 ${active}` : depth >= 2 ? '点区块看详情' : '点区块进入下一级'}
                      </span>
                    </div>

                    <div className={'map-canvas' + (loading ? ' is-loading' : '')}>
                      <MemberMap
                        geo={view.geo}
                        areas={areas}
                        depth={depth}
                        labelAll={depth > 0}
                        selectedIds={selected}
                        showHeat={showHeat}
                        showFoods={showFoods}
                        active={active}
                        hovered={hovered}
                        onHover={setHovered}
                        onPick={onPick}
                      />
                    </div>
                    <p className="map-pan-hint">
                      {depth >= 2 ? '地图可左右滑动查看 · 点区块看详情' : '点区块进入下一级 · 面包屑可返回'}
                    </p>

                    <div className="map-foot">
                      <span className="map-legend-item">
                        <i className="map-dot map-dot-heat" />
                        区块越红人越多
                      </span>
                      <span className="map-legend-item">
                        <i className="map-dot map-dot-food" />
                        美食（按菜系着色）
                      </span>
                      <span className="map-legend-item">
                        <i className="map-dot map-dot-member" />
                        选中的群友
                      </span>
                      <span className="map-source">
                        行政区划示意：{String((view.geo && view.geo.source) || '').split('（')[0]}
                      </span>
                    </div>
                  </section>
                </div>

                {/* ---- 右侧：当前选中的区块 ---- */}
                <aside className="map-side">
                  <div className="map-panel">
                    {activeData ? (
                      <>
                        <h2>
                          {activeData.name}
                          <button
                            type="button"
                            className="map-panel-close"
                            onClick={() => setActive(null)}
                            aria-label="关闭"
                          >
                            ×
                          </button>
                        </h2>
                        <h3 className="map-sub-h">群友 {activeData.playerCount} 人</h3>
                        {activeData.players.length ? (
                          <ul className="map-list">
                            {activeData.players.map((p) => (
                              <li key={p.id}>
                                <Link href={`/members/${p.id}`}>{p.nickname}</Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="map-panel-hint">这里还没有群友填。</p>
                        )}

                        <h3 className="map-sub-h">美食 {activeData.foodCount} 家</h3>
                        {activeData.foods.length ? (
                          <ul className="map-list">
                            {activeData.foods.slice(0, 14).map((f) => (
                              <li key={f.id}>
                                <span className="map-food-name">{f.name}</span>
                                {f.cuisine ? <span className="map-food-tag">{f.cuisine}</span> : null}
                                {f.rating ? <span className="map-food-star">{f.rating} 星</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="map-panel-hint">这里还没有美食记录。</p>
                        )}
                        {activeData.foods.length > 14 && (
                          <p className="map-panel-hint">
                            还有 {activeData.foods.length - 14} 家，去<Link href="/food">群友美食</Link>看全部。
                          </p>
                        )}
                        {activeData.canDrill ? (
                          <button type="button" className="btn map-drill-btn" onClick={() => goTo(activeData.adcode)}>
                            进入{activeData.name}看下一级
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <h2>{scope ? scope.name : '选一个区'}</h2>
                        <p className="map-panel-hint">
                          {depth >= 2
                            ? '点地图上的区块，或上面的人数列表，这里会列出该区的群友和美食。'
                            : '点地图上的区块可以进入下一级；点上面的人数列表，这里会列出该区块的群友和美食。'}
                        </p>
                        <ul className="map-side-stats">
                          <li>
                            <span>本图已定位</span>
                            <strong>{placeable.length} 人</strong>
                          </li>
                          <li>
                            <span>落位美食</span>
                            <strong>{stats.foodsMapped || 0} 家</strong>
                          </li>
                          <li>
                            <span>有内容区块</span>
                            <strong>
                              {covered} / {areas.length}
                            </strong>
                          </li>
                          {view.elsewhere > 0 && (
                            <li>
                              <span>不在本图</span>
                              <strong>{view.elsewhere} 人</strong>
                            </li>
                          )}
                        </ul>
                        {view.elsewhere > 0 && (
                          <p className="map-panel-hint">
                            还有 {view.elsewhere} 位群友在别的地方，
                            <button type="button" className="map-inline-link" onClick={() => goTo('100000')}>
                              去全国图看
                            </button>
                            。
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </aside>
              </div>

              {/* ---- 本级但没填到下一级 ---- */}
              {hereCount > 0 && (
                <section className="map-outside">
                  <h2>
                    在{scope ? scope.name : ''}、但没填到下一级（{hereCount} 人）
                  </h2>
                  <p className="map-panel-hint">
                    地区只填到{scope ? scope.name : '这一级'}，所以只能算进总数、画不到具体区块上。
                  </p>
                  <div className="map-outside-card">
                    <div className="map-outside-names">{view.here.players.map((p) => p.nickname).join('、')}</div>
                  </div>
                </section>
              )}

              {/* ---- 境外 ---- */}
              {view.outside?.length > 0 && (
                <section className="map-outside">
                  <h2>境外的群友</h2>
                  <p className="map-panel-hint">这些群友不在中国境内，画不到这张图上。</p>
                  <div className="map-outside-grid">
                    {view.outside.map((g) => (
                      <div key={g.label} className="map-outside-card">
                        <div className="map-outside-city">
                          {g.label} <span>{g.players.length} 人</span>
                        </div>
                        <div className="map-outside-names">{g.players.map((p) => p.nickname).join('、')}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ---- 认不出是哪里 ---- */}
              {view.unknown?.length > 0 && (
                <details className="map-missing">
                  <summary>有 {view.unknown.length} 位群友的地区填得认不出来（点开看）</summary>
                  <div className="map-missing-names">
                    {view.unknown.map((p) => `${p.nickname}（${p.region || '空'}）`).join('、')}
                  </div>
                  <p className="map-panel-hint">
                    比如只写了「家里」或门牌号。改成「省 市 区」的格式就能出现在地图上。
                  </p>
                </details>
              )}

              {/* ---- 完全没填地区 ---- */}
              {view.missing?.length > 0 && (
                <details className="map-missing">
                  <summary>没填地区的 {view.missing.length} 位群友（点开看名单）</summary>
                  <div className="map-missing-names">{view.missing.map((p) => p.nickname).join('、')}</div>
                  <p className="map-panel-hint">
                    地区是群友自己填的，本人或管理员都可以补。补完刷新这个页面就会出现。
                    <Link href="/profile"> 去我的个人信息</Link>
                  </p>
                </details>
              )}
            </>
          ) : (
            <p className="map-panel-hint">地图数据没能加载出来，稍后刷新试试。</p>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * 服务端直出。用动态 import 确保 lib/map-data（依赖 pg / fs）不会被打进客户端产物。
 * 「我」的地区从会话里取，直接决定首屏落在哪一级。
 */
export async function getServerSideProps(ctx) {
  const tracked = await (async () => {
    try {
      const { trackServerPageView } = await import('../../lib/server-track');
      return await trackServerPageView(ctx.req, '/map');
    } catch (e) {
      return false;
    }
  })();

  try {
    const { getSession } = await import('../../lib/auth');
    const session = getSession(ctx.req);
    const { loadMapData } = await import('../../lib/map-data.mjs');
    const adcode = ctx.query && ctx.query.adcode ? String(ctx.query.adcode) : undefined;
    const data = await loadMapData({ adcode, sessionName: session ? session.name : null });
    return { props: { initial: data, initialError: null, __pageViewTracked: tracked } };
  } catch (e) {
    return {
      props: {
        initial: null,
        initialError: (e && e.message) || '服务端读取分布数据失败',
        __pageViewTracked: tracked,
      },
    };
  }
}
