/**
 * 全站选项常量（公开只读）。
 *
 * 为什么要有这个接口：`lib/options.mjs` 是选项的唯一来源，但它只有 Web 端能
 * import（服务端 + 客户端同一份 bundle）。小程序是独立前端，拿不到这个模块，
 * 最省事的做法是在小程序里再抄一份 —— 那就会变成第四份（POSITIONS 已经抄过
 * 三次了，见 lib/options.mjs 开头的注释）。宁可多一个只读接口。
 *
 * 常量几乎不变，缓存 1 小时；改选项后最多一小时生效。
 */
import {
  POSITIONS,
  PARTY_MODES,
  DURATION_OPTIONS,
  NEED_PLAYER_OPTIONS,
  VOICE_APPS,
  TIME_PRESETS,
  PARTY_STATUS,
  ACTIVITY_TYPES,
  ACTIVITY_STATUS,
  ACTIVITY_COSTS,
} from '../../lib/options.mjs';
import { LIMITS } from '../../lib/moderation.mjs';
import { GUILD_COLORS, GUILD_ALPHA_START, GUILD_ALPHA_END, GUILD_BORDER_ALPHA } from '../../lib/guild-colors.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({
    success: true,
    positions: POSITIONS,
    partyModes: PARTY_MODES,
    durations: DURATION_OPTIONS,
    needPlayers: NEED_PLAYER_OPTIONS,
    voiceApps: VOICE_APPS,
    timePresets: TIME_PRESETS,
    partyStatus: PARTY_STATUS,
    activityTypes: ACTIVITY_TYPES,
    activityCosts: ACTIVITY_COSTS,
    activityStatus: ACTIVITY_STATUS,
    // 帮派配色也走这里：色板是 lib/guild-colors.mjs 的唯一来源，
    // 小程序再抄一份就会和「已被占用的配色要置灰」的判定对不上。
    guildColors: GUILD_COLORS,
    guildAlpha: { start: GUILD_ALPHA_START, end: GUILD_ALPHA_END, border: GUILD_BORDER_ALPHA },
    limits: {
      title: LIMITS.title,
      note: LIMITS.note,
      location: LIMITS.location,
      review: LIMITS.review,
      myRank: LIMITS.myRank,
      wantRank: LIMITS.wantRank,
      voiceApp: LIMITS.voiceApp,
      guildName: LIMITS.guildName,
      guildSlogan: LIMITS.guildSlogan,
      guildInvite: LIMITS.guildInvite,
      // 个人信息页要卡长度：不从这里下发，小程序就得自己抄一份，抄一次迟早和
      // lib/moderation.mjs 对不上（多一个字符就被服务端打回来，用户看不懂为什么）
      nickname: LIMITS.nickname,
      selfIntro: LIMITS.selfIntro,
      region: LIMITS.region,
      heroItem: LIMITS.heroItem,
    },
  });
}
