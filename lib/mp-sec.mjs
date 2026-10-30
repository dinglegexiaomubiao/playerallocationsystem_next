/**
 * 微信官方内容安全（security.msgSecCheck v2）。
 *
 * 为什么要有这一层：现有两道是「本地词表」(moderation.mjs) + 「AI 语义复审」(ai-moderate.mjs)。
 * 前者只能拦明确词，后者是第三方模型、口径不对外公开。小程序提审时审核方看的是
 * **微信自己的判定**，所以这里补上官方接口 —— 它是唯一能对审核员交差的那道。
 *
 * 三层顺序（见 ai-moderate.mjs 的 aiModerate）：
 *   词表（同步、零成本）→ 微信 msgSecCheck（官方口径）→ DeepSeek（兜变体）
 *
 * 设计原则与 AI 复审保持一致：
 *   - 没配 AppSecret / 接口报错 / 超时 / 限频 → **放行**，绝不因为审核服务挂了就卡住用户。
 *   - 判定结果按内容缓存 10 分钟，重复提交不重复打接口（接口有 QPS 与日配额限制）。
 *   - access_token 直接复用 mp-notify 的跨进程缓存，不另起一套（全局只有一份，两套会互顶）。
 */
import { getAccessToken, mpConfigured } from './mp-notify.mjs';

const ENDPOINT = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const TIMEOUT_MS = 5000;
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 500;

// scene：1 资料 2 评论 3 论坛 4 社交日志。我们大多是把用户写的东西发出去，用「评论」最贴。
const SCENE_COMMENT = 2;

/**
 * 微信 label → 人话。
 * 100 是「正常」，其余都是具体违规类型（官方文档 label 表）。
 */
const LABELS = {
  10001: '广告',
  20001: '时政敏感',
  20002: '色情低俗',
  20003: '辱骂攻击',
  20006: '违法犯罪',
  20008: '欺诈诈骗',
  20012: '低俗内容',
  20013: '侵犯版权',
  21000: '其他违规',
};

const cache = new Map(); // key -> { result, ts }

const envStr = (name) => String(process.env[name] || '').trim();

/** 配了 AppID + AppSecret 才能调（same condition as mp-notify 的 canLogin） */
export function isWxSecEnabled() {
  if (envStr('WX_SEC_CHECK') === 'off') return false;
  const cfg = mpConfigured();
  return !!(cfg.appid && cfg.hasSecret);
}

async function postJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`内容安全接口返回非 JSON（HTTP ${res.status}）`);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('内容安全接口超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 单条文本送审。
 *
 * ⚠ openid 是**必填**的：v2 接口不传会直接返回 `40003 invalid openid`（2026-10-29 实测），
 * 也就是说「不带 openid 也凑合能用」是不成立的 —— 那种写法只会永远静默降级成放行。
 * 所以没 openid 就明确 skip 并把原因记下来，不假装检查过。
 *
 * @param {string} content
 * @param {{openid:string, scene?:number}} opts
 * @returns {Promise<
 *   {ok:true, skipped?:string} |
 *   {ok:false, category:string, label:number, suggest:string}
 * >}
 */
export async function msgSecCheck(content, opts = {}) {
  const text = String(content == null ? '' : content).trim();
  if (!text) return { ok: true, skipped: 'empty' };
  if (!isWxSecEnabled()) return { ok: true, skipped: 'not-configured' };

  const openid = String(opts.openid || '').trim();
  if (!openid) return { ok: true, skipped: 'no-openid' };

  // 接口单次上限 2500 字，超了会直接报错；我们的字段最长也就 2000，这里保险截断
  const payload = text.slice(0, 2500);
  const key = openid + '|' + payload;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.result;

  const scene = Number(opts.scene) || SCENE_COMMENT;
  const body = { content: payload, version: 2, scene, openid };
  const remember = (result) => {
    cache.set(key, { result, ts: Date.now() });
    if (cache.size > CACHE_MAX) {
      [...cache.keys()].slice(0, Math.floor(CACHE_MAX / 2)).forEach((k) => cache.delete(k));
    }
    return result;
  };

  try {
    let json = await postJson(
      `${ENDPOINT}?access_token=${encodeURIComponent(await getAccessToken())}`,
      body
    );

    // token 失效：强制换一次再重试（getAccessToken 内部有 mp_kv 缓存，force 才会真去换）
    if (json.errcode === 40001 || json.errcode === 42001) {
      json = await postJson(
        `${ENDPOINT}?access_token=${encodeURIComponent(await getAccessToken({ force: true }))}`,
        body
      );
    }

    if (json.errcode) {
      // 40003 / 61010 是 openid 无效或该用户近期没访问过；45011 限频；48001 未授权。
      // 一律放行 —— 审核服务故障不该转嫁成用户发不出内容。
      console.warn('[mp-sec] 内容安全接口降级放行:', json.errcode, json.errmsg || '');
      return remember({ ok: true, skipped: `errcode:${json.errcode}` });
    }

    const result = json.result || {};
    const suggest = String(result.suggest || '').toLowerCase();
    const label = Number(result.label) || 0;

    // pass 放行；review（疑似）与 risky（确定）都拦 —— 这一步的判定方就是提审时的判定方，
    // 它说「疑似」的内容放过去，等于把风险留给审核员。
    if (suggest === 'pass' || (!suggest && label === 100)) {
      return remember({ ok: true });
    }
    if (suggest === 'review' || suggest === 'risky') {
      return remember({
        ok: false,
        category: LABELS[label] || (suggest === 'risky' ? '违规内容' : '疑似违规内容'),
        label,
        suggest,
      });
    }
    return remember({ ok: true, skipped: 'unknown-suggest' });
  } catch (e) {
    console.warn('[mp-sec] 内容安全检查失败放行:', e.message);
    return remember({ ok: true, skipped: 'error' });
  }
}

/**
 * 从请求头取小程序 openid。
 * 小程序端 utils/api.js 会给每个请求带上 `X-MP-Openid`（静默 wx.login 换来的，见
 * pages/api/mp/openid.js）。网页端用户没有这个头，取到空串 → msgSecCheck 跳过，
 * 网页端只走词表 + AI 两层（网页端不面向微信提审，不影响）。
 */
export const openidOf = (req) => {
  const h = req && req.headers ? req.headers['x-mp-openid'] : '';
  return typeof h === 'string' ? h.trim() : Array.isArray(h) ? String(h[0] || '').trim() : '';
};

/**
 * 一组字段批量送审（逐条串行，命中即返回）。
 * 串行是有意的：并发打同一个接口容易撞 QPS 限制，而一次提交最多也就四五个短字段。
 *
 * @param {Record<string,string>} fields
 * @param {{openid?:string, scene?:number}} opts
 * @returns {Promise<{ok:true} | {ok:false, field:string, category:string, label:number, suggest:string}>}
 */
export async function msgSecCheckFields(fields, opts = {}) {
  for (const [field, value] of Object.entries(fields || {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const r = await msgSecCheck(value, opts);
    if (!r.ok) return { ...r, field };
  }
  return { ok: true };
}

export const wxSecMessage = (r) =>
  `内容安全审核未通过（${r.category}），请修改后再提交`;
