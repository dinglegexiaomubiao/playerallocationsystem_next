import { useEffect, useState } from 'react';

/**
 * 统一头像组件：有图显示图，没图/加载失败回退成「昵称首字」色块。
 *
 * 为什么要有回退而不是直接 <img>：67/68 个选手可能还没同步到 Steam 头像，
 * 或者头像域名临时不通。裂图比色块难看得多。
 *
 * 用法（className 会透传到外层，`.p-avatar` / `.detail-avatar` 的既有样式继续生效）：
 *   <Avatar className="p-avatar" src={p.avatar} name={p.nickname} />
 */
export default function Avatar({ src, name, className = '', alt, eager = false }) {
  const [failed, setFailed] = useState(false);

  // src 换了（比如同步完头像重新拉列表）要把失败标记清掉，否则会一直显示色块
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const label = (name || '?').trim();
  const initial = label.slice(0, 1).toUpperCase() || '?';
  const cls = className ? className : 'avatar';

  if (src && !failed) {
    return (
      <span className={cls + ' avatar-img'}>
        <img
          src={src}
          alt={alt || label}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={cls + ' avatar-letter'} title={label}>
      {initial}
    </span>
  );
}
