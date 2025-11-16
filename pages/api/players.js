// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
export default function handler(req, res) {
  // 示例选手数据
  const players = [
    {
      "id": "1",
      "nickname": "Spirit_Moon",
      "group_nickname": "Spirit_Moon",
      "game_id": "294993528",
      "score": 15000,
      "positions": [
        "劣势路",
        "优势路",
        "中单",
        "半辅助"
      ],
      "heroes": [],
      "win_rate": 0,
      "championships": 0,
      "synergy_players": [],
      "created_at": "",
      "updated_at": "",
      "position_priority": {},
      "team_name": "unassigned",
      "synergyPlayers": []
    }
  ];

  res.status(200).json({ players });
}