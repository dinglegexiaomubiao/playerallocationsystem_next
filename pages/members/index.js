import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import ExcelIO from '../../components/ExcelIO';
import useSession from '../../hooks/useSession';
import Avatar from '../../components/Avatar';
import AvatarSync from '../../components/AvatarSync';
import HeroAvatar from '../../components/HeroAvatar';
import { PLAYER_COLUMNS, splitList } from '../../lib/excel';
import { TIERS, tierOf } from '../../lib/tier.mjs';

const POSITIONS = ['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'];

// 天梯分区间。min/max 为 null 表示该侧不设限；none 表示「未填写分数」
const SCORE_RANGES = [
  { value: 'all', label: '不限', min: null, max: null },
  { value: '6000+', label: '6000 分以上', min: 6000, max: null },
  { value: '5000-6000', label: '5000 - 6000', min: 5000, max: 6000 },
  { value: '4000-5000', label: '4000 - 5000', min: 4000, max: 5000 },
  { value: '3000-4000', label: '3000 - 4000', min: 3000, max: 4000 },
  { value: '2000-3000', label: '2000 - 3000', min: 2000, max: 3000 },
  { value: '0-2000', label: '2000 分以下', min: null, max: 2000 },
  { value: 'none', label: '未填写分数', min: null, max: null, none: true },
];

const EMPTY_FILTERS = {
  keyword: '',
  tier: 'all',
  score: 'all',
  position: '全部',
  region: '全部',
  hero: '全部',
  sort: 'score',
};

// 把一名选手所有可检索信息拼成小写文本，供搜索使用（全字段）
function buildHaystack(p) {
  const parts = [
    p.nickname,
    p.group_nickname,
    p.game_id,
    p.region,
    p.self_intro,
    tierOf(Number(p.score) || 0).label,
    ...(p.positions || []),
    ...(p.heroes || []),
  ];
  return parts
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
    .join(' ')
    .toLowerCase();
}

