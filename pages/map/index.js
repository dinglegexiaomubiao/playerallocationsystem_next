import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import MemberMap from '../../components/MemberMap';

/**
 * 群友分布（/map）
 *
 * 一屏三件事：深圳各区住了多少人（热力）、好吃的在哪（标注）、指定的几个人在哪。
 *
 * 数据全部走 getServerSideProps 直出 —— 和 /members 同样的理由：手机上 JS 没跑起来时
 * 至少还能看见地图和名单，而不是一片空白。客户端只负责交互（图层开关、选人、点区）。
 */
export default function MapPage({ data, initialError }) {
  const [selected, setSelected] = useState([]);
  const [showHeat, setShowHeat] = useState(true);
  const [showFoods, setShowFoods] = useState(true);
  const [active, setActive] = useState(null);
  const [kw, setKw] = useState('');

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
  const toggleMember = (id) => {
    const key = String(id);
    setSelected((prev) => (prev.some((x) => x === key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

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
          {/* 缺地区的人多时这块 CTA 会顶在下面，hero 里就不再放同一个按钮，免得一屏两个 */}
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
                {selected.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
                    清空选中的 {selected.length} 人
                  </button>
                )}
              </div>

              <div className="map-canvas">
                <MemberMap
                  geo={data?.geo}
                  districts={districts}
                  selectedIds={selected}
                  showHeat={showHeat}
                  showFoods={showFoods}
                  active={active}
                  onHover={setActive}
                  onPick={setActive}
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

            <aside className="map-side">
              {/* ---- 选中指定群友 ---- */}
              <div className="map-panel">
                <h2>只看这几个人</h2>
                <p className="map-panel-hint">搜昵称，选中的人会在地图上标出来。没填地区的群友没法定位。</p>
                <input
                  className="map-search"
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  placeholder={`在 ${placeable.length} 位已定位群友里搜昵称`}
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
                  </div>
                )}
              </div>

              {/* ---- 区排行 ---- */}
              <div className="map-panel">
                <h2>各区人数</h2>
                <ul className="map-rank">
                  {ranking.map((d) => {
                    const pct = stats.filled ? Math.round((d.playerCount / Math.max(1, stats.filled)) * 100) : 0;
                    return (
                      <li key={d.name}>
                        <button
                          type="button"
                          className={'map-rank-row' + (active === d.name ? ' is-active' : '')}
                          onClick={() => setActive(active === d.name ? null : d.name)}
                        >
                          <span className="map-rank-name">{d.name}</span>
                          <span className="map-rank-bar">
                            <i style={{ width: pct + '%' }} />
                          </span>
                          <span className="map-rank-num">
                            {d.playerCount} 人{d.foodCount ? ` · ${d.foodCount} 家` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* ---- 单区明细 ---- */}
              {activeData && (
                <div className="map-panel">
                  <h2>
                    {activeData.name}
                    <button type="button" className="map-panel-close" onClick={() => setActive(null)} aria-label="关闭">
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
                    <p className="map-panel-hint">这个区还没有群友填。</p>
                  )}
                  <h3 className="map-sub-h">美食 {activeData.foodCount} 家</h3>
                  {activeData.foods.length ? (
                    <ul className="map-list">
                      {activeData.foods.slice(0, 12).map((f) => (
                        <li key={f.id}>
                          <span className="map-food-name">{f.name}</span>
                          {f.cuisine ? <span className="map-food-tag">{f.cuisine}</span> : null}
                          {f.rating ? <span className="map-food-star">{f.rating} 星</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="map-panel-hint">这个区还没有美食记录。</p>
                  )}
                  {activeData.foods.length > 12 && (
                    <p className="map-panel-hint">
                      还有 {activeData.foods.length - 12} 家，去<Link href="/food">群友美食</Link>看全部。
                    </p>
                  )}
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
