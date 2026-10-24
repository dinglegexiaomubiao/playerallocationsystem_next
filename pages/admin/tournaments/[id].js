import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../../../hooks/useSession';
import { getSession, isAdmin } from '../../../lib/auth';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../lib/api-client.mjs';
import { dateOnly } from '../../../lib/excel';
import AdminShell, { AdminDenied } from '../../../components/admin/AdminShell';
import TournamentPackageIO from '../../../components/TournamentPackageIO';
import MultiSelectFilter from '../../../components/MultiSelectFilter';
import { POSITIONS } from '../../../lib/options.mjs';

/* 库里的位置是逗号分隔字符串，编辑时转数组 */
const splitList = (v) =>
  Array.isArray(v)
    ? v
    : String(v || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

const STATUS_LIST = [
  { value: 'planning', label: '筹办中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'elimination', label: '淘汰赛' },
  { value: 'semifinal', label: '半决赛' },
  { value: 'final', label: '决赛' },
  { value: 'finished', label: '已完赛' },
  { value: 'postponed', label: '延期' },
];

const POSITION_OPTIONS = ['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'];

// 赛事信息里可编辑、且会被 diff 的字段
const INFO_FIELDS = [
  'name',
  'status',
  'start_date',
  'end_date',
  'sponsor_info',
  'champion_prize',
  'runner_up_prize',
];

const clone = (v) => JSON.parse(JSON.stringify(v));

// 报名快照里可编辑的字段（与 /api/tournaments/[id]/signups 的 PUT 白名单一致）
const SIGNUP_EDIT_FIELDS = ['score', 'positions', 'region'];

const TEMP_PREFIX = 'tmp_';
const isTemp = (v) => String(v || '').startsWith(TEMP_PREFIX);

/* ---------- 服务端数据 → 统一的草稿结构 ---------- */

function normInfo(t) {
  return {
    name: t.name || '',
    status: t.status || 'planning',
    // 不能用 slice(0,10)：start_date 是 timestamp，JSON 出来是 UTC ISO，+08 下会差一天
    start_date: dateOnly(t.start_date),
    end_date: dateOnly(t.end_date),
    sponsor_info: t.sponsor_info || '',
    champion_prize: t.champion_prize || '',
    runner_up_prize: t.runner_up_prize || '',
  };
}

function normSignup(s) {
  return {
    player_id: String(s.player_id),
    nickname: s.nickname || s.group_nickname || '未命名',
    game_id: s.game_id ? String(s.game_id) : '',
    score: s.score == null ? '' : String(s.score),
    positions: s.positions || '',
    region: s.region || '',
    // 档案当前值（只读，用于「从档案补全缺漏」，不参与 diff / 保存）
    profile_score: s.profile_score == null ? '' : String(s.profile_score),
    profile_positions: s.profile_positions || '',
    profile_region: s.profile_region || '',
    is_captain: !!s.is_captain,
    _new: false,
  };
}

function normMember(m) {
  return {
    player_id: String(m.player_id),
    nickname: m.nickname || m.group_nickname || '未命名',
    position: m.position || '',
    _new: false,
  };
}

function normTeam(t) {
  return {
    id: String(t.id),
    name: t.name || '',
    rank: t.rank == null ? '' : String(t.rank),
    captain_id: t.captain_id == null ? null : String(t.captain_id),
    captain_nickname: t.captain_nickname || '',
    members: (t.members || []).map(normMember),
    _new: false,
  };
}

function normMatch(m) {
  return {
    id: String(m.id),
    round_id: m.round_id == null ? '' : String(m.round_id),
    team_a_id: m.team_a_id == null ? '' : String(m.team_a_id),
    team_b_id: m.team_b_id == null ? '' : String(m.team_b_id),
    team_a_name: m.team_a_name || '',
    team_b_name: m.team_b_name || '',
    team_a_score: m.team_a_score == null ? '' : String(m.team_a_score),
    team_b_score: m.team_b_score == null ? '' : String(m.team_b_score),
    winner_team_id: m.winner_team_id == null ? '' : String(m.winner_team_id),
    is_grudge: !!m.is_grudge,
    _new: false,
  };
}

/* ---------- 可搜索的选手选择器 ----------
 * 替换原先无搜索的原生 <select>：选手多时根本没法找。
 * 输入框即搜索框，按 昵称/群昵称/SteamID 模糊过滤；onCreate 提供时，
 * 搜不到还会显示「新建选手」入口（把搜索词带过去当昵称预填）。
 */
function PlayerSearchSelect({ value, onChange, options, placeholder, disabled, onCreate }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const selected = options.find((o) => String(o.id) === String(value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => `${o.label} ${o.sub || ''}`.toLowerCase().includes(q))
    : options;

  // 点外面收起下拉
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="pss-wrap" ref={boxRef}>
      <input
        className="adm-input"
        value={open ? query : selected ? selected.label : ''}
        placeholder={selected ? selected.label : placeholder}
        disabled={disabled}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && !disabled && (
        <div className="pss-menu">
          {onCreate && q && (
            <button type="button" className="pss-create" onClick={() => { setOpen(false); onCreate(query.trim()); }}>
              ＋ 新建选手「{query.trim()}」
            </button>
          )}
          {filtered.length === 0 && !onCreate && <div className="pss-empty">没有匹配的选手</div>}
          {filtered.map((o) => (
            <button
              type="button"
              key={o.id}
              className={'pss-item' + (String(o.id) === String(value) ? ' is-active' : '')}
              onClick={() => { onChange(o.id); setOpen(false); setQuery(''); }}
            >
              <span className="pss-label">{o.label}</span>
              {o.sub && <span className="pss-sub">{o.sub}</span>}
            </button>
          ))}
          {filtered.length === 0 && onCreate && !q && <div className="pss-empty">输入名字或 SteamID 搜索，或直接新建</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- 草稿 diff：算出「要改什么」和「怎么改」 ---------- */

function diffDraft(base, cur, tid) {
  const groups = [];
  const ops = [];
  const push = (key, label, count) => count > 0 && groups.push({ key, label, count });

  // 1) 赛事信息
  const infoPatch = {};
  INFO_FIELDS.forEach((f) => {
    if (String(base.info[f] ?? '') !== String(cur.info[f] ?? '')) {
      infoPatch[f] = cur.info[f] === '' ? null : cur.info[f];
    }
  });
  const infoCount = Object.keys(infoPatch).length;
  if (infoCount > 0) {
    ops.push({ label: '赛事信息', run: () => apiPut('/api/tournaments/' + tid, infoPatch) });
  }
  push('info', '赛事信息', infoCount);

  // 2) 报名名单
  const baseSignupIds = base.signups.map((s) => s.player_id);
  const curSignupIds = cur.signups.map((s) => s.player_id);

  const addedSignups = cur.signups.filter((s) => !baseSignupIds.includes(s.player_id));
  if (addedSignups.length > 0) {
    const ids = addedSignups.map((s) => Number(s.player_id));
    ops.push({
      label: `加入 ${addedSignups.length} 名选手`,
      run: () => apiPost('/api/tournaments/' + tid + '/signups', { playerIds: ids }),
    });
  }
  push('signup-add', '新增报名', addedSignups.length);

  const removedSignups = base.signups.filter((s) => !curSignupIds.includes(s.player_id));
  removedSignups.forEach((s) => {
    ops.push({
      label: `移出 ${s.nickname}`,
      run: () => apiDelete('/api/tournaments/' + tid + '/signups', { playerId: Number(s.player_id) }),
    });
  });
  push('signup-del', '移除报名', removedSignups.length);

  // 快照字段（分数 / 位置 / 地区）与队长标记分开算，因为走的是不同接口
  const editedSignups = cur.signups.filter((s) => {
    const b = base.signups.find((x) => x.player_id === s.player_id);
    if (!b) return false;
    return SIGNUP_EDIT_FIELDS.some((f) => String(b[f] ?? '') !== String(s[f] ?? ''));
  });
  editedSignups.forEach((s) => {
    const b = base.signups.find((x) => x.player_id === s.player_id);
    const patch = {};
    SIGNUP_EDIT_FIELDS.forEach((f) => {
      if (String(b[f] ?? '') !== String(s[f] ?? '')) patch[f] = s[f];
    });
    ops.push({
      label: `更新 ${s.nickname} 的资料`,
      run: () => apiPut('/api/tournaments/' + tid + '/signups', { playerId: Number(s.player_id), ...patch }),
    });
  });
  push('signup-edit', '修改报名资料', editedSignups.length);

  const captainToggled = cur.signups.filter((s) => {
    const b = base.signups.find((x) => x.player_id === s.player_id);
    return b && b.is_captain !== s.is_captain;
  });
  captainToggled.forEach((s) => {
    ops.push({
      label: s.is_captain ? `指定 ${s.nickname} 为队长` : `${s.nickname} 卸任队长`,
      run: () =>
        s.is_captain
          ? apiPut('/api/tournaments/' + tid + '/captain', { playerId: Number(s.player_id) })
          : apiDelete('/api/tournaments/' + tid + '/captain', { playerId: Number(s.player_id) }),
    });
  });
  push('captain', '队长变更', captainToggled.length);

  // 3) 队伍
  const removedTeams = base.teams.filter((t) => !cur.teams.some((x) => x.id === t.id));
  removedTeams.forEach((t) => {
    ops.push({ label: `删除队伍 ${t.name}`, run: () => apiDelete('/api/teams', { id: Number(t.id) }) });
  });
  push('team-del', '删除队伍', removedTeams.length);

  const addedTeams = cur.teams.filter((t) => t._new);
  addedTeams.forEach((t) => {
    ops.push({
      label: `新建队伍 ${t.name}`,
      run: async () => {
        const created = await apiPost('/api/teams', { name: t.name || '未命名队伍', tournament_id: Number(tid) });
        const realId = created?.team?.id;
        if (!realId) throw new Error('新建队伍后没有拿到队伍ID');
        if (t.members.length > 0) {
          await apiPut('/api/team-players', {
            teamId: realId,
            playerIds: t.members.map((m) => Number(m.player_id)),
            tournament_id: Number(tid),
          });
          // 位置是逐人写的，等成员落库后再补
          for (const m of t.members) {
            if (m.position) {
              await apiPut('/api/team-players', { teamId: realId, playerId: Number(m.player_id), position: m.position });
            }
          }
        }
        if (t.rank !== '' && t.rank != null) {
          await apiPut('/api/teams', { id: realId, rank: Number(t.rank) });
        }
      },
    });
  });
  push('team-add', '新建队伍', addedTeams.length);

  const editedTeams = cur.teams.filter((t) => {
    if (t._new) return false;
    const b = base.teams.find((x) => x.id === t.id);
    if (!b) return false;
    if (b.name !== t.name) return true;
    if (String(b.rank ?? '') !== String(t.rank ?? '')) return true;
    if (b.members.map((m) => m.player_id).join(',') !== t.members.map((m) => m.player_id).join(',')) return true;
    return t.members.some((m) => {
      const bm = b.members.find((x) => x.player_id === m.player_id);
      return bm && (bm.position || '') !== (m.position || '');
    });
  });

  let teamEditCount = 0;
  editedTeams.forEach((t) => {
    const b = base.teams.find((x) => x.id === t.id);
    if (b.name !== t.name) {
      teamEditCount += 1;
      ops.push({
        label: `重命名队伍 ${b.name} → ${t.name}`,
        run: () => apiPut('/api/teams', { id: Number(t.id), name: t.name }),
      });
    }
    if (String(b.rank ?? '') !== String(t.rank ?? '')) {
      teamEditCount += 1;
      ops.push({
        label: `更新 ${t.name} 名次`,
        run: () => apiPut('/api/teams', { id: Number(t.id), rank: t.rank === '' ? null : Number(t.rank) }),
      });
    }
    // 成员增删：整队覆盖写，比逐个 POST/DELETE 更稳（不会因为中间失败留下半套）
    if (b.members.map((m) => m.player_id).join(',') !== t.members.map((m) => m.player_id).join(',')) {
      teamEditCount += 1;
      ops.push({
        label: `更新 ${t.name} 队员`,
        run: () =>
          apiPut('/api/team-players', {
            teamId: Number(t.id),
            playerIds: t.members.map((m) => Number(m.player_id)),
            tournament_id: Number(tid),
          }),
      });
    }
    t.members.forEach((m) => {
      const bm = b.members.find((x) => x.player_id === m.player_id);
      if (bm && (bm.position || '') !== (m.position || '')) {
        teamEditCount += 1;
        ops.push({
          label: `更新 ${m.nickname} 担任位置`,
          run: () => apiPut('/api/team-players', { teamId: Number(t.id), playerId: Number(m.player_id), position: m.position || null }),
        });
      }
    });
  });
  push('team-edit', '队伍修改', teamEditCount);

  // 4) 赛程
  const removedMatches = base.matches.filter((m) => !cur.matches.some((x) => x.id === m.id));
  removedMatches.forEach((m) => {
    ops.push({
      label: `删除对阵 ${m.team_a_name || '?'} vs ${m.team_b_name || '?'}`,
      run: () => apiDelete('/api/tournaments/' + tid + '/matches', { matchId: Number(m.id) }),
    });
  });
  push('match-del', '删除对阵', removedMatches.length);

  const addedMatches = cur.matches.filter((m) => m._new);
  addedMatches.forEach((m) => {
    ops.push({
      label: `新增对阵 ${m.team_a_name} vs ${m.team_b_name}`,
      run: () =>
        apiPost('/api/tournaments/' + tid + '/matches', {
          team_a_id: Number(m.team_a_id),
          team_b_id: Number(m.team_b_id),
          round_id: m.round_id ? Number(m.round_id) : null,
        }),
    });
  });
  push('match-add', '新增对阵', addedMatches.length);

  const editedMatches = cur.matches.filter((m) => {
    if (m._new) return false;
    const b = base.matches.find((x) => x.id === m.id);
    if (!b) return false;
    return (
      String(b.team_a_score ?? '') !== String(m.team_a_score ?? '') ||
      String(b.team_b_score ?? '') !== String(m.team_b_score ?? '') ||
      String(b.winner_team_id ?? '') !== String(m.winner_team_id ?? '')
    );
  });
  editedMatches.forEach((m) => {
    const b = base.matches.find((x) => x.id === m.id);
    const body = { matchId: Number(m.id) };
    if (String(b.team_a_score ?? '') !== String(m.team_a_score ?? '')) {
      body.team_a_score = m.team_a_score === '' ? null : Number(m.team_a_score);
    }
    if (String(b.team_b_score ?? '') !== String(m.team_b_score ?? '')) {
      body.team_b_score = m.team_b_score === '' ? null : Number(m.team_b_score);
    }
    if (String(b.winner_team_id ?? '') !== String(m.winner_team_id ?? '')) {
      body.winner_team_id = m.winner_team_id ? Number(m.winner_team_id) : null;
      body.status = m.winner_team_id ? 'finished' : 'scheduled';
    }
    if (Object.keys(body).length > 1) {
      ops.push({ label: `更新比分 ${m.team_a_name} vs ${m.team_b_name}`, run: () => apiPut('/api/tournaments/' + tid + '/matches', body) });
    }
  });
  push('match-edit', '比分修改', editedMatches.length);

  return { groups, ops };
}

/* ---------- 页面 ---------- */

export default function AdminTournament({ denied }) {
  const router = useRouter();
  const id = router.query.id;
  const { me, isAdmin, ready } = useSession();

  const [baseline, setBaseline] = useState(null); // 服务端最后一次确认的状态
  const [draft, setDraft] = useState(null); // 用户正在编辑的草稿
  const [candidates, setCandidates] = useState([]); // 还没报名的选手（可加入名单）
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('signups');
  const [onlyIssues, setOnlyIssues] = useState(false); // 报名名单：只看信息缺漏的行
  const [msg, setMsg] = useState(null); // { type: 'ok' | 'err', text }

  // 云端交互态：保存走一条串行流水线，progress 用「(2/5)」的形式给反馈
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const [roundBusy, setRoundBusy] = useState(false);

  // 本地表单输入（尚未成为草稿的一部分）
  const [addPlayerId, setAddPlayerId] = useState('');
  const [memberPick, setMemberPick] = useState({}); // teamId -> playerId
  // 新建选手弹窗（报名名单里搜不到人时，现场建档再入队）
  const [showNewPlayer, setShowNewPlayer] = useState(false);
  const [npForm, setNpForm] = useState({ nickname: '', game_id: '', group_nickname: '', score: '', positions: '', region: '', self_intro: '' });
  const [npSaving, setNpSaving] = useState(false);
  const [npError, setNpError] = useState('');
  const [newRoundName, setNewRoundName] = useState('');
  const [newMatch, setNewMatch] = useState({ round_id: '', team_a_id: '', team_b_id: '' });

  /* ---------- 加载 ---------- */

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      // 三份数据一起拉：赛事详情、赛程、报名名单+候选
      const [detail, matchData, signupData] = await Promise.all([
        apiGet('/api/tournaments/' + id),
        apiGet('/api/tournaments/' + id + '/matches').catch(() => ({ rounds: [], matches: [] })),
        apiGet('/api/tournaments/' + id + '/signups').catch(() => ({ signups: [], candidates: [] })),
      ]);

      if (!detail?.success) {
        setError(detail?.message || '加载失败');
        setLoading(false);
        return;
      }

      const signups = signupData?.signups?.length ? signupData.signups : detail.signups || [];

      const snap = {
        info: normInfo(detail.tournament),
        signups: signups.map(normSignup),
        teams: (detail.teams || []).map(normTeam),
        rounds: matchData?.rounds || [],
        matches: (matchData?.matches || []).map(normMatch),
      };

      setBaseline(snap);
      setDraft(clone(snap));
      setCandidates(signupData?.candidates || []);
    } catch (e) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- 草稿 diff ---------- */

  const plan = useMemo(() => {
    if (!baseline || !draft || !id) return { groups: [], ops: [] };
    return diffDraft(baseline, draft, id);
  }, [baseline, draft, id]);

  const dirtyCount = plan.groups.reduce((n, g) => n + g.count, 0);
  const dirty = dirtyCount > 0;

  /* ---------- 从「赛事待补录」跳进来的定位 ----------
   * 链接形如 /admin/tournaments/9?tab=teams&focus=12：
   *   tab   —— 自动切到对应分区
   *   focus —— 队伍 id 或选手 id，滚到那一行并高亮 3 秒
   * 这样管理员在后台首页看到「第九届 / 红队 / 2/5 人」，点一下就到那一队，不用再翻。
   */
  const focus = typeof router.query.focus === 'string' ? router.query.focus : '';

  useEffect(() => {
    const q = router.query.tab;
    if (q === 'teams' || q === 'signups' || q === 'matches') setTab(q);
  }, [router.query.tab]);

  useEffect(() => {
    if (!draft || !focus) return undefined;
    // 延后一帧：等分区内容真的挂到 DOM 上再找节点
    const locate = setTimeout(() => {
      const el = document.querySelector(`[data-focus="${focus}"]`);
      if (!el) {
        setMsg({ type: 'ok', text: '这条待补录可能已经处理过（队伍满员 / 资料已补），没找到对应行' });
        return;
      }
      // 用 auto 而不是 smooth：从后台跳过来时页面结构刚变，平滑滚动会把目标甩偏
      // （实测截图能看到滚动中途的画面），瞬间定位更准也更快
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      el.classList.add('adm-focus-hit');
    }, 80);
    const clear = setTimeout(() => {
      document.querySelectorAll('.adm-focus-hit').forEach((n) => n.classList.remove('adm-focus-hit'));
    }, 3800);
    return () => {
      clearTimeout(locate);
      clearTimeout(clear);
    };
  }, [draft, focus, tab]);

  // 有未保存改动时离开页面给个提示，避免辛苦改半天被一次误点清空
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /* ---------- 草稿编辑动作 ---------- */

  const patchInfo = (field, value) => setDraft((d) => ({ ...d, info: { ...d.info, [field]: value } }));

  const patchSignup = (playerId, field, value) =>
    setDraft((d) => ({
      ...d,
      signups: d.signups.map((s) => (s.player_id === playerId ? { ...s, [field]: value } : s)),
    }));

  const toggleCaptain = (playerId) =>
    setDraft((d) => ({
      ...d,
      signups: d.signups.map((s) => (s.player_id === playerId ? { ...s, is_captain: !s.is_captain } : s)),
    }));

  const removeSignup = (playerId) =>
    setDraft((d) => ({
      ...d,
      signups: d.signups.filter((s) => s.player_id !== playerId),
      // 人从名单里拿掉了，队伍里也不该还留着
      teams: d.teams.map((t) => ({ ...t, members: t.members.filter((m) => m.player_id !== playerId) })),
    }));

  const addSignup = () => {
    if (!addPlayerId) return;
    const c = candidates.find((x) => String(x.id) === String(addPlayerId));
    if (!c) return;
    setDraft((d) => {
      if (d.signups.some((s) => s.player_id === String(c.id))) return d;
      return {
        ...d,
        signups: [
          ...d.signups,
          {
            player_id: String(c.id),
            nickname: c.nickname || c.group_nickname || '未命名',
            game_id: c.game_id ? String(c.game_id) : '',
            score: c.score == null ? '' : String(c.score),
            positions: c.positions || '',
            region: '',
            is_captain: false,
            _new: true,
          },
        ],
      };
    });
    setAddPlayerId('');
  };

  /* ---------- 新建选手（管理员现场建档） ---------- */
  const openNewPlayer = (prefillName = '') => {
    setNpForm({ nickname: prefillName || '', game_id: '', group_nickname: '', score: '', positions: '', region: '', self_intro: '' });
    setNpError('');
    setShowNewPlayer(true);
  };

  const submitNewPlayer = async () => {
    const name = String(npForm.nickname || '').trim();
    if (!name) {
      setNpError('请填写选手昵称（必填）');
      return;
    }
    const steamId = String(npForm.game_id || '').trim();
    if (steamId && !/^\d{5,20}$/.test(steamId)) {
      setNpError('SteamID 应为纯数字（如 113529567），请检查');
      return;
    }
    setNpSaving(true);
    setNpError('');
    try {
      // tournament_id 一起带上：addPlayer 会顺带写入 player_tournament_participations
      const created = await apiPost('/api/players', {
        tournament_id: Number(id),
        nickname: name,
        game_id: steamId || null,
        group_nickname: String(npForm.group_nickname || '').trim() || name,
        score: npForm.score === '' ? 0 : Number(npForm.score),
        positions: String(npForm.positions || '').trim(),
        region: String(npForm.region || '').trim(),
        self_intro: String(npForm.self_intro || '').trim(),
      });
      if (!created?.success || !created?.player?.id) {
        throw new Error(created?.error || '创建失败，请重试');
      }
      const p = created.player;
      // 本地状态同步（不能 load()：会把用户其他未保存的草稿改动冲掉）
      setCandidates((prev) => [
        ...prev.filter((c) => String(c.id) !== String(p.id)),
        { id: String(p.id), nickname: p.nickname, group_nickname: p.group_nickname, game_id: p.game_id, score: p.score, positions: p.positions },
      ]);
      // 直接进本赛事报名草稿，点「保存修改」时 diff 会落库
      setDraft((d) => ({
        ...d,
        signups: [
          ...d.signups,
          {
            player_id: String(p.id),
            nickname: p.nickname || p.group_nickname || name,
            game_id: p.game_id ? String(p.game_id) : '',
            score: p.score == null ? '' : String(p.score),
            positions: p.positions || '',
            region: p.region || '',
            is_captain: false,
            _new: true,
          },
        ],
      }));
      setShowNewPlayer(false);
      setMsg({ type: 'ok', text: `已建档「${p.nickname}」并加入报名草稿，点「保存修改」后正式写入名单` });
    } catch (e) {
      setNpError(e.message || '创建失败');
    } finally {
      setNpSaving(false);
    }
  };

  const patchTeam = (teamId, patch) =>
    setDraft((d) => ({ ...d, teams: d.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)) }));

  const addTeam = () => {
    const tempId = TEMP_PREFIX + Date.now();
    setDraft((d) => ({
      ...d,
      teams: [
        ...d.teams,
        { id: tempId, name: '新队伍', rank: '', captain_id: null, captain_nickname: '', members: [], _new: true },
      ],
    }));
    setMsg({ type: 'ok', text: '已新建一支草稿队伍，改好名字后点「保存修改」才会写入云端' });
  };

  const removeTeam = (teamId) => {
    const team = draft.teams.find((t) => t.id === teamId);
    const affected = draft.matches.filter((m) => m.team_a_id === teamId || m.team_b_id === teamId).length;
    if (affected > 0) {
      const ok = window.confirm(
        `队伍「${team?.name || ''}」还有 ${affected} 场对阵引用了它。\n删除队伍会同时移除这些对阵，确定继续吗？`
      );
      if (!ok) return;
    }
    setDraft((d) => ({
      ...d,
      teams: d.teams.filter((t) => t.id !== teamId),
      matches: d.matches.filter((m) => m.team_a_id !== teamId && m.team_b_id !== teamId),
    }));
  };

  const addMember = (teamId) => {
    const playerId = memberPick[teamId];
    if (!playerId) return;
    const s = draft.signups.find((x) => x.player_id === String(playerId));
    if (!s) return;
    setDraft((d) => ({
      ...d,
      teams: d.teams.map((t) =>
        t.id === teamId && !t.members.some((m) => m.player_id === s.player_id)
          ? { ...t, members: [...t.members, { player_id: s.player_id, nickname: s.nickname, position: '', _new: true }] }
          : t
      ),
    }));
    setMemberPick((p) => ({ ...p, [teamId]: '' }));
  };

  const removeMember = (teamId, playerId) =>
    setDraft((d) => ({
      ...d,
      teams: d.teams.map((t) => (t.id === teamId ? { ...t, members: t.members.filter((m) => m.player_id !== playerId) } : t)),
    }));

  const patchMember = (teamId, playerId, position) =>
    setDraft((d) => ({
      ...d,
      teams: d.teams.map((t) =>
        t.id === teamId
          ? { ...t, members: t.members.map((m) => (m.player_id === playerId ? { ...m, position } : m)) }
          : t
      ),
    }));

  const patchMatch = (matchId, patch) =>
    setDraft((d) => ({ ...d, matches: d.matches.map((m) => (m.id === matchId ? { ...m, ...patch } : m)) }));

  const addMatch = () => {
    const { team_a_id, team_b_id, round_id } = newMatch;
    if (!team_a_id || !team_b_id) {
      setMsg({ type: 'err', text: '请选择对阵双方队伍' });
      return;
    }
    if (team_a_id === team_b_id) {
      setMsg({ type: 'err', text: 'A 队和 B 队不能是同一支队伍' });
      return;
    }
    const ta = draft.teams.find((t) => t.id === team_a_id);
    const tb = draft.teams.find((t) => t.id === team_b_id);
    if (!ta || !tb || ta._new || tb._new) {
      setMsg({ type: 'err', text: '新队伍还没有保存，请先点「保存修改」再编排对阵' });
      return;
    }
    setDraft((d) => ({
      ...d,
      matches: [
        ...d.matches,
        {
          id: TEMP_PREFIX + Date.now(),
          round_id: round_id || '',
          team_a_id,
          team_b_id,
          team_a_name: ta.name,
          team_b_name: tb.name,
          team_a_score: '',
          team_b_score: '',
          winner_team_id: '',
          is_grudge: false,
          _new: true,
        },
      ],
    }));
    setNewMatch({ round_id: round_id || '', team_a_id: '', team_b_id: '' });
  };

  const removeMatch = (matchId) => setDraft((d) => ({ ...d, matches: d.matches.filter((m) => m.id !== matchId) }));

  // 老赛季的队伍成员可能是报名名单功能上线前录的，名单里查不到。
  // 提供一键补录，省得管理员对着 40 个人手动加一遍。
  const missingMembers = useMemo(() => {
    if (!draft) return [];
    const signed = new Set(draft.signups.map((s) => s.player_id));
    const map = new Map();
    draft.teams.forEach((t) =>
      t.members.forEach((m) => {
        if (!signed.has(m.player_id) && !map.has(m.player_id)) map.set(m.player_id, m);
      })
    );
    return [...map.values()];
  }, [draft]);

  const backfillMembers = () => {
    setDraft((d) => {
      const signed = new Set(d.signups.map((s) => s.player_id));
      const extra = [];
      d.teams.forEach((t) =>
        t.members.forEach((m) => {
          if (signed.has(m.player_id) || extra.some((x) => x.player_id === m.player_id)) return;
          extra.push({
            player_id: m.player_id,
            nickname: m.nickname,
            game_id: '',
            score: '',
            positions: '',
            region: '',
            is_captain: false,
            _new: true,
          });
        })
      );
      return { ...d, signups: [...d.signups, ...extra] };
    });
    setMsg({ type: 'ok', text: `已把 ${missingMembers.length} 名队伍成员加入草稿名单，点「保存修改」后生效` });
  };

  // 报名快照缺漏一键补全：快照里空着的 分数/位置/地区，用选手档案当前值补上。
  // 只补空字段，不覆盖管理员已录的值；走草稿 diff，点「保存修改」才落库。
  // （档案里也没有的字段保持为空，提示里会说明。）
  const backfillFromProfile = () => {
    if (!draft) return;
    let filled = 0;
    const next = draft.signups.map((s) => {
      const patch = {};
      const scoreEmpty = String(s.score ?? '').trim() === '' || Number(s.score) === 0;
      if (scoreEmpty && String(s.profile_score ?? '').trim() !== '') patch.score = String(s.profile_score);
      if (!String(s.positions || '').trim() && String(s.profile_positions || '').trim()) patch.positions = s.profile_positions;
      if (!String(s.region || '').trim() && String(s.profile_region || '').trim()) patch.region = s.profile_region;
      if (Object.keys(patch).length === 0) return s;
      filled += 1;
      return { ...s, ...patch };
    });
    setDraft((d) => ({ ...d, signups: next }));
    setMsg(
      filled > 0
        ? { type: 'ok', text: `已按选手档案补全 ${filled} 人的缺漏信息，点「保存修改」后生效` }
        : { type: 'ok', text: '没有可补的缺漏（缺漏项在选手档案里也是空的）' }
    );
  };

  /* ---------- 保存 / 放弃 ---------- */

  const saveAll = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setMsg(null);
    setSaveProgress(`0/${plan.ops.length}`);
    try {
      for (let i = 0; i < plan.ops.length; i += 1) {
        const op = plan.ops[i];
        setSaveProgress(`${i + 1}/${plan.ops.length} · ${op.label}`);
        // 每步都走 api-client，15s 无响应就会抛 TimeoutError，不会无限转圈
        await op.run();
      }
      // 保存成功后重新拉一遍：新建队伍的 id、队长自动建的队伍都要以服务端为准
      await load();
      setMsg({ type: 'ok', text: `已保存 ${plan.ops.length} 项修改` });
    } catch (e) {
      setMsg({ type: 'err', text: `保存中断：${e.message}。已保存的部分不会回滚，请刷新后核对再继续。` });
    } finally {
      setSaving(false);
      setSaveProgress('');
    }
  };

  const discard = () => {
    if (!baseline) return;
    if (!window.confirm('放弃所有未保存的修改，恢复到上次保存的状态？')) return;
    setDraft(clone(baseline));
    setMsg({ type: 'ok', text: '已放弃未保存的修改' });
  };

  /* ---------- 赛程阶段（独立动作，立即落库） ---------- */

  const addRound = async () => {
    if (!newRoundName.trim() || roundBusy) return;
    setRoundBusy(true);
    setMsg(null);
    try {
      const created = await apiPost('/api/tournaments/' + id + '/matches', {
        type: 'round',
        name: newRoundName.trim(),
        order_no: (draft?.rounds || []).length,
      });
      const round = created?.round;
      // 只把新阶段塞进内存，不重新 load()——否则会把用户还没保存的草稿冲掉
      if (round) {
        setBaseline((b) => (b ? { ...b, rounds: [...b.rounds, round] } : b));
        setDraft((d) => (d ? { ...d, rounds: [...d.rounds, round] } : d));
      }
      setNewRoundName('');
      setMsg({ type: 'ok', text: '阶段已创建' });
    } catch (e) {
      setMsg({ type: 'err', text: '创建阶段失败：' + e.message });
    } finally {
      setRoundBusy(false);
    }
  };

  /* 阶段改名：只改名字，不动对阵。以前写歪了只能删掉重建，
     而删阶段会连带删掉它下面的所有对阵 —— 改个错字代价太大。 */
  const renameRound = async (rd) => {
    if (roundBusy) return;
    const next = window.prompt(`「${rd.name}」改成什么？`, rd.name);
    if (next === null) return;
    const nm = String(next).trim();
    if (!nm || nm === rd.name) return;

    setRoundBusy(true);
    setMsg(null);
    try {
      await apiPut('/api/tournaments/' + id + '/matches', { roundId: rd.id, name: nm });
      const apply = (list) =>
        list ? list.map((x) => (String(x.id) === String(rd.id) ? { ...x, name: nm } : x)) : list;
      setBaseline((b) => (b ? { ...b, rounds: apply(b.rounds) } : b));
      setDraft((d) => (d ? { ...d, rounds: apply(d.rounds) } : d));
      setMsg({ type: 'ok', text: `阶段名改成「${nm}」了` });
    } catch (e) {
      setMsg({ type: 'err', text: '改名失败：' + e.message });
    } finally {
      setRoundBusy(false);
    }
  };

  /* 删阶段：后端会先删这一轮的对阵再删阶段，所以确认框里必须把场次数说出来 */
  const removeRound = async (rd, matchCount) => {
    if (roundBusy) return;
    const ok = window.confirm(
      `删掉阶段「${rd.name}」？\n\n` +
        (matchCount > 0
          ? `这一轮里的 ${matchCount} 场对阵会一起删掉，比分也没了。\n`
          : '这一轮现在还没有对阵。\n') +
        '不可恢复。'
    );
    if (!ok) return;

    setRoundBusy(true);
    setMsg(null);
    try {
      await apiDelete('/api/tournaments/' + id + '/matches', { roundId: rd.id });
      const keep = (list) => (list ? list.filter((x) => String(x.id) !== String(rd.id)) : list);
      const keepMatches = (list) =>
        (list || []).filter((m) => String(m.round_id) !== String(rd.id));
      setBaseline((b) => (b ? { ...b, rounds: keep(b.rounds), matches: keepMatches(b.matches) } : b));
      setDraft((d) => (d ? { ...d, rounds: keep(d.rounds), matches: keepMatches(d.matches) } : d));
      setMsg({ type: 'ok', text: `已删掉阶段「${rd.name}」` });
    } catch (e) {
      setMsg({ type: 'err', text: '删除失败：' + e.message });
    } finally {
      setRoundBusy(false);
    }
  };

  /* ---------- 权限门 ---------- */

  if (denied) return <AdminDenied hint="赛事管理只给管理员开。" />;
  if (!ready) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (!me) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        得先 <Link href="/login?from=/admin" style={{ color: 'var(--brand)' }}>登录</Link>
      </div>
    );
  }
  if (!isAdmin) return <AdminDenied hint="你现在登录的账号不是管理员。" />;

  if (loading && !draft) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (error && !draft) return <div className="empty" style={{ padding: '110px 0' }}>{error}</div>;
  if (!draft) return <div className="empty" style={{ padding: '110px 0' }}>赛事不存在</div>;

  const { info, signups, teams, rounds, matches } = draft;
  const signedIds = new Set(signups.map((s) => s.player_id));
  const allTeamMemberIds = new Set(teams.flatMap((t) => t.members.map((m) => m.player_id)));
  const candidateOptions = candidates.filter((c) => !signedIds.has(String(c.id)));

  // ===== 补录辅助：报名缺漏 & 队伍缺人（对齐群友管理的「标注缺失」体验） =====
  // 快照缺漏口径：分数为空或 0（与接口 NULLIF(x,0) 口径一致）、位置为空、地区为空
  const signupIssues = (s) => {
    const miss = [];
    if (String(s.score ?? '').trim() === '' || Number(s.score) === 0) miss.push('分数');
    if (!String(s.positions || '').trim()) miss.push('位置');
    if (!String(s.region || '').trim()) miss.push('地区');
    return miss;
  };
  const issueSignups = signups.filter((s) => signupIssues(s).length > 0);
  const shownSignups = onlyIssues ? issueSignups : signups;
  // 标准阵容 5 人：不满 5 人的队伍标记「缺人」，方便对着报名名单补
  const shortTeams = teams.filter((t) => t.members.length < 5);

  // 某支队伍还能加谁：在报名名单里、但还没进任何队伍
  const availableForTeam = (teamId) => {
    const team = teams.find((t) => t.id === teamId);
    const inThis = new Set((team?.members || []).map((m) => m.player_id));
    return signups.filter((s) => !inThis.has(s.player_id) && !allTeamMemberIds.has(s.player_id));
  };

  return (
    <AdminShell
      title={info.name || '未命名赛事'}
      active="tournaments"
      lead="这一届的报名、队伍、赛程都在下面。改完点上面的「保存修改」才写进库。"
      actions={
        <>
          {/* 单赛事整包导入 / 导出 / 模板（管理员）：赛事信息 + 报名 + 队伍 + 对阵 */}
          <TournamentPackageIO
            tid={id}
            data={draft}
            tournamentName={info.name}
            onImported={load}
            guard={() => {
              if (!dirty) return true;
              return window.confirm(
                `当前有 ${dirtyCount} 处未保存的修改。\n\n` +
                  '导入会直接写入服务器并刷新页面，这些未保存的修改会丢失。\n' +
                  '建议先「保存修改」再导入。仍要继续吗？'
              );
            }}
          />
        </>
      }
      preview={{ href: '/tournaments/' + id, label: '看前台' }}
    >
    {/* 未保存提示条：改动全部先落在本地，点这里的按钮才同步云端 */}
    <div className={'adm-savebar' + (dirty ? ' is-dirty' : '')}>
      <span className={'adm-dirty-badge' + (dirty ? '' : ' is-clean')}>
        {dirty ? `未保存修改 ${dirtyCount} 处` : '已全部保存'}
      </span>
      <span className="adm-savebar-text">
        {dirty
          ? plan.groups.map((g) => `${g.label} ${g.count}`).join(' · ')
          : '编辑只改本地草稿，不会自动同步'}
      </span>
      <div className="adm-savebar-spacer" />
      <button className="btn btn-ghost" onClick={discard} disabled={!dirty || saving}>
        放弃修改
      </button>
      <button className="btn btn-primary" onClick={saveAll} disabled={!dirty || saving}>
        {saving ? (
          <>
            <span className="spinner" />
            保存中…{saveProgress ? ` ${saveProgress}` : ''}
          </>
        ) : (
          '保存修改'
        )}
      </button>
    </div>

    {msg && <div className={msg.type === 'err' ? 'adm-error' : 'adm-msg'}>{msg.text}</div>}
    {error && draft && <div className="adm-error">{error}</div>}

    {/* ---------- 赛事信息 ---------- */}
    <div className="side-card" style={{ marginBottom: 18 }}>
      <div className="adm-block-title">赛季信息</div>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className={'form-field' + (String(baseline.info.name ?? '') !== String(info.name ?? '') ? ' adm-dirty-field' : '')}>
          <label>赛季名称</label>
          <input value={info.name} onChange={(e) => patchInfo('name', e.target.value)} />
        </div>
        <div className={'form-field' + (baseline.info.status !== info.status ? ' adm-dirty-field' : '')}>
          <label>比赛状态</label>
          <select value={info.status} onChange={(e) => patchInfo('status', e.target.value)}>
            {STATUS_LIST.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className={'form-field' + (baseline.info.start_date !== info.start_date ? ' adm-dirty-field' : '')}>
          <label>开始日期</label>
          <input type="date" value={info.start_date} onChange={(e) => patchInfo('start_date', e.target.value)} />
        </div>
        <div className={'form-field' + (baseline.info.end_date !== info.end_date ? ' adm-dirty-field' : '')}>
          <label>结束日期</label>
          <input type="date" value={info.end_date} onChange={(e) => patchInfo('end_date', e.target.value)} />
        </div>
      </div>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className={'form-field' + (baseline.info.sponsor_info !== info.sponsor_info ? ' adm-dirty-field' : '')}>
          <label>赞助信息</label>
          <input value={info.sponsor_info} onChange={(e) => patchInfo('sponsor_info', e.target.value)} />
        </div>
        <div className={'form-field' + (baseline.info.champion_prize !== info.champion_prize ? ' adm-dirty-field' : '')}>
          <label>冠军奖金</label>
          <input value={info.champion_prize} onChange={(e) => patchInfo('champion_prize', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className={'form-field' + (baseline.info.runner_up_prize !== info.runner_up_prize ? ' adm-dirty-field' : '')}>
          <label>亚军奖金</label>
          <input value={info.runner_up_prize} onChange={(e) => patchInfo('runner_up_prize', e.target.value)} />
        </div>
      </div>
    </div>

    {/* ---------- 分区 ---------- */}
    <div className="adm-tabs" style={{ marginBottom: 14 }}>
      <button className={`adm-tab ${tab === 'signups' ? 'active' : ''}`} onClick={() => setTab('signups')}>
        报名名单（{signups.length}）
      </button>
      <button className={`adm-tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
        队伍与队长（{teams.length}）
      </button>
      <button className={`adm-tab ${tab === 'matches' ? 'active' : ''}`} onClick={() => setTab('matches')}>
        赛程与结果（{matches.length}）
      </button>
    </div>

    {/* ---------- 报名名单 ---------- */}
    {tab === 'signups' && (
      <div>
        {/* 缺漏统计 + 过滤 + 一键补全（对齐群友管理的「标注缺失」） */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <span className="adm-hint">
            报名 {signups.length} 人 · 信息缺漏 <strong style={{ color: issueSignups.length > 0 ? 'var(--accent, #C0392B)' : 'inherit' }}>{issueSignups.length}</strong> 人
          </span>
          {issueSignups.length > 0 && (
            <>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.82rem' }}>
                <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
                只看有缺漏
              </label>
              <button className="btn btn-ghost" onClick={backfillFromProfile}>
                从选手档案补全缺漏（{issueSignups.length} 人）
              </button>
            </>
          )}
        </div>
        <div className="adm-table">
          <div className="adm-row adm-row-signup adm-head">
            <div>选手</div>
            <div>分数</div>
            <div>擅长位置</div>
            <div>地区</div>
            <div>队长</div>
            <div>操作</div>
          </div>
          {shownSignups.map((s) => {
            const base = baseline.signups.find((x) => x.player_id === s.player_id);
            const rowDirty =
              !base ||
              SIGNUP_EDIT_FIELDS.some((f) => String(base[f] ?? '') !== String(s[f] ?? '')) ||
              base.is_captain !== s.is_captain;
            const miss = signupIssues(s);
            return (
              <div className={'adm-row adm-row-signup' + (rowDirty ? ' adm-dirty-row' : '')} key={s.player_id} data-focus={s.player_id}>
                <div className="adm-name">
                  {s.nickname}
                  {s._new && <span className="adm-dirty-badge" style={{ marginLeft: 6 }}>待保存</span>}
                  {miss.length > 0 && (
                    <span className="adm-dirty-badge" style={{ marginLeft: 6, color: 'var(--accent, #C0392B)' }}>
                      缺 {miss.join('/')}
                    </span>
                  )}
                </div>
                <div>
                  <input
                    className="adm-input adm-input-sm"
                    type="number"
                    min="0"
                    value={s.score}
                    onChange={(e) => patchSignup(s.player_id, 'score', e.target.value)}
                  />
                </div>
                <div>
                  {/* 位置用多选下拉：行内空间有限，平铺 6 个 chip 会撑破列宽 */}
                  <MultiSelectFilter
                    label="本届位置"
                    allLabel="未标注"
                    unit="人"
                    options={POSITIONS.map((p) => ({ value: p }))}
                    value={splitList(s.positions)}
                    onChange={(next) => patchSignup(s.player_id, 'positions', next.join(','))}
                  />
                </div>
                <div>
                  <input
                    className="adm-input"
                    value={s.region}
                    placeholder="国家 省 市 区"
                    title="格式：国家 省 市 区，例如「中国 广东省 深圳市 南山区」。点上方「从档案补全缺漏」可直接沿用档案里的值。"
                    onChange={(e) => patchSignup(s.player_id, 'region', e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.82rem' }}>
                    <input
                      type="checkbox"
                      checked={s.is_captain}
                      onChange={() => toggleCaptain(s.player_id)}
                    />
                    队长
                  </label>
                </div>
                <div>
                  <button className="adm-link-btn adm-danger-btn" onClick={() => removeSignup(s.player_id)}>
                    移出名单
                  </button>
                </div>
              </div>
            );
          })}
          {signups.length === 0 && <div className="adm-empty-inline" style={{ padding: 16 }}>还没人报名，从下面加</div>}
        </div>

        <div className="adm-add-row">
          <PlayerSearchSelect
            value={addPlayerId}
            onChange={setAddPlayerId}
            options={candidateOptions.map((c) => ({
              id: c.id,
              label: c.nickname || c.group_nickname || '未命名',
              sub: `${c.score || 0} 分${c.game_id ? ` · Steam ${c.game_id}` : ''}${c.group_nickname && c.group_nickname !== (c.nickname || '') ? ` · ${c.group_nickname}` : ''}`,
            }))}
            placeholder="搜索选手加入名单（昵称 / SteamID）…"
            onCreate={(name) => openNewPlayer(name)}
          />
          <button className="btn btn-ghost" onClick={addSignup} disabled={!addPlayerId}>
            ＋ 加入名单
          </button>
          <button className="btn btn-ghost" onClick={() => openNewPlayer('')}>
            ＋ 新建选手
          </button>
          {missingMembers.length > 0 && (
            <button className="btn btn-ghost" onClick={backfillMembers}>
              补录队伍成员进名单（{missingMembers.length} 人）
            </button>
          )}
          <span className="adm-hint">
            勾选「队长」保存后会自动建队并把人加进去。共 {candidateOptions.length} 名选手可加入。
          </span>
        </div>
      </div>
    )}

    {/* ---------- 队伍与队长 ---------- */}
    {tab === 'teams' && (
      <div>
        <div className="adm-hint" style={{ marginBottom: 10 }}>
          共 {teams.length} 队
          {shortTeams.length > 0 ? (
            <> · <strong style={{ color: 'var(--accent, #C0392B)' }}>{shortTeams.length}</strong> 队不满 5 人（{shortTeams.map((t) => t.name || '未命名').join('、')}），可从下方名单补人</>
          ) : (
            ' · 全部满员'
          )}
        </div>
        {teams.map((t) => {
          const base = baseline.teams.find((x) => x.id === t.id);
          const nameDirty = base ? base.name !== t.name : t._new;
          const rankDirty = base ? String(base.rank ?? '') !== String(t.rank ?? '') : t._new;
          const pool = availableForTeam(t.id);
          return (
            <div className="side-card" key={t.id} style={{ marginBottom: 16 }} data-focus={t.id}>
              <div className="adm-team-head">
                <input
                  className={'adm-input' + (nameDirty ? ' adm-dirty-field' : '')}
                  value={t.name}
                  placeholder="队伍名称"
                  onChange={(e) => patchTeam(t.id, { name: e.target.value })}
                />
                {t._new && <span className="adm-dirty-badge">待保存</span>}
                <span className="adm-captain-tag">队长 {t.captain_nickname || '—'}</span>
                <span
                  className="adm-captain-tag"
                  style={t.members.length < 5 ? { color: 'var(--accent, #C0392B)', borderColor: 'var(--accent, #C0392B)' } : undefined}
                >
                  队员 {t.members.length}/5{t.members.length < 5 ? ' · 缺人' : ''}
                </span>
                <div className="adm-team-rank">
                  <label>名次</label>
                  <select
                    className={rankDirty ? 'adm-dirty-field' : ''}
                    value={t.rank}
                    onChange={(e) => patchTeam(t.id, { rank: e.target.value })}
                  >
                    <option value="">未定</option>
                    <option value="1">冠军</option>
                    <option value="2">亚军</option>
                    <option value="3">季军</option>
                    {[4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={String(n)}>第 {n} 名</option>
                    ))}
                  </select>
                  <button className="adm-link-btn adm-danger-btn" onClick={() => removeTeam(t.id)}>
                    删除队伍
                  </button>
                </div>
              </div>

              {t.members.length > 0 ? (
                <div className="adm-table" style={{ marginTop: 12 }}>
                  <div className="adm-row adm-row-member adm-head">
                    <div>队员</div>
                    <div>担任位置</div>
                    <div>选手ID</div>
                    <div>操作</div>
                  </div>
                  {t.members.map((m) => {
                    const bm = base?.members.find((x) => x.player_id === m.player_id);
                    const mDirty = !bm || (bm.position || '') !== (m.position || '');
                    return (
                      <div className={'adm-row adm-row-member' + (mDirty ? ' adm-dirty-row' : '')} key={m.player_id}>
                        <div className="adm-name">
                          {m.nickname}
                          {m._new && <span className="adm-dirty-badge" style={{ marginLeft: 6 }}>新增</span>}
                        </div>
                        <div>
                          <select value={m.position} onChange={(e) => patchMember(t.id, m.player_id, e.target.value)}>
                            <option value="">未标注</option>
                            {POSITION_OPTIONS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </div>
                        <div className="adm-date">{m.player_id}</div>
                        <div>
                          <button className="adm-link-btn adm-danger-btn" onClick={() => removeMember(t.id, m.player_id)}>
                            移出队伍
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="adm-empty-inline">还没人</div>
              )}

              <div className="adm-add-row">
                <PlayerSearchSelect
                  value={memberPick[t.id] || ''}
                  onChange={(v) => setMemberPick((p) => ({ ...p, [t.id]: v }))}
                  options={pool.map((s) => ({
                    id: s.player_id,
                    label: s.nickname || s.group_nickname || '未命名',
                    sub: s.positions || '未标注位置',
                  }))}
                  placeholder={
                    signups.length === 0
                      ? '报名名单还是空的，先去「报名名单」加人'
                      : pool.length === 0
                      ? '报名名单里的人都已经分好队了'
                      : '搜索报名名单里的队员…'
                  }
                  disabled={pool.length === 0}
                />
                <button className="btn btn-ghost" onClick={() => addMember(t.id)} disabled={!memberPick[t.id]}>
                  ＋ 添加队员
                </button>
              </div>
            </div>
          );
        })}

        <button className="btn btn-ghost" onClick={addTeam}>＋ 新建队伍</button>
        {teams.length === 0 && (
          <div className="adm-hint" style={{ marginTop: 10 }}>
            还没有队伍。可以直接新建队伍，也可以在报名名单里勾选「队长」保存，系统会自动建队。
          </div>
        )}
      </div>
    )}

    {/* ---------- 赛程与结果 ---------- */}
    {tab === 'matches' && (
      <div>
        <div className="side-card" style={{ marginBottom: 18 }}>
          <div className="adm-block-title">赛程编排</div>
          {teams.length === 0 && <div className="adm-empty-inline">还没队伍，先去「队伍与队长」建几支</div>}
          {teams.length > 0 && (
            <>
              <div className="form-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
                <div className="form-field">
                  <label>新阶段名</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={newRoundName}
                      onChange={(e) => setNewRoundName(e.target.value)}
                      placeholder="例如 淘汰赛 / 半决赛 / 决赛"
                    />
                    <button className="btn btn-primary" onClick={addRound} disabled={roundBusy || !newRoundName.trim()}>
                      {roundBusy ? <><span className="spinner" />创建中…</> : '＋ 阶段'}
                    </button>
                  </div>
                </div>
                <div className="form-field">
                  <label>所属阶段</label>
                  <select value={newMatch.round_id} onChange={(e) => setNewMatch({ ...newMatch, round_id: e.target.value })}>
                    <option value="">— 不分组 —</option>
                    {rounds.map((rd) => (
                      <option key={rd.id} value={String(rd.id)}>{rd.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 已有阶段：改名 / 删掉。以前只能在「新阶段名」里再建一个，
                  建错了没法收拾 —— 名字写歪了只能连对阵一起删掉重建。 */}
              {rounds.length > 0 && (
                <div className="adm-rounds">
                  <span className="adm-rounds-label">已有阶段</span>
                  {rounds.map((rd) => {
                    const n = matches.filter((m) => String(m.round_id) === String(rd.id)).length;
                    return (
                      <span className="adm-rounds-item" key={rd.id}>
                        <span className="adm-rounds-name">{rd.name}</span>
                        <span className="adm-rounds-count">{n} 场</span>
                        <button
                          type="button"
                          className="adm-link-btn"
                          onClick={() => renameRound(rd)}
                          disabled={roundBusy}
                        >
                          改名
                        </button>
                        <button
                          type="button"
                          className="adm-link-btn"
                          onClick={() => removeRound(rd, n)}
                          disabled={roundBusy}
                        >
                          删掉
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="form-row" style={{ marginBottom: 4, alignItems: 'flex-end' }}>
                <div className="form-field">
                  <label>A 队</label>
                  <select value={newMatch.team_a_id} onChange={(e) => setNewMatch({ ...newMatch, team_a_id: e.target.value })}>
                    <option value="">选择队伍</option>
                    {teams.filter((t) => !t._new).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>B 队</label>
                  <select value={newMatch.team_b_id} onChange={(e) => setNewMatch({ ...newMatch, team_b_id: e.target.value })}>
                    <option value="">选择队伍</option>
                    {teams.filter((t) => !t._new).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  {/* alignSelf 防止 .btn 被 .form-field 拉成整行宽 */}
                  <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={addMatch}>
                    ＋ 对阵
                  </button>
                </div>
              </div>
              <div className="adm-hint">
                「＋ 阶段」会立即写入云端；「＋ 对阵」只是加入草稿，需点顶部「保存修改」才生效。
                未保存的新队伍不会出现在这里。
              </div>
            </>
          )}
        </div>

        <div className="adm-table">
          <div className="adm-row adm-row-match adm-head">
            <div>阶段</div>
            <div>对阵</div>
            <div>比分</div>
            <div>胜者</div>
            <div>恩怨</div>
            <div>操作</div>
          </div>
          {matches.map((m) => {
            const base = baseline.matches.find((x) => x.id === m.id);
            const rd = rounds.find((r) => String(r.id) === String(m.round_id));
            const mDirty =
              !base ||
              String(base.team_a_score ?? '') !== String(m.team_a_score ?? '') ||
              String(base.team_b_score ?? '') !== String(m.team_b_score ?? '') ||
              String(base.winner_team_id ?? '') !== String(m.winner_team_id ?? '');
            const options = [
              { id: m.team_a_id, name: m.team_a_name },
              { id: m.team_b_id, name: m.team_b_name },
            ].filter((o) => o.id);
            return (
              <div className={'adm-row adm-row-match' + (mDirty ? ' adm-dirty-row' : '')} key={m.id}>
                <div className="adm-date">{rd ? rd.name : '—'}</div>
                <div className="adm-name">
                  {m.team_a_name || '?'} vs {m.team_b_name || '?'}
                  {m._new && <span className="adm-dirty-badge" style={{ marginLeft: 6 }}>待保存</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="adm-input"
                    type="number"
                    min="0"
                    value={m.team_a_score}
                    placeholder="—"
                    style={{ width: 52 }}
                    onChange={(e) => patchMatch(m.id, { team_a_score: e.target.value })}
                  />
                  <span>:</span>
                  <input
                    className="adm-input"
                    type="number"
                    min="0"
                    value={m.team_b_score}
                    placeholder="—"
                    style={{ width: 52 }}
                    onChange={(e) => patchMatch(m.id, { team_b_score: e.target.value })}
                  />
                </div>
                <div>
                  <select value={m.winner_team_id} onChange={(e) => patchMatch(m.id, { winner_team_id: e.target.value })}>
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>{m.is_grudge ? <span className="grudge-tag">⚔</span> : '—'}</div>
                <div>
                  <button className="adm-link-btn adm-danger-btn" onClick={() => removeMatch(m.id)}>
                    删除
                  </button>
                </div>
              </div>
            );
          })}
          {matches.length === 0 && <div className="adm-empty-inline" style={{ padding: 16 }}>还没有对阵，在上面排一场</div>}
        </div>
      </div>
    )}
      {/* ---------- 新建选手弹窗 ---------- */}
      {showNewPlayer && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget && !npSaving) setShowNewPlayer(false); }}>
          <div className="modal-card modal-card-sm" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>新建选手</h3>
              <button className="modal-close" onClick={() => !npSaving && setShowNewPlayer(false)} aria-label="关闭">×</button>
            </div>
            <div className="modal-hint">
              建档后自动加入本赛事报名草稿，点页面底部「保存修改」正式写入名单。SteamID 填了才能在后续赛事里按身份认出本人。
            </div>
            <div className="modal-body" style={{ padding: '16px 22px', overflow: 'auto' }}>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-field">
                  <label>昵称（必填）</label>
                  <input
                    value={npForm.nickname}
                    autoFocus
                    placeholder="如：学徒"
                    onChange={(e) => setNpForm((f) => ({ ...f, nickname: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label>SteamID</label>
                  <input
                    value={npForm.game_id}
                    placeholder="纯数字，如 113529567"
                    onChange={(e) => setNpForm((f) => ({ ...f, game_id: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-field">
                  <label>群昵称</label>
                  <input
                    value={npForm.group_nickname}
                    placeholder="留空则与昵称相同"
                    onChange={(e) => setNpForm((f) => ({ ...f, group_nickname: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label>天梯分</label>
                  <input
                    type="number"
                    value={npForm.score}
                    placeholder="如 5000"
                    onChange={(e) => setNpForm((f) => ({ ...f, score: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-field">
                  <label>常玩位置</label>
                  <input
                    value={npForm.positions}
                    placeholder="逗号分隔，如：劣势路,半辅助"
                    onChange={(e) => setNpForm((f) => ({ ...f, positions: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label>地区</label>
                  <input
                    value={npForm.region}
                    placeholder="国家 省 市 区（可留空）"
                    onChange={(e) => setNpForm((f) => ({ ...f, region: e.target.value }))}
                  />
                </div>
              </div>
              {npError && <div className="adm-error">{npError}</div>}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowNewPlayer(false)} disabled={npSaving}>
                取消
              </button>
              <button className="btn btn-primary" onClick={submitNewPlayer} disabled={npSaving || !String(npForm.nickname).trim()}>
                {npSaving ? (
                  <>
                    <span className="spinner" />
                    建档中…
                  </>
                ) : (
                  '建档并加入报名草稿'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
