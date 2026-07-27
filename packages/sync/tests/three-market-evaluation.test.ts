import { describe, expect, it } from 'vitest';
import {
  selectBestEvaluatedMarket,
  summarizeSelectiveRows,
  wilsonLowerBound95,
  type ThreeMarketHorizonEvaluation,
} from '../src/three-market-evaluation-engine.js';
import type { ScientificPredictionMetrics } from '../src/scientific-multi-market-replay-contract.js';

const metric: ScientificPredictionMetrics = {
  rows: 100,
  classCount: 2,
  accuracy: 0.6,
  brier: 0.22,
  logLoss: 0.66,
  ece: 0.04,
  brierSkillVsUniform: 0.12,
  logLossSkillVsUniform: 0.05,
  positiveRate: 0.5,
  calibration: [],
};

function market(
  hitRate: number,
  releasedRows: number,
  totalRows = 100,
  options?: {
    brierSkillVsPrevalence?: number;
    logLossSkillVsPrevalence?: number;
  },
) {
  const correct = Math.round(hitRate * releasedRows);
  const brierSkillVsPrevalence = options?.brierSkillVsPrevalence ?? 0.12;
  const logLossSkillVsPrevalence = options?.logLossSkillVsPrevalence ?? 0.05;

  return {
    candidate: metric,
    majorityBaselineAccuracy: 0.55,
    accuracySkillVsMajority: 0.05,
    prevalenceBaselineBrier: 0.25,
    prevalenceBaselineLogLoss: 0.6931471805599453,
    brierSkillVsPrevalence,
    logLossSkillVsPrevalence,
    champion: null,
    deltaVsChampion: null,
    selective: {
      totalRows,
      releasedRows,
      coverage: releasedRows / totalRows,
      correct,
      hitRate: correct / releasedRows,
      wilsonLower95: wilsonLowerBound95(correct, releasedRows),
      highRows: 0,
      highCorrect: 0,
      highHitRate: null,
    },
  };
}

describe('three-market evaluation helpers', () => {
  it('keeps LOW/PASS rows out of released predictions', () => {
    const summary = summarizeSelectiveRows([
      { grade: 'HIGH', correct: true },
      { grade: 'MEDIUM', correct: false },
      { grade: 'LOW', correct: true },
      { grade: 'PASS', correct: true },
    ]);
    expect(summary.totalRows).toBe(4);
    expect(summary.releasedRows).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.coverage).toBeCloseTo(0.5, 10);
    expect(summary.hitRate).toBeCloseTo(0.5, 10);
  });

  it('uses Wilson lower bound so tiny samples do not automatically win', () => {
    const tiny = wilsonLowerBound95(5, 5)!;
    const large = wilsonLowerBound95(80, 100)!;
    expect(large).toBeGreaterThan(tiny);
  });

  it('selects the strongest sufficiently sampled market/horizon when proper-score skill is positive', () => {
    const horizon = {
      horizonMinutes: 30,
      fixtureRows: 100,
      mlEligibleRows: 0,
      mlCoverage: 0,
      pointInTimeViolations: 0,
      averageDataQuality: 0.8,
      averageConfidence: 0.75,
      markets: {
        HDA: market(0.7, 60),
        'O1.5': market(0.78, 70),
        'O2.5': market(1, 5),
        'O3.5': market(0.7, 50),
        BTTS: market(0.74, 70),
      },
    } satisfies ThreeMarketHorizonEvaluation;

    expect(selectBestEvaluatedMarket([horizon], 25)?.market).toBe('O1.5');
  });

  it('rejects a high-hit market when it does not beat prevalence on Brier and LogLoss', () => {
    const horizon = {
      horizonMinutes: 30,
      fixtureRows: 100,
      mlEligibleRows: 100,
      mlCoverage: 1,
      pointInTimeViolations: 0,
      averageDataQuality: 0.9,
      averageConfidence: 0.8,
      markets: {
        HDA: market(0.68, 40, 100, {
          brierSkillVsPrevalence: 0.03,
          logLossSkillVsPrevalence: 0.02,
        }),
        'O1.5': market(0.86, 80, 100, {
          brierSkillVsPrevalence: -0.01,
          logLossSkillVsPrevalence: 0,
        }),
        'O2.5': market(0.55, 10),
        'O3.5': market(0.62, 10),
        BTTS: market(0.6, 10),
      },
    } satisfies ThreeMarketHorizonEvaluation;

    expect(selectBestEvaluatedMarket([horizon], 25)?.market).toBe('HDA');
  });
});
