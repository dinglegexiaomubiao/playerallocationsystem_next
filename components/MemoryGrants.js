import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';
import AccountPicker from './AccountPicker';

/**
 * 一条回忆的「谁能改文案（和标签）」名单。
 *
 * 为什么放在卡片里而不是后台：决定「这条让谁来补两句、补个标签」的人，
 * 是看着这张照片的人。去后台翻表格找 id，再回来对哪条是哪条，纯属自找麻烦。
 *
 * 名单是按需加载的：列表里二十条回忆，没人会把每条的授权都点开一遍，
 * 所以不预取，点开才请求 —— 打开一次几十字节，比首屏多带二十个数组划算。
 *
 * 选人控件和发布框共用一个（AccountPicker）：同一件事在两个地方有两种点法，
 * 是最容易让人放弃使用的那类设计。
 */
export default function MemoryGrants({ memoryId }) {
  const [editors, setEditors] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setEditors(null);
    setBusy(false);
    apiFetch(`/api/memories/${memoryId}/editors`)
      .then((r) => {
        if (alive && r && r.success) setEditors(r.editors || []);
      })
      .catch(() => {
        // 读不到名单不影响改文案本身，安静地留一个空面板即可
      });
    return () => {
      alive = false;
    };
  }, [memoryId]);

  const add = async (hit) => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/memories/${memoryId}/editors`, {
        method: 'POST',
        body: { account: hit.account },
        timeout: 20000,
      });
      if (!r || !r.success) throw new Error((r && r.error) || '没加上');
      setEditors(r.editors || []);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account) => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/memories/${memoryId}/editors`, {
        method: 'DELETE',
        body: { account },
        timeout: 20000,
      });
      if (!r || !r.success) throw new Error((r && r.error) || '没移除');
      setEditors(r.editors || []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mem-grants">
      <div className="mem-grants-head">
        <span className="mem-grants-title">这条谁能改</span>
        <span className="mem-grants-sub">
          能改文案和标签，不能删；你本人和作者始终能改
        </span>
      </div>

      {editors === null ? (
        <span className="mem-grants-wait">读取中…</span>
      ) : (
        <AccountPicker
          value={editors}
          onAdd={add}
          onRemove={remove}
          busy={busy}
          placeholder="搜昵称或账号，回车加入"
        />
      )}
    </div>
  );
}
