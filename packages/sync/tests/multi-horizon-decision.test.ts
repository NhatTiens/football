import { describe, expect, it } from 'vitest';

import {
  assessDecisionCandidate,
  buildMultiHorizonDecision,
  consensusFairProbabilities,
} from '../src/multi-horizon-decision-contract.js';

describe('Stage 6 multi-horizon decision contract', () => {
  it('removes vig per bookmaker before taking consensus', () => {
    const probabilities = consensusFairProbabilities([
      [
        { oddsSnapshotId: 1, bookmakerId: 1, selection: 'YES', decimalOdds: 1.8, capturedAt: '2025-01-01T00:00:00.000Z' },
        { oddsSnapshotId: 2, bookmakerId: 1, selection: 'NO', decimalOdds: 2.1, capturedAt: '2025-01-01T00:00:00.000Z' },
      ],
    ]);
    expect(probabilities.YES! + probabilities.NO!).toBeCloseTo(1, 12);
  });

  it('records rejected candidates instead of dropping them', () => {
    const candidate = assessDecisionCandidate({
      marketKey: 'BTTS',
      selection: 'YES',
      modelProbability: 0.51,
      fairMarketProbability: 0.5,
      quote: { oddsSnapshotId: 1, bookmakerId: 1, selection: 'YES', decimalOdds: 1.8, capturedAt: '2025-01-01T00:00:00.000Z' },
      reliability: 0.9,
      uncertainty: 0.1,
      uncertaintyPenalty: 0.1,
    });
    expect(candidate.eligible).toBe(false);
    expect(candidate.reasonCodes).toContain('EDGE_BELOW_MINIMUM');
  });

  it('keeps BEST_BET separate from the risk overlay', () => {
    const candidate = assessDecisionCandidate({
      marketKey: 'BTTS',
      selection: 'YES',
      modelProbability: 0.65,
      fairMarketProbability: 0.52,
      quote: { oddsSnapshotId: 1, bookmakerId: 1, selection: 'YES', decimalOdds: 2, capturedAt: '2025-01-01T00:00:00.000Z' },
      reliability: 0.95,
      uncertainty: 0.1,
      uncertaintyPenalty: 0.1,
    });
    const decision = buildMultiHorizonDecision({
      fixtureId: 1,
      decisionAsOf: '2025-01-01T10:00:00.000Z',
      kickoffAt: '2025-01-01T10:30:00.000Z',
      horizon: 30,
      candidates: [candidate],
      modelVersion: 'v8-test',
      stage5RowHash: 'abc',
    });
    expect(decision.decision).toBe('BEST_BET');
    expect(decision.riskOverlayApplied).toBe(false);
  });

  it('creates a deterministic append-only decision identity', () => {
    const input = {
      fixtureId: 1,
      decisionAsOf: '2025-01-01T10:00:00.000Z',
      kickoffAt: '2025-01-01T10:30:00.000Z',
      horizon: 30,
      candidates: [],
      modelVersion: 'v8-test',
      stage5RowHash: 'abc',
    };
    expect(buildMultiHorizonDecision(input).decisionId).toBe(
      buildMultiHorizonDecision(input).decisionId,
    );
  });
});
