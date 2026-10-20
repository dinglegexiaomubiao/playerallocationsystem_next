import { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import { getSession, isAdmin } from '../../lib/auth';
import ExcelIO from '../../components/ExcelIO';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api-client.mjs';
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

export default function Admin({ denied }) {
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
              <Link className="adm-tab" href="/members">群友管理</Link>
              <Link className="adm-tab" href="/food">美食管理</Link>
              <Link className="adm-tab" href="/main">阵容分配</Link>
              <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
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
                售后工单
              </Link>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                ＋ 新建赛季
              </button>
            </div>
          </div>

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

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
