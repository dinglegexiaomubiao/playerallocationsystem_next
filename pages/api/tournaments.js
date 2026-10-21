// Next.js API route for tournaments management
import { pool, ensureTournamentSchema } from '../../lib/db';
import { denyIfNotLoggedIn, denyIfNotAdmin, denyIfImportNotAdmin } from '../../lib/auth';

// POST 可写入的字段。单条「新建赛季」只传 name/起止日期，
// Excel 批量导入会带上状态、赞助、奖金等完整信息，所以这里统一收口。
const CREATABLE_FIELDS = [
  'name', 'start_date', 'end_date', 'status',
  'sponsor_info', 'champion_prize', 'runner_up_prize',
  'champion_team_id', 'runner_up_team_id', 'third_place_team_id',
];

export default async function handler(req, res) {
  const { method } = req;
  const client = await pool.connect();

  try {
    // 确保名次表 / 历史最高分列存在（旧库可能缺），公开接口也依赖它们
    await ensureTournamentSchema();
    switch (method) {
      case 'GET': {
        // 额外带出冠/亚/季的队伍名：导出 Excel 时表格里要写队名而不是 id，
        // 否则 N 个赛季就得发 N 次 /api/teams 请求
        const tournamentsResult = await client.query(`
          SELECT 
            t.id, 
            t.name, 
            t.start_date, 
            t.end_date, 
            t.champion_team_id, 
            t.runner_up_team_id,
            t.third_place_team_id,
            t.sponsor_info,
            t.champion_prize,
            t.runner_up_prize,
            t.status,
            t.created_at,
            tc.name AS champion_team_name,
            tr.name AS runner_up_team_name,
            tt.name AS third_place_team_name,
            -- 名次可以有多个（并列冠军/亚军/季军）。这里聚合出全部队名，
            -- 列表页优先用它；为空时前端回退到上面的单值 champion_team_name。
            (SELECT string_agg(pt.name, ' / ' ORDER BY pt.name)
               FROM public.tournament_placements pl
               JOIN public.teams pt ON pt.id = pl.team_id AND pt.tournament_id = pl.tournament_id
              WHERE pl.tournament_id = t.id AND pl.place = 1) AS champions_text
          FROM public.tournaments t
          -- 只认本赛事的队伍：库里存在指向别的赛事队伍的历史脏数据
          LEFT JOIN public.teams tc ON tc.id = t.champion_team_id AND tc.tournament_id = t.id
          LEFT JOIN public.teams tr ON tr.id = t.runner_up_team_id AND tr.tournament_id = t.id
          LEFT JOIN public.teams tt ON tt.id = t.third_place_team_id AND tt.tournament_id = t.id
          -- 排序：先按起止时间倒序（最近结束/开始的在上），没有日期的排后面；
          -- 时间相同或都为空时，按赛季名称升序。
          -- 用 end_date 优先、start_date 兜底，比只看 start_date 更符合"最近办完的在上"的直觉。
          ORDER BY
            COALESCE(t.end_date, t.start_date) DESC NULLS LAST,
            t.name ASC
        `);
        
        res.status(200).json({
          success: true,
          tournaments: tournamentsResult.rows
        });
        break;
      }

      case 'POST': {
        if (denyIfNotLoggedIn(req, res)) break;
        // 带 x-excel-import: 1 的批量导入必须是管理员
        if (denyIfImportNotAdmin(req, res)) break;

        const body = req.body || {};
        const name = body.name;
        if (!name || !String(name).trim()) {
          return res.status(400).json({
            success: false,
            message: '赛季名称不能为空'
          });
        }

        const fields = CREATABLE_FIELDS.filter((f) => body[f] !== undefined);
        const values = fields.map((f) => {
          const v = body[f];
          return v === '' ? null : v;
        });
        // 状态没传时按老行为落 planning
        if (!fields.includes('status')) {
          fields.push('status');
          values.push('planning');
        }
        fields.push('created_at');
        values.push(new Date().toISOString());

        const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
        const insertResult = await client.query(
          `INSERT INTO public.tournaments (${fields.join(', ')})
           VALUES (${placeholders})
           RETURNING *`,
          values
        );
        
        res.status(201).json({
          success: true,
          tournament: insertResult.rows[0]
        });
        break;
      }

      case 'PUT': {
        if (denyIfNotAdmin(req, res, '仅管理员可修改赛事信息')) break;
        const { id } = req.query;
        const updateData = req.body;
        
        if (!id) {
          return res.status(400).json({
            success: false,
            message: '缺少赛季ID'
          });
        }
        
        const allowedFields = [
          'name', 'start_date', 'end_date', 'champion_team_id',
          'runner_up_team_id', 'third_place_team_id', 'sponsor_info',
          'champion_prize', 'runner_up_prize', 'status'
        ];

        // 名次可以有多个：placements 传 [{ team_id, place, note }]，
        // 整份替换该赛事的名次（空数组 = 清空）。
        // 单值字段仍然保留，作为只读兼容层；同时传就以 placements 为准。
        const hasPlacements = Array.isArray(updateData.placements);
        const placeRows = hasPlacements
          ? updateData.placements.filter((x) => x && Number(x.team_id) && Number(x.place) > 0)
          : [];

        const fields = Object.keys(updateData).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0 && !hasPlacements) {
          return res.status(400).json({
            success: false,
            message: '没有可更新的有效字段'
          });
        }

        let tournamentRow = null;

        if (fields.length > 0) {
          const values = fields.map(field => updateData[field]);
          const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
          values.push(id);

          const updateResult = await client.query(
            `UPDATE public.tournaments 
             SET ${setClause} 
             WHERE id = $${values.length} 
             RETURNING *`,
            values
          );

          if (updateResult.rowCount === 0) {
            return res.status(404).json({
              success: false,
              message: '赛季未找到'
            });
          }
          tournamentRow = updateResult.rows[0];
        }

        if (hasPlacements) {
          await client.query(
            'DELETE FROM public.tournament_placements WHERE tournament_id = $1',
            [id]
          );
          if (placeRows.length > 0) {
            await client.query(
              `INSERT INTO public.tournament_placements (tournament_id, team_id, place, note)
               SELECT $1, x.team_id, x.place, x.note
                 FROM unnest($2::bigint[], $3::smallint[], $4::text[]) AS x(team_id, place, note)
               ON CONFLICT (tournament_id, team_id, place) DO NOTHING`,
              [
                id,
                placeRows.map((r) => Number(r.team_id)),
                placeRows.map((r) => Number(r.place)),
                placeRows.map((r) => r.note || null),
              ]
            );
          }
          if (!tournamentRow) {
            const again = await client.query('SELECT * FROM public.tournaments WHERE id = $1', [id]);
            tournamentRow = again.rows[0] || null;
          }
        } else if (
          tournamentRow &&
          fields.some((f) =>
            ['champion_team_id', 'runner_up_team_id', 'third_place_team_id'].includes(f)
          )
        ) {
          // 只改了单值字段（旧后台还在用）→ 把它同步进名次表，
          // 否则页面读 placements 会一直显示旧名次。
          await client.query(
            'DELETE FROM public.tournament_placements WHERE tournament_id = $1 AND place IN (1, 2, 3)',
            [id]
          );
          const triples = [
            [tournamentRow.champion_team_id, 1],
            [tournamentRow.runner_up_team_id, 2],
            [tournamentRow.third_place_team_id, 3],
          ].filter(([tid]) => tid);
          if (triples.length > 0) {
            await client.query(
              `INSERT INTO public.tournament_placements (tournament_id, team_id, place)
               SELECT $1, x.team_id, x.place
                 FROM unnest($2::bigint[], $3::smallint[]) AS x(team_id, place)
               ON CONFLICT (tournament_id, team_id, place) DO NOTHING`,
              [id, triples.map((x) => Number(x[0])), triples.map((x) => x[1])]
            );
          }
        }

        res.status(200).json({
          success: true,
          tournament: tournamentRow
        });
        break;
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (error) {
    console.error('Tournaments API error:', error);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
}
