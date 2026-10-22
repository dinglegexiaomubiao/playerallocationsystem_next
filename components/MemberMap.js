/**
 * 深圳群友分布图（纯 SVG，零依赖、零地图 SDK）。
 *
 * 为什么自己画而不是接腾讯/高德 JS SDK：
 *  - 这个需求只是「9 个区 + 百来个点」，不需要底图瓦片、路网、路径规划；
 *  - 站点有 iOS 16.0/16.2 与微信内置 Chrome 86 的真实用户，WebGL 类 SDK 在这些
 *    引擎上风险高（2026-10-22 刚因为 Next 自带的 class 静态块白屏过一次）；
 *  - 不引入任何地图服务 key，没有配额、域名白名单、key 泄露的问题。
 *
 * 几何数据来自 public/data/shenzhen.geo.json（阿里云 DataV 高德系行政区划，
 * 构建期已投影成 SVG path，见 scripts/build-shenzhen-map.cjs），只作行政区划示意。
 *
 * 群友位置**只精确到区**：同一区的人在该区质心周围按黄金角散开，不表示真实住址。
 * 这既是数据现状（players.region 只有四级），也是合规要求（不采集/公开个人精确位置）。
 *
 * 绘制顺序（后画压前画）：区底色 → 热力光晕 → 美食点 → 区名底板 → 选中群友。
 * 选中群友放最后，是因为它是用户主动选出来的「主角」，不该被任何东西压住。
 */

// 美食按菜系着色：用固定调色盘而不是哈希色相，避免页面花成一片
const CUISINE_COLORS = ['#e2635a', '#e8a33d', '#5aa9e2', '#63c08a', '#b58ae0', '#e07ba8'];

