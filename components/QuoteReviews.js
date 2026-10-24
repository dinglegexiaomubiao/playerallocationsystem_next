import { useState } from 'react';
import Avatar from './Avatar';
import StarRating from './StarRating';

/**
 * 单条语录下的评价区。
 *
 * 结构：
 *   - 摘要行：平均分 + 人数（来自 props，提交后本地更新）
 *   - 登录用户有「评价」按钮 → 展开半星选择器 + 可选文字框
 *   - 可折叠的评论列表，每条带头像/昵称/星/文字/时间，本人或管理员可删
 *
 * 评价列表和「我的评价」懒加载：点「评价」或「查看评价」才发请求，
 * 一屏几十条语录时不会一上来就狂打接口。
 */
export default function QuoteReviews({ quoteId, ratingAvg = 0, ratingCount = 0, myPlayerId, isAdmin }) {
  const canReview = !!myPlayerId;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [myReview, setMyReview] = useState(null);
  const [avg, setAvg] = useState(ratingAvg);
  const [count, setCount] = useState(ratingCount);

  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const r = await fetch(`/api/quotes/${quoteId}/reviews`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) return null;
      setReviews(d.reviews || []);
      setMyReview(d.myReview || null);
      setAvg(d.ratingAvg || 0);
      setCount(d.ratingCount || 0);
      setLoaded(true);
      return d;
    } catch {
      /* 网络抖一下不阻断页面，摘要仍来自 props */
      return null;
    }
  };

  const toggleForm = () => {
    setOpen((v) => !v);
    setErr('');
    setMsg('');
    if (!loaded) {
      load().then((d) => {
        if (d && d.myReview) setScore(d.myReview.score);
        else if (score === 0) setScore(5);
      });
    } else if (myReview) {
      setScore(myReview.score);
    } else if (score === 0) {
      setScore(5);
    }
  };

  const toggleList = () => {
    setExpanded((v) => !v);
    if (!loaded) load();
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (score === 0) return setErr('先点个分吧');
    const wasEditing = !!myReview;
    setBusy(true);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setErr(d.error || `提交失败（HTTP ${r.status}）`);
        return;
      }
      // 用 GET 重拉，保证列表/我的评价/平均分都同步，不手写各种合并分支
      await load();
      setExpanded(true);
      setComment('');
      setMsg(wasEditing ? '改好了' : '评价已记录');
    } catch {
      setErr('网络异常，再点一次试试');
    } finally {
      setBusy(false);
    }
  };

  const removeReview = async (rid) => {
    if (!window.confirm('删掉这条评价？')) return;
    setErr('');
    try {
      const r = await fetch(`/api/quotes/${quoteId}/reviews/${rid}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setErr(d.error || '没删掉，刷新一下再试');
        return;
      }
      await load();
    } catch {
      setErr('网络异常，再点一次');
    }
  };

  const fmt = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '.');

  return (
    <div className="quote-reviews">
      <div className="quote-rating-row">
        <StarRating value={avg} readOnly size="sm" />
        {count > 0 ? (
          <span className="quote-rating-num">
            {avg != null ? Number(avg).toFixed(1) : '0.0'} 分
          </span>
        ) : null}
        <span className="quote-rating-count">{count > 0 ? `${count} 人评` : '还没人评过'}</span>

        {canReview && (
          <button type="button" className="quote-review-btn" onClick={toggleForm}>
            {open ? '收起' : myReview ? '改我的评价' : '评价'}
          </button>
        )}
        {count > 0 && (
          <button type="button" className="quote-review-link" onClick={toggleList}>
            {expanded ? '收起评价' : `查看 ${count} 条`}
          </button>
        )}
      </div>

      {open && canReview && (
        <form className="quote-review-form" onSubmit={submit}>
          <div className="quote-review-score">
            <StarRating value={score} onChange={setScore} size="md" />
            <span className="quote-review-score-num">{score != null ? score.toFixed(1) : '0.0'} 分</span>
          </div>
          <textarea
            className="quote-review-text"
            rows={2}
            maxLength={200}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="说点什么（可不写，只打分也行）"
          />
          <div className="quote-review-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? '提交中…' : myReview ? '更新评价' : '提交评价'}
            </button>
            {myReview && (
              <button
                type="button"
                className="quote-review-del"
                onClick={() => removeReview(myReview.id)}
                disabled={busy}
              >
                删掉我的评价
              </button>
            )}
          </div>
          {msg && <p className="quote-form-notice">{msg}</p>}
          {err && <p className="quote-form-error">{err}</p>}
        </form>
      )}

      {expanded && loaded && reviews.length > 0 && (
        <ul className="quote-review-list">
          {reviews.map((rv) => {
            const mine = myPlayerId && String(rv.reviewer.playerId) === String(myPlayerId);
            const canDel = mine || isAdmin;
            return (
              <li className="quote-review-item" key={rv.id}>
                <Avatar className="quote-review-avatar" src={rv.reviewer.avatar} name={rv.reviewer.nickname} />
                <div className="quote-review-body">
                  <div className="quote-review-head">
                    <span className="quote-review-name">{rv.reviewer.nickname}</span>
                    <StarRating value={rv.score} readOnly size="xs" />
                    <time className="quote-review-time">{fmt(rv.createdAt)}</time>
                  </div>
                  {rv.comment && <p className="quote-review-comment">{rv.comment}</p>}
                </div>
                {canDel && (
                  <button
                    type="button"
                    className="quote-review-del-item"
                    onClick={() => removeReview(rv.id)}
                  >
                    删
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
