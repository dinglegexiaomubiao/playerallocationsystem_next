/**
 * 页脚「账号」栏的条目生成。
 * 抽成纯函数便于单测：登录前后都保留「注册」与「管理后台」，
 * 只是把「登录」替换成「用户名 + 登出」。
 *
 * 返回项的 type：
 *   link   -> 普通链接，渲染 <Link href>
 *   action -> 需要 onClick 的动作（登出）
 *   user   -> 纯文本用户名
 */

const ADMIN_HREF = '/main';

export function footerAccountItems(me) {
  const adminItem = { key: 'admin', type: 'link', label: '管理后台', href: ADMIN_HREF };
  const registerItem = { key: 'register', type: 'link', label: '注册', href: '/register' };

  if (!me) {
    return [
      { key: 'login', type: 'link', label: '登录', href: '/login' },
      registerItem,
      adminItem,
    ];
  }

  return [
    {
      key: 'user',
      type: 'user',
      label: me.isAdmin ? me.name + '（管理员）' : me.name,
    },
    { key: 'logout', type: 'action', label: '登出' },
    registerItem,
    adminItem,
  ];
}

export { ADMIN_HREF };
