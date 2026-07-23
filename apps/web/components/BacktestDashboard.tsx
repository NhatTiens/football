'use client';

import { useMemo, useState } from 'react';
import type { BacktestDetailDto, BacktestRunDto, LeagueDto } from '../lib/types';
import { dateTime, percent } from '../lib/format';

const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

function dateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function signed(value: number | null | undefined, digits = 2): string {
  const number = value ?? 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}`;
}

// PREDICTION_AI_V622_STAKE_COLUMN
function money(value: number | null | undefined, currency = 'VND'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function EquityChart({ points }: { points: BacktestDetailDto['equityCurve'] }) {
  if (points.length < 2) {
    return <div className="chart-empty">Chưa đủ bet để vẽ đường lợi nhuận.</div>;
  }
  const width = 820;
  const height = 260;
  const padding = 28;
  const values = points.map((point) => point.equity);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(1, max - min);
  const coordinates = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.equity - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);

  return (
    <div className="equity-chart-wrap">
      <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Đường lợi nhuận tích lũy">
        <line x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} className="chart-zero" />
        <polyline points={coordinates.join(' ')} className="chart-line" />
        <text x={padding} y={18} className="chart-label">Max {signed(max)}u</text>
        <text x={padding} y={height - 7} className="chart-label">Min {signed(min)}u</text>
      </svg>
    </div>
  );
}

export function BacktestDashboard({
  initialRuns,
  initialDetail,
  leagues,
}: {
  initialRuns: BacktestRunDto[];
  initialDetail: BacktestDetailDto | null;
  leagues: LeagueDto[];
}) {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const [runs, setRuns] = useState(initialRuns);
  const [detail, setDetail] = useState(initialDetail);
  const [adminToken, setAdminToken] = useState('');
  const [from, setFrom] = useState(initialDetail?.dateFrom.slice(0, 10) ?? dateInput(yearAgo));
  const [to, setTo] = useState(initialDetail?.dateTo.slice(0, 10) ?? dateInput(now));
  const [leagueId, setLeagueId] = useState(initialDetail?.leagueId?.toString() ?? '');
  const [fixtureLimit, setFixtureLimit] = useState('500');
  const [minimumEv, setMinimumEv] = useState('0.03');
  const [minimumEdge, setMinimumEdge] = useState('0.02');
  const [minimumConfidence, setMinimumConfidence] = useState('0.50');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState('ALL');

  const filteredBets = useMemo(
    () => detail?.bets.filter((bet) => marketFilter === 'ALL' || bet.marketCode === marketFilter) ?? [],
    [detail, marketFilter],
  );

  async function loadDetail(id: number): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${publicApiUrl}/backtests/${id}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Không thể tải backtest #${id}.`);
      setDetail((await response.json()) as BacktestDetailDto);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải backtest.');
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!adminToken.trim()) {
      setMessage('Nhập ADMIN_API_TOKEN trong file .env để chạy backtest.');
      return;
    }
    setLoading(true);
    setMessage('Đang tái tạo prediction theo từng thời điểm lịch sử…');
    try {
      const response = await fetch(`${publicApiUrl}/admin/backtests/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-token': adminToken.trim(),
        },
        body: JSON.stringify({
          name: `UI Backtest ${from} → ${to}`,
          from: `${from}T00:00:00.000Z`,
          to: `${to}T23:59:59.999Z`,
          leagueId: leagueId ? Number(leagueId) : undefined,
          fixtureLimit: Number(fixtureLimit),
          stakeUnits: 1,
          rules: {
            minimumExpectedValue: Number(minimumEv),
            minimumEdge: Number(minimumEdge),
            minimumConfidence: Number(minimumConfidence),
          },
        }),
      });
      const payload = (await response.json()) as BacktestRunDto & { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Backtest thất bại.');
      const detailsResponse = await fetch(`${publicApiUrl}/backtests/${payload.id}`, { cache: 'no-store' });
      if (!detailsResponse.ok) throw new Error('Backtest đã chạy nhưng không tải được chi tiết.');
      const nextDetail = (await detailsResponse.json()) as BacktestDetailDto;
      setDetail(nextDetail);
      setRuns((current) => [nextDetail, ...current.filter((run) => run.id !== nextDetail.id)]);
      setMessage(`Hoàn thành: ${nextDetail.totalBets} bet trên ${nextDetail.eligibleFixtures} trận đủ điều kiện.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Backtest thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="backtest-page">
      <section className="page-heading compact-heading">
        <span className="eyebrow">POINT-IN-TIME SIMULATION</span>
        <h1>Backtest Engine</h1>
        <p>
          Mỗi trận chỉ sử dụng kết quả và odds đã tồn tại trước giờ bóng lăn. Kết quả đo hit rate,
          ROI, drawdown và Brier score; không dùng dữ liệu tương lai.
        </p>
      </section>

      <div className="backtest-layout">
        <aside className="backtest-control-card">
          <h2>Chạy mô phỏng</h2>
          <form onSubmit={runBacktest} className="backtest-form">
            <label>ADMIN API token<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="ADMIN_API_TOKEN" /></label>
            <div className="form-grid-two">
              <label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
              <label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            </div>
            <label>Giải đấu<select value={leagueId} onChange={(event) => setLeagueId(event.target.value)}><option value="">Tất cả giải</option>{leagues.map((league) => <option key={league.id} value={league.id}>{league.name} · {league.season}</option>)}</select></label>
            <label>Số trận tối đa<input type="number" min="1" max="5000" value={fixtureLimit} onChange={(event) => setFixtureLimit(event.target.value)} /></label>
            <div className="form-grid-two">
              <label>Min EV<input type="number" step="0.01" value={minimumEv} onChange={(event) => setMinimumEv(event.target.value)} /></label>
              <label>Min Edge<input type="number" step="0.01" value={minimumEdge} onChange={(event) => setMinimumEdge(event.target.value)} /></label>
            </div>
            <label>Min Confidence<input type="number" step="0.01" min="0" max="1" value={minimumConfidence} onChange={(event) => setMinimumConfidence(event.target.value)} /></label>
            <button className="button primary full" disabled={loading}>{loading ? 'Đang chạy…' : 'Chạy backtest'}</button>
          </form>
          {message ? <p className="form-message">{message}</p> : null}
          <div className="run-history">
            <h3>Lịch sử chạy</h3>
            {runs.length === 0 ? <p className="muted">Chưa có backtest.</p> : runs.map((run) => (
              <button key={run.id} onClick={() => void loadDetail(run.id)} className={detail?.id === run.id ? 'active' : ''}>
                <span>#{run.id} · {run.name}</span><small>{run.totalBets} bet · {signed(run.profitUnits)}u</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="backtest-results">
          {!detail ? <div className="empty-state"><h2>Chưa có kết quả</h2><p>Chạy seed rồi thực hiện backtest đầu tiên.</p><code>npm run worker -- backtest</code></div> : (
            <>
              <div className="backtest-title-row"><div><span className="eyebrow">RUN #{detail.id}</span><h2>{detail.name}</h2><p>{dateTime(detail.dateFrom)} → {dateTime(detail.dateTo)} · {detail.modelVersion}</p></div><span className={`run-status ${detail.status.toLowerCase()}`}>{detail.status}</span></div>
              <section className="backtest-stats">
                <div><span>Bet</span><strong>{detail.totalBets}</strong><small>{detail.eligibleFixtures}/{detail.totalFixtures} trận có pick</small></div>
                <div><span>Đúng</span><strong>{detail.wins}</strong><small>{detail.losses} sai · {detail.pushes} hòa tiền</small></div>
                <div><span>Hit rate</span><strong>{percent(detail.hitRate)}</strong><small>Không bao gồm push/void</small></div>
                <div><span>Profit</span><strong className={detail.profitUnits >= 0 ? 'positive' : 'negative'}>{signed(detail.profitUnits)}u</strong><small>{detail.profitAmount == null ? '' : `${money(detail.profitAmount, detail.stakeCurrency ?? 'VND')} · `}ROI {percent(detail.roi)}</small></div>
                <div><span>Max drawdown</span><strong>{(detail.maximumDrawdown ?? 0).toFixed(2)}u</strong><small>Avg odds {(detail.averageOdds ?? 0).toFixed(2)}</small></div>
                <div><span>Brier score</span><strong>{detail.brierScore?.toFixed(3) ?? '—'}</strong><small>Càng thấp càng tốt</small></div>
              </section>

              <section className="backtest-card"><div className="card-heading"><div><span className="eyebrow">EQUITY</span><h3>Lợi nhuận tích lũy</h3></div><strong className={detail.profitUnits >= 0 ? 'positive' : 'negative'}>{signed(detail.profitUnits)} units</strong></div><EquityChart points={detail.equityCurve} /></section>

              <section className="backtest-card"><div className="card-heading"><div><span className="eyebrow">MARKETS</span><h3>Hiệu quả theo market</h3></div></div><div className="table-scroll"><table><thead><tr><th>Market</th><th>Bet</th><th>W-L-P</th><th>Hit rate</th><th>Avg odds</th><th>Profit</th><th>ROI</th></tr></thead><tbody>{detail.byMarket.map((row) => <tr key={row.marketCode}><td><strong>{row.marketCode}</strong></td><td>{row.bets}</td><td>{row.wins}-{row.losses}-{row.pushes}</td><td>{percent(row.hitRate)}</td><td>{row.averageOdds?.toFixed(2) ?? '—'}</td><td className={row.profitUnits >= 0 ? 'positive' : 'negative'}>{signed(row.profitUnits)}u</td><td>{percent(row.roi)}</td></tr>)}</tbody></table></div></section>

              <section className="backtest-card"><div className="card-heading"><div><span className="eyebrow">BET LOG</span><h3>Từng recommendation đã mô phỏng</h3></div><select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)}><option value="ALL">Tất cả market</option>{detail.byMarket.map((row) => <option key={row.marketCode} value={row.marketCode}>{row.marketCode}</option>)}</select></div><div className="table-scroll bet-log"><table><thead><tr><th>Trận</th><th>Pick</th><th>Odds</th><th>Model / Market</th><th>EV</th><th>Stake / Tiền cược</th><th>Tỷ số</th><th>Kết quả</th><th>P/L</th></tr></thead><tbody>{filteredBets.map((bet) => <tr key={bet.id}><td><strong>{bet.fixture.homeTeam.name} – {bet.fixture.awayTeam.name}</strong><small>{dateTime(bet.kickoffAt)}</small></td><td>{bet.marketName}<small>{bet.selectionName} · {bet.bookmaker.name}</small></td><td>{bet.decimalOdds.toFixed(2)}</td><td>{percent(bet.modelProbability)} / {percent(bet.fairMarketProbability)}</td><td className="positive">+{percent(bet.expectedValue)}</td><td><strong>{bet.stakeUnits.toFixed(2)}u</strong><small>{money(bet.stakeAmount, bet.stakeCurrency ?? detail.stakeCurrency ?? 'VND')}</small></td><td>{bet.homeGoals}–{bet.awayGoals}</td><td><span className={`result-chip ${bet.settlementResult.toLowerCase()}`}>{bet.settlementResult}</span></td><td className={bet.profitUnits >= 0 ? 'positive' : 'negative'}><strong>{signed(bet.profitUnits)}u</strong><small>{money(bet.profitAmount, bet.stakeCurrency ?? detail.stakeCurrency ?? 'VND')}</small></td></tr>)}</tbody></table></div></section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
