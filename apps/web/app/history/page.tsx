import Link from 'next/link';

import { apiFetch } from '../../lib/api';
import { unresolvedHistoryLabel, type HistoryReplayStatus } from '../../lib/history-display';

type PaperHistorySummary = {
  paperProposals: number;
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
  ouRuleVersion: string | null;
  historyReplayStatus: HistoryReplayStatus;
  historyStrategyEligible: boolean;
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

type FixtureHistoryGroup = {
  providerFixtureId: number;
  homeTeamName?: string;
  awayTeamName?: string;
  kickoffAt: string;
  rows: BetRow[];
};

const FIXTURES_PER_PAGE = 20;

function percent(value: number | null, digits = 1): string {
  return value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
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
  return 'KHÔNG TÍNH';
}

function normalizedMarket(value: string | null): string {
  return (value ?? '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function marketLabel(row: BetRow): string {
  const market = normalizedMarket(row.market);

  if (market.includes('BTTS') || market.includes('BOTH_TEAMS_TO_SCORE')) {
    return 'BTTS';
  }

  if (
    market.includes('OVER_UNDER') ||
    market.includes('TOTAL_GOALS') ||
    market === 'OU' ||
    row.lineValue != null
  ) {
    return row.lineValue == null ? 'O/U' : `O/U ${row.lineValue}`;
  }

  return row.market ?? '—';
}

function selectionLabel(row: BetRow): string {
  const selection = (row.selection ?? '').trim().toUpperCase();

  if (selection === 'YES') return 'CÓ';
  if (selection === 'NO') return 'KHÔNG';
  if (selection === 'OVER') {
    return row.lineValue == null ? 'OVER' : `OVER ${row.lineValue}`;
  }
  if (selection === 'UNDER') {
    return row.lineValue == null ? 'UNDER' : `UNDER ${row.lineValue}`;
  }

  return row.selection ?? '—';
}

function safePage(value: string | undefined): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) return 1;

  return parsed;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const requestedPage = safePage(params.page);

  const betsResponse = await apiFetch<{
    generatedAt: string;
    summary: PaperHistorySummary;
    fixtures: FixtureHistoryGroup[];
    pagination: {
      page: number;
      pageSize: number;
      totalFixtures: number;
      totalPages: number;
      hasPrevious: boolean;
      hasNext: boolean;
    };
    data: BetRow[];
  }>(`/scientific/bets?page=${requestedPage}&pageSize=${FIXTURES_PER_PAGE}`);

  const paper = betsResponse.summary;
  const reportAsOf = new Date(betsResponse.generatedAt).getTime();
  const visibleFixtures = betsResponse.fixtures;
  const { page, totalPages, totalFixtures } = betsResponse.pagination;

  return (
    <>
      <section className="science-page-heading">
        <div>
          <span className="science-kicker">LỊCH SỬ ĐÁNH GIÁ MÔ HÌNH</span>
          <h1>Lịch sử dự đoán</h1>
          <p>
            Chỉ hiển thị các trận từ 01/08/2026 theo giờ Việt Nam, mỗi trận một lần. Checkpoint cũ
            vẫn được giữ để phục vụ nghiên cứu.
          </p>
        </div>
        <span className="science-pill">Từ 01/08/2026 · UTC+7</span>
      </section>

      <section className="science-metric-grid">
        <article className="science-metric-card">
          <span>Bản ghi mô phỏng</span>
          <strong>{paper.paperProposals}</strong>
          <small>{paper.settledPaperProposals} đã có kết quả</small>
        </article>

        <article className="science-metric-card">
          <span>Đang chờ kết quả</span>
          <strong>{paper.pendingPaperProposals}</strong>
          <small>{paper.invalidPaperProposals} snapshot chưa hợp lệ</small>
        </article>

        <article className="science-metric-card">
          <span>Đúng / Sai</span>
          <strong>
            {paper.paperWins} / {paper.paperLosses}
          </strong>
          <small>{paper.paperVoids} không tính</small>
        </article>

        <article className="science-metric-card">
          <span>Độ chính xác</span>
          <strong>{percent(paper.paperHitRate)}</strong>
          <small>Thống kê từ các bản ghi đã được đối chiếu kết quả</small>
        </article>
      </section>

      <section className="science-panel">
        <div className="science-panel-header">
          <div>
            <span className="science-kicker">THEO TỪNG TRẬN</span>
            <h2>
              {totalFixtures} trận · trang {page}/{totalPages}
            </h2>
          </div>
        </div>

        {visibleFixtures.length === 0 ? (
          <p className="science-empty-cell">Chưa có lịch sử đánh giá phù hợp.</p>
        ) : (
          visibleFixtures.map((fixture) => {
            const settled = fixture.rows.filter((row) => row.settlement).length;
            const eligible = fixture.rows.filter((row) => row.historyStrategyEligible).length;

            return (
              <article className="science-panel" key={fixture.providerFixtureId}>
                <div className="science-panel-header">
                  <div>
                    <h3>
                      {fixture.homeTeamName && fixture.awayTeamName
                        ? `${fixture.homeTeamName} – ${fixture.awayTeamName}`
                        : `Fixture #${fixture.providerFixtureId}`}
                    </h3>
                    <small>{vnDateTime(fixture.kickoffAt)}</small>
                  </div>

                  <span className="science-pill">
                    {eligible}/{fixture.rows.length} hợp lệ · {settled}/{eligible} đã đối chiếu
                  </span>
                </div>

                <div className="science-table-wrap">
                  <table className="science-table science-bet-table">
                    <thead>
                      <tr>
                        <th>Phân tích</th>
                        <th>Kết luận</th>
                        <th>Xác suất</th>
                        <th>Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fixture.rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{marketLabel(row)}</strong>
                          </td>

                          <td>
                            <strong>{selectionLabel(row)}</strong>
                          </td>

                          <td>{percent(row.modelProbability)}</td>

                          <td>
                            {row.settlement ? (
                              <>
                                <strong
                                  className={`science-result science-result-${row.settlement.result.toLowerCase()}`}
                                >
                                  {settlementLabel(row.settlement.result)}
                                </strong>
                                <small>
                                  Tỷ số {row.settlement.fulltimeHomeGoals}-
                                  {row.settlement.fulltimeAwayGoals}
                                </small>
                              </>
                            ) : (
                              <span className="science-muted">
                                {unresolvedHistoryLabel(row, reportAsOf)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })
        )}

        <div className="science-panel-header">
          <div>
            {page > 1 ? (
              <Link className="science-pill" href={`/history?page=${page - 1}`}>
                ← Trang trước
              </Link>
            ) : null}
          </div>

          <div>
            {page < totalPages ? (
              <Link className="science-pill" href={`/history?page=${page + 1}`}>
                Xem thêm →
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
