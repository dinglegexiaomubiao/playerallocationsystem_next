import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession, { notifySessionChanged } from '../hooks/useSession';
import { apiPost } from '../lib/api-client.mjs';

/**
 * 改密码页。
 *
 * 两个入口：
 *   1. 自己想来改（/profile 里点「修改密码」）；
 *   2. 被管理员重置过密码，全站守卫生成 /change-password?forced=1 把人推过来。
 *
 * 强制模式下必须先改完才能去别的页面 —— 守卫在 components/ForcePasswordChange.js，
 * 这个页面只负责「说清楚为什么把他拦在这里」。
 */
export default function ChangePassword() {
  const router = useRouter();
  const { me, ready, mustChangePassword, refresh } = useSession();
  const forced = mustChangePassword || router.query.forced === '1';

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (ready && !me) {
      router.replace('/login?from=/change-password');
    }
  }, [ready, me, router]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (newPassword !== confirm) {
      setMsg({ type: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    if (newPassword.length < 6) {
      setMsg({ type: 'err', text: '新密码至少 6 位' });
      return;
    }
    if (newPassword === oldPassword) {
      setMsg({ type: 'err', text: '新密码不能和原密码相同' });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await apiPost('/api/account/change-password', { oldPassword, newPassword });
      // 改完立刻刷新会话，「必须改密」标记在后端已置 false
      await refresh();
      notifySessionChanged();
      setMsg({ type: 'ok', text: '密码已更新，正在跳转…' });
      setTimeout(() => router.replace('/profile'), 700);
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (!me) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        请先
        <Link href="/login?from=/change-password" style={{ color: 'var(--brand)', fontWeight: 600 }}>登录</Link>
        后再改密码。
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>修改密码 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>修改<span className="hl">密码</span></h1>
          <p>{me.name}</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 520 }}>
          {forced && (
            <div className="pwd-notice">
              <b>管理员刚重置了你的密码。</b>
              你现在用的是临时密码，请把它换成自己的密码 —— 改好之前不能去其它页面。
            </div>
          )}

          <form className="side-card" onSubmit={submit}>
            <h4>设置新密码</h4>

            <div className="form-field" style={{ marginBottom: 14 }}>
              <label>{forced ? '临时密码（管理员给你的）' : '原密码'}</label>
              <input
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={forced ? '8 位大写字母+数字' : '输入当前密码'}
                required
              />
            </div>

            <div className="form-field" style={{ marginBottom: 14 }}>
              <label>新密码</label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位"
                required
              />
            </div>

            <div className="form-field" style={{ marginBottom: 18 }}>
              <label>再输一次新密码</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {msg && (
              <div className={msg.type === 'err' ? 'adm-error' : 'adm-msg'} style={{ marginBottom: 14 }}>
                {msg.text}
              </div>
            )}

            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? '提交中…' : '确认修改'}
            </button>

            {!forced && (
              <Link href="/profile" className="btn btn-ghost" style={{ marginLeft: 8 }}>
                取消
              </Link>
            )}
          </form>

          <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
            密码在库中只保存加盐散列，谁也看不到原文，包括管理员。忘了只能由管理员重置。
          </p>
        </div>
      </section>
    </>
  );
}
