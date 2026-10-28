import { useState, useEffect, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPost } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

/**
 * 后台「推送记录」页。
 *
 * 这张表的存在意义只有一个：**用户说「我没收到」时能查**。
 * 所以三列是灵魂 —— 状态（ok/skip/fail）、errcode、说明。
 *   skip  no_quota        → 额度用完了，让他去小程序里再点一次订阅
 *   skip  no_openid       → 他没绑微信，设置页里绑一下
 *   skip  no_config       → 我们自己没配密钥，不是他的问题
 *   fail  47003           → 模板关键词名填错了（改 lib/mp-notify.mjs 的 FIELD_MAP）
 *   fail  43101           → 用户在微信里把这条模板拒收了
 *
 * 手动发汇总的入口也在这页：预览（不消耗额度）和真发并排放，先预览再发。
 */

const STATUS_VIEW = {
  ok: { text: '成功', color: '#1E8449', cls: 'is-ok' },
  skip: { text: '跳过', color: '#B9770E', cls: 'is-warn' },
  fail: { text: '失败', color: '#B03A2E', cls: 'is-warn' },
};

const SKIP_TEXT = {
  no_quota: '额度用完',
  no_openid: '没绑微信',
  no_config: '服务端没配密钥',
  already_sent: '今天已经发过',
};

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Report({ report }) {
  if (!report) return null;
  const c = report.counts || {};
  const skipped = Object.entries(report.skipped || {});
  return (
    <div className="adm-flash is-ok" style={{ lineHeight: 1.9 }}>
      <strong>{report.dryRun ? '预览结果（没有真的发出去）' : '已执行'}</strong>
      <div style={{ fontSize: 13, marginTop: 4 }}>
        时间窗 {fmt(report.from)} → {fmt(report.until)}
        <br />
        新增：开黑 {c.party || 0} · 活动 {c.activity || 0} · 赛事 {c.tournament || 0}（共 {c.total || 0} 条）
        <br />
        收件人 {report.recipients || 0} 人 · 写站内信 {report.inbox || 0} 条 · 推送成功 {report.pushed || 0} 次
        {report.reason === 'no_new' ? <div style={{ marginTop: 4 }}>这段时间没有新内容，什么都没发。</div> : null}
        {report.reason === 'window_too_short' ? (
          <div style={{ marginTop: 4 }}>
            距上次汇总才 {report.windowMin} 分钟（不足 10 分钟），已跳过 —— 这是防止连点两次
            把额度白消耗掉。真要补发，用「立即发汇总」并确认。
          </div>
        ) : null}
        {skipped.length > 0 ? (
          <div style={{ marginTop: 4 }}>
            跳过：
            {skipped.map(([k, v]) => (
              <span key={k} className="adm-chip is-warn" style={{ marginLeft: 4 }}>
                {SKIP_TEXT[k] || k} {v}
              </span>
            ))}
          </div>
        ) : null}
        {(report.errors || []).length > 0 ? (
          <div style={{ marginTop: 4, color: '#B03A2E', fontSize: 12 }}>
            部分统计失败：{report.errors.join('；')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminMpPushPage({ denied }) {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState('');
  const [scene, setScene] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = [];
      if (status) qs.push('status=' + encodeURIComponent(status));
      if (scene) qs.push('scene=' + encodeURIComponent(scene));
      const d = await apiGet('/api/admin/mp/push-logs' + (qs.length ? '?' + qs.join('&') : ''));
      setLogs((d && d.logs) || []);
      setStats((d && d.stats) || null);
    } catch (e) {
      setMsg({ type: 'err', text: '加载失败：' + e.message });
    } finally {
      setLoading(false);
    }
  }, [status, scene]);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const run = async (action) => {
    if (busy) return;
    if (action === 'digest' && !window.confirm('真的发一次汇总？\n\n会消耗每个订阅者 1 次额度，额度为 0 的人会被跳过。')) {
      return;
    }
    setBusy(action);
    setMsg(null);
    setReport(null);
    try {
      // 手动点「立即发汇总」带上 force：这是人确认过的动作，不该被「窗口太短」挡回去
      // （那道保护挡的是 pm2 重启连跑、脚本重复触发）。连点两下由 busy 状态防住。
      const payload = action === 'digest' ? { action, force: true } : { action };
      const r = await apiPost('/api/admin/mp/push', payload);
      setReport((r && r.report) || null);
      setMsg({ type: 'ok', text: action === 'preview' ? '预览完成' : '已执行' });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  if (denied) return <AdminDenied hint="推送记录里有 openid，只给管理员看。" />;

  const configured = (stats && stats.configured) || {};

  return (
    <AdminShell
      title="推送"
      accent="记录"
      active="mpPush"
      lead="每一次订阅消息下发的结果。用户说没收到，先在这一页找他的账号。"
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => run('preview')} disabled={!!busy}>
            {busy === 'preview' ? '统计中…' : '预览汇总'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => run('digest')}
            disabled={!!busy || !configured.canPush}
            title={configured.canPush ? '' : '服务端还没配好 AppSecret 或模板 id'}
          >
            {busy === 'digest' ? '发送中…' : '立即发汇总'}
          </button>
        </>
      }
      metrics={[
        { n: (stats && stats.pushedToday) || 0, label: '今日成功' },
        { n: logs.filter((l) => l.status === 'skip').length, label: '本页跳过' },
        { n: logs.filter((l) => l.status === 'fail').length, label: '本页失败', warn: true },
        { n: (stats && stats.unreadTotal) || 0, label: '未读站内信' },
      ]}
    >
      <div className="adm-tool">
        <select className="adm-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="ok">成功</option>
          <option value="skip">跳过</option>
          <option value="fail">失败</option>
        </select>
        <select className="adm-select" value={scene} onChange={(e) => setScene(e.target.value)}>
          <option value="">全部场景</option>
          <option value="digest">每日汇总</option>
          <option value="signup">报名提醒</option>
          <option value="manual">手动 / 测试</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          刷新
        </button>
        <span className="adm-tool-note">{logs.length} 条</span>
      </div>

      {msg && <div className={'adm-flash is-' + (msg.type === 'err' ? 'err' : 'ok')}>{msg.text}</div>}
      <Report report={report} />

      {loading ? (
        <div className="empty">加载中…</div>
      ) : logs.length === 0 ? (
        <div className="empty" style={{ padding: '60px 0', lineHeight: 1.9 }}>
          还没有推送记录。
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            先点右上角「预览汇总」看看内容，再决定要不要真发。
          </div>
        </div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th style={{ width: 96 }}>时间</th>
                <th>账号</th>
                <th>openid</th>
                <th>场景</th>
                <th>状态</th>
                <th style={{ width: 64, textAlign: 'right' }}>errcode</th>
                <th>说明</th>
                <th>标题</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const sv = STATUS_VIEW[l.status] || { text: l.status, color: 'var(--text-3)' };
                return (
                  <tr key={l.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmt(l.createdAt)}</td>
                    <td style={{ fontWeight: 600 }}>{l.account || '—'}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-3)' }}>
                      {l.openid || '—'}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {l.scene === 'digest' ? '每日汇总' : l.scene === 'signup' ? '报名提醒' : l.scene}
                    </td>
                    <td>
                      <span style={{ color: sv.color, fontWeight: 600 }}>{sv.text}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>
                      {l.errcode === null || l.errcode === undefined ? '—' : l.errcode}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.errmsg ? (
                        <span style={{ color: l.status === 'ok' ? 'var(--text-3)' : '#B03A2E' }}>
                          {SKIP_TEXT[l.errmsg] || l.errmsg}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.title || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="adm-tool-note" style={{ marginTop: 12, lineHeight: 1.9 }}>
        「跳过」不是故障：<code>no_quota</code> 是额度用完了、<code>no_openid</code> 是没绑微信、
        <code>no_config</code> 是我们没配密钥。<code>fail</code> 才是真出问题 ——
        47003 表示模板关键词名和 <code>lib/mp-notify.mjs</code> 的 <code>FIELD_MAP</code> 对不上。
      </p>
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/mp-push', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
