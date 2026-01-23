import { updateDatabaseStructure } from '../../lib/db-update';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await updateDatabaseStructure();
    res.status(200).json({ 
      success: true, 
      message: '数据库结构更新成功' 
    });
  } catch (error) {
    console.error('数据库结构更新失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '数据库结构更新失败',
      error: error.message 
    });
  }
}