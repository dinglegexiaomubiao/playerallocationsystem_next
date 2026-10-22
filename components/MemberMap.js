/**
 * 群友分布图（纯 SVG，零依赖、零地图 SDK）。
 *
 * 从 2026-10-22 起支持**任意一级行政区**：全国（省）/ 省（市）/ 市（区县）。
 * 组件本身不知道自己在画哪一级，只认 `areas` + `geo`：
 *   areas[i] = { name, adcode, path, center, playerCount, foodCount, canDrill, players }
 *
 * 为什么自己画而不是接腾讯/高德 JS SDK：
 *  - 需求只是「若干行政区 + 百来个点」，不需要底图瓦片、路网、路径规划；
 *  - 站点有 iOS 16.0/16.2 与微信内置 Chrome 86 的真实用户，WebGL 类 SDK 在这些
 *    引擎上风险高（2026-10-22 刚因为 Next 自带的 class 静态块白屏过一次）；
 *  - 不引入任何地图服务 key，没有配额、域名白名单、key 泄露的问题。
 *
 * 几何来自 public/data/cn/{adcode}.json（阿里云 DataV 高德系行政区划，
 * 构建期已投影成 SVG path，见 scripts/build-china-map.cjs），只作行政区划示意。
 *
 * 群友位置**只精确到区县**：同一区的人在该区质心周围按黄金角散开，不表示真实住址。
 * 这既是数据现状（players.region 只有四级），也是合规要求（不采集/公开个人精确位置）。
 *
 * 绘制顺序（后画压前画）：
 *   区块底色 → 热力光晕 → 美食点 → 区块名 → 选中的群友 → 南海诸岛插图
 * 选中群友放最后（插图除外），是因为它是用户主动选出来的「主角」，不该被任何东西压住。
 *
 * ⚠ 区块底色**不用内联 style 的 fillOpacity**，改成 lv0~lv3 四个 class：SVG 里读不到
 *   当前主题，只有交给 CSS 才能给日间/夜间两套色阶（夜间 opcity 拉不开差别）。
 */

// 美食按菜系着色：用固定调色盘而不是哈希色相，避免页面花成一片
const CUISINE_COLORS = ['#e2635a', '#e8a33d', '#5aa9e2', '#63c08a', '#b58ae0', '#e07ba8'];

