import Link from 'next/link';

import { apiFetch } from '../../lib/api';

type ScientificOverview = {
  timezone: string;
  leagueProfile: string;
  regions: {
    southeastAsia: readonly string[];
    asia: readonly string[];
  };
  leagues: {
    discovered: number;
    groupCounts: Record<string, number>;
    observedAt: string | null;
  };
  provider: {
    providerRuns: number;
    successfulRuns: number;
    fixtureSnapshots: number;
    oddsSnapshots: number;
    pitUsableOddsSnapshots: number;
    dataSnapshots: number;
    latestProviderRun: {
      status?: string;
      command?: string;
      requestCount?: number;
      startedAt?: string;
      finishedAt?: string | null;
    } | null;
    latestOddsObservedAt: string | null;
  };
  paperBet: {
    decisions: number;
    bestBets: number;
    noBets: number;
    settlements: number;
    wins: number;
    losses: number;
    openBestBets: number;
    totalStakeUnits: number;
    profitUnits: number;
    roi: number | null;
  };
};

type ScientificLeague = {
  id: number;
  name: string;
  type: string | null;
  country: string | null;
  logo: string | null;
  group: 'GLOBAL_MAJOR' | 'SOUTHEAST_ASIA' | 'ASIA' | 'AFC';
  currentSeason: number | null;
  score: number;
};

type ScientificFixture = {
  providerFixtureId: number;
  providerLeagueId: number;
  leagueName: string;
  leagueGroup: string | null;
  leagueCountry: string | null;
  homeTeamName: string;
  awayTeamName: string;
  statusShort: string;
  kickoffUtc: string;
  kickoffVietnam: string;
  t180Vietnam: string;
  t90Vietnam: string;
  t30Vietnam: string;
  t5Vietnam: string;
  observedAt: string;
};

