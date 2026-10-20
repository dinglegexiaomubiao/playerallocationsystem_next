// 选手搜索接口：供「仇人」「默契队友」选择器使用（昵称 / steamid 模糊搜索）
import { searchPlayers } from '../../../lib/db';
import { denyIfNotLoggedIn } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  }

  if (denyIfNotLoggedIn(req, res)) return;

  const { q } = req.query;
  if (!q || !String(q).trim()) {
    return res.status(200).json({ success: true, players: [] });
  }

  try {
    const players = await searchPlayers(q);
    const formatted = players.map((p) => ({
      id: String(p.id),
      nickname: p.nickname || '',
      group_nickname: p.group_nickname || '',
      game_id: p.game_id != null ? String(p.game_id) : '',
      score: p.score ? parseInt(p.score) : 0,
    }));
    res.status(200).json({ success: true, players: formatted });
  } catch (error) {
    console.error('搜索选手错误:', error);
    res.status(500).json({ success: false, error: '搜索选手失败' });
  }
}
