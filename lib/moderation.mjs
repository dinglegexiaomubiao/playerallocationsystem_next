/**
 * UGC 文本审核（前后端共用）：
 *   1. 字数限制 —— LIMITS 表 + clipText 截断
 *   2. 合规初筛 —— 违禁词（赌博/色情/毒品/暴恐/诈骗/引流广告/链接）命中即拦截
 *
 * 设计原则：
 *   - 词表只收「明确违规」的词，避免误伤正常聊天（拿不准的宁可不拦）。
 *   - 匹配时做一层「去空白/符号」的归一化，防「加 微 信」这类空格规避。
 *   - checkInput 是唯一入口：超长自动截断（不报错），违禁返回 { ok:false, category, word }。
 */

// 各字段字数上限（与 DB varchar 长度和 UI 布局对齐）
export const LIMITS = {
  title: 80,            // 开黑 / 活动标题
  note: 500,            // 备注（开黑 / 活动 / 美食）
  selfIntro: 300,       // 自我评价
  location: 80,         // 活动集合地点
  review: 300,          // 美食评价
  nickname: 24,         // 群昵称 / 选手昵称
  username: 24,         // 登录账号
  teamName: 30,         // 队伍名
  tournamentName: 60,   // 赛事名
  region: 50,           // 地区路径
  myRank: 30,           // 我的段位
  wantRank: 30,         // 期望段位
  voiceApp: 50,         // 语音软件
  contact: 120,         // 售后联系方式
  message: 4000,        // 售后工单内容
  heroItem: 20,         // 单个英雄/位置名
  sponsor: 100,         // 赞助信息
  prize: 100,           // 奖品说明
  reviewer: 50,         // 评价人署名
  guildName: 12,        // 帮派名称（短、好记、卡片上放得下）
  guildSlogan: 40,      // 帮派口号
  guildInvite: 60,      // 帮派邀请语
  quote: 120,           // 群友语录正文（再长就不是语录了，悬浮栏也放不下）
  quoteSource: 40,      // 语录出处（仅自定义时；选群友不占这个额度）
  reviewComment: 200,   // 语录评价里的文字（可选，有才过审核）
};

const clipText = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return [...s].length > n ? [...s].slice(0, n).join('') : s;
};

// 违禁词表：category 是给用户看的提示类别
const BANNED = [
  { category: '赌博', words: ['赌球', '博彩', '六合彩', '外围盘', '开盘下注', '网上赌', '赌博网站', '菠菜平台', '押注返水', '上分下分'] },
  { category: '色情低俗', words: ['嫖娼', '援交', '约炮', '一夜情服务', '裸聊', '色情服务', '上门服务', '包夜服务'] },
  { category: '毒品违禁', words: ['冰毒', '贩毒', '吸毒代购', '出售大麻', '购买大麻'] },
  { category: '暴恐违禁', words: ['买枪', '卖枪', '制爆', '爆炸物出售', '管制刀具出售'] },
  { category: '疑似诈骗', words: ['刷单返利', '兼职刷单', '高额返利', '保证金转账', '先转账后发货', '解冻费'] },
  { category: '违规引流', words: ['加微信', '加v信', '加V信', '微信号', '威信同号', 'vx同号', 'VX同号', '加qq', '加QQ', 'qq群号', 'QQ群号', '电报群', '飞机群', '私聊转账', '扫码进群'] },
  { category: '游戏黑产广告', words: ['代练接单', '低价代练', '出售账号', '收账号', '金币出售', '充值打折', '低价充值'] },
  { category: '辱骂攻击', words: ['傻逼', '煞笔', '脑残', 'nmsl', 'NMSL', '妈逼', '滚蛋去死'] },
];

// 归一化：去掉空白和常见分隔符号，防「加 微 信」「微-信」规避
const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s\u200b-\u200f\uFEFF·•*_~\-—=|/\\.,!?！？，。、;；:：‘’“'"`【】\[\]（）()<>《》]+/g, '');

// 构建归一化后的命中表（word 也归一化）
const BANNED_NORMALIZED = BANNED.map((g) => ({
  category: g.category,
  words: g.words.map((w) => normalize(w)).filter(Boolean),
}));

// 链接白名单：Dota 相关站点是正常分享，不算引流
const URL_WHITELIST = /opendota\.com|dotabuff\.com|stratz\.com|steamcommunity\.com|steampowered\.com|bilibili\.com|b23\.tv/i;

// 单段文本合规检查：返回 { ok:true } 或 { ok:false, category, word }
export const checkText = (value) => {
  if (value === null || value === undefined) return { ok: true };
  const raw = String(value);
  if (!raw.trim()) return { ok: true };

  // 含链接先提示（引流常见形态；白名单内的 Dota/Steam 相关站点放行）
  if (/https?:\/\/|www\.|\.com|\.cn|\.net|\.top|\.xyz/i.test(raw) && !URL_WHITELIST.test(raw)) {
    return { ok: false, category: '外链', word: raw.slice(0, 20) };
  }

  const norm = normalize(raw);
  for (const g of BANNED_NORMALIZED) {
    for (const w of g.words) {
      if (norm.includes(w)) {
        return { ok: false, category: g.category, word: g.words.find((x) => norm.includes(x)) || w };
      }
    }
  }
  return { ok: true };
};

/**
 * 批量校验 + 清洗。
 * @param {object} obj   原始输入（如 req.body / 表单 state）
 * @param {object} spec  { 字段: LIMITS.xxx }，只处理字符串值
 * @returns {{ ok:true, cleaned:object } | { ok:false, field, category, word }}
 */
export const checkInput = (obj, spec) => {
  const cleaned = {};
  for (const [field, max] of Object.entries(spec)) {
    const v = obj ? obj[field] : undefined;
    if (v === null || v === undefined) {
      cleaned[field] = v;
      continue;
    }
    if (typeof v !== 'string') {
      cleaned[field] = v;
      continue;
    }
    const hit = checkText(v);
    if (!hit.ok) {
      return { ok: false, field, category: hit.category, word: hit.word };
    }
    cleaned[field] = clipText(v, max);
  }
  return { ok: true, cleaned };
};

// 给用户的统一提示文案
export const moderationMessage = (r) =>
  `「${r.field}」里检测到不合适的内容（${r.category}），请修改后再提交`;
