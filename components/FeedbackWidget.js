import { useCallback, useEffect, useState } from 'react';
import useSession from '../hooks/useSession';
import { submitReport, clientEnv } from '../lib/support-client.mjs';

const KINDS = [
  { key: 'bug', label: '遇到问题', hint: '打不开、加载不出来、按钮没反应、数据不对…' },
  { key: 'feature', label: '想要的功能', hint: '希望站点增加什么，或者哪里用着不顺手' },
];

const STATUS = {
  new: { label: '待处理', tip: '已收到，还没开始处理' },
  doing: { label: '处理中', tip: '正在看这件事' },
  done: { label: '已处理', tip: '已经改好了' },
  ignored: { label: '不处理', tip: '这次没有采纳，原因见下方说明' },
};

// 设备串：未登录访客也能认出「这几条是我提的」。
// 用随机串而不是 IP —— 手机换基站、运营商 NAT 都会让 IP 变，认不住人。
const TOKEN_KEY = 'laroja-fb-token';
const SEEN_KEY = 'laroja-fb-seen';

function readToken() {
  if (typeof window === 'undefined') return '';
  try {
    let t = window.localStorage.getItem(TOKEN_KEY);
    if (t && /^[A-Za-z0-9_-]{8,64}$/.test(t)) return t;
    const raw =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    t = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
    window.localStorage.setItem(TOKEN_KEY, t);
    return t;
  } catch {
    return '';
  }
}

function readSeen() {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(window.localStorage.getItem(SEEN_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(ts) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(ts));
  } catch {
    /* 隐私模式下写不了，忽略即可 */
  }
}

const fmt = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const CAT_LABEL = { bug: '遇到的问题', feature: '功能建议' };

/**
 * 右下角反馈浮窗。全站常驻（挂在 _app 上，登录页和 /main 也有）。
 *
 * 两个 tab：
 *   写反馈 —— 提交进 support_reports；
 *   我的反馈 —— 只读自己的记录，默认折叠成一行，点开看全文与管理员留言。
 *
 * 「自己的」怎么认定：登录了按账号（换设备也能看到），没登录按 localStorage
 * 里的设备串。两者都不外传，查询接口只在自己的名下检索。
 */
