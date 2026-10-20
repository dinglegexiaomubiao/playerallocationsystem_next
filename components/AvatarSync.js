import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 「同步 Steam 头像」按钮（仅管理员可见）。
 *
 * 为什么不是一键同步全部：OpenDota 免费额度约 60 次/分钟，
 * 服务端每次只处理 12 个（并自己限速），前端循环调用直到 done，
 * 这样中途可以停、也不会因为一次请求太久被网关掐断。
 */
export default function AvatarSync({ isAdmin, onDone }) {
  const [stat, setStat] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ updated: 0, failed: 0 });
  const [note, setNote] = useState('');
  const stopRef = useRef(false);

  const loadStat = useCallback(async () => {
    try {
      const r = await fetch('/api/avatars/sync');
      const j = await r.json();
      if (j && j.success) setStat(j);
    } catch (e) {
      // 统计拿不到就不显示进度，不影响其他功能
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadStat();
  }, [isAdmin, loadStat]);

  const stop = () => {
    stopRef.current = true;
    setNote('已停止');
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setNote('');
    setProgress({ updated: 0, failed: 0 });
    stopRef.current = false;

    let updated = 0;
    let failed = 0;
    try {
      for (let i = 0; i < 40; i += 1) {
        if (stopRef.current) break;
        const r = await fetch('/api/avatars/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 12 }),
        });
        const j = await r.json();
        if (!j.success) {
          setNote(j.error || '同步失败');
          break;
        }
        updated += j.updated || 0;
        failed += j.failed || 0;
        setProgress({ updated, failed });
        if (j.done) break;
        // 给服务端一点喘息，也避免把 OpenDota 额度打穿
        await new Promise((res) => setTimeout(res, 250));
      }
    } catch (e) {
      setNote('网络异常，已中断');
    } finally {
      setRunning(false);
      await loadStat();
      if (updated > 0 && onDone) onDone();
    }
  };

  if (!isAdmin) return null;

  const total = stat ? stat.total : null;
  const synced = stat ? stat.synced : null;
  const pending = stat ? stat.pending : null;
  const done = stat && stat.pending === 0;

  return (
    <div className="avatar-sync">
      <button
        type="button"
        className={'btn btn-ghost avatar-sync-btn' + (running ? ' is-running' : '')}
        onClick={running ? stop : run}
        disabled={!running && done}
        title={
          running
            ? '点击停止'
            : done
            ? '所有群友都已有头像'
            : '用 steamID 去 OpenDota 拉取 Steam 头像，抓到的会缓存到数据库'
        }
      >
        {running ? '停止同步' : done ? '头像已齐全' : '同步 Steam 头像'}
      </button>
      <span className="avatar-sync-note">
        {running
          ? `同步中… 新增 ${progress.updated}${progress.failed ? ` / 失败 ${progress.failed}` : ''}`
          : total !== null
          ? `头像 ${synced}/${total}${pending ? ` · 待同步 ${pending}` : ''}`
          : ''}
        {note ? ` · ${note}` : ''}
      </span>
    </div>
  );
}
