import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import ExcelIO from '../../components/ExcelIO';
import { PLAYER_COLUMNS, splitList } from '../../lib/excel';

const POSITIONS = ['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'];

function tierOf(score) {
  if (score >= 5420) return { cls: 'score-immortal', label: '冠绝一世' };
  if (score >= 4620) return { cls: 'score-divine', label: '超凡入圣' };
  if (score >= 3850) return { cls: 'score-ancient', label: '万古流芳' };
  if (score >= 3080) return { cls: 'score-legend', label: '传奇' };
  if (score >= 2310) return { cls: 'score-archon', label: '统帅' };
  return { cls: 'score-others', label: '中军以下' };
}

export default function MembersPage() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('全部');
  const [sort, setSort] = useState('score');

  const reload = () => {
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => setPlayers(d.players || []))
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setPlayers(d.players || []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 选手 id -> 昵称，用于把「默契选手」里的 id 显示成昵称
  const nameMap = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(String(p.id), p.nickname));
    return m;
  }, [players]);

  const filtered = useMemo(() => {
    let list = players.slice();
    const kw = q.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (p) =>
          (p.nickname || '').toLowerCase().includes(kw) ||
          String(p.game_id || '').toLowerCase().includes(kw) ||
          (p.group_nickname || '').toLowerCase().includes(kw)
      );
    }
    if (pos !== '全部') list = list.filter((p) => (p.positions || []).includes(pos));
    if (sort === 'score') list.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (sort === 'champion') list.sort((a, b) => (b.championships || 0) - (a.championships || 0));
    else if (sort === 'name') list.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
    return list;
  }, [players, q, pos, sort]);

  const handleImport = async (rows, onProgress) => {
    const list = rows
      .map((row) => ({
        nickname: String(row['昵称'] || '').trim(),
        game_id: String(row['steamID'] || '').trim(),
        group_nickname: String(row['群昵称'] || '').trim(),
        score: Number(row['天梯分']) || 0,
        positions: splitList(row['擅长位置']),
        heroes: splitList(row['擅长英雄']),
        win_rate: Number(row['胜率']) || 0,
        championships: Number(row['冠军数']) || 0,
        synergy_players: splitList(row['默契选手']),
      }))
      .filter((p) => p.nickname);

    if (list.length === 0) {
      alert('没有解析到有效数据，请确认表头与「下载模板」一致');
      return;
    }

    const total = list.length;
    for (let i = 0; i < total; i++) {
      const p = list[i];
      let err = '';
      try {
        const r = await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) err = d.error || d.message || `请求失败（HTTP ${r.status}）`;
      } catch (e) {
        err = (e && e.message) || '网络错误';
      }
      if (onProgress) onProgress(i + 1, total, { name: p.nickname, error: err });
    }
    reload();
  };

  // 去重：steamID 相同 或 昵称相同，视为重复
  const checkDuplicate = (row, existing) => {
    const gid = String(row['steamID'] || '').trim();
    const nick = String(row['昵称'] || '').trim();
    return existing.some(
      (p) => (gid && String(p.game_id || '') === gid) || (nick && (p.nickname || '') === nick)
    );
  };

  return (
    <>
      <Head>
        <title>群友信息 · DOTA 群英荟</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>
            群友<span className="hl">信息</span>
          </h1>
          <p>共 {players.length} 位群友 · 天梯分、擅长位置与英雄池一览</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="toolbar">
            <div className="search-box">
              <input placeholder="搜索昵称 / steamID / 群昵称" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="chips">
              {['全部', ...POSITIONS].map((p) => (
                <button key={p} className={`chip ${pos === p ? 'active' : ''}`} onClick={() => setPos(p)}>
                  {p}
                </button>
              ))}
            </div>
            <select className="chip" value={sort} onChange={(e) => setSort(e.target.value)} style={{ paddingRight: 28 }}>
              <option value="score">按天梯分</option>
              <option value="champion">按冠军数</option>
              <option value="name">按昵称</option>
            </select>
            <ExcelIO
              columns={PLAYER_COLUMNS}
              rows={players}
              filename="群友信息.xlsx"
              templateName="群友信息_导入模板.xlsx"
              onImport={handleImport}
              checkDuplicate={checkDuplicate}
            />
          </div>

          {loading && <div className="empty">加载中…</div>}
          {error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="empty">没有符合条件的群友</div>}

          <div className="players-grid">
            {filtered.map((p) => {
              const t = tierOf(p.score || 0);
              return (
                <Link href={'/members/' + p.id} className="p-card" key={p.id}>
                  <div className="p-head">
                    <div className="p-avatar">{(p.nickname || '?').slice(0, 1)}</div>
                    <div>
                      <div className="p-name">{p.nickname || '未命名'}</div>
                      <div className="p-id">steamID {p.game_id || '—'}</div>
                    </div>
                    <div className={`p-score ${t.cls}`} title={t.label}>
                      {p.score || 0}
                    </div>
                  </div>
                  <div className="p-tags">
                    {(p.positions || []).length > 0 ? (
                      p.positions.map((x, i) => (
                        <span className="p-tag" key={i}>
                          {x}
                        </span>
                      ))
                    ) : (
                      <span className="p-tag">未填写位置</span>
                    )}
                  </div>
                  {(p.heroes || []).length > 0 && (
                    <div className="p-heroes">
                      <div className="lbl">擅长英雄</div>
                      {p.heroes.slice(0, 4).map((h, i) => (
                        <span className="h" key={i}>
                          {h}
                        </span>
                      ))}
                      {p.heroes.length > 4 && <span className="h">+{p.heroes.length - 4}</span>}
                    </div>
                  )}
                  {(p.synergy_players || []).length > 0 && (
                    <div className="p-heroes p-synergy">
                      <div className="lbl">默契队友</div>
                      {p.synergy_players.slice(0, 3).map((sid, i) => (
                        <span className="h h-synergy" key={i}>
                          {nameMap.get(String(sid)) || sid}
                        </span>
                      ))}
                      {p.synergy_players.length > 3 && (
                        <span className="h h-synergy">+{p.synergy_players.length - 3}</span>
                      )}
                    </div>
                  )}
                  <div className="p-foot">
                    <span>🏆 冠军 {p.championships || 0} 个</span>
                    <span>{t.label} · 查看详情 →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