export default function FeedbackWidget() {
  const { ready, name, isAdmin } = useSession();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('write');
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [env, setEnv] = useState({ platform: '', ua: '' });

  // 「我的反馈」
  const [mine, setMine] = useState([]);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineErr, setMineErr] = useState('');
  const [expanded, setExpanded] = useState({});
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    setEnv(clientEnv());
    // 第一次来的人不该一上来就看到红点：把「已读时间」初始化成现在，
    // 只有之后产生的回复才算新。存过的就直接用。
    const s = readSeen();
    if (s) {
      setSeenAt(s);
    } else {
      const ts = Date.now();
      writeSeen(ts);
      setSeenAt(ts);
    }
  }, []);

  const loadMine = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setMineLoading(true);
    setMineErr('');
    try {
      const t = readToken();
      const qs = '/api/support?mine=1' + (t ? `&token=${encodeURIComponent(t)}` : '');
      const r = await fetch(qs, { cache: 'no-store', credentials: 'same-origin' });
      const d = await r.json().catch(() => null);
      if (d && d.success) setMine(d.reports || []);
      else setMineErr((d && d.error) || '读取失败');
    } catch {
      setMineErr('网络不太好，稍后再试');
    } finally {
      setMineLoading(false);
    }
  }, []);

  // 打开面板就拉一次：FAB 上的小红点要靠这份数据算，不能等用户切到「我的反馈」
  useEffect(() => {
    if (open) loadMine();
  }, [open, loadMine]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const unread = mine.filter(
    (r) => r.reply && r.replied_at && new Date(r.replied_at).getTime() > seenAt
  ).length;

  const markSeen = () => {
    const ts = Date.now();
    setSeenAt(ts);
    writeSeen(ts);
  };

  const openMine = () => {
    setTab('mine');
    markSeen();
    if (!mine.length) loadMine();
  };

  const reset = () => {
    setText('');
    setContact('');
    setErr('');
    setDone(false);
    setBusy(false);
  };

  const close = () => {
    setOpen(false);
    // 关掉后延迟复位，避免用户看到内容瞬间消失
    setTimeout(() => {
      reset();
      setTab('write');
      setExpanded({});
    }, 200);
  };

  const submit = async () => {
    setErr('');
    if (!text.trim()) {
      setErr('请先写一下你遇到的问题或想要的功能');
      return;
    }
    setBusy(true);
    const d = await submitReport(
      {
        kind: 'feedback',
        category: kind,
        message: text.trim(),
        contact: contact.trim() || null,
        client_token: readToken(),
        detail: {
          form: kind === 'bug' ? '问题反馈' : '功能建议',
          platform: env.platform,
          account: name || '未登录',
          route: typeof location !== 'undefined' ? location.pathname : '',
        },
      },
      { keepalive: false }
    );
    setBusy(false);
    if (d && d.success) {
      setDone(true);
      loadMine();
    } else {
      setErr((d && d.error) || '提交失败，请稍后再试');
    }
  };

  if (!ready) return null;

  return (
    <>
      <button
        type="button"
        className={'fb-fab' + (open ? ' is-open' : '')}
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="反馈问题或建议"
        title="反馈问题 / 提建议"
      >
        {open ? '×' : '反馈'}
        {!open && unread > 0 && <span className="fb-fab-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="fb-panel" role="dialog" aria-label="意见反馈">
          <div className="fb-head">
            <h3>反馈 / 提建议</h3>
            <button type="button" className="fb-close" onClick={close} aria-label="关闭">
              ×
            </button>
          </div>

          <div className="fb-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'write'}
              className={'fb-tab' + (tab === 'write' ? ' active' : '')}
              onClick={() => setTab('write')}
            >
              写反馈
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mine'}
              className={'fb-tab' + (tab === 'mine' ? ' active' : '')}
              onClick={openMine}
            >
              我的反馈
              {mine.length > 0 && <span className="fb-tab-n">{mine.length}</span>}
              {unread > 0 && tab !== 'mine' && <span className="fb-tab-dot" aria-hidden="true" />}
            </button>
          </div>

          {tab === 'write' &&
            (done ? (
              <div className="fb-done">
                <div className="fb-done-icon" aria-hidden="true">
                  ✓
                </div>
                <div className="fb-done-title">已经收到了，谢谢！</div>
                <div className="fb-done-sub">
                  我们会尽快排查。有进展会更新状态，有回复也会出现在「我的反馈」里。
                </div>
                <div className="fb-actions">
                  <button type="button" className="btn btn-ghost" onClick={reset}>
                    再反馈一条
                  </button>
                  <button type="button" className="btn btn-primary" onClick={openMine}>
                    查看我的反馈
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="fb-kinds">
                  {KINDS.map((k) => (
                    <button
                      type="button"
                      key={k.key}
                      className={'fb-kind' + (kind === k.key ? ' active' : '')}
                      onClick={() => setKind(k.key)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <div className="fb-hint">{KINDS.find((k) => k.key === kind).hint}</div>

                <textarea
                  className="fb-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder={
                    kind === 'bug'
                      ? '在哪一页、点了什么、看到什么现象？越具体越好排查。'
                      : '你想要什么功能，为什么需要它？'
                  }
                />
                <div className="fb-count">{text.length} / 2000</div>

                <input
                  className="fb-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  maxLength={120}
                  placeholder="联系方式（可选）：邮箱 / 微信 / QQ，方便回访"
                />

                {err && <div className="fb-err">{err}</div>}

                <div className="fb-meta">
                  会自动附带：{name ? `账号 ${name}` : '未登录访客'}
                  {isAdmin ? '（管理员）' : ''} · 当前页面{' '}
                  {typeof location !== 'undefined' ? location.pathname : ''}
                  {env.platform ? ` · ${env.platform}` : ''}
                </div>

                <div className="fb-actions">
                  <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
                    取消
                  </button>
                  <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                    {busy ? (
                      <>
                        <span className="spinner" />
                        提交中…
                      </>
                    ) : (
                      '提交反馈'
                    )}
                  </button>
                </div>
              </>
            ))}

          {tab === 'mine' && (
            <div className="fb-mine">
              {mineErr && <div className="fb-err">{mineErr}</div>}
              {mineLoading && mine.length === 0 && <div className="fb-mine-empty">加载中…</div>}
              {!mineLoading && mine.length === 0 && (
                <div className="fb-mine-empty">
                  还没有提过反馈。
                  <br />
                  提交后可以在这里看到处理状态，以及我们的回复。
                </div>
              )}

              {mine.map((r) => {
                const isOpen = !!expanded[r.id];
                const st = STATUS[r.status] || STATUS.new;
                const fresh =
                  r.reply && r.replied_at && new Date(r.replied_at).getTime() > seenAt;
                return (
                  <div className={'fb-mine-item' + (isOpen ? ' is-open' : '')} key={r.id}>
                    <button
                      type="button"
                      className="fb-mine-row"
                      onClick={() => {
                        setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }));
                        markSeen();
                      }}
                      aria-expanded={isOpen}
                    >
                      <span className={'fb-st s-' + (r.status || 'new')} title={st.tip}>
                        {st.label}
                      </span>
                      <span className="fb-mine-msg">
                        {r.message || '（无描述）'}
                        {fresh && <span className="fb-mine-fresh">新回复</span>}
                      </span>
                      <span className="fb-mine-time">{fmt(r.created_at)}</span>
                      <span className="fb-mine-caret" aria-hidden="true">
                        {isOpen ? '▴' : '▾'}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="fb-mine-body">
                        <div className="fb-mine-tag">
                          {CAT_LABEL[r.category] || '反馈'} · #{r.id}
                          {r.created_at ? ` · ${fmt(r.created_at)}` : ''}
                        </div>
                        <div className="fb-mine-full">{r.message || '（无描述）'}</div>

                        {r.reply ? (
                          <div className="fb-reply">
                            <div className="fb-reply-head">
                              回复{r.replied_by ? ` · ${r.replied_by}` : ''}
                              {r.replied_at ? ` · ${fmt(r.replied_at)}` : ''}
                            </div>
                            <div className="fb-reply-body">{r.reply}</div>
                          </div>
                        ) : (
                          <div className="fb-mine-wait">
                            {r.status === 'ignored'
                              ? '这条没有采纳，具体原因会在有回复时说明。'
                              : '暂时还没有回复，处理进展会体现在上面的状态里。'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="fb-mine-foot">
                <button type="button" className="btn btn-ghost btn-sm" onClick={loadMine} disabled={mineLoading}>
                  {mineLoading ? '刷新中…' : '刷新'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab('write')}>
                  再提一条
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
