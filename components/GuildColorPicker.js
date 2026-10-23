import { GUILD_COLORS, GUILD_ALPHA_START, GUILD_ALPHA_END, hexToRgba } from '../lib/guild-colors.mjs';

/**
 * 帮派配色选择器：12 个色块，已占用的置灰。
 *
 * 为什么不是自由取色：卡片的渐变背景必须保证「日间白底 + 夜间深底」两种情况下
 * 文字都能看清。12 套色的 0.12 透明度已经验算过（24 组全部 ≥ 4.5:1），
 * 让用户自己填 #RRGGBB 就没法保证这件事了。详见 lib/guild-colors.mjs。
 *
 * 已占用的置灰不是「提示」，而是提前告诉用户别试 —— 真正的拦截在数据库唯一索引
 * （两个人同时选同一支，应用层判断会漏）。
 *
 * @param value    当前选中的 colorKey
 * @param used     { colorKey: 占用它的帮派名 }，来自 GET /api/guild
 * @param ownName  我所在帮派的名字。它自己占用的那支不算「被占用」，
 *                 否则管理弹窗里当前配色是灰的，看着像坏了。
 */
export default function GuildColorPicker({ value, onChange, used = {}, ownName = '', disabled = false }) {
  return (
    <div className="guild-colors" role="radiogroup" aria-label="帮派配色">
      {GUILD_COLORS.map((c) => {
        const owner = used[c.key];
        const taken = !!owner && owner !== ownName;
        const selected = value === c.key;
        return (
          <button
            type="button"
            key={c.key}
            role="radio"
            aria-checked={selected}
            disabled={disabled || (taken && !selected)}
            className={'guild-color' + (selected ? ' is-on' : '') + (taken && !selected ? ' is-taken' : '')}
            title={taken ? `${c.label}（已被「${owner}」使用）` : c.label}
            onClick={() => onChange(c.key)}
          >
            <span
              className="guild-color-dot"
              style={{
                background: `linear-gradient(135deg, ${hexToRgba(c.solid, GUILD_ALPHA_START)}, ${hexToRgba(
                  c.solid,
                  GUILD_ALPHA_END
                )})`,
                borderColor: c.solid,
              }}
            />
            <span className="guild-color-name">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
