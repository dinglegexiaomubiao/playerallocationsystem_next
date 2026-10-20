import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Register() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [gameId, setGameId] = useState('');
  const [groupNickname, setGroupNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) return setError('请输入登录账号');
    if (!password.trim()) return setError('请设置密码');
    if (!gameId.trim()) return setError('请填写 Steam 账号');
    if (!/^\d{1,20}$/.test(gameId.trim())) return setError('Steam 账号应为纯数字 ID，例如 114678450');
    if (!groupNickname.trim()) return setError('请填写群昵称');
    setLoading(true);

    try {
      // 走独立的注册接口（/api/login 只校验已有账号，不会再自动建号）
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          game_id: gameId.trim(),
          group_nickname: groupNickname.trim() || null,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('user', JSON.stringify({ name: data.name, count: data.count }));
        const from =
          typeof router.query.from === 'string' &&
          router.query.from.startsWith('/') &&
          !router.query.from.startsWith('//')
            ? router.query.from
            : null;
        router.push(from || (data.isAdmin ? '/main' : '/profile'));
      } else {
        setError(data.error || '注册失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
      console.error('注册错误:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>注册 · 深圳LaRoja Dota2社区</title>
        <meta name="description" content="注册深圳LaRoja Dota2社区账号" />
      </Head>

      <div className="register-wrap">
        <div className="register-card">
          <div className="register-header">
            <h1>注册账号</h1>
            <p>注册后即可报名比赛、完善个人资料</p>
          </div>

          <form onSubmit={handleSubmit} className="register-form">
            <div className="register-section">登录信息</div>
            <div className="form-row">
              <div className="form-field">
                <label>登录账号</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="随意起个账号" disabled={loading} />
              </div>
              <div className="form-field">
                <label>密码</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="随意设置密码" disabled={loading} />
              </div>
            </div>
            <div className="register-note">
              账号和密码随意填写即可，它们<span className="note-strong">不会对外展示</span>，仅用于把登录身份和你填写的选手信息关联起来。
            </div>

            <div className="register-section">选手信息</div>
            <div className="form-row">
              <div className="form-field">
                <label>Steam 账号 <span className="field-note">（数字 ID，唯一不变，用于识别）</span></label>
                <input type="text" inputMode="numeric" value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="例如 114678450" disabled={loading} />
              </div>
              <div className="form-field">
                <label>群昵称 <span className="field-note">（公开显示的名字）</span></label>
                <input type="text" value={groupNickname} onChange={(e) => setGroupNickname(e.target.value)} placeholder="群里怎么称呼你" disabled={loading} />
              </div>
            </div>
            <div className="register-note">
              其余资料（地区、天梯分、擅长位置、英雄、自我评价、默契队友、仇人）登录后可在「个人信息」页补充完善。
            </div>

            {error && <div className="register-error">{error}</div>}

            <button type="submit" className="register-submit" disabled={loading}>
              {loading ? '注册中…' : '注册并登录'}
            </button>
          </form>

          <div className="register-footer">
            已有账号？<a href="/login">去登录</a>
          </div>
        </div>
      </div>
    </>
  );
}
