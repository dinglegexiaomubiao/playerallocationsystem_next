import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
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
const STATUS_LABEL = { new: '待处理', doing: '处理中', done: '已处理', ignored: '不处理' };
const STATUS_OPTIONS = [
  ['new', '待处理'],
  ['doing', '处理中'],
  ['done', '已处理'],
  ['ignored', '不处理'],
];

// 时间用绝对时刻（timestamptz），本地格式化即可
const fmtTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function AdminSupport({ denied }) {
  const router = useRouter();
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  // 默认只看「用户反馈」：自动报错的数量是反馈的几十倍，混在一起会把人写的话淹掉。
  // 支持 ?kind= / ?status= 深链（后台首页的面板就带到这儿）。
  const [kind, setKind] = useState('feedback');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notify, setNotify] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openDetail, setOpenDetail] = useState({});
  // 回复草稿与状态草稿：按 id 存，避免每敲一个字都重排整页。
  // 值为 undefined 表示「没动过」，显示时回落到库里的值。
  const [replyDraft, setReplyDraft] = useState({});
  const [statusDraft, setStatusDraft] = useState({});
  const [savedId, setSavedId] = useState(null);
  const [mailMsg, setMailMsg] = useState(null);
  const [mailBusy, setMailBusy] = useState(false);

  // 用 isReady 之后再读 query：首次渲染时 router.query 还是空的，
  // 直接拿来初始化会造成「服务端渲染 A、客户端渲染 B」的 hydration 不一致
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (typeof q.kind === 'string' && ['feedback', 'error', ''].includes(q.kind)) setKind(q.kind);
    if (typeof q.status === 'string' && ['new', 'doing', 'done', 'ignored', ''].includes(q.status)) {
      setStatus(q.status);
    }
  }, [router.isReady, router.query]);

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

  // 保存「状态 + 留言」：一次 PATCH 同时提交，避免出现
  // 「状态改了、留言没存上」这种一半成功的中间态。
  const saveReply = async (r) => {
    const id = r.id;
    const reply = replyDraft[id] !== undefined ? replyDraft[id] : r.reply || '';
    const status = statusDraft[id] !== undefined ? statusDraft[id] : r.status || 'new';
    setBusyId(id);
    setErr('');
    try {
      await apiFetch('/api/support', {
        method: 'PATCH',
        body: { id, status, reply: reply.trim() },
      });
      const next = {
        ...r,
        status,
        reply: reply.trim() || null,
        replied_at: reply.trim() ? new Date().toISOString() : null,
      };
      setReports((list) => list.map((x) => (String(x.id) === String(id) ? next : x)));
      setReplyDraft((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      setStatusDraft((s) => {
        const n = { ...s };
        delete n[id];
        return n;
      });
      setSavedId(id);
      setTimeout(() => setSavedId((cur) => (String(cur) === String(id) ? null : cur)), 2400);
    } catch (e) {
      setErr(e.message || '保存失败');
    } finally {
      setBusyId(null);
    }
  };

  const testMail = async () => {
    setMailBusy(true);
    setMailMsg(null);
    try {
      const d = await apiFetch('/api/admin/support-mail-test', { method: 'POST' });
      setMailMsg(
        d && d.success
          ? { ok: true, text: '测试邮件已发出，去 710082349@qq.com 收一下（可能在垃圾箱）' }
          : { ok: false, text: (d && d.error) || '发送失败' }
      );
    } catch (e) {
      setMailMsg({ ok: false, text: e.message || '发送失败' });
    } finally {
      setMailBusy(false);
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
        <title>群友反馈 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <Link href="/admin" className="back-link">
            ← 返回管理后台
          </Link>
          <div className="hero-bar">
            <div className="hero-bar-main">
              <h1>
                群友<span className="hl">反馈</span>
              </h1>
              <p>
                共 {total} 条记录 · 群友在右下角「反馈」浮窗写的内容，以及前端自动采集的报错，都在这张表里
                {notify
                  ? notify.email
                    ? ' · 邮件通知已配置'
                    : ' · 邮件未配置（SUPPORT_SMTP_*）'
                  : ''}
              </p>
            </div>
            <div className="hero-actions">
              <button type="button" className="btn btn-ghost" onClick={testMail} disabled={mailBusy}>
                {mailBusy ? '发送中…' : '测试邮件'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
                {loading ? '刷新中…' : '刷新'}
              </button>
            </div>
          </div>
          {mailMsg && (
            <div className={'sup-mailmsg' + (mailMsg.ok ? ' ok' : ' bad')}>{mailMsg.text}</div>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-tabs" style={{ marginBottom: 16 }}>
            <Link className="adm-tab" href="/admin">赛事管理</Link>
            <Link className="adm-tab" href="/admin/members">群友管理</Link>
            <Link className="adm-tab" href="/admin/food">美食管理</Link>
            <Link className="adm-tab" href="/admin/party">开黑管理</Link>
            <Link className="adm-tab" href="/main">阵容分配</Link>
            <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
            <span className="adm-tab active">群友反馈</span>
          </div>

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
                ['ignored', '不处理'],
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

                {r.reply && (
                  <div className="sup-reply-shown">
                    <div className="sup-reply-shown-head">
                      已回复
                      {r.replied_by ? ` · ${r.replied_by}` : ''}
                      {r.replied_at ? ` · ${fmtTime(r.replied_at)}` : ''}
                      <span className="sup-reply-shown-hint">群友在他的「我的反馈」里能看到这段</span>
                    </div>
                    <div className="sup-reply-shown-body">{r.reply}</div>
                  </div>
                )}

                {r.kind === 'feedback' ? (
                  <div className="sup-reply">
                    <div className="sup-reply-status">
                      <span className="sup-reply-label">状态</span>
                      {STATUS_OPTIONS.map(([v, label]) => {
                        const cur = statusDraft[r.id] !== undefined ? statusDraft[r.id] : r.status || 'new';
                        return (
                          <button
                            type="button"
                            key={v}
                            className={'chip chip-sm' + (cur === v ? ' active' : '')}
                            onClick={() => setStatusDraft((s) => ({ ...s, [r.id]: v }))}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      className="sup-reply-input"
                      rows={3}
                      maxLength={2000}
                      placeholder="给这位群友留一句话（会显示在他的反馈浮窗里）。例如：已改成图文并排，刷新看看？"
                      value={replyDraft[r.id] !== undefined ? replyDraft[r.id] : r.reply || ''}
                      onChange={(e) => setReplyDraft((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <div className="sup-reply-bar">
                      <span className="sup-reply-count">
                        {(replyDraft[r.id] !== undefined ? replyDraft[r.id] : r.reply || '').length} / 2000
                      </span>
                      <div style={{ flex: 1 }} />
                      {String(savedId) === String(r.id) && <span className="sup-reply-saved">已保存</span>}
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => saveReply(r)}
                        disabled={busyId !== null}
                      >
                        {String(busyId) === String(r.id) ? '保存中…' : '保存状态与留言'}
                      </button>
                    </div>
                  </div>
                ) : (
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
                )}
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
