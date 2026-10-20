/**
 * 全站共用的选项常量（唯一来源）
 *
 * 之前 POSITIONS 在 profile.js 和 members/index.js 各抄了一份，
 * 新增开黑页时如果继续抄就是第三份，索性抽出来。
 */

// 场上位置
export const POSITIONS = ['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'];

// 开黑模式
export const PARTY_MODES = [
  { key: 'ranked', label: '天梯', hint: '打段位分，认真一点' },
  { key: 'normal', label: '普通匹配', hint: '随便打打，练英雄' },
  { key: 'single_draft', label: '单一征召', hint: '强制征召模式' },
  { key: 'turbo', label: '加速', hint: '快节奏，一局半小时' },
];

export const PARTY_MODE_LABELS = PARTY_MODES.map((m) => m.label);

export function modeLabel(key) {
  const m = PARTY_MODES.find((x) => x.key === key || x.label === key);
  return m ? m.label : key || '—';
}

// 语音软件
export const VOICE_APPS = ['KOOK', 'YY', 'Discord', '微信群语音', 'QQ 语音', '游戏内语音', '其他'];

// 开黑时间：给几个常用快捷项，也允许自己写
export const TIME_PRESETS = ['今天下午', '今晚 20:00 后', '今晚 21:00 后', '周末白天', '周末晚上'];

// 开黑卡片状态
export const PARTY_STATUS = {
  open: { label: '招募中', cls: 'b-active' },
  full: { label: '已满', cls: 'b-done' },
  closed: { label: '已关闭', cls: 'b-planned' },
};
