import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../../components/Avatar';
import MemberMap from '../../components/MemberMap';
import { memberHref } from '../../lib/member-href';

/**
 * 群友分布（/map）
 *
 * 一屏三件事：深圳各区住了多少人（热力）、好吃的在哪（标注）、指定的几个人在哪。
 *
 * 数据全部走 getServerSideProps 直出 —— 和 /members 同样的理由：手机上 JS 没跑起来时
 * 至少还能看见地图和名单，而不是一片空白。客户端只负责交互（图层开关、选人、点区）。
 *
 * ⚠ 「悬停高亮」和「点击选中」是两个独立状态，别合并：
 *   一开始两者共用一个 state，鼠标一移开就 onHover(null) 把点击的结果也清掉了，
 *   于是右侧明细刚出来就消失。现在 hovered 只管描边高亮，active 只管右侧明细。
 *
 * ⚠ 选区要跟着地址栏走（?dist=南山区）：群友详情的「返回分布图」带上这个参数回来，
 *   否则从详情返回后右栏又是一片空白，用户得重新点一次区。
 *   读它必须放在 useEffect 里 —— 首帧读 router.query 会让 SSR 出来的 HTML 和
 *   客户端首次渲染不一致（hydrate 报错），而且 getServerSideProps 并不知道这个参数。
 */
