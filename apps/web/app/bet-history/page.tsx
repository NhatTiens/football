import { apiFetch } from '../../lib/api';

type ScientificOverview = {
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

type BetRow = {
  id: number;
  providerFixtureId: number;
  horizonMinutes: number;
  decisionAsOf: string;
  kickoffAt: string;
  decisionType: string;
  market: string | null;
  selection: string | null;
  lineValue: number | null;
  decimalOdds: number | null;
  bookmakerName: string | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  modelVersion: string;
  policyVersion: string;
  reliabilityStatus: string | null;
  candidateCount: number;
  rejectedCandidateCount: number;
  settlement: {
    result: string;
    stakeUnits: number;
    profitUnits: number;
    fulltimeHomeGoals: number;
    fulltimeAwayGoals: number;
    clv: number | null;
    settledAt: string;
  } | null;
};

function percent(value: number | null, digits = 1): string {
  return value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value: number | null): string {
  if (value == null) {
    return '—';
  }

  const result = value * 100;

  return `${result >= 0 ? '+' : ''}${result.toFixed(1)}%`;
}

function vnDateTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

export default async function BetHistoryPage() {
  const [overview, betsResponse] = await Promise.all([
    apiFetch<ScientificOverview>('/scientific/overview'),
    apiFetch<{
      data: BetRow[];
    }>('/scientific/bets?limit=150'),
  ]);

  const paper = overview.paperBet;

  return (
    <>
      <section className="science-page-heading">
        <div>
          <span className="science-kicker">APPEND-ONLY LEDGER</span>
          <h1>Lịch sử BEST BET / NO BET</h1>
          <p>
            Mỗi quyết định được giữ nguyên cùng model, policy, odds, edge, EV và settlement để đánh
            giá phần mềm theo thời gian.
          </p>
        </div>
        <span className="science-pill">Giờ Việt Nam · UTC+7</span>
      </section>

      <section className="science-metric-grid">
        <article className="science-metric-card">
          <span>Quyết định</span>
          <strong>{paper.decisions}</strong>
          <small>
            {paper.bestBets} BEST BET · {paper.noBets} NO BET
          </small>
        </article>

        <article className="science-metric-card">
          <span>Đã settlement</span>
          <strong>{paper.settlements}</strong>
          <small>
            {paper.wins} thắng · {paper.losses} thua
          </small>
        </article>

        <article className="science-metric-card">
          <span>Profit</span>
          <strong>
            {paper.profitUnits >= 0 ? '+' : ''}
            {paper.profitUnits.toFixed(2)}u
          </strong>
          <small>Stake {paper.totalStakeUnits.toFixed(1)}u</small>
        </article>

        <article className="science-metric-card">
          <span>ROI</span>
          <strong>{percent(paper.roi)}</strong>
          <small>Open bets: {paper.openBestBets}</small>
        </article>
      </section>

      <section className="science-panel">
        <div className="science-panel-header">
          <div>
            <span className="science-kicker">BET LEDGER</span>
            <h2>150 quyết định gần nhất</h2>
          </div>
        </div>

        <div className="science-table-wrap">
          <table className="science-table science-bet-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Decision</th>
                <th>Market</th>
                <th>Odds</th>
                <th>P(model)</th>
                <th>Edge / EV</th>
                <th>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {betsResponse.data.length === 0 ? (
                <tr>
                  <td className="science-empty-cell" colSpan={7}>
                    Chưa có paper-bet decision. Hệ thống không tạo dữ liệu giả; ledger sẽ đầy lên
                    khi live prediction được nối vào policy.
                  </td>
                </tr>
              ) : (
                betsResponse.data.map((bet) => (
                  <tr key={bet.id}>
                    <td>
                      <strong>{vnDateTime(bet.decisionAsOf)}</strong>
                      <small>
                        T−{bet.horizonMinutes} · Fixture #{bet.providerFixtureId}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`science-decision science-decision-${bet.decisionType.toLowerCase()}`}
                      >
                        {bet.decisionType}
                      </span>
                      <small>
                        {bet.candidateCount} candidates · {bet.rejectedCandidateCount} loại
                      </small>
                    </td>
                    <td>
                      <strong>
                        {bet.market ?? '—'}
                        {bet.lineValue != null ? ` ${bet.lineValue}` : ''}
                      </strong>
                      <small>
                        {bet.selection ?? '—'}
                        {bet.bookmakerName ? ` · ${bet.bookmakerName}` : ''}
                      </small>
                    </td>
                    <td>{bet.decimalOdds?.toFixed(2) ?? '—'}</td>
                    <td>{percent(bet.modelProbability)}</td>
                    <td>
                      <strong>{signedPercent(bet.edge)}</strong>
                      <small>EV {signedPercent(bet.expectedValue)}</small>
                    </td>
                    <td>
                      {bet.settlement ? (
                        <>
                          <strong
                            className={`science-result science-result-${bet.settlement.result.toLowerCase()}`}
                          >
                            {bet.settlement.result}
                          </strong>
                          <small>
                            {bet.settlement.profitUnits >= 0 ? '+' : ''}
                            {bet.settlement.profitUnits.toFixed(2)}u ·{' '}
                            {bet.settlement.fulltimeHomeGoals}-{bet.settlement.fulltimeAwayGoals}
                          </small>
                        </>
                      ) : (
                        <span className="science-muted">Chưa settlement</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
