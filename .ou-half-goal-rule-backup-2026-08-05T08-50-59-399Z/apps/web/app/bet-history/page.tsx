import { apiFetch } from '../../lib/api';

type PaperHistorySummary = {
  paperProposals: number;
  legacyOuPaperProposals: number;
  pendingPaperProposals: number;
  invalidPaperProposals: number;
  settledPaperProposals: number;
  paperWins: number;
  paperLosses: number;
  paperVoids: number;
  paperHitRate: number | null;
  paperProfitUnits: number;
  paperRoi: number | null;
};

type BetRow = {
  id: string;
  source: 'PAPER_LEDGER' | 'PAPER_SHADOW';
  providerFixtureId: number;
  homeTeamName?: string;
  awayTeamName?: string;
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
  sourcePredictionSelection: string | null;
  sourcePredictionLineValue: number | null;
  sourcePredictionProbability: number | null;
  ouRuleStatus: 'APPLIED' | 'LEGACY_EXCLUDED' | 'NOT_APPLICABLE';
  settlement: {
    result: string;
    stakeUnits: number;
    profitUnits: number;
    fulltimeHomeGoals: number;
    fulltimeAwayGoals: number;
    clv: number | null;
    settledAt: string | null;
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

function settlementLabel(result: string): string {
  if (result === 'WIN') return 'ĐÚNG';
  if (result === 'LOSS') return 'SAI';
  return 'VOID';
}

export default async function BetHistoryPage() {
  const betsResponse = await apiFetch<{
    summary: PaperHistorySummary;
    data: BetRow[];
  }>('/scientific/bets?limit=150');
  const paper = betsResponse.summary;

  return (
    <>
      <section className="science-page-heading">
        <div>
          <span className="science-kicker">PAPER PREDICTION HISTORY</span>
          <h1>Lịch sử dự đoán PAPER</h1>
          <p>
            Paper proposal được lưu từ snapshot PIT-safe; sau khi trận đấu kết thúc, hệ thống tự đối
            chiếu tỷ số và đánh dấu dự đoán đúng, sai hoặc VOID.
          </p>
        </div>
        <span className="science-pill">Giờ Việt Nam · UTC+7</span>
      </section>

      <section className="science-metric-grid">
        <article className="science-metric-card">
          <span>Paper proposals</span>
          <strong>{paper.paperProposals}</strong>
          <small>{paper.settledPaperProposals} {'\u0111\u00E3 c\u00F3 k\u1EBFt qu\u1EA3'} - {paper.legacyOuPaperProposals} O/U legacy {'kh\u00F4ng t\u00EDnh'}</small>
        </article>

        <article className="science-metric-card">
          <span>Đang chờ kết quả</span>
          <strong>{paper.pendingPaperProposals}</strong>
          <small>{paper.invalidPaperProposals} snapshot không hợp lệ</small>
        </article>

        <article className="science-metric-card">
          <span>Đúng / Sai</span>
          <strong>
            {paper.paperWins} / {paper.paperLosses}
          </strong>
          <small>{paper.paperVoids} VOID</small>
        </article>

        <article className="science-metric-card">
          <span>Paper P/L</span>
          <strong>
            {paper.paperProfitUnits >= 0 ? '+' : ''}
            {paper.paperProfitUnits.toFixed(2)}u
          </strong>
          <small>
            Hit rate {percent(paper.paperHitRate)} · ROI {percent(paper.paperRoi)}
          </small>
        </article>
      </section>

      <section className="science-panel">
        <div className="science-panel-header">
          <div>
            <span className="science-kicker">PAPER + LEDGER</span>
            <h2>150 dự đoán và quyết định gần nhất</h2>
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
                    Chưa có paper proposal tại các checkpoint. Worker sẽ tự bổ sung khi có kèo paper
                    đủ điều kiện; hệ thống không tạo dữ liệu giả.
                  </td>
                </tr>
              ) : (
                betsResponse.data.map((bet) => (
                  <tr key={bet.id}>
                    <td>
                      <strong>
                        {bet.homeTeamName && bet.awayTeamName
                          ? `${bet.homeTeamName} – ${bet.awayTeamName}`
                          : `Fixture #${bet.providerFixtureId}`}
                      </strong>
                      <small>
                        {vnDateTime(bet.decisionAsOf)} · T−{bet.horizonMinutes}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`science-decision science-decision-${bet.decisionType.toLowerCase()}`}
                      >
                        {bet.decisionType === 'PAPER_PROPOSAL' ? 'PAPER' : bet.decisionType}
                      </span>
                      <small>
                        {bet.source === 'PAPER_SHADOW' ? 'Snapshot PIT-safe' : 'Paper ledger'} ·{' '}
                        {bet.candidateCount} candidates
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
                      {bet.sourcePredictionSelection && bet.sourcePredictionLineValue != null ? (
                        <small>
                          {'Ph\u1EA7n m\u1EC1m:'} {bet.sourcePredictionSelection}{' '}
                          {bet.sourcePredictionLineValue} ({percent(bet.sourcePredictionProbability)})
                          {' \u2192 '}{'K\u00E8o l\u01B0u/ch\u1EA5m:'} {bet.selection} {bet.lineValue}
                        </small>
                      ) : bet.ouRuleStatus === 'LEGACY_EXCLUDED' ? (
                        <small>
                          {'O/U legacy tr\u01B0\u1EDBc quy t\u1EAFc m\u1EDBi - kh\u00F4ng t\u00EDnh v\u00E0o th\u1ED1ng k\u00EA chi\u1EBFn l\u01B0\u1EE3c'}
                        </small>
                      ) : null}
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
                            {settlementLabel(bet.settlement.result)}
                          </strong>
                          <small>
                            Tỷ số {bet.settlement.fulltimeHomeGoals}-
                            {bet.settlement.fulltimeAwayGoals}
                          </small>
                          <small>
                            Paper P/L {bet.settlement.profitUnits >= 0 ? '+' : ''}
                            {bet.settlement.profitUnits.toFixed(2)}u
                          </small>
                        </>
                      ) : bet.decisionType === 'NO_BET' ? (
                        <span className="science-muted">Không có lựa chọn</span>
                      ) : new Date(bet.kickoffAt).getTime() > Date.now() ? (
                        <span className="science-muted">Chờ trận đấu kết thúc</span>
                      ) : (
                        <span className="science-muted">Chờ đồng bộ kết quả</span>
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
