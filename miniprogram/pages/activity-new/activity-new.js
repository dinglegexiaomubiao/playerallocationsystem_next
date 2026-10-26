const { request } = require('../../utils/api');
const { loadOptions } = require('../../utils/options');

const pad = (n) => (n < 10 ? '0' + n : '' + n);

function defaultWhen() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return {
    date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    time: '10:00'
  };
}

// 活动比开黑跨度大（爬山、钓鱼常常一整天），在共用时长表后面补几档长的。
// 服务端允许 15 分钟 ~ 48 小时。
const LONG_DURATIONS = [
  { min: 480, label: '8 小时' },
  { min: 720, label: '12 小时' },
  { min: 1440, label: '1 天' }
];

Page({
  data: {
    loadingOptions: true,
    optionsError: '',

    types: [],
    typeLabels: [],
    typeIndex: 0,

    needs: [],
    needLabels: [],
    needIndex: 3,

    durs: [],
    durLabels: [],
    durIndex: 1,

    costLabels: ['不填'],
    costIndex: 0,

    date: '',
    time: '',
    location: '',
    // 地区：`中国 广东省 深圳市 南山区`（由 region-picker 组件拼好）。可以不填，只填具体地点
    region: '',
    title: '',
    note: '',

    submitting: false,
    error: ''
  },

  onLoad() {
    const w = defaultWhen();
    this.setData({ date: w.date, time: w.time });
    this.loadOpts();
  },

  loadOpts() {
    this.setData({ loadingOptions: true, optionsError: '' });
    loadOptions()
      .then((o) => {
        const durs = (o.durations || []).concat(LONG_DURATIONS);
        // 活动人数上限 50，和开黑的常用人数表不是一回事，直接给 1~50 的序列
        const needs = [];
        for (let i = 1; i <= 50; i += 1) needs.push(i);

        this.setData({
          loadingOptions: false,
          types: o.activityTypes || [],
          typeLabels: (o.activityTypes || []).map((t) => t.label),
          needs: needs,
          needLabels: needs.map((n) => n + ' 人'),
          needIndex: 4,
          durs: durs,
          durLabels: durs.map((d) => d.label),
          durIndex: Math.max(0, durs.findIndex((d) => d.min === 120)),
          costLabels: ['不填'].concat(o.activityCosts || [])
        });
      })
      .catch((e) =>
        this.setData({
          loadingOptions: false,
          optionsError: (e && e.message) || '选项加载失败'
        })
      );
  },

  onType(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },
  onNeed(e) {
    this.setData({ needIndex: Number(e.detail.value) });
  },
  onDur(e) {
    this.setData({ durIndex: Number(e.detail.value) });
  },
  onCost(e) {
    this.setData({ costIndex: Number(e.detail.value) });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onTime(e) {
    this.setData({ time: e.detail.value });
  },
  onInput(e) {
    const patch = {};
    patch[e.currentTarget.dataset.k] = e.detail.value;
    this.setData(patch);
  },

  /** region-picker 只回传拼好的串，解析由服务端做（见 utils/regions.js 的注释） */
  onRegion(e) {
    this.setData({ region: (e.detail && e.detail.value) || '' });
  },

  submit() {
    if (this.data.submitting) return;
    const d = this.data;

    const type = d.types[d.typeIndex];
    if (!type) return this.setData({ error: '请选择活动类型' });

    const need = d.needs[d.needIndex];
    if (!need) return this.setData({ error: '请选择需要几个人' });

    const dur = d.durs[d.durIndex];
    if (!dur) return this.setData({ error: '请选择持续时间' });

    const location = String(d.location || '').trim();
    if (!location) return this.setData({ error: '请填写具体集合地点' });

    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date);
    const tm = /^(\d{2}):(\d{2})$/.exec(d.time);
    if (!dm || !tm) return this.setData({ error: '请选择集合时间' });

    const meet = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
    if (isNaN(meet.getTime())) return this.setData({ error: '时间不合法' });

    const body = {
      type: type.key,
      need_people: need,
      duration_min: dur.min,
      meet_at: meet.toISOString(),
      location: location,
      // 空串不给：服务端 clip 之后存空串，列表里虽然会当 null 处理，
      // 但「有这条 key 但没值」在别处（导出、筛选）容易出意外
      region: String(d.region || '').trim() || undefined,
      cost: d.costIndex > 0 ? d.costLabels[d.costIndex] : undefined,
      title: String(d.title || '').trim() || undefined,
      note: String(d.note || '').trim() || undefined
    };

    this.setData({ submitting: true, error: '' });
    request('/api/activities', body, { method: 'POST' })
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '已发布', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((e) =>
        this.setData({ submitting: false, error: (e && e.message) || '发布失败' })
      );
  }
});
