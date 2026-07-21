import Link from 'next/link';
import type { RecommendationDto } from '../lib/types';
import { confidenceLabel, dateTime, percent, signedPercent } from '../lib/format';

export function RecommendationCard({ recommendation }: { recommendation: RecommendationDto }) {
  const fixture = recommendation.fixture;
  return (
    <article className="recommendation-card">
      <div className="recommendation-rank">#{recommendation.rank ?? '—'}</div>
      <div className="recommendation-main">
        {fixture ? (
          <Link href={`/matches/${fixture.id}`} className="match-link">
            {fixture.homeTeam.name} <span>vs</span> {fixture.awayTeam.name}
          </Link>
        ) : null}
        <div className="selection-title">
          <strong>{recommendation.selectionName}</strong>
          <span>{recommendation.marketName}</span>
        </div>
        <div className="metric-grid">
          <div><span>Odds</span><strong>{recommendation.odds.toFixed(2)}</strong></div>
          <div><span>Xác suất mô hình</span><strong>{percent(recommendation.modelProbability)}</strong></div>
          <div><span>Edge</span><strong>{signedPercent(recommendation.edge)}</strong></div>
          <div><span>EV</span><strong className="positive">{signedPercent(recommendation.expectedValue)}</strong></div>
          <div><span>Confidence</span><strong>{confidenceLabel(recommendation.confidenceScore)}</strong></div>
          <div><span>Nhà cái</span><strong>{recommendation.bookmaker.name}</strong></div>
        </div>
        <ul className="reason-list">
          {(Array.isArray(recommendation.reasons) ? recommendation.reasons : []).slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <div className="recommendation-time">
          Tạo {dateTime(recommendation.generatedAt)} · hết hạn {dateTime(recommendation.expiresAt)}
        </div>
      </div>
    </article>
  );
}
