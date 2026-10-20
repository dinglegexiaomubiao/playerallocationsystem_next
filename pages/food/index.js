import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import ExcelIO from '../../components/ExcelIO';
import { FOOD_COLUMNS } from '../../lib/excel';

const CUISINES = ['全部', '烧烤', '火锅', '川菜', '湘菜', '粤菜', '江浙', '日料', '韩餐', '西餐', '小吃', '甜点', '夜宵', '其他'];
const FORM_CUISINES = CUISINES.filter((c) => c !== '全部');

const EMPTY_FORM = {
  name: '',
  cuisine: '小吃',
  area: '',
  address: '',
  feature: '',
  recommender: '',
  avg_price: '',
  rating: 5,
  nearby: '',
};

function Stars({ n }) {
  const full = Math.max(0, Math.min(5, Number(n) || 0));
  return <div className="f-stars">{'★★★★★'.slice(0, full)}{'☆☆☆☆☆'.slice(0, 5 - full)}</div>;
}

export default function FoodPage() {
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cat, setCat] = useState('全部');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [openReviewId, setOpenReviewId] = useState(null);
  const [reviewForm, setReviewForm] = useState({ reviewer: '', content: '', rating: 5 });

  const load = () => {
    setLoading(true);
    fetch('/api/foods')
      .then((r) => r.json())
      .then((d) => {
        setFoods(d.foods || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (cat === '全部') return foods;
    return foods.filter((f) => f.cuisine === cat);
  }, [foods, cat]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (f) => {
    setForm({
      name: f.name || '',
      cuisine: f.cuisine || '小吃',
      area: f.area || '',
      address: f.address || '',
      feature: f.feature || '',
      recommender: f.recommender || '',
      avg_price: f.avg_price != null ? String(f.avg_price) : '',
      rating: f.rating || 5,
      nearby: f.nearby || '',
    });
    setEditingId(f.id);
    setShowForm(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      alert('请填写店名');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        avg_price: form.avg_price === '' ? null : Number(form.avg_price),
        rating: Number(form.rating) || 5,
      };
      const url = '/api/foods';
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId ? { ...payload, id: editingId } : payload;
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || '提交失败');
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('确定删除这家店及全部评价吗？')) return;
    const r = await fetch('/api/foods', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) load();
  };

  const addReview = async (foodId) => {
    if (!reviewForm.content.trim()) {
      alert('写点什么吧～');
      return;
    }
    const r = await fetch('/api/food-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food_id: foodId, ...reviewForm, rating: Number(reviewForm.rating) || 5 }),
    });
    if (r.ok) {
      setReviewForm({ reviewer: '', content: '', rating: 5 });
      setOpenReviewId(null);
      load();
    } else {
      const d = await r.json();
      alert(d.error || '评价提交失败');
    }
  };

  const removeReview = async (id) => {
    if (!confirm('删除这条评价？')) return;
    const r = await fetch('/api/food-reviews', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) load();
  };

  const handleImportFoods = async (rows) => {
    const list = rows
      .map((row) => ({
        name: String(row['店名'] || '').trim(),
        cuisine: String(row['菜系'] || '').trim(),
        area: String(row['区位'] || '').trim(),
        address: String(row['详细地址'] || '').trim(),
        feature: String(row['特点'] || '').trim(),
        recommender: String(row['推荐人'] || '').trim(),
        avg_price:
          row['美团人均'] === '' || row['美团人均'] === undefined ? null : Number(row['美团人均']) || null,
        rating: Number(row['评分']) || 5,
        nearby: String(row['附近娱乐'] || '').trim(),
      }))
      .filter((f) => f.name);

    if (list.length === 0) {
      alert('没有解析到有效数据，请确认表头与「下载模板」一致');
      return;
    }

    let ok = 0;
    let fail = 0;
    for (const f of list) {
      try {
        const r = await fetch('/api/foods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(f),
        });
        const d = await r.json();
        if (r.ok && d.success) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    alert(`导入完成：成功 ${ok} 条，失败 ${fail} 条`);
    load();
  };

  return (
    <>
      <Head>
        <title>群友美食 · DOTA 群英荟</title>
      </Head>

      <section className="page-hero">
        <div className="wrap" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>
              群友<span className="hl">美食</span>
            </h1>
            <p>共 {foods.length} 家店 · 店名 / 菜系 / 区位 / 人均 / 饭后评价全记录</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ExcelIO
              columns={FOOD_COLUMNS}
              rows={foods}
              filename="群友美食.xlsx"
              templateName="群友美食_导入模板.xlsx"
              onImport={handleImportFoods}
              checkDuplicate={(row, existing) => {
                const name = String(row['店名'] || '').trim();
                const area = String(row['区位'] || '').trim();
                return existing.some((f) => (f.name || '') === name && (f.area || '') === area);
              }}
            />
            <button className="btn btn-primary" onClick={startCreate}>
              ＋ 新增美食
            </button>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {showForm && (
            <form className="food-form" onSubmit={submit}>
              <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 14 }}>
                {editingId ? '编辑美食' : '新增美食'}
              </div>
              <div className="row">
                <div>
                  <label>店名 *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：楼下烧烤摊" />
                </div>
                <div>
                  <label>菜系</label>
                  <select value={form.cuisine} onChange={(e) => setForm({ ...form, cuisine: e.target.value })}>
                    {FORM_CUISINES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <div>
                  <label>区位</label>
                  <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="例如：城南 / 大学城" />
                </div>
                <div>
                  <label>详细地址</label>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="具体到门牌号" />
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <div>
                  <label>推荐人</label>
                  <input value={form.recommender} onChange={(e) => setForm({ ...form, recommender: e.target.value })} placeholder="你的昵称" />
                </div>
                <div>
                  <label>美团人均价格（元）</label>
                  <input type="number" min="0" value={form.avg_price} onChange={(e) => setForm({ ...form, avg_price: e.target.value })} placeholder="例如：45" />
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label>特点</label>
                <input value={form.feature} onChange={(e) => setForm({ ...form, feature: e.target.value })} placeholder="这家店有什么亮点？招牌菜、环境、性价比…" />
              </div>
              <div style={{ marginTop: 12 }}>
                <label>附近娱乐活动</label>
                <input value={form.nearby} onChange={(e) => setForm({ ...form, nearby: e.target.value })} placeholder="例如：隔壁有台球厅 / 网吧 / KTV" />
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <div>
                  <label>评分</label>
                  <select value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} 星
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? '保存中…' : editingId ? '保存修改' : '添加'}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          )}

          <div className="chips" style={{ marginBottom: 22 }}>
            {CUISINES.map((c) => (
              <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>

          {loading && <div className="empty">加载中…</div>}
          {error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="empty">还没有美食，点「＋ 新增美食」添加吧～</div>}

          <div className="food-grid">
            {filtered.map((f) => (
              <div className="f-card" key={f.id}>
                <div className="f-body">
                  <div className="f-top">
                    <div className="f-name">{f.name}</div>
                    {f.cuisine && <span className="f-cat">{f.cuisine}</span>}
                    {f.avg_price != null && <span className="f-price">¥{f.avg_price}/人</span>}
                  </div>
                  <Stars n={f.rating} />

                  <div className="f-meta">
                    {f.area && <div><span className="k">区位</span>{f.area}</div>}
                    {f.address && <div><span className="k">地址</span>{f.address}</div>}
                  </div>

                  {f.feature && <div className="f-feature"><span className="k">特点</span>{f.feature}</div>}
                  {f.nearby && <div className="f-nearby"><span className="k">附近娱乐</span>{f.nearby}</div>}

                  <div className="f-recommender">推荐人：{f.recommender || '匿名群友'}</div>

                  <div className="f-reviews">
                    <div className="f-reviews-head">
                      <span>饭后评价（{(f.reviews || []).length}）</span>
                      <button onClick={() => setOpenReviewId(openReviewId === f.id ? null : f.id)}>
                        {openReviewId === f.id ? '收起' : '＋ 评价'}
                      </button>
                    </div>
                    {(f.reviews || []).map((r) => (
                      <div className="f-review" key={r.id}>
                        <div className="f-review-top">
                          <b>{r.reviewer || '群友'}</b>
                          <span className="f-review-stars">{'★'.repeat(Math.max(1, Math.min(5, r.rating || 5)))}</span>
                          <button className="f-review-del" onClick={() => removeReview(r.id)}>×</button>
                        </div>
                        <div className="f-review-txt">{r.content}</div>
                      </div>
                    ))}
                    {openReviewId === f.id && (
                      <div className="f-review-form">
                        <input
                          placeholder="你的昵称"
                          value={reviewForm.reviewer}
                          onChange={(e) => setReviewForm({ ...reviewForm, reviewer: e.target.value })}
                        />
                        <textarea
                          placeholder="饭后评价一下…"
                          value={reviewForm.content}
                          onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })}
                        />
                        <div className="f-review-actions">
                          <select value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: Number(e.target.value) })}>
                            {[5, 4, 3, 2, 1].map((n) => (
                              <option key={n} value={n}>
                                {n} 星
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-primary" type="button" onClick={() => addReview(f.id)}>
                            提交评价
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="f-foot">
                    <button className="f-edit" onClick={() => startEdit(f)}>编辑</button>
                    <button className="f-del" onClick={() => remove(f.id)}>删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
