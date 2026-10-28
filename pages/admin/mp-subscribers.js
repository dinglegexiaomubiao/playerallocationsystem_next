import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPost } from '../../lib/api-client.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

/**
 * 后台「订阅用户」页。
 *
 * 这一页要回答的**只有一个问题**：为什么某个人收不到提醒。所以每一行都把
 * 「有没绑微信 / 还剩几次额度 / 有没有被拒收 / 最近一条推送成没成」并排摆出来，
 * 而不是只列个名单让人再去别处翻。
 *
 * 两类额度是分开的（汇总、报名提醒），合起来显示会误导 —— 有的人汇总额度
 * 用光了但报名提醒还有，画成一个总数就看不出问题在哪。
 */

const CAT_LABEL = { party: '开黑', activity: '活动', tournament: '赛事', digest: '汇总' };

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_VIEW = {
  ok: { text: '成功', color: '#1E8449' },
  skip: { text: '跳过', color: '#B9770E' },
  fail: { text: '失败', color: '#B03A2E' },
};

export default function AdminMpSubscribersPage({ denied }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/mp/subscribers');
      setData(d);
    } catch (e) {
      setMsg({ type: 'err', text: '加载失败：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const rows = useMemo(() => {
    const list = (data && data.subscribers) || [];
    const kw = q.trim().toLowerCase();
    if (!kw) return list;
    return list.filter(
      (r) =>
        String(r.account || '').toLowerCase().includes(kw) ||
        (r.openids || []).some((o) => String(o).toLowerCase().includes(kw))
    );
  }, [data, q]);

  const stats = (data && data.stats) || {};
  const configured = stats.configured || {};

  const sendTest = async (account) => {
    if (!account || busy) return;
    if (!window.confirm(`给「${account}」发一条**测试**报名提醒？\n\n会真的消耗 TA 一次报名提醒额度。`)) return;
    setBusy(account);
    setMsg(null);
    try {
      const r = await apiPost('/api/admin/mp/push', { action: 'test', account });
      const res = (r && r.result) || {};
      if (res.pushed > 0) {
        setMsg({ type: 'ok', text: `已发给「${account}」，去推送记录里能看到成功` });
      } else {
        setMsg({
          type: 'err',
          text: `没发出去（${res.reason || '额度为 0 或未绑定微信'}）。可以把 TA 的 openid 加进 mp_openids 再试。`,
        });
      }
    } catch (e) {
      setMsg({ type: 'err', text: '发送失败：' + e.message });
    } finally {
      setBusy('');
    }
  };

  if (denied) return <AdminDenied hint="订阅名单里有 openid，只给管理员看。" />;

  return (
    <AdminShell
      title="订阅"
      accent="用户"
      active="mpSubscribers"
      lead="绑了微信的人、还剩几次推送额度、有没有被拒收。小程序里「我的 → 消息提醒」就是这页的数据来源。"
      actions={
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          刷新
        </button>
      }
      metrics={[
        { n: stats.linkedAccounts || 0, label: '绑定微信' },
        { n: stats.accountsWithQuota || 0, label: '还有额度', warn: (stats.linkedAccounts || 0) > (stats.accountsWithQuota || 0) },
        { n: stats.unreadTotal || 0, label: '未读站内信' },
        { n: stats.pushedToday || 0, label: '今日推送成功' },
      ]}
    >
      {/* 配置状态：这一块直接决定「能不能发」，缺什么说清楚，不藏在文档里 */}
      {!configured.canLogin || configured.missingTemplates?.length > 0 ? (
        <div className="adm-flash is-err" style={{ lineHeight: 1.8 }}>
          <strong>订阅消息还没完全配置好，现在只能攒站内信，发不出微信通知。</strong>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            {!configured.canLogin ? (
              <>
                缺 <code>MP_APPID</code> / <code>MP_SECRET</code>（服务器 <code>.env.local</code>，不进仓库）。
                <br />
              </>
            ) : null}
            {configured.missingTemplates?.length > 0 ? (
              <>
                缺模板 id：{configured.missingTemplates.join('、')}
                （<code>MP_TMPL_DIGEST</code> / <code>MP_TMPL_SIGNUP</code>）。
                <br />
              </>
            ) : null}
            都配好之后还要把模板里的**关键词名**填进{' '}
            <code>lib/mp-notify.mjs</code> 的 <code>FIELD_MAP</code>，否则微信会返回 47003。
          </div>
        </div>
      ) : (
        <div className="adm-flash is-ok">
          微信通道已就绪：{configured.appid} · 环境 {configured.envVersion}
          {stats.lastDigest?.at ? ` · 上次汇总 ${fmt(stats.lastDigest.at)}` : ' · 还没跑过汇总'}
        </div>
      )}

      {msg && <div className={'adm-flash is-' + (msg.type === 'err' ? 'err' : 'ok')}>{msg.text}</div>}

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜账号或 openid"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="adm-tool-note">
          {rows.length} / {(data && data.subscribers && data.subscribers.length) || 0} 人
        </span>
      </div>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="empty" style={{ padding: '60px 0', lineHeight: 1.9 }}>
          还没有人绑定微信。
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            小程序里打开「我的 → 消息提醒」并点一次订阅，这里就会出现。
          </div>
        </div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>账号</th>
                <th>openid</th>
                <th>关注</th>
                <th style={{ textAlign: 'right' }}>剩余额度</th>
                <th style={{ textAlign: 'right' }}>累计接受</th>
                <th>状态</th>
                <th style={{ textAlign: 'right' }}>未读</th>
                <th>最近推送</th>
                <th style={{ width: 84 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sv = STATUS_VIEW[r.lastStatus] || null;
                return (
                  <tr key={r.account}>
                    <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.account}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-3)' }}>
                      {(r.openids || []).join(', ') || '—'}
                    </td>
                    <td>
                      {(r.interests || []).length === 0 ? (
                        <span className="adm-chip is-warn">没选类别</span>
                      ) : (
                        (r.interests || []).map((k) => (
                          <span className="adm-chip" key={k}>
                            {CAT_LABEL[k] || k}
                          </span>
                        ))
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.quota}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.accepted}</td>
                    <td>
                      {r.rejected ? (
                        <span className="adm-chip is-warn">被拒收过</span>
                      ) : r.quota > 0 ? (
                        <span className="adm-chip is-ok">可推送</span>
                      ) : (
                        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>额度用尽</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', color: r.unread > 0 ? 'var(--brand)' : 'var(--text-3)' }}>
                      {r.unread}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {sv ? (
                        <span style={{ color: sv.color }}>{sv.text}</span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>—</span>
                      )}
                      {r.lastPushAt ? (
                        <span style={{ color: 'var(--text-3)' }}> {fmt(r.lastPushAt)}</span>
                      ) : null}
                    </td>
                    <td>
                      <button
                        className="adm-link-btn"
                        onClick={() => sendTest(r.account)}
                        disabled={busy === r.account}
                      >
                        {busy === r.account ? '发送中' : '发测试'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="adm-tool-note" style={{ marginTop: 12, lineHeight: 1.8 }}>
        额度是「一次性订阅」的剩余次数：用户每授权一次加 1，推一条扣 1，扣完必须他再点一次。
        微信不给个人主体开放长期订阅，所以这里永远不可能出现「无限推」。
        <br />
        站内信不受额度限制，小程序「消息」页永远能看到。
      </p>
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/mp-subscribers', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
