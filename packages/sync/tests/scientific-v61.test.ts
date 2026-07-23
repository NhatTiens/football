import { describe, expect, it } from 'vitest';
import {
  ScientificEvaluationCollector,
  ScientificRejectionDiagnostics,
  selectCorrelationControlledCandidates,
  stableScientificArtifactId,
} from '../src/scientific-v61.js';

describe('scientific v6.1 evaluation and control', () => {
  it('records rejection reasons deterministically', () => {
    const diagnostics = new ScientificRejectionDiagnostics();
    diagnostics.reject('EDGE_LOW');
    diagnostics.reject('EDGE_LOW', 2);
    diagnostics.reject('NO_ODDS_AT_HORIZON');
    expect(diagnostics.snapshot()).toEqual({
      totalRejected: 4,
      counts: {
        EDGE_LOW: 3,
        NO_ODDS_AT_HORIZON: 1,
      },
    });
  });

  it('keeps the strongest non-correlated candidates', () => {
    const diagnostics = new ScientificRejectionDiagnostics();
    const selected = selectCorrelationControlledCandidates(
      [
        {
          marketKey: 'TOTAL_GOALS_2_5:2.5',
          marketCode: 'TOTAL_GOALS_2_5',
          selectionCode: 'OVER',
          correlationCluster: 'GOALS_HIGH',
          recommendationScore: 0.7,
        },
        {
          marketKey: 'BTTS:',
          marketCode: 'BTTS',
          selectionCode: 'YES',
          correlationCluster: 'GOALS_HIGH',
          recommendationScore: 0.6,
        },
        {
          marketKey: 'MATCH_WINNER:',
          marketCode: 'MATCH_WINNER',
          selectionCode: 'HOME',
          correlationCluster: 'MATCH_WINNER:HOME',
          recommendationScore: 0.5,
        },
      ],
      {
        maximumPerFixture: 2,
        maximumPerMarket: 1,
        maximumPerCorrelationCluster: 1,
      },
      diagnostics,
    );
    expect(selected.map((row) => row.selectionCode)).toEqual(['OVER', 'HOME']);
    expect(diagnostics.snapshot().counts.CORRELATION_CLUSTER_LIMIT).toBe(1);
  });

  it('calculates proper metrics separately by market', () => {
    const collector = new ScientificEvaluationCollector();
    collector.recordPrediction({
      marketCode: 'MATCH_WINNER',
      probabilities: { HOME: 0.7, DRAW: 0.2, AWAY: 0.1 },
      actualClass: 'HOME',
    });
    collector.recordPrediction({
      marketCode: 'TOTAL_GOALS_2_5',
      probability: 0.75,
      actual: 1,
    });
    collector.recordBet({
      marketCode: 'TOTAL_GOALS_2_5',
      result: 'WIN',
      profitUnits: 1.1,
      stakeUnits: 1,
      decimalOdds: 2.1,
      expectedValue: 0.12,
    });

    const snapshot = collector.snapshot();
    const winner = snapshot.find((row) => row.marketCode === 'MATCH_WINNER');
    const total = snapshot.find(
      (row) => row.marketCode === 'TOTAL_GOALS_2_5',
    );
    expect(winner?.predictionCount).toBe(1);
    expect(winner?.brierScore).toBeCloseTo((0.09 + 0.04 + 0.01) / 3, 10);
    expect(total?.brierScore).toBeCloseTo(0.0625, 10);
    expect(total?.roi).toBeCloseTo(1.1, 10);
    expect(total?.averageExpectedValue).toBeCloseTo(0.12, 10);
  });

  it('creates stable but distinct artifact IDs', () => {
    const base = {
      version: 'scientific-ensemble-dixon-coles-v6',
      trainedThrough: '2026-06-29T19:00:00.000Z',
      sampleSize: 470,
      randomSeed: 20260722,
    };
    expect(stableScientificArtifactId(base)).toBe(
      stableScientificArtifactId(base),
    );
    expect(stableScientificArtifactId(base)).not.toBe(
      stableScientificArtifactId({ ...base, sampleSize: 350 }),
    );
  });
});
