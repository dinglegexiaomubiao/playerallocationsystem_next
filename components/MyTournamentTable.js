import Link from 'next/link';
import { rankLabel, rankCls, statusLabel, signupLabel } from '../lib/tournament-format.mjs';

// 只取「日」，比赛时间不需要精确到分
function fmtDay(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 「我的赛事」表格 —— /profile 与 /tournaments 共用一份。
 * 数据由页面自己拉（各页的加载时机不同），这里只负责展示口径统一。
 *
 * 列：赛事 / 名次 / 时间 / 担任位置 / 我的队伍 / 身份 / 状态
 * start_date 来自赛事本身（按本人偏好「按时间」排序时用它，而不是报名时间）。
 */
export default function MyTournamentTable({ items = [], emptyHref = '/tournaments' }) {
  if (!items.length) {
    return (
      <div className="empty">
        还没有报名任何赛事。
        <br />
        <Link href={emptyHref} style={{ color: 'var(--brand)', fontWeight: 600 }}>
          去看看赛事
        </Link>
      </div>
    );
  }

  return (
    <div className="adm-table">
      <div className="adm-row adm-row-7 adm-head">
        <div>赛事</div>
        <div>名次</div>
        <div>时间</div>
        <div>担任位置</div>
        <div>我的队伍</div>
        <div>身份</div>
        <div>状态</div>
      </div>
      {items.map((it) => (
        <Link
          href={'/tournaments/' + it.tournament_id}
          className="adm-row adm-row-7 adm-row-link"
          key={it.tournament_id}
        >
          <div className="adm-name">{it.name}</div>
          <div>
            <span className={`rank-badge ${rankCls(it.rank)}`}>{rankLabel(it.rank)}</span>
          </div>
          <div className="adm-date">{fmtDay(it.start_date) || '—'}</div>
          <div>{it.position || '未标注'}</div>
          <div>{it.teams.length ? it.teams.join('、') : '—'}</div>
          <div>
            {it.isCaptain ? <span className="adm-captain-tag">队长</span> : '队员'}
            {it.signupStatus && it.signupStatus !== 'approved' ? (
              <span className="my-signup-note">{signupLabel(it.signupStatus)}</span>
            ) : null}
          </div>
          <div className="adm-date">{statusLabel(it.status)}</div>
        </Link>
      ))}
    </div>
  );
}
