import MultiSelectFilter from '../MultiSelectFilter';
import { POSITIONS } from '../../lib/options.mjs';

/**
 * 群友筛选栏（纯展示，不含筛选逻辑）。
 *
 * 从 `pages/members/index.js` 抽出，供两处共用：
 *   1. `/members` 群友列表
 *   2. 帮派的「邀请成员」选择器（那里也需要同一套搜索与筛选）
 *
 * 逻辑在 `lib/member-filter.mjs`，这里只负责渲染。分开的原因是邀请选择器
 * 只要「筛选结果」不要这排控件的时候（比如手机上的紧凑模式），可以只用逻辑。
 *
 * ⚠ 这次是纯重构：DOM 结构、类名、文案必须和抽出前完全一致。
 * 验证方式是 `.cache/baseline-members.cjs` 的 11 步基线对比（含筛选栏结构指纹）。
 *
 * props 全由调用方给，组件自己不持有 state —— 筛选条件要能写进 URL 或跨组件同步时，
 * 状态放在页面里比藏在这里更方便（地图页的 `?dist=` 就是这么做的）。
 */
export default function MemberFilterPanel({
  filters,
  onChange,
  players = [],
  facets = { region: [], hero: [] },
  tierFacets = [],
  scoreFacets = [],
  resultCount = 0,
  activeCount = 0,
  onReset,
  compact = false,
}) {
  const set = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className={'filter-bar' + (compact ? ' is-compact' : '')}>
      <div className="filter-field filter-field-search">
        <label>搜索</label>
        <div className="filter-search">
          <input
            className={String(filters.keyword || '').trim() ? 'is-active' : ''}
            value={filters.keyword}
            onChange={(e) => set({ keyword: e.target.value })}
            placeholder="昵称 / steamID / 群昵称 / 地区 / 英雄 / 评价…"
            aria-label="搜索群友"
          />
          {filters.keyword && (
            <button
              type="button"
              className="filter-search-clear"
              aria-label="清空搜索"
              onClick={() => set({ keyword: '' })}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="filter-field">
        <label>段位</label>
        <select
          className={filters.tier !== 'all' ? 'is-active' : ''}
          value={filters.tier}
          onChange={(e) => set({ tier: e.target.value })}
        >
          <option value="all">全部段位（{players.length}）</option>
          {tierFacets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}（{t.count}）
            </option>
          ))}
        </select>
      </div>

      <div className="filter-field">
        <label>天梯分</label>
        <select
          className={filters.score !== 'all' ? 'is-active' : ''}
          value={filters.score}
          onChange={(e) => set({ score: e.target.value })}
        >
          {scoreFacets.map((r) => (
            <option key={r.value} value={r.value}>
              {r.value === 'all' ? `不限（${r.count} 人有分数）` : `${r.label}（${r.count}）`}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-field">
        <label>位置</label>
        <MultiSelectFilter
          label="擅长位置"
          allLabel="全部位置"
          unit="位群友"
          options={POSITIONS.map((p) => ({
            value: p,
            count: players.filter((x) => (x.positions || []).includes(p)).length,
          }))}
          value={filters.position}
          onChange={(next) => set({ position: next })}
        />
      </div>

      <div className="filter-field">
        <label>地区</label>
        <select
          className={filters.region !== '全部' ? 'is-active' : ''}
          value={filters.region}
          onChange={(e) => set({ region: e.target.value })}
        >
          <option value="全部">全部地区（{players.length}）</option>
          {facets.region.map(([k, n]) => (
            <option key={k} value={k}>
              {k}（{n}）
            </option>
          ))}
        </select>
      </div>

      <div className="filter-field">
        <label>擅长英雄</label>
        <MultiSelectFilter
          label="擅长英雄"
          allLabel="全部英雄"
          unit="位群友"
          options={facets.hero.map(([k, n]) => ({ value: k, count: n }))}
          value={filters.hero}
          onChange={(next) => set({ hero: next })}
        />
      </div>

      <div className="filter-field">
        <label>排序</label>
        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
          <option value="score">按天梯分</option>
          <option value="champion">按冠军数</option>
          <option value="name">按昵称</option>
        </select>
      </div>

      <div className="filter-summary">
        <span>
          筛出 <b>{resultCount}</b> / {players.length} 位
        </span>
        {activeCount > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={onReset}>
            重置
          </button>
        )}
      </div>
    </div>
  );
}
