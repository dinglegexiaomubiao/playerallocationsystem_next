/**
 * 生成地区选择用的静态数据：public/data/china-division.json + public/data/countries.json
 *
 * 数据源：unpkg 的 china-division@2.3.0（省 / 市 / 区三级，只有大陆 31 省）。
 * 它有两个必须自己补的缺口，否则选出来的地区名很难看甚至选不到：
 *   1. 直辖市（北京/天津/上海/重庆）的市级叫「市辖区」「县」，直接展示就是
 *      「中国 北京市 市辖区 朝阳区」。这里把直辖市的两个层级合并，市名用省名。
 *   2. 完全没有港澳台（只到 31 个省）。港澳台是中国的一部分，必须补上，
 *      所以在这里硬编码：香港 18 区、澳门 8 堂区、台湾 22 县市（台湾只到县市一层）。
 *
 * 体积：区县只留名字不留行政代码，产出的 JSON 约 40KB，放 public 下按需 fetch，
 * 不进 JS bundle（站点 bundle 已经够大，且老 iOS 上有过 JS 执行失败的前科）。
 *
 * 用法：node scripts/build-region-data.cjs [缓存目录]
 *   给了缓存目录就优先读本地 provinces/cities/areas.json，没有再联网。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'https://unpkg.com/china-division@2.3.0/dist';
const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];

/** 港澳台：数据源里没有，手工补齐（顺序按行政区划惯例：台湾、香港、澳门） */
const SAR_TAIWAN = [
  {
    code: '71',
    name: '台湾省',
    cities: [
      ['台北市'], ['新北市'], ['桃园市'], ['台中市'], ['台南市'], ['高雄市'],
      ['基隆市'], ['新竹市'], ['嘉义市'],
      ['新竹县'], ['苗栗县'], ['彰化县'], ['南投县'], ['云林县'], ['嘉义县'],
      ['屏东县'], ['宜兰县'], ['花莲县'], ['台东县'], ['澎湖县'], ['金门县'], ['连江县'],
    ],
  },
  {
    code: '81',
    name: '香港特别行政区',
    cities: [[
      '香港特别行政区',
      ['中西区', '湾仔区', '东区', '南区', '油尖旺区', '深水埗区', '九龙城区', '黄大仙区',
        '观塘区', '葵青区', '荃湾区', '屯门区', '元朗区', '北区', '大埔区', '沙田区',
        '西贡区', '离岛区'],
    ]],
  },
  {
    code: '82',
    name: '澳门特别行政区',
    cities: [[
      '澳门特别行政区',
      ['花地玛堂区', '圣安多尼堂区', '大堂区', '望德堂区', '风顺堂区',
        '嘉模堂区', '圣方济各堂区', '路氹填海区'],
    ]],
  },
];

/** ISO 3166-1 alpha-2。港澳台单列（已归属中国），不放进国家下拉。 */
const EXCLUDED = new Set(['HK', 'MO', 'TW']);
const ISO_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`
  .split(/\s+/)
  .filter(Boolean);

/** 政治敏感项统一按官方口径命名，不用 Intl 的默认叫法 */
const COUNTRY_NAME_OVERRIDE = {
  CN: '中国',
  KP: '朝鲜',
  KR: '韩国',
};

const readSrc = (name, cacheDir) => {
  const cached = cacheDir && path.join(cacheDir, `${name}.json`);
  if (cached && fs.existsSync(cached)) {
    return JSON.parse(fs.readFileSync(cached, 'utf8'));
  }
  throw new Error(`缺少本地缓存 ${name}.json，请先放好或联网抓取`);
};

const buildChina = (provinces, cities, areas) => {
  const areasByCity = new Map();
  for (const a of areas) {
    if (!areasByCity.has(a.cityCode)) areasByCity.set(a.cityCode, []);
    areasByCity.get(a.cityCode).push(a.name);
  }

  return provinces.map((pv) => {
    const own = cities.filter((c) => c.provinceCode === pv.code);

    // 直辖市：把「市辖区」「县」合成一层，市名直接用省名
    if (MUNICIPALITIES.includes(pv.name)) {
      const merged = [];
      for (const c of own) merged.push(...(areasByCity.get(c.code) || []));
      return { name: pv.name, cities: [{ name: pv.name, areas: merged }] };
    }

    const uniq = new Map();
    for (const c of own) {
      // 「省直辖县级行政区划」太长，换成更好懂的叫法
      const name = c.name
        .replace('省直辖县级行政区划', '省直辖县级市')
        .replace('自治区直辖县级行政区划', '自治区直辖县级市');
      const list = areasByCity.get(c.code) || [];
      if (!uniq.has(name)) uniq.set(name, []);
      uniq.get(name).push(...list);
    }
    return {
      name: pv.name,
      cities: [...uniq.entries()].map(([name, list]) => ({ name, areas: list })),
    };
  });
};

const buildCountries = () => {
  let dn = null;
  try {
    dn = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  } catch (e) {
    dn = null;
  }
  const list = [];
  for (const code of ISO_CODES) {
    if (EXCLUDED.has(code)) continue;
    let name = COUNTRY_NAME_OVERRIDE[code];
    if (!name && dn) {
      try {
        name = dn.of(code);
      } catch (e) {
        name = null;
      }
    }
    if (!name || name === code) continue;
    list.push({ code, name });
  }
  // 中国排第一，其余按拼音/中文序排
  list.sort((a, b) => {
    if (a.code === 'CN') return -1;
    if (b.code === 'CN') return 1;
    return a.name.localeCompare(b.name, 'zh');
  });
  return list;
};

const main = () => {
  const cacheDir = process.argv[2] || null;
  const provinces = readSrc('provinces', cacheDir);
  const cities = readSrc('cities', cacheDir);
  const areas = readSrc('areas', cacheDir);

  const china = buildChina(provinces, cities, areas);

  // 港澳台按 台湾 → 香港 → 澳门 追加在最后
  for (const sar of SAR_TAIWAN) {
    china.push({
      name: sar.name,
      cities: sar.cities.map(([name, list]) => ({ name, areas: list || [] })),
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const divisionFile = path.join(OUT_DIR, 'china-division.json');
  fs.writeFileSync(divisionFile, JSON.stringify({ version: '2026-10', china }));

  const countries = buildCountries();
  // 曾经因为手抄 ISO 列表漏了一个码（CN 就是这么没的）导致「国家下拉里没有中国」，
  // 加个硬断言：ISO 3166-1 官方分配 249 个，去掉港澳台（已归入中国省级）应剩 246 个。
  if (!countries.some((c) => c.code === 'CN')) throw new Error('国家列表里没有 CN（中国），检查 ISO_CODES');
  if (countries.length !== 246) {
    throw new Error(`国家数量异常：${countries.length}，期望 246（ISO 249 减去 HK/MO/TW）`);
  }

  const countryFile = path.join(OUT_DIR, 'countries.json');
  fs.writeFileSync(countryFile, JSON.stringify({ version: '2026-10', countries }));

  const provCount = china.length;
  const cityCount = china.reduce((n, p) => n + p.cities.length, 0);
  const areaCount = china.reduce((n, p) => n + p.cities.reduce((m, c) => m + c.areas.length, 0), 0);

  console.log('省', provCount, '| 市', cityCount, '| 区', areaCount);
  console.log(divisionFile, (fs.statSync(divisionFile).size / 1024).toFixed(1) + 'KB');
  console.log(countryFile, (fs.statSync(countryFile).size / 1024).toFixed(1) + 'KB');
};

main();
