import { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import { getSession, isAdmin } from '../../lib/auth';
import { ensureSupportTable, ensureTournamentSchema, listSupportReports, pool } from '../../lib/db';
import ExcelIO from '../../components/ExcelIO';
import { apiDelete, apiFetch, apiGet, apiPost, apiPut } from '../../lib/api-client.mjs';
import {
  TOURNAMENT_COLUMNS,
  TOURNAMENT_FIELD_ALIASES,
  TOURNAMENT_STATUS_OPTIONS,
  dateOnly,
  pickAlias,
  parseDateCell,
  statusValue,
} from '../../lib/excel';

// 7 态状态机
const STATUS_LIST = [
  { value: 'planning', label: '筹办中', color: '#6b7280', bg: '#f1f5f9' },
  { value: 'ongoing', label: '进行中', color: '#185FA5', bg: '#E6F1FB' },
  { value: 'elimination', label: '淘汰赛', color: '#0F6E56', bg: '#E1F5EE' },
  { value: 'semifinal', label: '半决赛', color: '#534AB7', bg: '#EEEDFE' },
  { value: 'final', label: '决赛', color: '#A32D2D', bg: '#FCEBEB' },
  { value: 'finished', label: '已完赛', color: '#3B6D11', bg: '#EAF3DE' },
  { value: 'postponed', label: '延期', color: '#854F0B', bg: '#FAEEDA' },
];
const STATUS_MAP = Object.fromEntries(STATUS_LIST.map((s) => [s.value, s]));

// 导入时用的状态说明，直接拼进预览提示里
const STATUS_HINT = TOURNAMENT_STATUS_OPTIONS.map((s) => s.label).join(' / ');

// 字段长度上限（超长静默截断，和站内其它导入一致；不报错免得整行失败）
const LIMITS = {
  name: 100,
  sponsor_info: 200,
  champion_prize: 50,
  runner_up_prize: 50,
};

const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());
const clip = (v, max) => {
  const s = trim(v);
  return s.length > max ? s.slice(0, max) : s;
};

/* ---------- 群友反馈 ---------- */

// 反馈浮窗里的两个入口写进 category：bug = 遇到问题，feature = 想要的功能
const FB_CATEGORY = { bug: '遇到问题', feature: '想要的功能' };

// 留言可能是几百字，列表里只留一行，完整内容在「全部反馈」里看
const FB_MSG_MAX = 90;

function fbTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? `${p(d.getHours())}:${p(d.getMinutes())}`
    : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 只显示路径：整条 URL 太长，把「哪一页出的问题」这个关键信息挤没了
function fbPage(url) {
  if (!url) return '';
  try {
    return new URL(url).pathname + (new URL(url).search || '');
  } catch {
    return String(url);
  }
}

/**
 * 「群友反馈」面板。
 *
 * 为什么放在赛事管理首屏：反馈原本只在 /admin/support 里，而那一页默认混着
 * 自动报错（量是反馈的几十倍），管理员要先切一次筛选才能看到人说的话，
 * 结果就是「群友反馈了但后台看不到」。这里直接把最新几条待人处理的反馈
 * 摊在首屏，一条一行，就地能标记已处理，详情仍回原页面。
 *
 * 数据由 getServerSideProps 直接查库（不额外打接口）：和「需要你处理」
 * 的计数同源，不会出现「概览说 3 条、面板列 1 条」的对不上。
 */
