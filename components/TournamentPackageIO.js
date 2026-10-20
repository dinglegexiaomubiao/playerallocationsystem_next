import { useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/api-client.mjs';
import {
  PACKAGE_SHEET_NAMES,
  PACKAGE_INFO_COLUMNS,
  PACKAGE_SIGNUP_COLUMNS,
  PACKAGE_TEAM_COLUMNS,
  PACKAGE_MATCH_COLUMNS,
  packageRowsFromDraft,
  exportSheets,
  templateSheets,
  readPackageWorkbook,
  buildPackagePayload,
} from '../lib/excel';

/**
 * 单赛事整包导入 / 导出 / 模板。
 *
 * 一个工作簿装四张表：赛事信息、报名名单、队伍与成员、赛程对阵。
 * 导入是「合并」语义：同名的更新、没有的新增，库里多出来的不动，留空的格子不清空。
 *
 * 为什么导出要现拉一次 /api/players：
 * 页面快照里的队伍成员只有 player_id 和昵称，没有 SteamID。而昵称会重名，
 * 只靠昵称反查选手会认错人，所以导出时补上 SteamID。
 */
export default function TournamentPackageIO({ tid, data, tournamentName, onImported, guard }) {
  const fileRef = useRef(null);
  const gidCache = useRef(null); // player_id → steamID
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [job, setJob] = useState(null);
  const [fatal, setFatal] = useState('');

  const gidOf = async () => {
    if (gidCache.current) return gidCache.current;
    const d = await apiGet('/api/players').catch(() => null);
    const map = new Map();
    (d?.players || []).forEach((p) => map.set(String(p.id), p.game_id == null ? '' : String(p.game_id)));
    gidCache.current = map;
    return map;
  };

  const safeName = (tournamentName || '赛事').replace(/[\\/:*?"<>|]/g, '_');

  const doExport = async () => {
    setBusy(true);
    setFatal('');
    try {
      const map = await gidOf();
      const rows = packageRowsFromDraft(data, (pid) => map.get(String(pid)));
      exportSheets(
        [
          { name: PACKAGE_SHEET_NAMES.info, columns: PACKAGE_INFO_COLUMNS, rows: rows.info },
          { name: PACKAGE_SHEET_NAMES.signups, columns: PACKAGE_SIGNUP_COLUMNS, rows: rows.signups },
          { name: PACKAGE_SHEET_NAMES.teams, columns: PACKAGE_TEAM_COLUMNS, rows: rows.teams },
          { name: PACKAGE_SHEET_NAMES.matches, columns: PACKAGE_MATCH_COLUMNS, rows: rows.matches },
        ],
        `${safeName}_整包.xlsx`
      );
    } catch (e) {
      setFatal('导出失败：' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const doTemplate = () => {
    templateSheets(
      [
        { name: PACKAGE_SHEET_NAMES.info, columns: PACKAGE_INFO_COLUMNS },
        { name: PACKAGE_SHEET_NAMES.signups, columns: PACKAGE_SIGNUP_COLUMNS },
        { name: PACKAGE_SHEET_NAMES.teams, columns: PACKAGE_TEAM_COLUMNS },
        { name: PACKAGE_SHEET_NAMES.matches, columns: PACKAGE_MATCH_COLUMNS },
      ],
      `${safeName}_整包模板.xlsx`,
      [
        '导入是「合并」：同名更新、没有的新增，库里多出来的不会被删。',
        '留空的单元格表示「这次不动这一项」，不会把线上数据清空。',
        '报名名单：昵称 或 steamID 填一个即可，两个都填更准（昵称可能重名）。',
        '队伍与成员：一行一个人；同一支队要写同样的队伍名称。没有队员的队伍单独留一行、队员列空着。',
        '名次：1=冠军、2=亚军、3=季军，留空表示还没定。',
        '赛程对阵：A队/B队 必须是「队伍与成员」里出现过的队名；轮次不存在的会自动新建。',
        '胜者留空时按比分自动判定；平局则不算胜负。',
        '四张表的 sheet 名字可以改（如「报名」「队伍」「赛程」），只要关键词还在就能认出来。',
      ]
    );
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFatal('');
    setBusy(true);
    try {
      const raw = await readPackageWorkbook(file);
      if (raw.found.length === 0) {
        setFatal('这个文件里没有认得出的表。请用「下载模板」的格式，至少包含「报名名单」或「队伍与成员」。');
        return;
      }
      const payload = buildPackagePayload(raw);
      const teamCount = new Set(payload.teams.map((t) => String(t.team_name).trim().toLowerCase())).size;
      setPreview({
        payload,
        fileName: file.name,
        counts: {
          info: payload.info ? Object.values(payload.info).filter((v) => v !== null).length : 0,
          signups: payload.signups.length,
          teamRows: payload.teams.length,
          teamCount,
          matches: payload.matches.length,
        },
        sheets: raw.found,
      });
    } catch (err) {
      setFatal('解析文件失败：' + err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    // 导入会直接写库，之后页面要重新拉数据，本地未保存的草稿会被冲掉。
    // 交给调用方决定要不要拦（带未保存改动时弹确认）。
    if (guard && guard() === false) return;
    const { payload } = preview;
    setPreview(null);
    setBusy(true);
    setFatal('');
    try {
      // 几百行要写库，15s 默认超时不够，单独放宽
      const r = await apiPost(
        '/api/tournaments/' + tid + '/package',
        { info: payload.info, signups: payload.signups, teams: payload.teams, matches: payload.matches },
        { timeout: 60000 }
      );
      setJob({
        summary: r.summary,
        errors: (r.errors || []).concat(payload.errors || []),
        errorCount: (r.errorCount || 0) + (payload.errors ? payload.errors.length : 0),
      });
      onImported && onImported();
    } catch (e) {
      setFatal('导入失败：' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const totalRows = preview
    ? preview.counts.signups + preview.counts.teamRows + preview.counts.matches + (preview.counts.info ? 1 : 0)
    : 0;
  const localErrs = (preview && preview.payload.errors) || [];

  return (
    <>
      <div className="excel-io">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={onFile}
        />
        <button className="btn btn-ghost" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
          {busy ? '处理中…' : '导入整包'}
        </button>
        <button className="btn btn-ghost" onClick={doExport} disabled={busy || !data}>
          导出整包
        </button>
        <button className="btn btn-ghost" onClick={doTemplate} disabled={busy}>
          下载模板
        </button>
      </div>

      {fatal && <div className="adm-error" style={{ marginTop: 10 }}>{fatal}</div>}

      {/* ===== 导入预览 ===== */}
      {preview && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreview(null);
          }}
        >
          <div className="modal-card modal-card-sm">
            <div className="modal-head">
              <h3>整包导入预览</h3>
              <button className="modal-close" onClick={() => setPreview(null)}>
                ×
              </button>
            </div>

            <div className="pkg-file">{preview.fileName}</div>
            <ul className="pkg-sheets">
              <li>
                <b>赛事信息</b>
                <span>{preview.counts.info > 0 ? `将更新 ${preview.counts.info} 项` : '文件里没有，跳过'}</span>
              </li>
              <li>
                <b>报名名单</b>
                <span>{preview.counts.signups} 行</span>
              </li>
              <li>
                <b>队伍与成员</b>
                <span>
                  {preview.counts.teamRows} 行 · 共 {preview.counts.teamCount} 支队伍
                </span>
              </li>
              <li>
                <b>赛程对阵</b>
                <span>{preview.counts.matches} 行</span>
              </li>
            </ul>

            <div className="modal-hint">
              合并导入：同名的更新、没有的新增，<b>不会删除</b>库里已有数据；留空的格子不会清空原有内容。
            </div>

            {localErrs.length > 0 && (
              <div className="preview-errs">
                <div className="preview-errs-title">
                  有 {localErrs.length} 行格式不对，将被跳过（改好再导一次即可）
                </div>
                <ul>
                  {localErrs.slice(0, 15).map((e, i) => (
                    <li key={i}>
                      <span className="no">
                        {e.sheet} 第{e.excelRow}行
                      </span>
                      <span className="rs">{e.error}</span>
                    </li>
                  ))}
                </ul>
                {localErrs.length > 15 && <div className="modal-more">仅列出前 15 条</div>}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={busy}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmImport}
                disabled={busy || totalRows === 0}
              >
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    导入中…
                  </>
                ) : (
                  `确认导入（${totalRows} 行）`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 导入结果 ===== */}
      {job && (
        <div className="modal-mask">
          <div className="modal-card modal-card-sm">
            <div className="modal-head">
              <h3>导入完成</h3>
              <button className="modal-close" onClick={() => setJob(null)}>
                ×
              </button>
            </div>

            <ul className="pkg-result">
              {job.summary.info > 0 && (
                <li>
                  <span>赛事信息</span>
                  <b className="ok">更新 {job.summary.info} 项</b>
                </li>
              )}
              <li>
                <span>报名名单</span>
                <b className="ok">
                  新增 {job.summary.signups.added} · 更新 {job.summary.signups.updated}
                </b>
              </li>
              <li>
                <span>队伍</span>
                <b className="ok">
                  新增 {job.summary.teams.added} · 已有 {job.summary.teams.updated} · 新队员{' '}
                  {job.summary.teams.members}
                </b>
              </li>
              {job.summary.rounds > 0 && (
                <li>
                  <span>轮次</span>
                  <b className="ok">新建 {job.summary.rounds} 个</b>
                </li>
              )}
              <li>
                <span>赛程对阵</span>
                <b className="ok">
                  新增 {job.summary.matches.added} · 更新 {job.summary.matches.updated}
                </b>
              </li>
            </ul>

            {job.errorCount > 0 && (
              <div className="preview-errs">
                <div className="preview-errs-title">有 {job.errorCount} 行没能导入</div>
                <ul>
                  {job.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      <span className="no">
                        {e.sheet}
                        {e.excelRow ? ` 第${e.excelRow}行` : ''}
                      </span>
                      <span className="rs">
                        {e.name ? e.name + '：' : ''}
                        {e.error}
                      </span>
                    </li>
                  ))}
                </ul>
                {job.errorCount > 20 && <div className="modal-more">仅列出前 20 条</div>}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setJob(null)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