function colorOf(text) {
  const s = String(text || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return CUISINE_COLORS[h % CUISINE_COLORS.length];
}

/** 黄金角螺旋：把 n 个点均匀铺在半径 r 的圆内，位置稳定不抖动 */
function spread(i, n, r) {
  const angle = i * 2.399963229728653;
  const rad = r * Math.sqrt((i + 0.5) / Math.max(n, 1));
  return [Math.cos(angle) * rad, Math.sin(angle) * rad];
}

export default function MemberMap({
  geo,
  districts,
  selectedIds = [],
  showHeat = true,
  showFoods = true,
  active = null,
  onHover,
  onPick,
}) {
  if (!geo || !Array.isArray(geo.districts)) return null;

  const byName = new Map((districts || []).map((d) => [d.name, d]));
  const maxPlayers = Math.max(1, ...(districts || []).map((d) => d.playerCount || 0));
  const selected = new Set(selectedIds.map(String));
  const onlySelected = selected.size > 0;

  return (
    <svg
      className="mmap-svg"
      viewBox={geo.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="深圳群友分布示意图"
    >
      <defs>
        <radialGradient id="mmap-heat">
          <stop offset="0%" stopColor="#e2635a" stopOpacity="0.34" />
          <stop offset="45%" stopColor="#e2635a" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#e2635a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ---- 1. 行政区底色：人数越多越深。0 人的区几乎不着色，这样「有人/没人」一眼分得开 ---- */}
      {geo.districts.map((g) => {
        const d = byName.get(g.name);
        const count = d ? d.playerCount : 0;
        const intensity = count / maxPlayers;
        const isActive = active === g.name;
        return (
          <path
            key={g.name}
            d={g.path}
            className={'mmap-district' + (isActive ? ' is-active' : '')}
            style={{ fill: 'var(--brand)', fillOpacity: count ? 0.14 + 0.42 * intensity : 0.04 }}
            onMouseEnter={() => onHover && onHover(g.name)}
            onMouseLeave={() => onHover && onHover(null)}
            onClick={() => onPick && onPick(isActive ? null : g.name)}
          >
            <title>
              {g.name}：群友 {count} 人
              {d ? `，美食 ${d.foodCount} 家` : ''}
            </title>
          </path>
        );
      })}

      {/* ---- 2. 热力光晕（区质心，半径压低一点，别把区名糊掉）---- */}
      {showHeat &&
        geo.districts.map((g) => {
          const d = byName.get(g.name);
          const count = d ? d.playerCount : 0;
          if (!count || !g.center) return null;
          const r = 30 + 44 * (count / maxPlayers);
          return (
            <circle
              key={'heat-' + g.name}
              cx={g.center[0]}
              cy={g.center[1]}
              r={r}
              fill="url(#mmap-heat)"
              pointerEvents="none"
            />
          );
        })}

      {/* ---- 3. 美食标注（区内黄金角散开，不表示真实门牌）----
          点多的时候把扩散半径压住，否则 52 个点会糊成一个色块（南山就是这样）。 */}
      {showFoods &&
        geo.districts.map((g) => {
          const d = byName.get(g.name);
          if (!d || !d.foods || !d.foods.length || !g.center) return null;
          const n = d.foods.length;
          const r = Math.min(48, 14 + 4.5 * Math.sqrt(n));
          return (
            <g key={'food-' + g.name} className="mmap-foods">
              {d.foods.map((f, i) => {
                const [dx, dy] = spread(i, n, r);
                return (
                  <circle
                    key={f.id}
                    cx={g.center[0] + dx}
                    cy={g.center[1] + dy}
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

      {/* ---- 4. 区名与数量：有内容时垫一块底板，否则会被点阵糊住、根本读不出来 ---- */}
      {geo.districts.map((g) => {
        if (!g.center) return null;
        const d = byName.get(g.name);
        const count = d ? d.playerCount : 0;
        const foodCount = d ? d.foodCount : 0;
        const has = count > 0 || foodCount > 0;
        const countText = `${count ? `${count} 人` : ''}${count && foodCount ? ' · ' : ''}${
          foodCount ? `${foodCount} 家` : ''
        }`;
        // 底板宽度按字数估，够包住两行里较长的那行
        const w = has ? Math.max(g.name.length * 14 + 16, countText.length * 10 + 16) : 0;
        const h = has ? 36 : 22;
        return (
          <g key={'label-' + g.name} pointerEvents="none" className="mmap-label">
            {has && (
              <rect
                x={g.center[0] - w / 2}
                y={g.center[1] - h / 2 + 2}
                width={w}
                height={h}
                rx={7}
                className="mmap-label-plate"
              />
            )}
            <text
              x={g.center[0]}
              y={g.center[1] + (has ? -2 : 4)}
              className="mmap-label-name"
              textAnchor="middle"
            >
              {g.name}
            </text>
            {has && (
              <text x={g.center[0]} y={g.center[1] + 12} className="mmap-label-count" textAnchor="middle">
                {countText}
              </text>
            )}
          </g>
        );
      })}

      {/* ---- 5. 选中的群友（画在最后，谁都不许压）---- */}
      {geo.districts.map((g) => {
        const d = byName.get(g.name);
        if (!d || !d.players || !d.players.length || !g.center) return null;
        const picked = onlySelected ? d.players.filter((p) => selected.has(String(p.id))) : [];
        if (!picked.length) return null;
        const r = Math.min(62, 22 + 7 * Math.sqrt(picked.length));
        return (
          <g key={'mem-' + g.name} className="mmap-members">
            {picked.map((p, i) => {
              const [dx, dy] = spread(i, picked.length, r);
              // 整体压到标签底板下面（+30），否则头像会正好盖住「4 人 · 52 家」
              const cx = g.center[0] + dx * 1.15;
              const cy = g.center[1] + 30 + dy * 0.62;
              return (
                <g key={p.id} className="mmap-member">
                  <circle cx={cx} cy={cy} r={16} className="mmap-member-ring" />
                  {p.avatar ? (
                    <image
                      href={p.avatar}
                      x={cx - 13}
                      y={cy - 13}
                      width={26}
                      height={26}
                      clipPath="circle(13px at 13px 13px)"
                      preserveAspectRatio="xMidYMid slice"
                    />
                  ) : (
                    <text x={cx} y={cy + 5} className="mmap-member-initial" textAnchor="middle">
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
    </svg>
  );
}
