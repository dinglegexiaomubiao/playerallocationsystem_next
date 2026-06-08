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

      <style jsx>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #e8f4fd 0%, #d4eaf7 30%, #e0f0fa 60%, #ecf5fb 100%);
          padding: 20px;
        }

        .login-card {
          background: #ffffff;
          border-radius: 16px;
          padding: 40px;
          width: 100%;
          max-width: 400px;
          border: 1px solid #c8ddf0;
          box-shadow: 0 8px 32px rgba(59, 130, 246, 0.08), 0 2px 8px rgba(59, 130, 246, 0.06);
        }

        .login-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .login-header h1 {
          color: #1a365d;
          font-size: 1.8rem;
          margin-bottom: 10px;
          font-weight: 700;
        }

        .login-header p {
          color: #5a7a9a;
          font-size: 1rem;
        }

        .login-hint {
          color: #94a3b8;
          font-size: 0.85rem;
          margin-top: 6px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          color: #1a365d;
          font-size: 0.9rem;
          font-weight: 500;
        }

        .form-input {
          padding: 12px 15px;
          border-radius: 10px;
          border: 1px solid #c8ddf0;
          background: #f8fafc;
          color: #1a2332;
          font-size: 0.9rem;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .form-input:focus {
          outline: none;
          border-color: #4da3e8;
          box-shadow: 0 0 0 3px rgba(77, 163, 232, 0.12);
          background: #ffffff;
        }

        .error-message {
          color: #ef4444;
          font-size: 0.875rem;
          padding: 8px 12px;
          background: #fef2f2;
          border-radius: 6px;
          border: 1px solid #fecaca;
        }

        .login-button {
          padding: 12px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #4da3e8 0%, #3b8fd4 100%);
          color: white;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
        }

        .login-button:hover:not(:disabled) {
          background: linear-gradient(135deg, #3b8fd4 0%, #2e7cc4 100%);
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
        }

        .login-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .login-card {
            padding: 30px 20px;
          }
        }
      `}</style>
    </>
  );
}
