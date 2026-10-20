import { useRef, useState } from 'react';
import { exportRows, downloadTemplate, readRows } from '../lib/excel';

export default function ExcelIO({ columns, rows, filename, onImport, templateName, checkDuplicate }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

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
      }));
      const dupCount = items.filter((it) => it.dup).length;
      setPreview({ items, total: items.length, dupCount, validCount: items.length - dupCount });
    } catch (err) {
      alert('解析文件失败：' + err.message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  const confirmImport = async (skipDup) => {
    if (!preview) return;
    const list = skipDup ? preview.items.filter((it) => !it.dup) : preview.items;
    if (list.length === 0) {
      alert('没有可导入的数据');
      return;
    }
    setBusy(true);
    try {
      await onImport(list.map((it) => it.row));
      setPreview(null);
    } finally {
      setBusy(false);
    }
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
            </div>
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
                    <tr key={it.idx} className={it.dup ? 'is-dup' : ''}>
                      <td>{it.idx}</td>
                      {columns.map((c) => (
                        <td key={c.key}>
                          {Array.isArray(it.row[c.label]) ? it.row[c.label].join('，') : it.row[c.label] ?? ''}
                        </td>
                      ))}
                      <td>
                        {it.dup ? <span className="badge-dup">重复</span> : <span className="badge-new">新增</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.items.length > 50 && (
                <div className="modal-more">仅预览前 50 行，共 {preview.items.length} 行</div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                取消
              </button>
              <button className="btn btn-ghost" onClick={() => confirmImport(false)} disabled={busy}>
                全部导入（{preview.total}）
              </button>
              <button
                className="btn btn-primary"
                onClick={() => confirmImport(true)}
                disabled={busy || preview.validCount === 0}
              >
                仅导入新数据（{preview.validCount}）
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
