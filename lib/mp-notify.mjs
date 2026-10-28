/**
 * 小程序订阅消息 + 站内信的唯一出口。
 *
 * ## 为什么不是「用户点一下就从此都能收到」
 *
 * 小程序的订阅消息分两种，能用的只有一种：
 *
 *   - **长期订阅**：授权一次，之后想推就推。但微信只对政务 / 医疗 / 交通 /
 *     金融 / 教育这类**公共服务类目**开放，个人主体的小程序申请不到。
 *   - **一次性订阅**：用户每授权一次，我们攒到 **1 条**额度，推一条就扣一条，
 *     扣完必须用户再点一次。这就是 `mp_subscriptions.remaining` 存在的唯一原因。
 *
 * 所以整套逻辑必须接受一个现实：**推送一定会推不动**。额度用完、用户勾了
 * 「总是保持以上选择」并且拒收、微信侧限流，都会失败。因此每一条要通知的事
 * 都先写 `mp_inbox`（站内信），推送只是「让他不用打开小程序也能看到」的加法。
 * 站内信写失败才是真丢消息，推送失败不算。
 *
 * ## 一次都推不出去怎么办
 *
 * 广播类（有人发开黑 / 有人发活动 / 赛事开始筹办）做成**每日一条汇总**，
 * 把三类新增压进一条消息里 —— 一条额度只换一条消息，用它播三条独立通知
 * 是最亏的用法。定向类（有人报名了我的招募）即时推，因为它有时效，
 * 而且发起人本来就在高频授权（发帖时顺手就授权了）。
 *
 * ## 环境变量（都在服务器 .env.local，不进仓库）
 *
 *   MP_APPID           小程序 appid
 *   MP_SECRET          小程序 AppSecret（**绝不能进仓库**，泄露等于别人能冒充你调接口）
 *   MP_TMPL_DIGEST     每日汇总模板 id
 *   MP_TMPL_SIGNUP     报名提醒模板 id
 *   MP_ENV_VERSION     正式版 formal / 体验版 trial / 开发版 developer，默认 formal
 *
 * 没配齐时所有函数都退化：能读能写库、能写站内信，`sendSubscribe` 落一条
 * status='skip' 的日志然后返回，**不抛异常**。这样后端和页面可以先上线，
 * AppSecret 后补。
 */

import { pool, ensureMpTables } from './db.js';

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */

/** 订阅模板。key 是站内口径，`envKey` 指向环境变量里的模板 id。 */
export const TEMPLATES = {
  digest: {
    key: 'digest',
    label: '每日汇总',
    envKey: 'MP_TMPL_DIGEST',
    desc: '开黑 / 活动 / 赛事三类新增，每天一条',
    page: 'pages/messages/messages',
  },
  signup: {
    key: 'signup',
    label: '报名提醒',
    envKey: 'MP_TMPL_SIGNUP',
    desc: '有人报名你发起的开黑或活动时即时提醒',
    page: 'pages/party/party',
  },
};

/**
 * 模板字段映射：左边是我们自己的语义，右边是**微信后台模板里的关键词**。
 *
 * ⚠ 这一层是唯一需要「照着模板截图改」的地方。模板选好之后，把关键词名
 * 填进来即可（thing1 / time2 / thing3 这类）。填错的后果是微信返回
 * errcode 47003（参数不匹配），推送日志里能直接看到，不会静默。
 *
 * 约束（微信侧的硬规则，不遵守同样 47003）：
 *   thing  最多 20 个字符，超出会被截断
 *   time   必须是 2019年10月1日 15:01 或 2019-10-01 15:01 这类格式
 *   phrase 最多 5 个汉字
 */
const FIELD_MAP = {
  digest: { summary: 'thing1', time: 'time2', detail: 'thing3' },
  signup: { post: 'thing1', who: 'thing2', time: 'time3' },
};

