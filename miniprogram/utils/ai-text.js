// 把 AI 返回的 markdown 拆成小程序能直接渲染的块。
//
// 为什么不用 rich-text：rich-text 只认白名单标签、不吃外部 WXSS，还得把 AI 输出的
// 任意文本拼进 HTML 字符串（等于把 AI 的输出当 HTML 执行）。这里只认三件东西：
// 序号（`1. `）、加粗（`**...**`）、行内其余文本 —— 够用，且不可能注入标签。
//
// 输出结构（页面里 wx:for 直接铺）：
//   { k, type: 'h' | 'item' | 'p', num: '1', segs: [{ k, b: false, t: '文本' }] }
// k 是给 wx:key 用的稳定键（WXML 的 wx:key 只认字段名或 *this）。

const RE_BOLD = /\*\*([^*]+)\*\*/g;
const RE_NUM = /^(\d+)\s*[.、)]\s*(.*)$/;
const RE_HEAD = /^#{1,6}\s+(.*)$/;
const RE_BULLET = /^[-*•]\s+(.*)$/;

/** 把一行里的 `**加粗**` 拆成段。没有加粗就返回单段。 */
function splitBold(line) {
  const out = [];
  let last = 0;
  RE_BOLD.lastIndex = 0;
  let m;
  while ((m = RE_BOLD.exec(line)) !== null) {
    if (m.index > last) out.push({ b: false, t: line.slice(last, m.index) });
    if (m[1]) out.push({ b: true, t: m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ b: false, t: line.slice(last) });
  if (!out.length) out.push({ b: false, t: line });
  // 段内再挂 wx:key
  return out.map(function (s, i) {
    return { k: i, b: s.b, t: s.t };
  });
}

/**
 * @param {string} text AI 返回的整段文本
 * @returns {{blocks: Array, chars: number, items: number}}
 *   items 是「几个分析维度」，AI 没给序号时为 0，页面据此决定要不要显示计数
 */
function parseAnalysis(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const blocks = [];
  let items = 0;

  for (let i = 0; i < lines.length; i++) {
    // 全角空格、不间断空格都当空白，不然 AI 偶尔吐的缩进行会变成空块
    const line = lines[i].replace(/^[\s\u3000\u00a0]+|[\s\u3000\u00a0]+$/g, '');
    if (!line) continue;

    const head = RE_HEAD.exec(line);
    if (head) {
      blocks.push({ k: blocks.length, type: 'h', num: '', segs: splitBold(head[1]) });
      continue;
    }

    const num = RE_NUM.exec(line);
    if (num) {
      items++;
      blocks.push({ k: blocks.length, type: 'item', num: num[1], segs: splitBold(num[2]) });
      continue;
    }

    const bullet = RE_BULLET.exec(line);
    if (bullet) {
      blocks.push({ k: blocks.length, type: 'p', num: '', bullet: true, segs: splitBold(bullet[1]) });
      continue;
    }

    blocks.push({ k: blocks.length, type: 'p', num: '', segs: splitBold(line) });
  }

  return { blocks: blocks, chars: src.length, items: items };
}

module.exports = { parseAnalysis: parseAnalysis, splitBold: splitBold };
