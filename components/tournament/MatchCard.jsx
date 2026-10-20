'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { memberHref } from '../../lib/member-href';

/* 选手头像：走本站代理，失败回退到昵称首字 */
function PlayerAvatar({ playerId, name, size = 22 }) {
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

/* 英雄头像 */
function HeroIcon({ slug, name, size = 34 }) {
  const [failed, setFailed] = useState(false);
  if (!slug || failed) {
    return (
      <span
        className="t-hero-icon"
        title={name || '未知英雄'}
        style={{ display: 'inline-block', width: size, height: size }}
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
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

/* 物品图标 */
function ItemIcon({ slug }) {
  const [failed, setFailed] = useState(false);
  if (!slug || failed) return <span className="t-item" />;
  return (
    <img
      className="t-item"
      src={`/api/item-icon/${slug}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

const fmtDur = (s) => {
  if (!s) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* 净经济 12.3k */
const fmtNw = (n) => {
  const v = Number(n);
  if (!v) return '';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
};

/* 队伍汇总用整数千分位，1.2M 这种太夸张了，直接 103.8k */
const fmtSum = (n) => {
  const v = Number(n) || 0;
  if (!v) return '0';
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
 * 阵容区参照完美世界电竞的赛后数据页：两队上下堆叠，每队一条汇总带
 * （队名 + 杀敌 + 总经济）加一行列头，下面每人一行显示
 * 英雄头像 / Steam 头像 / 昵称 / 装备 / 经济 / 伤害 / KDA / 神杖·魔晶。
 *
 * 为什么两队改成上下堆叠：8 列数据并排，左右各一半只有 500px 出头，
 * 装备和伤害会挤成一团；堆叠后每行有 1100px，列宽才立得住。
 *
 * 数据字段（来自 /api/tournaments/[id]/matches）：
 *   round_name / order_no / team_a_name / team_b_name / team_a_score / team_b_score
 *   winner_name / dota_match_id / dota_duration / dota_start_time / dota_players[]
 */
export default function MatchCard({ match, roundName }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  // 记住从哪一页点进来，选手详情页的返回键据此回到这里
  const from = String(router.asPath || '').split('?')[0];
  const m = match || {};
  const players = m.dota_players || [];
  const radiant = players.filter((p) => p.is_radiant);
  const dire = players.filter((p) => !p.is_radiant);

  const hasScore = m.team_a_score !== null && m.team_a_score !== undefined;
  const aLose = hasScore && m.winner_name && m.winner_name !== m.team_a_name;
  const bLose = hasScore && m.winner_name && m.winner_name !== m.team_b_name;
  const dur = fmtDur(m.dota_duration);
  const time = fmtTime(m.dota_start_time);

  /* 头像和昵称都能点进选手详情；认不出人的账号（player_id 为空）不加链接 */
  const avatarCell = (p) => {
    const ava = (
      <PlayerAvatar playerId={p.player_id} name={p.nickname || p.group_nickname} />
    );
    if (!p.player_id) return ava;
    return (
      <Link
        href={memberHref(p.player_id, from)}
        className="t-ava-link"
        aria-label={`查看 ${p.group_nickname || p.nickname || '选手'} 详情`}
      >
        {ava}
      </Link>
    );
  };

  const nameCell = (p) => {
    const inner = (
      <>
        {p.group_nickname || p.nickname || p.account_id || '未知'}
        {p.is_standin && <span className="t-chip gold" style={{ marginLeft: 5 }}>替补</span>}
      </>
    );
    const cls = `t-prow-name ${p.is_standin ? 'standin' : ''}`;
    if (!p.player_id) return <span className={cls}>{inner}</span>;
    return (
      <Link href={memberHref(p.player_id, from)} className={`${cls} t-prow-name-link`}>
        {inner}
      </Link>
    );
  };

  const row = (p) => {
    const kdaMissing = p.kills === null || p.kills === undefined;
    return (
      <div className="t-prow" key={p.account_id || p.player_id}>
        <HeroIcon slug={p.hero_slug} name={p.hero_name} />
        {avatarCell(p)}
        {nameCell(p)}
        <span className="t-prow-items">
          {(p.items || []).length === 0 && <span className="t-prow-empty">—</span>}
          {(p.items || []).map((it) => (
            <ItemIcon key={it.id} slug={it.slug} />
          ))}
        </span>
        <span className="t-prow-num">{fmtNw(p.net_worth) || '—'}</span>
        <span className="t-prow-num">{fmtNw(p.hero_damage) || '—'}</span>
        <span className="t-prow-kda">
          {kdaMissing ? '—' : `${p.kills}/${p.deaths}/${p.assists}`}
        </span>
        <span className="t-prow-aghs">
          {p.aghanims_scepter && (
            <span className="t-aghs scepter" title="已出阿哈利姆神杖">
              杖
            </span>
          )}
          {p.aghanims_shard && (
            <span className="t-aghs shard" title="已出阿哈利姆魔晶">
              晶
            </span>
          )}
        </span>
      </div>
    );
  };

  /* 未解析的局只有「谁打了什么英雄」，没有装备和数值。
     这时不摆一张全是「—」的八列表，改成紧凑三列，别用空表占满屏。 */
  const simpleRow = (p) => (
    <div className="t-prow-simple" key={p.account_id || p.player_id}>
      <HeroIcon slug={p.hero_slug} name={p.hero_name} size={28} />
      {avatarCell(p)}
      {nameCell(p)}
    </div>
  );

  const sideBlock = (list, teamName, tag, tagCls, lose, officialKills) => {
    const sumKills = list.reduce((s, p) => s + (Number(p.kills) || 0), 0);
    // 优先用官方比分：十个选手的 kills 之和有时比 radiant_score 少 1
    // （有击杀记在非英雄来源上），两处数字不一致会显得像算错了。
    const kills = officialKills ?? sumKills;
    const nw = list.reduce((s, p) => s + (Number(p.net_worth) || 0), 0);
    const won = hasScore && teamName && m.winner_name === teamName;
    // 有人有经济数据才算「解析过」
    const parsed = list.some(
      (p) => (Number(p.net_worth) || 0) > 0 || (p.kills !== null && p.kills !== undefined)
    );

    return (
      <div className="t-team-block">
        <div className={`t-team-bar ${tagCls} ${lose ? 'lose' : ''}`}>
          <span className={`t-team-tag ${tagCls}`}>{tag}</span>
          <span className="t-team-bar-name">{teamName || '待定'}</span>
          {won && <span className="t-team-bar-win">胜利</span>}
          <span className="t-team-bar-stats">
            {parsed ? (
              <>
                杀敌 <b>{kills}</b>
                <span className="sep">·</span>
                经济 <b>{fmtSum(nw)}</b>
              </>
            ) : (
              <span style={{ color: 'var(--t-text-3)' }}>回放已过期，无逐人数据</span>
            )}
          </span>
        </div>

        {list.length > 0 && parsed && (
          <div className="t-prow t-prow-head">
            <span>英雄</span>
            <span>选手</span>
            <span>昵称</span>
            <span>装备</span>
            <span className="r">经济</span>
            <span className="r">伤害</span>
            <span className="r">KDA</span>
            <span>神杖/魔晶</span>
          </div>
        )}
        {list.map(parsed ? row : simpleRow)}
      </div>
    );
  };

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

      {open && players.length > 0 && (
        <div className="t-rosters">
          {sideBlock(
            radiant,
            m.team_a_name,
            '天辉',
            'radiant',
            aLose,
            hasScore ? m.team_a_score : null
          )}
          {sideBlock(
            dire,
            m.team_b_name,
            '夜魇',
            'dire',
            bLose,
            hasScore ? m.team_b_score : null
          )}
        </div>
      )}
    </div>
  );
}
