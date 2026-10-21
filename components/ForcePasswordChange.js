import { useEffect } from 'react';
import { useRouter } from 'next/router';
import useSession from '../hooks/useSession';

/**
 * 「必须改密码」的全站守卫。
 *
 * 场景：管理员在后台重置了某人的密码 → 库里 must_change_password = true。
 * 这个人下次打开任何页面（包括他原本收藏的链接）都会被推到这里，
 * 改完密码才放行 —— 否则临时密码等于长期密码，重置就失去了意义。
 *
 * 为什么放在前端而不是中间件：
 * 本站的鉴权本来就是「API 各自校验 cookie」的轻量模型，没有统一中间件；
 * 普通群友能做的操作很少（报名、写评价、留言），所以这里用前端跳转就够。
 * 真要彻底，得给每个写接口都查一次 must_change_password，代价大、收益小。
 *
 * 渲染 null，不占布局。
 */
export default function ForcePasswordChange() {
  const router = useRouter();
  const { me, ready, mustChangePassword } = useSession();

  useEffect(() => {
    if (!ready || !me || !mustChangePassword) return;
    const { pathname } = router;
    if (pathname === '/change-password' || pathname === '/login' || pathname === '/register') return;
    // replace 而不是 push：不让他用浏览器返回键跳回原页面
    router.replace('/change-password?forced=1');
  }, [ready, me, mustChangePassword, router]);

  return null;
}
