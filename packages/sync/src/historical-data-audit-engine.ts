import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';
import {
  HISTORICAL_DATA_AUDIT_POLICY_VERSION,
  HISTORICAL_DATA_AUDIT_VERSION,
  classifyOddsTimestamp,
  determineHistoricalAuditRecommendation,
  lineageTimestampSafe,
  oddsUsableAtHorizon,
  type HistoricalAuditFinding,
  type OddsTimestampBucket,
} from './historical-data-audit-contract.js';

interface ReplayRunRow {
  id: number;
  status: string;
  dateFrom: Date;
  dateTo: Date;
  fixturesPlanned: number;
  predictions: number;
  payloadHash: string;
}

interface ReplayPredictionRow {
  fixtureId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  sourceFeaturePayloadHash: string;
}

interface FixtureAuditRow {
  id: number;
  kickoffAt: Date;
}

interface OddsAuditRow {
  fixtureId: number;
  capturedAt: Date;
  isLive: boolean;
}

interface FeatureAuditRow {
  id: number;
  fixtureId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  marketAvailable: boolean;
  bookmakerCount: number;
  sourcePayload: unknown;
  payloadHash: string;
}

interface FundamentalAuditRow {
  id: number;
  fixtureId: number;
  teamId: number;
  predictionAsOf: Date;
  horizonMinutes: number;
  metricCoverage10: number;
  dataQualityScore: number;
  latestSourceFixtureId: number | null;
  latestSourceKickoffAt: Date | null;
  latestSourceAvailableAt: Date | null;
  rawPayload: unknown;
}

interface MetricAuditRow {
  fixtureId: number;
  teamId: number;
  capturedAt: Date;
}

interface ParsedFeatureLineage {
  homeFundamentalSnapshotId: number | null;
  awayFundamentalSnapshotId: number | null;
  dixonSnapshotId: number | null;
  marketAvailable: boolean | null;
  marketObservedFrom: Date | null;
  marketObservedTo: Date | null;
}

function jsonValue(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}

function repositoryRoot(): string {
  let current = process.cwd();

  while (true) {
    if (
      existsSync(resolve(current, '.git')) &&
      existsSync(resolve(current, 'packages/database/prisma/schema.prisma'))
    ) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error(`Cannot locate repository root from ${process.cwd()}.`);
    }

    current = parent;
  }
}