export default function MembersPage() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // 当前登录身份，统一走 useSession（登出后所有订阅组件立刻同步）
  const { isAdmin } = useSession();

  const reload = () => {
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => setPlayers(d.players || []))
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setPlayers(d.players || []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 选手 id -> 昵称，用于把「默契选手」里的 id 显示成昵称
  const nameMap = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(String(p.id), p.nickname));
    return m;
  }, [players]);

  // 地区 / 擅长英雄 选项从真实数据生成，按出现次数降序（英雄池可达上百种，写死会漏）
  const facets = useMemo(() => {
    const build = (picker) => {
      const m = new Map();
      players.forEach((p) => {
        picker(p).forEach((v) => {
          const key = String(v === null || v === undefined ? '' : v).trim();
          if (key) m.set(key, (m.get(key) || 0) + 1);
        });
      });
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
    };
    return {
      region: build((p) => [p.region]),
      hero: build((p) => p.heroes || []),
    };
  }, [players]);

  // 各段位 / 分数区间命中数
  const tierFacets = useMemo(
    () =>
      TIERS.map((t) => ({
        ...t,
        count: players.filter((p) => {
          const s = Number(p.score) || 0;
          if (t.min !== null && s < t.min) return false;
          if (t.max !== null && s >= t.max) return false;
          return true;
        }).length,
      })),
    [players]
  );

  const scoreFacets = useMemo(
    () =>
      SCORE_RANGES.map((r) => ({
        ...r,
        count: players.filter((p) => {
          const raw = p.score;
          const has = raw !== null && raw !== undefined && Number(raw) > 0;
          if (r.none) return !has;
          if (!has) return false;
          const v = Number(raw);
          if (r.min !== null && v < r.min) return false;
          if (r.max !== null && v >= r.max) return false;
          return true;
        }).length,
      })),
    [players]
  );

  // 搜索索引：id -> 全字段小写文本，避免每次筛选重复拼接
  const searchIndex = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(p.id, buildHaystack(p)));
    return m;
  }, [players]);

  const filtered = useMemo(() => {
    const tier = TIERS.find((t) => t.key === filters.tier);
    const score = SCORE_RANGES.find((r) => r.value === filters.score);
    // 空格分词，每个词都要命中（如「南山 中单」）
    const kws = String(filters.keyword || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const list = players.filter((p) => {
      if (kws.length > 0) {
        const hay = searchIndex.get(p.id) || '';
        if (!kws.every((k) => hay.includes(k))) return false;
      }
      // 段位
      if (tier) {
        const s = Number(p.score) || 0;
        if (tier.min !== null && s < tier.min) return false;
        if (tier.max !== null && s >= tier.max) return false;
      }
      // 分数区间
      if (score && score.value !== 'all') {
        const raw = p.score;
        const has = raw !== null && raw !== undefined && Number(raw) > 0;
        if (score.none) {
          if (has) return false;
        } else {
          if (!has) return false;
          const v = Number(raw);
          if (score.min !== null && v < score.min) return false;
          if (score.max !== null && v >= score.max) return false;
        }
      }
      // 擅长位置
      if (filters.position !== '全部' && !(p.positions || []).includes(filters.position)) return false;
      // 地区
      if (filters.region !== '全部' && String(p.region || '').trim() !== filters.region) return false;
      // 擅长英雄
      if (filters.hero !== '全部' && !(p.heroes || []).includes(filters.hero)) return false;
      return true;
    });

    if (filters.sort === 'score') list.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (filters.sort === 'champion') list.sort((a, b) => (b.championships || 0) - (a.championships || 0));
    else if (filters.sort === 'name') list.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
    return list;
  }, [players, filters, searchIndex]);

  const activeCount =
    (String(filters.keyword || '').trim() ? 1 : 0) +
    (filters.tier !== 'all' ? 1 : 0) +
    (filters.score !== 'all' ? 1 : 0) +
    (filters.position !== '全部' ? 1 : 0) +
    (filters.region !== '全部' ? 1 : 0) +
    (filters.hero !== '全部' ? 1 : 0);

  const handleImport = async (rows, onProgress) => {
    const list = rows
      .map((row) => ({
        nickname: String(row['昵称'] || '').trim(),
        game_id: String(row['steamID'] || '').trim(),
        group_nickname: String(row['群昵称'] || '').trim(),
        score: Number(row['天梯分']) || 0,
        positions: splitList(row['擅长位置']),
        heroes: splitList(row['擅长英雄']),
        win_rate: Number(row['胜率']) || 0,
        championships: Number(row['冠军数']) || 0,
        synergy_players: splitList(row['默契选手']),
        region: String(row['所处地区'] || '').trim() || null,
        self_intro: String(row['自我评价'] || '').trim() || null,
        enemies: splitList(row['仇人']),
      }))
      .filter((p) => p.nickname);

    if (list.length === 0) {
      alert('没有解析到有效数据，请确认表头与「下载模板」一致');
      return;
    }

    const total = list.length;
    for (let i = 0; i < total; i++) {
      const p = list[i];
      let err = '';
      try {
        const r = await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-excel-import': '1' },
          body: JSON.stringify(p),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) err = d.error || d.message || `请求失败（HTTP ${r.status}）`;
      } catch (e) {
        err = (e && e.message) || '网络错误';
      }
      if (onProgress) onProgress(i + 1, total, { name: p.nickname, error: err });
    }
    reload();
  };

  // 去重：steamID 相同 或 昵称相同，视为重复
  const checkDuplicate = (row, existing) => {
    const gid = String(row['steamID'] || '').trim();
    const nick = String(row['昵称'] || '').trim();
    return existing.some(
      (p) => (gid && String(p.game_id || '') === gid) || (nick && (p.nickname || '') === nick)
    );
  };

  return (
    <>
      <Head>
        <title>群友信息 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap hero-bar">
          <div className="hero-bar-main">
            <h1>
              群友<span className="hl">信息</span>
            </h1>
            <p>共 {players.length} 位群友 · 天梯分、擅长位置与英雄池一览</p>
          </div>
          <div className="hero-actions">
            <AvatarSync isAdmin={isAdmin} onDone={reload} />
            <ExcelIO
              columns={PLAYER_COLUMNS}
              rows={players}
              filename="群友信息.xlsx"
              templateName="群友信息_导入模板.xlsx"
              onImport={handleImport}
              canManage={isAdmin}
              checkDuplicate={checkDuplicate}
            />
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="filter-bar">
            <div className="filter-field filter-field-search">
              <label>搜索</label>
              <div className="filter-search">
                <input
                  className={String(filters.keyword || '').trim() ? 'is-active' : ''}
                  value={filters.keyword}
                  onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                  placeholder="昵称 / steamID / 群昵称 / 地区 / 英雄 / 评价…"
                  aria-label="搜索群友"
                />
                {filters.keyword && (
                  <button
                    type="button"
                    className="filter-search-clear"
                    aria-label="清空搜索"
                    onClick={() => setFilters({ ...filters, keyword: '' })}
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
                onChange={(e) => setFilters({ ...filters, tier: e.target.value })}
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
                onChange={(e) => setFilters({ ...filters, score: e.target.value })}
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
              <select
                className={filters.position !== '全部' ? 'is-active' : ''}
                value={filters.position}
                onChange={(e) => setFilters({ ...filters, position: e.target.value })}
              >
                <option value="全部">全部位置（{players.length}）</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}（{players.filter((x) => (x.positions || []).includes(p)).length}）
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label>地区</label>
              <select
                className={filters.region !== '全部' ? 'is-active' : ''}
                value={filters.region}
                onChange={(e) => setFilters({ ...filters, region: e.target.value })}
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
              <select
                className={filters.hero !== '全部' ? 'is-active' : ''}
                value={filters.hero}
                onChange={(e) => setFilters({ ...filters, hero: e.target.value })}
              >
                <option value="全部">全部英雄（{facets.hero.length}）</option>
                {facets.hero.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k}（{n}）
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label>排序</label>
              <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
                <option value="score">按天梯分</option>
                <option value="champion">按冠军数</option>
                <option value="name">按昵称</option>
              </select>
            </div>

            <div className="filter-summary">
              <span>
                筛出 <b>{filtered.length}</b> / {players.length} 位
              </span>
              {activeCount > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  重置
                </button>
              )}
            </div>
          </div>

          {loading && <div className="empty">加载中…</div>}
          {error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            activeCount > 0 ? (
              <div className="empty">
                没有符合条件的群友
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 10 }}
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  清除筛选
                </button>
              </div>
            ) : (
              <div className="empty">还没有群友数据</div>
            )
          )}

          <div className="players-grid">
            {filtered.map((p) => {
              const t = tierOf(p.score || 0);
              return (
                <Link href={'/members/' + p.id} className="p-card" key={p.id}>
                  <div className="p-head">
                    <Avatar className="p-avatar" src={p.avatar} name={p.nickname} />
                    <div>
                      <div className="p-name">{p.nickname || '未命名'}</div>
                      <div className="p-id">
                        steamID {p.game_id || '—'}
                        {p.region ? ' · ' + p.region : ''}
                      </div>
                    </div>
                    <div className={`p-score ${t.cls}`} title={t.label}>
                      {p.score || 0}
                    </div>
                  </div>
                  <div className="p-tags">
                    {(p.positions || []).length > 0 ? (
                      p.positions.map((x, i) => (
                        <span className="p-tag" key={i}>
                          {x}
                        </span>
                      ))
                    ) : (
                      <span className="p-tag">未填写位置</span>
                    )}
                  </div>
                  {(p.heroes || []).length > 0 && (
                    <div className="p-heroes">
                      <div className="lbl">擅长英雄</div>
                      {p.heroes.slice(0, 4).map((h, i) => (
                        <span className="h" key={i}>
                          <HeroAvatar name={h} className="h-avatar" />
                          {h}
                        </span>
                      ))}
                      {p.heroes.length > 4 && <span className="h h-plain">+{p.heroes.length - 4}</span>}
                    </div>
                  )}
                  {(p.synergy_players || []).length > 0 && (
                    <div className="p-heroes p-synergy">
                      <div className="lbl">默契队友</div>
                      {p.synergy_players.slice(0, 3).map((sid, i) => (
                        <span className="h h-synergy" key={i}>
                          {nameMap.get(String(sid)) || sid}
                        </span>
                      ))}
                      {p.synergy_players.length > 3 && (
                        <span className="h h-synergy">+{p.synergy_players.length - 3}</span>
                      )}
                    </div>
                  )}
                  {(p.enemies || []).length > 0 && (
                    <div className="p-heroes p-enemies">
                      <div className="lbl">仇人</div>
                      {p.enemies.slice(0, 3).map((sid, i) => (
                        <span className="h h-enemy" key={i}>
                          {nameMap.get(String(sid)) || sid}
                        </span>
                      ))}
                      {p.enemies.length > 3 && (
                        <span className="h h-enemy">+{p.enemies.length - 3}</span>
                      )}
                    </div>
                  )}
                  <div className="p-foot">
                    <span>
                      🏆 冠军 {p.championships || 0} 个
                      {p.record_count > 0 ? ` · 参赛 ${p.record_count} 届` : ''}
                    </span>
                    <span className="p-foot-go">{t.label} →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