export default function MapPage({ data, initialError }) {
  const router = useRouter();
  const [selected, setSelected] = useState([]);
  const [showHeat, setShowHeat] = useState(true);
  const [showFoods, setShowFoods] = useState(true);
  const [active, setActive] = useState(null); // 点击选中的区（决定右侧明细）
  const [hovered, setHovered] = useState(null); // 悬停的区（只影响描边）
  const [kw, setKw] = useState('');

  const distParam = Array.isArray(router.query.dist) ? router.query.dist[0] : router.query.dist;

  // 从群友详情返回时带着 ?dist=，用它把右栏还原回去
  useEffect(() => {
    if (typeof distParam === 'string' && distParam) setActive(distParam);
  }, [distParam]);

  // 反过来把选区写回地址栏（shallow：不重跑 getServerSideProps，不新增历史记录）。
  // 这样刷新、复制链接、从详情返回都能落回同一个区。
  // ⚠ 首帧必须跳过：上面那个 effect 的 setActive 是异步的，此刻 active 还是 null，
  //   一跑就会把 /map?dist=南山区 改写成 /map，然后又被还原、再改写 —— 地址栏来回跳。
  const urlSyncReady = useRef(false);
  useEffect(() => {
    if (!urlSyncReady.current) {
      urlSyncReady.current = true;
      return;
    }
    const cur = typeof distParam === 'string' ? distParam : '';
    if (cur === (active || '')) return;
    router.replace(active ? `/map?dist=${encodeURIComponent(active)}` : '/map', undefined, { shallow: true });
  }, [active]); // 故意只跟 active：跟着 distParam 会和自己打架

  const districts = data?.districts || [];
  const stats = data?.stats || { players: 0, filled: 0, missing: 0, foods: 0 };

  // 能上地图的人：已经填到区的人（没填地区的人没法定位，只能出现在下面的名单里）
  const placeable = useMemo(() => {
    const list = [];
    for (const d of districts) {
      for (const p of d.players) list.push({ ...p, district: d.name });
    }
    return list;
  }, [districts]);

  const matches = useMemo(() => {
    const q = kw.trim().toLowerCase();
    if (!q) return [];
    return placeable.filter((p) => String(p.nickname).toLowerCase().includes(q)).slice(0, 8);
  }, [kw, placeable]);

  const ranking = useMemo(
    () => [...districts].sort((a, b) => b.playerCount - a.playerCount || b.foodCount - a.foodCount),
    [districts]
  );

  const activeData = active ? districts.find((d) => d.name === active) : null;

  /**
   * 右栏只列 14 家，排序按「有群友评价的优先 → 星级高 → 新的」。
   * ⚠ 不要直接 slice(0,14) 拿原顺序：数据层是按 id 倒序出来的，
   *   排在前面的都是最新录入、一条评价都还没有的新店，右栏会整片「暂无评价」，
   *   看起来像评价功能没做。真正有内容的店全被挤在后面。
   */
  const sideFoods = useMemo(() => {
    if (!activeData) return [];
    return [...activeData.foods]
      .sort(
        (a, b) =>
          (b.reviewCount || 0) - (a.reviewCount || 0) ||
          (Number(b.rating) || 0) - (Number(a.rating) || 0) ||
          String(b.id).localeCompare(String(a.id))
      )
      .slice(0, 14);
  }, [activeData]);

  const toggleMember = (id) => {
    const key = String(id);
    setSelected((prev) => (prev.some((x) => x === key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  // 点一下选中、再点一下取消；悬停不参与
  const toggleDistrict = (name) => setActive((prev) => (prev === name ? null : name));

  const missingRatio = stats.players ? stats.missing / stats.players : 0;

  return (
    <>
      <Head>
        <title>群友分布 · 深圳LaRoja Dota2社区</title>
        <meta name="description" content="深圳群友分布在哪些区、群友推荐的美食在哪些区，按行政区聚合的分布示意图。" />
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
          {/* 缺地区的人多时下面这块 CTA 会顶出来，hero 里就不再放同一个按钮 */}
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

          {/* 数据不够时先说清楚，别让人对着空地图猜 */}
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

          <div className="map-layout">
            <div className="map-main">
              {/* ---- 折叠面板 1：只看这几个人 ---- */}
              <details className="map-fold" open>
                <summary>
                  <span className="map-fold-title">只看这几个人</span>
                  <span className="map-fold-meta">
                    {selected.length ? `已选 ${selected.length} 人` : `可定位 ${placeable.length} 人`}
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
                              <span className="map-hit-district">{p.district}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {kw.trim() && matches.length === 0 && (
                    <p className="map-panel-hint">没找到；只有填了地区的群友能搜到。</p>
                  )}
                  {selected.length > 0 && (
                    <div className="map-chips">
                      {selected.map((id) => {
                        const p = placeable.find((x) => String(x.id) === id);
                        if (!p) return null;
                        return (
                          <button
                            type="button"
                            key={id}
                            className="map-chip"
                            onClick={() => toggleMember(id)}
                            title="点一下取消"
                          >
                            {p.nickname}
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

              {/* ---- 折叠面板 2：各区人数（横向铺开，占一行，比竖排列表省地方）---- */}
              <details className="map-fold" open>
                <summary>
                  <span className="map-fold-title">各区人数</span>
                  <span className="map-fold-meta">点一下看这个区的群友和美食</span>
                </summary>
                <div className="map-fold-body">
                  <div className="map-rank-chips">
                    {ranking.map((d) => (
                      <button
                        type="button"
                        key={d.name}
                        className={
                          'map-rank-chip' + (active === d.name ? ' is-active' : '') + (hovered === d.name ? ' is-hover' : '')
                        }
                        onClick={() => toggleDistrict(d.name)}
                        onMouseEnter={() => setHovered(d.name)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <span className="map-rank-chip-name">{d.name}</span>
                        <span className="map-rank-chip-num">
                          {d.playerCount} 人{d.foodCount ? ` · ${d.foodCount} 家` : ''}
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
                    {active ? `已选中 ${active}` : '点区块看详情，再点一次取消'}
                  </span>
                </div>

                <div className="map-canvas">
                  <MemberMap
                    geo={data?.geo}
                    districts={districts}
                    selectedIds={selected}
                    showHeat={showHeat}
                    showFoods={showFoods}
                    active={active}
                    hovered={hovered}
                    onHover={setHovered}
                    onPick={toggleDistrict}
                  />
                </div>
                <p className="map-pan-hint">地图可左右滑动查看 · 点区块看详情</p>

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
                    行政区划示意：{String((data?.geo && data.geo.source) || '').split('（')[0]}
                  </span>
                </div>
              </section>
            </div>

            {/* ---- 右侧：当前点击的区 ---- */}
            <aside className="map-side">
              {activeData ? (
                <div className="map-panel">
                  <header className="map-panel-head">
                    <div className="map-panel-head-main">
                      <h2 className="map-panel-name">{activeData.name}</h2>
                      <p className="map-panel-stat">
                        <b>{activeData.playerCount}</b> 位群友 · <b>{activeData.foodCount}</b> 家美食
                      </p>
                    </div>
                    <button
                      type="button"
                      className="map-panel-close"
                      onClick={() => setActive(null)}
                      aria-label="取消选中"
                      title="取消选中"
                    >
                      ×
                    </button>
                  </header>

                  {/* 群友：可折叠。标题条整条是一条色带，和下面的美食一眼分得开 */}
                  <details className="map-group map-group-member" open>
                    <summary>
                      <span className="map-group-title">群友</span>
                      <span className="map-group-count">{activeData.playerCount}</span>
                      <span className="map-group-tip">点名字看资料</span>
                    </summary>
                    <div className="map-group-body">
                      {activeData.players.length ? (
                        <ul className="map-member-list">
                          {activeData.players.map((p) => (
                            <li key={p.id}>
                              {/* 带上 ?dist=，详情页的「返回分布图」才能把右栏还原 */}
                              <Link
                                href={memberHref(p.id, '/map', { dist: activeData.name })}
                                className="map-member"
                              >
                                <Avatar className="map-member-avatar" src={p.avatar} name={p.nickname} />
                                <span className="map-member-name">{p.nickname}</span>
                                <span className="map-member-go" aria-hidden="true">
                                  ›
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="map-group-empty">这个区还没有群友填地区。</p>
                      )}
                    </div>
                  </details>

                  {/* 美食：可折叠，每张卡带星级 + 评价条数 + 最新一条评价 */}
                  <details className="map-group map-group-food" open>
                    <summary>
                      <span className="map-group-title">美食</span>
                      <span className="map-group-count">{activeData.foodCount}</span>
                      <span className="map-group-tip">点卡片去美食页</span>
                    </summary>
                    <div className="map-group-body">
                      {activeData.foods.length ? (
                        <div className="map-food-list">
                          {sideFoods.map((f) => {
                            const score = Number(f.rating);
                            const quote = f.reviews && f.reviews[0];
                            return (
                              <Link
                                key={f.id}
                                href={'/food?focus=' + encodeURIComponent(String(f.id))}
                                className="map-food"
                              >
                                <span className="map-food-head">
                                  <span className="map-food-name">{f.name}</span>
                                  {score > 0 ? (
                                    <span className="map-food-score">
                                      <i aria-hidden="true">★</i>
                                      {score.toFixed(1)}
                                    </span>
                                  ) : (
                                    <span className="map-food-score is-none">未评分</span>
                                  )}
                                </span>
                                <span className="map-food-sub">
                                  {f.cuisine ? <span className="map-food-tag">{f.cuisine}</span> : null}
                                  {f.reviewCount ? (
                                    <span className="map-food-rc">{f.reviewCount} 条评价</span>
                                  ) : (
                                    <span className="map-food-rc is-none">暂无评价</span>
                                  )}
                                </span>
                                {quote ? (
                                  <span className="map-food-quote">
                                    {quote.content}
                                    <em>— {quote.reviewer || '群友'}</em>
                                  </span>
                                ) : null}
                              </Link>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="map-group-empty">这个区还没有美食记录。</p>
                      )}
                      {activeData.foods.length > 14 && (
                        <p className="map-group-empty">
                          还有 {activeData.foods.length - 14} 家没列出，
                          <Link href="/food">去群友美食看全部</Link>。
                        </p>
                      )}
                    </div>
                  </details>
                </div>
              ) : (
                <div className="map-panel">
                  <h2>选一个区</h2>
                  <p className="map-panel-hint">
                    点地图上的区块，或上面「各区人数」里的任意一个区，这里会列出该区的群友和美食。
                  </p>
                  <ul className="map-side-stats">
                    <li>
                      <span>已定位群友</span>
                      <strong>{placeable.length} 人</strong>
                    </li>
                    <li>
                      <span>已落区美食</span>
                      <strong>{stats.foods - (data?.foodsUnplaced || 0)} 家</strong>
                    </li>
                    <li>
                      <span>覆盖区数</span>
                      <strong>
                        {districts.filter((d) => d.playerCount || d.foodCount).length} / {districts.length}
                      </strong>
                    </li>
                  </ul>
                </div>
              )}
            </aside>
          </div>

          {/* ---- 深圳以外 ---- */}
          {data?.outside?.length > 0 && (
            <section className="map-outside">
              <h2>深圳以外的群友</h2>
              <p className="map-panel-hint">这些群友不在深圳，所以没有画进上图。</p>
              <div className="map-outside-grid">
                {data.outside.map((g) => (
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

          {/* ---- 在深圳但没选到区 ---- */}
          {data?.unplaced?.length > 0 && (
            <section className="map-outside">
              <h2>在深圳、但没选到区</h2>
              <p className="map-panel-hint">
                地区填的是「中国 广东省 深圳市」但没选到区，所以只能算进深圳总数、画不到具体区块上。
              </p>
              <div className="map-outside-card">
                <div className="map-outside-names">{data.unplaced.map((p) => p.nickname).join('、')}</div>
              </div>
            </section>
          )}

          {/* ---- 没填地区的名单（折叠起来，别占屏）---- */}
          {data?.missing?.length > 0 && (
            <details className="map-missing">
              <summary>没填地区的 {data.missing.length} 位群友（点开看名单）</summary>
              <div className="map-missing-names">{data.missing.map((p) => p.nickname).join('、')}</div>
              <p className="map-panel-hint">
                地区是群友自己填的，本人或管理员都可以补。补完刷新这个页面就会出现。
                <Link href="/profile"> 去我的个人信息</Link>
              </p>
            </details>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * 服务端直出。用动态 import 确保 lib/map-data（依赖 pg / fs）不会被打进客户端产物。
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
    const { loadMapData } = await import('../../lib/map-data.mjs');
    const data = await loadMapData({});
    return { props: { data, initialError: null, __pageViewTracked: tracked } };
  } catch (e) {
    return {
      props: {
        data: null,
        initialError: (e && e.message) || '服务端读取分布数据失败',
        __pageViewTracked: tracked,
      },
    };
  }
}