/**
 * 手动触发推送：后台「推送记录」页右上角那两个按钮。
 *
 * 三个动作，区别必须说清楚，否则很容易手滑给全群发一遍：
 *
 *   preview  只统计 + 写站内信，**不发**订阅消息。用来确认「这次的汇总内容对不对」。
 *            站内信按天去重，同一个人一天最多被写一条，点几次都不会刷屏。
 *   digest   真发。会消耗每个订阅者 1 次一次性订阅额度，额度为 0 的人跳过并记日志。
 *   test     给指定账号发一条测试提醒，用来验证「模板字段名对不对」
 *            （字段名填错时这里会立刻返回 errcode 47003，不用等到真事发生）。
 *   check    逐个模板反证模板 id 是否有效，结果缓存 7 天并下发给小程序。
 *            为什么需要：wx.requestSubscribeMessage 传的是一批 id，只要其中一个
 *            无效整批就失败、只报笼统的 20001，前端无从知道是哪个坏了
 *            （2026-10-28 就这样：报名模板 id 贴错，把汇总模板一起拖死）。
 *
 * 定时任务（scripts/mp-digest.cjs）走的是同一个 runDigest，行为完全一致 ——
 * 后台能发的，cron 就能发；cron 发的，后台能查到日志。
 */
import { getSession, isAdmin } from '../../../../lib/auth';
import {
  checkTemplates,
  mpConfigured,
  notifySignupToOwner,
  runDigest,
  subscriptionStats,
} from '../../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可访问' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const stats = await subscriptionStats();
      return res.status(200).json({ ok: true, ...stats });
    } catch (e) {
      return res.status(500).json({ ok: false, error: '读取失败：' + e.message });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ ok: false, error: '不支持的请求方式' });
  }

  const body = req.body || {};
  const action = String(body.action || '');

  try {
    if (action === 'preview') {
      const report = await runDigest({ dryRun: true });
      return res.status(200).json({ ok: true, action, report });
    }

    if (action === 'digest') {
      if (!mpConfigured().canPush) {
        return res.status(409).json({
          ok: false,
          error: '服务端还没配齐 AppSecret / 模板 id，现在发不出去。先用「预览」确认内容。',
        });
      }
      const report = await runDigest({ force: body.force === true });
      return res.status(200).json({ ok: true, action, report });
    }

    if (action === 'test') {
      const account = String(body.account || '').trim();
      if (!account) return res.status(400).json({ ok: false, error: '要指定一个账号' });
      const r = await notifySignupToOwner({
        kind: 'party',
        postId: 'test-' + Date.now(),
        ownerAccount: account,
        postTitle: '【测试】今晚开黑 3 缺 1',
        joinerName: '测试群友',
        extra: '这条是后台手动发的测试提醒',
      });
      return res.status(200).json({ ok: true, action, result: r });
    }

    if (action === 'check') {
      if (!mpConfigured().canPush) {
        return res.status(409).json({
          ok: false,
          error: '服务端还没配齐 AppSecret，现在查不了。',
        });
      }
      const r = await checkTemplates();
      if (r.reason === 'no_openid') {
        return res.status(409).json({
          ok: false,
          error: '还没有任何人绑定微信，没有 openid 可用来反证模板（微信对假 openid 只报 40003）。先让一个人在小程序「消息提醒」页绑定微信。',
        });
      }
      return res.status(200).json({ ok: true, action, result: r });
    }

    return res.status(400).json({ ok: false, error: '未知动作：' + action });
  } catch (e) {
    console.error('手动推送失败:', e);
    return res.status(500).json({ ok: false, error: '执行失败：' + e.message });
  }
}
