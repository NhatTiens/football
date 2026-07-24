import { describe, expect, it } from 'vitest';

import {
  HISTORICAL_DATA_AUDIT_POLICY_VERSION,
  HISTORICAL_DATA_AUDIT_VERSION,
  classifyOddsTimestamp,
  determineHistoricalAuditRecommendation,
  lineageTimestampSafe,
  oddsUsableAtHorizon,
} from '../src/historical-data-audit-contract.js';

describe('v7.0-beta.1A.1 historical data audit contract', () => {
  it('uses stable audit identifiers', () => {
    expect(HISTORICAL_DATA_AUDIT_VERSION).toContain('beta.1A.1');
    expect(HISTORICAL_DATA_AUDIT_POLICY_VERSION).toBe('timestamp-lineage-audit-no-backfill-v1');
  });

  it('classifies odds captured before T-180', () => {
    expect(
      classifyOddsTimestamp(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T08:00:00Z')),
    ).toBe('PRE_T180');
  });

  it('classifies odds from T-180 to T-90', () => {
    expect(
      classifyOddsTimestamp(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T10:00:00Z')),
    ).toBe('T180_TO_T90');
  });

  it('classifies odds from T-90 to T-30', () => {
    expect(
      classifyOddsTimestamp(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T10:45:00Z')),
    ).toBe('T90_TO_T30');
  });

  it('classifies odds from T-30 to T-5', () => {
    expect(
      classifyOddsTimestamp(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T11:40:00Z')),
    ).toBe('T30_TO_T5');
  });

  it('classifies odds from T-5 to kickoff', () => {
    expect(
      classifyOddsTimestamp(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T11:58:00Z')),
    ).toBe('T5_TO_KICKOFF');
  });

  it('classifies post-kickoff odds', () => {
    expect(
      classifyOddsTimestamp(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T12:01:00Z')),
    ).toBe('POST_KICKOFF');
  });

  it('accepts odds exactly at T-90', () => {
    expect(
      oddsUsableAtHorizon(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T10:30:00Z'), 90),
    ).toBe(true);
  });

  it('rejects odds one minute after T-90', () => {
    expect(
      oddsUsableAtHorizon(new Date('2024-01-01T12:00:00Z'), new Date('2024-01-01T10:31:00Z'), 90),
    ).toBe(false);
  });

  it('rejects negative horizon', () => {
    expect(() => oddsUsableAtHorizon(new Date(), new Date(), -1)).toThrow();
  });

  it('accepts lineage available exactly at prediction time', () => {
    const asOf = new Date('2024-01-01T10:30:00Z');

    expect(lineageTimestampSafe(new Date(asOf), asOf)).toBe(true);
  });

  it('rejects lineage available after prediction time', () => {
    expect(
      lineageTimestampSafe(new Date('2024-01-01T10:31:00Z'), new Date('2024-01-01T10:30:00Z')),
    ).toBe(false);
  });

  it('treats missing optional lineage timestamp as safe', () => {
    expect(lineageTimestampSafe(null, new Date())).toBe(true);
  });

  it('blocks live integration on PIT violations', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 1,
      oddsSnapshots: 100,
      fixturesWithT90Odds: 80,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 200,
      referencedSourceMetricCoverage: 1,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 100,
      featureRows: 100,
    });

    expect(result.status).toBe('BLOCKED_BY_PIT_VIOLATIONS');
  });

  it('requires timestamped odds and stats when both are absent', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 0,
      oddsSnapshots: 50,
      fixturesWithT90Odds: 0,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 0,
      referencedSourceMetricCoverage: null,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 100,
      featureRows: 100,
    });

    expect(result.status).toBe('REQUIRE_TIMESTAMPED_ODDS_AND_STATS');
  });

  it('does not treat empty snapshot table as no metrics when current metrics exist', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 0,
      oddsSnapshots: 100,
      fixturesWithT90Odds: 100,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 500,
      referencedSourceMetricCoverage: 1,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 100,
      featureRows: 100,
    });

    expect(result.status).toBe('READY_FOR_LIVE_ONLY');
  });

  it('requires historical backfill when T-90 odds coverage is weak', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 0,
      oddsSnapshots: 100,
      fixturesWithT90Odds: 10,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 500,
      referencedSourceMetricCoverage: 1,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 100,
      featureRows: 100,
    });

    expect(result.status).toBe('REQUIRE_HISTORICAL_BACKFILL_AND_LIVE');
  });

  it('requires historical backfill for incomplete feature lineage', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 0,
      oddsSnapshots: 100,
      fixturesWithT90Odds: 100,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 500,
      referencedSourceMetricCoverage: 1,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 90,
      featureRows: 100,
    });

    expect(result.status).toBe('REQUIRE_HISTORICAL_BACKFILL_AND_LIVE');
  });

  it('requires historical backfill for weak source-fixture metric coverage', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 0,
      oddsSnapshots: 100,
      fixturesWithT90Odds: 100,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 500,
      referencedSourceMetricCoverage: 0.6,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 100,
      featureRows: 100,
    });

    expect(result.status).toBe('REQUIRE_HISTORICAL_BACKFILL_AND_LIVE');
  });

  it('allows live-only when PIT and historical coverage are strong', () => {
    const result = determineHistoricalAuditRecommendation({
      pitViolations: 0,
      oddsSnapshots: 500,
      fixturesWithT90Odds: 90,
      replayFixtures: 100,
      rawMetricSnapshots: 0,
      currentMetricRows: 500,
      referencedSourceMetricCoverage: 0.98,
      fundamentalSnapshots: 200,
      featureRowsWithFundamentalLineage: 99,
      featureRows: 100,
    });

    expect(result.status).toBe('READY_FOR_LIVE_ONLY');
  });
});
