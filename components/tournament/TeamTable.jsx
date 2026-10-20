'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { memberHref } from '../../lib/member-href';

/* 选手头像：走本站代理，失败回退昵称首字 */
function PlayerAvatar({ playerId, name, size = 26 }) {
  const [failed, setFailed] = useState(false);
  const initial = String(name || '?').trim().charAt(0).toUpperCase();
  if (!playerId || failed) {
    return (
      <span className="t-ava-fallback" style={{ width: size, height: size }} title={name || ''}>
        {initial}
      </span>
    );
  }
  return (
    <img
      className="t-ava"
      style={{ width: size, height: size }}
      src={`/api/avatar/${playerId}`}
      alt={name || ''}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const RANK_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const RANK_LABEL = { 1: '冠军', 2: '亚军', 3: '季军' };

/**
 * 把 matches 折成 team_id → 交战记录
 *
 * matches 一行 = 一局比赛（不是一轮），所以同一对手会命中多局，
 * 这里按对手聚合，输出「对手 · N胜M负」。
 *
 * @returns {Map<string, Array<{opponent: string, win: number, lose: number, pending: number}>>}
 */
function buildRecords(matches) {
  const map = new Map();
  const add = (teamId, opponent, result) => {
    if (!teamId) return;
    const k = String(teamId);
    if (!map.has(k)) map.set(k, new Map());
    const byOpp = map.get(k);
    const name = opponent || '待定';
    if (!byOpp.has(name)) byOpp.set(name, { opponent: name, win: 0, lose: 0, pending: 0 });
    byOpp.get(name)[result] += 1;
  };

  (matches || []).forEach((m) => {
    const a = m.team_a_id;
    const b = m.team_b_id;
    if (!a || !b) return;
    const hasWinner = m.winner_team_id !== null && m.winner_team_id !== undefined;
    const resultOf = (id) =>
      !hasWinner ? 'pending' : String(m.winner_team_id) === String(id) ? 'win' : 'lose';
    add(a, m.team_b_name, resultOf(a));
    add(b, m.team_a_name, resultOf(b));
  });

  // Map<opponent, stat> → 数组，胜场多的排前面
  const out = new Map();
  map.forEach((byOpp, teamId) => {
    out.set(
      teamId,
      [...byOpp.values()].sort((x, y) => y.win - x.win || y.lose - x.lose)
    );
  });
  return out;
}

/**
 * 参赛队伍表格
 *
 * 数据来源：
 *   teams      —— /api/teams?tournament_id=xx
 *                 { id, name, rank, captain_id, players: [{ id, nickname, group_nickname,
 *                   positions, score }] }
 *   matches    —— /api/tournaments/[id]/matches，用于反推交战记录
 *   tournament —— /api/tournaments/[id] 的 tournament，冠亚季存在这里
 *
 * 名次口径：tournament_placements（一行一个名次，支持多个冠军/亚军/季军）
 * 优先；为空时回退 teams.rank，再为空回退赛事的 champion/runner_up/third_place。
 * 三者都没有就不显示徽标——不用数组序号冒充名次。
 */
export default function TeamTable({ teams, matches, tournament }) {
  const router = useRouter();
  const from = String(router.asPath || '').split('?')[0];
  const records = useMemo(() => buildRecords(matches), [matches]);

  /* team_id → 名次（1 冠军 / 2 亚军 / 3 季军）。
     同一队理论上只有一个名次，取最好的那个用于徽标。 */
  const rankMap = useMemo(() => {
    const m = new Map();
    const add = (id, place) => {
      const k = String(id);
      const p = Number(place) || 0;
      if (!k || p <= 0) return;
      const cur = m.get(k);
      if (!cur || p < cur) m.set(k, p);
    };

    const t = tournament || {};
    (t.placements || []).forEach((x) => add(x.team_id, x.place));
    (teams || []).forEach((tm) => add(tm.id, tm.rank));
    if (m.size === 0) {
      add(t.champion_team_id, 1);
      add(t.runner_up_team_id, 2);
      add(t.third_place_team_id, 3);
    }
    return m;
  }, [teams, tournament]);

  const rows = useMemo(() => {
    const rankOf = (x) => rankMap.get(String(x.id)) || 999;
    return [...(teams || [])].sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      const sa = (a.players || []).reduce((s, p) => s + (Number(p.score) || 0), 0);
      const sb = (b.players || []).reduce((s, p) => s + (Number(p.score) || 0), 0);
      if (sa !== sb) return sb - sa;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    });
  }, [teams, rankMap]);

  if (rows.length === 0) {
    return <div className="t-empty">暂无队伍数据</div>;
  }

  return (
    <div className="t-tbl">
      <div className="t-tbl-head">
        <div>队伍 / 名次</div>
        <div className="t-num">天梯总分</div>
        <div>阵容</div>
        <div>交战记录</div>
      </div>

      {rows.map((team) => {
        const players = team.players || [];
        const total = players.reduce((s, p) => s + (Number(p.score) || 0), 0);
        const rank = rankMap.get(String(team.id)) || 0;
        const vs = records.get(String(team.id)) || [];

        return (
          <div className="t-trow" key={team.id}>
            {/* 队伍 + 名次 */}
            <div className="t-td-team">
              <div className="t-td-team-top">
                <span className="t-td-name" title={team.name}>
                  {team.name}
                </span>
                {rank > 0 && (
                  <span className={`t-team-rank ${RANK_CLASS[rank] || ''}`}>
                    {RANK_LABEL[rank] || `第 ${rank}`}
                  </span>
                )}
              </div>
              <span className="t-td-sub">{players.length} 人</span>
            </div>

            {/* 天梯总分 */}
            <div className="t-td-total t-num">
              {total > 0 ? total : <span className="t-dash" />}
            </div>

            {/* 阵容：默认展开，每行 5 人 */}
            <div className="t-td-roster">
              {players.length === 0 && <span className="t-tr-muted">暂无队员</span>}
              {players.map((p) => {
                const isCap = String(p.id) === String(team.captain_id);
                const pos = String(p.positions || '')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(' / ');
                const score = Number(p.score) || 0;
                return (
                  <Link
                    key={p.id}
                    href={memberHref(p.id, from)}
                    className="t-rp"
                    title={`${p.group_nickname || p.nickname}${isCap ? '（队长）' : ''}${
                      pos ? ' · ' + pos : ''
                    }${
                      Number(p.peak_score) > score
                        ? ` · 历史最高 ${p.peak_score}`
                        : ''
                    }`}
                  >
                    <PlayerAvatar playerId={p.id} name={p.group_nickname || p.nickname} />
                    <span className="t-rp-info">
                      <span className={`t-rp-name ${isCap ? 'cap' : ''}`}>
                        {p.group_nickname || p.nickname}
                      </span>
                      <span className="t-rp-pos">{pos || '位置未填'}</span>
                    </span>
                    <span className={`t-rp-score ${score ? '' : 't-rp-score--none'}`}>
                      {score || ''}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* 交战过的队伍 */}
            <div className="t-td-vs">
              {vs.length === 0 ? (
                <span className="t-tr-muted">未上场</span>
              ) : (
                vs.map((r) => (
                  <span className="t-vs" key={r.opponent}>
                    <span className="t-vs-name" title={`对阵 ${r.opponent}`}>
                      {r.opponent}
                    </span>
                    {r.win > 0 && <span className="t-vs-w">{r.win}胜</span>}
                    {r.lose > 0 && <span className="t-vs-l">{r.lose}负</span>}
                    {r.pending > 0 && <span className="t-vs-p">待赛</span>}
                  </span>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
