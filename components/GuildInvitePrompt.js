import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import useSession from '../hooks/useSession';
import { guildColor, GUILD_ALPHA_START, GUILD_ALPHA_END, hexToRgba } from '../lib/guild-colors.mjs';

/**
 * 帮派邀请的进站弹窗（挂在 Layout，全站生效）。
 *
 * 三条不打扰的规则，少一条都会被烦到：
 *   1. **同一条邀请只自动弹一次**（记在 localStorage）。否则每刷新一次弹一次，
 *      而且关掉之后还会再弹 —— 用户会觉得这功能坏了。
 *      关掉不等于不理：个人信息页一直有「待处理邀请」入口。
 *   2. 登录页不弹（那页刻意保持干净，连导航都没有）。
 *   3. 多条邀请排队，一次只弹一条；处理完自动接上下一条。
 *
 * ⚠ 状态设计上有一个坑：**不能拿「过滤后的列表」直接渲染**。
 *   useSession 的 me 是对象，每次刷新引用都会变，effect 会重跑、重新 fetch；
 *   如果渲染依赖「列表里第一条未读」，第二次 fetch 时那条已被标记为已读，
 *   列表变空 → 正在显示的弹窗凭空消失（表现为「弹了一下就没了」）。
 *   所以用 `currentId` 记住「这一轮显示哪条」，fetch 只负责更新数据。
 */
const seenKey = (id) => 'dd:guild-invite-seen:' + id;
const hasSeen = (id) => {
  try {
    return localStorage.getItem(seenKey(id)) === '1';
  } catch (e) {
    return false;
  }
};
const markSeen = (id) => {
  try {
    localStorage.setItem(seenKey(id), '1');
  } catch (e) {
    /* 隐私模式下写不进去，退化成「每次弹」也比不弹好 */
  }
};

export default function GuildInvitePrompt() {
  const router = useRouter();
  const { me, ready } = useSession();
  const [invites, setInvites] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guild/invites', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) return;
      setInvites(d.invites || []);
    } catch (e) {
      /* 拿不到就当没有邀请，不该因为这个报错打扰用户 */
    }
  }, []);

  useEffect(() => {
    if (!ready || !me) return;
    if (router.pathname === '/login') return;
    load();
  }, [ready, me, router.pathname, load]);

  // 挑一条该弹的：当前已有就不换；否则找一条没看过的
  useEffect(() => {
    if (currentId) return;
    const next = invites.find((i) => !hasSeen(i.id));
    if (next) {
      setCurrentId(next.id);
      markSeen(next.id);
    }
  }, [invites, currentId]);

  const current = invites.find((i) => i.id === currentId) || null;
  if (!current) return null;

  const c = guildColor(current.guild.colorKey);
  const gradient = c
    ? {
        backgroundImage: `linear-gradient(135deg, ${hexToRgba(c.solid, GUILD_ALPHA_START)}, ${hexToRgba(
          c.solid,
          GUILD_ALPHA_END
        )})`,
        borderColor: hexToRgba(c.solid, 0.42),
      }
    : undefined;

  // 同一批里还有几条没处理过（只用于「还有 N 条」提示）
  const rest = invites.filter((i) => i.id !== current.id && !hasSeen(i.id)).length;

  const next = () => {
    setCurrentId(null);
    setError('');
  };

  const respond = async (action) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/guild/invites/' + current.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setError(d.error || `操作失败（HTTP ${r.status}）`);
        return;
      }
      if (action === 'accept') {
        setDone(`已加入「${d.guildName || current.guild.name}」`);
        // 加入后其它邀请已被服务端作废，这一轮直接结束
        setTimeout(() => {
          setDone('');
          setCurrentId(null);
          setInvites([]);
        }, 1600);
      } else {
        next();
      }
    } catch (e) {
      setError((e && e.message) || '网络异常');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-mask"
      role="dialog"
      aria-modal="true"
      aria-label="帮派邀请"
      onClick={() => !busy && !done && next()}
    >
      <div className="modal-card guild-invite-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            帮派邀请
            {rest > 0 && <span className="guild-modal-count">还有 {rest} 条</span>}
          </h3>
          <button type="button" className="modal-close" aria-label="关闭" onClick={next} disabled={busy}>
            ×
          </button>
        </div>

        <div className="guild-modal-body">
          <div className="guild-invite-head" style={gradient}>
            <span className="guild-mini-dot" style={c ? { background: c.solid } : undefined} />
            <span className="guild-invite-guild">{current.guild.name}</span>
            <span className="guild-invite-count">
              {current.guild.memberCount} / {current.guild.maxMembers} 人
            </span>
          </div>

          {current.guild.slogan && <p className="guild-invite-slogan">「{current.guild.slogan}」</p>}

          <p className="guild-invite-from">
            <b>{current.inviterName}</b> 邀请你加入
          </p>

          {current.message && <blockquote className="guild-invite-msg">{current.message}</blockquote>}

          {done && <div className="guild-msg is-ok">{done}</div>}
          {error && <div className="guild-msg is-error">{error}</div>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => respond('reject')} disabled={busy || !!done}>
            拒绝
          </button>
          <button type="button" className="btn btn-primary" onClick={() => respond('accept')} disabled={busy || !!done}>
            {busy ? '处理中…' : '同意加入'}
          </button>
        </div>
      </div>
    </div>
  );
}