/** 可订阅的类别。用户勾哪几类，汇总里就只出现哪几类。 */
export const CATEGORIES = [
  { key: 'party', label: '开黑组队', desc: '有人发起开黑招募' },
  { key: 'activity', label: '活动招募', desc: '有人发起约饭 / 爬山 / 打球' },
  { key: 'tournament', label: '赛事筹备', desc: '有新赛季开始筹办' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

const KV_TOKEN = 'wx_access_token';
const KV_WATERMARK = 'digest:watermark';
const KV_LAST_RUN = 'digest:last_run';

function envStr(name) {
  return String(process.env[name] || '').trim();
}

/** 当前配置快照。前端「订阅设置」页会据此告诉用户「服务端还没配好」。 */
export function mpConfigured() {
  const appid = envStr('MP_APPID');
  const secret = envStr('MP_SECRET');
  const templates = {};
  for (const t of Object.values(TEMPLATES)) templates[t.key] = envStr(t.envKey);
  return {
    appid,
    hasSecret: !!secret,
    /** 能换 openid（也就意味着能绑定、能推送） */
    canLogin: !!(appid && secret),
    /** 能真正发订阅消息 */
    canPush: !!(appid && secret && Object.values(templates).some(Boolean)),
    templates,
    envVersion: envStr('MP_ENV_VERSION') || 'formal',
    missing: {
      appid: !appid,
      secret: !secret,
      templates: Object.values(TEMPLATES)
        .filter((t) => !templates[t.key])
        .map((t) => t.label),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 微信 thing 类型上限 20 字符，超了接口直接 47003，这里统一截。 */
export function thing(v, n = 20) {
  const s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** 微信 time 类型要的是人能读的日期时间，不是 ISO。 */
export function wxTime(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t.getTime())) return wxTime(new Date());
  const p = (n) => String(n).padStart(2, '0');
  // 服务器时区可能就是 UTC，但用户在东八区 —— 这里显式换算，避免「早上看到昨晚」
  const cn = new Date(t.getTime() + 8 * 3600 * 1000);
  return `${cn.getUTCFullYear()}-${p(cn.getUTCMonth() + 1)}-${p(cn.getUTCDate())} ${p(
    cn.getUTCHours()
  )}:${p(cn.getUTCMinutes())}`;
}

/** 东八区的日期串，用来给汇总做「一天一条」的去重键。 */
export function cnDay(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  const cn = new Date(t.getTime() + 8 * 3600 * 1000);
  return `${cn.getUTCFullYear()}-${String(cn.getUTCMonth() + 1).padStart(2, '0')}-${String(
    cn.getUTCDate()
  ).padStart(2, '0')}`;
}

export function maskOpenid(openid) {
  const s = String(openid || '');
  if (s.length <= 10) return s ? s.slice(0, 3) + '***' : '';
  return s.slice(0, 6) + '****' + s.slice(-4);
}

/* ------------------------------------------------------------------ *
 * mp_kv：access_token 等短状态
 * ------------------------------------------------------------------ */

async function kvGet(k) {
  const r = await pool.query('SELECT v, expires_at FROM public.mp_kv WHERE k = $1', [k]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row.v;
}

async function kvSet(k, v, ttlSec = null) {
  const expires = ttlSec ? new Date(Date.now() + ttlSec * 1000) : null;
  await pool.query(
    `INSERT INTO public.mp_kv (k, v, expires_at, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, expires_at = EXCLUDED.expires_at, updated_at = now()`,
    [k, v, expires]
  );
}

/* ------------------------------------------------------------------ *
 * 微信接口
 * ------------------------------------------------------------------ */

async function wxGetJson(url, what) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!json) throw new Error(`${what}返回了非 JSON（HTTP ${res.status}）`);
    return json;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${what}超时，请稍后再试`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** wx.login 的 code 换 openid。没配 AppSecret 时抛一句人话。 */
export async function code2session(code) {
  const cfg = mpConfigured();
  if (!cfg.canLogin) throw new Error('服务端还没配置小程序 AppSecret，暂时无法绑定微信');
  const c = String(code || '').trim();
  if (!c) throw new Error('缺少登录凭证，请重试');
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(cfg.appid)}` +
    `&secret=${encodeURIComponent(envStr('MP_SECRET'))}` +
    `&js_code=${encodeURIComponent(c)}&grant_type=authorization_code`;
  const json = await wxGetJson(url, '微信登录');
  if (json.errcode) {
    // 40029 code 无效（已被用过 / 过期）、40163 code 已使用
    throw new Error(`微信登录失败（${json.errcode}）：${json.errmsg || '未知原因'}`);
  }
  if (!json.openid) throw new Error('微信没有返回 openid');
  return { openid: String(json.openid), unionid: json.unionid ? String(json.unionid) : null };
}

/**
 * access_token。7200 秒有效，且**全局只有一份**——两个进程各自去换会互相顶掉。
 * 所以缓存在 mp_kv 里而不是模块变量，提前 5 分钟过期，宁可贵一点不要卡在边界上。
 */
export async function getAccessToken({ force = false } = {}) {
  const cfg = mpConfigured();
  if (!cfg.canLogin) throw new Error('服务端还没配置小程序 AppSecret');
  if (!force) {
    const cached = await kvGet(KV_TOKEN);
    if (cached) return cached;
  }
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
    `&appid=${encodeURIComponent(cfg.appid)}&secret=${encodeURIComponent(envStr('MP_SECRET'))}`;
  const json = await wxGetJson(url, '获取 access_token');
  if (!json.access_token) {
    throw new Error(`获取 access_token 失败（${json.errcode || '?'}）：${json.errmsg || '未知原因'}`);
  }
  const ttl = Math.max(60, Number(json.expires_in || 7200) - 300);
  await kvSet(KV_TOKEN, String(json.access_token), ttl);
  return String(json.access_token);
}

/* ------------------------------------------------------------------ *
 * openid ↔ 账号
 * ------------------------------------------------------------------ */

export async function bindOpenid({ accountName, openid, unionid = null }) {
  await ensureMpTables();
  if (!accountName || !openid) throw new Error('绑定需要账号和 openid');
  await pool.query(
    `INSERT INTO public.mp_openids (openid, account_name, unionid)
     VALUES ($1, $2, $3)
     ON CONFLICT (openid) DO UPDATE
       SET account_name = EXCLUDED.account_name,
           unionid = COALESCE(EXCLUDED.unionid, public.mp_openids.unionid),
           updated_at = now()`,
    [openid, accountName, unionid]
  );
}

export async function openidsOfAccount(accountName) {
  await ensureMpTables();
  if (!accountName) return [];
  const r = await pool.query(
    'SELECT openid FROM public.mp_openids WHERE account_name = $1 ORDER BY updated_at DESC',
    [accountName]
  );
  return r.rows.map((x) => String(x.openid));
}

export async function linkStatus(accountName) {
  const openids = await openidsOfAccount(accountName);
  return { linked: openids.length > 0, count: openids.length, masked: openids.map(maskOpenid) };
}

/* ------------------------------------------------------------------ *
 * 订阅额度
 * ------------------------------------------------------------------ */

/**
 * 记录一次 wx.requestSubscribeMessage 的结果。
 *
 * accept → 额度 +1（这就是我们唯一能拿到的推送次数）
 * reject → 只记拒收时间。**不清零已有额度**：用户在别的入口攒的额度不该被
 *          这一次的拒收吞掉；拒收只影响「界面要不要提示他去设置里放开」。
 */
export async function recordSubscribeResults(accountName, items = []) {
  await ensureMpTables();
  const openids = await openidsOfAccount(accountName);
  if (!openids.length) return { updated: 0, reason: '还没绑定微信' };

  let updated = 0;
  for (const openid of openids) {
    for (const it of items) {
      const key = String(it && it.key ? it.key : '');
      if (!TEMPLATES[key]) continue;
      const accept = it.accept === true || it.accept === 'accept';
      if (accept) {
        await pool.query(
          `INSERT INTO public.mp_subscriptions (openid, template_key, remaining, accepted_total)
           VALUES ($1, $2, 1, 1)
           ON CONFLICT (openid, template_key) DO UPDATE
             SET remaining = public.mp_subscriptions.remaining + 1,
                 accepted_total = public.mp_subscriptions.accepted_total + 1,
                 rejected_at = NULL,
                 updated_at = now()`,
          [openid, key]
        );
      } else {
        await pool.query(
          `INSERT INTO public.mp_subscriptions (openid, template_key, remaining, accepted_total, rejected_at)
           VALUES ($1, $2, 0, 0, now())
           ON CONFLICT (openid, template_key) DO UPDATE
             SET rejected_at = now(), updated_at = now()`,
          [openid, key]
        );
      }
      updated += 1;
    }
  }
  return { updated };
}

export async function subscriptionsOf(accountName) {
  const openids = await openidsOfAccount(accountName);
  const out = {};
  for (const t of Object.values(TEMPLATES)) out[t.key] = { remaining: 0, rejected: false };
  if (!openids.length) return out;
  const r = await pool.query(
    `SELECT template_key, SUM(remaining) AS remaining, MAX(rejected_at) AS rejected_at
       FROM public.mp_subscriptions
      WHERE openid = ANY($1::text[])
      GROUP BY template_key`,
    [openids]
  );
  for (const row of r.rows) {
    const k = row.template_key;
    if (!out[k]) continue;
    out[k] = { remaining: Number(row.remaining || 0), rejected: !!row.rejected_at };
  }
  return out;
}

/**
 * 扣一次额度。返回 true 表示真的扣到了（可以推），false 表示没额度。
 * 用一条带条件的 UPDATE 完成「判断 + 扣减」，避免并发下两个请求同时看到剩余 1。
 */
async function consumeQuota(openid, key) {
  const r = await pool.query(
    `UPDATE public.mp_subscriptions
        SET remaining = remaining - 1, updated_at = now()
      WHERE openid = $1 AND template_key = $2 AND remaining > 0
      RETURNING remaining`,
    [openid, key]
  );
  return r.rowCount > 0;
}

/* ------------------------------------------------------------------ *
 * 站内信
 * ------------------------------------------------------------------ */

/**
 * 写一条站内信。同一个 (账号, 类型, 引用对象) 只会有一条 —— 靠数据库的部分唯一索引，
 * 这里用 ON CONFLICT DO NOTHING 吃掉重复，不当错误。
 * 返回插入的 id，重复时返回 null。
 */
export async function addInbox({
  accountName,
  category,
  title,
  body = null,
  page = null,
  refType = null,
  refId = null,
}) {
  await ensureMpTables();
  if (!accountName || !title) return null;
  const r = await pool.query(
    `INSERT INTO public.mp_inbox (account_name, category, title, body, page, ref_type, ref_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_name, ref_type, ref_id)
       WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      accountName,
      category,
      String(title).slice(0, 120),
      body ? String(body).slice(0, 500) : null,
      page ? String(page).slice(0, 200) : null,
      refType,
      refId === null || refId === undefined ? null : String(refId).slice(0, 32),
    ]
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}

export async function listInbox(accountName, { limit = 30, before = null } = {}) {
  await ensureMpTables();
  if (!accountName) return { items: [], unread: 0 };
  const args = [accountName, Math.min(Math.max(Number(limit) || 30, 1), 100)];
  let where = 'account_name = $1';
  if (before) {
    args.push(String(before));
    where += ` AND id < $${args.length}`;
  }
  const r = await pool.query(
    `SELECT id, category, title, body, page, ref_type, ref_id, read_at, created_at
       FROM public.mp_inbox
      WHERE ${where}
      ORDER BY id DESC
      LIMIT $2`,
    args
  );
  const unread = await unreadCount(accountName);
  return {
    items: r.rows.map((x) => ({ ...x, id: String(x.id), read: !!x.read_at })),
    unread,
  };
}

export async function unreadCount(accountName) {
  if (!accountName) return 0;
  const r = await pool.query(
    'SELECT COUNT(*)::int AS n FROM public.mp_inbox WHERE account_name = $1 AND read_at IS NULL',
    [accountName]
  );
  return r.rows[0] ? Number(r.rows[0].n) : 0;
}

export async function markInboxRead(accountName, { id = null, all = false } = {}) {
  await ensureMpTables();
  if (!accountName) return 0;
  if (all) {
    const r = await pool.query(
      'UPDATE public.mp_inbox SET read_at = now() WHERE account_name = $1 AND read_at IS NULL',
      [accountName]
    );
    return r.rowCount;
  }
  if (!id) return 0;
  const r = await pool.query(
    'UPDATE public.mp_inbox SET read_at = now() WHERE account_name = $1 AND id = $2 AND read_at IS NULL',
    [accountName, String(id)]
  );
  return r.rowCount;
}

/* ------------------------------------------------------------------ *
 * 推送
 * ------------------------------------------------------------------ */

async function logPush({
  openid,
  accountName,
  templateKey,
  scene,
  title,
  page,
  status,
  errcode = null,
  errmsg = null,
  payload = null,
}) {
  try {
    await pool.query(
      `INSERT INTO public.mp_push_logs
         (openid, account_name, template_key, scene, title, page, status, errcode, errmsg, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        openid || null,
        accountName || null,
        templateKey,
        scene,
        title ? String(title).slice(0, 120) : null,
        page ? String(page).slice(0, 200) : null,
        status,
        errcode,
        errmsg ? String(errmsg).slice(0, 200) : null,
        payload ? JSON.stringify(payload) : null,
      ]
    );
  } catch (e) {
    // 日志写不进去不能反过来把业务搞挂
    console.error('写推送日志失败:', e.message);
  }
}

/**
 * 发一条订阅消息。**永不抛异常**，返回值说明结果：
 *   { status: 'ok' | 'skip' | 'fail', reason?, errcode?, errmsg? }
 *
 * skip 的几种原因都是「正常情况」，不是 bug：
 *   no_config    服务端没配 AppSecret / 模板 id（AppSecret 后补时会一直走这里）
 *   no_quota     一次性订阅额度用完了
 *   no_openid    这个账号没绑定微信
 */
export async function sendSubscribe({
  openid,
  accountName,
  templateKey,
  data,
  page = null,
  scene = 'manual',
  title = null,
}) {
  const cfg = mpConfigured();
  const tpl = TEMPLATES[templateKey];
  const tplId = tpl ? cfg.templates[templateKey] : '';
  const finalPage = page || (tpl ? tpl.page : null);

  const skip = async (reason, extra = {}) => {
    await logPush({
      openid,
      accountName,
      templateKey,
      scene,
      title,
      page: finalPage,
      status: 'skip',
      errmsg: reason,
      payload: { reason, ...extra, data },
    });
    return { status: 'skip', reason };
  };

  if (!openid) return skip('no_openid');
  if (!cfg.canLogin) return skip('no_config');
  if (!tplId) return skip('no_template:' + (tpl ? tpl.envKey : templateKey));

  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    await logPush({
      openid,
      accountName,
      templateKey,
      scene,
      title,
      page: finalPage,
      status: 'fail',
      errmsg: e.message,
      payload: { data },
    });
    return { status: 'fail', errmsg: e.message };
  }

  const ok = await consumeQuota(openid, templateKey);
  if (!ok) return skip('no_quota');

  const body = {
    touser: openid,
    template_id: tplId,
    page: finalPage ? String(finalPage).slice(0, 128) : undefined,
    data,
    miniprogram_state: cfg.envVersion,
    lang: 'zh_CN',
  };

  const doSend = async (tk) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort('timeout'), 8000);
    try {
      const res = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(tk)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        }
      );
      const json = await res.json().catch(() => null);
      return json || { errcode: -1, errmsg: `HTTP ${res.status}` };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let json = await doSend(token);
    // 40001/42001：token 失效（被别的进程顶掉 / 过期）。重换一次再试，
    // 但**额度已经扣了**，重试不重复扣。
    if (json && (json.errcode === 40001 || json.errcode === 42001 || json.errcode === 40014)) {
      const fresh = await getAccessToken({ force: true });
      json = await doSend(fresh);
    }
    if (json && json.errcode === 0) {
      await logPush({
        openid,
        accountName,
        templateKey,
        scene,
        title,
        page: finalPage,
        status: 'ok',
        payload: { data },
      });
      return { status: 'ok' };
    }
    const errcode = json ? Number(json.errcode) || -1 : -1;
    const errmsg = json ? String(json.errmsg || '') : '空响应';
    await logPush({
      openid,
      accountName,
      templateKey,
      scene,
      title,
      page: finalPage,
      status: 'fail',
      errcode,
      errmsg,
      payload: { data },
    });
    // 43101：用户拒收 / 没订阅；把额度退还，免得白扣
    if (errcode === 43101) {
      await pool.query(
        `UPDATE public.mp_subscriptions SET remaining = remaining + 1, rejected_at = COALESCE(rejected_at, now())
          WHERE openid = $1 AND template_key = $2`,
        [openid, templateKey]
      );
    } else {
      // 其它失败（网络、参数不匹配）也把额度退回去，让下次还能试
      await pool.query(
        `UPDATE public.mp_subscriptions SET remaining = remaining + 1
          WHERE openid = $1 AND template_key = $2`,
        [openid, templateKey]
      );
    }
    return { status: 'fail', errcode, errmsg };
  } catch (e) {
    await pool.query(
      `UPDATE public.mp_subscriptions SET remaining = remaining + 1
        WHERE openid = $1 AND template_key = $2`,
      [openid, templateKey]
    );
    await logPush({
      openid,
      accountName,
      templateKey,
      scene,
      title,
      page: finalPage,
      status: 'fail',
      errmsg: e.message,
      payload: { data },
    });
    return { status: 'fail', errmsg: e.message };
  }
}

