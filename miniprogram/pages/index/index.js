const { request } = require('../../utils/api');

/** Fisher-Yates：服务端缓存 60 秒不能洗牌，顺序固定，洗牌放客户端 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

Page({
  data: {
    // 顺序对齐网页主导航：组队 → 活动 → 赛事 → 群友 → 帮派 → 分布 → 美食 → 语录
    modules: [
      { key: 'party', name: '组队约局', desc: '缺人喊一嗓', path: '/pages/party/party' },
      { key: 'activities', name: '活动招募', desc: '约饭爬山', path: '/pages/activities/activities' },
      { key: 'tournaments', name: '赛事信息', desc: '历届名次', path: '/pages/tournaments/tournaments' },
      { key: 'members', name: '群友信息', desc: '战绩与名片', path: '/pages/members/members' },
      { key: 'guilds', name: '帮派', desc: '阵营与成员', path: '/pages/guilds/guilds' },
      { key: 'dist', name: '群友分布', desc: '深圳九区', path: '/pages/dist/dist' },
      { key: 'foods', name: '群友美食', desc: '深圳好店', path: '/pages/foods/foods' },
      { key: 'quotes', name: '群友语录', desc: '群友梗', path: '/pages/quotes/quotes' }
    ],
    quotes: []
  },

  onLoad() {
    this.loadQuotes();
  },

  loadQuotes() {
    request('/api/quotes/ticker', null, { method: 'GET' })
      .then((res) => {
        const list = (res && res.quotes) || [];
        const picked = shuffle(list).slice(0, 8).map((q) => ({
          id: String(q.id),
          content: q.content,
          from:
            (q.source && (q.source.nickname || q.source.text)) || ''
        }));
        this.setData({ quotes: picked });
      })
      .catch(() => {
        // 轮播是锦上添花，取不到就不显示，不打扰首页
      });
  },

  onQuotes() {
    wx.navigateTo({ url: '/pages/quotes/quotes' });
  },

  // 原「AI 助手」CTA 指向的 /api/assistant 后端从未实现（点了必 404），
  // tab 与页面已下线。CTA 改成指向真实存在的「AI 战力分析」入口：
  // 名片页现在有 OpenDota 战绩 + AI 推断，这是首页最值得推的一个功能。
  goMembers() {
    wx.navigateTo({ url: '/pages/members/members' });
  },

  onModule(e) {
    const ds = e.currentTarget.dataset;
    if (ds.path) {
      wx.navigateTo({ url: ds.path });
    } else {
      wx.showToast({ title: (ds.name || '该模块') + ' 待接入', icon: 'none' });
    }
  },

  onShareAppMessage() {
    return { title: 'DoDo资料查询', path: '/pages/index/index' };
  },

  onShareTimeline() {
    return { title: 'DoDo资料查询' };
  }
});
