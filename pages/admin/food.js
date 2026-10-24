import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSession, isAdmin } from '../../lib/auth';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api-client.mjs';
import RegionPicker from '../../components/RegionPicker';
import { regionShort } from '../../lib/regions';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

/**
 * 美食管理。
 *
 * 缺漏检测只标「影响群友找店」的三项：推荐人、地址、区位。
 * 菜系和评分缺了也照样能去吃，标成同级的红字只会让整列都是红的，反而没人看。
 */
function issuesOf(f) {
  const out = [];
  if (!f.recommender) out.push({ t: '缺推荐人', lv: 'warn' });
  if (!f.address) out.push({ t: '缺地址', lv: 'warn' });
  if (!f.region && !f.area) out.push({ t: '缺区位', lv: 'warn' });
  if (!f.cuisine) out.push({ t: '缺菜系', lv: 'quiet' });
  if (!f.rating) out.push({ t: '没人打分', lv: 'quiet' });
  return out;
}

const FIELD_DEFS = [
  { k: 'name', label: '店名', ph: '必填', required: true },
  { k: 'cuisine', label: '菜系', ph: '川菜 / 粤菜 / 日料…' },
  { k: 'area', label: '区位', picker: 'region' },
  { k: 'address', label: '地址', ph: '详细地址，能让人导航过去' },
  { k: 'recommender', label: '谁推荐的', ph: '群昵称' },
  { k: 'nearby', label: '附近地标', ph: '地铁站 / 商场' },
  { k: 'avg_price', label: '人均', ph: '80', type: 'number' },
  { k: 'rating', label: '评分', ph: '4.5', type: 'number', step: '0.1' },
];

const EMPTY = {
  id: null,
  name: '',
  cuisine: '',
  region: '',
  area: '',
  address: '',
  feature: '',
  recommender: '',
  nearby: '',
  avg_price: '',
  rating: '',
};

