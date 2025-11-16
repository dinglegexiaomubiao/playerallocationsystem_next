// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
export default function handler(req, res) {
  // 示例队伍数据
  const teams = [];

  res.status(200).json({ teams });
}