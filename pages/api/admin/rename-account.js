/**
 * 管理员修改群友的「登录账号」（play_score.name，仅管理员）。
 *
 * 为什么要有这个接口：注册是自己填的，账号名经常写错（lanzihong / landizhong 这种拼音手误）。
 * 没有它，唯一的补救是让本人重新注册一个号 —— 但他已经绑定 Steam、参加过赛事、报过名，
 * 换号会把这些历史全部切断。
 *
 * POST { playerId, newName } 或 { accountName, newName }
 *   → 200 { ok, oldName, newName, moved, needRelogin, note }
 *
 * 三条硬约定：
 *   1. **play_score.name 是主键**，改它等于改主键值。所以必须开事务，把「按账号名存历史数据」
 *      的那几张表（page_views / party_posts / party_signups / support_reports）一起迁过去，
 *      否则本人改完名字就看不到自己以前的反馈和报名了。
 *   2. **管理员账号不许改名，也不许把任何账号改成管理员名**。isAdminName 是按名字匹配的，
 *      后者等于凭空发管理员权限，前者会让在职管理员突然变普通用户。
 *   3. **改名后旧登录态作废**。cookie 里存的是名字，服务端只验签名不查库，
 *      所以旧 cookie 还能过验签、但按名字查什么都查不到 —— 必须提示对方重新登录。
 */
import { denyIfNotAdmin, getSession, isAdminName } from '../../../lib/auth';
import { pool, ensureAccountRenameColumns } from '../../../lib/db';
import { resetFail } from '../../../lib/rate-limit';

const MAX_NAME_LEN = 40; // 与注册接口保持一致

/* 按账号名存了历史数据的表。改名时必须一起迁，否则历史记录会指向一个不存在的账号。 */
const ACCOUNT_NAME_TABLES = [
  ['page_views', '浏览记录'],
  ['party_posts', '开黑组队帖'],
  ['party_signups', '开黑报名'],
  ['support_reports', '问题反馈'],
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: `方法 ${req.method} 不被允许` });
  }

  if (denyIfNotAdmin(req, res, '仅管理员可修改用户名')) return;

  const playerId = req.body?.playerId == null ? '' : String(req.body.playerId).trim();
  const accountName = String(req.body?.accountName || '').trim();
  const newName = String(req.body?.newName || '').trim();

  if (!playerId && !accountName) {
    return res.status(400).json({ ok: false, error: '缺少 playerId 或 accountName' });
  }
  if (!newName) return res.status(400).json({ ok: false, error: '请填写新的用户名' });
  if (newName.length > MAX_NAME_LEN) {
    return res.status(400).json({ ok: false, error: `用户名不能超过 ${MAX_NAME_LEN} 个字符` });
  }
  // 账号名会出现在登录框和按名字查数据的 SQL 里，首尾空白和换行只会制造麻烦
  if (/[\s\u0000-\u001f]/.test(newName)) {
    return res.status(400).json({ ok: false, error: '用户名不能包含空格或换行' });
  }
  // 防越权：改成管理员名 = 凭空获得后台权限
  if (isAdminName(newName)) {
    return res.status(403).json({
      ok: false,
      error: '不能把用户名改成管理员账号，如需调整管理员请改服务器 ADMIN_NAMES 配置',
    });
  }

  const client = await pool.connect();
  try {
    await ensureAccountRenameColumns();

    const found = playerId
      ? await client.query(
          `SELECT s.name, s.player_id, p.nickname
             FROM public.play_score s
             LEFT JOIN public.players p ON p.id = s.player_id
            WHERE s.player_id = $1 LIMIT 1`,
          [playerId]
        )
      : await client.query(
          `SELECT s.name, s.player_id, p.nickname
             FROM public.play_score s
             LEFT JOIN public.players p ON p.id = s.player_id
            WHERE LOWER(s.name) = LOWER($1) LIMIT 1`,
          [accountName]
        );

    if (found.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: playerId ? '该群友还没有登录账号，无法修改用户名' : '账号不存在',
      });
    }

    const oldName = found.rows[0].name;
    const nickname = found.rows[0].nickname || null;

    // 一个字都没改（含仅大小写差异以外的情况）：直接返回，别白开事务
    if (oldName === newName) {
      return res.status(200).json({
        ok: true,
        unchanged: true,
        oldName,
        newName,
        nickname,
        moved: {},
        needRelogin: false,
        note: '用户名没有变化',
      });
    }

    // 管理员账号改名 = 让自己失去后台权限，这类操作请走 ADMIN_NAMES
    if (isAdminName(oldName)) {
      return res.status(403).json({
        ok: false,
        error: `「${oldName}」是管理员账号，不支持在后台改名（改服务器 ADMIN_NAMES 配置）`,
      });
    }

    // 唯一性：不区分大小写（和登录的判定保持一致），但要把自己排除掉
    const dup = await client.query(
      'SELECT name FROM public.play_score WHERE LOWER(name) = LOWER($1) AND name <> $2 LIMIT 1',
      [newName, oldName]
    );
    if (dup.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        error: `用户名「${newName}」已被「${dup.rows[0].name}」占用，换一个`,
      });
    }

    const by = getSession(req)?.name || 'admin';
    const moved = {};

    await client.query('BEGIN');

    // 1) 改主键。play_score 没有被任何外键引用（已核对 information_schema），可以直接改值。
    try {
      await client.query(
        `UPDATE public.play_score SET
           name = $1,
           previous_name = COALESCE(previous_name, $2),
           name_changed_at = now(),
           name_changed_by = $3
         WHERE name = $2`,
        [newName, oldName, by]
      );
    } catch (e) {
      await client.query('ROLLBACK');
      if (e && e.code === '23505') {
        return res.status(409).json({ ok: false, error: '该用户名已被占用（并发写入），刷新后重试' });
      }
      throw e;
    }

    // 2) 把按账号名存的历史数据一起改名。
    //    每张表单独 SAVEPOINT：某张表还没建（老库）或结构不同，不该拖垮整次改名。
    for (const [table, label] of ACCOUNT_NAME_TABLES) {
      await client.query(`SAVEPOINT rn_${table}`);
      try {
        const r = await client.query(
          `UPDATE public.${table} SET account_name = $1 WHERE account_name = $2`,
          [newName, oldName]
        );
        if (r.rowCount > 0) moved[label] = r.rowCount;
        await client.query(`RELEASE SAVEPOINT rn_${table}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT rn_${table}`);
        console.error(`改名同步 ${table} 失败（已跳过）:`, e.message);
      }
    }

    await client.query('COMMIT');

    // 3) 旧名字可能还留着登录失败锁定，一并清掉（新旧两个维度都清）
    resetFail(`user:${String(oldName).toLowerCase()}`);
    resetFail(`user:${String(newName).toLowerCase()}`);

    return res.status(200).json({
      ok: true,
      oldName,
      newName,
      nickname,
      moved,
      // 前端要把这条明确展示出来：他的旧 cookie 还能过验签，但查不到任何数据了
      needRelogin: true,
      note: '已改名。本人需要用新用户名重新登录（旧登录态会失效）。',
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* 事务可能已经结束 */
    }
    console.error('修改用户名失败:', e);
    return res.status(500).json({ ok: false, error: '修改失败：' + e.message });
  } finally {
    client.release();
  }
}