/* ------------------------------------------------------------------ *
 * 场景一：有人报名了我的招募（定向、即时）
 * ------------------------------------------------------------------ */

const SIGNUP_SCENE = {
  party: { label: '开黑', page: 'pages/party/party', category: 'party' },
  activity: { label: '活动', page: 'pages/activities/activities', category: 'activity' },
};

/**
 * 有人报名 → 通知发起人。
 *
 * 调用点只有两个（开黑报名、活动报名），且都在报名成功之后、返回响应之前。
 * 因此这里的**任何失败都必须被吞掉**：报名成功是主流程，通知失败不该让
 * 报名的人看到一个 500。
 */
export async function notifySignupToOwner({
  kind = 'party',
  postId,
  ownerAccount,
  postTitle = '',
  joinerName = '',
  extra = '',
}) {
  const scene = SIGNUP_SCENE[kind] || SIGNUP_SCENE.party;
  const refId = `${kind}-${postId}-${joinerName}`;
  const title = `有人报名了你的${scene.label}：${thing(postTitle, 24)}`;
  const body = `${joinerName || '群友'} 报名了「${postTitle || scene.label}」${extra ? '（' + extra + '）' : ''}`;

  try {
    await addInbox({
      accountName: ownerAccount,
      category: scene.category,
      title,
      body,
      page: scene.page,
      refType: 'signup',
      refId,
    });
  } catch (e) {
    console.error('写报名站内信失败:', e.message);
  }

  try {
    const openids = await openidsOfAccount(ownerAccount);
    if (!openids.length) return { pushed: 0, reason: 'owner_not_linked' };
    const data = {};
    const map = FIELD_MAP.signup;
    data[map.post] = { value: thing(postTitle || scene.label + '招募') };
    data[map.who] = { value: thing(`${joinerName || '群友'} 报名了`) };
    data[map.time] = { value: wxTime(new Date()) };

    let pushed = 0;
    for (const openid of openids) {
      const r = await sendSubscribe({
        openid,
        accountName: ownerAccount,
        templateKey: 'signup',
        data,
        page: `${scene.page}?id=${postId}`,
        scene: 'signup',
        title,
      });
      if (r.status === 'ok') pushed += 1;
    }
    return { pushed, total: openids.length };
  } catch (e) {
    console.error('报名订阅推送失败:', e.message);
    return { pushed: 0, reason: e.message };
  }
}

