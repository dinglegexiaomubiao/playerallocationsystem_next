const { request } = require('../../utils/api');

const WELCOME =
  '你好，我是 LaRoja 社区助手。可以问我：阿吉最近战绩怎么样？上次深圳赛谁拿冠军？讲个社区的梗？';

Page({
  data: {
    messages: [],
    input: '',
    loading: false,
    scrollTo: ''
  },

  onLoad() {
    this.setData({ messages: [{ id: 1, role: 'assistant', content: WELCOME }] });
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onClear() {
    this.setData({
      messages: [{ id: Date.now(), role: 'assistant', content: WELCOME }],
      scrollTo: ''
    });
  },

  onSend() {
    const q = (this.data.input || '').trim();
    if (!q || this.data.loading) return;

    const uid = Date.now();
    const messages = this.data.messages.concat([{ id: uid, role: 'user', content: q }]);
    this.setData({ messages, input: '', loading: true, scrollTo: 'msg-' + uid });

    // 后端 /api/assistant 由服务端调 DeepSeek + 查库；小程序只收 JSON（非流式）
    request('/api/assistant', { q })
      .then((res) => {
        const answer = (res && (res.answer || res.content)) || '暂时没有答案。';
        const aid = Date.now() + 1;
        this.setData({
          messages: this.data.messages.concat([{ id: aid, role: 'assistant', content: answer }]),
          loading: false,
          scrollTo: 'msg-' + aid
        });
      })
      .catch((err) => {
        const eid = Date.now() + 2;
        this.setData({
          messages: this.data.messages.concat([
            { id: eid, role: 'assistant', content: '接口未就绪或出错：' + ((err && err.message) || '请求失败') }
          ]),
          loading: false,
          scrollTo: 'msg-' + eid
        });
      });
  }
});
