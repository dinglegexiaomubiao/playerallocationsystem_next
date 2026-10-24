import { useCallback, useEffect, useState } from 'react';
import GuildModal from './GuildModal';

/**
 * 「帮派管理」按钮 —— 帮派主页上的管理入口。
 *
 * 为什么不直接把 GuildPanel 搬到详情页：GuildPanel 是「我的帮派」整块（含创建引导、
 * 待处理邀请、退出），详情页只需要一个按钮加一个弹窗。搬过去会出现两套「退出帮派」。
 *
 * 数据自己拉 GET /api/guild：管理弹窗需要 colors（已被占用的配色要置灰）和 sentInvites
 * （「已邀请」状态与撤回），这两个字段只有那个接口给。一个接口拿全，省一次往返。
 *
 * 非帮主不渲染任何东西 —— 成员在帮派页能退出，详情页不需要第二个入口。
 */
export default function GuildManageButton({ guildId, onChanged }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guild', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success) setData(d);
    } catch {
      /* 拉不到就当没权限，不渲染按钮 —— 静默比弹错误更合适 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 必须是「我当前所在的这个帮派」才出按钮：URL 里可能是别人的帮派
  const guild = data && data.guild && Number(data.guild.id) === Number(guildId) ? data.guild : null;
  if (!guild || !guild.isLeader) return null;

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        帮派管理
      </button>
      <GuildModal
        open={open}
        mode="manage"
        guild={guild}
        colors={data.colors || {}}
        sentInvites={data.sentInvites || []}
        onClose={() => setOpen(false)}
        onSaved={() => {
          load();
          // 改了名字 / 解散之后，SSR 出来的标题和成员列表都旧了，让父级重新取一次
          if (onChanged) onChanged();
        }}
      />
    </>
  );
}
