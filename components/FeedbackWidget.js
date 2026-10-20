import { useEffect, useState } from 'react';
import useSession from '../hooks/useSession';
import { submitReport, clientEnv } from '../lib/support-client.mjs';

const KINDS = [
  { key: 'bug', label: '遇到问题', hint: '打不开、加载不出来、按钮没反应、数据不对…' },
  { key: 'feature', label: '想要的功能', hint: '希望站点增加什么，或者哪里用着不顺手' },
];

/**
 * 右下角反馈浮窗。全站常驻（挂在 _app 上，登录页和 /main 也有）。
 * 提交进 support_reports 表；服务端配了 SMTP 就会同时发邮件给管理员。
 */
export default function FeedbackWidget() {
  const { ready, name, isAdmin } = useSession();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [env, setEnv] = useState({ platform: '', ua: '' });

  useEffect(() => {
    setEnv(clientEnv());
  }, []);

  // Esc 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
    setTimeout(reset, 200);
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
      </button>

      {open && (
        <div className="fb-panel" role="dialog" aria-label="意见反馈">
          <div className="fb-head">
            <h3>反馈 / 提建议</h3>
            <button type="button" className="fb-close" onClick={close} aria-label="关闭">
              ×
            </button>
          </div>

          {done ? (
            <div className="fb-done">
              <div className="fb-done-icon" aria-hidden="true">
                ✓
              </div>
              <div className="fb-done-title">已经收到了，谢谢！</div>
              <div className="fb-done-sub">我们会尽快排查。如果留了联系方式，有进展会找你确认。</div>
              <div className="fb-actions">
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  再反馈一条
                </button>
                <button type="button" className="btn btn-primary" onClick={close}>
                  关闭
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
                {isAdmin ? '（管理员）' : ''} · 当前页面 {typeof location !== 'undefined' ? location.pathname : ''}
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
          )}
        </div>
      )}
    </>
  );
}
