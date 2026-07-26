import { describe, expect, it } from 'vitest';

import {
  evaluateHistoricalMatchWinnerEvent,
  maximumDrawdown,
  summarizeHistoricalBenchmark,
  type HistoricalBenchmarkEventResult,
} from '../src/historical-best-bet-benchmark-core.js';
import type { LiveOddsRow } from '../src/real-odds-paper-bet-core.js';

function oddsState(input: {
  providerFixtureId?: number;
  observedAt: Date;
  sourceUpdatedAt?: Date | null;
  prices: Record<'HOME' | 'DRAW' | 'AWAY', number>;
}): LiveOddsRow[] {
  const providerFixtureId = input.providerFixtureId ?? 9001;
  const selections = ['HOME', 'DRAW', 'AWAY'] as const;
  return [1, 2, 3].flatMap((bookmakerId) =>
    selections.map((selection, index) => ({
      id: bookmakerId * 10 + index,
      providerFixtureId,
      sourceUpdatedAt: input.sourceUpdatedAt ?? input.observedAt,
      observedAt: input.observedAt,
      bookmakerId,
      bookmakerName: `Bookmaker ${bookmakerId}`,
      marketType: 'MATCH_WINNER' as const,
      selection,
      lineValue: null,
      decimalOdds: input.prices[selection] + (bookmakerId - 2) * 0.02,
    })),
  );
}

const decisionAsOf = new Date('2024-04-01T10:30:00.000Z');
const kickoffAt = new Date('2024-04-01T12:00:00.000Z');

function baseEvent(overrides: Partial<Parameters<typeof evaluateHistoricalMatchWinnerEvent>[0]> = {}) {
  return evaluateHistoricalMatchWinnerEvent({
    fixtureId: 101,
    providerFixtureId: 9001,
    leagueId: 39,
    replayPredictionId: 77,
    predictionAsOf: decisionAsOf,
    kickoffAt,
    pitSafePrediction: true,
    prediction: { HOME: 0.62, DRAW: 0.22, AWAY: 0.16 },
    oddsRows: oddsState({
      observedAt: new Date('2024-04-01T10:29:00.000Z'),
      prices: { HOME: 2.0, DRAW: 3.4, AWAY: 4.2 },
    }),
    matchWinnerReliabilityStatus: 'DIAGNOSTIC_ELIGIBLE',
    matchWinnerReliabilityEligible: true,
    homeGoals: 2,
    awayGoals: 0,
    ...overrides,
  });
}

describe('beta.1B.2 historical real-odds BEST BET benchmark', () => {
  it('selects and settles a real-odds BEST BET with the frozen beta.1A.4 policy', () => {
    const result = baseEvent({ closingOdds: 1.9 });
    expect(result.decisionType).toBe('BEST_BET');
    expect(result.selectedBet?.marketType).toBe('MATCH_WINNER');
    expect(result.selectedBet?.selection).toBe('HOME');
    expect(result.selectedBet?.settlementResult).toBe('WIN');
    expect(result.selectedBet?.profitUnits).toBeGreaterThan(0);
    expect(result.selectedBet?.clvPriceRatio).toBeGreaterThan(0);
    expect(result.integrity.syntheticOddsUsed).toBe(false);
  });

  it('returns NO_BET when reliability is blocked', () => {
    const result = baseEvent({
      matchWinnerReliabilityStatus: 'NO_PROVEN_SKILL',
      matchWinnerReliabilityEligible: false,
    });
    expect(result.decisionType).toBe('NO_BET');
    expect(result.selectedBet).toBeNull();
    expect(result.candidates.every((candidate) => !candidate.eligible)).toBe(true);
    expect(
      result.candidates.some((candidate) =>
        candidate.rejectionReasons.includes('MARKET_RELIABILITY_NOT_ELIGIBLE'),
      ),
    ).toBe(true);
  });

  it('separates missing odds coverage from a policy NO_BET', () => {
    const result = baseEvent({ oddsRows: [] });
    expect(result.decisionType).toBe('NO_ODDS_COVERAGE');
    expect(result.candidateCount).toBe(0);
  });

  it('rejects future odds leakage', () => {
    expect(() =>
      baseEvent({
        oddsRows: oddsState({
          observedAt: new Date('2024-04-01T10:31:00.000Z'),
          prices: { HOME: 2.0, DRAW: 3.4, AWAY: 4.2 },
        }),
      }),
    ).toThrow('HISTORICAL_BENCHMARK_FUTURE_ODDS_VIOLATION');
  });

  it('rejects non-PIT-safe replay predictions', () => {
    expect(() => baseEvent({ pitSafePrediction: false })).toThrow(
      'HISTORICAL_BENCHMARK_PREDICTION_NOT_PIT_SAFE',
    );
  });

  it('rejects odds from another provider fixture', () => {
    expect(() =>
      baseEvent({
        oddsRows: oddsState({
          providerFixtureId: 9999,
          observedAt: new Date('2024-04-01T10:29:00.000Z'),
          prices: { HOME: 2.0, DRAW: 3.4, AWAY: 4.2 },
        }),
      }),
    ).toThrow('HISTORICAL_BENCHMARK_PROVIDER_FIXTURE_MISMATCH');
  });

  it('computes maximum drawdown chronologically', () => {
    expect(maximumDrawdown([1, -1, -1, 2, -1])).toBe(2);
  });

  it('summarizes ROI, hit rate and CLV only from selected bets', () => {
    const win = baseEvent({ closingOdds: 1.9 });
    const loss = baseEvent({ homeGoals: 0, awayGoals: 1, closingOdds: 2.1 });
    const noBet = baseEvent({ matchWinnerReliabilityEligible: false });
    const noOdds = baseEvent({ oddsRows: [] });
    const summary = summarizeHistoricalBenchmark([
      win,
      loss,
      noBet,
      noOdds,
    ] as HistoricalBenchmarkEventResult[]);

    expect(summary.replayEvents).toBe(4);
    expect(summary.bestBets).toBe(2);
    expect(summary.noBets).toBe(1);
    expect(summary.noOddsCoverage).toBe(1);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.stakeUnits).toBe(2);
    expect(summary.clvRows).toBe(2);
  });
});
