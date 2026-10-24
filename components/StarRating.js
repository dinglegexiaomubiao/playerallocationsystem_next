import { useState } from 'react';

/**
 * 半星评分控件。
 *
 * 用法：
 *   <StarRating value={4.5} readOnly />            // 只展示
 *   <StarRating value={score} onChange={setScore} /> // 可点
 *
 * 评分是 0~5、0.5 步进。每颗星左半 = x.5，右半 = x（两个透明按钮盖在星上）。
 * 展示态用「底色星 + 按百分比裁切的金色星」叠出来，半星自然呈现。
 */

const STARS = [1, 2, 3, 4, 5];

const fillFor = (value, i) => {
  const pct = (value - (i - 1)) * 100;
  return Math.max(0, Math.min(100, pct));
};

export default function StarRating({ value = 0, onChange, readOnly = false, size = 'md' }) {
  const [hover, setHover] = useState(null);
  const shown = hover != null ? hover : value;

  if (readOnly) {
    return (
      <span className={'star-rating is-' + size} aria-label={'评分 ' + value + ' 分'}>
        {STARS.map((i) => (
          <span className="star" key={i}>
            <span className="star-empty">★</span>
            <span className="star-fill" style={{ width: fillFor(shown, i) + '%' }}>
              ★
            </span>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      className={'star-rating is-interactive is-' + size}
      role="radiogroup"
      aria-label="给这句话打分"
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((i) => (
        <span className="star" key={i}>
          <span className="star-empty">★</span>
          <span className="star-fill" style={{ width: fillFor(shown, i) + '%' }}>
            ★
          </span>
          <button
            type="button"
            className="star-hit left"
            aria-label={i - 0.5 + ' 分'}
            onClick={() => onChange(i - 0.5)}
            onMouseEnter={() => setHover(i - 0.5)}
          />
          <button
            type="button"
            className="star-hit right"
            aria-label={i + ' 分'}
            onClick={() => onChange(i)}
            onMouseEnter={() => setHover(i)}
          />
        </span>
      ))}
    </span>
  );
}
