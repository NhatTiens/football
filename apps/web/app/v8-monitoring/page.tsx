import { apiFetch } from '../../lib/api';

type Monitoring = {
  generatedAt: string;
  status: string;
  alerts: Array<{ code: string; severity: string; count: number; message: string }>;
  coverage: {
    decisions: number;
    bestBets: number;
    noBets: number;
    settlements: number;
    openBestBets: number;
    totalStakeUnits: number;
    profitUnits: number;
    roi: number | null;
    meanClv: number | null;
  };
  horizonCounts: Record<string, number>;
  upcomingAndRecentDecisions: Array<{
    id: number;
    providerFixtureId: number;
    horizonMinutes: number;
    kickoffAt: string;
    decisionType: string;
    selectedMarket: string | null;
    selectedSelection: string | null;
    lineValue: number | null;
    decimalOdds: number | null;
    modelProbability: number | null;
    edge: number | null;
    candidateCount: number;
    rejectedCandidateCount: number;
    decisionHash: string;
  }>;
  lineage: { calibrationArtifactHash: string; modelVersion: string; policyVersion: string };
  drift: { calibration: string; model: string };
};

function percent(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(2)}%`;
}

function number(value: number | null, digits = 3): string {
  return value == null ? '—' : value.toFixed(digits);
}

function vnTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}

export default async function V8MonitoringPage() {
  const report = await apiFetch<Monitoring>('/scientific/v8-monitoring');
  return (
    <>
      <section className="science-hero">
        <div>
          <div className="science-kicker">V8 CHALLENGER · PIT · PAPER ONLY</div>
          <h1>Giám sát Football AI v8</h1>
          <p>
            Quyết định đa horizon, candidate audit, settlement, CLV và lineage. v7.5 vẫn là
            CURRENT_CHAMPION; trang này không đặt cược thật hay promote tự động.
          </p>
        </div>
        <div className="science-status-card">
          <span className="science-status-label">Trạng thái</span>
          <strong>{report.status}</strong>
          <small>Cập nhật: {vnTime(report.generatedAt)}</small>
          <small>Model drift: {report.drift.model}</small>
          <small>Calibration drift: {report.drift.calibration}</small>
        </div>
      </section>

      <section className="science-metric-grid">
        <article className="science-metric-card">
          <span>Quyết định v8</span>
          <strong>{report.coverage.decisions}</strong>
          <small>{report.coverage.bestBets} BEST_BET · {report.coverage.noBets} NO_BET</small>
        </article>
        <article className="science-metric-card">
          <span>Settlement</span>
          <strong>{report.coverage.settlements}</strong>
          <small>Đang mở: {report.coverage.openBestBets}</small>
        </article>
        <article className="science-metric-card">
          <span>ROI paper</span>
          <strong>{percent(report.coverage.roi)}</strong>
          <small>{number(report.coverage.profitUnits, 2)}u · stake {number(report.coverage.totalStakeUnits, 1)}u</small>
        </article>
        <article className="science-metric-card">
          <span>CLV trung bình</span>
          <strong>{percent(report.coverage.meanClv)}</strong>
          <small>Closing odds snapshot thật</small>
        </article>
      </section>

      <section className="science-panel">
        <div className="science-panel-header"><h2>Cảnh báo vận hành</h2></div>
        {report.alerts.length === 0 ? <p className="science-empty">Không có cảnh báo.</p> : (
          <div className="science-chip-list">
            {report.alerts.map((alert) => (
              <span className="science-chip" key={alert.code} title={alert.message}>
                {alert.severity} · {alert.code} ({alert.count})
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="science-panel">
        <div className="science-panel-header"><h2>Độ phủ horizon</h2></div>
        <div className="science-chip-list">
          {Object.entries(report.horizonCounts).map(([horizon, count]) => (
            <span className="science-chip" key={horizon}>{horizon}: {count}</span>
          ))}
        </div>
      </section>

      <section className="science-panel">
        <div className="science-panel-header"><h2>Quyết định gần nhất</h2></div>
        {report.upcomingAndRecentDecisions.length === 0 ? (
          <p className="science-empty">Chưa có quyết định v8 live. Runtime đang chờ đúng cửa sổ horizon.</p>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Fixture</th><th>Horizon</th><th>Decision</th><th>Market</th><th>P(model)</th><th>Odds</th><th>Edge</th><th>Candidate</th></tr></thead>
            <tbody>{report.upcomingAndRecentDecisions.map((row) => (
              <tr key={row.id} title={`Hash: ${row.decisionHash}`}>
                <td>#{row.providerFixtureId}<small>{vnTime(row.kickoffAt)}</small></td>
                <td>T-{row.horizonMinutes}</td><td>{row.decisionType}</td>
                <td>{row.selectedMarket ?? '—'} {row.selectedSelection ?? ''} {row.lineValue ?? ''}</td>
                <td>{percent(row.modelProbability)}</td><td>{number(row.decimalOdds, 2)}</td>
                <td>{percent(row.edge)}</td>
                <td>{row.candidateCount - row.rejectedCandidateCount}/{row.candidateCount}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="science-panel">
        <div className="science-panel-header"><h2>PIT lineage</h2></div>
        <p><strong>Model:</strong> {report.lineage.modelVersion}</p>
        <p><strong>Policy:</strong> {report.lineage.policyVersion}</p>
        <p><strong>Calibration SHA-256:</strong> <code>{report.lineage.calibrationArtifactHash}</code></p>
      </section>
    </>
  );
}

