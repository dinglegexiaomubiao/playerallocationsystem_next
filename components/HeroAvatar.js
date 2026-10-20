import { useEffect, useState } from 'react';
import heroSlugByName from '../lib/heroSlugs';

/**
 * 英雄头像：中文名 → slug → 本地代理 /api/hero-icon/{slug}。
 *
 * 走本地代理而不是直连 Valve CDN 的原因见 pages/api/hero-icon/[slug].js。
 * 查不到 slug（新增英雄还没补映射）或图片挂了，就回退成英雄名首字。
 */
export default function HeroAvatar({ name, className = 'hero-avatar', eager = false }) {
  const slug = heroSlugByName[name];
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [name]);

  const initial = (name || '?').trim().slice(0, 1);

  if (!slug || failed) {
    return (
      <span className={className + ' hero-avatar-letter'} title={name}>
        {initial}
      </span>
    );
  }

  return (
    <span className={className}>
      <img
        src={'/api/hero-icon/' + slug}
        alt={name || ''}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
