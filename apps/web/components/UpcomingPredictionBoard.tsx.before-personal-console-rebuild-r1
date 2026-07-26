'use client';

import { useMemo, useState } from 'react';
import type {
  PersonalLeagueDto,
  PersonalUpcomingAnalysisDto,
  PersonalUpcomingFixtureDto,
} from '../lib/personal-types';

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

function pct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}
function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}
function when(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}
function pickName(row: PersonalUpcomingFixtureDto): string {
  const pick = row.prediction.predictedSelection;
  if (pick === 'HOME') return row.fixture.homeTeam.name;
  if (pick === 'AWAY') return row.fixture.awayTeam.name;
  if (pick === 'DRAW') return 'Hòa';
  return 'Chưa đủ dữ liệu';
}
function selectionName(row: PersonalUpcomingFixtureDto): string {
  const pick = row.decision?.selectedSelection;
  if (pick === 'HOME') return row.fixture.homeTeam.name;
  if (pick === 'AWAY') return row.fixture.awayTeam.name;
  if (pick === 'DRAW') return 'Hòa';
  return pick ?? '—';
}

export function UpcomingPredictionBoard({
  initialData,
  leagues,
}: {
  initialData: PersonalUpcomingAnalysisDto;
  leagues: PersonalLeagueDto[];
}) {
  const [data, setData] = useState(initialData);
  const [days, setDays] = useState(String(initialData.window.days));
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [leagueFilter, setLeagueFilter] = useState<number | 'ALL'>('ALL');
  const [show, setShow] = useState<'ALL' | 'BEST_BET' | 'WAITING'>('ALL');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => {
    return data.fixtures.filter((row) => {
      if (leagueFilter !== 'ALL' && row.fixture.league.id !== leagueFilter) return false;
      if (show === 'BEST_BET' && row.state !== 'BEST_BET') return false;
      if (show === 'WAITING' && !row.state.startsWith('WAITING')) return false;
      return true;
    });
  }, [data.fixtures, leagueFilter, show]);

  function toggleLeague(id: number): void {
    setSelectedLeagueIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function loadAnalysis(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ days });
      if (selectedLeagueIds.length > 0) params.set('leagueIds', selectedLeagueIds.join(','));
      const response = await fetch(`${apiUrl}/personal/upcoming-analysis?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as PersonalUpcomingAnalysisDto);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được dự đoán.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshFromProvider(): Promise<void> {
    const confirmed = window.confirm(
      'Lệnh này sẽ gọi API-Football, đồng bộ fixture/prediction, thu odds đang đến hạn và chạy BEST BET policy. Tiếp tục?',
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage('Đang đồng bộ API-Football và chạy scientific decision…');
    try {
      const response = await fetch(`${apiUrl}/personal/upcoming/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          days: Number(days),
          leagueIds: selectedLeagueIds,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? `HTTP ${response.status}`);
      setMessage('Đồng bộ xong. Đang tải lại bảng dự đoán…');
      await loadAnalysis();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Đồng bộ thất bại.');
      setLoading(false);
    }
  }

  return (
    <div className="beta1e-page">
      <section className="beta1e-hero">
        <div>
          <span className="eyebrow">PERSONAL RESEARCH CONSOLE</span>
          <h1>Dự đoán trận sắp tới & BEST BET</h1>
          <p>
            Prediction có thể xuất hiện trước. BEST BET chỉ được gắn khi scientific policy đã có
            odds thật, đúng horizon và reliability gate đạt yêu cầu.
          </p>
        </div>
        <div className="beta1e-hero-actions">
          <button className="button primary" disabled={loading} onClick={() => void refreshFromProvider()}>
            {loading ? 'Đang xử lý…' : 'Đồng bộ & phân tích'}
          </button>
          <button className="button secondary" disabled={loading} onClick={() => void loadAnalysis()}>
            Làm mới màn hình
          </button>
        </div>
      </section>

      {message ? <div className="beta1e-message">{message}</div> : null}

      <section className="beta1e-kpis">
        <div><span>Trận sắp tới</span><strong>{data.counts.fixtures}</strong><small>{data.window.days} ngày</small></div>
        <div><span>Có prediction</span><strong>{data.counts.predicted}</strong><small>provider hoặc scientific</small></div>
        <div className="accent"><span>BEST BET</span><strong>{data.counts.bestBets}</strong><small>policy-qualified</small></div>
        <div><span>NO BET</span><strong>{data.counts.noBets}</strong><small>đã đánh giá</small></div>
        <div><span>Đang chờ</span><strong>{data.counts.waiting}</strong><small>odds / horizon / model</small></div>
      </section>

      {data.topBestBets.length > 0 ? (
        <section className="beta1e-bestbet-zone">
          <div className="section-heading">
            <div><span className="eyebrow">TOP SCIENTIFIC VALUE</span><h2>BEST BET sắp tới</h2></div>
          </div>
          <div className="beta1e-best-grid">
            {data.topBestBets.slice(0, 5).map((row, index) => (
              <article className="beta1e-best-card" key={row.fixture.id}>
                <div className="beta1e-rank">#{index + 1}</div>
                <div className="beta1e-league">{row.fixture.league.name} · {when(row.fixture.kickoffAt)}</div>
                <h3>{row.fixture.homeTeam.name} <span>vs</span> {row.fixture.awayTeam.name}</h3>
                <div className="beta1e-pick">{selectionName(row)}</div>
                <div className="beta1e-value-row">
                  <span>Odds <b>{num(row.decision?.decimalOdds)}</b></span>
                  <span>Edge <b>{pct(row.decision?.edge)}</b></span>
                  <span>EV <b>{pct(row.decision?.expectedValue)}</b></span>
                </div>
                <div className="beta1e-stake">
                  {row.stake
                    ? `${row.stake.stakeDecisionType} · ${num(row.stake.stakeUnits)}u · ${row.stake.riskBand}`
                    : 'Risk overlay đang chờ'}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <div className="beta1e-info">
          Chưa có BEST BET chính thức. Hệ thống sẽ giữ trạng thái WAITING/NO BET thay vì ép tạo kèo.
        </div>
      )}

      <section className="beta1e-controls">
        <div className="beta1e-filter-row">
          <label>
            Cửa sổ
            <select value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="3">3 ngày</option>
              <option value="7">7 ngày</option>
              <option value="14">14 ngày</option>
            </select>
          </label>
          <label>
            Hiển thị
            <select value={show} onChange={(event) => setShow(event.target.value as typeof show)}>
              <option value="ALL">Tất cả</option>
              <option value="BEST_BET">Chỉ BEST BET</option>
              <option value="WAITING">Đang chờ</option>
            </select>
          </label>
          <label>
            Lọc giải
            <select
              value={leagueFilter}
              onChange={(event) =>
                setLeagueFilter(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value))
              }
            >
              <option value="ALL">Tất cả giải</option>
              {data.leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.country ? `${league.country} · ` : ''}{league.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details className="beta1e-league-picker">
          <summary>Chọn giải dùng khi “Đồng bộ & phân tích” ({selectedLeagueIds.length || 'tất cả enabled'})</summary>
          <div className="beta1e-checkbox-grid">
            {leagues.map((league) => (
              <label key={league.id}>
                <input
                  type="checkbox"
                  checked={selectedLeagueIds.includes(league.id)}
                  onChange={() => toggleLeague(league.id)}
                />
                <span>{league.country ? `${league.country} · ` : ''}{league.name} · {league.season}</span>
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className="beta1e-fixture-list">
        {visible.length === 0 ? (
          <div className="empty-state">Không có trận phù hợp bộ lọc.</div>
        ) : visible.map((row) => (
          <article className={`beta1e-match ${row.state === 'BEST_BET' ? 'best' : ''}`} key={row.fixture.id}>
            <div className="beta1e-match-head">
              <div>
                <span className="beta1e-league">{row.fixture.league.name}</span>
                <strong>{when(row.fixture.kickoffAt)}</strong>
              </div>
              <span className={`beta1e-state ${row.state.toLowerCase().replaceAll('_', '-')}`}>
                {row.state.replaceAll('_', ' ')}
              </span>
            </div>

            <div className="beta1e-teams">
              <div><b>{row.fixture.homeTeam.name}</b><span>{pct(row.prediction.homeProbability)}</span></div>
              <div className="draw"><b>Hòa</b><span>{pct(row.prediction.drawProbability)}</span></div>
              <div><b>{row.fixture.awayTeam.name}</b><span>{pct(row.prediction.awayProbability)}</span></div>
            </div>

            <div className="beta1e-prediction-summary">
              <span>Prediction: <b>{pickName(row)}</b></span>
              <span>Nguồn: <b>{row.prediction.source}</b></span>
              {row.nextCheckpoint ? (
                <span>
                  Mốc kế tiếp: <b>{row.nextCheckpoint.horizonLabel}</b> · {when(row.nextCheckpoint.dueAt)}
                </span>
              ) : null}
            </div>

            {row.decision ? (
              <div className="beta1e-decision-box">
                <div>
                  <small>Scientific decision</small>
                  <strong>{row.decision.decisionType}</strong>
                </div>
                {row.decision.decisionType === 'BEST_BET' ? (
                  <>
                    <div><small>Pick</small><strong>{selectionName(row)}</strong></div>
                    <div><small>Odds</small><strong>{num(row.decision.decimalOdds)}</strong></div>
                    <div><small>Edge</small><strong>{pct(row.decision.edge)}</strong></div>
                    <div><small>EV</small><strong>{pct(row.decision.expectedValue)}</strong></div>
                  </>
                ) : (
                  <div className="wide"><small>Kết quả</small><strong>Không có candidate đủ policy</strong></div>
                )}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <p className="beta1e-footnote">
        Personal mode · không tự đặt cược · không real-money · không tạo BEST BET khi chưa đủ bằng chứng.
      </p>
    </div>
  );
}
