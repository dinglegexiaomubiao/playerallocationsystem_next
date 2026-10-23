import { useState } from 'react';
import Link from 'next/link';
import {
  ACTIVITY_TYPES,
  ACTIVITY_COSTS,
  activityTypeLabel,
} from '../lib/options.mjs';
import { apiPost } from '../lib/api-client.mjs';
import RegionPicker from './RegionPicker';

// datetime-local 需要一个不带时区的本地时间字符串；默认给「明天同一钟点」
function defaultMeetAt() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

// 活动持续时间选项比开黑更长（爬山/钓鱼经常是一整天）
const ACTIVITY_DURATION_OPTIONS = [
  { min: 60, label: '1 小时' },
  { min: 120, label: '2 小时' },
  { min: 180, label: '3 小时' },
  { min: 240, label: '4 小时' },
  { min: 360, label: '6 小时' },
  { min: 480, label: '8 小时（半天）' },
  { min: 720, label: '12 小时' },
  { min: 1440, label: '1 天' },
  { min: 2880, label: '2 天' },
];

const ACTIVITY_PEOPLE_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30];

// 活动名称默认值：与服务端 defaultTitle() 保持同一口径。
function defaultTitle(me, type) {
  const nick = (me && (me.nickname || me.groupNickname)) || '';
  return `${nick || '群友'}的${activityTypeLabel(type) || '活动'}`;
}

/**
 * 新建活动招募。
 * 与开黑的区别：不要求绑定选手资料（约饭爬山不需要段位），但多了
 * 地区（RegionPicker）+ 具体地点、费用方式；报名时再填携伴人数。
 */
export default function ActivityForm({ me, onCreated, onClose }) {
  const [type, setType] = useState(ACTIVITY_TYPES[0].key);
  const [f, setF] = useState(() => ({
    title: defaultTitle(me, ACTIVITY_TYPES[0].key),
    region: '',
    location: '',
    meet_at: defaultMeetAt(),
    duration_min: 120,
    need_people: 4,
    cost: '',
    note: '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    setErr('');
    if (!f.meet_at) {
      setErr('请选择集合时间');
      return;
    }
    // datetime-local 给的是「用户本地墙钟」，必须在浏览器里就转成绝对瞬间再提交，
    // 否则服务端用它自己的时区去解析（生产常见 UTC），时间会差 8 小时。
    const meetInstant = new Date(f.meet_at);
    if (isNaN(meetInstant.getTime())) {
      setErr('集合时间格式不正确，请重新选择');
      return;
    }
    if (!(Number(f.need_people) >= 1 && Number(f.need_people) <= 50)) {
      setErr('请填写需要几个人（1~50）');
      return;
    }
    if (!f.location.trim()) {
      setErr('请填写具体集合地点');
      return;
    }
    setBusy(true);
    const body = {
      type,
      title: f.title.trim() || null,
      region: f.region || null,
      location: f.location.trim(),
      meet_at: meetInstant.toISOString(),
      tz_offset: new Date().getTimezoneOffset(),
      duration_min: Number(f.duration_min),
      need_people: Number(f.need_people),
      cost: f.cost || null,
      note: f.note.trim() || null,
    };
    try {
      const d = await apiPost('/api/activities', body);
      if (d && d.success) onCreated && onCreated(d.id, d.title);
      else setErr((d && d.error) || '发布失败，请稍后再试');
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <div className="party-form act-form">
        <div className="party-form-head">
          <h3>发起活动</h3>
        </div>
        <div className="party-lock">
          发起活动需要先登录。
          <Link href="/login?from=/activities" className="btn btn-sm btn-primary">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  // 活动不要求绑定选手资料，绑定与否都能发；这里不强制作弊锁。
  return (
    <div className="party-form act-form">
      <div className="party-form-head">
        <h3>发起活动</h3>
        <button type="button" className="adm-close" aria-label="收起" onClick={onClose}>
          ×
        </button>
      </div>

      {err && <div className="adm-error">{err}</div>}

      <div className="party-section-label">① 活动类型</div>
      <div className="party-modes act-types">
        {ACTIVITY_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'party-mode-opt act-type-opt' + (type === t.key ? ' active' : '')}
            onClick={() => {
              // 切换类型时同步刷新默认标题（用户没手改的前提下）
              const oldDefault = defaultTitle(me, type);
              setType(t.key);
              setF((prev) => ({
                ...prev,
                title: prev.title === oldDefault || !prev.title ? defaultTitle(me, t.key) : prev.title,
              }));
            }}
          >
            <b>{t.label}</b>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="party-section-label">② 活动名称</div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>
          活动名称 <span className="field-note">（不填就默认「{defaultTitle(me, type)}」）</span>
        </label>
        <input
          value={f.title}
          onChange={(e) => set('title', e.target.value)}
          maxLength={80}
          placeholder={defaultTitle(me, type)}
        />
        <div className="party-hint">作为卡片标题显示在列表里，方便一眼看出是谁在约。</div>
      </div>

      <div className="party-section-label">③ 集合地点</div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>地区（省市区，选填）</label>
        <RegionPicker value={f.region} onChange={(v) => set('region', v)} hint="可只填具体地点" />
      </div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>具体地点</label>
        <input
          value={f.location}
          onChange={(e) => set('location', e.target.value)}
          maxLength={160}
          placeholder="如：海岸城星巴克门口 / 塘朗山荔云登山口"
        />
        <div className="party-hint">地区和具体地点结合，方便大家找到集合点。</div>
      </div>

      <div className="party-section-label">④ 时间与人数</div>
      <div className="form-row" style={{ marginBottom: 8 }}>
        <div className="form-field">
          <label>集合时间</label>
          <input
            type="datetime-local"
            value={f.meet_at}
            onChange={(e) => set('meet_at', e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>持续多久</label>
          <select value={f.duration_min} onChange={(e) => set('duration_min', e.target.value)}>
            {ACTIVITY_DURATION_OPTIONS.map((o) => (
              <option key={o.min} value={o.min}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="party-hint">超过「集合时间 + 持续时间」后，卡片会自动标记为已过期。</div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>需要几个人（含你自己，携伴人数报名时另填）</label>
        <div className="chips">
          {ACTIVITY_PEOPLE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={'chip' + (Number(f.need_people) === n ? ' active' : '')}
              onClick={() => set('need_people', n)}
            >
              {n} 人
            </button>
          ))}
        </div>
        <div className="party-need-row">
          <input
            type="number"
            min="1"
            max="50"
            value={f.need_people}
            onChange={(e) => set('need_people', e.target.value)}
            aria-label="需要几个人"
          />
          <span>人 · 可直接输入 1~50</span>
        </div>
      </div>

      <div className="party-section-label">⑤ 费用方式</div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>费用</label>
        <select value={f.cost} onChange={(e) => set('cost', e.target.value)}>
          <option value="">未指定</option>
          {ACTIVITY_COSTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="form-field" style={{ marginBottom: 16 }}>
        <label>备注</label>
        <textarea
          rows={3}
          value={f.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="集合细节、需要带什么、交通建议……"
        />
      </div>

      <div className="party-form-foot">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              发布中…
            </>
          ) : (
            '发布活动'
          )}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <span className="party-form-hint">发布后会显示你的群友昵称，其他人可点进你的资料页</span>
      </div>
    </div>
  );
}
