import { describe, expect, it } from 'vitest';

import {
  buildReliabilityAccumulationProgress,
  evaluatePaperBetFixtureReadiness,
  nextPaperBetDecisionHorizon,
  parsePaperBetOperationsTickSeconds,
  selectedMarketFromAnalysisPayload,
} from '../src/paper-bet-operations-core.js';

function readiness(
  overrides: Partial<Parameters<typeof evaluatePaperBetFixtureReadiness>[0]> = {},
) {
  return evaluatePaperBetFixtureReadiness({
    providerFixtureId: 123,
    horizonMinutes: 90,
    mappingStatus: 'MAPPED',
    freshPitOddsRows: 20,
    completeMarketCount: 3,
    dynamicModelAvailable: true,
    modelPitSafe: true,
    frozenT90RegistryAvailable: true,
    matchWinnerReliabilityEligible: true,
    ...overrides,
  });
}

describe('paper bet operations core', () => {
  it('marks the complete T-90 route ready for BEST_BET evaluation', () => {
    const result = readiness();

    expect(result.status).toBe('BEST_BET_ROUTE_READY');
    expect(result.paperDecisionReady).toBe(true);
    expect(result.bestBetRouteReady).toBe(true);
    expect(result.decisionBlockers).toEqual([]);
  });

  it('keeps T-30 decision-ready while explicitly blocking BEST_BET promotion', () => {
    const result = readiness({ horizonMinutes: 30 });

    expect(result.status).toBe('PAPER_DECISION_READY_NO_BEST_BET_ROUTE');
    expect(result.paperDecisionReady).toBe(true);
    expect(result.bestBetRouteReady).toBe(false);
    expect(result.bestBetBlockers).toContain('BEST_BET_HORIZON_NOT_VALIDATED');
  });

  it('reports independent mapping, odds, market, and model blockers', () => {
    const result = readiness({
      mappingStatus: 'UNMAPPED',
      freshPitOddsRows: 0,
      completeMarketCount: 0,
      dynamicModelAvailable: false,
      modelPitSafe: false,
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.decisionBlockers).toEqual(
      expect.arrayContaining([
        'UNMAPPED_PROVIDER_FIXTURE',
        'NO_FRESH_PIT_ODDS',
        'NO_COMPLETE_REAL_ODDS_MARKET',
        'NO_DYNAMIC_DIXON_COLES_MODEL',
      ]),
    );
  });

  it('does not call a missing model a PIT violation', () => {
    const result = readiness({
      dynamicModelAvailable: false,
      modelPitSafe: false,
    });

    expect(result.decisionBlockers).toContain('NO_DYNAMIC_DIXON_COLES_MODEL');
    expect(result.decisionBlockers).not.toContain('MODEL_TRAINED_AFTER_READINESS_AS_OF');
  });

  it('reads selected markets from legacy nested and current shadow payloads', () => {
    expect(
      selectedMarketFromAnalysisPayload({
        analysis: {
          recommendation: {
            marketType: 'MATCH_WINNER',
          },
        },
      }),
    ).toBe('MATCH_WINNER');

    expect(
      selectedMarketFromAnalysisPayload({
        shadowCandidateDecision: {
          selected: {
            marketCode: 'BTTS',
          },
        },
      }),
    ).toBe('BTTS');

    expect(selectedMarketFromAnalysisPayload({ analysis: {} })).toBeNull();
  });

  it('selects only future paper horizons', () => {
    expect(nextPaperBetDecisionHorizon(120)).toBe(90);
    expect(nextPaperBetDecisionHorizon(89)).toBe(30);
    expect(nextPaperBetDecisionHorizon(29)).toBe(5);
    expect(nextPaperBetDecisionHorizon(4)).toBeNull();
  });

  it('validates the daemon tick interval', () => {
    expect(parsePaperBetOperationsTickSeconds(undefined)).toBe(30);
    expect(parsePaperBetOperationsTickSeconds('15')).toBe(15);
    expect(() => parsePaperBetOperationsTickSeconds('5')).toThrow();
  });

  it('tracks reliability accumulation without automatic promotion', () => {
    const accumulating = buildReliabilityAccumulationProgress({
      key: 'MATCH_WINNER:T-90',
      marketType: 'MATCH_WINNER',
      horizonMinutes: 90,
      persistedRows: 80,
      settledRows: 60,
      invalidRows: 2,
      diagnosticEligible: false,
      blockingReasons: ['INSUFFICIENT_SAMPLE'],
    });

    expect(accumulating.status).toBe('ACCUMULATING');
    expect(accumulating.remainingRows).toBe(90);
    expect(accumulating.progressRate).toBe(0.4);
    expect(accumulating.automaticPromotion).toBe(false);

    const ready = buildReliabilityAccumulationProgress({
      key: 'MATCH_WINNER:T-90',
      marketType: 'MATCH_WINNER',
      horizonMinutes: 90,
      persistedRows: 160,
      settledRows: 150,
      invalidRows: 0,
      diagnosticEligible: true,
    });

    expect(ready.status).toBe('RELIABILITY_ELIGIBLE');
    expect(ready.remainingRows).toBe(0);
  });
});
