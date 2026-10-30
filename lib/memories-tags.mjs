/**
 * 回忆标签的规则（服务端与浏览器共用）。
 *
 * 为什么单独一个文件：`lib/memories.mjs` 会 import `pg` 的连接池，
 * 前端组件一旦 import 它，打包器就会把数据库驱动和连接串逻辑一起打进浏览器包。
 * 所以「多少个标签、多长、怎么清洗」这类纯规则放在这里，两边都能用。
 *
 * 标签的作用只有一个：让照片能按题材筛。所以**宁少不多** ——
 * 一条回忆最多 5 个，每个 12 字以内，超了就丢后面的。
 */

/** 一条回忆最多几个标签。多了标签条会变成噪音，筛选也失去意义。 */
export const MAX_TAGS = 5;
/** 单个标签的字符上限（含标点和 emoji 的近似计数用 Array.from）。 */
export const TAG_LIMIT = 12;

/**
 * 发布框里给的候选。只是「常见题材」，不是白名单 ——
 * 用户可以自己写，毕竟每次聚会叫什么只有当时的人知道。
 */
export const SUGGESTED_TAGS = ['聚会', '比赛', '夜宵', '合影', '翻盘', '日常'];

/** 去掉首尾空白与井号。用户习惯用 `#聚会` 的写法，别把它当标签的一部分存下来。 */
const trimTag = (s) => String(s == null ? '' : s).replace(/^#+/, '').replace(/\s+/g, ' ').trim();

/**
 * 清洗标签数组。
 *
 * - 接受数组，也接受「逗号/空格分隔的字符串」（手打输入框用得上）
 * - 去首尾 #、压空白、按字符截到 12
 * - 去重时忽略大小写：`Dota` 和 `dota` 是同一个标签，否则筛选会裂成两个
 * - 超过 5 个直接丢弃多余部分，不报错（站内一贯策略：能存就存，不弹错误）
 */
export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，、\s]+/)
      : [];

  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= MAX_TAGS) break;
    const t = Array.from(trimTag(item)).slice(0, TAG_LIMIT).join('');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** 这个标签能不能直接拿来筛选（挡掉空串和奇怪的超长串）。 */
export const isValidTag = (t) => {
  const s = trimTag(t);
  return !!s && Array.from(s).length <= TAG_LIMIT;
};

export default { MAX_TAGS, TAG_LIMIT, SUGGESTED_TAGS, normalizeTags, isValidTag };
