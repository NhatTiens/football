import { describe, expect, it } from 'vitest';

import {
  beta2A1DailyWindow,
  buildBeta2A1DailyOutcomeReport,
} from '../src/daily-outcome-report-core.js';
import type { ShadowSettlementRow } from '../src/shadow-settlement-core.js';

function row(overrides: Partial<ShadowSettlementRow> = {}): ShadowSettlementRow {
  return {
    version: 'settlement-v1',
    status: 'SETTLED',
    providerFixtureId: 100,
    snapshotId: 10,
    snapshotHash: 'a'.repeat(64),
    checkpointMinutes: 90,
    checkpointLabel: 'T-90',
    snapshotAsOf: '2026-07-29T11:30:00.000Z',
    kickoffAt: '2026-07-29T12:00:00.000Z',
    marketType: 'MATCH_WINNER',
    selection: 'HOME',
    lineValue: null,
    decisionOdds: 2,
    bookmakerName: 'Paper Book',
    shadowTier: 'RAW_VALUE_SHADOW',
    modelSource: 'SCIENTIFIC_BASELINE_FALLBACK',
    modelVersion: 'baseline-v1',
    paperRecommendationVersion: 'paper-v1',
    rawModelProbability: 0.7,
    paperModelProbability: 0.6,
    decisionSource: 'paperShadowRecommendation',
    outcome: {
      status: 'FINAL_SCORE_LINKED',
      sourceFixtureSnapshotId: 50,
      sourceFixtureObservedAt: '2026-07-29T14:00:00.000Z',
      statusShort: 'FT',
      fulltimeHomeGoals: 2,
      fulltimeAwayGoals: 0,
    },
    settlementResult: 'WIN',
    flatStakeUnits: 1,
    hypotheticalProfitUnits: 1,
    closing: {
      status: 'CLOSING_PROXY_FRESH',
      sourceOddsSnapshotId: 60,
      sourceObservedAt: '2026-07-29T11:55:00.000Z',
      sourceUpdatedAt: '2026-07-29T11:50:00.000Z',
      bookmakerName: 'Paper Book',
      decimalOdds: 1.9,
      minutesToKickoff: 5,
      sourceAgeAtObservationMinutes: 5,
      sourceAgeAtKickoffMinutes: 10,
      targetMinutes: 5,
      toleranceMinutes: 8,
      maximumFreshSourceAgeMinutes: 360,
      clvEligible: true,
    },
    clv: 2 / 1.9 - 1,
    impliedProbabilityClv: 1 / 1.9 - 1 / 2,
    lineageViolations: [],
    paperOnly: true,
    stakeEligible: false,
    officialBestBetChanged: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
    ...overrides,
  };
}

describe('Beta.2A.1 daily outcome report', () => {
  it('uses a complete Vietnam calendar day represented in UTC', () => {
    const window = beta2A1DailyWindow('2026-07-30');

    expect(window.start.toISOString()).toBe('2026-07-29T17:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-07-30T17:00:00.000Z');
  });

  it('filters rows by kickoff day and reports flat-stake outcome and CLV', () => {
    const report = buildBeta2A1DailyOutcomeReport({
      reportDay: '2026-07-29',
      rows: [
        row(),
        row({
          providerFixtureId: 101,
          snapshotId: 11,
          kickoffAt: '2026-07-28T12:00:00.000Z',
        }),
      ],
    });

    expect(report.coverage.sourceRows).toBe(2);
    expect(report.coverage.rowsInDailyWindow).toBe(1);
    expect(report.reliability.overall.settled).toBe(1);
    expect(report.reliability.overall.roi).toBe(1);
    expect(report.coverage.clvCoverageRate).toBe(1);
    expect(report.readiness.automaticPromotion).toBe(false);
  });

  it('compares raw and bounded paper calibration without changing official policy', () => {
    const report = buildBeta2A1DailyOutcomeReport({
      reportDay: '2026-07-29',
      rows: [
        row(),
        row({
          providerFixtureId: 102,
          snapshotId: 12,
          settlementResult: 'LOSS',
          hypotheticalProfitUnits: -1,
          rawModelProbability: 0.7,
          paperModelProbability: 0.55,
        }),
      ],
    });

    expect(report.probability.raw.eligibleRows).toBe(2);
    expect(report.probability.paper.eligibleRows).toBe(2);
    expect(report.probability.brierDeltaPaperMinusRaw).toBeLessThan(0);
    expect(report.probability.logLossDeltaPaperMinusRaw).toBeLessThan(0);
    expect(report.probability.paperCalibrationImproved).toBe(true);
    expect(report.safety.paperOnly).toBe(true);
    expect(report.safety.databaseWritten).toBe(false);
    expect(report.safety.officialBestBetChanged).toBe(false);
  });

  it('keeps pending rows visible and excludes them from probability scoring', () => {
    const report = buildBeta2A1DailyOutcomeReport({
      reportDay: '2026-07-29',
      rows: [
        row({
          status: 'PENDING_OUTCOME',
          settlementResult: null,
          hypotheticalProfitUnits: null,
        }),
      ],
    });

    expect(report.coverage.pendingRows).toBe(1);
    expect(report.probability.paper.eligibleRows).toBe(0);
    expect(report.probability.paper.brierScore).toBeNull();
    expect(report.readiness.status).toBe('NO_SETTLED_SAMPLE');
  });
});
