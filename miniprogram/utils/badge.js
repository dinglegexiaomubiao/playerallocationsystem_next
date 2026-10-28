// tabBar 未读角标。
//
// 为什么单独一个文件：消息数会在四个地方变化（进「我的」、进消息页、标记已读、
// 登录/登出），每处各写一遍 wx.setTabBarBadge 迟早漏一处，表现为「读完消息
// 红点还在」。
//
// 「我的」是 tabBar 第 2 项（index 1）。消息入口挂在「我的」里，所以角标也挂它。
const api = require('./api.js');
const session = require('./session.js');

const MINE_TAB_INDEX = 1;

function apply(unread) {
  const n = Number(unread) || 0;
  try {
    if (n > 0) {
      wx.setTabBarBadge({ index: MINE_TAB_INDEX, text: n > 99 ? '99+' : String(n) });
    } else {
      wx.removeTabBarBadge({ index: MINE_TAB_INDEX });
    }
  } catch (e) {
    // 非 tabBar 页面 / 老基础库没有这个 API：静默跳过，角标不是功能本体
  }
}

/**
 * 拉一次未读数并刷新角标。未登录 / 网络失败时把角标清掉（不要留一个假红点）。
 * @returns {Promise<number>} 当前未读数（失败返回 0）
 */
function refreshUnread() {
  if (!session.getToken()) {
    apply(0);
    return Promise.resolve(0);
  }
  return api
    .request('/api/mp/status', null, { method: 'GET' })
    .then(function (d) {
      const n = (d && d.unread) || 0;
      apply(n);
      return n;
    })
    .catch(function () {
      apply(0);
      return 0;
    });
}

module.exports = { refreshUnread: refreshUnread, apply: apply, MINE_TAB_INDEX: MINE_TAB_INDEX };