/* ------------------------------------------------------------------ *
 * 场景二：每日一条汇总（广播、批量）
 * ------------------------------------------------------------------ */

async function readWatermark() {
  const v = await kvGet(KV_WATERMARK);
  if (v && !isNaN(new Date(v).getTime())) return new Date(v);
  // 第一次跑：回看 24 小时，不要把历史全量倒出来
  return new Date(Date.now() - 24 * 3600 * 1000);
}

/** 收集一个时间窗内的新增。三类各自独立，某一类查失败不影响其它两类。 */
export async function collectDigest({ since, until = new Date() }) {
  const sinceIso = (since instanceof Date ? since : new Date(since)).toISOString();
  const untilIso = (until instanceof Date ? until : new Date(until)).toISOString();
  const out = { party: [], activity: [], tournament: [], errors: [] };

  try {
    const r = await pool.query(
      `SELECT id, COALESCE(NULLIF(title, ''), '') AS title, account_name, created_at
         FROM public.party_posts
        WHERE created_at > $1 AND created_at <= $2
        ORDER BY created_at DESC LIMIT 40`,
      [sinceIso, untilIso]
    );
    out.party = r.rows.map((x) => ({ id: String(x.id), title: x.title, account: x.account_name }));
  } catch (e) {
    out.errors.push('party: ' + e.message);
  }

  try {
    const r = await pool.query(
      `SELECT id, COALESCE(NULLIF(title, ''), '') AS title, type, account_name, created_at
         FROM public.activity_posts
        WHERE created_at > $1 AND created_at <= $2
        ORDER BY created_at DESC LIMIT 40`,
      [sinceIso, untilIso]
    );
    out.activity = r.rows.map((x) => ({
      id: String(x.id),
      title: x.title,
      type: x.type,
      account: x.account_name,
    }));
  } catch (e) {
    out.errors.push('activity: ' + e.message);
  }

  try {
    // 「开始筹办」= 这段时间内新建、且状态还在筹备阶段。已经打完的不该被当成新闻。
    const r = await pool.query(
      `SELECT id, name, status, start_date, created_at
         FROM public.tournaments
        WHERE created_at > $1 AND created_at <= $2
          AND status IN ('planning', 'planned')
        ORDER BY created_at DESC LIMIT 40`,
      [sinceIso, untilIso]
    );
    out.tournament = r.rows.map((x) => ({ id: String(x.id), name: x.name, start_date: x.start_date }));
  } catch (e) {
    out.errors.push('tournament: ' + e.message);
  }

  return out;
}

