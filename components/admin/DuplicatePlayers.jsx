import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api-client.mjs';

/**
 * 疑似重复的群友 → 关联合并。
 *
 * 为什么需要：群友既有 Excel 导入来的，也有补录比赛时自动建的，
 * 同一个人常常留下两条（一条有 SteamID、一条只有昵称，或者 SteamID 差一位）。
 * 不合并的话，两条会各在各的队里、各自算冠军数，赛程里的名字也对不上。
 *
 * 只做「建议」不做「自动」：昵称相同很常见（比如群里两个人都叫 CatU），
 * 所以这里列出来，由管理员看 SteamID 自己判断。
 *
 * 数据来自 /api/admin/merge-players（GET 列组，POST 合并）。
 */
export default function DuplicatePlayers({ onChanged }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  /* 每组的选择：{ [组序号]: { keepId, dropId } } */
  const [pick, setPick] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/merge-players');
      const list = d.groups || [];
      setGroups(list);
      // 默认保留「关联最多」的那条（有登录账号优先，其次报名+入队+场次多）
      const init = {};
      list.forEach((g, gi) => {
        const score = (m) => (m.accounts.length ? 1000 : 0) + m.signups * 10 + m.teams * 5 + m.matches;
        const sorted = [...g.members].sort((a, b) => score(b) - score(a));
        init[gi] = { keepId: sorted[0].id, dropId: (sorted[1] || {}).id };
      });
      setPick(init);
    } catch (e) {
      setMsg({ type: 'err', text: '读取失败：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doMerge = async (gi, g) => {
    const sel = pick[gi] || {};
    const keep = g.members.find((m) => m.id === sel.keepId);
    const drop = g.members.find((m) => m.id === sel.dropId);
    if (!keep || !drop || keep.id === drop.id) {
      setMsg({ type: 'err', text: '先选好保留方和并入方（不能是同一个）' });
      return;
    }

    const sameGid = keep.gameId && drop.gameId && keep.gameId !== drop.gameId;
    const ok = window.confirm(
      `确认把「${drop.nickname}」合并进「${keep.nickname}」？\n\n` +
        `保留：${keep.nickname}（SteamID ${keep.gameId || '无'}，报名 ${keep.signups}，入队 ${keep.teams}）\n` +
        `并入：${drop.nickname}（SteamID ${drop.gameId || '无'}，报名 ${drop.signups}，入队 ${drop.teams}）\n\n` +
        (sameGid ? `⚠ 两人的 SteamID 不同（${keep.gameId} / ${drop.gameId}），合并后只能保留一个。\n\n` : '') +
        '「并入」这条会被删除，它的入队/报名/比赛记录都会转到保留方名下；\n' +
        '保留方空着的字段会用并入方的值补齐。此操作不可撤销。'
    );
    if (!ok) return;

    setBusy(gi);
    setMsg(null);
    try {
      let body = { keepId: keep.id, dropId: drop.id };
      let r;
      try {
        r = await apiPost('/api/admin/merge-players', body);
      } catch (e) {
        // SteamID 冲突：让管理员明确选一个，绝不静默丢弃
        if (e.payload && e.payload.code === 'GAME_ID_CONFLICT') {
          const keepKeep = window.confirm(
            `两人的 SteamID 不同：\n\n保留方「${keep.nickname}」= ${keep.gameId}\n并入方「${drop.nickname}」= ${drop.gameId}\n\n` +
              `点「确定」保留「${keep.nickname}」的 SteamID（${keep.gameId}）；\n点「取消」改为保留「${drop.nickname}」的 SteamID（${drop.gameId}）。`
          );
          body = { ...body, gameIdFrom: keepKeep ? 'keep' : 'drop' };
          r = await apiPost('/api/admin/merge-players', body);
        } else {
          throw e;
        }
      }

      const moved = Object.entries(r.moved || {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join('、');
      const ded = Object.entries(r.deduped || {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join('、');
      setMsg({
        type: 'ok',
        text:
          `已把「${drop.nickname}」并入「${keep.nickname}」` +
          (moved ? `：转移 ${moved}` : '') +
          (ded ? `；去重删掉 ${ded}` : ''),
      });
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const total = useMemo(() => groups.reduce((n, g) => n + g.members.length, 0), [groups]);
  if (!loading && groups.length === 0) return null;

  return (
    <section className="unreg dup">
      <div className="unreg-head">
        <button type="button" className="unreg-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="unreg-caret">{open ? '▾' : '▸'}</span>
          疑似重复的群友
          <span className="unreg-count">{groups.length} 组 / {total} 人</span>
        </button>
        <span className="unreg-hint">
          昵称或群昵称撞了才列出来，<b>要你看着 SteamID 判断是不是同一人</b>。
          合并后「并入方」会被删除，它的报名 / 入队 / 比赛记录全部转到保留方名下，字段空着的会用并入方的值补齐。
        </span>
        <button type="button" className="unreg-refresh" onClick={load} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {msg && <div className={msg.type === 'err' ? 'unreg-msg err' : 'unreg-msg ok'}>{msg.text}</div>}

      {open &&
        groups.map((g, gi) => {
          const sel = pick[gi] || {};
          const others = g.members.filter((m) => m.id !== sel.keepId);
          return (
            <div className="dup-group" key={gi}>
              <div className="dup-head">
                <span className="dup-reason">{g.reason}</span>
                <label className="dup-pick">
                  保留
                  <select
                    className="unreg-select"
                    value={sel.keepId || ''}
                    onChange={(e) => {
                      const keepId = e.target.value;
                      const nextDrop = g.members.find((m) => m.id !== keepId);
                      setPick((p) => ({ ...p, [gi]: { keepId, dropId: nextDrop ? nextDrop.id : '' } }));
                    }}
                  >
                    {g.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nickname || '(未命名)'} · {m.gameId || '无号'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dup-pick">
                  并入
                  <select
                    className="unreg-select"
                    value={sel.dropId || ''}
                    onChange={(e) => setPick((p) => ({ ...p, [gi]: { ...p[gi], dropId: e.target.value } }))}
                  >
                    <option value="">选择要合并掉的…</option>
                    {others.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nickname || '(未命名)'} · {m.gameId || '无号'}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="unreg-btn"
                  disabled={busy === gi || !sel.dropId}
                  onClick={() => doMerge(gi, g)}
                >
                  {busy === gi ? '合并中…' : '合并'}
                </button>
              </div>

              <div className="dup-table">
                <div className="dup-row dup-row-head">
                  <span>选手</span>
                  <span>群昵称</span>
                  <span>SteamID</span>
                  <span>分数</span>
                  <span>位置</span>
                  <span>关联</span>
                  <span>出现赛事</span>
                  <span>登录账号</span>
                </div>
                {g.members.map((m) => (
                  <div
                    className={'dup-row' + (m.id === sel.keepId ? ' dup-keep' : m.id === sel.dropId ? ' dup-drop' : '')}
                    key={m.id}
                  >
                    <span className="dup-name">
                      {m.nickname || '(未命名)'}
                      {m.id === sel.keepId && <i className="dup-tag keep">保留</i>}
                      {m.id === sel.dropId && <i className="dup-tag drop">并入</i>}
                    </span>
                    <span className="unreg-muted">{m.groupNickname || '—'}</span>
                    <span className="unreg-acc">{m.gameId || '—'}</span>
                    <span className="unreg-num">{m.score || 0}</span>
                    <span className="unreg-muted" title={m.positions}>
                      {m.positions || '—'}
                    </span>
                    <span className="unreg-muted">
                      报名 {m.signups} · 入队 {m.teams} · 场次 {m.matches}
                    </span>
                    {/* 只给总数时两条同名记录长得一模一样，看不出该不该合；
                        列出赛事名并能点进去核对，才是判断依据 */}
                    <span className="dup-tours">
                      {(m.tournaments || []).length === 0 ? (
                        <span className="unreg-muted">—</span>
                      ) : (
                        m.tournaments.map((t, i) => {
                          // 三项全 0 说明这条只来自「参赛记录」表（老赛事没有报名/入队/明细），
                          // 不说清楚会让人以为取数出错
                          const onlyRoster = !t.signups && !t.teams && !t.games;
                          return (
                            <span key={t.id}>
                              {i > 0 && <span className="dup-tour-sep">、</span>}
                              <a
                                className="dup-tour"
                                href={`/tournaments/${t.id}`}
                                target="_blank"
                                rel="noreferrer"
                                title={`${t.name}｜报名 ${t.signups} · 入队 ${t.teams} · 比赛 ${t.games} 场${
                                  onlyRoster ? '（仅参赛记录）' : ''
                                }`}
                              >
                                {t.name}
                                {t.games > 0 && <i className="dup-tour-n">{t.games} 场</i>}
                              </a>
                            </span>
                          );
                        })
                      )}
                    </span>
                    <span className="unreg-muted">{m.accounts.length ? m.accounts.join('、') : '无'}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
    </section>
  );
}
