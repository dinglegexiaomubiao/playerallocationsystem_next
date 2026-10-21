import http from 'node:http';
import https from 'node:https';

/**
 * 直接调用 Anthropic 兼容端点（当前指向 DeepSeek 的 /anthropic）。
 *
 * 为什么不用 @anthropic-ai/sdk：
 *   线上出现过「同一个 SDK 调用在别的路由里 8 秒返回，在 /api/ai-analysis 里 200 秒无响应」，
 *   排查下来 SDK 与网络都正常，怀疑是 Next 对 global fetch 的补丁在该路由上出了问题。
 *   这里改用 node:https 直连，绕开 fetch 补丁，同时给死硬超时——
 *   宁可 90 秒报错，也不要让前端按钮无限转圈。
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 90000;

export function isAIConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function aiBaseUrl() {
  return process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * 发起一次 messages 请求，返回拼接好的文本内容。
 * 失败时 throw，error.message 可直接展示给用户。
 */
export function requestMessages({ system, prompt, maxTokens = 2048, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error('AI 服务未配置（缺少 ANTHROPIC_API_KEY）'));
      return;
    }

    let url;
    try {
      url = new URL(aiBaseUrl().replace(/\/+$/, '') + '/v1/messages');
    } catch {
      reject(new Error('ANTHROPIC_BASE_URL 配置的不是合法地址'));
      return;
    }

    const transport = url.protocol === 'http:' ? http : https;
    const body = JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      // DeepSeek 的兼容端点默认会带 reasoning，会吃掉 max_tokens 导致正文为空
      thinking: { type: 'disabled' },
    });

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    const req = transport.request(
      {
        host: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            let hint = raw.slice(0, 200);
            try {
              const j = JSON.parse(raw);
              hint = j.error?.message || j.message || hint;
            } catch { /* 保持原文 */ }
            finish(reject, new Error(`AI 服务返回 ${res.statusCode}：${hint}`));
            return;
          }
          try {
            const json = JSON.parse(raw);
            const text = (json.content || [])
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
              .trim();
            if (!text) {
              finish(reject, new Error('AI 返回了空内容，请稍后重试'));
              return;
            }
            finish(resolve, text);
          } catch (e) {
            finish(reject, new Error('AI 返回内容解析失败'));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(reject, new Error(`AI 响应超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请稍后重试`));
    });
    req.on('error', (e) => finish(reject, new Error('AI 请求失败：' + (e.message || '网络错误'))));
    req.end(body);
  });
}