function digestLines(digest, interests) {
  const lines = [];
  if (interests.includes('party') && digest.party.length) {
    lines.push('开黑 ' + digest.party.length + ' 条');
  }
  if (interests.includes('activity') && digest.activity.length) {
    lines.push('活动 ' + digest.activity.length + ' 条');
  }
  if (interests.includes('tournament') && digest.tournament.length) {
    lines.push('赛事 ' + digest.tournament.length + ' 个');
  }
  return lines;
}

function digestDetail(digest, interests) {
  if (interests.includes('party') && digest.party.length) {
    const p = digest.party[0];
    return p.title || p.account + ' 发起了开黑';
  }
  if (interests.includes('activity') && digest.activity.length) {
    const a = digest.activity[0];
    return a.title || a.type + ' 活动';
  }
  if (interests.includes('tournament') && digest.tournament.length) {
    return digest.tournament[0].name || '新赛季';
  }
  return '';
}

export async function interestsOf(accountName) {
  await ensureMpTables();
  if (!accountName) return [];
  const r = await pool.query('SELECT category FROM public.mp_interests WHERE account_name = $1', [
    accountName,
  ]);
  return r.rows.map((x) => String(x.category)).filter((k) => CATEGORY_KEYS.includes(k));
}

export async function setInterests(accountName, list = []) {
  await ensureMpTables();
  if (!accountName) throw new Error('未登录');
  const want = Array.from(new Set(list.map((s) => String(s)).filter((k) => CATEGORY_KEYS.includes(k))));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM public.mp_interests WHERE account_name = $1', [accountName]);
    for (const k of want) {
      await client.query(
        'INSERT INTO public.mp_interests (account_name, category) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [accountName, k]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return want;
}

/**
 * 跑一次汇总。
 *
 * @param {{dryRun?: boolean, since?: Date, until?: Date, force?: boolean}} opts
 *   dryRun  只统计和写站内信，不真的发订阅消息（后台「预览」用）
 *   force   忽略「窗口太短就不跑」的保护。默认窗口 < 10 分钟直接跳过，
 *           挡的是 pm2 重启连跑两次、后台连点两下这类重复触发；
 *           手动补发某一整天时传它。
 *
 * 返回一份可以直接丢给后台页面的报告。
 */
export async function runDigest({ dryRun = false, since = null, until = new Date(), force = false } = {}) {
  await ensureMpTables();
  const from = since ? new Date(since) : await readWatermark();
  const untilDate = until instanceof Date ? until : new Date(until);
  const windowMin = (untilDate.getTime() - from.getTime()) / 60000;

  const report = {
    from: from.toISOString(),
    until: untilDate.toISOString(),
    windowMin: Math.round(windowMin),
    counts: { party: 0, activity: 0, tournament: 0, total: 0 },
    errors: [],
    recipients: 0,
    inbox: 0,
    pushed: 0,
    skipped: {},
    dryRun: !!dryRun,
    day: cnDay(untilDate),
    // 站内信去重键按**窗口起点**算，不按「哪一天」。
    // 按天去重会吞内容：同一天跑两次汇总，第二次写不进站内信，那段时间的新卡
    // 就永远不会出现在「消息」页里（推送更不用说）。按窗口起点算，每次汇总
    // 对应一个独立窗口，一条内容只会属于一个窗口，既不会重复也不会漏。
    windowKey: wxTime(from).replace(/[^0-9]/g, '').slice(0, 12),
  };

  // 窗口太短就跳过：pm2 重启 / 手动点两次都会走到这里。
  // 正常一天一条的窗口是 1000+ 分钟，10 分钟以内几乎不可能是「到了该发的点」。
  if (!force && windowMin < 10) {
    report.reason = 'window_too_short';
    return report;
  }

  const digest = await collectDigest({ since: from, until: untilDate });
  const total = digest.party.length + digest.activity.length + digest.tournament.length;
  report.counts = {
    party: digest.party.length,
    activity: digest.activity.length,
    tournament: digest.tournament.length,
    total,
  };
  report.errors = digest.errors;

  if (!total) {
    report.reason = 'no_new';
    if (!dryRun) {
      await kvSet(KV_WATERMARK, untilDate.toISOString());
      await kvSet(KV_LAST_RUN, JSON.stringify({ at: new Date().toISOString(), report }));
    }
    return report;
  }

  // 收件人 = 勾了至少一类、且这一类真的有新增的账号
  const r = await pool.query(
    `SELECT i.account_name, array_agg(i.category) AS categories
       FROM public.mp_interests i
      GROUP BY i.account_name`
  );
  const recipients = [];
  for (const row of r.rows) {
    const categories = (row.categories || []).map(String).filter((k) => CATEGORY_KEYS.includes(k));
    if (!categories.length) continue;
    if (!digestLines(digest, categories).length) continue;
    recipients.push({ account: String(row.account_name), categories });
  }
  report.recipients = recipients.length;

  for (const rc of recipients) {
    const lines = digestLines(digest, rc.categories);
    const detail = digestDetail(digest, rc.categories);
    // 摘要必须是**这个人关心的那几类**的计数，不能拿全局计数 —— 只订阅赛事的人
    // 不该在消息里看到「开黑 3 条」，那是一条他用不上的信息，还占 20 字上限。
    const summaryText = lines.join('·') || '有新的群活动';
    const title = `每日汇总：${lines.join('·')}`;
    const body = [
      lines.join('，'),
      digest.party.length && rc.categories.includes('party')
        ? '开黑：' + digest.party.slice(0, 3).map((x) => x.title || x.account + ' 的开黑').join('、')
        : '',
      digest.activity.length && rc.categories.includes('activity')
        ? '活动：' + digest.activity.slice(0, 3).map((x) => x.title || x.type).join('、')
        : '',
      digest.tournament.length && rc.categories.includes('tournament')
        ? '赛事：' + digest.tournament.slice(0, 3).map((x) => x.name).join('、')
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const id = await addInbox({
        accountName: rc.account,
        category: 'digest',
        title,
        body,
        page: 'pages/messages/messages',
        refType: 'digest',
        refId: report.windowKey,
      });
      if (id) report.inbox += 1;
    } catch (e) {
      console.error('写汇总站内信失败:', e.message);
    }

    if (dryRun) continue;

    let openids = [];
    try {
      openids = await openidsOfAccount(rc.account);
    } catch (e) {
      console.error('查 openid 失败:', e.message);
    }
    if (!openids.length) {
      report.skipped.no_openid = (report.skipped.no_openid || 0) + 1;
      continue;
    }

    const data = {};
    const map = FIELD_MAP.digest;
    data[map.summary] = { value: thing(summaryText, 20) };
    data[map.time] = { value: wxTime(untilDate) };
    data[map.detail] = { value: thing(detail || '打开小程序查看', 20) };

    for (const openid of openids) {
      const res = await sendSubscribe({
        openid,
        accountName: rc.account,
        templateKey: 'digest',
        data,
        page: 'pages/messages/messages',
        scene: 'digest',
        title,
      });
      if (res.status === 'ok') report.pushed += 1;
      else report.skipped[res.reason || res.status] = (report.skipped[res.reason || res.status] || 0) + 1;
    }
  }

  if (!dryRun) {
    await kvSet(KV_WATERMARK, untilDate.toISOString());
    await kvSet(KV_LAST_RUN, JSON.stringify({ at: new Date().toISOString(), report }));
  }
  return report;
}

/* ------------------------------------------------------------------ *
 * 后台读取
 * ------------------------------------------------------------------ */

/** 订阅用户列表：按账号聚合，带上额度、关注类别、未读、最近推送结果。 */
export async function listSubscribers({ q = '', limit = 200 } = {}) {
  await ensureMpTables();
  const kw = String(q || '').trim().toLowerCase();
  const args = [];
  let where = '1=1';
  if (kw) {
    args.push('%' + kw + '%');
    where += ` AND (o.account_name ILIKE $${args.length} OR o.openid ILIKE $${args.length})`;
  }
  args.push(Math.min(Math.max(Number(limit) || 200, 1), 500));

  const r = await pool.query(
    `SELECT o.account_name,
            array_agg(DISTINCT o.openid)                         AS openids,
            MAX(o.updated_at)                                    AS linked_at,
            COALESCE(SUM(s.remaining), 0)                        AS quota,
            COALESCE(SUM(s.accepted_total), 0)                   AS accepted,
            MAX(s.rejected_at)                                   AS rejected_at,
            COALESCE((SELECT array_agg(i.category) FROM public.mp_interests i
                       WHERE i.account_name = o.account_name), '{}') AS interests,
            COALESCE((SELECT COUNT(*) FROM public.mp_inbox b
                       WHERE b.account_name = o.account_name AND b.read_at IS NULL), 0) AS unread,
            (SELECT l.status FROM public.mp_push_logs l
              WHERE l.account_name = o.account_name ORDER BY l.id DESC LIMIT 1) AS last_status,
            (SELECT l.created_at FROM public.mp_push_logs l
              WHERE l.account_name = o.account_name ORDER BY l.id DESC LIMIT 1) AS last_push_at
       FROM public.mp_openids o
       LEFT JOIN public.mp_subscriptions s ON s.openid = o.openid
      WHERE ${where}
      GROUP BY o.account_name
      ORDER BY MAX(o.updated_at) DESC
      LIMIT $${args.length}`,
    args
  );
  return r.rows.map((x) => ({
    account: x.account_name,
    openids: (x.openids || []).map(maskOpenid),
    openidCount: (x.openids || []).length,
    linkedAt: x.linked_at,
    quota: Number(x.quota || 0),
    accepted: Number(x.accepted || 0),
    rejected: !!x.rejected_at,
    interests: (x.interests || []).filter((k) => k),
    unread: Number(x.unread || 0),
    lastStatus: x.last_status || null,
    lastPushAt: x.last_push_at || null,
  }));
}

export async function listPushLogs({ status = '', scene = '', limit = 100, before = null } = {}) {
  await ensureMpTables();
  const args = [];
  const conds = [];
  if (status) {
    args.push(String(status));
    conds.push(`status = $${args.length}`);
  }
  if (scene) {
    args.push(String(scene));
    conds.push(`scene = $${args.length}`);
  }
  if (before) {
    args.push(String(before));
    conds.push(`id < $${args.length}`);
  }
  args.push(Math.min(Math.max(Number(limit) || 100, 1), 300));
  const r = await pool.query(
    `SELECT id, openid, account_name, template_key, scene, title, page, status, errcode, errmsg,
            payload, created_at
       FROM public.mp_push_logs
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY id DESC
      LIMIT $${args.length}`,
    args
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    openid: maskOpenid(x.openid),
    account: x.account_name,
    templateKey: x.template_key,
    scene: x.scene,
    title: x.title,
    page: x.page,
    status: x.status,
    errcode: x.errcode,
    errmsg: x.errmsg,
    payload: x.payload,
    createdAt: x.created_at,
  }));
}

