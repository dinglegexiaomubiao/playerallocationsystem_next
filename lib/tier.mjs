/**
 * 天梯段位口径（唯一来源）
 *
 * 群友卡片徽标、段位筛选下拉、补填资料预览都从这里取，
 * 避免「卡片写 5420、下拉写 5400」这种口径漂移。
 */

// 门槛从高到低；min 含、max 不含，max=null 表示不设上限
export const TIERS = [
  { key: 'immortal', label: '冠绝一世', cls: 'score-immortal', min: 5420, max: null },
  { key: 'divine', label: '超凡入圣', cls: 'score-divine', min: 4620, max: 5420 },
  { key: 'ancient', label: '万古流芳', cls: 'score-ancient', min: 3850, max: 4620 },
  { key: 'legend', label: '传奇', cls: 'score-legend', min: 3080, max: 3850 },
  { key: 'archon', label: '统帅', cls: 'score-archon', min: 2310, max: 3080 },
  { key: 'others', label: '中军以下', cls: 'score-others', min: null, max: 2310 },
];

/** 分数 → { key, label, cls }；无分数时按「中军以下」处理 */
export function tierOf(score) {
  const n = Number(score);
  const s = Number.isFinite(n) ? n : 0;
  for (const t of TIERS) {
    if (t.min !== null && s < t.min) continue;
    if (t.max !== null && s >= t.max) continue;
    return { key: t.key, label: t.label, cls: t.cls };
  }
  return { key: 'others', label: '中军以下', cls: 'score-others' };
}
