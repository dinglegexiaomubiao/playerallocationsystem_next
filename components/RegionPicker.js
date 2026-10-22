/**
 * 地区选择器：国家 → 省 → 市 → 区 四级级联。
 *
 * 三个刻意的设计：
 *
 * 1. **数据按需 fetch，不打进 bundle**。行政区划 54KB + 国家 9KB，放 `public/data/`
 *    下用 fetch 拿（浏览器还能缓存）。站点 bundle 已经有 800KB，且 2026-10-22 出过
 *    「老 iOS 上 JS 执行失败」的事故，能不进 bundle 的数据一律不进。
 *
 * 2. **加载失败必须能继续填**。fork 出去的静态文件可能被 CDN/代理折腾，加载不出来
 *    就退回一个纯文本框 —— 绝不能因为选不了地区，把整个资料保存卡死。
 *
 * 3. **老格式自动升级，但不偷偷写库**。历史值是自由文本（`南山`、`龙华，深圳，china`），
 *    打开时尽力猜成规范值填进下拉，并通过 onChange 同步回表单；只有用户点保存才落库。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_COUNTRY, formatRegion, guessRegionFromLegacy, parseRegion } from '../lib/regions';

// 模块级缓存：同一次会话里多个 RegionPicker 只拉一次
let dataPromise = null;
function loadRegionData() {
  if (!dataPromise) {
    dataPromise = Promise.all([
      fetch('/data/countries.json', { cache: 'force-cache' }).then((r) => {
        if (!r.ok) throw new Error('countries ' + r.status);
        return r.json();
      }),
      fetch('/data/china-division.json', { cache: 'force-cache' }).then((r) => {
        if (!r.ok) throw new Error('division ' + r.status);
        return r.json();
      }),
    ])
      .then(([c, d]) => ({ countries: c.countries || [], china: d.china || [] }))
      .catch((e) => {
        dataPromise = null; // 允许下次重试
        throw e;
      });
  }
  return dataPromise;
}

const EMPTY_SEL = { country: '', province: '', city: '', district: '', foreignCity: '' };

/**
 * 空值时的初始态：国家先默认「中国」。
 * 社区在国内，绝大多数人只需要往下选省市区；否则一打开只有一个 246 项的国家下拉，
 * 很容易被当成「就填个国家？」。默认值只影响下拉显示，用户不动就不 emit，
 * 所以不会把空资料写成「中国」。
 */
const DEFAULT_SEL = { ...EMPTY_SEL, country: DEFAULT_COUNTRY };

function partsFromValue(value) {
  const p = parseRegion(value);
  if (!p.raw) return { ...DEFAULT_SEL, legacy: '' };
  if (!p.structured) return { ...DEFAULT_SEL, legacy: p.raw };
  if (p.foreign) {
    return { ...EMPTY_SEL, country: p.country, foreignCity: p.city, legacy: '' };
  }
  return { country: p.country || DEFAULT_COUNTRY, province: p.province, city: p.city, district: p.district, foreignCity: '', legacy: '' };
}

function toValue(sel) {
  if (!sel.country) return '';
  if (sel.country !== DEFAULT_COUNTRY) {
    return formatRegion({ country: sel.country, city: sel.foreignCity });
  }
  return formatRegion({ country: DEFAULT_COUNTRY, province: sel.province, city: sel.city, district: sel.district });
}