export default function AdminFoodPage({ denied }) {
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/foods');
      setFoods((d && d.foods) || []);
    } catch (e) {
      setMsg({ type: 'err', text: '没读出来：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!denied) load();
  }, [denied, load]);

  const stats = useMemo(() => {
    const issue = foods.filter((f) => issuesOf(f).length > 0).length;
    const noRec = foods.filter((f) => !f.recommender).length;
    const reviews = foods.reduce((n, f) => n + (f.reviews?.length || 0), 0);
    return { total: foods.length, issue, noRec, reviews };
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
        String(f.region || '').toLowerCase().includes(kw) ||
        String(f.recommender || '').toLowerCase().includes(kw)
      );
    });
  }, [foods, q, filter]);

  const save = async () => {
    if (!editing || busy) return;
    if (!String(editing.name || '').trim()) {
      setMsg({ type: 'err', text: '店名总得有一个' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const body = {
      id: editing.id,
      name: editing.name,
      cuisine: editing.cuisine || '',
      area: editing.area || '',
      region: editing.region || '',
      address: editing.address || '',
      feature: editing.feature || '',
      recommender: editing.recommender || '',
      nearby: editing.nearby || '',
      avg_price: editing.avg_price === '' ? null : Number(editing.avg_price),
      rating: editing.rating === '' ? null : Number(editing.rating),
    };
    try {
      if (editing.id) await apiPut('/api/foods', body);
      else await apiPost('/api/foods', body);
      setMsg({ type: 'ok', text: editing.id ? `「${editing.name}」改好了` : `「${editing.name}」加进去了` });
      setEditing(null);
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f) => {
    const n = f.reviews?.length || 0;
    const ok = window.confirm(
      `删掉「${f.name}」？\n\n${n ? `它的 ${n} 条评价会一起删掉，` : ''}删了找不回来。`
    );
    if (!ok) return;
    try {
      await apiDelete('/api/foods', { id: f.id });
      setMsg({ type: 'ok', text: `「${f.name}」删掉了` });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    }
  };

  if (denied) return <AdminDenied hint="美食要改要删，得用管理员账号。" />;

  return (
    <AdminShell
      title="美食"
      accent="管理"
      active="food"
      lead="群里推荐过的店。缺推荐人、缺地址的这种补一句，别人才找得到。"
      preview={{ href: '/food', label: '看美食页' }}
      metrics={[
        { n: stats.total, label: '家店' },
        { n: stats.reviews, label: '条评价' },
        { n: stats.noRec, label: '缺推荐人', warn: stats.noRec > 0 },
        { n: stats.issue, label: '有缺漏', warn: stats.issue > 0 },
      ]}
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            刷新
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY })}>
            ＋ 加一家
          </button>
        </>
      }
    >
      {msg && <div className={'adm-flash is-' + (msg.type === 'ok' ? 'ok' : 'err')}>{msg.text}</div>}

      <div className="adm-tool">
        <input
          className="adm-search"
          placeholder="搜店名 / 菜系 / 区域 / 推荐人"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="adm-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部（{foods.length}）</option>
          <option value="issues">有缺漏（{stats.issue}）</option>
        </select>
        <span className="adm-tool-note">
          {filtered.length} / {foods.length}
        </span>
      </div>

      {loading ? (
        <div className="adm-empty">读着呢…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">{foods.length === 0 ? '还没有推荐过店。' : '没有符合的店。'}</div>
      ) : (
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th style={{ width: 42 }}>#</th>
                <th>店名</th>
                <th style={{ width: 96 }}>菜系</th>
                <th style={{ width: 130 }}>在哪</th>
                <th style={{ width: 96 }}>推荐人</th>
                <th className="is-num" style={{ width: 62 }}>人均</th>
                <th className="is-num" style={{ width: 56 }}>评分</th>
                <th className="is-num" style={{ width: 56 }}>评价</th>
                <th style={{ width: 190 }}>缺什么</th>
                <th style={{ width: 96 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => {
                const iss = issuesOf(f);
                return (
                  <tr key={f.id}>
                    <td className="is-weak">{i + 1}</td>
                    <td className="is-strong">{f.name}</td>
                    <td>{f.cuisine || <span className="is-weak">—</span>}</td>
                    <td>{f.region ? regionShort(f.region) : f.area || <span className="is-weak">—</span>}</td>
                    <td className={f.recommender ? '' : 'is-weak'}>{f.recommender || '没写'}</td>
                    <td className="is-num">{f.avg_price ? `¥${f.avg_price}` : '—'}</td>
                    <td className="is-num">{f.rating || '—'}</td>
                    <td className="is-num">{f.reviews?.length || 0}</td>
                    <td>
                      {iss.length === 0 ? (
                        <span className="adm-chip is-ok">齐了</span>
                      ) : (
                        iss.map((x) => (
                          <span key={x.t} className={'adm-chip' + (x.lv === 'quiet' ? '' : ' is-warn')}>
                            {x.t}
                          </span>
                        ))
                      )}
                    </td>
                    <td>
                      <div className="adm-ops">
                        <button className="adm-link-btn" onClick={() => setEditing({ ...f })}>
                          改
                        </button>
                        <button
                          className="adm-link-btn"
                          style={{ color: 'var(--accent)' }}
                          onClick={() => remove(f)}
                        >
                          删
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div
          className="modal-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h3>{editing.id ? '改店铺信息' : '加一家店'}</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>

            <div className="modal-body" style={{ padding: '4px 2px 8px' }}>
              {FIELD_DEFS.map((f) => (
                <div className="adm-field" key={f.k}>
                  <label className="adm-label">
                    {f.label}
                    {f.required && <span style={{ color: 'var(--accent)', marginLeft: 3 }}>*</span>}
                  </label>
                  {f.picker === 'region' ? (
                    <RegionPicker
                      value={editing.region || editing.area || ''}
                      onChange={(v) => setEditing((prev) => ({ ...prev, region: v }))}
                      hint="跟群友地区同一套国/省/市/区"
                    />
                  ) : (
                    <input
                      className="adm-input"
                      type={f.type || 'text'}
                      step={f.step}
                      value={editing[f.k] == null ? '' : editing[f.k]}
                      placeholder={f.ph}
                      onChange={(e) => setEditing({ ...editing, [f.k]: e.target.value })}
                    />
                  )}
                </div>
              ))}

              <div className="adm-field">
                <label className="adm-label">特色（一句话，别写成广告词）</label>
                <textarea
                  className="adm-input"
                  value={editing.feature || ''}
                  onChange={(e) => setEditing({ ...editing, feature: e.target.value })}
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                算了
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? '存着…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/food', permanent: false } };
  }
  return { props: { denied: !isAdmin(req) } };
}