/** 汇总页要的几个数 */
export async function subscriptionStats() {
  await ensureMpTables();
  const [linked, withQuota, unreadAll, todayPush, lastRun] = await Promise.all([
    pool.query('SELECT COUNT(DISTINCT account_name)::int AS n FROM public.mp_openids'),
    pool.query(
      `SELECT COUNT(DISTINCT o.account_name)::int AS n
         FROM public.mp_openids o JOIN public.mp_subscriptions s ON s.openid = o.openid
        WHERE s.remaining > 0`
    ),
    pool.query('SELECT COUNT(*)::int AS n FROM public.mp_inbox WHERE read_at IS NULL'),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM public.mp_push_logs
        WHERE status = 'ok' AND created_at::date = now()::date`
    ),
    kvGet(KV_LAST_RUN),
  ]);
  let last = null;
  try {
    last = lastRun ? JSON.parse(lastRun) : null;
  } catch {
    last = null;
  }
  return {
    linkedAccounts: Number(linked.rows[0]?.n || 0),
    accountsWithQuota: Number(withQuota.rows[0]?.n || 0),
    unreadTotal: Number(unreadAll.rows[0]?.n || 0),
    pushedToday: Number(todayPush.rows[0]?.n || 0),
    lastDigest: last,
    configured: mpConfigured(),
  };
}
