/**
 * 英雄列表的检索与筛选口径（唯一来源）
 *
 * heroesData 每条是 { id, name, nickname }，nickname 是一串逗号分隔的别称，
 * **约定最后一位是属性**（力量 / 敏捷 / 智力 / 全才）。这里把这套隐式约定
 * 显式抽出来，免得每个页面各写一遍 split(',')。
 */

export const HERO_ATTRS = [
  { key: 'strength', label: '力量' },
  { key: 'agility', label: '敏捷' },
  { key: 'intelligence', label: '智力' },
  { key: 'universal', label: '全才' },
];

const ATTR_BY_TOKEN = {
  力量: 'strength',
  敏捷: 'agility',
  智力: 'intelligence',
  全才: 'universal',
};

const ATTR_KEYS = HERO_ATTRS.map((a) => a.key);

/** 别称 token 列表（已去掉属性位、已去空白） */
export function heroAliases(hero) {
  return String((hero && hero.nickname) || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((t) => !ATTR_BY_TOKEN[t]);
}

/** 属性 key；识别不出来返回 null（如历史数据里的「力量智力」这种连写） */
export function heroAttr(hero) {
  const tokens = String((hero && hero.nickname) || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 从后往前找，属性按约定在最后
  for (let i = tokens.length - 1; i >= 0; i--) {
    const key = ATTR_BY_TOKEN[tokens[i]];
    if (key) return key;
  }

  // 兼容「力量智力」这类连写：取最后一个命中的属性
  const joined = tokens.join('');
  for (let i = ATTR_KEYS.length - 1; i >= 0; i--) {
    const label = HERO_ATTRS[i].label;
    if (joined.includes(label)) return HERO_ATTRS[i].key;
  }
  return null;
}

/** 搜索匹配：英雄名 / 任意别称 命中即算 */
export function heroMatches(hero, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return true;
  const name = String((hero && hero.name) || '').toLowerCase();
  if (name.includes(kw)) return true;
  return heroAliases(hero).some((a) => a.toLowerCase().includes(kw));
}

/** 组合筛选：属性 + 关键字 */
export function filterHeroes(list, { attr = 'all', keyword = '' } = {}) {
  return (list || []).filter((h) => {
    if (attr && attr !== 'all' && heroAttr(h) !== attr) return false;
    return heroMatches(h, keyword);
  });
}