export default function RegionPicker({ value = '', onChange, disabled = false, hint = '' }) {
  const [sel, setSel] = useState(() => partsFromValue(value));
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  // 自己发出去的值，用来区分「外部传入的新值」和「刚由内部改动引起的变化」
  const lastEmitted = useRef(null);

  useEffect(() => {
    let alive = true;
    loadRegionData()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const emit = useCallback(
    (next) => {
      setSel(next);
      const v = toValue(next);
      lastEmitted.current = v;
      if (typeof onChange === 'function') onChange(v);
    },
    [onChange]
  );

  // 外部值变了（比如重新拉了一次资料）才回填，避免自己的改动被覆盖
  useEffect(() => {
    if (lastEmitted.current === value) return;
    setSel(partsFromValue(value));
  }, [value]);

  // 数据到位后，把老的自由文本尽力猜成规范值（只同步到表单，不写库）。
  // 必须有「每个旧值只猜一次」的守卫：调用方传进来的 onChange 通常是内联箭头函数，
  // 每次渲染都是新身份 → emit 跟着变 → 这个 effect 每次渲染都会跑一遍，
  // 而它自己又会 setSel 触发下一轮渲染，没有守卫就是死循环。
  const guessedFor = useRef(null);
  // 上一次猜测是否成功，只用来决定提示语措辞（ref 够用：emit 之后必然重渲染）
  const guessedOk = useRef(null);
  useEffect(() => {
    if (!data || !sel.legacy) return;
    if (guessedFor.current === sel.legacy) return;
    guessedFor.current = sel.legacy;
    const guessed = guessRegionFromLegacy(sel.legacy, { china: data.china });
    if (!guessed) return;
    guessedOk.current = sel.legacy;
    // 保留 legacy 标记：提示语要继续显示，让人知道这是自动识别出来的
    emit({ ...partsFromValue(guessed), legacy: sel.legacy });
  }, [data, sel.legacy, emit]);

  const provinceList = useMemo(() => {
    if (!data || sel.country !== DEFAULT_COUNTRY) return [];
    return data.china;
  }, [data, sel.country]);

  const cityList = useMemo(() => {
    if (!data || sel.country !== DEFAULT_COUNTRY || !sel.province) return [];
    return data.china.find((p) => p.name === sel.province)?.cities || [];
  }, [data, sel.country, sel.province]);

  const areaList = useMemo(() => {
    if (!data || !sel.city) return [];
    return cityList.find((c) => c.name === sel.city)?.areas || [];
  }, [data, cityList, sel.city]);

  // ---- 兜底：数据没加载出来就退回纯文本，不能挡住保存 ----
  if (failed) {
    return (
      <div className="region-picker">
        <input
          value={value || ''}
          disabled={disabled}
          maxLength={50}
          placeholder="例如：中国 广东省 深圳市 南山区"
          onChange={(e) => {
            const v = e.target.value;
            lastEmitted.current = v;
            if (typeof onChange === 'function') onChange(v);
          }}
          style={{ flex: '1 1 220px' }}
        />
        <span className="region-picker-note">地区数据没加载出来，可以先手填（格式：国家 省 市 区）</span>
      </div>
    );
  }

  const isChina = sel.country === DEFAULT_COUNTRY;

  return (
    <div className="region-picker">
      <select
        value={sel.country}
        disabled={disabled || !data}
        aria-label="国家或地区"
        onChange={(e) => emit({ ...EMPTY_SEL, country: e.target.value })}
      >
        <option value="">{data ? '请选择国家' : '地区数据加载中…'}</option>
        {(data?.countries || []).map((c) => (
          <option key={c.code} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>

      {isChina && (
        <>
          <select
            value={sel.province}
            disabled={disabled || !data}
            aria-label="省 / 直辖市"
            onChange={(e) => emit({ ...sel, province: e.target.value, city: '', district: '', legacy: '' })}
          >
            <option value="">请选择省 / 直辖市</option>
            {provinceList.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={sel.city}
            disabled={disabled || !sel.province}
            aria-label="市 / 地区"
            onChange={(e) => emit({ ...sel, city: e.target.value, district: '', legacy: '' })}
          >
            <option value="">请选择市 / 地区</option>
            {cityList.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={sel.district}
            disabled={disabled || !sel.city || areaList.length === 0}
            aria-label="区 / 县"
            onChange={(e) => emit({ ...sel, district: e.target.value, legacy: '' })}
          >
            <option value="">
              {!sel.city ? '请先选市 / 地区' : areaList.length ? '请选择区 / 县（可选）' : '该市没有下级区县'}
            </option>
            {areaList.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </>
      )}

      {sel.country && !isChina && (
        <input
          value={sel.foreignCity}
          disabled={disabled}
          maxLength={40}
          placeholder="城市 / 地区，例如：东京都"
          aria-label="城市或地区"
          onChange={(e) => emit({ ...sel, foreignCity: e.target.value, legacy: '' })}
        />
      )}

      {sel.country && (
        <button
          type="button"
          className="btn btn-ghost btn-sm region-picker-clear"
          disabled={disabled}
          onClick={() => emit({ ...EMPTY_SEL })}
        >
          清空
        </button>
      )}

      {sel.legacy && (
        <span className="region-picker-note">
          {guessedOk.current === sel.legacy
            ? `原值是「${sel.legacy}」，已尽量识别；确认无误后保存即可改成标准格式`
            : `原值是「${sel.legacy}」，没能自动识别；在下面选一遍就会换成标准格式`}
        </span>
      )}
      {!sel.legacy && hint && <span className="region-picker-note">{hint}</span>}
    </div>
  );
}
