// 小程序入口：与 Web 共用同一套后端 /api/*
// 名片页的「AI 战绩分析」由服务器调用大模型生成（POST /api/ai-analysis），小程序只拉取展示，
// 自己不跑模型、也不存 key。注意：算力在哪不影响审核判定（见 小程序项目档案 提审记录）。
App({
  globalData: {
    // 后端地址；上线前把域名加入小程序后台「request 合法域名」
    apiBase: 'https://dota.playerallocationsystem.online',
    token: '',
    accountName: '',
    isAdmin: false
  },
  onLaunch() {
    // 冷启动时从 storage 把登录态捞回来（storage 是唯一真相，globalData 只是热启动缓存）。
    // 这里直接读 storage 而不是 require utils/session：onLaunch 阶段 getApp() 的可用性
    // 不值得赌，session.js 里所有 getApp() 都在函数内且带兜底。
    const apiBase = wx.getStorageSync('apiBase');
    const token = wx.getStorageSync('token');
    if (apiBase) this.globalData.apiBase = apiBase;
    if (token) {
      this.globalData.token = token;
      this.globalData.accountName = wx.getStorageSync('accountName') || '';
      this.globalData.isAdmin = !!wx.getStorageSync('isAdmin');
    }

    // 静默换一次 openid，供服务端调微信内容安全接口（msgSecCheck 强制要求 openid）。
    // 不阻塞启动、失败静默：它是审核基础设施，不是功能前置条件。
    try {
      require('./utils/wxopenid').ensure();
    } catch (e) {
      /* 拿不到就算了，服务端会跳过官方那道，只走词表 + AI */
    }
  }
});
