import { memo, useState, useCallback } from 'react';
import PlayerCard from './PlayerCard';
import useAIAnalysis from '../hooks/useAIAnalysis';

const TeamCard = memo(function TeamCard({ team, onAddPlayer, onRemovePlayer, onDeleteTeam, playerNameMap }) {
  const playerCount = team.players.length;
  const isFull = playerCount >= 5;
  const teamScore = team.players.reduce((total, player) => total + (player.score || 0), 0);
  const [fetchingStats, setFetchingStats] = useState(false);
  const { analyzing, analysis, error: aiError, runAnalysis, clearAnalysis } = useAIAnalysis();

  const handleAIAnalysis = useCallback(async () => {
    setFetchingStats(true);
    try {
      // Batch fetch OpenDota stats for all team players
      const playersData = await Promise.all(
        team.players.map(async (player) => {
          try {
            const response = await fetch(`/api/player-stats?playerId=${player.game_id}`);
            if (response.ok) {
              const data = await response.json();
              return { player, stats: data.stats || null };
            }
          } catch (e) {
            // ignore individual fetch errors
          }
          return { player, stats: null };
        })
      );

      const synergyNames = (playerNameMap || new Map());
      const playersDataWithNames = playersData.map(({ player, stats }) => ({
        player: {
          ...player,
          synergy_names: (player.synergy_players || []).map(id => synergyNames.get(id) || id)
        },
        stats
      }));

      runAnalysis('team', { team, playersData: playersDataWithNames }, team.id);
    } catch (e) {
      console.error('Failed to fetch team stats:', e);
    } finally {
      setFetchingStats(false);
    }
  }, [team, playerNameMap, runAnalysis]);

  return (
    <div className={`team-card${isFull ? ' is-full' : ''}`}>
      <div className="team-header">
        <div className="team-info">
          <h3 className="team-name">{team.name}</h3>
          <span className="team-player-count">
            {playerCount}/5 人
          </span>
        </div>
        <div className="team-score">
          总分 {teamScore}
        </div>
      </div>

      <div className="team-players">
        {team.players.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            onRemove={onRemovePlayer ? () => onRemovePlayer(player.id) : null}
            isSimplified={true}
          />
        ))}
        {playerCount === 0 && (
          <div className="team-empty-hint">暂无选手，点击下方按钮添加</div>
        )}
      </div>

      {/* AI Analysis section */}
      {playerCount > 0 && (
        <div className="team-ai-section">
          {!analysis && !analyzing && !fetchingStats && (
            <button
              className="ai-analysis-btn"
              onClick={handleAIAnalysis}
              disabled={fetchingStats}
            >
              🤖 AI 分析队伍
            </button>
          )}

          {(analyzing || fetchingStats) && (
            <div className="ai-analysis-loading">
              <div className="ai-spinner"></div>
              <span>{fetchingStats ? '获取选手数据中...' : 'AI 分析中...'}</span>
            </div>
          )}

          {aiError && (
            <div className="error-message">
              {aiError}
              <button className="retry-btn" onClick={clearAnalysis}>重试</button>
            </div>
          )}

          {analysis && (
            <div className="ai-analysis-result">
              <div className="ai-analysis-header">
                <span className="ai-badge">🤖 AI 队伍分析</span>
                <button className="ai-refresh-btn" onClick={() => { clearAnalysis(); handleAIAnalysis(); }}>🔄 重新分析</button>
              </div>
              <div className="ai-analysis-text">{analysis || '（AI 返回了空内容，请重试）'}</div>
            </div>
          )}
        </div>
      )}

      <div className="team-footer">
        <button
          className="btn btn-primary btn-sm"
          onClick={onAddPlayer}
          disabled={isFull}
        >
          + 添加选手{isFull ? ' (已满)' : ''}
        </button>
        <button
          onClick={onDeleteTeam}
          className="btn btn-danger btn-sm"
        >
          删除队伍
        </button>
      </div>
    </div>
  );
});

export default TeamCard;
