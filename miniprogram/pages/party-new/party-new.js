const { request } = require('../../utils/api');
const { loadOptions } = require('../../utils/options');

const pad = (n) => (n < 10 ? '0' + n : '' + n);

/** 默认给「一小时后」，分钟抹到 00 —— 手选两个 picker 本来就慢，先给个能直接提交的值 */
function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return {
    date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    time: pad(d.getHours()) + ':00'
  };
}

Page({
  data: {
    loadingOptions: true,
    optionsError: '',

    modeLabels: [],
    modeIndex: 0,
    modes: [],

    needLabels: [],
    needIndex: 2,
    needs: [],

    durLabels: [],
    durIndex: 0,
    durs: [],

    voiceLabels: ['不语音'],
    voiceIndex: 0,

    // 位置做成 [{name, on}] 而不是「数组 + 另存一个已选数组」：
    // WXML 里不能调 indexOf()，选中态必须提前算成字段。
    positions: [],
    date: '',
    time: '',
    title: '',
    note: '',
    wantRank: '',
    wantScoreMin: '',
    wantScoreMax: '',

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
        const needs = o.needPlayers || [];
        const durs = o.durations || [];
        const voiceLabels = ['不语音'].concat(o.voiceApps || []);
        // 默认 5 人、1.5 小时：和网页端新建卡片的常用值一致
        const needIndex = Math.max(0, needs.indexOf(5));
        const durIndex = Math.max(0, durs.findIndex((d) => d.min === 90));
        this.setData({
          loadingOptions: false,
          modes: o.partyModes || [],
          modeLabels: (o.partyModes || []).map((m) => m.label),
          needLabels: needs.map((n) => n + ' 人'),
          needs: needs,
          needIndex: needIndex,
          durs: durs,
          durLabels: durs.map((d) => d.label),
          durIndex: durIndex,
          voiceLabels: voiceLabels,
          positions: (o.positions || []).map((n) => ({ name: n, on: false }))
        });
      })
      .catch((e) =>
        this.setData({
          loadingOptions: false,
          optionsError: (e && e.message) || '选项加载失败'
        })
      );
  },

  onMode(e) {
    this.setData({ modeIndex: Number(e.detail.value) });
  },
  onNeed(e) {
    this.setData({ needIndex: Number(e.detail.value) });
  },
  onDur(e) {
    this.setData({ durIndex: Number(e.detail.value) });
  },
  onVoice(e) {
    this.setData({ voiceIndex: Number(e.detail.value) });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onTime(e) {
    this.setData({ time: e.detail.value });
  },
  onInput(e) {
    const k = e.currentTarget.dataset.k;
    const patch = {};
    patch[k] = e.detail.value;
    this.setData(patch);
  },
  togglePos(e) {
    const i = Number(e.currentTarget.dataset.i);
    const list = this.data.positions.slice();
    if (!list[i]) return;
    list[i] = { name: list[i].name, on: !list[i].on };
    this.setData({ positions: list });
  },

  submit() {
    if (this.data.submitting) return;
    const d = this.data;

    const mode = d.modes[d.modeIndex];
    if (!mode) return this.setData({ error: '请选择开黑模式' });

    const need = d.needs[d.needIndex];
    if (!need) return this.setData({ error: '请选择需要几个人' });

    const dur = d.durs[d.durIndex];
    if (!dur) return this.setData({ error: '请选择持续时间' });

    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.date);
    const tm = /^(\d{2}):(\d{2})$/.exec(d.time);
    if (!dm || !tm) return this.setData({ error: '请选择开始时间' });

    // 用设备本地时区拼绝对时刻（toISOString 带 Z），服务端就不用再猜时区。
    // ⚠ 不要自己算 tz_offset：那套「裸串 + 偏移」是给 datetime-local 用的，
    //   这里已经有绝对的瞬间，再补偏移反而会错。
    const start = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
    if (isNaN(start.getTime())) return this.setData({ error: '时间不合法' });
    if (start.getTime() < Date.now() - 60 * 1000) {
      return this.setData({ error: '开始时间已经过去了' });
    }

    const voice = d.voiceIndex > 0 ? d.voiceLabels[d.voiceIndex] : '';

    const body = {
      mode: mode.key,
      need_players: need,
      duration_min: dur.min,
      start_at: start.toISOString(),
      title: String(d.title || '').trim() || undefined,
      note: String(d.note || '').trim() || undefined,
      want_rank: String(d.wantRank || '').trim() || undefined,
      want_score_min: d.wantScoreMin === '' ? undefined : Number(d.wantScoreMin),
      want_score_max: d.wantScoreMax === '' ? undefined : Number(d.wantScoreMax),
      want_positions: d.positions.filter((p) => p.on).map((p) => p.name),
      has_voice: d.voiceIndex > 0,
      voice_app: voice || undefined
    };

    this.setData({ submitting: true, error: '' });
    request('/api/party', body, { method: 'POST' })
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
