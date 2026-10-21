'use client';

import { useMemo } from 'react';

/**
 * 对阵树。
 *
 * 数据里**没有**「哪场胜者进入下一轮」的显式字段，连接线是反推的：
 *   下一轮某场出现了 A 队 → 去上一轮找包含 A 队的系列赛。
 * 只有当上一轮里 **恰好只有一个** 包含 A 队的系列赛时才连线。
 * 出现多个（循环赛、同队打了两场不同对手）就不画 —— 宁可少一条线，
 * 也不编造一条错的关系。
 *
 * 布局用绝对定位而不是 flex：每列卡片数量差别很大（11 组 vs 1 组），
 * flex 会让各列高度不一，连线必然错位。这里统一按列高均分。
 */

const ROUND_ORDER = { 小组赛: 1, 淘汰赛: 2, 半决赛: 3, 决赛: 4 };

const CARD_H = 62;
const CARD_GAP = 14;
const COL_W = 208;
const COL_GAP = 64;
const HEAD_H = 30;

function buildSeries(matches, rounds) {
  const byRound = new Map();
  const roundName = (id) => {
    const r = (rounds || []).find((x) => String(x.id) === String(id));
    return r?.name || '对阵';
  };

  for (const m of matches || []) {
    const a = m.team_a_name;
    const b = m.team_b_name;
    if (!a || !b) continue;

    const rid = String(m.round_id ?? 'none');
    if (!byRound.has(rid)) {
      byRound.set(rid, { roundId: m.round_id, roundName: roundName(m.round_id), series: new Map() });
    }
    const bucket = byRound.get(rid);
    const key = [a, b].sort().join('::');
    if (!bucket.series.has(key)) bucket.series.set(key, { a, b, matches: [] });
    bucket.series.get(key).matches.push(m);
  }

  return [...byRound.values()]
    .map((r) => {
      const list = [...r.series.values()].map((s) => {
        let winA = 0;
        let winB = 0;
        for (const m of s.matches) {
          if (!m.winner_name) continue;
          if (m.winner_name === s.a) winA += 1;
          else if (m.winner_name === s.b) winB += 1;
        }
        return {
          ...s,
          winA,
          winB,
          winner: winA > winB ? s.a : winB > winA ? s.b : null,
          pending: s.matches.some((m) => !m.winner_name),
        };
      });
      list.sort((x, y) => {
        const ox = Math.min(...x.matches.map((m) => Number(m.order_no) || 0));
        const oy = Math.min(...y.matches.map((m) => Number(m.order_no) || 0));
        return ox - oy;
      });
      return { ...r, series: list };
    })
    .sort((x, y) => (ROUND_ORDER[x.roundName] ?? 50) - (ROUND_ORDER[y.roundName] ?? 50));
}

export default function BracketView({ matches = [], rounds = [] }) {
  const { cols, edges, width, height } = useMemo(() => {
    const data = buildSeries(matches, rounds);
    if (data.length === 0) return { cols: [], edges: [], width: 0, height: 0 };

    const maxN = Math.max(...data.map((r) => r.series.length));
    const bodyH = maxN * CARD_H + (maxN - 1) * CARD_GAP;
    const H = HEAD_H + bodyH + 10;

    /* 每列卡片中心均分在 bodyH 上，这样 1 张卡的列居中、11 张卡的列铺满 */
    const laid = data.map((r, i) => ({
      ...r,
      x: i * (COL_W + COL_GAP),
      cards: r.series.map((s, k) => ({
        s,
        y: HEAD_H + ((k + 0.5) * bodyH) / r.series.length - CARD_H / 2,
      })),
    }));

    const E = [];
    for (let i = 1; i < laid.length; i += 1) {
      const prev = laid[i - 1];
      for (const card of laid[i].cards) {
        for (const team of [card.s.a, card.s.b]) {
          const hits = prev.cards.filter(
            (p) => p.s.a === team || p.s.b === team
          );
          // 只有唯一匹配才连线，多个匹配说明不是单败结构
          if (hits.length !== 1) continue;
          const from = hits[0];
          E.push({
            key: `${i}-${card.s.a}-${card.s.b}-${team}`,
            x1: prev.x + COL_W,
            y1: from.y + CARD_H / 2,
            x2: laid[i].x,
            y2: card.y + CARD_H / 2,
            win: from.s.winner === team,
          });
        }
      }
    }

    return {
      cols: laid,
      edges: E,
      width: laid.length * COL_W + (laid.length - 1) * COL_GAP,
      height: H,
    };
  }, [matches, rounds]);

  if (cols.length === 0) {
    return <div className="t-empty">没有可画的对阵数据（缺少队伍或轮次信息）</div>;
  }

  return (
    <div className="bk-scroll">
      <div className="bk-canvas" style={{ width, height }}>
        <svg className="bk-lines" width={width} height={height} aria-hidden="true">
          {edges.map((e) => {
            const midX = (e.x1 + e.x2) / 2;
            return (
              <path
                key={e.key}
                d={`M ${e.x1} ${e.y1} H ${midX} V ${e.y2} H ${e.x2}`}
                className={e.win ? 'bk-line win' : 'bk-line'}
                fill="none"
              />
            );
          })}
        </svg>

        {cols.map((c) => (
          <div key={String(c.roundId ?? c.roundName)} className="bk-col" style={{ left: c.x }}>
            <div className="bk-col-head">
              {c.roundName}
              <i>
                {c.series.length} 组
                {/* 组数 ≠ 局数：BO3 三局合成一组，两个数并列容易让人以为漏了 */}
                {c.cards.reduce((n, x) => n + x.s.matches.length, 0) !== c.series.length && (
                  <> · {c.cards.reduce((n, x) => n + x.s.matches.length, 0)} 局</>
                )}
              </i>
            </div>
            {c.cards.map((card) => (
              <div
                className="bk-card"
                key={`${card.s.a}::${card.s.b}`}
                style={{ top: card.y, height: CARD_H }}
              >
                <div className={`bk-team ${card.s.winner === card.s.a ? 'win' : ''}`}>
                  <span className="bk-name" title={card.s.a}>
                    {card.s.a}
                  </span>
                  <span className="bk-score">{card.s.winA}</span>
                </div>
                <div className={`bk-team ${card.s.winner === card.s.b ? 'win' : ''}`}>
                  <span className="bk-name" title={card.s.b}>
                    {card.s.b}
                  </span>
                  <span className="bk-score">{card.s.winB}</span>
                </div>
                <div className="bk-meta">
                  <span>BO{card.s.matches.length}</span>
                  {card.s.pending && <span className="bk-pending">待录入</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
