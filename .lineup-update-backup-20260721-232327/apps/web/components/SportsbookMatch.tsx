'use client';

import { useMemo, useState } from 'react';
import type { FixtureDetailDto, RecommendationDto } from '../lib/types';
import { dateTime, percent, signedPercent } from '../lib/format';

interface BestSelection {
  key: string;
  marketCode: string;
  marketName: string;
  marketGroup: string;
  selectionCode: string;
  selectionName: string;
  odds: number;
  bookmaker: string;
  capturedAt: string;
  recommendation?: RecommendationDto;
}

const tabs = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'POPULAR', label: '1X2' },
  { id: 'TOTAL', label: 'Tổng bàn' },
  { id: 'GOALS', label: 'BTTS' },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function statusLabel(status: string): string {
  if (status === 'UPCOMING') return 'Chưa bắt đầu';
  if (status === 'FINISHED') return 'Kết thúc';
  if (status === 'LIVE') return 'Đang diễn ra';
  return status;
}

export function SportsbookMatch({ fixture }: { fixture: FixtureDetailDto }) {
  const [tab, setTab] = useState('ALL');
  const [query, setQuery] = useState('');
  const [betSlip, setBetSlip] = useState<BestSelection[]>([]);
  const [stake, setStake] = useState('1');

  const selections = useMemo(() => {
    const recommendations = new Map(
      fixture.recommendations.map((item) => [
        `${item.marketCode}:${item.selectionCode}:${item.lineValue ?? ''}`,
        item,
      ]),
    );
    const best = new Map<string, BestSelection>();

    for (const row of fixture.latestOdds) {
      const key = `${row.marketCode}:${row.selectionCode}:${row.lineValue ?? ''}`;
      const current = best.get(key);
      if (!current || row.odds > current.odds) {
        best.set(key, {
          key,
          marketCode: row.marketCode,
          marketName: row.marketName,
          marketGroup:
            row.marketCode === 'MATCH_WINNER'
              ? 'POPULAR'
              : row.marketCode === 'TOTAL_GOALS_2_5'
                ? 'TOTAL'
                : 'GOALS',
          selectionCode: row.selectionCode,
          selectionName: row.selectionName,
          odds: row.odds,
          bookmaker: row.bookmaker,
          capturedAt: row.capturedAt,
          recommendation: recommendations.get(key),
        });
      }
    }
    return [...best.values()];
  }, [fixture]);

  const markets = useMemo(() => {
    const grouped = new Map<string, BestSelection[]>();
    for (const selection of selections) {
      const matchesTab = tab === 'ALL' || selection.marketGroup === tab;
      const needle = query.trim().toLowerCase();
      const matchesQuery =
        !needle ||
        selection.marketName.toLowerCase().includes(needle) ||
        selection.selectionName.toLowerCase().includes(needle);
      if (!matchesTab || !matchesQuery) continue;
      grouped.set(selection.marketName, [
        ...(grouped.get(selection.marketName) ?? []),
        selection,
      ]);
    }
    return [...grouped.entries()];
  }, [query, selections, tab]);

  function toggleBet(selection: BestSelection): void {
    setBetSlip((current) =>
      current.some((item) => item.key === selection.key)
        ? current.filter((item) => item.key !== selection.key)
        : [...current, selection],
    );
  }

  const combinedOdds = betSlip.reduce((value, item) => value * item.odds, 1);
  const stakeValue = Math.max(0, Number(stake) || 0);
  const potentialReturn = betSlip.length > 0 ? combinedOdds * stakeValue : 0;

  return (
    <div className="sportsbook-shell">
      <section className="match-lab-header">
        <div className="match-lab-meta">
          <span className="eyebrow">MATCH ANALYSIS</span>
          <span>{fixture.league.name} · {fixture.league.season}</span>
          <span>{fixture.round ?? 'Vòng đấu chưa xác định'}</span>
        </div>

        <div className="match-lab-score">
          <div className="lab-team home">
            <span className="team-symbol">{initials(fixture.homeTeam.name)}</span>
            <div><small>HOME</small><strong>{fixture.homeTeam.name}</strong></div>
          </div>
          <div className="lab-score-center">
            <span className={`status-dot ${fixture.status.toLowerCase()}`}>{statusLabel(fixture.status)}</span>
            <b>
              {fixture.status === 'UPCOMING'
                ? '— : —'
                : `${fixture.score.home ?? 0} : ${fixture.score.away ?? 0}`}
            </b>
            <time>{dateTime(fixture.kickoffAt)}</time>
          </div>
          <div className="lab-team away">
            <div><small>AWAY</small><strong>{fixture.awayTeam.name}</strong></div>
            <span className="team-symbol">{initials(fixture.awayTeam.name)}</span>
          </div>
        </div>

        <div className="match-lab-facts">
          <div><span>Venue</span><strong>{fixture.venueName ?? '—'}</strong></div>
          <div><span>Referee</span><strong>{fixture.referee ?? '—'}</strong></div>
          <div><span>Markets</span><strong>{markets.length}</strong></div>
          <div><span>Value picks</span><strong>{fixture.recommendations.length}</strong></div>
        </div>
      </section>

      <div className="sportsbook-layout">
        <section className="market-board">
          <div className="market-toolbar">
            <div className="market-tabs" role="tablist" aria-label="Nhóm thị trường">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tab === item.id ? 'active' : ''}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Lọc market hoặc lựa chọn"
              aria-label="Lọc market"
            />
          </div>

          <div className="market-table-head" aria-hidden="true">
            <span>Lựa chọn</span>
            <span>Odds tốt nhất</span>
            <span>Model</span>
            <span>Fair market</span>
            <span>Edge</span>
            <span>EV</span>
          </div>

          <div className="market-list">
            {markets.length === 0 ? (
              <div className="empty-state">Không có market phù hợp với bộ lọc.</div>
            ) : null}

            {markets.map(([marketName, rows]) => (
              <section className="market-section" key={marketName}>
                <header>
                  <div><strong>{marketName}</strong><small>{rows.length} lựa chọn</small></div>
                  <span>Snapshot gần nhất</span>
                </header>
                <div className="scientific-odds-grid">
                  {rows.map((row) => {
                    const selected = betSlip.some((item) => item.key === row.key);
                    const rec = row.recommendation;
                    return (
                      <button
                        type="button"
                        key={row.key}
                        onClick={() => toggleBet(row)}
                        className={`scientific-odd-row ${selected ? 'selected' : ''} ${rec ? 'value' : ''}`}
                      >
                        <span className="odd-selection">
                          <strong>{row.selectionName}</strong>
                          <small>{row.bookmaker}</small>
                        </span>
                        <span className="odd-number">{row.odds.toFixed(2)}</span>
                        <span>{rec ? percent(rec.modelProbability) : '—'}</span>
                        <span>{rec ? percent(rec.fairMarketProbability) : '—'}</span>
                        <span className={rec && rec.edge > 0 ? 'positive' : ''}>
                          {rec ? signedPercent(rec.edge) : '—'}
                        </span>
                        <span className={rec && rec.expectedValue > 0 ? 'positive' : ''}>
                          {rec ? signedPercent(rec.expectedValue) : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>

        <aside className="sportsbook-sidebar">
          <section className="ai-panel">
            <div className="panel-title">
              <div><span className="eyebrow">MODEL OUTPUT</span><strong>Khuyến nghị</strong></div>
              <b>{fixture.recommendations.length}</b>
            </div>
            {fixture.recommendations.length === 0 ? (
              <p className="muted">Không có lựa chọn vượt toàn bộ ngưỡng EV, edge và chất lượng dữ liệu.</p>
            ) : null}
            {fixture.recommendations.slice(0, 3).map((item) => (
              <article key={item.id} className="ai-pick">
                <header>
                  <div><small>#{item.rank ?? 1} · {item.marketName}</small><strong>{item.selectionName}</strong></div>
                  <span>{item.odds.toFixed(2)}</span>
                </header>
                <dl>
                  <div><dt>P(model)</dt><dd>{percent(item.modelProbability)}</dd></div>
                  <div><dt>P(market)</dt><dd>{percent(item.fairMarketProbability)}</dd></div>
                  <div><dt>Edge</dt><dd className="positive">{signedPercent(item.edge)}</dd></div>
                  <div><dt>EV</dt><dd className="positive">{signedPercent(item.expectedValue)}</dd></div>
                  <div><dt>Confidence</dt><dd>{percent(item.confidenceScore)}</dd></div>
                  <div><dt>Data quality</dt><dd>{percent(item.dataQualityScore)}</dd></div>
                </dl>
              </article>
            ))}
          </section>

          <section className="bet-slip">
            <div className="panel-title">
              <div><span className="eyebrow">SIMULATION</span><strong>Bet slip</strong></div>
              <b>{betSlip.length}</b>
            </div>
            {betSlip.length === 0 ? (
              <p className="muted">Chọn odds để mô phỏng một vé, không gửi lệnh cược thật.</p>
            ) : null}
            {betSlip.map((item) => (
              <div className="slip-row" key={item.key}>
                <button type="button" onClick={() => toggleBet(item)} aria-label="Xóa lựa chọn">×</button>
                <span><strong>{item.selectionName}</strong><small>{item.marketName}</small></span>
                <b>{item.odds.toFixed(2)}</b>
              </div>
            ))}
            <label className="stake-control">
              <span>Stake mô phỏng (unit)</span>
              <input value={stake} onChange={(event) => setStake(event.target.value)} type="number" min="0" step="0.1" />
            </label>
            <div className="slip-total"><span>Combined odds</span><strong>{betSlip.length ? combinedOdds.toFixed(2) : '—'}</strong></div>
            <div className="slip-total"><span>Potential return</span><strong>{betSlip.length ? `${potentialReturn.toFixed(2)}u` : '—'}</strong></div>
            <button className="button primary full" type="button" disabled={betSlip.length === 0}>Lưu mô phỏng</button>
            <small className="slip-warning">Công cụ nghiên cứu xác suất; không bảo đảm lợi nhuận.</small>
          </section>
        </aside>
      </div>
    </div>
  );
}
