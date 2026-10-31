/**
 * 回忆上「照片拍的什么时候、什么地方」这两个字段的规则。
 *
 * 为什么单独成文件：发布框、编辑框、接口层都要用同一套判断，
 * 而 lib/memories.mjs 里有 `import { pool } from './db.js'` —— 客户端组件
 * 一旦从那里 import 常量，`pg` 就会被拉进浏览器包（构建当场报错）。
 * 和 lib/memories-tags.mjs 是同一个理由。
 *
 * 这两个字段都**不是发布时刻**：created_at 是「谁什么时候传的」，
 * shot_on / place 是「这张照片本身拍在哪天、哪儿」。两者常差好几天
 * （周日的聚会周四才有人传上来），界面上也是分两处显示的。
 */

/** 地点最多 40 个字：「深圳南山·科技园」够用，再长就不是地点是日记了。 */
export const PLACE_LIMIT = 40;

/** 日期范围。站点 2026 年才有回忆，比 1990 更早一定是打错了。 */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

/**
 * 归一化「拍摄日期」，只接受 `YYYY-MM-DD`。
 *
 * 返回值三态：
 *   `''`   —— 没填（合法，可清空）
 *   `null` —— 格式不对（调用方要报 400）
 *   `'YYYY-MM-DD'` —— 正常
 *
 * 为什么要用 Date.UTC 绕一圈再对回来：`2026-02-30`、`2026-13-01` 这种
 * Date 会**静默进位**成 3 月 2 日 / 次年 1 月，不校验就会把错日期存进去，
 * 而用户以为自己填对了。
 */
export const normalizeShotOn = (raw) => {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  return s;
};

/** 地点：折掉多余空白、截到上限。空就是空，不算错。 */
export const normalizePlace = (raw) =>
  String(raw === null || raw === undefined ? '' : raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLACE_LIMIT);

/** `2026-10-21` → `2026.10.21`。只用于显示，客户端算就够了。 */
export const fmtShotOn = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
};
