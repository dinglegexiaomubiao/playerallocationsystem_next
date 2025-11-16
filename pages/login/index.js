import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const [username, setUsername] = useState('');
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
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        // 保存用户信息到 localStorage
        localStorage.setItem('user', JSON.stringify({ 
          name: data.name, 
          count: data.count 
        }));
        // 跳转到主页面
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
        <title>登录 - 比赛选手人员分配系统</title>
        <meta name="description" content="比赛选手人员分配系统登录页面" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h1>比赛选手人员分配系统</h1>
            <p>请输入您的用户名登录系统</p>
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
          background: #111827;
          padding: 20px;
        }
        
        .login-card {
          background: #1a1b23;
          border-radius: 12px;
          padding: 40px;
          width: 100%;
          max-width: 400px;
          border: 1px solid #2a2d3a;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        
        .login-header {
          text-align: center;
          margin-bottom: 30px;
        }
        
        .login-header h1 {
          color: #ffffff;
          font-size: 1.8rem;
          margin-bottom: 10px;
          font-weight: 700;
        }
        
        .login-header p {
          color: #94a3b8;
          font-size: 1rem;
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
          color: #cccccc;
          font-size: 0.9rem;
          font-weight: 500;
        }
        
        .form-input {
          padding: 12px 15px;
          border-radius: 8px;
          border: 1px solid #404040;
          background: #1a1a1a;
          color: #ffffff;
          font-size: 0.9rem;
        }
        
        .form-input:focus {
          outline: none;
          border-color: #606060;
          background: #222222;
        }
        
        .error-message {
          color: #ef4444;
          font-size: 0.875rem;
          padding: 8px 12px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 6px;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .login-button {
          padding: 12px;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          color: white;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .login-button:hover:not(:disabled) {
          background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        
        .login-button:disabled {
          opacity: 0.6;
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