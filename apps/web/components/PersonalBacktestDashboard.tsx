'use client';

import { useMemo, useState } from 'react';

import { dateTime, percent } from '../lib/format';
import {
  classifyPersonalLeague,
  groupLabel,
  selectGroupLeagueIds,
  type PersonalLeagueGroup,
} from '../lib/league-profile';
import type {
  PersonalBacktestLeagueCoverageDto,
  PersonalBacktestRunResponse,
} from '../lib/personal-types';
import type { BacktestDetailDto, BacktestRunDto } from '../lib/types';

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function signed(value: number | null | undefined, digits = 2): string {
  const number = value ?? 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}`;
}


function marketDisplayName(code: string): string {
  if (code === 'MATCH_WINNER') return 'HDA / 1X2';
  if (code === 'BTTS') return 'BTTS';
  if (code === 'TOTAL_GOALS_1_5') return 'Over / Under 1.5';
  if (code === 'TOTAL_GOALS_2_5') return 'Over / Under 2.5';
  if (code === 'TOTAL_GOALS_3_5') return 'Over / Under 3.5';
  return code;
}

function EquityChart({ points }: { points: BacktestDetailDto['equityCurve'] }) {
  if (points.length < 2) {
    return <div className="pcr-empty">Chưa đủ bản ghi để vẽ đường hiệu suất.</div>;
  }

  const width = 900;
  const height = 250;
  const padding = 28;
  const equities = points.map((point) => point.equity);
  const minimum = Math.min(0, ...equities);
  const maximum = Math.max(0, ...equities);
  const range = Math.max(1, maximum - minimum);
  const zeroY = height - padding - ((0 - minimum) / range) * (height - padding * 2);

  const coordinates = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y =
      height - padding - ((point.equity - minimum) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="pcr-equity-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="pcr-equity">
        <line x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} />
        <polyline points={coordinates.join(' ')} />
      </svg>
    </div>
  );
}

export function PersonalBacktestDashboard({
  initialRuns,
  initialDetail,
  leagues,
}: {
  initialRuns: BacktestRunDto[];
  initialDetail: BacktestDetailDto | null;
  leagues: PersonalBacktestLeagueCoverageDto[];
}) {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);

  const [runs, setRuns] = useState<BacktestRunDto[]>(initialRuns);
  const [detail, setDetail] = useState<BacktestDetailDto | null>(initialDetail);
  const [batchResults, setBatchResults] = useState<BacktestDetailDto[]>([]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [leagueSearch, setLeagueSearch] = useState<string>('');
  const [leagueGroupFilter, setLeagueGroupFilter] = useState<PersonalLeagueGroup | 'ALL'>('ALL');
  const [from, setFrom] = useState<string>(initialDetail?.dateFrom.slice(0, 10) ?? isoDate(yearAgo));
  const [to, setTo] = useState<string>(initialDetail?.dateTo.slice(0, 10) ?? isoDate(now));
  const [fixtureLimit, setFixtureLimit] = useState<string>('1000');
  const [minimumEv, setMinimumEv] = useState<string>('0.03');
  const [minimumEdge, setMinimumEdge] = useState<string>('0.02');
  const [minimumConfidence, setMinimumConfidence] = useState<string>('0.50');
  const [marketFilter, setMarketFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const searchableLeagues = useMemo(() => {
    const keyword = leagueSearch.trim().toLowerCase();
    return leagues.filter((league) => {
      if (
        leagueGroupFilter !== 'ALL' &&
        classifyPersonalLeague(league) !== leagueGroupFilter
      ) {
        return false;
      }
      if (!keyword) return true;
      return `${league.country ?? ''} ${league.name} ${league.season}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [leagueGroupFilter, leagueSearch, leagues]);

  const filteredBets = useMemo(
    () =>
      detail?.bets.filter((bet) => marketFilter === 'ALL' || bet.marketCode === marketFilter) ?? [],
    [detail, marketFilter],
  );

  function toggleLeague(id: number): void {
    setSelectedLeagueIds((current: number[]) =>
      current.includes(id)
        ? current.filter((value: number): boolean => value !== id)
        : [...current, id].slice(0, 16),
    );
  }

  async function loadDetail(id: number): Promise<BacktestDetailDto> {
    const response = await fetch(`${apiUrl}/backtests/${id}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Không tải được lần đánh giá #${id}.`);
    return (await response.json()) as BacktestDetailDto;
  }

  async function openRun(id: number): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      setDetail(await loadDetail(id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được run.');
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setMessage(
      selectedLeagueIds.length > 0
        ? `Đang chạy ${selectedLeagueIds.length} giải riêng biệt…`
        : 'Đang chạy đánh giá mô hình gộp tất cả giải trong DB…',
    );

    try {
      const response = await fetch(`${apiUrl}/backtests/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: `${from}T00:00:00.000Z`,
          to: `${to}T23:59:59.999Z`,
          leagueIds: selectedLeagueIds,
          fixtureLimit: Number(fixtureLimit),
          stakeUnits: 1,
          rules: {
            minimumExpectedValue: Number(minimumEv),
            minimumEdge: Number(minimumEdge),
            minimumConfidence: Number(minimumConfidence),
          },
        }),
      });

      const payload = (await response.json()) as PersonalBacktestRunResponse & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? `HTTP ${response.status}`);
      }

      const details: BacktestDetailDto[] = [];
      for (const run of payload.runs) {
        details.push(await loadDetail(run.id));
      }

      setBatchResults(details);
      if (details[0]) setDetail(details[0]);

      setRuns((current: BacktestRunDto[]) => {
        const newIds = new Set(details.map((row: BacktestDetailDto): number => row.id));
        return [...details, ...current.filter((row: BacktestRunDto): boolean => !newIds.has(row.id))];
      });

      setMessage(
        `Hoàn thành ${details.length} run. Đánh giá mô hình cá nhân không dùng ADMIN_API_TOKEN.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Đánh giá mô hình thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pcr-backtest-page">
      <section className="pcr-hero compact">
        <div>
          <span className="eyebrow">POINT-IN-TIME MODEL EVALUATION</span>
          <h1>Đánh giá mô hình nhiều giải</h1>
          <p>
            Chọn tối đa 16 giải. Hệ thống tạo một lần đánh giá riêng cho từng giải để bạn so sánh
            ROI, hit rate, drawdown và Brier rõ ràng.
          </p>
        </div>
        <div className="pcr-personal-badge">PERSONAL MODE</div>
      </section>

      <div className="pcr-backtest-layout">
        <aside className="pcr-backtest-sidebar">
          <form onSubmit={runBacktest}>
            <div className="pcr-form-two">
              <label>
                Từ ngày
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                Đến ngày
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </label>
            </div>

            <div className="pcr-field">
              <div className="pcr-field-title">
                <b>Giải đấu ({selectedLeagueIds.length}/16)</b>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedLeagueIds(
                        leagues
                          .filter(
                            (league: PersonalBacktestLeagueCoverageDto): boolean =>
                              league.finishedFixtures > 0,
                          )
                          .slice(0, 16)
                          .map((league: PersonalBacktestLeagueCoverageDto): number => league.id),
                      )
                    }
                  >
                    Chọn 16 giải có data
                  </button>
                  <button type="button" onClick={() => setSelectedLeagueIds([])}>
                    Gộp tất cả
                  </button>
                </div>
              </div>

              <div className="pcr-priority-profiles">
                {(['SEA', 'ASIA', 'EPL', 'LALIGA'] as PersonalLeagueGroup[]).map((group) => (
                  <button
                    type="button"
                    key={group}
                    onClick={() =>
                      setSelectedLeagueIds(
                        selectGroupLeagueIds(leagues, group, {
                          requireFinished: true,
                          limit: 16,
                        }),
                      )
                    }
                  >
                    {groupLabel(group)}
                  </button>
                ))}
              </div>

              <select
                value={leagueGroupFilter}
                onChange={(event) =>
                  setLeagueGroupFilter(event.target.value as PersonalLeagueGroup | 'ALL')
                }
              >
                <option value="ALL">Hiển thị tất cả khu vực</option>
                <option value="SEA">Đông Nam Á</option>
                <option value="ASIA">Châu Á</option>
                <option value="EPL">Ngoại hạng Anh</option>
                <option value="LALIGA">La Liga</option>
                <option value="OTHER">Khác</option>
              </select>

              <input
                type="search"
                placeholder="Tìm Premier League, Japan, Vietnam…"
                value={leagueSearch}
                onChange={(event) => setLeagueSearch(event.target.value)}
              />

              <div className="pcr-backtest-leagues">
                {searchableLeagues.map((league) => (
                  <label
                    key={league.id}
                    className={[
                      selectedLeagueIds.includes(league.id) ? 'selected' : '',
                      league.finishedFixtures === 0 ? 'disabled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      type="checkbox"
                      disabled={league.finishedFixtures === 0}
                      checked={selectedLeagueIds.includes(league.id)}
                      onChange={() => toggleLeague(league.id)}
                    />
                    <span>
                      <b>{league.name}</b>
                      <small>
                        {league.country ?? '—'} · {league.season} · {league.finishedFixtures} finished
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label>
              Fixture tối đa / run
              <input
                type="number"
                min="1"
                max="5000"
                value={fixtureLimit}
                onChange={(event) => setFixtureLimit(event.target.value)}
              />
            </label>

            <div className="pcr-form-two">
              <label>
                Min EV
                <input
                  type="number"
                  step="0.01"
                  value={minimumEv}
                  onChange={(event) => setMinimumEv(event.target.value)}
                />
              </label>
              <label>
                Min Edge
                <input
                  type="number"
                  step="0.01"
                  value={minimumEdge}
                  onChange={(event) => setMinimumEdge(event.target.value)}
                />
              </label>
            </div>

            <label>
              Min Confidence
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={minimumConfidence}
                onChange={(event) => setMinimumConfidence(event.target.value)}
              />
            </label>

            <button type="submit" className="button primary pcr-full" disabled={loading}>
              {loading
                ? 'Đang chạy…'
                : selectedLeagueIds.length > 0
                  ? `Chạy ${selectedLeagueIds.length} giải`
                  : 'Chạy gộp tất cả giải'}
            </button>
          </form>

          {message ? <div className="pcr-message compact-message">{message}</div> : null}

          <div className="pcr-run-history">
            <h3>Lịch sử gần đây</h3>
            {runs.slice(0, 30).map((run) => (
              <button
                type="button"
                key={run.id}
                className={detail?.id === run.id ? 'active' : ''}
                onClick={() => void openRun(run.id)}
              >
                <span>#{run.id} · {run.league?.name ?? 'All leagues'}</span>
                <small>{run.totalBets} bet · {signed(run.profitUnits)}u</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="pcr-backtest-main">
          {batchResults.length > 1 ? (
            <section className="pcr-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">BATCH COMPARISON</span>
                  <h2>So sánh các giải vừa chạy</h2>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Giải</th>
                      <th>Bản ghi</th>
                      <th>Hit rate</th>
                      <th>Điểm</th>
                      <th>Hiệu suất</th>
                      <th>Drawdown</th>
                      <th>Brier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map((row) => (
                      <tr key={row.id} onClick={() => setDetail(row)} className="pcr-click-row">
                        <td><b>{row.league?.name ?? row.name}</b></td>
                        <td>{row.totalBets}</td>
                        <td>{percent(row.hitRate)}</td>
                        <td className={row.profitUnits >= 0 ? 'positive' : 'negative'}>
                          {signed(row.profitUnits)}u
                        </td>
                        <td>{percent(row.roi)}</td>
                        <td>{(row.maximumDrawdown ?? 0).toFixed(2)}u</td>
                        <td>{row.brierScore?.toFixed(3) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {!detail ? (
            <div className="pcr-empty">Chưa có kết quả đánh giá mô hình.</div>
          ) : (
            <>
              <section className="pcr-result-head">
                <div>
                  <span className="eyebrow">RUN #{detail.id}</span>
                  <h2>{detail.league?.name ?? detail.name}</h2>
                  <p>
                    {dateTime(detail.dateFrom)} → {dateTime(detail.dateTo)} · {detail.modelVersion}
                  </p>
                </div>
                <span className={`run-status ${detail.status.toLowerCase()}`}>{detail.status}</span>
              </section>

              <section className="pcr-result-kpis">
                <div><span>Bản ghi</span><strong>{detail.totalBets}</strong><small>{detail.eligibleFixtures}/{detail.totalFixtures} fixture</small></div>
                <div><span>Hit rate</span><strong>{percent(detail.hitRate)}</strong><small>{detail.wins}W · {detail.losses}L</small></div>
                <div><span>Điểm</span><strong className={detail.profitUnits >= 0 ? 'positive' : 'negative'}>{signed(detail.profitUnits)}u</strong><small>ROI {percent(detail.roi)}</small></div>
                <div><span>Max DD</span><strong>{(detail.maximumDrawdown ?? 0).toFixed(2)}u</strong><small>Avg odds {(detail.averageOdds ?? 0).toFixed(2)}</small></div>
                <div><span>Brier</span><strong>{detail.brierScore?.toFixed(3) ?? '—'}</strong><small>lower is better</small></div>
              </section>

              <section className="pcr-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">EQUITY CURVE</span>
                    <h2>Hiệu suất theo thứ tự bản ghi</h2>
                  </div>
                  <strong className={detail.profitUnits >= 0 ? 'positive' : 'negative'}>
                    {signed(detail.profitUnits)}u
                  </strong>
                </div>
                <EquityChart points={detail.equityCurve} />
              </section>

              <section className="pcr-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">MARKETS</span>
                    <h2>Hiệu quả theo market</h2>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>Bản ghi</th>
                        <th>W-L-P</th>
                        <th>Hit rate</th>
                        <th>Điểm</th>
                        <th>Hiệu suất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.byMarket.map((row) => (
                        <tr key={row.marketCode}>
                          <td><b>{row.marketCode}</b></td>
                          <td>{row.bets}</td>
                          <td>{row.wins}-{row.losses}-{row.pushes}</td>
                          <td>{percent(row.hitRate)}</td>
                          <td className={row.profitUnits >= 0 ? 'positive' : 'negative'}>
                            {signed(row.profitUnits)}u
                          </td>
                          <td>{percent(row.roi)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="pcr-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">EVALUATION LOG</span>
                    <h2>Chi tiết từng bản ghi</h2>
                  </div>
                  <select
                    value={marketFilter}
                    onChange={(event) => setMarketFilter(event.target.value)}
                  >
                    <option value="ALL">Tất cả market</option>
                    {detail.byMarket.map((row) => (
                      <option key={row.marketCode} value={row.marketCode}>
                        {marketDisplayName(row.marketCode)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Trận</th>
                        <th>Lựa chọn</th>
                        <th>Tỷ lệ thị trường</th>
                        <th>Model / Market</th>
                        <th>EV</th>
                        <th>KQ</th>
                        <th>Điểm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBets.map((bet) => (
                        <tr key={bet.id}>
                          <td>
                            <b>{bet.fixture.homeTeam.name} – {bet.fixture.awayTeam.name}</b>
                            <small>{dateTime(bet.kickoffAt)}</small>
                          </td>
                          <td>
                            {bet.selectionName}
                            <small>{bet.marketName}</small>
                          </td>
                          <td>{bet.decimalOdds.toFixed(2)}</td>
                          <td>{percent(bet.modelProbability)} / {percent(bet.fairMarketProbability)}</td>
                          <td>{percent(bet.expectedValue)}</td>
                          <td>{bet.settlementResult}</td>
                          <td className={bet.profitUnits >= 0 ? 'positive' : 'negative'}>
                            {signed(bet.profitUnits)}u
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
