'use client';

import { useState } from 'react';
import type { ScientificDashboardDto } from '../lib/scientific-types';

const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

function number(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(new Date(value));
}

function StatusFlag({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`beta1d-status ${ok ? 'ok' : 'waiting'}`}>{ok ? '✓' : '…'} {label}</span>;
}

export function ScientificBacktestPanel({
  initialData,
}: {
  initialData: ScientificDashboardDto | null;
}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'overview' | 'odds' | 'decisions' | 'risk'>('overview');
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${publicApiUrl}/scientific/dashboard`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Scientific dashboard HTTP ${response.status}`);
      setData((await response.json()) as ScientificDashboardDto);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải scientific dashboard.');
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <section className="beta1d-shell">
        <div className="beta1d-title-row">
          <div>
            <span className="eyebrow">V7 SCIENTIFIC CONTROL PLANE</span>
            <h1>Backtest & Evidence Dashboard</h1>
          </div>
          <button className="button secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Đang tải…' : 'Thử tải lại'}
          </button>
        </div>
        <div className="disclaimer">
          Scientific endpoint chưa sẵn sàng. Legacy backtest phía dưới vẫn hoạt động bình thường.
        </div>
      </section>
    );
  }

  const riskMetrics = data.risk.metrics;
  const freshCompletion =
    data.freshOdds.totalCheckpoints > 0
      ? data.freshOdds.completedCheckpoints / data.freshOdds.totalCheckpoints
      : 0;

  return (
    <section className="beta1d-shell">
      <div className="beta1d-title-row">
        <div>
          <span className="eyebrow">V7 SCIENTIFIC CONTROL PLANE</span>
          <h1>Backtest & Evidence Dashboard</h1>
          <p>
            Một màn hình đọc-only cho fresh odds, BEST BET/NO BET, bankroll/risk và bằng chứng
            scientific. Không gọi API bên ngoài, không đặt cược và không auto-promote model.
          </p>
        </div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      {message ? <div className="beta1d-message">{message}</div> : null}

      <div className="beta1d-readiness">
        <StatusFlag ok={data.readiness.freshOddsOperational} label="Fresh collector" />
        <StatusFlag ok={data.readiness.freshOddsSuccessEvidence} label="Fresh odds SUCCESS" />
        <StatusFlag ok={data.readiness.riskPolicyFrozen} label="Risk policy frozen" />
        <StatusFlag ok={data.readiness.freshStakeEvidence} label="Fresh STAKE/NO_STAKE" />
        <StatusFlag ok={data.readiness.freshSettlementEvidence} label="Fresh settlement" />
      </div>

      <div className="beta1d-kpis">
        <div><span>Fresh checkpoints</span><strong>{data.freshOdds.totalCheckpoints}</strong><small>{percent(freshCompletion)} completed</small></div>
        <div><span>BEST BET</span><strong>{data.paper.bestBets}</strong><small>{data.paper.noBets} NO BET</small></div>
        <div><span>Paper settlements</span><strong>{data.paper.settlements}</strong><small>{data.paper.totalDecisions} decisions</small></div>
        <div><span>Bankroll</span><strong>{riskMetrics ? `${number(riskMetrics.currentBankrollUnits)}u` : '—'}</strong><small>{riskMetrics ? `${signed(riskMetrics.profitUnits)}u P/L` : 'No policy'}</small></div>
        <div><span>Yield</span><strong>{riskMetrics ? percent(riskMetrics.yieldRate) : '—'}</strong><small>{riskMetrics ? `${number(riskMetrics.settledStakeUnits)}u settled` : 'Waiting'}</small></div>
        <div><span>Max drawdown</span><strong>{riskMetrics ? percent(riskMetrics.maximumDrawdownFraction) : '—'}</strong><small>risk-adjusted paper only</small></div>
      </div>

      <div className="beta1d-tabs" role="tablist">
        {[
          ['overview', 'Tổng quan'],
          ['odds', 'Fresh Odds'],
          ['decisions', 'Decision Audit'],
          ['risk', 'Bankroll / Risk'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key as typeof tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="beta1d-grid two">
          <article className="beta1d-card">
            <span className="eyebrow">READINESS</span>
            <h3>Điều kiện trước beta.2</h3>
            <div className="beta1d-checklist">
              <StatusFlag ok={data.readiness.freshOddsSuccessEvidence} label="Có odds fresh SUCCESS thật" />
              <StatusFlag ok={data.readiness.freshStakeEvidence} label="Có STAKE hoặc NO_STAKE fresh" />
              <StatusFlag ok={data.readiness.freshSettlementEvidence} label="Có settlement risk-adjusted" />
            </div>
            <p className="beta1d-muted">
              Development có thể tiếp tục, nhưng beta.2 Fresh Shadow chỉ mở khi các bằng chứng trên
              được ghi nhận end-to-end.
            </p>
          </article>

          <article className="beta1d-card">
            <span className="eyebrow">LEGACY BASELINE</span>
            <h3>Backtest gần nhất</h3>
            {data.legacyBacktest ? (
              <dl className="beta1d-dl">
                <div><dt>Run</dt><dd>#{data.legacyBacktest.id} · {data.legacyBacktest.name}</dd></div>
                <div><dt>Model</dt><dd>{data.legacyBacktest.modelVersion}</dd></div>
                <div><dt>Bets</dt><dd>{data.legacyBacktest.totalBets}</dd></div>
                <div><dt>Hit rate</dt><dd>{percent(data.legacyBacktest.hitRate)}</dd></div>
                <div><dt>ROI</dt><dd>{percent(data.legacyBacktest.roi)}</dd></div>
                <div><dt>P/L</dt><dd>{signed(data.legacyBacktest.profitUnits)}u</dd></div>
              </dl>
            ) : (
              <p className="beta1d-muted">Chưa có legacy backtest SUCCESS.</p>
            )}
          </article>

          <article className="beta1d-card beta1d-wide">
            <span className="eyebrow">INTEGRITY</span>
            <h3>Scientific contract</h3>
            <div className="beta1d-integrity">
              <span>Read only: <b>{String(data.integrity.readOnlyDashboard)}</b></span>
              <span>Paper only: <b>{String(data.integrity.paperOnly)}</b></span>
              <span>External API: <b>{String(data.integrity.externalApiCalledByDashboard)}</b></span>
              <span>Synthetic odds: <b>{String(data.integrity.syntheticOddsUsedByDashboard)}</b></span>
              <span>Auto bet: <b>{String(data.integrity.automaticBetPlacement)}</b></span>
              <span>Real money: <b>{String(data.integrity.realMoneyExecution)}</b></span>
              <span>Auto promotion: <b>{String(data.integrity.automaticPromotion)}</b></span>
              <span>BEST BET policy changed: <b>{String(data.integrity.sourceBestBetPolicyChanged)}</b></span>
            </div>
          </article>
        </div>
      ) : null}

      {tab === 'odds' ? (
        <div className="beta1d-card">
          <div className="section-heading">
            <div><span className="eyebrow">FRESH ODDS</span><h2>Coverage theo horizon</h2></div>
            <span className="beta1d-muted">{data.freshOdds.completedCheckpoints}/{data.freshOdds.totalCheckpoints} completed</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Horizon</th><th>Total</th><th>SUCCESS</th><th>SKIPPED</th><th>RETRY</th><th>FAILED</th><th>Pending</th><th>Inserted odds</th><th>PIT usable</th></tr></thead>
              <tbody>
                {data.freshOdds.byHorizon.map((row) => (
                  <tr key={`${row.horizonMinutes}:${row.label}`}>
                    <td><b>{row.label}</b></td>
                    <td>{row.total}</td>
                    <td className="positive">{row.success}</td>
                    <td>{row.skipped}</td>
                    <td>{row.retry}</td>
                    <td className={row.failed > 0 ? 'negative' : ''}>{row.failed}</td>
                    <td>{row.pending}</td>
                    <td>{row.insertedOdds}</td>
                    <td>{row.pitUsableOdds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.freshOdds.latestCheckpoint ? (
            <p className="beta1d-muted">
              Latest: fixture {data.freshOdds.latestCheckpoint.providerFixtureId} · {data.freshOdds.latestCheckpoint.horizonLabel} · {data.freshOdds.latestCheckpoint.status} · updated {dateTime(data.freshOdds.latestCheckpoint.updatedAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'decisions' ? (
        <div className="beta1d-card">
          <div className="section-heading">
            <div><span className="eyebrow">DECISION AUDIT</span><h2>BEST BET / NO BET gần nhất</h2></div>
            <span className="beta1d-muted">append-only decision ledger</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Thời điểm</th><th>Trận</th><th>Horizon</th><th>Decision</th><th>Market / Pick</th><th>Odds</th><th>Model</th><th>Fair market</th><th>Edge</th><th>EV</th></tr></thead>
              <tbody>
                {data.paper.recentDecisions.length === 0 ? (
                  <tr><td colSpan={10}>Chưa có decision trong scientific paper ledger.</td></tr>
                ) : data.paper.recentDecisions.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.decisionAsOf)}</td>
                    <td>{row.fixture?.homeTeam && row.fixture?.awayTeam ? `${row.fixture.homeTeam} – ${row.fixture.awayTeam}` : `Fixture ${row.providerFixtureId}`}</td>
                    <td>T-{row.horizonMinutes}</td>
                    <td><span className={`beta1d-decision ${row.decisionType === 'BEST_BET' ? 'bet' : 'no-bet'}`}>{row.decisionType}</span></td>
                    <td>{row.selectedMarket ?? '—'}{row.selectedSelection ? ` / ${row.selectedSelection}` : ''}</td>
                    <td>{row.decimalOdds ? number(row.decimalOdds) : '—'}</td>
                    <td>{percent(row.modelProbability)}</td>
                    <td>{percent(row.fairMarketProbability)}</td>
                    <td>{percent(row.edge)}</td>
                    <td>{percent(row.expectedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'risk' ? (
        <div className="beta1d-grid two">
          <article className="beta1d-card">
            <span className="eyebrow">ACTIVE POLICY</span>
            <h3>Bankroll & staking</h3>
            {data.risk.policy ? (
              <dl className="beta1d-dl">
                <div><dt>Account</dt><dd>{data.risk.policy.accountKey}</dd></div>
                <div><dt>Mode</dt><dd>{data.risk.policy.stakingMode}</dd></div>
                <div><dt>Starting</dt><dd>{number(data.risk.policy.startingBankrollUnits)}u</dd></div>
                <div><dt>Flat stake</dt><dd>{number(data.risk.policy.flatStakeUnits)}u</dd></div>
                <div><dt>Max bet</dt><dd>{percent(data.risk.policy.maximumStakeFraction)}</dd></div>
                <div><dt>Daily exposure</dt><dd>{percent(data.risk.policy.maximumDailyExposureFraction)}</dd></div>
                <div><dt>Open exposure</dt><dd>{percent(data.risk.policy.maximumOpenExposureFraction)}</dd></div>
                <div><dt>Hard drawdown</dt><dd>{percent(data.risk.policy.drawdownHardLimit)}</dd></div>
              </dl>
            ) : <p className="beta1d-muted">Chưa freeze risk policy.</p>}
          </article>

          <article className="beta1d-card">
            <span className="eyebrow">LIVE PAPER STATE</span>
            <h3>Exposure & drawdown</h3>
            {riskMetrics ? (
              <dl className="beta1d-dl">
                <div><dt>Current bankroll</dt><dd>{number(riskMetrics.currentBankrollUnits)}u</dd></div>
                <div><dt>P/L</dt><dd>{signed(riskMetrics.profitUnits)}u</dd></div>
                <div><dt>Open exposure</dt><dd>{number(riskMetrics.openExposureUnits)}u</dd></div>
                <div><dt>Daily exposure</dt><dd>{number(riskMetrics.dailyExposureUnits)}u</dd></div>
                <div><dt>Daily realized</dt><dd>{signed(riskMetrics.dailyRealizedPnlUnits)}u</dd></div>
                <div><dt>Current DD</dt><dd>{percent(riskMetrics.currentDrawdownFraction)}</dd></div>
                <div><dt>Maximum DD</dt><dd>{percent(riskMetrics.maximumDrawdownFraction)}</dd></div>
                <div><dt>Yield</dt><dd>{percent(riskMetrics.yieldRate)}</dd></div>
              </dl>
            ) : <p className="beta1d-muted">Waiting for active policy.</p>}
          </article>

          <article className="beta1d-card beta1d-wide">
            <span className="eyebrow">LEDGER COUNTS</span>
            <h3>Stake decisions & settlements</h3>
            <div className="beta1d-integrity">
              {Object.entries(data.risk.stakeDecisions).length === 0 ? <span>Stake decisions: <b>0</b></span> : Object.entries(data.risk.stakeDecisions).map(([key, value]) => <span key={key}>{key}: <b>{value}</b></span>)}
              {Object.entries(data.risk.settlements).length === 0 ? <span>Settlements: <b>0</b></span> : Object.entries(data.risk.settlements).map(([key, value]) => <span key={key}>{key}: <b>{value}</b></span>)}
            </div>
          </article>
        </div>
      ) : null}

      <p className="beta1d-generated">Generated {dateTime(data.generatedAt)} · {data.version}</p>
    </section>
  );
}
