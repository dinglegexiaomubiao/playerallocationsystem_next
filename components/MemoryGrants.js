import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';

/**
 * 一条回忆的「谁能改文案」名单。
 *
 * 为什么放在卡片里而不是后台：决定「这条让谁来补两句」的人，是看着这张照片的人。
 * 去后台翻表格找 id，再回来对哪条是哪条，这一步纯属自找麻烦。
 *
 * 名单是按需加载的：列表里二十条回忆，没人会把每条的授权都点开一遍，
 * 所以不预取，点开才请求 —— 打开一次几十字节，比首屏多带二十个数组划算。
 */
export default function MemoryGrants({ memoryId }) {
  const [editors, setEditors] = useState(null);
  const [acc, setAcc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setEditors(null);
    setErr('');
    apiFetch(`/api/memories/${memoryId}/editors`)
      .then((r) => {
        if (alive && r && r.success) setEditors(r.editors || []);
        else if (alive) setErr((r && r.error) || '没读出来');
      })
      .catch((e) => {
        if (alive) setErr((e && e.message) || '没读出来');
      });
    return () => {
      alive = false;
    };
  }, [memoryId]);

  const add = async () => {
    const name = acc.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await apiFetch(`/api/memories/${memoryId}/editors`, {
        method: 'POST',
        body: { account: name },
        timeout: 20000,
      });
      if (!r || !r.success) throw new Error((r && r.error) || '没加上');
      setEditors(r.editors || []);
      setAcc('');
    } catch (e) {
      setErr((e && e.message) || '没加上，稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await apiFetch(`/api/memories/${memoryId}/editors`, {
        method: 'DELETE',
        body: { account },
        timeout: 20000,
      });
      if (!r || !r.success) throw new Error((r && r.error) || '没移除');
      setEditors(r.editors || []);
    } catch (e) {
      setErr((e && e.message) || '没移除，稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const list = editors || [];

  return (
    <div className="mem-grants">
      <div className="mem-grants-head">
        <span className="mem-grants-title">这条谁能改文案</span>
        <span className="mem-grants-sub">
          只改字，不能删；你本人和作者始终能改
        </span>
      </div>

      <div className="mem-tagpick">
        {editors === null && !err && <span className="mem-grants-wait">读取中…</span>}

        {list.map((e) => (
          <span key={e.account} className="chip mem-grant" title={`账号 ${e.account}`}>
            {e.nickname || e.account}
            <button
              type="button"
              className="mem-grant-x"
              onClick={() => remove(e.account)}
              disabled={busy}
              aria-label={`把 ${e.nickname || e.account} 移出这条的名单`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          className="mem-grant-input"
          value={acc}
          placeholder="填登录账号，回车加入"
          onChange={(e) => setAcc(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
            if (e.key === 'Escape') setAcc('');
          }}
        />
        <button type="button" className="chip mem-tag-add mem-grant-add" onClick={add} disabled={busy || !acc.trim()}>
          {busy ? '…' : '+ 加入'}
        </button>
        {err && <span className="mem-tag-err">{err}</span>}
      </div>
    </div>
  );
}
