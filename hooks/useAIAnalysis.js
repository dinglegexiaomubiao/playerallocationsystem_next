import { useState, useCallback, useRef } from 'react';

const ANALYSIS_CACHE_KEY = 'ai_analysis_cache';

function loadCache() {
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full, ignore */ }
}

function makeCacheKey(type, id) {
  return `${type}_${id}`;
}

export default function useAIAnalysis() {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const cacheRef = useRef(loadCache());

  const runAnalysis = useCallback(async (type, data, id, { skipCache } = {}) => {
    const cacheKey = makeCacheKey(type, id);

    // Check localStorage cache first
    if (!skipCache && cacheRef.current[cacheKey]) {
      setAnalysis(cacheRef.current[cacheKey]);
      return;
    }

    setAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      // 服务端已限制 90 秒，这里再兜一层：网络半断时也不会让按钮无限转圈
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 100000);

      let response;
      try {
        response = await fetch('/api/ai-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, data }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const result = await response.json();

      if (result.success) {
        setAnalysis(result.analysis);
        // Save to localStorage cache
        cacheRef.current[cacheKey] = result.analysis;
        saveCache(cacheRef.current);
      } else {
        setError(result.error || '分析失败');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('分析超时（超过 100 秒），请稍后重试');
      } else {
        setError('网络错误，请稍后重试');
      }
      console.error('AI analysis error:', err);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setError(null);
  }, []);

  return { analyzing, analysis, error, runAnalysis, clearAnalysis };
}
