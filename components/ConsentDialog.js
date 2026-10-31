import { useEffect, useRef, useState } from 'react';

/**
 * 发布前的「出镜同意」确认框。
 *
 * 为什么不用 window.confirm：确认框里要说清三件事（谁会看到、同意指什么、
 * 有人不愿意怎么办），还要一个必须亲手勾的框 —— 浏览器原生对话框只有一段文字
 * 和两个按钮，说不了这些，而且可以一路回车过去。
 *
 * 为什么不只是「提示文字」：提示会被跳过，勾选框不会。
 * 这一层的意义不在拦截，而在于让「有没有问过」变成发布前必须想一次的问题。
 *
 * 服务端还会再判一次（照片非空必须带 consent），所以直接调接口绕不过去。
 */
export default function ConsentDialog({ open, busy, photoCount, onCancel, onConfirm }) {
  const [agree, setAgree] = useState(false);
  const boxRef = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    setAgree(false); // 每次打开都要重新勾，记住上次的勾等于没有确认
    if (boxRef.current) boxRef.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') cancelRef.current && cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="mem-modal"
      onMouseDown={(e) => {
        // 只有点在遮罩本身（不是卡片内部）才关，避免输入框里拖选文字时误关
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="mem-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mem-consent-title"
        tabIndex={-1}
        ref={boxRef}
      >
        <h2 className="mem-modal-title" id="mem-consent-title">
          照片里的人都同意了吗
        </h2>
        <p className="mem-modal-lede">
          这次要发 {photoCount} 张照片。发出去之后，全站和没登录的访客都能看到，
          也会被转进群里。
        </p>

        <ul className="mem-modal-list">
          <li>照片里出现的人，知道这些照片要发到 LaRoja。</li>
          <li>他们都同意被公开，不是「应该不会介意」。</li>
          <li>有人不愿意的那张，已经删掉了。</li>
        </ul>

        <label className="mem-consent-check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>照片里出现的人我都问过了，全部同意</span>
        </label>

        <p className="mem-modal-note">点确认会记下这个时间，后台能看到。</p>

        <div className="mem-modal-foot">
          <button type="button" className="mem-pick" onClick={onCancel} disabled={busy}>
            再改改
          </button>
          <button type="button" className="mem-post" onClick={onConfirm} disabled={!agree || busy}>
            {busy ? '发布中…' : '确认发布'}
          </button>
        </div>
      </div>
    </div>
  );
}
