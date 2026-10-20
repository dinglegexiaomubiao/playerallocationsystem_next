'use client';

import { useState } from 'react';

/* 选手头像：走本站代理，失败回退到昵称首字 */
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

/* 英雄头像：hero_slug 由接口给出，没有则显示占位块 */
function HeroIcon({ slug, name }) {
  const [failed, setFailed] = useState(false);
  if (!slug || failed) {
    return (
      <span
        className="t-hero-icon"
        title={name || '未知英雄'}
        style={{ display: 'inline-block' }}
      />
    );
  }
  return (
    <img
      className="t-hero-icon"
      src={`/api/hero-icon/${slug}`}
      alt={name || ''}
      title={name || ''}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const fmtDur = (s) => {
  if (!s) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const fmtTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 单场比赛卡片
 *
 * 数据字段（来自 /api/tournaments/[id]/matches）：
 *   round_name / order_no / team_a_name / team_b_name / team_a_score / team_b_score
 *   winner_name / dota_match_id / dota_duration / dota_start_time / dota_players[]
 *
 * @param {object} match
 * @param {string} roundName  所属轮次名（外部传入，用于显示）
 */
export default function MatchCard({ match, roundName }) {
  const [open, setOpen] = useState(true);
  const m = match || {};
  const players = m.dota_players || [];
  const radiant = players.filter((p) => p.is_radiant);
  const dire = players.filter((p) => !p.is_radiant);

  const hasScore = m.team_a_score !== null && m.team_a_score !== undefined;
  const aLose = hasScore && m.winner_name && m.winner_name !== m.team_a_name;
  const bLose = hasScore && m.winner_name && m.winner_name !== m.team_b_name;
  const dur = fmtDur(m.dota_duration);

  const row = (p) => (
    <div className="t-prow" key={p.account_id || p.player_id}>
      <PlayerAvatar playerId={p.player_id} name={p.nickname || p.group_nickname} />
      <HeroIcon slug={p.hero_slug} name={p.hero_name} />
      <span className={`t-prow-name ${p.is_standin ? 'standin' : ''}`}>
        {p.group_nickname || p.nickname || p.account_id || '未知'}
        {p.is_standin && <span className="t-chip gold" style={{ marginLeft: 5 }}>替补</span>}
      </span>
      <span className="t-prow-kda">
        {p.kills}/{p.deaths}/{p.assists}
      </span>
    </div>
  );

  return (
    <div className="t-match">
      <div className="t-match-head">
        <span className="t-match-round">
          {roundName || '对阵'}
          {m.order_no ? ` · 第 ${m.order_no} 局` : ''}
        </span>
        <span className="t-match-meta">
          {m.dota_start_time && <span>{fmtTime(m.dota_start_time)}</span>}
          {dur && <span>{dur}</span>}
          {m.dota_match_id && <span style={{ opacity: 0.7 }}>{m.dota_match_id}</span>}
          {players.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              style={{
                background: 'none',
                border: 0,
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 12,
                padding: 0,
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {open ? '收起' : '展开'}
            </button>
          )}
        </span>
      </div>

      <div className="t-match-body">
        <div className={`t-side ${aLose ? 'lose' : ''}`}>
          <span className="t-side-tag radiant">天辉</span>
          <span className="t-side-name">{m.team_a_name || '待定'}</span>
        </div>

        {hasScore ? (
          <div className="t-match-score">
            {m.team_a_score} : {m.team_b_score}
            <span className="t-match-score-cap">人头数</span>
          </div>
        ) : (
          <div className="t-match-score pending">结果待录入</div>
        )}

        <div className={`t-side right ${bLose ? 'lose' : ''}`}>
          <span className="t-side-name">{m.team_b_name || '待定'}</span>
          <span className="t-side-tag dire">夜魇</span>
        </div>
      </div>

      {m.winner_name && <div className="t-match-win">{m.winner_name} 获胜</div>}

      {open && players.length > 0 && (
        <div className="t-rosters">
          <div className="t-roster-col">
            <div className="t-roster-head radiant">
              天辉 · {m.team_a_name || ''}
            </div>
            {radiant.map(row)}
          </div>
          <div className="t-roster-col">
            <div className="t-roster-head dire">
              夜魇 · {m.team_b_name || ''}
            </div>
            {dire.map(row)}
          </div>
        </div>
      )}
    </div>
  );
}