function colorOf(text) {
  const s = String(text || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return CUISINE_COLORS[h % CUISINE_COLORS.length];
}

/**
 * SVG 坐标统一保留两位小数。
 * 不只是为了瘦身：热力圆的 cy 是 `center + 30*scale + dy*0.62` 算出来的，
 * 服务端与浏览器对最后一位的取整偶尔不同（实测 414.7409091756005 vs …045），
 * 会在 hydration 时报 "Prop cy did not match"。定点取整一次，两边必然一致。
 */
const n2 = (v) => Math.round(v * 100) / 100;

/** 黄金角螺旋：把 n 个点均匀铺在半径 r 的圆内，位置稳定不抖动 */
function spread(i, n, r) {
  const angle = i * 2.399963229728653;
  const rad = r * Math.sqrt((i + 0.5) / Math.max(n, 1));
  return [Math.cos(angle) * rad, Math.sin(angle) * rad];
}

/**
 * 人数 → 色阶档位（0 人 / 少 / 中 / 多）。
 * 分档而不是连续透明度：夜间底色本身就暗，连续渐变的差值肉眼分不出来。
 */
function heatLevel(count, max) {
  if (!count) return 0;
  const ratio = count / Math.max(1, max);
  if (ratio >= 0.99) return 3;
  if (ratio >= 0.5) return 2;
  return 1;
}

/**
 * 字号与光晕随层级收放。
 * 全国图上 34 个省级区如果都按 14px 写字，会挤成一团糊；但也不能一缩了事 ——
 * 缩到 0.42 时 14px 只剩 6px，等于没写。所以全国图**只给有人的省写名字**
 * （`labelAll=false`），其余靠悬停 title 和下面的人数列表认，图面才干净。
 */
function textScale(depth) {
  if (depth <= 0) return 0.82;
  if (depth === 1) return 0.9;
  return 1;
}

/** 光晕半径单独一档：全国图上 74 单位的圆等于 400 公里，会盖掉半个省 */
function heatScale(depth) {
  if (depth <= 0) return 0.5;
  if (depth === 1) return 0.75;
  return 1;
}

export default function MemberMap({
  geo,
  areas,
  depth = 2,
  selectedIds = [],
  showHeat = true,
  showFoods = true,
  labelAll = true,
  active = null,
  hovered = null,
  onHover,
  onPick,
}) {
  if (!geo || !Array.isArray(areas) || !areas.length) return null;

  const maxPlayers = Math.max(1, ...areas.map((a) => a.playerCount || 0));
  const selected = new Set(selectedIds.map(String));
  const onlySelected = selected.size > 0;
  const scale = textScale(depth);
  const hScale = heatScale(depth);
  // 美食点只在「市」及更细的层级才有意义：省级图上 106 家全在深圳一个点上，糊成色块
  const dotOk = depth >= 2;
  const nanhai = geo.nanhai || null;
  const hasLabel = (g) => labelAll || g.playerCount > 0 || g.foodCount > 0;

  /**
   * 标签底板。全国图上「人多的先占位，挤不下的不画」：
   * 香港和广东的质心只差 30 个单位，两个底板必然叠在一起，把广东的「24 人」盖掉。
   * 挤下去的省不是消失了 —— 悬停有 title，下面「各省人数」列表里有名字和人数。
   * 省/市层级不剔除：那些名字是点击入口，宁可略挤也要全在。
   */
  const labels = [];
  if (labelAll) {
    for (const g of areas) {
      if (!g.center || !hasLabel(g)) continue;
      labels.push({ g, has: g.playerCount > 0 || g.foodCount > 0 });
    }
  } else {
    const placed = [];
    const rank = [...areas].sort((a, b) => (b.playerCount || 0) - (a.playerCount || 0));
    for (const g of rank) {
      if (!g.center || !hasLabel(g)) continue;
      const w = Math.max(g.name.length * 14 + 16, 40) * scale;
      const h = 36 * scale;
      const box = [g.center[0] - w / 2, g.center[1] - h / 2, g.center[0] + w / 2, g.center[1] + h / 2];
      const hit = placed.some(
        (b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]
      );
      if (hit) continue;
      placed.push(box);
      labels.push({ g, has: true });
    }
  }

  return (
    <svg
      className={'mmap-svg' + (depth <= 0 ? ' is-national' : '')}
      viewBox={geo.viewBox}
      preserveAspectRatio="xMidYMid meet"
      // 字号由 CSS 用 calc(14px * var(--mmap-scale)) 算：全国图上 34 个省，
      // 14px 的区名会把版心挤死，缩小交给令牌比在每个元素上写 fontSize 干净
      style={{ '--mmap-scale': scale }}
      role="img"
      aria-label="群友分布示意图"
    >
      <defs>
        <radialGradient id="mmap-heat">
          <stop offset="0%" stopColor="#e2635a" stopOpacity="0.34" />
          <stop offset="45%" stopColor="#e2635a" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#e2635a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ---- 1. 行政区底色：lv0~lv3 由 CSS 给日间/夜间两套色阶 ---- */}
      {areas.map((g) => {
        const cls =
          'mmap-district lv' +
          heatLevel(g.playerCount, maxPlayers) +
          (active === g.name ? ' is-active' : '') +
          (hovered === g.name ? ' is-hover' : '') +
          (g.isMine ? ' is-mine' : '') +
          (g.canDrill ? ' is-drill' : '');
        return (
          <path
            key={g.name}
            d={g.path}
            className={cls}
            onMouseEnter={() => onHover && onHover(g.name)}
            onMouseLeave={() => onHover && onHover(null)}
            onClick={() => onPick && onPick(g)}
          >
            <title>
              {g.name}：群友 {g.playerCount} 人
              {g.foodCount ? `，美食 ${g.foodCount} 家` : ''}
              {g.canDrill ? '（点击进入下一级）' : ''}
            </title>
          </path>
        );
      })}

      {/* ---- 2. 热力光晕（区块质心，半径随层级收放）---- */}
      {showHeat &&
        areas.map((g) => {
          if (!g.playerCount || !g.center) return null;
          const r = (30 + 44 * (g.playerCount / maxPlayers)) * hScale;
          return (
            <circle
              key={'heat-' + g.name}
              cx={n2(g.center[0])}
              cy={n2(g.center[1])}
              r={n2(r)}
              fill="url(#mmap-heat)"
              pointerEvents="none"
            />
          );
        })}

      {/* ---- 3. 美食标注（区内黄金角散开，不表示真实门牌）---- */}
      {showFoods &&
        dotOk &&
        areas.map((g) => {
          if (!g.foods || !g.foods.length || !g.center) return null;
          const n = g.foods.length;
          // 半径收得比较紧：55 家的南山按原公式（14+4.5√n≈47）散开会溢到福田和海上
          const r = Math.min(30, 9 + 3.6 * Math.sqrt(n));
          return (
            <g key={'food-' + g.name} className="mmap-foods">
              {g.foods.map((f, i) => {
                const [dx, dy] = spread(i, n, r);
                return (
                  <circle
                    key={f.id}
                    cx={n2(g.center[0] + dx)}
                    cy={n2(g.center[1] + dy)}
                    r={2.7}
                    style={{ fill: colorOf(f.cuisine) }}
                    className="mmap-food"
                  >
                    <title>
                      {f.name}
                      {f.cuisine ? `（${f.cuisine}）` : ''}
                      {f.rating ? ` · ${f.rating} 星` : ''}
                      {f.address ? `\n${f.address}` : ''}
                    </title>
                  </circle>
                );
              })}
            </g>
          );
        })}

      {/* ---- 4. 区块名与数量：有内容时垫一块底板，否则会被点阵糊住 ----
          全国图只给有人的省写名字（labelAll=false），且挤不下的不画，理由见上面 labels 的注释 */}
      {labels.map(({ g, has }) => {
        const countText = `${g.playerCount ? `${g.playerCount} 人` : ''}${
          g.playerCount && g.foodCount ? ' · ' : ''
        }${g.foodCount ? `${g.foodCount} 家` : ''}`;
        // 底板宽度按字数估，够包住两行里较长的那行
        const w = has ? Math.max(g.name.length * 14 + 16, countText.length * 10 + 16) * scale : 0;
        const h = (has ? 36 : 22) * scale;
        return (
          <g key={'label-' + g.name} pointerEvents="none" className="mmap-label">
            {has && (
              <rect
                x={n2(g.center[0] - w / 2)}
                y={n2(g.center[1] - h / 2 + 2 * scale)}
                width={n2(w)}
                height={n2(h)}
                rx={n2(7 * scale)}
                className="mmap-label-plate"
              />
            )}
            <text
              x={n2(g.center[0])}
              y={n2(g.center[1] + (has ? -2 : 4) * scale)}
              className="mmap-label-name"
              textAnchor="middle"
            >
              {g.name}
            </text>
            {has && (
              <text
                x={n2(g.center[0])}
                y={n2(g.center[1] + 12 * scale)}
                className="mmap-label-count"
                textAnchor="middle"
              >
                {countText}
              </text>
            )}
          </g>
        );
      })}

      {/* ---- 5. 选中的群友（画在最后，谁都不许压）---- */}
      {areas.map((g) => {
        if (!g.players || !g.players.length || !g.center) return null;
        const picked = onlySelected ? g.players.filter((p) => selected.has(String(p.id))) : [];
        if (!picked.length) return null;
        const r = Math.min(62, 22 + 7 * Math.sqrt(picked.length)) * scale;
        const ring = 16 * scale;
        const av = 13 * scale;
        return (
          <g key={'mem-' + g.name} className="mmap-members">
            {picked.map((p, i) => {
              const [dx, dy] = spread(i, picked.length, r);
              // 整体压到标签底板下面（+30），否则头像会正好盖住「4 人 · 52 家」
              const cx = g.center[0] + dx * 1.15;
              const cy = g.center[1] + 30 * scale + dy * 0.62;
              return (
                <g key={p.id} className="mmap-member">
                  <circle cx={n2(cx)} cy={n2(cy)} r={n2(ring)} className="mmap-member-ring" />
                  {p.avatar ? (
                    <image
                      href={p.avatar}
                      x={n2(cx - av)}
                      y={n2(cy - av)}
                      width={av * 2}
                      height={av * 2}
                      clipPath={`circle(${av}px at ${av}px ${av}px)`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  ) : (
                    <text
                      x={n2(cx)}
                      y={n2(cy + 5 * scale)}
                      className="mmap-member-initial"
                      textAnchor="middle"
                    >
                      {String(p.nickname || '?').slice(0, 1)}
                    </text>
                  )}
                  <title>{`${p.nickname}（${g.name}）`}</title>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* ---- 6. 南海诸岛插图 ----
          全国图主图只画到海南岛（北纬 17.2° 以上），南海诸岛与断续线在这里表达。
          **这不是装饰，是领土表达的一部分**：主图缺了它们，地图就是错的。 */}
      {nanhai && nanhai.path ? (
        <g
          className="mmap-nanhai"
          transform={`translate(${geo.width - nanhai.width - 6}, ${geo.height - nanhai.height - 6})`}
          pointerEvents="none"
        >
          <rect
            x={-3}
            y={-3}
            width={nanhai.width + 6}
            height={nanhai.height + 6}
            rx={3}
            className="mmap-nanhai-box"
          />
          <path d={nanhai.path} className="mmap-nanhai-path" />
          <text x={nanhai.width / 2} y={11} className="mmap-nanhai-label" textAnchor="middle">
            南海诸岛
          </text>
        </g>
      ) : null}
    </svg>
  );
}
