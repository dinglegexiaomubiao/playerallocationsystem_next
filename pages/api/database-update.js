import { updateDatabaseStructure } from '../../lib/db-update';
import { isAdmin } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 这个接口会直接跑 DDL 改表结构，必须管理员才能触发
  if (!isAdmin(req)) {
    return res.status(403).json({
      success: false,
      error: '仅管理员可执行数据库结构更新',
    });
  }

  try {
    await updateDatabaseStructure();
    res.status(200).json({
      success: true,
      message: '数据库结构更新成功',
    });
  } catch (error) {
    console.error('数据库结构更新失败:', error);
    res.status(500).json({
      success: false,
      message: '数据库结构更新失败',
      error: error.message,
    });
  }
}
