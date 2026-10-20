import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // 后端返回的错误码：USER_NOT_FOUND 时额外给一个「去注册」入口
  const [errorCode, setErrorCode] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // 注册页要带上回跳参数，注册完才能回到原目标页
  const fromQuery =
    typeof router.query.from === 'string' &&
    router.query.from.startsWith('/') &&
    !router.query.from.startsWith('//')
      ? router.query.from
      : null;
  const registerHref = fromQuery ? `/register?from=${encodeURIComponent(fromQuery)}` : '/register';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setErrorCode('');
    setLoading(true);

    if (!username.trim()) {
      setError('请输入用户名');
      setLoading(false);
      return;
    }

    if (!password.trim()) {
      setError('请输入密码');
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

        // 回跳地址只接受站内路径，避免被利用做开放重定向
        const from =
          typeof router.query.from === 'string' &&
          router.query.from.startsWith('/') &&
          !router.query.from.startsWith('//')
            ? router.query.from
            : null;

        if (from) {
          router.push(from);
        } else {
          // 登录后一律回社区首页；管理员想去分配工具/后台，走导航上的「管理后台」入口
          router.push('/');
        }
      } else {
        setError(data.error || '登录失败');
        setErrorCode(data.code || '');
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
        <title>登录 · 深圳LaRoja Dota2社区</title>
        <meta name="description" content="深圳LaRoja Dota2社区登录页，群友信息均由群友提供" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1>深圳LaRoja Dota2社区</h1>
            <p>请输入您的用户名和密码</p>
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
                placeholder="请输入密码"
                className="form-input"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
                {errorCode === 'USER_NOT_FOUND' && (
                  <>
                    {' '}
                    <a href={registerHref}>去注册 →</a>
                  </>
                )}
              </div>
            )}

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >
              {loading ? '登录中...' : '登录'}
            </button>

            <div className="login-register-link">
              还没有账号？
              <a href={registerHref}>填写选手资料注册</a>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
