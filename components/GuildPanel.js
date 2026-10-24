import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import GuildModal from './GuildModal';
import { guildColor, GUILD_ALPHA_START, GUILD_ALPHA_END, GUILD_BORDER_ALPHA, hexToRgba } from '../lib/guild-colors.mjs';

/**
 * 帮派区块。两个地方用，靠 variant 区分外壳：
 *   block（默认）个人信息页「基本信息」里的一小块
 *   page        /guilds 页顶部的操作区，宽容器、标题叫「我的帮派」
 *
 * 数据自己拉（GET /api/guild），不依赖 profile 接口的 guild 字段 ——
 * 那个字段是给「不需要配色占用表」的场景用的，这里要额外拿 colors.used
 * 才能把已被占用的配色置灰。一个接口拿全，省一次往返。
 *
 * 五种状态都要照顾到，少一种就会显示成空白：
 *   加载中 / 未绑定选手 / 未加入帮派 / 已加入（帮主 or 成员）/ 有待处理邀请
 */
export default function GuildPanel({ variant = 'block', label = '帮派', onChanged }) {
  const isPage = variant === 'page';
  const rootCls = 'guild-block' + (isPage ? ' guild-block-page' : '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 未登录 ≠ 出错。帮派页是公开的，匿名访客会拿到 401，
  // 这时候该给「登录」按钮，而不是一个带「重试」的错误框（重试多少次都还是 401）
  const [needLogin, setNeedLogin] = useState(false);
  const [modal, setModal] = useState(null); // null | 'create' | 'manage'
  const [busyInvite, setBusyInvite] = useState(null);
  const [msg, setMsg] = useState('');
  // 退出是破坏性操作，点一次变成「确认退出」，避免手滑
  const [exitConfirm, setExitConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guild', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setNeedLogin(true);
        setError('');
        return;
      }
      if (!r.ok || !d.success) {
        setError(d.error || `加载失败（HTTP ${r.status}）`);
        return;
      }
      setNeedLogin(false);
      setData(d);
      setError('');
    } catch (e) {
      setError((e && e.message) || '网络异常');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 写操作成功后要让外面知道 —— /guilds 的「所有帮派」列表是另一份数据，
  // 不通知它就会「刚建完帮，下面列表里还没有」。
  // 只在写操作后调，初始加载不调，否则会白拉一次列表。
  const changed = () => {
    if (onChanged) onChanged();
  };

  const respond = async (inviteId, action) => {
    if (busyInvite) return;
    setBusyInvite(inviteId);
    setMsg('');
    try {
      const r = await fetch('/api/guild/invites/' + inviteId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setMsg(d.error || '操作失败');
        return;
      }
      setMsg(action === 'accept' ? `已加入「${d.guildName || ''}」` : '已拒绝');
      await load();
      changed();
    } catch (e) {
      setMsg((e && e.message) || '网络异常');
    } finally {
      setBusyInvite(null);
    }
  };

  const leave = async () => {
    setMsg('');
    try {
      const r = await fetch('/api/guild/leave', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setMsg(d.error || '退出失败');
        return;
      }
      setExitConfirm(false);
      setMsg('已退出帮派');
      await load();
      changed();
    } catch (e) {
      setMsg((e && e.message) || '网络异常');
    }
  };

  if (loading) {
    return (
      <div className={rootCls}>
        <div className="guild-block-head">
          <span className="guild-block-label">{label}</span>
        </div>
        <div className="guild-block-hint">加载中…</div>
      </div>
    );
  }

  if (needLogin) {
    return (
      <div className={rootCls}>
        <div className="guild-block-head">
          <span className="guild-block-label">{label}</span>
        </div>
        <Link href="/login" className="btn btn-primary btn-sm">
          登录
        </Link>
        <div className="guild-block-hint">
          登录之后才能建帮派，或者被帮主拉进去。没账号找管理员要一个。
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={rootCls}>
        <div className="guild-block-head">
          <span className="guild-block-label">{label}</span>
        </div>
        <div className="guild-block-hint">{error}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          重试
        </button>
      </div>
    );
  }

  const guild = data?.guild || null;
  const colors = data?.colors || { used: {}, free: [] };
  const myInvites = data?.myInvites || [];
  const sentInvites = data?.sentInvites || [];
  const bound = !!data?.bound;
  const color = guild ? guildColor(guild.colorKey) : null;

  // 帮派卡片上的薄渐变，和群友卡片同一套参数（0.12 / 0.04）
  const gradient = color
    ? {
        backgroundImage: `linear-gradient(135deg, ${hexToRgba(color.solid, GUILD_ALPHA_START)}, ${hexToRgba(
          color.solid,
          GUILD_ALPHA_END
        )})`,
        borderColor: hexToRgba(color.solid, GUILD_BORDER_ALPHA),
      }
    : undefined;

  return (
    <div className={rootCls}>
      <div className="guild-block-head">
        <span className="guild-block-label">{label}</span>
        {guild && guild.isLeader && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal('manage')}>
            帮派管理
          </button>
        )}
      </div>

      {guild ? (
        <>
          <div className="guild-mini" style={gradient}>
            <span className="guild-mini-dot" style={color ? { background: color.solid } : undefined} />
            <span className="guild-mini-name">{guild.name}</span>
            <span className={'guild-role' + (guild.isLeader ? '' : ' is-member')}>
              {guild.isLeader ? '帮主' : '成员'}
            </span>
          </div>
          {guild.slogan && <div className="guild-mini-slogan">「{guild.slogan}」</div>}
          <div className="guild-block-hint">
            {guild.memberCount} / {guild.maxMembers} 人
            {guild.isLeader && ' · 你可以邀请群友加入'}
          </div>

          {/* 成员可以自己退出；帮主不行（要转让或解散），所以不给他这个按钮 —— 
              给了也会被接口拒绝，不如不出现 */}
          {!guild.isLeader && (
            <div className="guild-mini-actions">
              {exitConfirm ? (
                <>
                  <span className="guild-block-hint">确定要退出吗？</span>
                  <button type="button" className="btn btn-ghost btn-sm guild-danger" onClick={leave}>
                    确认退出
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setExitConfirm(false)}
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExitConfirm(true)}
                >
                  退出帮派
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-sm guild-create-btn"
            disabled={!bound}
            onClick={() => bound && setModal('create')}
          >
            创建帮派
          </button>
          <div className="guild-block-hint">
            {bound
              ? '建一个自己的小团体：起个名字、选一支配色，群友卡片上就会带上你们的颜色。'
              : '先绑定你的群友信息，才能创建帮派（帮派挂在选手档案上，不挂在账号上）。'}
          </div>
        </>
      )}

      {/* 待处理邀请：弹窗关掉之后还应该有地方能看到，否则等于丢了 */}
      {myInvites.length > 0 && (
        <div className="guild-invites">
          <div className="guild-invites-head">待处理邀请（{myInvites.length}）</div>
          {myInvites.map((inv) => {
            const ic = guildColor(inv.guild.colorKey);
            return (
              <div className="guild-invite-row" key={inv.id}>
                <div className="guild-invite-row-top">
                  <span className="guild-mini-dot" style={ic ? { background: ic.solid } : undefined} />
                  <b className="guild-invite-name">{inv.guild.name}</b>
                  <span className="guild-invite-count">
                    {inv.guild.memberCount}/{inv.guild.maxMembers}
                  </span>
                </div>
                <div className="guild-invite-from">{inv.inviterName} 邀请你加入</div>
                {inv.message && <div className="guild-invite-quote">「{inv.message}」</div>}
                <div className="guild-invite-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!!busyInvite}
                    onClick={() => respond(inv.id, 'reject')}
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!!busyInvite}
                    onClick={() => respond(inv.id, 'accept')}
                  >
                    {busyInvite === inv.id ? '处理中…' : '同意加入'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && <div className="guild-block-hint is-pending">{msg}</div>}

      <GuildModal
        open={!!modal}
        mode={modal || 'create'}
        guild={guild}
        colors={colors}
        sentInvites={sentInvites}
        onClose={() => setModal(null)}
        onSaved={() => {
          load();
          changed();
        }}
      />
    </div>
  );
}
