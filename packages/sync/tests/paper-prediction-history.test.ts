import { describe, expect, it } from 'vitest';

import {
  settleShadowCandidate,
  type ShadowOutcomeSnapshot,
  type ShadowSettlementCandidate,
} from '../src/shadow-settlement-core.js';

const kickoffAt = new Date('2026-08-04T12:00:00.000Z');

function paperCandidate(): ShadowSettlementCandidate {
  return {
    snapshotId: 501,
    snapshotHash: 'c'.repeat(64),
    providerFixtureId: 9901,
    checkpointMinutes: 30,
    checkpointLabel: 'T-30',
    snapshotAsOf: new Date('2026-08-04T11:30:00.000Z'),
    kickoffAt,
    marketType: 'TOTAL_GOALS_3_5',
    selection: 'UNDER',
    lineValue: 3.5,
    decimalOdds: 1.9,
    bookmakerName: 'Paper Book',
    sourceOddsSnapshotId: 601,
    sourceOddsObservedAt: new Date('2026-08-04T11:29:00.000Z'),
    modelSource: 'DYNAMIC_DIXON_COLES',
    modelVersion: 'paper-model-v1',
    paperRecommendationVersion: 'paper-policy-v1',
    rawModelProbability: 0.53,
    paperModelProbability: 0.61,
    fairMarketProbability: 0.52,
    edge: 0.09,
    expectedValue: 0.159,
    sourcePredictionSelection: 'OVER',
    sourcePredictionLineValue: 2.5,
    sourcePredictionProbability: 0.53,
    shadowTier: 'RAW_VALUE_SHADOW',
    decisionSource: 'paperShadowRecommendation',
  };
}

function finalOutcome(totalGoals: number): ShadowOutcomeSnapshot {
  return {
    id: 701,
    providerFixtureId: 9901,
    statusShort: 'FT',
    observedAt: new Date('2026-08-04T14:00:00.000Z'),
    fulltimeHomeGoals: totalGoals,
    fulltimeAwayGoals: 0,
  };
}

describe('paper prediction history outcome linkage', () => {
  it('keeps the prediction pending before a final outcome exists', () => {
    const row = settleShadowCandidate({
      candidate: paperCandidate(),
      outcomeSnapshots: [],
      closingOddsSnapshots: [],
      reportAsOf: new Date('2026-08-04T12:30:00.000Z'),
    });

    expect(row.status).toBe('PENDING_OUTCOME');
    expect(row.settlementResult).toBeNull();
    expect(row.paperOnly).toBe(true);
  });

  it('marks the mapped O/U paper prediction as correct after full time', () => {
    const row = settleShadowCandidate({
      candidate: paperCandidate(),
      outcomeSnapshots: [finalOutcome(2)],
      closingOddsSnapshots: [],
      reportAsOf: new Date('2026-08-04T15:00:00.000Z'),
    });

    expect(row.status).toBe('SETTLED');
    expect(row.settlementResult).toBe('WIN');
    expect(row.hypotheticalProfitUnits).toBeCloseTo(0.9, 12);
    expect(row.sourcePredictionSelection).toBe('OVER');
    expect(row.sourcePredictionLineValue).toBe(2.5);
    expect(row.selection).toBe('UNDER');
    expect(row.lineValue).toBe(3.5);
    expect(row.edge).toBe(0.09);
    expect(row.expectedValue).toBe(0.159);
    expect(row.realMoneyExecution).toBe(false);
  });

  it('marks the same paper prediction as wrong when four goals are scored', () => {
    const row = settleShadowCandidate({
      candidate: paperCandidate(),
      outcomeSnapshots: [finalOutcome(4)],
      closingOddsSnapshots: [],
      reportAsOf: new Date('2026-08-04T15:00:00.000Z'),
    });

    expect(row.settlementResult).toBe('LOSS');
    expect(row.hypotheticalProfitUnits).toBe(-1);
  });
});
