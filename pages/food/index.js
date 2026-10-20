import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import ExcelIO from '../../components/ExcelIO';
import { FOOD_COLUMNS, pickAlias, parseReviews } from '../../lib/excel';

// 美团人均价格区间（元）。min/max 为 null 表示该侧不设限
const PRICE_RANGES = [
  { value: 'all', label: '不限', min: null, max: null },
  { value: '0-50', label: '¥50 以下', min: null, max: 50 },
  { value: '50-100', label: '¥50-100', min: 50, max: 100 },
  { value: '100-200', label: '¥100-200', min: 100, max: 200 },
  { value: '200-500', label: '¥200-500', min: 200, max: 500 },
  { value: '500+', label: '¥500 以上', min: 500, max: null },
];

const EMPTY_FILTERS = { cuisine: '全部', area: '全部', recommender: '全部', price: 'all' };

// 兼容不同来源表格的表头写法：
// 原始群友表用「美团人均价格」「饭后附近娱乐活动（备注）」「群友饭后评价」，
// 站内模板用「美团人均」「附近娱乐」「群友饭后评价」，两种都要能认。
const FOOD_FIELD_ALIASES = {
  name: ['店名', '店铺名称', '店铺', '餐厅名称', '餐厅'],
  cuisine: ['菜系', '类型', '品类'],
  area: ['区位', '区域', '行政区', '片区'],
  address: ['详细地址', '地址', '门店地址'],
  feature: ['特点', '特色', '招牌'],
  recommender: ['推荐人', '推荐者'],
  avg_price: ['美团人均', '美团人均价格', '人均', '人均价格', '人均消费'],
  rating: ['评分', '星级', '打分'],
  nearby: ['附近娱乐', '饭后附近娱乐活动（备注）', '饭后附近娱乐活动', '附近娱乐活动', '饭后娱乐'],
  review: ['群友饭后评价', '群友评价', '饭后评价', '评价', '点评', '群友点评'],
};

// 清掉单元格内换行（如店名里夹了换行的门店后缀），并按库字段长度截断
const clean = (v, max) =>
  String(v === null || v === undefined ? '' : v)
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\s+([（(])/g, '$1')
    .trim()
    .slice(0, max || 10000);

// 店名/区位归一化比对：忽略全部空白与英文大小写差异，
// 避免同一家店因「换行 vs 空格」等排版差异被重复创建
const shopKey = (name, area) =>
  `${String(name || '').replace(/\s+/g, '').toUpperCase()}||${String(area || '')
    .replace(/\s+/g, '')
    .toUpperCase()}`;

const reviewKey = (reviewer, content) =>
  `${String(reviewer || '').trim()}|${String(content || '').trim()}`;

// 预览弹窗用：统计本次文件里一共带了多少条群友评价
const countReviews = (rows) =>
  rows.reduce((n, row) => n + parseReviews(pickAlias(row, FOOD_FIELD_ALIASES.review)).length, 0);

