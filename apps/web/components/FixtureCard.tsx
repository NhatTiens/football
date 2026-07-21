import Link from 'next/link';
import type { FixtureDto } from '../lib/types';
import { dateTime } from '../lib/format';

export function FixtureCard({ fixture }: { fixture: FixtureDto }) {
  return (
    <Link href={`/matches/${fixture.id}`} className="fixture-card">
      <div className="fixture-meta">
        <span>{fixture.league.name}</span>
        <time>{dateTime(fixture.kickoffAt)}</time>
      </div>
      <div className="fixture-teams">
        <div>
          <strong>{fixture.homeTeam.name}</strong>
          <span>Chủ nhà</span>
        </div>
        <b className="versus">
          {fixture.status === 'FINISHED'
            ? `${fixture.score.home ?? 0} — ${fixture.score.away ?? 0}`
            : 'VS'}
        </b>
        <div className="away-team">
          <strong>{fixture.awayTeam.name}</strong>
          <span>Đội khách</span>
        </div>
      </div>
      <div className="fixture-footer">
        <span>{fixture.round ?? 'Chưa xác định vòng'}</span>
        <span className="pill">{fixture.recommendationCount ?? 0} khuyến nghị</span>
      </div>
    </Link>
  );
}
