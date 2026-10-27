// 小程序入口：与 Web 共用同一套后端 /api/*
// AI 能力 = /api/ai-analysis（群友战力分析，名片页入口；key 只在服务端）
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
  }
});
