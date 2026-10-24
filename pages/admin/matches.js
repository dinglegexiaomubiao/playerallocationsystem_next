import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSession, isAdmin } from '../../lib/auth';
import { apiDelete, apiGet, apiPost } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';
import heroIdToName from '../../lib/heroMapping';

/**
 * 对局战绩管理。
 *
 * 这些行（`dota_matches` / `dota_match_players`）只由两个脚本写入，前台却把它们当硬数据用：
 * 群友详情页的出战记录、赛事页每场对局明细、替补判定全靠它。
 * 于是「这局认错人」「这人是替补不算队籍」「这场抓串了」以前只能 SSH 改库。
 *
 * ⚠ 这里删的是**对局明细**，不是赛程对阵：名次、比分、晋级关系都在 `matches` / `tournaments`，
 *   删这行不影响名次。这句话必须写在按钮旁边，否则没人敢按。
 */
const splitSign = (arr) => arr.map((n) => (n === null || n === undefined ? '-' : n)).join(' / ');

export default function AdminMatchesPage({ denied }) {
  const [data, setData] = useState({ games: [], tournaments: [], unboundTotal: 0, gamesTotal: 0 });
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tourId, setTourId] = useState('');
  const [unboundOnly, setUnboundOnly] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (tourId) qs.set('tournament_id', tourId);
      if (unboundOnly) qs.set('unbound', '1');
      if (q.trim()) qs.set('q', q.trim());
      const d = await apiGet('/api/admin/matches?' + qs.toString());
      setData({
        games: d.games || [],
        tournaments: d.tournaments || [],
        unboundTotal: d.unboundTotal || 0,
        gamesTotal: d.gamesTotal || 0,
      });
      // 默认把「有未绑定选手」的局展开前 3 场 —— 那是管理员进来要看的东西
      const need = (d.games || []).filter((g) => g.players.some((p) => !p.playerId)).slice(0, 3);
      setOpen(new Set(need.map((g) => g.matchId)));
    } catch (e) {
      setFlash({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, [tourId, unboundOnly, q]);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  useEffect(() => {
    if (denied) return;
    apiGet('/api/players')
      .then((d) => setPlayers(d.players || []))
      .catch(() => setPlayers([]));
  }, [denied]);

  const { games, tournaments, unboundTotal, gamesTotal } = data;

  const bind = async (game, p, playerId) => {
    const key = game.matchId + ':' + p.accountId;
    setBusy(key);
    setFlash(null);
    try {
      if (!playerId) {
        await apiPost('/api/admin/matches', { action: 'unbind', matchId: game.matchId, accountId: p.accountId });
        setFlash({ type: 'ok', text: '解绑了，这局不再算在他头上' });
      } else {
        await apiPost('/api/admin/matches', {
          action: 'bind',
          matchId: game.matchId,
          accountId: p.accountId,
          playerId,
        });
        setFlash({ type: 'ok', text: '绑好了' });
      }
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  const standin = async (game, p) => {
    const key = 'st:' + game.matchId + ':' + p.accountId;
    setBusy(key);
    try {
      const r = await apiPost('/api/admin/matches', {
        action: 'standin',
        matchId: game.matchId,
        accountId: p.accountId,
      });
      setFlash({ type: 'ok', text: r.isStandin ? '标成替补了（不算队籍）' : '取消替补标记' });
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  const dropGame = async (game) => {
    const ok = window.confirm(
      `删掉这局的对局明细？\n\n${game.tournamentName} · 第 ${game.gameNo} 局\n${game.radiantName} ${game.score[0]} : ${game.score[1]} ${game.direName}\n\n` +
        `只删「这局谁打了什么」，不影响赛事名次和比分（那在赛程里另有记录）。但如果以后重新跑抓取脚本，它还会被写回来。`
    );
    if (!ok) return;
    setBusy('del:' + game.matchId);
    try {
      await apiDelete('/api/admin/matches', { matchId: game.matchId });
      setFlash({ type: 'ok', text: '这局删了' });
      await load();
    } catch (e) {
      setFlash({ type: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  const unboundGames = useMemo(() => games.filter((g) => g.players.some((p) => !p.playerId)).length, [games]);

  if (denied) return <AdminDenied hint="战绩要改要删，得用管理员账号。" />;

  return (
    <AdminShell
      title="对局"
      accent="战绩"
      active="matches"
      lead="每局谁玩了什么英雄、杀了几个。这些数据靠脚本从 OpenDota 抓回来 —— 抓错了、人不认识了，在这修。"
      preview={{ href: '/tournaments', label: '看赛事页' }}
      metrics={[
        { n: gamesTotal, label: '局有明细' },
        { n: unboundTotal, label: '个 Steam 号还没对上人', warn: unboundTotal > 0 },
        { n: tournaments.length, label: '届赛事有数据' },
      ]}
      actions={
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          刷新
        </button>
      }
    >
      {flash && <div className={'adm-flash is-' + (flash.type === 'ok' ? 'ok' : 'err')}>{flash.text}</div>}

      <div className="adm-tool">
        <select className="adm-select" value={tourId} onChange={(e) => setTourId(e.target.value)}>
          <option value="">全部赛事</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}（{t.games} 局）
            </option>
          ))}
        </select>
        <label className="adm-tool-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={unboundOnly} onChange={(e) => setUnboundOnly(e.target.checked)} />
          只看还没对上人的
        </label>
        <input
          className="adm-search"
          placeholder="搜 Steam 号 / 群昵称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="adm-tool-note">
          {games.length} 局{unboundGames > 0 ? ` · ${unboundGames} 局有未绑定` : ''}
        </span>
      </div>

      {loading ? (
        <div className="adm-empty">读着呢…</div>
      ) : games.length === 0 ? (
        <div className="adm-empty">
          {gamesTotal === 0
            ? '还没有抓过对局明细。跑一次 node scripts/fetch-dota-matches.js 就有了。'
            : '这个筛选下没有对局。'}
        </div>
      ) : (
        games.map((g) => {
          const isOpen = open.has(g.matchId);
          const unbound = g.players.filter((p) => !p.playerId).length;
          return (
            <div className="adm-panel" key={g.matchId}>
              <div className="adm-panel-head">
                <button
                  type="button"
                  className="adm-link-btn"
                  style={{ fontWeight: 600, padding: 0 }}
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.matchId)) next.delete(g.matchId);
                      else next.add(g.matchId);
                      return next;
                    })
                  }
                >
                  {isOpen ? '▾' : '▸'} {g.tournamentName || '未知赛事'} · 第 {g.gameNo || '?'} 局
                </button>
                <span className="adm-panel-sub is-nowrap">
                  {String(g.startTime || '').replace('T', ' ').slice(0, 16)}
                  {g.roundName ? ' · ' + g.roundName : ''}
                </span>
                <span className="adm-panel-sub is-nowrap" style={{ marginLeft: 4 }}>
                  <span style={{ color: g.radiantWin ? 'var(--ok)' : 'var(--text-2)' }}>{g.radiantName}</span>
                  {' '}
                  <b style={{ fontFamily: 'var(--font-mono)' }}>
                    {g.score[0] ?? '-'} : {g.score[1] ?? '-'}
                  </b>
                  {' '}
                  <span style={{ color: g.radiantWin === false ? 'var(--ok)' : 'var(--text-2)' }}>{g.direName}</span>
                  {g.duration ? ` · ${Math.round(g.duration / 60)} 分钟` : ''}
                </span>
                {unbound > 0 && <span className="adm-chip is-warn">{unbound} 个没对上人</span>}
                <span style={{ flex: 1 }} />
                <button
                  className="adm-link-btn"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => dropGame(g)}
                  disabled={busy === 'del:' + g.matchId}
                >
                  删这局
                </button>
              </div>

              {isOpen && (
                <table className="adm-data">
                  <thead>
                    <tr>
                      <th style={{ width: 52 }}>阵营</th>
                      <th style={{ width: 96 }}>英雄</th>
                      <th style={{ width: 118 }}>Steam 号</th>
                      <th style={{ width: 210 }}>算在谁头上</th>
                      <th className="is-num" style={{ width: 96 }}>
                        杀 / 死 / 助
                      </th>
                      <th style={{ width: 78 }}>替补</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.players.map((p) => {
                      const key = g.matchId + ':' + p.accountId;
                      return (
                        <tr key={p.accountId}>
                          <td>
                            <span className={'adm-chip' + (p.isRadiant ? '' : '')}>
                              {p.isRadiant ? '天辉' : '夜魇'}
                            </span>
                          </td>
                          <td>{heroIdToName[p.heroId] || `#${p.heroId}`}</td>
                          <td className="is-weak" style={{ fontFamily: 'var(--font-mono)' }}>
                            {p.accountId}
                          </td>
                          <td>
                            <select
                              className="adm-select"
                              style={{ width: '100%', padding: '4px 6px', fontSize: 12 }}
                              value={p.playerId || ''}
                              onChange={(e) => bind(g, p, e.target.value)}
                              disabled={busy === key}
                            >
                              <option value="">— 没对上人 —</option>
                              {players.map((pl) => (
                                <option key={pl.id} value={pl.id}>
                                  {pl.nickname}
                                  {pl.region ? `（${pl.region}）` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="is-num">{splitSign(p.kda)}</td>
                          <td>
                            {p.isStandin ? <span className="adm-chip is-warn">替补</span> : null}
                            <button
                              className="adm-link-btn"
                              onClick={() => standin(g, p)}
                              disabled={busy === 'st:' + key}
                              title="临时来顶一场的，不该算队籍"
                            >
                              {p.isStandin ? '取消' : '标为替补'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}

      <p className="adm-tool-note" style={{ marginTop: 12 }}>
        这些行是脚本从 OpenDota 抓的。手工改过的内容，下次对同一场重新抓取会被覆盖 ——
        要长期生效就顺手把脚本那边的映射也修了。
        <Link href="/admin/support" style={{ marginLeft: 6 }}>
          有情况？
        </Link>
      </p>
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) return { redirect: { destination: '/login?from=/admin/matches', permanent: false } };
  return { props: { denied: !isAdmin(req) } };
}
