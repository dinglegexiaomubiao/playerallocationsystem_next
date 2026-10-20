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

/* 净经济：12.3k 这种紧凑写法，避免四位数把行撑宽 */
const fmtNw = (n) => {
  const v = Number(n);
  if (!v) return '';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
};

const fmtTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 单局比赛 · 信息行
 *
 * 设计约束：赛程优先用信息行和分隔线，不用卡片。
 * 所以这里没有背景、没有边框、没有圆角，段落之间只靠一条发丝线划开。
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
  const time = fmtTime(m.dota_start_time);

  const row = (p) => (
    <div className="t-prow" key={p.account_id || p.player_id}>
      <PlayerAvatar playerId={p.player_id} name={p.nickname || p.group_nickname} />
      <HeroIcon slug={p.hero_slug} name={p.hero_name} />
      <span className={`t-prow-name ${p.is_standin ? 'standin' : ''}`}>
        {p.group_nickname || p.nickname || p.account_id || '未知'}
        {p.is_standin && <span className="t-chip gold" style={{ marginLeft: 5 }}>替补</span>}
      </span>
      <span className="t-prow-nw" title="净经济">
        {fmtNw(p.net_worth)}
      </span>
      <span className="t-prow-kda" title="击杀 / 阵亡 / 助攻">
        {/* 未解析的局逐人数据是 NULL，显示破折号而不是假的 0/0/0 */}
        {p.kills === null || p.kills === undefined
          ? '—'
          : `${p.kills}/${p.deaths}/${p.assists}`}
      </span>
    </div>
  );

  return (
    <div className="t-fixture">
      <div className="t-fixture-head">
        <span className="t-fixture-round">
          {roundName || '对阵'}
          {m.order_no ? ` · 第 ${m.order_no} 局` : ''}
        </span>
        <span className="t-fixture-meta">
          {time && <span>{time}</span>}
          {dur && <span>{dur}</span>}
          {m.dota_match_id && <span style={{ opacity: 0.7 }}>{m.dota_match_id}</span>}
          {players.length > 0 && (
            <button
              type="button"
              className="t-fixture-toggle"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? '收起阵容' : '展开阵容'}
            </button>
          )}
        </span>
      </div>

      <div className="t-fixture-body">
        <div className={`t-side ${aLose ? 'lose' : ''}`}>
          <span className="t-side-tag radiant">天辉</span>
          <span className="t-side-name">{m.team_a_name || '待定'}</span>
        </div>

        {hasScore ? (
          <div className="t-score">
            {m.team_a_score} : {m.team_b_score}
            <span className="t-score-cap">人头</span>
          </div>
        ) : (
          <div className="t-score">
            <span className="t-score-pending">待录入</span>
          </div>
        )}

        <div className={`t-side right ${bLose ? 'lose' : ''}`}>
          <span className="t-side-name">{m.team_b_name || '待定'}</span>
          <span className="t-side-tag dire">夜魇</span>
        </div>
      </div>

      {m.winner_name && <div className="t-winner">{m.winner_name} 获胜</div>}

      {open && players.length > 0 && (
        <div className="t-rosters">
          <div className="t-roster-col">
            <div className="t-roster-head">
              天辉 <b>{m.team_a_name || ''}</b>
            </div>
            {radiant.map(row)}
          </div>
          <div className="t-roster-col">
            <div className="t-roster-head">
              夜魇 <b>{m.team_b_name || ''}</b>
            </div>
            {dire.map(row)}
          </div>
        </div>
      )}
    </div>
  );
}
