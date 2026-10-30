/**
 * AI 内容安全复审（DeepSeek）：
 *   本地词表（moderation.mjs）先拦一道明确违规；
 *   通过后再把本次提交的文本字段打包发给 DeepSeek 做语义级复审，
 *   拦住词表覆盖不到的变体（谐音、隐晦表达、新话术）。
 *
 * 设计原则：
 *   - 复用 lib/ai.js 的 requestMessages（node:https 直连，绕开 fetch 补丁坑）。
 *   - 快速失败：AI 超时/出错/没配 key → 放行（degraded），绝不阻塞正常发帖。
 *   - 10 分钟结果缓存：同一内容重复提交不重复烧 token。
 */
import { requestMessages, isAIConfigured } from './ai';
import { msgSecCheckFields } from './mp-sec.mjs';

// 调用点统一从这里拿：省得每个 API 为了一个请求头再 import 一个模块
export { openidOf } from './mp-sec.mjs';

const TIMEOUT_MS = 6000;
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map(); // key -> { result, ts }

const SYSTEM_PROMPT = [
  '你是社区网站的内容安全审核员，负责审核用户提交的文本（备注、标题、昵称、评价等）。',
  '判定为违规的标准（命中任一即不通过）：',
  '1. 赌博（赌球、博彩、开盘、押注等）；2. 色情低俗、性交易；3. 毒品、违禁物品买卖；',
  '4. 暴恐、武器相关；5. 诈骗话术（刷单、返利、保证金、诱导转账）；',
  '6. 违规引流广告（留微信号/QQ群/电报群引流、代练打手接单、买卖账号、低价充值）；',
  '7. 辱骂攻击、人身威胁；8. 政治敏感内容。',
  '判定为正常的标准（放行）：',
  '- 约球组队、开黑、吃饭爬山等正常活动组织；',
  '- 分享 OpenDota / Dotabuff / Steam / B站 等正常链接；',
  '- 普通闲聊、吐槽、游戏术语（含「干拉」「上分」「带躺」等）。',
  '拿不准的一律放行（宁可漏判，不可误伤正常用户）。',
  '只输出一行 JSON，不要解释：{"ok":true} 或 {"ok":false,"category":"类别名"}',
].join('\n');

export function isAIModerationEnabled() {
  return process.env.AI_MODERATION !== 'off' && isAIConfigured();
}

/**
 * 复审一组文本字段。
 * @param {Record<string,string>} fields  { 字段名: 文本 }
 * @returns {Promise<{ok:true, skipped?:boolean, degraded?:boolean} | {ok:false, category:string, field:string}>}
 */
export async function aiModerate(fields, opts = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v === 'string' && v.trim()) clean[k] = v.slice(0, 2000);
  }
  if (Object.keys(clean).length === 0) return { ok: true, skipped: true };

  // ① 微信官方内容安全（security.msgSecCheck）。
  //    故意放在 AI 开关**之前**：就算 AI_MODERATION=off，官方这道也必须跑 ——
  //    提审时判定方是微信，官方接口过不了，本地词表和第三方模型说得再好听都没用。
  //    没配 AppSecret 时它自己返回 { ok:true, skipped:'not-configured' }，不会卡住。
  const wx = await msgSecCheckFields(clean, opts);
  if (!wx.ok) {
    return { ok: false, category: wx.category, field: wx.field, source: 'wechat' };
  }

  if (!isAIModerationEnabled()) return { ok: true, skipped: true };

  const key = JSON.stringify(clean);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return hit.result;
  }

  try {
    const text = await requestMessages({
      system: SYSTEM_PROMPT,
      prompt:
        '请审核以下用户提交的内容（JSON，值为各字段文本）：\n' +
        key +
        '\n只输出一行 JSON：{"ok":true} 或 {"ok":false,"category":"类别"}',
      maxTokens: 512,
      timeoutMs: TIMEOUT_MS,
    });

    let result;
    const m = text.match(/\{[\s\S]*?\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      if (j && j.ok === false) {
        result = { ok: false, category: String(j.category || '违规内容') };
      } else {
        result = { ok: true };
      }
    } else {
      // 模型没按格式回，视为放行（本地词表已拦过一轮）
      result = { ok: true, degraded: true };
    }
    cache.set(key, { result, ts: Date.now() });
    if (cache.size > 500) {
      // 简单防膨胀：清掉一半最旧的
      const keys = [...cache.keys()].slice(0, 250);
      keys.forEach((k) => cache.delete(k));
    }
    return result;
  } catch (e) {
    // AI 不可用（超时/网络/额度）→ 放行，别阻塞用户
    console.warn('[ai-moderate] 复审降级放行:', e.message);
    const result = { ok: true, degraded: true };
    cache.set(key, { result, ts: Date.now() });
    return result;
  }
}

// 统一提示文案
export const aiModerationMessage = (r) =>
  `内容安全审核未通过（${r.category}），请修改后再提交`;
