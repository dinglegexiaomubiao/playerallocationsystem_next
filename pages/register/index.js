import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const POSITION_OPTIONS = ['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'];

// 可搜索选择器：用于「默契队友」「仇人」，输入昵称/steamid 模糊搜索，选中成标签
function PlayerPicker({ label, hint, value, onChange, placeholder }) {
  const [kw, setKw] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!kw.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/players/search?q=' + encodeURIComponent(kw.trim()));
        const d = await r.json();
        if (alive) setResults(d.players || []);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kw]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const add = (p) => {
    if (!value.some((x) => String(x.id) === String(p.id))) {
      onChange([...value, { id: String(p.id), nickname: p.nickname || p.group_nickname || p.game_id }]);
    }
    setKw('');
    setOpen(false);
  };

  const remove = (id) => {
    onChange(value.filter((x) => String(x.id) !== String(id)));
  };

  return (
    <div className="picker" ref={boxRef}>
      <div className="picker-label">
        {label}
        {hint && <span className="picker-hint">{hint}</span>}
      </div>
      <div className="picker-tags">
        {value.map((x) => (
          <span className="picker-tag" key={x.id}>
            {x.nickname}
            <button type="button" className="picker-remove" onClick={() => remove(x.id)} aria-label="移除">
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="picker-input"
          value={kw}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setKw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && kw.trim() && (
        <div className="picker-dropdown">
          {loading && <div className="picker-empty">搜索中…</div>}
          {!loading && results.length === 0 && <div className="picker-empty">无匹配选手</div>}
          {!loading &&
            results.map((p) => (
              <button type="button" key={p.id} className="picker-option" onClick={() => add(p)}>
                <span className="picker-option-name">{p.nickname}</span>
                <span className="picker-option-sub">
                  {p.group_nickname && p.group_nickname !== p.nickname ? p.group_nickname + ' · ' : ''}
                  steamID {p.game_id}
                  {p.score ? ' · ' + p.score + ' 分' : ''}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export default function Register() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [gameId, setGameId] = useState('');
  const [groupNickname, setGroupNickname] = useState('');
  const [region, setRegion] = useState('');
  const [score, setScore] = useState('');
  const [position, setPosition] = useState('中单');
  const [heroes, setHeroes] = useState('');
  const [selfIntro, setSelfIntro] = useState('');
  const [synergy, setSynergy] = useState([]);
  const [enemies, setEnemies] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) return setError('请输入用户名');
    if (!password.trim()) return setError('请设置密码');
    if (!gameId.trim()) return setError('请填写 SteamID');
    setLoading(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          profile: {
            game_id: gameId.trim(),
            nickname: username.trim(),
            group_nickname: groupNickname.trim() || null,
            region: region.trim() || null,
            score: score.trim() ? parseInt(score, 10) : null,
            positions: [position],
            heroes: heroes.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            self_intro: selfIntro.trim() || null,
            synergy_players: synergy.map((x) => x.id),
            enemies: enemies.map((x) => x.id),
          },
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
        router.push(from || (data.isAdmin ? '/main' : '/'));
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
        <title>注册 - DOTA 群英荟</title>
        <meta name="description" content="注册 DOTA 群英荟账号并填写选手资料" />
      </Head>

      <div className="register-wrap">
        <div className="register-card">
          <div className="register-header">
            <h1>注册账号</h1>
            <p>填写选手资料后即可报名比赛，展示在群友信息里</p>
          </div>

          <form onSubmit={handleSubmit} className="register-form">
            <div className="register-section">登录信息</div>
            <div className="form-row">
              <div className="form-field">
                <label>用户名（登录用）</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="昵称" disabled={loading} />
              </div>
              <div className="form-field">
                <label>密码</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="设置密码" disabled={loading} />
              </div>
            </div>

            <div className="register-section">选手资料</div>
            <div className="form-row">
              <div className="form-field">
                <label>SteamID <span className="field-note">（唯一不变，用于识别）</span></label>
                <input type="text" value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="例如 114678450" disabled={loading} />
              </div>
              <div className="form-field">
                <label>群昵称</label>
                <input type="text" value={groupNickname} onChange={(e) => setGroupNickname(e.target.value)} placeholder="群里怎么称呼" disabled={loading} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>所处地区</label>
                <input type="text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="例如 深圳" disabled={loading} />
              </div>
              <div className="form-field">
                <label>天梯分数</label>
                <input type="number" value={score} onChange={(e) => setScore(e.target.value)} placeholder="例如 5600" disabled={loading} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>擅长位置</label>
                <select value={position} onChange={(e) => setPosition(e.target.value)} disabled={loading}>
                  {POSITION_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>擅长英雄</label>
                <input type="text" value={heroes} onChange={(e) => setHeroes(e.target.value)} placeholder="多个用逗号分隔" disabled={loading} />
              </div>
            </div>

            <div className="form-field">
              <label>自我评价</label>
              <textarea value={selfIntro} onChange={(e) => setSelfIntro(e.target.value)} placeholder="一句话介绍自己" rows={2} disabled={loading} />
            </div>

            <PlayerPicker
              label="默契队友"
              value={synergy}
              onChange={setSynergy}
              placeholder="搜索昵称或 SteamID 添加"
            />

            <PlayerPicker
              label="仇人"
              hint="仅趣味展示，无实际影响"
              value={enemies}
              onChange={setEnemies}
              placeholder="搜索昵称或 SteamID 添加"
            />

            {error && <div className="register-error">{error}</div>}

            <button type="submit" className="register-submit" disabled={loading}>
              {loading ? '注册中…' : '注册并登录'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
