import { describe, expect, it } from 'vitest';
import {
  ScientificBankrollTracker,
  allocateScientificStakePortfolio,
  calculateScientificStake,
  getScientificBankrollConfig,
} from '../src/scientific-bankroll.js';

function candidate(overrides: Partial<{
  decimalOdds: number;
  modelProbability: number;
  expectedValue: number;
  edge: number;
  confidenceScore: number;
  dataQualityScore: number;
  recommendationScore: number;
}> = {}) {
  return {
    decimalOdds: 2.1,
    modelProbability: 0.55,
    expectedValue: 0.155,
    edge: 0.06,
    confidenceScore: 0.8,
    dataQualityScore: 0.8,
    recommendationScore: 0.1,
    ...overrides,
  };
}

const config = getScientificBankrollConfig({
  profile: 'BALANCED',
  bankrollUnits: 100,
  bankrollAmount: 10_000_000,
  kellyFraction: 0.2,
  minimumStakeUnits: 0.05,
  maximumStakeUnits: 1.5,
  maximumStakeFraction: 0.015,
  maximumFixtureExposureFraction: 0.025,
  maximumDailyExposureFraction: 0.08,
  roundingUnits: 0.05,
  drawdownSoftLimit: 0.08,
  drawdownHardLimit: 0.2,
  edgeReference: 0.06,
  expectedValueReference: 0.12,
  currentDrawdownFraction: 0,
  currentDailyExposureUnits: 0,
});

describe('scientific bankroll v6.2', () => {
  it('does not stake on a high probability selection without positive value', () => {
    const plan = calculateScientificStake({
      candidate: candidate({
        decimalOdds: 1.2,
        modelProbability: 0.8,
        expectedValue: -0.04,
        edge: -0.02,
      }),
      config,
    });
    expect(plan.stakeUnits).toBe(0);
    expect(plan.skippedReason).toBe('NO_POSITIVE_RISK_ADJUSTED_EDGE');
  });

  it('increases stake when calibrated probability creates more value at the same odds', () => {
    const lowerProbability = calculateScientificStake({
      candidate: candidate({
        decimalOdds: 1.8,
        modelProbability: 0.57,
        expectedValue: 0.026,
        edge: 0.0144,
      }),
      config,
    });
    const higherProbability = calculateScientificStake({
      candidate: candidate({
        decimalOdds: 1.8,
        modelProbability: 0.6,
        expectedValue: 0.08,
        edge: 0.0444,
      }),
      config,
    });
    expect(higherProbability.stakeUnits).toBeGreaterThan(
      lowerProbability.stakeUnits,
    );
  });

  it('stakes less when confidence and data quality are lower', () => {
    const strong = calculateScientificStake({
      candidate: candidate({ confidenceScore: 0.9, dataQualityScore: 0.9 }),
      config,
    });
    const weak = calculateScientificStake({
      candidate: candidate({ confidenceScore: 0.5, dataQualityScore: 0.5 }),
      config,
    });
    expect(strong.stakeUnits).toBeGreaterThan(weak.stakeUnits);
  });

  it('caps an attractive wager at the configured bankroll limit', () => {
    const plan = calculateScientificStake({
      candidate: candidate({ expectedValue: 0.8, edge: 0.4 }),
      config,
    });
    expect(plan.stakeUnits).toBeLessThanOrEqual(1.5);
    expect(plan.stakeFraction).toBeLessThanOrEqual(0.015);
  });

  it('throttles stake in drawdown and stops at the hard limit', () => {
    const normal = calculateScientificStake({
      candidate: candidate(),
      config,
      currentBankrollUnits: 100,
      peakBankrollUnits: 100,
    });
    const drawdown = calculateScientificStake({
      candidate: candidate(),
      config,
      currentBankrollUnits: 85,
      peakBankrollUnits: 100,
    });
    const stopped = calculateScientificStake({
      candidate: candidate(),
      config,
      currentBankrollUnits: 79,
      peakBankrollUnits: 100,
    });
    expect(normal.stakeUnits).toBeGreaterThan(drawdown.stakeUnits);
    expect(stopped.stakeUnits).toBe(0);
    expect(stopped.skippedReason).toBe('DRAWDOWN_HARD_STOP');
  });

  it('limits total exposure across selections from the same fixture', () => {
    const portfolio = allocateScientificStakePortfolio({
      candidates: [
        candidate({ recommendationScore: 0.3, expectedValue: 0.4 }),
        candidate({ recommendationScore: 0.2, expectedValue: 0.35 }),
        candidate({ recommendationScore: 0.1, expectedValue: 0.3 }),
      ],
      config,
      currentBankrollUnits: 100,
      peakBankrollUnits: 100,
    });
    expect(portfolio.totalStakeUnits).toBeLessThanOrEqual(2.5);
  });

  it('tracks compound bankroll, total stake and drawdown', () => {
    const tracker = new ScientificBankrollTracker(100);
    const at = new Date('2026-07-01T10:00:00.000Z');
    tracker.recordBet(at, 1, 1.2);
    tracker.recordBet(at, 1.1, -1.1);
    tracker.recordBet(new Date('2026-07-02T10:00:00.000Z'), 0.9, -0.9);
    const snapshot = tracker.snapshot();
    expect(snapshot.endingBankrollUnits).toBeCloseTo(99.2, 10);
    expect(snapshot.totalStakeUnits).toBeCloseTo(3, 10);
    expect(snapshot.maximumDrawdownUnits).toBeGreaterThan(1.9);
    expect(tracker.dailyExposureUnits(at)).toBe(0);
  });
});
