import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiGet, apiPut, apiDelete } from '../../lib/api-client.mjs';

// 缺漏检测：历史数据里常见「只写了店名」的情况
function issuesOf(f) {
  const out = [];
  if (!f.recommender) out.push({ t: '缺推荐人', lv: 'mid' });
  if (!f.address) out.push({ t: '缺地址', lv: 'mid' });
  if (!f.cuisine) out.push({ t: '缺菜系', lv: 'low' });
  if (!f.rating) out.push({ t: '无评分', lv: 'low' });
  return out;
}

const TAG_COLOR = {
  mid: { bg: '#FEF4E6', fg: '#B9770E', bd: '#F8DCB4' },
  low: { bg: '#F1F2F4', fg: '#6B7280', bd: '#E3E5E8' },
};

function Tag({ children, lv = 'mid' }) {
  const c = TAG_COLOR[lv] || TAG_COLOR.mid;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        marginRight: 5,
        borderRadius: 5,
        fontSize: 11,
        lineHeight: '18px',
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const FIELD_DEFS = [
  { k: 'name', label: '店名', ph: '必填', required: true },
  { k: 'cuisine', label: '菜系', ph: '川菜 / 粤菜 / 日料…' },
  { k: 'area', label: '区域', ph: '南山 / 福田…' },
  { k: 'address', label: '地址', ph: '详细地址' },
  { k: 'recommender', label: '推荐人', ph: '群昵称' },
  { k: 'nearby', label: '附近地标', ph: '地铁站 / 商场' },
  { k: 'avg_price', label: '人均价格', ph: '80', type: 'number' },
  { k: 'rating', label: '评分', ph: '4.5', type: 'number', step: '0.1' },
];

export default function AdminFoodPage({ denied }) {
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | issues
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/foods');
      setFoods((d && d.foods) || []);
    } catch (e) {
      setMsg({ type: 'err', text: '加载失败：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const stats = useMemo(() => {
    const total = foods.length;
    const issue = foods.filter((f) => issuesOf(f).length > 0).length;
    const noRec = foods.filter((f) => !f.recommender).length;
    return { total, issue, noRec };
  }, [foods]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return foods.filter((f) => {
      if (filter === 'issues' && issuesOf(f).length === 0) return false;
      if (!kw) return true;
      return (
        String(f.name || '').toLowerCase().includes(kw) ||
        String(f.cuisine || '').toLowerCase().includes(kw) ||
        String(f.area || '').toLowerCase().includes(kw) ||
        String(f.recommender || '').toLowerCase().includes(kw)
      );
    });
  }, [foods, q, filter]);

  const save = async () => {
    if (!editing || busy) return;
    if (!String(editing.name || '').trim()) {
      setMsg({ type: 'err', text: '店名不能为空' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiPut('/api/foods', {
        id: editing.id,
        name: editing.name,
        cuisine: editing.cuisine || '',
        area: editing.area || '',
        address: editing.address || '',
        feature: editing.feature || '',
        recommender: editing.recommender || '',
        nearby: editing.nearby || '',
        avg_price: editing.avg_price === '' ? null : Number(editing.avg_price),
        rating: editing.rating === '' ? null : Number(editing.rating),
      });
      setMsg({ type: 'ok', text: `已保存「${editing.name}」` });
      setEditing(null);
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '保存失败：' + e.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f) => {
    const ok = window.confirm(`确认删除「${f.name}」？\n\n它的 ${f.reviews?.length || 0} 条饭后评价会一起删除，不可恢复。`);
    if (!ok) return;
    try {
      await apiDelete('/api/foods', { id: f.id });
      setMsg({ type: 'ok', text: `已删除「${f.name}」` });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: '删除失败：' + e.message });
    }
  };

  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }

  // 深色后台页面：白底统计块会亮得刺眼，统一走 .adm-stat（tokens 定义在 layout.css）
  const statBox = (n, label, color) => (
    <div key={label} className="adm-stat" style={{ flex: '1 1 140px' }}>
      <div className="adm-stat-n" style={color ? { color } : undefined}>{n}</div>
      <div className="adm-stat-l">{label}</div>
    </div>
  );

  return (
    <>
      <Head>
        <title>美食管理 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>
            美食<span className="hl">管理</span>
          </h1>
          <p>补全店铺信息 · 标注缺失 · 增删改查</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-tabs" style={{ marginBottom: 16 }}>
            <Link className="adm-tab" href="/admin">赛事管理</Link>
            <Link className="adm-tab" href="/admin/members">群友管理</Link>
            <span className="adm-tab active">美食管理</span>
            <Link className="adm-tab" href="/admin/party">开黑管理</Link>
            <Link className="adm-tab" href="/main">阵容分配</Link>
            <Link className="adm-tab" href="/admin/analytics">访问统计</Link>
            <Link className="adm-tab" href="/admin/support">群友反馈</Link>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {statBox(stats.total, '推荐总数')}
            {statBox(stats.noRec, '缺推荐人', '#B9770E')}
            {statBox(stats.issue, '存在缺漏', '#B9770E')}
          </div>

          <div className="adm-bar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <input
              style={{
                flex: '1 1 240px',
                padding: '9px 12px',
                border: '1px solid var(--border-strong, #ddd)',
                borderRadius: 9,
                fontSize: 14,
              }}
              placeholder="搜索店名 / 菜系 / 区域 / 推荐人"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border-strong, #ddd)' }}
            >
              <option value="all">全部（{foods.length}）</option>
              <option value="issues">有缺漏（{stats.issue}）</option>
            </select>
          </div>

          {msg && (
            <div
              className={msg.type === 'err' ? 'adm-error' : ''}
              style={
                msg.type === 'err'
                  ? { marginBottom: 12 }
                  : { marginBottom: 12, color: '#1E8449', fontSize: 13 }
              }
            >
              {msg.text}
            </div>
          )}

          {loading ? (
            <div className="empty">加载中…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>#</th>
                    <th>店名</th>
                    <th>菜系</th>
                    <th>区域</th>
                    <th>推荐人</th>
                    <th style={{ textAlign: 'right' }}>人均</th>
                    <th style={{ textAlign: 'right' }}>评分</th>
                    <th style={{ textAlign: 'right' }}>评价</th>
                    <th>缺漏</th>
                    <th style={{ width: 128 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-3, #888)', padding: 30 }}>
                        没有符合条件的记录
                      </td>
                    </tr>
                  )}
                  {filtered.map((f, i) => {
                    const iss = issuesOf(f);
                    return (
                      <tr key={f.id}>
                        <td style={{ color: 'var(--text-3, #999)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{f.name}</td>
                        <td>{f.cuisine || <span style={{ color: 'var(--text-3, #aaa)' }}>—</span>}</td>
                        <td>{f.area || <span style={{ color: 'var(--text-3, #aaa)' }}>—</span>}</td>
                        <td style={{ color: f.recommender ? 'inherit' : '#B9770E' }}>
                          {f.recommender || '未填'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{f.avg_price ? `¥${f.avg_price}` : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{f.rating || '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-3, #999)' }}>
                          {f.reviews?.length || 0}
                        </td>
                        <td>
                          {iss.length === 0 ? (
                            <span style={{ color: '#1E8449', fontSize: 12 }}>完整</span>
                          ) : (
                            iss.map((x) => (
                              <Tag key={x.t} lv={x.lv}>
                                {x.t}
                              </Tag>
                            ))
                          )}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...f })}>
                            编辑
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: '#C0392B' }}
                            onClick={() => remove(f)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3, #888)' }}>
            共 {filtered.length} 条
            {filter !== 'all' || q ? `（已筛选，总计 ${foods.length}）` : ''}
          </p>
        </div>
      </section>

      {/* ===== 编辑弹窗 ===== */}
      {editing && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h3>编辑美食</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="modal-body" style={{ padding: '4px 2px 8px' }}>
              {FIELD_DEFS.map((f) => (
                <div key={f.k} style={{ marginBottom: 11 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                    {f.label}
                    {f.required && <span style={{ color: '#C0392B', marginLeft: 3 }}>*</span>}
                  </label>
                  <input
                    type={f.type || 'text'}
                    step={f.step}
                    value={editing[f.k] == null ? '' : editing[f.k]}
                    placeholder={f.ph}
                    onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid var(--border-strong, #ddd)',
                      borderRadius: 8,
                      fontSize: 14,
                    }}
                  />
                </div>
              ))}

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3, #888)', marginBottom: 4 }}>
                  特色描述
                </label>
                <textarea
                  value={editing.feature || ''}
                  onChange={(e) => setEditing({ ...editing, feature: e.target.value })}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border-strong, #ddd)',
                    borderRadius: 8,
                    fontSize: 14,
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/food', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
