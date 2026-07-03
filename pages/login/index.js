import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!username.trim()) {
      setError('请输入用户名');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('user', JSON.stringify({
          name: data.name,
          count: data.count
        }));
        router.push('/main');
      } else {
        setError(data.error || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
      console.error('登录错误:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>登录 - Dom的比赛记录</title>
        <meta name="description" content="比赛选手人员分配系统登录页面" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1>Dom的比赛记录</h1>
            <p>请输入您的用户名和密码</p>
            <p className="login-hint">新用户将自动注册</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="username">用户名</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入您的用户名"
                className="form-input"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">密码</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入或设置密码"
                className="form-input"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