function artifactRoot(): string {
  return resolve(
    repositoryRoot(),
    process.env.HISTORICAL_DATA_AUDIT_ARTIFACT_DIRECTORY ?? 'artifacts/provider/v7-beta1a1-audit',
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseFeatureLineage(value: unknown): ParsedFeatureLineage {
  const row = asRecord(value);
  const market = asRecord(row?.market);

  return {
    homeFundamentalSnapshotId: numeric(row?.homeFundamentalSnapshotId),
    awayFundamentalSnapshotId: numeric(row?.awayFundamentalSnapshotId),
    dixonSnapshotId: numeric(row?.dixonSnapshotId),
    marketAvailable: typeof market?.available === 'boolean' ? market.available : null,
    marketObservedFrom: dateValue(market?.observedFrom),
    marketObservedTo: dateValue(market?.observedTo),
  };
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(sorted.length - 1, Math.max(0, quantile * (sorted.length - 1)));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower]!;
  }

  const weight = position - lower;

  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function pushFinding(findings: HistoricalAuditFinding[], finding: HistoricalAuditFinding): void {
  findings.push(finding);
}

function timestampBucketSummary(
  oddsRows: OddsAuditRow[],
  fixtureMap: Map<number, FixtureAuditRow>,
): Array<{
  bucket: OddsTimestampBucket;
  snapshots: number;
  fixtures: number;
}> {
  const buckets: OddsTimestampBucket[] = [
    'PRE_T180',
    'T180_TO_T90',
    'T90_TO_T30',
    'T30_TO_T5',
    'T5_TO_KICKOFF',
    'POST_KICKOFF',
  ];
  const snapshotCounts = new Map<OddsTimestampBucket, number>();
  const fixtureSets = new Map<OddsTimestampBucket, Set<number>>();

  for (const bucket of buckets) {
    snapshotCounts.set(bucket, 0);
    fixtureSets.set(bucket, new Set());
  }

  for (const row of oddsRows) {
    const fixture = fixtureMap.get(row.fixtureId);

    if (!fixture) {
      continue;
    }

    const bucket = classifyOddsTimestamp(fixture.kickoffAt, row.capturedAt);
    snapshotCounts.set(bucket, (snapshotCounts.get(bucket) ?? 0) + 1);
    fixtureSets.get(bucket)!.add(row.fixtureId);
  }

  return buckets.map((bucket) => ({
    bucket,
    snapshots: snapshotCounts.get(bucket) ?? 0,
    fixtures: fixtureSets.get(bucket)!.size,
  }));
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function runHistoricalDataAudit(): Promise<SyncSummary> {
  return runTrackedSync('historical-data-audit-run', async () => {
    const auditStartedAt = new Date();
    const replayRun = (await prisma.providerReplayRun.findFirst({
      where: {
        status: 'SUCCESS',
      },
      orderBy: {
        startedAt: 'desc',
      },
    })) as ReplayRunRow | null;

    if (!replayRun) {
      throw new Error('No successful beta.1A replay run exists.');
    }

    const replayPredictions = (await prisma.providerReplayPrediction.findMany({
      where: {
        runId: replayRun.id,
      },
      select: {
        fixtureId: true,
        predictionAsOf: true,
        kickoffAt: true,
        sourceFeaturePayloadHash: true,
      },
      orderBy: [
        {
          kickoffAt: 'asc',
        },
        {
          fixtureId: 'asc',
        },
      ],
    })) as ReplayPredictionRow[];

    const fixtures = (await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        homeGoals: {
          not: null,
        },
        awayGoals: {
          not: null,
        },
        kickoffAt: {
          gte: replayRun.dateFrom,
          lte: replayRun.dateTo,
        },
      },
      select: {
        id: true,
        kickoffAt: true,
      },
      orderBy: [
        {
          kickoffAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    })) as FixtureAuditRow[];
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

    const oddsRows =
      fixtureIds.length > 0
        ? ((await prisma.oddsSnapshot.findMany({
            where: {
              fixtureId: {
                in: fixtureIds,
              },
              isLive: false,
            },
            select: {
              fixtureId: true,
              capturedAt: true,
              isLive: true,
            },
            orderBy: [
              {
                fixtureId: 'asc',
              },
              {
                capturedAt: 'asc',
              },
            ],
          })) as OddsAuditRow[])
        : [];

    const oddsByFixture = new Map<number, OddsAuditRow[]>();

    for (const row of oddsRows) {
      const current = oddsByFixture.get(row.fixtureId) ?? [];
      current.push(row);
      oddsByFixture.set(row.fixtureId, current);
    }

    let snapshotsUsableT90 = 0;
    const fixturesWithAnyOdds = new Set<number>();
    const fixturesWithT90Odds = new Set<number>();
    const oddsLagMinutes: number[] = [];
    const fixtureOddsRows: Array<{
      fixtureId: number;
      kickoffAt: string;
      snapshots: number;
      usableT90Snapshots: number;
      earliestCapturedAt: string | null;
      latestCapturedAt: string | null;
      earliestMinutesFromKickoff: number | null;
      latestMinutesFromKickoff: number | null;
    }> = [];

    for (const fixture of fixtures) {
      const rows = oddsByFixture.get(fixture.id) ?? [];
      const usable = rows.filter((row) =>
        oddsUsableAtHorizon(fixture.kickoffAt, row.capturedAt, 90),
      );

      if (rows.length > 0) {
        fixturesWithAnyOdds.add(fixture.id);
      }

      if (usable.length > 0) {
        fixturesWithT90Odds.add(fixture.id);
      }

      snapshotsUsableT90 += usable.length;

      for (const row of rows) {
        oddsLagMinutes.push((row.capturedAt.getTime() - fixture.kickoffAt.getTime()) / 60_000);
      }

      fixtureOddsRows.push({
        fixtureId: fixture.id,
        kickoffAt: fixture.kickoffAt.toISOString(),
        snapshots: rows.length,
        usableT90Snapshots: usable.length,
        earliestCapturedAt: rows[0]?.capturedAt.toISOString() ?? null,
        latestCapturedAt: rows[rows.length - 1]?.capturedAt.toISOString() ?? null,
        earliestMinutesFromKickoff: rows[0]
          ? (rows[0].capturedAt.getTime() - fixture.kickoffAt.getTime()) / 60_000
          : null,
        latestMinutesFromKickoff:
          rows.length > 0
            ? (rows[rows.length - 1]!.capturedAt.getTime() - fixture.kickoffAt.getTime()) / 60_000
            : null,
      });
    }

    const oddsBuckets = timestampBucketSummary(oddsRows, fixtureMap);

    const featureHashes = replayPredictions.map((row) => row.sourceFeaturePayloadHash);
    const features =
      featureHashes.length > 0
        ? ((await prisma.mlFeatureSnapshot.findMany({
            where: {
              payloadHash: {
                in: featureHashes,
              },
            },
            select: {
              id: true,
              fixtureId: true,
              predictionAsOf: true,
              kickoffAt: true,
              horizonMinutes: true,
              marketAvailable: true,
              bookmakerCount: true,
              sourcePayload: true,
              payloadHash: true,
            },
          })) as FeatureAuditRow[])
        : [];

    let featureRowsWithLineage = 0;
    let featureRowsWithMarketLineage = 0;
    let featureMarketLineagePitViolations = 0;
    const fundamentalIds = new Set<number>();
    const featureLineageRows = features.map((feature) => {
      const lineage = parseFeatureLineage(feature.sourcePayload);
      const completeFundamentalLineage =
        lineage.homeFundamentalSnapshotId != null &&
        lineage.awayFundamentalSnapshotId != null &&
        lineage.dixonSnapshotId != null;

      if (completeFundamentalLineage) {
        featureRowsWithLineage += 1;
        fundamentalIds.add(lineage.homeFundamentalSnapshotId!);
        fundamentalIds.add(lineage.awayFundamentalSnapshotId!);
      }

      const marketLineagePresent =
        lineage.marketAvailable != null ||
        lineage.marketObservedFrom != null ||
        lineage.marketObservedTo != null;

      if (marketLineagePresent) {
        featureRowsWithMarketLineage += 1;
      }

      const marketPitSafe =
        lineage.marketObservedTo == null ||
        lineageTimestampSafe(lineage.marketObservedTo, feature.predictionAsOf);

      if (!marketPitSafe) {
        featureMarketLineagePitViolations += 1;
      }

      return {
        fixtureId: feature.fixtureId,
        predictionAsOf: feature.predictionAsOf.toISOString(),
        marketAvailable: feature.marketAvailable,
        bookmakerCount: feature.bookmakerCount,
        homeFundamentalSnapshotId: lineage.homeFundamentalSnapshotId,
        awayFundamentalSnapshotId: lineage.awayFundamentalSnapshotId,
        dixonSnapshotId: lineage.dixonSnapshotId,
        marketLineageAvailable: lineage.marketAvailable,
        marketObservedFrom: lineage.marketObservedFrom?.toISOString() ?? null,
        marketObservedTo: lineage.marketObservedTo?.toISOString() ?? null,
        marketPitSafe,
        completeFundamentalLineage,
      };
    });

    const fundamentals =
      fundamentalIds.size > 0
        ? ((await prisma.teamFundamentalSnapshot.findMany({
            where: {
              id: {
                in: [...fundamentalIds],
              },
            },
            select: {
              id: true,
              fixtureId: true,
              teamId: true,
              predictionAsOf: true,
              horizonMinutes: true,
              metricCoverage10: true,
              dataQualityScore: true,
              latestSourceFixtureId: true,
              latestSourceKickoffAt: true,
              latestSourceAvailableAt: true,
              rawPayload: true,
            },
          })) as FundamentalAuditRow[])
        : [];

    let fundamentalPitViolations = 0;
    const metricCoverageValues = fundamentals.map((row) => row.metricCoverage10);
    const dataQualityValues = fundamentals.map((row) => row.dataQualityScore);
    const sourceFixtureIds = new Set<number>();

    for (const row of fundamentals) {
      if (!lineageTimestampSafe(row.latestSourceAvailableAt, row.predictionAsOf)) {
        fundamentalPitViolations += 1;
      }

      const payload = asRecord(row.rawPayload);
      const payloadIds = Array.isArray(payload?.sourceFixtureIds)
        ? payload!.sourceFixtureIds
            .map((value) => numeric(value))
            .filter((value): value is number => value != null)
        : [];

      for (const fixtureId of payloadIds) {
        sourceFixtureIds.add(fixtureId);
      }
    }

    const sourceFixtureIdList = [...sourceFixtureIds];

    const [rawMetricSnapshotCount, currentMetricCount, rawMetricSnapshots, currentMetricRows] =
      await Promise.all([
        prisma.fixtureTeamMetricSnapshot.count(),
        prisma.fixtureTeamMetric.count(),
        sourceFixtureIdList.length > 0
          ? prisma.fixtureTeamMetricSnapshot.findMany({
              where: {
                fixtureId: {
                  in: sourceFixtureIdList,
                },
              },
              select: {
                fixtureId: true,
                teamId: true,
                capturedAt: true,
              },
            })
          : Promise.resolve([]),
        sourceFixtureIdList.length > 0
          ? prisma.fixtureTeamMetric.findMany({
              where: {
                fixtureId: {
                  in: sourceFixtureIdList,
                },
              },
              select: {
                fixtureId: true,
                teamId: true,
                capturedAt: true,
              },
            })
          : Promise.resolve([]),
      ]);
    const typedSnapshotRows = rawMetricSnapshots as MetricAuditRow[];
    const typedCurrentRows = currentMetricRows as MetricAuditRow[];
    const metricSourceFixtureCoverage = new Set(
      [...typedSnapshotRows, ...typedCurrentRows].map((row) => row.fixtureId),
    ).size;
    const metricSourceFixtureCoverageRate =
      sourceFixtureIdList.length > 0
        ? metricSourceFixtureCoverage / sourceFixtureIdList.length
        : null;

    const pitViolations = fundamentalPitViolations + featureMarketLineagePitViolations;
    const recommendation = determineHistoricalAuditRecommendation({
      pitViolations,
      oddsSnapshots: oddsRows.length,
      fixturesWithT90Odds: fixturesWithT90Odds.size,
      replayFixtures: fixtures.length,
      rawMetricSnapshots: rawMetricSnapshotCount,
      currentMetricRows: currentMetricCount,
      referencedSourceMetricCoverage: metricSourceFixtureCoverageRate,
      fundamentalSnapshots: fundamentals.length,
      featureRowsWithFundamentalLineage: featureRowsWithLineage,
      featureRows: features.length,
    });
    const findings: HistoricalAuditFinding[] = [];

    if (oddsRows.length > 0 && fixturesWithT90Odds.size === 0) {
      pushFinding(findings, {
        category: 'ODDS_TIMESTAMP',
        severity: 'CRITICAL',
        code: 'ODDS_EXIST_BUT_ZERO_T90_FIXTURES',
        message:
          'Odds snapshots exist for the replay window, but none are timestamp-eligible at T-90.',
        evidence: {
          oddsSnapshots: oddsRows.length,
          fixturesWithAnyOdds: fixturesWithAnyOdds.size,
          fixturesWithT90Odds: fixturesWithT90Odds.size,
          snapshotsUsableT90,
        },
      });
    }

    const postKickoff = oddsBuckets.find((row) => row.bucket === 'POST_KICKOFF')?.snapshots ?? 0;
    const postKickoffRate = oddsRows.length > 0 ? postKickoff / oddsRows.length : 0;

    if (postKickoffRate >= 0.8) {
      pushFinding(findings, {
        category: 'ODDS_TIMESTAMP',
        severity: 'CRITICAL',
        code: 'ODDS_TIMESTAMPS_DOMINATED_BY_POST_KICKOFF',
        message:
          'At least 80% of historical odds timestamps occur after kickoff, so they cannot be treated as prematch point-in-time evidence.',
        evidence: {
          postKickoffSnapshots: postKickoff,
          oddsSnapshots: oddsRows.length,
          postKickoffRate,
        },
      });
    }

    if (rawMetricSnapshotCount === 0 && currentMetricCount > 0) {
      pushFinding(findings, {
        category: 'RAW_TEAM_METRICS',
        severity: 'INFO',
        code: 'SNAPSHOT_TABLE_EMPTY_LEGACY_CURRENT_METRICS_EXIST',
        message:
          'FixtureTeamMetricSnapshot is empty, but FixtureTeamMetric contains historical source metrics. Zero target-fixture prematch metric coverage in beta.1A does not by itself mean fundamentals had no metric signal.',
        evidence: {
          rawMetricSnapshotCount,
          currentMetricCount,
          referencedSourceFixtures: sourceFixtureIdList.length,
          referencedSourceFixturesWithMetrics: metricSourceFixtureCoverage,
          metricSourceFixtureCoverageRate,
        },
      });
    }

    if (rawMetricSnapshotCount === 0 && currentMetricCount === 0) {
      pushFinding(findings, {
        category: 'RAW_TEAM_METRICS',
        severity: 'CRITICAL',
        code: 'NO_RAW_TEAM_METRIC_SOURCE',
        message:
          'Neither snapshot nor current historical team metric tables contain raw metric rows.',
        evidence: {
          rawMetricSnapshotCount,
          currentMetricCount,
        },
      });
    }

    if (fundamentals.length > 0 && featureRowsWithLineage === features.length) {
      pushFinding(findings, {
        category: 'FUNDAMENTALS_LINEAGE',
        severity: 'INFO',
        code: 'FEATURE_FUNDAMENTAL_LINEAGE_COMPLETE',
        message:
          'Every replay feature row contains explicit home/away fundamental and Dixon-Coles source identifiers.',
        evidence: {
          featureRows: features.length,
          featureRowsWithLineage,
          referencedFundamentalSnapshots: fundamentalIds.size,
          resolvedFundamentalSnapshots: fundamentals.length,
        },
      });
    } else {
      pushFinding(findings, {
        category: 'FUNDAMENTALS_LINEAGE',
        severity: 'WARNING',
        code: 'FEATURE_FUNDAMENTAL_LINEAGE_INCOMPLETE',
        message:
          'Some replay feature rows do not contain complete fundamental/Dixon-Coles lineage identifiers.',
        evidence: {
          featureRows: features.length,
          featureRowsWithLineage,
          referencedFundamentalSnapshots: fundamentalIds.size,
          resolvedFundamentalSnapshots: fundamentals.length,
        },
      });
    }

    if (fundamentalPitViolations > 0 || featureMarketLineagePitViolations > 0) {
      pushFinding(findings, {
        category: 'PIT_SAFETY',
        severity: 'CRITICAL',
        code: 'LINEAGE_TIMESTAMP_PIT_VIOLATION',
        message: 'Derived lineage contains timestamps later than predictionAsOf.',
        evidence: {
          fundamentalPitViolations,
          featureMarketLineagePitViolations,
        },
      });
    } else {
      pushFinding(findings, {
        category: 'PIT_SAFETY',
        severity: 'INFO',
        code: 'DERIVED_LINEAGE_PIT_SAFE',
        message:
          'No PIT violation was found in resolved fundamental latest-source timestamps or feature market observedTo timestamps.',
        evidence: {
          fundamentalPitViolations,
          featureMarketLineagePitViolations,
        },
      });
    }

    pushFinding(findings, {
      category: 'API_REQUIREMENTS',
      severity: recommendation.status === 'READY_FOR_LIVE_ONLY' ? 'INFO' : 'WARNING',
      code: 'NEXT_PROVIDER_REQUIREMENTS',
      message: `Audit recommendation: ${recommendation.status}.`,
      evidence: {
        reasons: recommendation.reasons,
        requiredCapabilities: recommendation.requiredCapabilities,
      },
    });

    const summary = {
      replay: {
        runId: replayRun.id,
        dateFrom: replayRun.dateFrom.toISOString(),
        dateTo: replayRun.dateTo.toISOString(),
        fixtures: fixtures.length,
        replayPredictions: replayPredictions.length,
      },
      odds: {
        snapshots: oddsRows.length,
        fixturesWithAnyOdds: fixturesWithAnyOdds.size,
        fixturesWithT90Odds: fixturesWithT90Odds.size,
        snapshotsUsableT90,
        t90FixtureCoverage: fixtures.length > 0 ? fixturesWithT90Odds.size / fixtures.length : null,
        buckets: oddsBuckets,
        capturedMinutesFromKickoff: {
          minimum: oddsLagMinutes.length > 0 ? Math.min(...oddsLagMinutes) : null,
          p25: percentile(oddsLagMinutes, 0.25),
          median: percentile(oddsLagMinutes, 0.5),
          p75: percentile(oddsLagMinutes, 0.75),
          maximum: oddsLagMinutes.length > 0 ? Math.max(...oddsLagMinutes) : null,
        },
      },
      rawMetrics: {
        snapshotRows: rawMetricSnapshotCount,
        currentRows: currentMetricCount,
        referencedSourceFixtures: sourceFixtureIdList.length,
        referencedSourceFixturesWithMetrics: metricSourceFixtureCoverage,
        referencedSourceFixtureCoverage: metricSourceFixtureCoverageRate,
      },
      fundamentals: {
        referencedIds: fundamentalIds.size,
        resolvedRows: fundamentals.length,
        metricCoverage10: {
          mean: average(metricCoverageValues),
          median: percentile(metricCoverageValues, 0.5),
          minimum: metricCoverageValues.length > 0 ? Math.min(...metricCoverageValues) : null,
          maximum: metricCoverageValues.length > 0 ? Math.max(...metricCoverageValues) : null,
        },
        dataQualityScore: {
          mean: average(dataQualityValues),
          median: percentile(dataQualityValues, 0.5),
        },
        pitViolations: fundamentalPitViolations,
      },
      features: {
        rows: features.length,
        rowsWithFundamentalLineage: featureRowsWithLineage,
        fundamentalLineageCoverage:
          features.length > 0 ? featureRowsWithLineage / features.length : null,
        rowsWithMarketLineage: featureRowsWithMarketLineage,
        marketLineagePitViolations: featureMarketLineagePitViolations,
        marketAvailableRows: features.filter((feature) => feature.marketAvailable).length,
      },
      safety: {
        pitViolations,
        historicalTimestampMutation: false,
        fabricatedBackfill: false,
        liveApiCalled: false,
        freshShadowRowsWritten: 0,
        productionModelChanged: false,
      },
    };
    const payload = {
      auditVersion: HISTORICAL_DATA_AUDIT_VERSION,
      policyVersion: HISTORICAL_DATA_AUDIT_POLICY_VERSION,
      replayRunPayloadHash: replayRun.payloadHash,
      summary,
      findings,
      recommendation,
    };
    const payloadHash = deterministicHash('HISTORICAL_DATA_AUDIT_RUN', payload);
    const existing = await prisma.historicalDataAuditRun.findUnique({
      where: {
        payloadHash,
      },
    });

    if (existing) {
      return {
        processed: fixtures.length,
        inserted: 0,
        updated: 0,
        metadata: jsonValue({
          runId: existing.id,
          idempotent: true,
          recommendationStatus: existing.recommendationStatus,
          findings: findings.length,
          pitViolations,
          liveApiCalled: false,
          freshShadowRowsWritten: 0,
          productionModelChanged: false,
        }),
      };
    }

    const artifactDirectory = resolve(
      artifactRoot(),
      `${HISTORICAL_DATA_AUDIT_VERSION}-${payloadHash.slice(0, 12)}`,
    );
    mkdirSync(artifactDirectory, {
      recursive: true,
    });
    writeFileSync(
      resolve(artifactDirectory, 'audit-summary.json'),
      JSON.stringify(
        {
          ...payload,
          payloadHash,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    writeFileSync(
      resolve(artifactDirectory, 'odds-timestamp-distribution.json'),
      JSON.stringify(
        {
          buckets: oddsBuckets,
          snapshots: oddsRows.length,
          fixturesWithAnyOdds: fixturesWithAnyOdds.size,
          fixturesWithT90Odds: fixturesWithT90Odds.size,
          snapshotsUsableT90,
          capturedMinutesFromKickoff: summary.odds.capturedMinutesFromKickoff,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    const csvLines = [
      [
        'fixtureId',
        'kickoffAt',
        'snapshots',
        'usableT90Snapshots',
        'earliestCapturedAt',
        'latestCapturedAt',
        'earliestMinutesFromKickoff',
        'latestMinutesFromKickoff',
      ].join(','),
      ...fixtureOddsRows.map((row) =>
        [
          row.fixtureId,
          row.kickoffAt,
          row.snapshots,
          row.usableT90Snapshots,
          row.earliestCapturedAt,
          row.latestCapturedAt,
          row.earliestMinutesFromKickoff,
          row.latestMinutesFromKickoff,
        ]
          .map(csvEscape)
          .join(','),
      ),
    ];
    writeFileSync(
      resolve(artifactDirectory, 'fixture-odds-coverage.csv'),
      csvLines.join('\n') + '\n',
      'utf8',
    );
    writeFileSync(
      resolve(artifactDirectory, 'feature-lineage.json'),
      JSON.stringify(featureLineageRows, null, 2) + '\n',
      'utf8',
    );
    writeFileSync(
      resolve(artifactDirectory, 'recommendation.json'),
      JSON.stringify(recommendation, null, 2) + '\n',
      'utf8',
    );

    const run = await prisma.historicalDataAuditRun.create({
      data: {
        auditVersion: HISTORICAL_DATA_AUDIT_VERSION,
        policyVersion: HISTORICAL_DATA_AUDIT_POLICY_VERSION,
        status: 'SUCCESS',
        dateFrom: replayRun.dateFrom,
        dateTo: replayRun.dateTo,
        replayFixtures: fixtures.length,
        replayPredictions: replayPredictions.length,
        oddsSnapshots: oddsRows.length,
        fixturesWithAnyOdds: fixturesWithAnyOdds.size,
        fixturesWithT90Odds: fixturesWithT90Odds.size,
        rawMetricSnapshots: rawMetricSnapshotCount,
        fundamentalSnapshots: fundamentals.length,
        featureSnapshots: features.length,
        featureRowsWithLineage,
        featureRowsWithMarketLineage,
        pitViolations,
        recommendationStatus: recommendation.status,
        summary: jsonValue(summary),
        recommendation: jsonValue(recommendation),
        artifactDirectory: relative(repositoryRoot(), artifactDirectory).replaceAll('\\', '/'),
        payloadHash,
        startedAt: auditStartedAt,
        finishedAt: new Date(),
      },
    });

    if (findings.length > 0) {
      await prisma.historicalDataAuditFinding.createMany({
        data: findings.map((finding) => {
          const findingPayload = {
            runId: run.id,
            ...finding,
          };

          return {
            runId: run.id,
            category: finding.category,
            severity: finding.severity,
            code: finding.code,
            message: finding.message,
            evidence: jsonValue(finding.evidence),
            payloadHash: deterministicHash('HISTORICAL_DATA_AUDIT_FINDING', findingPayload),
          };
        }),
        skipDuplicates: true,
      });
    }

    return {
      processed: fixtures.length,
      inserted: 1 + findings.length,
      updated: 0,
      metadata: jsonValue({
        runId: run.id,
        recommendationStatus: recommendation.status,
        oddsSnapshots: oddsRows.length,
        fixturesWithAnyOdds: fixturesWithAnyOdds.size,
        fixturesWithT90Odds: fixturesWithT90Odds.size,
        snapshotsUsableT90,
        rawMetricSnapshotCount,
        currentMetricCount,
        featureRows: features.length,
        featureRowsWithLineage,
        referencedFundamentalSnapshots: fundamentalIds.size,
        resolvedFundamentalSnapshots: fundamentals.length,
        metricCoverage10Mean: average(metricCoverageValues),
        metricSourceFixtureCoverageRate,
        pitViolations,
        findings: findings.length,
        artifactDirectory: run.artifactDirectory,
        historicalTimestampMutation: false,
        fabricatedBackfill: false,
        liveApiCalled: false,
        freshShadowRowsWritten: 0,
        productionModelChanged: false,
      }),
    };
  });
}

export async function getHistoricalDataAuditCoverage(): Promise<{
  auditRuns: number;
  successfulRuns: number;
  findings: number;
  criticalFindings: number;
  warningFindings: number;
  pitViolations: number;
  latestRun: unknown;
}> {
  const [
    auditRuns,
    successfulRuns,
    findings,
    criticalFindings,
    warningFindings,
    pitAggregate,
    latestRun,
  ] = await Promise.all([
    prisma.historicalDataAuditRun.count(),
    prisma.historicalDataAuditRun.count({
      where: {
        status: 'SUCCESS',
      },
    }),
    prisma.historicalDataAuditFinding.count(),
    prisma.historicalDataAuditFinding.count({
      where: {
        severity: 'CRITICAL',
      },
    }),
    prisma.historicalDataAuditFinding.count({
      where: {
        severity: 'WARNING',
      },
    }),
    prisma.historicalDataAuditRun.aggregate({
      _sum: {
        pitViolations: true,
      },
    }),
    prisma.historicalDataAuditRun.findFirst({
      orderBy: {
        startedAt: 'desc',
      },
    }),
  ]);

  return {
    auditRuns,
    successfulRuns,
    findings,
    criticalFindings,
    warningFindings,
    pitViolations: pitAggregate._sum.pitViolations ?? 0,
    latestRun,
  };
}

export async function getHistoricalDataAuditReport(): Promise<{
  run: unknown;
  findings: unknown[];
  decision: {
    historicalTimestampMutation: false;
    fabricatedBackfill: false;
    liveApiCalled: false;
    freshShadowRowsWritten: 0;
    productionModelChanged: false;
  };
} | null> {
  const run = await prisma.historicalDataAuditRun.findFirst({
    where: {
      status: 'SUCCESS',
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  if (!run) {
    return null;
  }

  const findings = await prisma.historicalDataAuditFinding.findMany({
    where: {
      runId: run.id,
    },
    orderBy: [
      {
        severity: 'asc',
      },
      {
        category: 'asc',
      },
      {
        code: 'asc',
      },
    ],
  });

  return {
    run,
    findings,
    decision: {
      historicalTimestampMutation: false,
      fabricatedBackfill: false,
      liveApiCalled: false,
      freshShadowRowsWritten: 0,
      productionModelChanged: false,
    },
  };
}
