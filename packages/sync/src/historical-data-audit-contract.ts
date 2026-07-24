export const HISTORICAL_DATA_AUDIT_VERSION = 'v7.0-beta.1A.1-historical-data-audit-v1';

export const HISTORICAL_DATA_AUDIT_POLICY_VERSION = 'timestamp-lineage-audit-no-backfill-v1';

export type HistoricalAuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type OddsTimestampBucket =
  'PRE_T180' | 'T180_TO_T90' | 'T90_TO_T30' | 'T30_TO_T5' | 'T5_TO_KICKOFF' | 'POST_KICKOFF';

export interface HistoricalAuditFinding {
  category:
    | 'ODDS_TIMESTAMP'
    | 'RAW_TEAM_METRICS'
    | 'FUNDAMENTALS_LINEAGE'
    | 'FEATURE_LINEAGE'
    | 'PIT_SAFETY'
    | 'API_REQUIREMENTS';
  severity: HistoricalAuditSeverity;
  code: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface OddsTimestampBucketCount {
  bucket: OddsTimestampBucket;
  snapshots: number;
  fixtures: number;
}

export interface HistoricalAuditRecommendation {
  status:
    | 'READY_FOR_LIVE_ONLY'
    | 'REQUIRE_HISTORICAL_BACKFILL_AND_LIVE'
    | 'REQUIRE_TIMESTAMPED_ODDS_AND_STATS'
    | 'BLOCKED_BY_PIT_VIOLATIONS';
  reasons: string[];
  requiredCapabilities: string[];
}

export function classifyOddsTimestamp(kickoffAt: Date, capturedAt: Date): OddsTimestampBucket {
  const minutesBeforeKickoff = (kickoffAt.getTime() - capturedAt.getTime()) / 60_000;

  if (minutesBeforeKickoff >= 180) {
    return 'PRE_T180';
  }

  if (minutesBeforeKickoff >= 90) {
    return 'T180_TO_T90';
  }

  if (minutesBeforeKickoff >= 30) {
    return 'T90_TO_T30';
  }

  if (minutesBeforeKickoff >= 5) {
    return 'T30_TO_T5';
  }

  if (minutesBeforeKickoff >= 0) {
    return 'T5_TO_KICKOFF';
  }

  return 'POST_KICKOFF';
}

export function oddsUsableAtHorizon(
  kickoffAt: Date,
  capturedAt: Date,
  horizonMinutes: number,
): boolean {
  if (!Number.isFinite(horizonMinutes) || horizonMinutes < 0) {
    throw new RangeError('horizonMinutes must be non-negative.');
  }

  const predictionAsOf = new Date(kickoffAt.getTime() - horizonMinutes * 60_000);

  return capturedAt.getTime() <= predictionAsOf.getTime();
}

export function lineageTimestampSafe(
  sourceAvailableAt: Date | null,
  predictionAsOf: Date,
): boolean {
  return sourceAvailableAt == null || sourceAvailableAt.getTime() <= predictionAsOf.getTime();
}

export function determineHistoricalAuditRecommendation(input: {
  pitViolations: number;
  oddsSnapshots: number;
  fixturesWithT90Odds: number;
  replayFixtures: number;
  rawMetricSnapshots: number;
  currentMetricRows: number;
  referencedSourceMetricCoverage: number | null;
  fundamentalSnapshots: number;
  featureRowsWithFundamentalLineage: number;
  featureRows: number;
}): HistoricalAuditRecommendation {
  if (input.pitViolations > 0) {
    return {
      status: 'BLOCKED_BY_PIT_VIOLATIONS',
      reasons: [
        'Historical data contains point-in-time violations that must be resolved before live integration.',
      ],
      requiredCapabilities: [
        'timestamped fixtures/results',
        'timestamped odds',
        'timestamped team statistics',
      ],
    };
  }

  const t90OddsCoverage =
    input.replayFixtures > 0 ? input.fixturesWithT90Odds / input.replayFixtures : 0;
  const featureLineageCoverage =
    input.featureRows > 0 ? input.featureRowsWithFundamentalLineage / input.featureRows : 0;

  const noRawMetricSource = input.rawMetricSnapshots === 0 && input.currentMetricRows === 0;
  const weakReferencedMetricCoverage =
    input.referencedSourceMetricCoverage != null && input.referencedSourceMetricCoverage < 0.8;
  const insufficientT90Odds = input.oddsSnapshots === 0 || t90OddsCoverage < 0.5;

  if (insufficientT90Odds && noRawMetricSource) {
    return {
      status: 'REQUIRE_TIMESTAMPED_ODDS_AND_STATS',
      reasons: [
        'Historical T-90 odds coverage is insufficient.',
        'Raw FixtureTeamMetricSnapshot coverage is absent while derived fundamentals exist.',
        'A live provider should support both timestamped odds and timestamped team statistics.',
      ],
      requiredCapabilities: [
        'historical odds with source timestamps',
        'live odds polling',
        'historical team statistics',
        'live team statistics',
        'fixtures/results',
        '2025-2026 backfill',
      ],
    };
  }

  if (insufficientT90Odds || featureLineageCoverage < 0.95 || weakReferencedMetricCoverage) {
    return {
      status: 'REQUIRE_HISTORICAL_BACKFILL_AND_LIVE',
      reasons: [
        ...(insufficientT90Odds
          ? ['Historical T-90 odds coverage is below the audit threshold.']
          : []),
        ...(featureLineageCoverage < 0.95 ? ['Feature lineage coverage is incomplete.'] : []),
        ...(weakReferencedMetricCoverage
          ? ['Historical source-fixture metric coverage is incomplete.']
          : []),
      ],
      requiredCapabilities: [
        '2025-2026 historical backfill',
        'timestamped odds',
        'live fixtures/results',
        'live statistics',
      ],
    };
  }

  return {
    status: 'READY_FOR_LIVE_ONLY',
    reasons: ['Historical point-in-time coverage is sufficient for replay validation.'],
    requiredCapabilities: ['live fixtures/results', 'live odds', 'live statistics'],
  };
}
