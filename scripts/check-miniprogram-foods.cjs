#!/usr/bin/env node
/**
 * 群友美食：菜系 / 地区 / 推荐人 / 人均价格 / 搜索 多维筛选 + 评价展开 —— 回归脚本。
 *
 * 为什么要它：2026-10-30 把小程序美食页对齐网页端时，原本只支持「菜系 + 关键词」，
 *   缺网页端的活动地区 / 推荐人 / 人均价格筛选，搜索范围也偏窄。新增筛选若写错边界
 *   （比如价格区间含错、picker 下标错配），都是不报错的软故障，用本地假接口钉住。
 *
 * 用法：node scripts/check-miniprogram-foods.cjs
 * 纯离线：只监听 127.0.0.1 随机端口，不访问线上、不写库。
 */
const http = require('http');
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const ROOT = path.join(__dirname, '..', 'miniprogram');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};

// 6 家店，覆盖不同 菜系 / 地区 / 推荐人 / 人均，用来验证各筛选维度
const FOODS = [
  { id: '1', name: '川味馆', cuisine: '川菜', area: '南山区', recommender: '张三', avg_price: 80, rating: 4, reviews: [] },
  { id: '2', name: '湘菜小馆', cuisine: '湘菜', area: '南山区', recommender: '李四', avg_price: 60, rating: 5, reviews: [] },
  { id: '3', name: '粤式茶餐厅', cuisine: '粤菜', area: '福田区', recommender: '张三', avg_price: 120, rating: 3, reviews: [] },
  { id: '4', name: '火锅店', cuisine: '火锅', area: '福田区', recommender: '王五', avg_price: 180, rating: 4, reviews: [] },
  { id: '5', name: '日料屋', cuisine: '日料', area: '宝安区', recommender: '李四', avg_price: 300, rating: 5, reviews: [] },
  { id: '6', name: '平价快餐', cuisine: '快餐', area: '宝安区', recommender: '王五', avg_price: 30, rating: 2, reviews: [{ id: 'r1', reviewer: '匿名群友', content: '便宜', rating: 2, created_at: '2026-01-01T00:00:00' }] },
];

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/api/foods')) {
    return res.end(JSON.stringify({ success: true, foods: FOODS }));
  }
  if (req.method === 'DELETE' && req.url.startsWith('/api/food-reviews')) {
    return res.end(JSON.stringify({ success: true }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ success: false, error: 'mock 404' }));
});

const names = (rows) => rows.map((f) => f.name).sort();

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('\n[群友美食回归] 本地假接口 ' + port);

  const rt = createRuntime({
    baseUrl: 'http://127.0.0.1:' + port,
    root: ROOT,
    token: 'faketoken',
  });
  const page = rt.loadPage('pages/foods/foods.js');
  page.onLoad();

  rt.wait(2000)
    .then(() => {
      const all = page.data.list;
      if (all.length === 6) ok('加载到 6 家店');
      else bad('应加载 6 家，实际 ' + all.length);

      // 菜系筛选
      page.onCuisine({ currentTarget: { dataset: { v: '川菜' } } });
      const cai = page.data.list;
      if (cai.length === 1 && cai[0].name === '川味馆') ok('菜系筛选「川菜」只留 川味馆');
      else bad('菜系筛选失效：' + names(cai).join(','));
      page.onCuisine({ currentTarget: { dataset: { v: '全部' } } });

      // 地区筛选
      page.onArea({ currentTarget: { dataset: { v: '南山区' } } });
      const nan = page.data.list;
      if (nan.length === 2) ok('地区筛选「南山区」留 2 家');
      else bad('地区筛选失效：' + names(nan).join(','));
      page.onArea({ currentTarget: { dataset: { v: '全部' } } });

      // 推荐人筛选（picker 返回的是下标，onRecommender 内部按数组取）
      const recIdx = page.data.recommenders.indexOf('张三');
      page.onRecommender({ detail: { value: String(recIdx) } });
      const zhang = page.data.list;
      if (zhang.length === 2 && page.data.recommender === '张三') ok('推荐人筛选「张三」留 2 家');
      else bad('推荐人筛选失效：' + names(zhang).join(',') + ' (rec=' + page.data.recommender + ')');
      page.onRecommender({ detail: { value: '0' } }); // 回到「全部」

      // 人均价格筛选
      page.onPrice({ currentTarget: { dataset: { v: '50-100' } } });
      const price = page.data.list;
      const within = price.every((f) => f.avgPrice >= 50 && f.avgPrice <= 100);
      if (price.length === 2 && within) ok('人均 ¥50-100 留 2 家（80/60）');
      else bad('价格筛选失效：' + names(price).join(',') + ' avg=' + price.map((f) => f.avgPrice));
      page.onPrice({ currentTarget: { dataset: { v: 'all' } } });

      // 搜索
      page.onKeyword({ detail: { value: '火锅' } });
      const kw = page.data.list;
      if (kw.length === 1 && kw[0].name === '火锅店') ok('搜索「火锅」只命中 火锅店');
      else bad('搜索失效：' + names(kw).join(','));
      page.onKeyword({ detail: { value: '' } });

      // 清空
      page.onCuisine({ currentTarget: { dataset: { v: '川菜' } } });
      page.onClear();
      if (page.data.list.length === 6) ok('清空筛选回到 6 家');
      else bad('清空失效，剩 ' + page.data.list.length);

      // 评价展开（延迟加载，不撑爆 setData）
      page.toggleReviews({ currentTarget: { dataset: { id: '6' } } });
      const f6 = page.data.list.filter((f) => f.id === '6')[0];
      if (f6 && f6.expanded && f6.reviews.length === 1) ok('评价展开后加载了 1 条评价');
      else bad('评价展开失败（expanded=' + (f6 && f6.expanded) + ', n=' + (f6 && f6.reviews.length) + '）');
    })
    .then(() => {
      console.log('');
      server.close();
      if (fail) {
        console.log('❌ ' + fail + ' 项未通过\n');
        process.exit(1);
      }
      console.log('✅ 全部通过\n');
      process.exit(0);
    })
    .catch((e) => {
      console.error('回归脚本自身出错：', e);
      server.close();
      process.exit(1);
    });
});
