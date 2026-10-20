import { useRef, useState } from 'react';
import { exportRows, downloadTemplate, readRows, parseDateCell } from '../lib/excel';

/**
 * Excel 导入/导出/模板下载三件套（仅管理员可见）。
 *
 * 导入流程：选文件 → 预览（标红重复行 / 标出无法导入的行）→ 确认 → 逐条提交（实时进度条）→ 结果汇总
 * onImport 签名：(rows, onProgress) => Promise<void>
 *   onProgress(done, total, { name, error })，每提交完一条调用一次
 *
 * validate(row) => '' | '原因'
 *   给了就在预览阶段先挡一遍，省得提交到一半才报错。返回空串表示这一行没问题。
 *   只有通过校验的行才会进 onImport，所以校验口径要和 import 里的解析保持一致。
 *
 * canManage 为 false 时整个组件不渲染（默认 false，避免忘记传参时意外暴露）。
 * 调用方需在导入请求上带 x-excel-import: 1 头，服务端据此校验管理员身份。
 */
export default function ExcelIO({
  columns,
  rows,
  filename,
  onImport,
  templateName,
  checkDuplicate,
  countReviews,
  importHint,
  validate,
  canManage = false,
}) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [job, setJob] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const data = await readRows(file);
      const existing = rows || [];
      const items = data.map((row, i) => ({
        row,
        idx: i + 1,
        dup: checkDuplicate ? !!checkDuplicate(row, existing) : false,
        err: validate ? validate(row) || '' : '',
      }));
      const errCount = items.filter((it) => it.err).length;
      // 重复只统计「能导入」的行，否则「共 N · 可导入 X · 重复 D · 无法导入 E」四者会对不上
      const dupCount = items.filter((it) => it.dup && !it.err).length;
      setPreview({ items, total: items.length, dupCount, errCount, validCount: items.length - errCount });
    } catch (err) {
      alert('解析文件失败：' + err.message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  const confirmImport = async (skipDup) => {
    if (!preview) return;
    // 校验不通过的行一律不提交；skipDup 再把「同名已存在」的滤掉
    let list = preview.items.filter((it) => !it.err);
    if (skipDup) list = list.filter((it) => !it.dup);
    if (list.length === 0) {
      alert('没有可导入的数据');
      return;
    }

    const total = list.length;
    let okCount = 0;
    const errors = [];

    // 关掉预览，切到进度面板
    setPreview(null);
    setBusy(true);
    setJob({ phase: 'running', total, done: 0, ok: 0, fail: 0, current: '', errors: [], fatal: '' });

    // 页面每提交完一条就回调一次，这里统一累加并刷新面板
    const report = (done, t, meta = {}) => {
      if (meta && meta.error) {
        errors.push({ no: done, name: meta.name || '（未命名）', error: meta.error });
      } else {
        okCount += 1;
      }
      setJob({
        phase: 'running',
        total: t || total,
        done,
        ok: okCount,
        fail: errors.length,
        current: (meta && meta.name) || '',
        errors: errors.slice(-100),
        fatal: '',
      });
    };

    try {
      await onImport(
        list.map((it) => it.row),
        report
      );
      setJob((prev) => (prev ? { ...prev, phase: 'done', done: prev.total, current: '' } : prev));
    } catch (err) {
      setJob((prev) =>
        prev ? { ...prev, phase: 'done', current: '', fatal: (err && err.message) || '导入过程中断' } : prev
      );
    } finally {
      setBusy(false);
    }
  };

  const pct = job ? Math.min(100, Math.round((job.done / Math.max(job.total, 1)) * 100)) : 0;
  const running = job && job.phase === 'running';

  // 非管理员：整块不渲染（导入 / 导出 / 下载模板都不出现）
  if (!canManage) return null;

  // 预览时统计随行附带的群友评价条数（如含换行分隔的多条）
  const reviewCount =
    preview && countReviews ? countReviews(preview.items.map((it) => it.row)) : 0;

  // 真正会被提交的行：先剔掉校验不通过的
  const importable = preview ? preview.items.filter((it) => !it.err) : [];
  const importableNew = preview ? importable.filter((it) => !it.dup) : [];

  const previewCell = (v, col) => {
    // 日期列：Excel 日期单元格读出来是序列号（如 46270.0004），
    // 直接给用户看会以为填错了，这里先按导入同一套规则解析成 YYYY-MM-DD
    if (col && col.type === 'date' && v !== '' && v !== null && v !== undefined) {
      return parseDateCell(v) || String(v);
    }
    if (Array.isArray(v)) return v.join('，');
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/\r?\n/g, ' ｜ ');
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  };

  return (
    <>
      <div className="excel-io">
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={onFile} />
        <button className="btn btn-ghost" onClick={() => ref.current && ref.current.click()} disabled={busy}>
          {busy ? '处理中…' : '导入 Excel'}
        </button>
        <button className="btn btn-ghost" onClick={() => exportRows(rows, columns, filename)}>
          导出 Excel
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => downloadTemplate(columns, templateName || '导入模板_' + filename)}
        >
          下载模板
        </button>
      </div>

      {/* ===== 导入预览 ===== */}
      {preview && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreview(null);
          }}
        >
          <div className="modal-card">
            <div className="modal-head">
              <h3>导入预览</h3>
              <button className="modal-close" onClick={() => setPreview(null)}>
                ×
              </button>
            </div>
            <div className="modal-stats">
              共 <b>{preview.total}</b> 行 · 可导入 <b className="ok">{preview.validCount}</b> 行 · 重复{' '}
              <b className="dup">{preview.dupCount}</b> 行
              {preview.errCount > 0 && (
                <>
                  {' '}
                  · 无法导入 <b className="err">{preview.errCount}</b> 行
                </>
              )}
              {reviewCount > 0 && (
                <>
                  {' '}
                  · 另含 <b className="ok">{reviewCount}</b> 条群友评价
                </>
              )}
            </div>
            {importHint && <div className="modal-hint">{importHint}</div>}
            <div className="modal-table-wrap">
              <table className="modal-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.slice(0, 50).map((it) => (
                    <tr key={it.idx} className={it.err ? 'is-err' : it.dup ? 'is-dup' : ''}>
                      <td>{it.idx}</td>
                      {columns.map((c) => (
                        <td key={c.key}>{previewCell(it.row[c.label], c)}</td>
                      ))}
                      <td>
                        {it.err ? (
                          <span className="badge-err" title={it.err}>无法导入</span>
                        ) : it.dup ? (
                          <span className="badge-dup">重复</span>
                        ) : (
                          <span className="badge-new">新增</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.items.length > 50 && (
                <div className="modal-more">仅预览前 50 行，共 {preview.items.length} 行</div>
              )}
            </div>

            {/* 错误原因放在表格外：表格列窄，长中文挤在单元格里会一字一行 */}
            {preview.errCount > 0 && (
              <div className="preview-errs">
                <div className="preview-errs-title">
                  以下 {preview.errCount} 行无法导入，已自动跳过；改好表格后重新导入即可
                </div>
                <ul>
                  {preview.items
                    .filter((it) => it.err)
                    .slice(0, 20)
                    .map((it) => (
                      <li key={it.idx}>
                        <span className="no">#{it.idx}</span>
                        <span className="rs">{it.err}</span>
                      </li>
                    ))}
                </ul>
                {preview.errCount > 20 && <div className="modal-more">仅列出前 20 条</div>}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                取消
              </button>
              <button className="btn btn-ghost" onClick={() => confirmImport(false)} disabled={busy || importable.length === 0}>
                全部导入（{importable.length}）
              </button>
              <button
                className="btn btn-primary"
                onClick={() => confirmImport(true)}
                disabled={busy || importableNew.length === 0}
              >
                仅导入新数据（{importableNew.length}）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 导入进度 / 结果 ===== */}
      {job && (
        <div className="modal-mask">
          <div className="modal-card modal-card-sm">
            <div className="modal-head">
              <h3>{running ? '正在导入数据' : '导入完成'}</h3>
              {!running && (
                <button className="modal-close" onClick={() => setJob(null)}>
                  ×
                </button>
              )}
            </div>

            <div className="import-progress">
              <div className="ip-head">
                <span>{running ? `已处理 ${job.done} / ${job.total} 条` : `共 ${job.total} 条`}</span>
                <b>{pct}%</b>
              </div>
              <div className="ip-track">
                <div
                  className={'ip-fill' + (running ? '' : ' is-done')}
                  style={{ width: pct + '%' }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <div className="ip-meta">
                <span className="ok">成功 {job.ok}</span>
                <span className={job.fail > 0 ? 'err' : 'muted'}>失败 {job.fail}</span>
                {running && job.current && <span className="cur">当前：{job.current}</span>}
              </div>
            </div>

            {job.fatal && <div className="ip-fatal">{job.fatal}</div>}

            {job.errors.length > 0 && (
              <div className="ip-errors">
                <div className="ip-errors-title">失败明细（最多显示 100 条）</div>
                <ul>
                  {job.errors.map((e) => (
                    <li key={e.no}>
                      <span className="no">#{e.no}</span>
                      <span className="nm">{e.name}</span>
                      <span className="rs">{e.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="modal-actions">
              {running ? (
                <span className="ip-hint">正在写入，请不要关闭页面…</span>
              ) : (
                <button className="btn btn-primary" onClick={() => setJob(null)}>
                  完成
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