const EMPTY_FORM = {
  name: '',
  cuisine: '',
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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [openReviewId, setOpenReviewId] = useState(null);
  const [reviewForm, setReviewForm] = useState({ reviewer: '', content: '', rating: 5 });
  // 当前登录身份；null 表示尚未确认（此时不渲染导入导出，避免闪一下再隐藏）
  const [me, setMe] = useState(null);

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
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setMe(d || { isAdmin: false }))
      .catch(() => setMe({ isAdmin: false }));
  }, []);

  // 筛选项全部从真实数据里生成，并按出现次数降序排列（菜系多达 50+ 种，写死列表会漏）
  const facets = useMemo(() => {
    const build = (field) => {
      const m = new Map();
      foods.forEach((f) => {
        const v = String(f[field] === null || f[field] === undefined ? '' : f[field]).trim();
        if (v) m.set(v, (m.get(v) || 0) + 1);
      });
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
    };
    return { cuisine: build('cuisine'), area: build('area'), recommender: build('recommender') };
  }, [foods]);

  // 各价格区间命中数（只统计有标价的店）
  const priceFacets = useMemo(
    () =>
      PRICE_RANGES.map((r) => ({
        ...r,
        count: foods.filter((f) => {
          const v = f.avg_price;
          if (v === null || v === undefined) return false;
          if (r.min !== null && v < r.min) return false;
          if (r.max !== null && v >= r.max) return false;
          return true;
        }).length,
      })),
    [foods]
  );

  const filtered = useMemo(() => {
    const price = PRICE_RANGES.find((r) => r.value === filters.price);
    return foods.filter((f) => {
      if (filters.cuisine !== '全部' && String(f.cuisine || '').trim() !== filters.cuisine) return false;
      if (filters.area !== '全部' && String(f.area || '').trim() !== filters.area) return false;
      if (filters.recommender !== '全部' && String(f.recommender || '').trim() !== filters.recommender) return false;
      if (price && price.value !== 'all') {
        const v = f.avg_price;
        if (v === null || v === undefined) return false;
        if (price.min !== null && v < price.min) return false;
        if (price.max !== null && v >= price.max) return false;
      }
      return true;
    });
  }, [foods, filters]);

  const activeCount =
    (filters.cuisine !== '全部' ? 1 : 0) +
    (filters.area !== '全部' ? 1 : 0) +
    (filters.recommender !== '全部' ? 1 : 0) +
    (filters.price !== 'all' ? 1 : 0);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (f) => {
    setForm({
      name: f.name || '',
      cuisine: f.cuisine || '',
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

  const handleImportFoods = async (rows, onProgress) => {
    const list = rows
      .map((row) => {
        const reviews = parseReviews(pickAlias(row, FOOD_FIELD_ALIASES.review));
        const avgRaw = pickAlias(row, FOOD_FIELD_ALIASES.avg_price);
        return {
          food: {
            name: clean(pickAlias(row, FOOD_FIELD_ALIASES.name), 100),
            cuisine: clean(pickAlias(row, FOOD_FIELD_ALIASES.cuisine), 30),
            area: clean(pickAlias(row, FOOD_FIELD_ALIASES.area), 50),
            address: clean(pickAlias(row, FOOD_FIELD_ALIASES.address), 200),
            feature: clean(pickAlias(row, FOOD_FIELD_ALIASES.feature), 300),
            recommender: clean(pickAlias(row, FOOD_FIELD_ALIASES.recommender), 50),
            avg_price: avgRaw === '' ? null : Number(String(avgRaw).replace(/[^\d.]/g, '')) || null,
            rating: Number(pickAlias(row, FOOD_FIELD_ALIASES.rating)) || 5,
            nearby: clean(pickAlias(row, FOOD_FIELD_ALIASES.nearby), 200),
          },
          reviews,
        };
      })
      .filter((x) => x.food.name);

    if (list.length === 0) {
      alert('没有解析到有效数据，请确认表头包含「店名」列（可用「下载模板」对照）');
      return;
    }

    // 已有店铺按「店名+区位」建索引，命中则复用，不重复建店（等同于补录评价）
    const index = new Map();
    const reviewSeen = new Map();
    const seed = (f) => {
      index.set(shopKey(f.name, f.area), f);
      reviewSeen.set(String(f.id), new Set((f.reviews || []).map((r) => reviewKey(r.reviewer, r.content))));
    };
    (foods || []).forEach(seed);

    const total = list.length;
    let reviewAdded = 0;

    for (let i = 0; i < total; i++) {
      const { food, reviews } = list[i];
      let err = '';
      try {
        const key = shopKey(food.name, food.area);
        let target = index.get(key);

        if (!target) {
          const r = await fetch('/api/foods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-excel-import': '1' },
            body: JSON.stringify(food),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.success) {
            throw new Error(d.error || d.message || `请求失败（HTTP ${r.status}）`);
          }
          target = d.food;
          seed(target);
        }

        // 逐条挂评价，已存在（同署名+同内容）的跳过
        if (reviews.length > 0) {
          const seen = reviewSeen.get(String(target.id)) || new Set();
          for (const rv of reviews) {
            const rk = reviewKey(rv.reviewer, rv.content);
            if (seen.has(rk)) continue;
            const rr = await fetch('/api/food-reviews', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-excel-import': '1' },
              body: JSON.stringify({
                food_id: target.id,
                reviewer: String(rv.reviewer || '').slice(0, 50),
                content: String(rv.content || '').slice(0, 300),
              }),
            });
            const rd = await rr.json().catch(() => ({}));
            if (rr.ok && rd.success) {
              seen.add(rk);
              reviewAdded += 1;
            } else if (!err) {
              err = `评价写入失败：${rd.error || rd.message || `HTTP ${rr.status}`}`;
            }
          }
          reviewSeen.set(String(target.id), seen);
        }
      } catch (e) {
        err = (e && e.message) || '网络错误';
      }
      if (onProgress) onProgress(i + 1, total, { name: food.name, error: err });
    }

    if (reviewAdded > 0) {
      // 让结果面板能体现评价写入量（追加到失败明细之外的信息位）
      if (onProgress) onProgress(total, total, { name: `已写入 ${reviewAdded} 条群友评价`, error: '' });
    }
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
              canManage={!!(me && me.isAdmin)}
              countReviews={countReviews}
              importHint="已存在的店铺（店名+区位相同）不会重复创建，只补录其群友评价；同一格内换行分隔的多条评价会拆成多条记录。"
              checkDuplicate={(row, existing) => {
                const key = shopKey(
                  clean(pickAlias(row, FOOD_FIELD_ALIASES.name), 100),
                  clean(pickAlias(row, FOOD_FIELD_ALIASES.area), 50)
                );
                return existing.some((f) => shopKey(f.name, f.area) === key);
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
                  <input
                    list="food-cuisine-options"
                    value={form.cuisine}
                    onChange={(e) => setForm({ ...form, cuisine: e.target.value })}
                    placeholder="可输入新菜系，或从已有中选"
                  />
                  <datalist id="food-cuisine-options">
                    {facets.cuisine.map(([k]) => (
                      <option key={k} value={k} />
                    ))}
                  </datalist>
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

          <div className="filter-bar">
            <div className="filter-field">
              <label>菜系</label>
              <select
                className={filters.cuisine !== '全部' ? 'is-active' : ''}
                value={filters.cuisine}
                onChange={(e) => setFilters({ ...filters, cuisine: e.target.value })}
              >
                <option value="全部">全部菜系（{foods.length}）</option>
                {facets.cuisine.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k}（{n}）
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label>区位</label>
              <select
                className={filters.area !== '全部' ? 'is-active' : ''}
                value={filters.area}
                onChange={(e) => setFilters({ ...filters, area: e.target.value })}
              >
                <option value="全部">全部区位（{foods.length}）</option>
                {facets.area.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k}（{n}）
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label>推荐人</label>
              <select
                className={filters.recommender !== '全部' ? 'is-active' : ''}
                value={filters.recommender}
                onChange={(e) => setFilters({ ...filters, recommender: e.target.value })}
              >
                <option value="全部">全部推荐人（{foods.length}）</option>
                {facets.recommender.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k}（{n}）
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label>美团人均</label>
              <select
                className={filters.price !== 'all' ? 'is-active' : ''}
                value={filters.price}
                onChange={(e) => setFilters({ ...filters, price: e.target.value })}
              >
                {priceFacets.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value === 'all' ? `不限（${r.count} 家有标价）` : `${r.label}（${r.count}）`}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-summary">
              <span>
                筛出 <b>{filtered.length}</b> / {foods.length} 家
              </span>
              {activeCount > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  重置
                </button>
              )}
            </div>
          </div>

          {loading && <div className="empty">加载中…</div>}
          {error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            activeCount > 0 ? (
              <div className="empty">
                没有符合条件的美食
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 10 }}
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  清除筛选
                </button>
              </div>
            ) : (
              <div className="empty">还没有美食，点「＋ 新增美食」添加吧～</div>
            )
          )}

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
