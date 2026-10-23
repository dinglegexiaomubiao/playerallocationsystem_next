import { useCallback, useEffect, useState } from 'react';
import GuildModal from './GuildModal';
import { guildColor, GUILD_ALPHA_START, GUILD_ALPHA_END, hexToRgba } from '../lib/guild-colors.mjs';

/**
 * 个人信息页「基本信息」里的帮派区块。
 *
 * 数据自己拉（GET /api/guild），不依赖 profile 接口的 guild 字段 ——
 * 那个字段是给「不需要配色占用表」的场景用的，这里要额外拿 colors.used
 * 才能把已被占用的配色置灰。一个接口拿全，省一次往返。
 *
 * 四种状态都要照顾到，少一种就会显示成空白：
 *   加载中 / 未绑定选手 / 未加入帮派 / 已加入（帮主 or 成员）
 */
export default function GuildPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // null | 'create' | 'manage'

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guild', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setError(d.error || `加载失败（HTTP ${r.status}）`);
        return;
      }
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

  if (loading) {
    return (
      <div className="guild-block">
        <div className="guild-block-head">
          <span className="guild-block-label">帮派</span>
        </div>
        <div className="guild-block-hint">加载中…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="guild-block">
        <div className="guild-block-head">
          <span className="guild-block-label">帮派</span>
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
  const pending = data?.pendingInvites || 0;
  const bound = !!data?.bound;
  const color = guild ? guildColor(guild.colorKey) : null;

  // 帮派卡片上的薄渐变，和群友卡片同一套参数（0.12 / 0.04）
  const gradient = color
    ? {
        backgroundImage: `linear-gradient(135deg, ${hexToRgba(color.solid, GUILD_ALPHA_START)}, ${hexToRgba(
          color.solid,
          GUILD_ALPHA_END
        )})`,
        borderColor: hexToRgba(color.solid, 0.42),
      }
    : undefined;

  return (
    <div className="guild-block">
      <div className="guild-block-head">
        <span className="guild-block-label">帮派</span>
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
            {!guild.isLeader && ' · 帮主可以移除成员，你也可以随时退出'}
          </div>
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

      {pending > 0 && (
        <div className="guild-block-hint is-pending">
          有 {pending} 个帮派邀请等待处理（在下方「帮派邀请」里查看）
        </div>
      )}

      <GuildModal
        open={!!modal}
        mode={modal || 'create'}
        guild={guild}
        colors={colors}
        onClose={() => setModal(null)}
        onSaved={load}
      />
    </div>
  );
}
