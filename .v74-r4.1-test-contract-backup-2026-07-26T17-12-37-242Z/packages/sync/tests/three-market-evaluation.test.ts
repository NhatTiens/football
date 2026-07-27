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

function market(hitRate: number, releasedRows: number, totalRows = 100) {
  const correct = Math.round(hitRate * releasedRows);
  return {
    candidate: metric,
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

  it('selects the strongest sufficiently sampled market/horizon', () => {
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
});