function percent(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function signedUnits(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}u`;
}

function groupLabel(group: ScientificLeague['group']): string {
  switch (group) {
    case 'GLOBAL_MAJOR':
      return 'Giải lớn quốc tế';
    case 'SOUTHEAST_ASIA':
      return 'Đông Nam Á';
    case 'ASIA':
      return 'Châu Á';
    case 'AFC':
      return 'Cúp CLB AFC';
  }
}

export default async function ScientificPage() {
  const [overview, leaguesResponse, fixturesResponse] = await Promise.all([
    apiFetch<ScientificOverview>('/scientific/overview'),
    apiFetch<{
      data: ScientificLeague[];
    }>('/scientific/leagues'),
    apiFetch<{
      data: ScientificFixture[];
    }>('/scientific/fixtures?limit=60'),
  ]);

  const grouped = new Map<ScientificLeague['group'], ScientificLeague[]>();

  for (const league of leaguesResponse.data) {
    const list = grouped.get(league.group) ?? [];

    list.push(league);
    grouped.set(league.group, list);
  }

  return (
    <>
      <section className="science-hero">
        <div>
          <div className="science-kicker">LIVE PROVIDER · PIT · PAPER BET</div>
          <h1>Trung tâm dữ liệu Football AI</h1>
          <p>
            Theo dõi dữ liệu API-Football, odds snapshot, lịch dự đoán và lịch sử paper-bet trên một
            giao diện. Toàn bộ giờ hiển thị theo Việt Nam.
          </p>
          <div className="science-actions">
            <Link className="button primary" href="/bet-history">
              Lịch sử bet
            </Link>
            <Link className="button secondary" href="/backtest">
              Backtest
            </Link>
          </div>
        </div>

        <div className="science-status-card">
          <span className="science-status-label">Provider</span>
          <strong>{overview.provider.latestProviderRun?.status ?? 'Chưa capture'}</strong>
          <small>Profile: {overview.leagueProfile}</small>
          <small>Timezone: {overview.timezone} (UTC+7)</small>
          <small>
            Odds mới nhất:{' '}
            {overview.provider.latestOddsObservedAt
              ? new Intl.DateTimeFormat('vi-VN', {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                  timeZone: 'Asia/Ho_Chi_Minh',
                }).format(new Date(overview.provider.latestOddsObservedAt))
              : '—'}
          </small>
        </div>
      </section>

      <section className="science-metric-grid">
        <article className="science-metric-card">
          <span>Giải phát hiện</span>
          <strong>{overview.leagues.discovered}</strong>
          <small>Global + Đông Nam Á + Châu Á + AFC</small>
        </article>

        <article className="science-metric-card">
          <span>Odds snapshots</span>
          <strong>{overview.provider.oddsSnapshots}</strong>
          <small>PIT usable: {overview.provider.pitUsableOddsSnapshots}</small>
        </article>

        <article className="science-metric-card">
          <span>Paper BET</span>
          <strong>{overview.paperBet.bestBets}</strong>
          <small>NO BET: {overview.paperBet.noBets}</small>
        </article>

        <article className="science-metric-card">
          <span>ROI paper-bet</span>
          <strong>{percent(overview.paperBet.roi)}</strong>
          <small>
            {signedUnits(overview.paperBet.profitUnits)}
            {' · '}
            {overview.paperBet.wins}W/{overview.paperBet.losses}L
          </small>
        </article>
      </section>

      <section className="science-panel">
        <div className="science-panel-header">
          <div>
            <span className="science-kicker">COMPETITION PROFILE</span>
            <h2>Giải đấu đang được mở rộng</h2>
          </div>
          <span className="science-pill">{leaguesResponse.data.length} giải</span>
        </div>

        <div className="science-league-groups">
          {(['SOUTHEAST_ASIA', 'ASIA', 'AFC', 'GLOBAL_MAJOR'] as const).map((group) => {
            const leagues = grouped.get(group) ?? [];

            return (
              <div className="science-league-group" key={group}>
                <div className="science-league-group-title">
                  <strong>{groupLabel(group)}</strong>
                  <span>{leagues.length}</span>
                </div>

                {leagues.length === 0 ? (
                  <p className="science-empty">
                    Chưa có snapshot khám phá giải. Chạy live capture để đồng bộ.
                  </p>
                ) : (
                  <div className="science-chip-list">
                    {leagues.slice(0, 18).map((league) => (
                      <span
                        className="science-chip"
                        key={league.id}
                        title={`API league #${league.id}`}
                      >
                        {league.country ? `${league.country} · ` : ''}
                        {league.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="science-panel">
        <div className="science-panel-header">
          <div>
            <span className="science-kicker">VIETNAM TIME · UPCOMING</span>
            <h2>Lịch T−180 / T−90 / T−30 / T−5</h2>
          </div>
          <span className="science-pill">Asia/Ho_Chi_Minh</span>
        </div>

        <div className="science-table-wrap">
          <table className="science-table">
            <thead>
              <tr>
                <th>Giải / Trận</th>
                <th>Kickoff</th>
                <th>T−180</th>
                <th>T−90</th>
                <th>T−30</th>
                <th>T−5</th>
              </tr>
            </thead>
            <tbody>
              {fixturesResponse.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="science-empty-cell">
                    Chưa có fixture snapshot sắp tới.
                  </td>
                </tr>
              ) : (
                fixturesResponse.data.map((fixture) => (
                  <tr key={fixture.providerFixtureId}>
                    <td>
                      <strong>
                        {fixture.homeTeamName} – {fixture.awayTeamName}
                      </strong>
                      <small>
                        {fixture.leagueCountry ? `${fixture.leagueCountry} · ` : ''}
                        {fixture.leagueName}
                      </small>
                    </td>
                    <td>{fixture.kickoffVietnam}</td>
                    <td>{fixture.t180Vietnam}</td>
                    <td>{fixture.t90Vietnam}</td>
                    <td>{fixture.t30Vietnam}</td>
                    <td>{fixture.t5Vietnam}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="science-note">
        <strong>Nguyên tắc dữ liệu:</strong> giao diện hiển thị UTC+7, nhưng timestamp trong
        database vẫn giữ thời điểm tuyệt đối để PIT và backtest không bị sai lệch.
      </section>
    </>
  );
}