function FeedbackPanel({ data }) {
  const [items, setItems] = useState((data && data.items) || []);
  const [handled, setHandled] = useState(0);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  // 就地回复：展开某一行、写留言、连状态一起提交，不必跳去 /admin/support
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState('');
  const [draftStatus, setDraftStatus] = useState('new');
  const [savedId, setSavedId] = useState(null);

  const pending = Math.max(((data && data.pending) || 0) - handled, 0);
  const total = (data && data.total) || 0;
  const errorNew = (data && data.errorNew) || 0;

  const expand = (r) => {
    if (String(openId) === String(r.id)) {
      setOpenId(null);
      return;
    }
    setOpenId(r.id);
    setDraft(r.reply || '');
    setDraftStatus(r.status || 'new');
    setErr('');
  };

  const markDone = async (id) => {
    setBusy(id);
    setErr('');
    try {
      await apiFetch('/api/support', { method: 'PATCH', body: { id, status: 'done' } });
      setItems((list) => list.filter((x) => String(x.id) !== String(id)));
      setHandled((n) => n + 1);
    } catch (e) {
      setErr(e.message || '处理失败');
    } finally {
      setBusy(null);
    }
  };

  // 状态进 done / ignored 时这条就不再属于「待处理」，从首屏撤下；
  // 存成 doing 则留在原位并把徽标换掉 —— 否则管理员会以为没保存成功。
  const save = async (r) => {
    setBusy(r.id);
    setErr('');
    try {
      await apiFetch('/api/support', {
        method: 'PATCH',
        body: { id: r.id, status: draftStatus, reply: draft.trim() },
      });
      if (draftStatus === 'done' || draftStatus === 'ignored') {
        setItems((list) => list.filter((x) => String(x.id) !== String(r.id)));
        setHandled((n) => n + 1);
        setOpenId(null);
      } else {
        setItems((list) =>
          list.map((x) =>
            String(x.id) === String(r.id)
              ? { ...x, status: draftStatus, reply: draft.trim() || null }
              : x
          )
        );
        setSavedId(r.id);
        setTimeout(() => setSavedId((cur) => (String(cur) === String(r.id) ? null : cur)), 2400);
      }
    } catch (e) {
      setErr(e.message || '保存失败');
    } finally {
      setBusy(null);
    }
  };

  const STATUS_CHIPS = [
    ['new', '待处理'],
    ['doing', '处理中'],
    ['done', '已处理'],
    ['ignored', '不处理'],
  ];

  return (
    <div className="adm-fb" id="adm-feedback">
      <div className="adm-fb-head">
        <span className="adm-fb-title">群友反馈</span>
        <span className="adm-fb-sum">
          {pending > 0 ? `${pending} 条待处理` : '暂无待处理'}
          {total > 0 ? ` · 累计 ${total} 条` : ''}
          {errorNew > 0 ? ` · 另有 ${errorNew} 条自动报错` : ''}
        </span>
        <div style={{ flex: 1 }} />
        <Link className="adm-fb-all" href="/admin/support">
          全部反馈 →
        </Link>
      </div>

      {err && <div className="adm-fb-err">{err}</div>}

      {items.length === 0 ? (
        <div className="adm-fb-empty">
          群友在右下角「反馈」浮窗提交的内容会出现在这里，目前没有待处理的。
          {errorNew > 0 && `（那 ${errorNew} 条「自动报错」是前端采集的异常，不是人写的反馈）`}
        </div>
      ) : (
        items.map((r) => (
          <div className={'adm-fb-row' + (String(openId) === String(r.id) ? ' is-open' : '')} key={r.id}>
            <span className="adm-fb-cat">{FB_CATEGORY[r.category] || '反馈'}</span>
            <span className="adm-fb-msg" title={r.message || ''}>
              {clip(r.message, FB_MSG_MAX) || '（无描述）'}
            </span>
            <span className="adm-fb-meta">
              {r.account_name || '未登录'}
              {fbPage(r.page_url) ? ' · ' + fbPage(r.page_url) : ''}
              {fbTime(r.created_at) ? ' · ' + fbTime(r.created_at) : ''}
            </span>
            <span className="adm-fb-acts">
              <button
                type="button"
                className="adm-link-btn"
                onClick={() => expand(r)}
                disabled={busy !== null}
              >
                {String(openId) === String(r.id) ? '收起' : r.reply ? '改回复' : '回复'}
              </button>
              <button
                type="button"
                className="adm-link-btn adm-fb-done"
                onClick={() => markDone(r.id)}
                disabled={busy !== null}
              >
                {String(busy) === String(r.id) ? '处理中…' : '标记已处理'}
              </button>
            </span>

            {String(openId) === String(r.id) && (
              <div className="adm-fb-replybox">
                <div className="adm-fb-status">
                  {STATUS_CHIPS.map(([v, label]) => (
                    <button
                      type="button"
                      key={v}
                      className={'chip chip-sm' + (draftStatus === v ? ' active' : '')}
                      onClick={() => setDraftStatus(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="sup-reply-input"
                  rows={3}
                  maxLength={2000}
                  placeholder="给这位群友回一句，会显示在他的「我的反馈」里"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="adm-fb-replybar">
                  {String(savedId) === String(r.id) && <span className="adm-fb-saved">已保存</span>}
                  <div style={{ flex: 1 }} />
                  <span className="adm-fb-count">{draft.length} / 2000</span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => save(r)}
                    disabled={busy !== null}
                  >
                    {String(busy) === String(r.id) ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// 赛季名做匹配键：去空白 + 转小写，"第十届" 与 "第十届 " 视为同一个
const nameKey = (n) => trim(n).toLowerCase().replace(/\s+/g, '');

/**
 * 把表格里的一行解析成「要写进库的字段」。
 * 预览阶段的校验（validate）和真正导入用的是同一份实现，
 * 否则会出现「预览说没问题、导入却报错」的对不上。
 * 返回 { error } 表示这行导不了；否则返回 { name, payload, ranks }。
 */
function parseTournamentRow(row) {
  const name = clip(pickAlias(row, TOURNAMENT_FIELD_ALIASES.name), LIMITS.name);
  if (!name) return { error: '缺少「赛季名称」' };

  const payload = { name };

  const rawStatus = pickAlias(row, TOURNAMENT_FIELD_ALIASES.status);
  if (trim(rawStatus)) {
    const st = statusValue(rawStatus);
    if (st === null) {
      return { error: `比赛状态「${trim(rawStatus)}」无法识别，可选：${STATUS_HINT}` };
    }
    if (st) payload.status = st;
  }

  for (const field of ['start_date', 'end_date']) {
    const raw = pickAlias(row, TOURNAMENT_FIELD_ALIASES[field]);
    if (trim(raw) === '') continue;
    const d = parseDateCell(raw);
    if (!d) {
      return { error: `${field === 'start_date' ? '开始' : '结束'}日期「${trim(raw)}」无法识别` };
    }
    payload[field] = d;
  }

  for (const field of ['sponsor_info', 'champion_prize', 'runner_up_prize']) {
    const v = clip(pickAlias(row, TOURNAMENT_FIELD_ALIASES[field]), LIMITS[field]);
    if (v) payload[field] = v;
  }

  // 名次队伍只带出「队名」，真正换成 id 要等赛季有了 id 之后
  const ranks = [
    ['champion_team_name', 'champion_team_id'],
    ['runner_up_team_name', 'runner_up_team_id'],
    ['third_place_team_name', 'third_place_team_id'],
  ]
    .map(([nameCol, idCol]) => ({ nameCol, idCol, want: trim(pickAlias(row, TOURNAMENT_FIELD_ALIASES[nameCol])) }))
    .filter((x) => x.want);

  return { name, payload, ranks };
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status || '未知', color: '#6b7280', bg: '#f1f5f9' };
  return (
    <span className="adm-status" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

/**
 * 赛事待补录明细：把「N 支队伍不满 5 人」摊开成
 * 「哪个赛事 / 哪支队伍 / 缺几个 / 现在有谁」「哪个赛事 / 谁 / 缺什么字段」。
 *
 * 和 loadAdminTodo 的计数口径必须一致（这里用同一套 WHERE），
 * 否则会出现「概览说 2 支，明细列了 3 支」的对不上。
 */
async function loadPending() {
  const safe = async (label, sql) => {
    try {
      const r = await pool.query(sql);
      return r.rows || [];
    } catch (e) {
      console.error(`赛事待补录查询失败（${label}）:`, e.message);
      return [];
    }
  };

  // 未完结的赛事排前面：finished 的补录优先级最低，不该占首屏
  const FINISHED_LAST = `(coalesce(tr.status, '') = 'finished') ASC`;

  const shortRows = await safe(
    '不满员队伍',
    `SELECT tr.id::text AS tournament_id,
            tr.name     AS tournament_name,
            coalesce(tr.status, '') AS status,
            t.id::text  AS team_id,
            coalesce(nullif(btrim(t.name), ''), '未命名队伍') AS team_name,
            count(DISTINCT tp.player_id)::int AS member_count,
            coalesce(string_agg(DISTINCT p.nickname, '、' ORDER BY p.nickname), '') AS members
       FROM public.teams t
       JOIN public.tournaments tr ON tr.id = t.tournament_id
       LEFT JOIN public.team_players tp ON tp.team_id = t.id
       LEFT JOIN public.players p ON p.id = tp.player_id
      GROUP BY tr.id, tr.name, tr.status, t.id, t.name
     HAVING count(DISTINCT tp.player_id) < 5
      ORDER BY ${FINISHED_LAST}, tr.id DESC, t.id ASC`
  );

  const missRows = await safe(
    '报名资料缺漏',
    `SELECT tr.id::text AS tournament_id,
            tr.name     AS tournament_name,
            coalesce(tr.status, '') AS status,
            tp.player_id::text AS player_id,
            coalesce(nullif(btrim(p.nickname), ''),
                     nullif(btrim(p.group_nickname), ''),
                     '未命名 #' || tp.player_id) AS nickname,
            (tp.score IS NULL OR tp.score = 0)              AS no_score,
            (coalesce(btrim(tp.positions), '') = '')        AS no_positions,
            (coalesce(btrim(tp.region), '') = '')           AS no_region,
            -- 这个人在这届比赛里属于哪支队：补录时最常需要的信息
            (SELECT string_agg(DISTINCT coalesce(nullif(btrim(t2.name), ''), '未命名队伍'), '、'
                               ORDER BY coalesce(nullif(btrim(t2.name), ''), '未命名队伍'))
               FROM public.team_players tp2
               JOIN public.teams t2 ON t2.id = tp2.team_id
              WHERE tp2.player_id = tp.player_id
                AND tp2.tournament_id = tp.tournament_id) AS team_names
       FROM public.tournament_players tp
       JOIN public.tournaments tr ON tr.id = tp.tournament_id
       JOIN public.players p ON p.id = tp.player_id
      WHERE tp.score IS NULL OR tp.score = 0
         OR coalesce(btrim(tp.positions), '') = ''
         OR coalesce(btrim(tp.region), '') = ''
      ORDER BY ${FINISHED_LAST}, tr.id DESC, p.nickname ASC`
  );

  const teams = shortRows.map((r) => ({
    tournamentId: r.tournament_id,
    tournamentName: r.tournament_name,
    status: r.status,
    teamId: r.team_id,
    teamName: r.team_name,
    memberCount: Number(r.member_count || 0),
    members: r.members || '',
  }));

  const signups = missRows.map((r) => {
    const missing = [];
    if (r.no_score) missing.push('分数');
    if (r.no_positions) missing.push('位置');
    if (r.no_region) missing.push('地区');
    return {
      tournamentId: r.tournament_id,
      tournamentName: r.tournament_name,
      status: r.status,
      playerId: r.player_id,
      nickname: r.nickname,
      missing,
      teamNames: r.team_names || '',
    };
  });

  const ids = new Set([...teams, ...signups].map((x) => x.tournamentId));
  return { teams, signups, tournaments: ids.size };
}

/**
 * 赛事待补录明细面板。
 *
 * 为什么要这块：原来「需要你处理」只写「2 支队伍不满 5 人」，点不动也看不出是哪支队，
 * 管理员得自己一个个赛季点进去翻。这里直接摊到「赛事 → 队伍/选手 → 缺什么」，
 * 每条都带一个直达链接，跳到详情页的对应 tab 并把那一行高亮出来。
 */
function PendingPanel({ pending }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState({}); // `${赛事id}:teams|signups` → 是否展开全部
  const SHOW_MAX = 5; // 单个赛事单类先平铺 5 条，多的点「展开全部」

  const groups = useMemo(() => {
    const map = new Map();
    const ensure = (id, name, status) => {
      if (!map.has(id)) map.set(id, { id, name, status, teams: [], signups: [] });
      return map.get(id);
    };
    (pending.teams || []).forEach((t) => ensure(t.tournamentId, t.tournamentName, t.status).teams.push(t));
    (pending.signups || []).forEach((s) => ensure(s.tournamentId, s.tournamentName, s.status).signups.push(s));
    return [...map.values()];
  }, [pending]);

  const total = (pending.teams || []).length + (pending.signups || []).length;
  if (total === 0) return null;

  const detailLink = (g, tab, focus, text) => (
    <Link className="adm-pending-go" href={{ pathname: '/admin/tournaments/' + g.id, query: { tab, focus } }}>
      {text} →
    </Link>
  );

  // 一个赛事下的一类明细（队伍缺人 / 资料缺漏）：先平铺 SHOW_MAX 条，超出折成按钮原地展开
  const renderRows = (g, kind, rows) => {
    const key = g.id + ':' + kind;
    const isOpen = !!expanded[key];
    const shown = isOpen ? rows : rows.slice(0, SHOW_MAX);

    return (
      <div className="adm-pending-block" key={kind}>
        <div className="adm-pending-label">{kind === 'teams' ? '队伍不满 5 人' : '报名资料缺漏'}</div>

        {shown.map((r) =>
          kind === 'teams' ? (
            <div className="adm-pending-row" key={'t' + r.teamId}>
              <span className="adm-pending-name">{r.teamName}</span>
              <span className="adm-pending-miss">
                {r.memberCount}/5 · 缺 {5 - r.memberCount} 人
              </span>
              <span className="adm-pending-detail" title={r.members || '暂无队员'}>
                {r.members ? '队员：' + r.members : '暂无队员'}
              </span>
              {detailLink(g, 'teams', r.teamId, '去补人')}
            </div>
          ) : (
            <div className="adm-pending-row" key={'s' + r.playerId}>
              <span className="adm-pending-name">{r.nickname}</span>
              <span className="adm-pending-miss">缺 {r.missing.join('、')}</span>
              <span className="adm-pending-detail">{r.teamNames ? '队伍：' + r.teamNames : '未分队'}</span>
              {detailLink(g, 'signups', r.playerId, '去补录')}
            </div>
          )
        )}

        {rows.length > SHOW_MAX && (
          <button
            type="button"
            className="adm-pending-more"
            onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
          >
            {isOpen
              ? '收起'
              : `还有 ${rows.length - SHOW_MAX} 条，展开全部 ${rows.length} 条`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="adm-pending" id="adm-pending">
      <div className="adm-pending-head">
        <span className="adm-pending-title">赛事待补录</span>
        <span className="adm-pending-sum">
          {pending.tournaments} 个赛事 · {pending.teams.length} 支队伍缺人 · {pending.signups.length} 人资料缺漏
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="adm-link-btn" onClick={() => setOpen(!open)}>
          {open ? '收起明细' : '展开明细'}
        </button>
      </div>

      {open &&
        groups.map((g) => (
          <div className="adm-pending-group" key={g.id}>
            <div className="adm-pending-tour">
              <Link className="adm-pending-tour-name" href={'/admin/tournaments/' + g.id}>
                {g.name}
              </Link>
              <StatusBadge status={g.status} />
              <span className="adm-pending-dep">
                {g.teams.length > 0 && `队伍缺人 ${g.teams.length}`}
                {g.teams.length > 0 && g.signups.length > 0 && ' · '}
                {g.signups.length > 0 && `资料缺漏 ${g.signups.length} 人`}
              </span>
              {detailLink(g, g.teams.length > 0 ? 'teams' : 'signups', '', '打开该赛事')}
            </div>

            {g.teams.length > 0 && renderRows(g, 'teams', g.teams)}
            {g.signups.length > 0 && renderRows(g, 'signups', g.signups)}
          </div>
        ))}

      {open && (
        <div className="adm-pending-foot">
          点「去补人 / 去补录」会跳到该赛事的对应分区并自动定位高亮那一行；改完点页面顶部「保存修改」生效。
          已完赛的赛事排在后面。
        </div>
      )}
    </div>
  );
}

export default function Admin({ denied, todo, pending, feedback }) {
  const { me, isAdmin, ready } = useSession();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', start_date: '', end_date: '', sponsor_info: '', champion_prize: '' });
  // 与云端交互的瞬时状态：creating 管新建，deletingId 管具体哪一行在删
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    apiGet('/api/tournaments')
      .then((d) => {
        setTournaments(d?.tournaments || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || '加载失败');
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setCreating(true);
    setError('');
    try {
      await apiPost('/api/tournaments', {
        name: createForm.name.trim(),
        start_date: createForm.start_date || null,
        end_date: createForm.end_date || null,
        sponsor_info: createForm.sponsor_info || null,
        champion_prize: createForm.champion_prize || null,
      });
      setShowCreate(false);
      setCreateForm({ name: '', start_date: '', end_date: '', sponsor_info: '', champion_prize: '' });
      load();
    } catch (err) {
      setError(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // 删除赛季：会连带清掉该赛事下的队伍、报名、赛程（后端事务），所以要二次确认。
  // 确认框里把「连带删除」讲清楚，避免误点后追不回来。
  const handleDelete = async (t) => {
    const ok = window.confirm(
      `确定删除赛季「${t.name}」吗？\n\n` +
        '该操作会一并删除这个赛季下的所有报名记录、队伍与成员关系、赛程对阵，且不可撤销。'
    );
    if (!ok) return;

    setDeletingId(t.id);
    setError('');
    try {
      await apiDelete('/api/tournaments/' + t.id);
      setTournaments((prev) => prev.filter((x) => String(x.id) !== String(t.id)));
    } catch (err) {
      // 超时 / 断网 / 权限不足 都由 api-client 转成了可读文案
      setError(`删除「${t.name}」失败：${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  /* ================= Excel 导入 / 导出 =================
   *
   * 语义：按「赛季名称」做幂等 upsert —— 同名就更新，不同名就新建。
   * 这样导出一份、改几格、再导回去，不会造出一堆重复赛季。
   *
   * 名次列（冠军/亚军/季军）在库里存队伍 id，表格里是队名：
   * 导出时后端已 LEFT JOIN 带出队名；导入时按队名在该赛季的队伍里反查，
   * 查不到就跳过这一列（新赛季此时还没有队伍，属于正常情况）。
   */
  const teamsCacheRef = useRef(new Map()); // tournamentId → Map(队名key → 队伍id)

  const teamIndexOf = async (tournamentId) => {
    const key = String(tournamentId);
    if (teamsCacheRef.current.has(key)) return teamsCacheRef.current.get(key);
    const d = await apiGet('/api/teams?tournament_id=' + tournamentId).catch(() => null);
    const map = new Map();
    (d?.teams || []).forEach((t) => map.set(nameKey(t.name), t.id));
    teamsCacheRef.current.set(key, map);
    return map;
  };

  const handleImportTournaments = async (rows, onProgress) => {
    // 用状态副本做索引，避免循环里读到的 tournaments 是旧闭包
    const index = new Map();
    tournaments.forEach((t) => index.set(nameKey(t.name), t));

    const total = rows.length;

    for (let i = 0; i < total; i += 1) {
      const row = rows[i] || {};
      const parsed = parseTournamentRow(row);
      const label = parsed.name || `第 ${i + 1} 行`;

      try {
        if (parsed.error) throw new Error(parsed.error);

        const { name, payload, ranks } = parsed;

        // ---- 1. 建或更新 ----
        const existing = index.get(nameKey(name));
        let saved;
        if (existing) {
          // 更新只发本次解析到的字段：表格里留空的格子不会把线上数据清掉
          const res = await apiPut('/api/tournaments/' + existing.id, payload);
          saved = res?.tournament || { ...existing, ...payload };
        } else {
          const res = await apiPost('/api/tournaments', payload, { headers: { 'x-excel-import': '1' } });
          saved = res?.tournament;
          if (!saved?.id) throw new Error('新建赛季后没有拿到赛季ID');
        }
        index.set(nameKey(name), { ...(existing || {}), ...saved });

        // ---- 2. 名次队伍（按队名反查 id；查不到就跳过，不算失败）----
        if (ranks.length > 0) {
          const teamMap = await teamIndexOf(saved.id);
          const rankPayload = {};
          for (const w of ranks) {
            const tid = teamMap.get(nameKey(w.want));
            if (tid) rankPayload[w.idCol] = tid;
          }
          if (Object.keys(rankPayload).length > 0) {
            await apiPut('/api/tournaments/' + saved.id, rankPayload);
          }
        }

        onProgress(i + 1, total, { name });
      } catch (err) {
        onProgress(i + 1, total, { name: label, error: err.message || '导入失败' });
      }
    }

    teamsCacheRef.current.clear();
    load();
  };

  // 预览里标红「库里已有同名赛季」的行——注意它们不是被跳过，而是会被更新
  const dupTournament = (row, existing) => {
    const n = nameKey(pickAlias(row, TOURNAMENT_FIELD_ALIASES.name));
    if (!n) return false;
    return (existing || []).some((t) => nameKey(t.name) === n);
  };

  // 预览阶段先挡一遍：缺名称 / 状态写错 / 日期认不出来，都不必等到提交才报错
  const validateTournamentRow = (row) => parseTournamentRow(row).error || '';

  const importHint = useMemo(
    () =>
      '同名赛季会被更新（不是跳过）：要更新已有赛季请点「全部导入」，只想新增请点「仅导入新数据」。' +
      '比赛状态可填：' +
      STATUS_HINT +
      '。日期支持 2026-08-13 / 2026/8/13，或直接用 Excel 日期单元格。' +
      '冠军/亚军/季军填队伍名称；该赛季下找不到同名队伍时会跳过这三列（新赛季此时还没有队伍，属正常）。',
    []
  );

  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问管理后台
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }
  if (!ready) {
    return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  }
  if (!me) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        请先
        <Link href="/login?from=/admin" style={{ color: 'var(--brand)', fontWeight: 600 }}>登录</Link>
        后再进入管理后台。
      </div>
    );
  }
  if (!isAdmin) {
    return <div className="empty" style={{ padding: '110px 0' }}>无权访问管理后台</div>;
  }

  return (
    <>
      <Head>
        <title>管理后台 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>管理<span className="hl">后台</span></h1>
          <p>赛事管理 · 报名名单 · 队伍与队长 · 赛程结果</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-bar">
            <div className="adm-tabs">
              <span className="adm-tab active">赛事管理</span>
              <Link className="adm-tab" href="/admin/members">群友管理</Link>
              <Link className="adm-tab" href="/admin/food">美食管理</Link>
              <Link className="adm-tab" href="/admin/party">开黑管理</Link>
              <Link className="adm-tab" href="/admin/activities">活动管理</Link>
              <Link className="adm-tab" href="/main">阵容分配</Link>
              <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
              <Link className="adm-tab" href="/admin/support">群友反馈</Link>
            </div>
            <div className="adm-bar-actions">
              {/* 赛事信息导入 / 导出 / 模板下载：非管理员整块不渲染 */}
              <ExcelIO
                columns={TOURNAMENT_COLUMNS}
                rows={tournaments}
                filename="赛事信息.xlsx"
                templateName="赛事信息_导入模板.xlsx"
                onImport={handleImportTournaments}
                checkDuplicate={dupTournament}
                validate={validateTournamentRow}
                importHint={importHint}
                canManage={isAdmin}
              />
              <Link className="btn btn-ghost" href="/admin/support">
                反馈与报错
              </Link>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                ＋ 新建赛季
              </button>
            </div>
          </div>

          {/* 「需要你处理」：新群友注册 / 资料缺漏 / 未处理反馈。
              没有通知渠道（邮件、webhook 未配置）时，这是管理员唯一能立刻看到变化的地方。 */}
          {todo && (todo.incomplete > 0 || todo.feedback > 0 || todo.short > 0) && (
            <div className="adm-todo">
              <span className="adm-todo-title">需要你处理</span>
              {todo.incomplete > 0 && (
                <Link className="adm-todo-item" href="/admin/members">
                  <span className="adm-todo-n">{todo.incomplete}</span>
                  <span className="adm-todo-label">位新群友资料待补全</span>
                </Link>
              )}
              {todo.short > 0 && (
                <a className="adm-todo-item" href="#adm-pending" title="下面「赛事待补录」里有具体是哪个赛事、哪支队、缺几个人">
                  <span className="adm-todo-n">{todo.short}</span>
                  <span className="adm-todo-label">支队伍不满 5 人</span>
                </a>
              )}
              {todo.feedback > 0 && (
                <a className="adm-todo-item" href="#adm-feedback" title="下面「群友反馈」里能看到每条留言的完整内容">
                  <span className="adm-todo-n">{todo.feedback}</span>
                  <span className="adm-todo-label">条用户反馈待查看</span>
                </a>
              )}
            </div>
          )}

          {/* 群友反馈：最新几条待人处理的留言直接摊在首屏，一条一行 */}
          {feedback && <FeedbackPanel data={feedback} />}

          {/* 待补录明细：摊到「赛事 → 队伍/选手 → 缺什么」，每条可直达编辑 */}
          <PendingPanel pending={pending} />

          {showCreate && (
            <div className="adm-create">
              <form onSubmit={handleCreate}>
                <div className="adm-create-head">
                  <span>新建赛季</span>
                  <button type="button" className="adm-close" onClick={() => setShowCreate(false)}>×</button>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>赛季名称</label>
                    <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="例如 第十届" />
                  </div>
                  <div className="form-field">
                    <label>开始日期</label>
                    <input type="date" value={createForm.start_date} onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })} />
                  </div>
                  <div className="form-field">
                    <label>结束日期</label>
                    <input type="date" value={createForm.end_date} onChange={(e) => setCreateForm({ ...createForm, end_date: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>赞助信息</label>
                    <input value={createForm.sponsor_info} onChange={(e) => setCreateForm({ ...createForm, sponsor_info: e.target.value })} placeholder="赞助商 / 赞助内容" />
                  </div>
                  <div className="form-field">
                    <label>冠军奖金</label>
                    <input value={createForm.champion_prize} onChange={(e) => setCreateForm({ ...createForm, champion_prize: e.target.value })} placeholder="例如 ¥500" />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? <><span className="spinner" />创建中…</> : '创建'}
                </button>
              </form>
            </div>
          )}

          {error && <div className="adm-error">{error}</div>}
          {loading && <div className="empty">加载中…</div>}

          <div className="adm-table">
            <div className="adm-row adm-head">
              <div>赛季</div>
              <div>状态</div>
              <div>起止</div>
              <div>操作</div>
            </div>
            {tournaments.map((t) => (
              <div className="adm-row" key={t.id}>
                <div className="adm-name">{t.name}</div>
                <div><StatusBadge status={t.status} /></div>
                <div className="adm-date">
                  {dateOnly(t.start_date) || '—'} ~ {dateOnly(t.end_date) || '—'}
                </div>
                <div>
                  <Link className="adm-link" href={'/admin/tournaments/' + t.id}>管理</Link>
                  <button
                    type="button"
                    className="adm-link-btn adm-danger-btn"
                    onClick={() => handleDelete(t)}
                    disabled={deletingId !== null}
                    title="删除赛季（连同报名、队伍、赛程一起删除）"
                  >
                    {String(deletingId) === String(t.id) ? (
                      <><span className="spinner" />删除中…</>
                    ) : (
                      '删除'
                    )}
                  </button>
                </div>
              </div>
            ))}
            {!loading && tournaments.length === 0 && (
              <div className="empty">暂无赛事，点击右上角新建</div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * 后台首屏的「待处理」计数。
 * 每项独立 try/catch：任何一张表缺失或查询出错，都只让该项为 0，
 * 不能让后台首页因为统计而 500。
 */
async function loadAdminTodo() {
  const count = async (label, sql) => {
    try {
      const r = await pool.query(sql);
      return Number(r.rows[0]?.n || 0);
    } catch (e) {
      console.error(`后台待处理计数失败（${label}）:`, e.message);
      return 0;
    }
  };

  // 新群友资料是否齐全：分数、位置、地区三项任一为空即视为「待补全」。
  // players.created_at 是 varchar，直接用 left(...,10) 和 'YYYY-MM-DD' 比，避开类型转换问题。
  const [incomplete, feedback, short] = await Promise.all([
    count(
      '新群友资料',
      `SELECT count(*)::int AS n
         FROM public.players p
        WHERE left(p.created_at, 10) >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
          AND (p.score IS NULL OR p.score = 0
               OR coalesce(btrim(p.positions), '') = ''
               OR coalesce(btrim(p.region), '') = '')`
    ),
    // 只算用户主动反馈：自动报错（kind='error'）量大且多为前端抖动，不该占「待处理」位
    count(
      '用户反馈',
      `SELECT count(*)::int AS n FROM public.support_reports WHERE status = 'new' AND kind = 'feedback'`
    ),
    count(
      '不满员队伍',
      // count(DISTINCT ...) 与「赛事待补录」明细口径保持一致：
      // team_players 里同一人重复插入过时，不去重会出现「概览 2 支、明细列 1 支」的对不上
      `SELECT count(*)::int AS n FROM (
         SELECT t.id FROM public.teams t
           LEFT JOIN public.team_players tp ON tp.team_id = t.id
          GROUP BY t.id
         HAVING count(DISTINCT tp.player_id) < 5
       ) s`
    ),
  ]);

  return { incomplete, feedback, short };
}

/**
 * 「群友反馈」面板的数据：最新 5 条待处理留言 + 两个计数。
 * 与 loadAdminTodo 的「用户反馈」计数共用同一张表同一个条件，
 * 差别只是这里带内容。查失败就整块降级为空，不能让后台首页 500。
 */
async function loadFeedbackPanel() {
  try {
    const [recent, all, errors] = await Promise.all([
      listSupportReports({ kind: 'feedback', status: 'new', limit: 5 }),
      listSupportReports({ kind: 'feedback', limit: 1 }),
      listSupportReports({ kind: 'error', status: 'new', limit: 1 }),
    ]);
    return {
      items: (recent.reports || []).map((r) => ({
        id: r.id,
        category: r.category,
        message: r.message,
        account_name: r.account_name,
        page_url: r.page_url,
        created_at: r.created_at,
        status: r.status,
        reply: r.reply || null,
      })),
      pending: recent.total || 0,
      total: all.total || 0,
      errorNew: errors.total || 0,
    };
  } catch (e) {
    console.error('群友反馈查询失败:', e.message);
    return { items: [], pending: 0, total: 0, errorNew: 0 };
  }
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin', permanent: false } };
  }
  const denied = !isAdmin(req);
  if (denied) return { props: { denied: true, todo: null, pending: null, feedback: null } };

  // 这两张表可能是新库首次访问时还没建，先确保存在再统计
  try {
    await Promise.all([ensureTournamentSchema(), ensureSupportTable()]);
  } catch (e) {
    /* 自举失败不影响计数，count() 内部会兜底为 0 */
  }

  const [todo, pending, feedback] = await Promise.all([
    loadAdminTodo(),
    loadPending(),
    loadFeedbackPanel(),
  ]);
  return { props: { denied: false, todo, pending, feedback } };
}
