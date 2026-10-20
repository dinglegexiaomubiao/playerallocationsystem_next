import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiFetch } from '../../lib/api-client.mjs';

const KIND_LABEL = { error: '自动报错', feedback: '用户反馈' };
const CATEGORY_LABEL = {
  js: 'JS 报错',
  http: '接口 5xx',
  network: '网络失败',
  timeout: '请求超时',
  slow: '响应很慢',
  stuck: '一直加载中',
  resource: '资源加载失败',
  bug: '遇到问题',
  feature: '功能建议',
};
const STATUS_LABEL = { new: '待处理', doing: '处理中', done: '已处理', ignored: '已忽略' };

// 时间用绝对时刻（timestamptz），本地格式化即可
const fmtTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function AdminSupport({ denied }) {
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notify, setNotify] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openDetail, setOpenDetail] = useState({});

  const load = useCallback(async () => {
    if (denied) return;
    setLoading(true);
    setErr('');
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (status) qs.set('status', status);
    qs.set('limit', '200');
    try {
      const d = await apiGet('/api/support?' + qs.toString());
      if (d && d.success) {
        setReports(d.reports || []);
        setTotal(d.total || 0);
        setNotify(d.notify || null);
      } else {
        setErr((d && d.error) || '加载失败');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [denied, kind, status]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatusOf = async (id, next) => {
    setBusyId(id);
    try {
      await apiFetch('/api/support', { method: 'PATCH', body: { id, status: next } });
      setReports((list) => list.map((r) => (String(r.id) === String(id) ? { ...r, status: next } : r)));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问管理后台
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>售后工单 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <Link href="/admin" className="back-link">
            ← 返回管理后台
          </Link>
          <div className="hero-bar">
            <div className="hero-bar-main">
              <h1>
                售后<span className="hl">工单</span>
              </h1>
              <p>
                共 {total} 条记录 · 用户反馈与前端自动报错都会进这张表
                {notify
                  ? notify.email
                    ? ' · 邮件通知已配置'
                    : ' · 邮件未配置（SUPPORT_SMTP_*）'
                  : ''}
              </p>
            </div>
            <div className="hero-actions">
              <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
                {loading ? '刷新中…' : '刷新'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sup-toolbar">
            <div className="chips">
              {[
                ['', '全部类型'],
                ['feedback', '用户反馈'],
                ['error', '自动报错'],
              ].map(([v, label]) => (
                <button
                  type="button"
                  key={v || 'all'}
                  className={'chip' + (kind === v ? ' active' : '')}
                  onClick={() => setKind(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="chips">
              {[
                ['', '全部状态'],
                ['new', '待处理'],
                ['doing', '处理中'],
                ['done', '已处理'],
                ['ignored', '已忽略'],
              ].map(([v, label]) => (
                <button
                  type="button"
                  key={v || 'all'}
                  className={'chip' + (status === v ? ' active' : '')}
                  onClick={() => setStatus(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {err && <div className="adm-msg">{err}</div>}
          {loading && <div className="empty">加载中…</div>}
          {!loading && reports.length === 0 && <div className="empty">暂时没有工单</div>}

          <div className="sup-list">
            {reports.map((r) => (
              <div className={'sup-card kind-' + r.kind} key={r.id}>
                <div className="sup-top">
                  <span className={'sup-kind ' + r.kind}>{KIND_LABEL[r.kind] || r.kind}</span>
                  {r.category && (
                    <span className="sup-cat">{CATEGORY_LABEL[r.category] || r.category}</span>
                  )}
                  <span className={'sup-status s-' + (r.status || 'new')}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                  <span className="sup-time">{fmtTime(r.created_at)}</span>
                  <span className="sup-id">#{r.id}</span>
                </div>

                <div className="sup-msg">{r.message || '（无描述）'}</div>

                <div className="sup-meta">
                  <span>
                    <b>账号</b> {r.account_name || '未登录'}
                    {r.is_admin ? '（管理员）' : ''}
                  </span>
                  <span>
                    <b>页面</b> {r.page_url || '—'}
                  </span>
                  <span>
                    <b>平台</b> {r.platform || '—'}
                  </span>
                  <span>
                    <b>IP</b> {r.ip || '—'}
                  </span>
                  {r.contact && (
                    <span>
                      <b>联系</b> {r.contact}
                    </span>
                  )}
                  {r.notified_at && <span className="sup-notified">已邮件通知 {fmtTime(r.notified_at)}</span>}
                  {r.notify_error && <span className="sup-notify-err">通知失败：{r.notify_error}</span>}
                </div>

                {r.detail && (
                  <div className="sup-detail">
                    <button
                      type="button"
                      className="sup-detail-toggle"
                      onClick={() => setOpenDetail((s) => ({ ...s, [r.id]: !s[r.id] }))}
                    >
                      {openDetail[r.id] ? '收起技术细节 ▴' : '查看技术细节 ▾'}
                    </button>
                    {openDetail[r.id] && (
                      <pre className="sup-pre">{JSON.stringify(r.detail, null, 2)}</pre>
                    )}
                  </div>
                )}

                <div className="sup-actions">
                  {r.status !== 'done' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setStatusOf(r.id, 'done')}
                      disabled={busyId !== null}
                    >
                      {String(busyId) === String(r.id) ? '处理中…' : '标记已处理'}
                    </button>
                  )}
                  {r.status !== 'ignored' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setStatusOf(r.id, 'ignored')}
                      disabled={busyId !== null}
                    >
                      忽略
                    </button>
                  )}
                  {r.status !== 'new' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setStatusOf(r.id, 'new')}
                      disabled={busyId !== null}
                    >
                      重置为待处理
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/support', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
