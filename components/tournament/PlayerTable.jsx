'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';

function PlayerAvatar({ playerId, name, size = 28 }) {
  const [failed, setFailed] = useState(false);
  const initial = String(name || '?').trim().charAt(0).toUpperCase();
  if (!playerId || failed) {
    return (
      <span className="t-ava-fallback" style={{ width: size, height: size }}>
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

const POSITIONS = ['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'];

/* 报名时间：只显示月-日 时:分，年份对单届赛事没意义 */
const fmtSigned = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 报名选手表格
 *
 * 与「参赛选手」的区别：报名选手是 tournament_players 里的快照（含未组队的人），
 * 参赛选手是 team_players 里的人。这里会反查每人是否已进队并显示所属队伍。
 *
 * @param {object[]} signups 报名选手 [{ player_id, nickname, group_nickname, score, positions, is_captain }]
 * @param {object[]} teams   /api/teams 返回的队伍，用于反查所属队伍
 */
export default function PlayerTable({ signups = [], teams = [] }) {
  const [kw, setKw] = useState('');
  const [pos, setPos] = useState('all');
  const [sort, setSort] = useState('score_desc');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  /* player_id → 队伍名 */
  const teamOf = useMemo(() => {
    const map = new Map();
    teams.forEach((t) => {
      (t.players || []).forEach((p) => map.set(String(p.id), t.name));
    });
    return map;
  }, [teams]);

  const rows = useMemo(() => {
    const k = kw.trim().toLowerCase();
    let list = (signups || []).map((s) => ({
      ...s,
      teamName: teamOf.get(String(s.player_id)) || null,
      posList: String(s.positions || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    }));

    if (k) {
      list = list.filter(
        (s) =>
          String(s.nickname || '').toLowerCase().includes(k) ||
          String(s.group_nickname || '').toLowerCase().includes(k)
      );
    }
    if (pos !== 'all') list = list.filter((s) => s.posList.includes(pos));
    if (onlyUnassigned) list = list.filter((s) => !s.teamName);

    list.sort((a, b) => {
      if (sort === 'score_desc') return (b.score || 0) - (a.score || 0);
      if (sort === 'score_asc') return (a.score || 0) - (b.score || 0);
      return String(a.nickname || '').localeCompare(String(b.nickname || ''), 'zh');
    });
    return list;
  }, [signups, kw, pos, sort, onlyUnassigned, teamOf]);

  const assignedCount = useMemo(
    () => (signups || []).filter((s) => teamOf.has(String(s.player_id))).length,
    [signups, teamOf]
  );

  return (
    <div>
      <div className="t-toolbar">
        <input
          className="t-input"
          placeholder="搜索昵称或群昵称"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
        />
        <select className="t-select" value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="all">全部位置</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className="t-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score_desc">天梯分 从高到低</option>
          <option value="score_asc">天梯分 从低到高</option>
          <option value="name">按昵称</option>
        </select>
        <button
          type="button"
          className="t-select"
          onClick={() => setOnlyUnassigned((v) => !v)}
          style={{
            borderColor: onlyUnassigned ? 'var(--t-brand)' : 'var(--t-line)',
            color: onlyUnassigned ? 'var(--t-brand)' : 'var(--t-text-2)',
          }}
        >
          仅未组队
        </button>
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--t-text-3)',
          marginBottom: 10,
          display: 'flex',
          gap: 14,
        }}
      >
        <span>报名 {signups.length} 人</span>
        <span>已进入队伍 {assignedCount} 人</span>
        <span>未组队 {signups.length - assignedCount} 人</span>
        <span style={{ marginLeft: 'auto' }}>当前显示 {rows.length} 条</span>
      </div>

      <div className="t-table">
        <div className="t-thead">
          <span>#</span>
          <span>头像</span>
          <span>昵称</span>
          <span style={{ textAlign: 'right' }}>天梯分</span>
          <span>常玩位置</span>
          <span>所属队伍</span>
          <span style={{ textAlign: 'right' }}>报名时间</span>
        </div>

        {rows.length === 0 && (
          <div className="t-empty">没有符合条件的报名选手</div>
        )}

        {rows.map((s, i) => (
          <div className="t-tr" key={s.player_id}>
            <span style={{ color: 'var(--t-text-3)', fontSize: 12 }}>{i + 1}</span>
            <PlayerAvatar playerId={s.player_id} name={s.nickname || s.group_nickname} />
            <Link
              href={`/members/${s.player_id}`}
              className="t-tr-name"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {s.nickname || s.group_nickname || '群友'}
              {s.is_captain && <span className="t-chip gold" style={{ marginLeft: 6 }}>队长</span>}
            </Link>
            <span className="t-tr-num">{s.score || 0}</span>
            <span className="t-tr-pos">
              {s.posList.length > 0 ? s.posList.join(' / ') : '未填'}
            </span>
            <span className="t-tr-muted">
              {s.teamName ? (
                <span className="t-chip brand">{s.teamName}</span>
              ) : (
                <span className="t-chip muted">未组队</span>
              )}
            </span>
            <span className="t-tr-time">{fmtSigned(s.signed_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
