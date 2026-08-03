import { prisma } from '@football-ai/database';

import {
  DECISION_OPPORTUNITY_AUDIT_VERSION,
  DEFAULT_PAPER_DECISION_HORIZONS,
  DEFAULT_PAPER_DECISION_TOLERANCE_MINUTES,
  aggregateDecisionOpportunityAudit,
  auditDecisionOpportunity,
  type DecisionOpportunitySnapshot,
  type FreshOddsCheckpointEvidence,
  type PaperDecisionEvidence,
} from './decision-opportunity-audit-core.js';

type AnyRecord = Record<string, unknown>;

interface CurrentSignalRow {
  id: number;
  providerFixtureId: number;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: Date;
  kickoffAt: Date;
  status: string;
  candidateCount: number;
  currentEligibleCandidateCount: number;
  officialEligibleCandidateCount: number;
  modelSource: string | null;
  modelConfidenceTier: string | null;
  modelHistorySampleSize: number | null;
  reliabilityStatus: string | null;
  analysisPayload: unknown;
  snapshotHash: string;
  createdAt: Date;
}

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => value != null && value !== '')),
  ].sort((left, right): number => left.localeCompare(right));
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function hoursArgument(): number {
  const raw = argument('--hours');
  if (raw == null) return 720;

  const hours = positiveInteger(raw);
  if (hours == null || hours > 8760) {
    throw new Error('--hours must be an integer from 1 to 8760.');
  }

  return hours;
}

function fixtureArgument(): number | null {
  const raw = argument('--fixture');
  if (raw == null) return null;

  const providerFixtureId = positiveInteger(raw);
  if (providerFixtureId == null) {
    throw new Error('--fixture must be a positive provider fixture id.');
  }

  return providerFixtureId;
}

function parsePaperHorizons(): number[] {
  const raw = argument('--paper-horizons') ?? process.env.PAPER_BET_HORIZONS_MINUTES;

  if (raw == null || raw.trim() === '') {
    return [...DEFAULT_PAPER_DECISION_HORIZONS];
  }

  const values = raw.split(',').map((value) => Number(value.trim()));
  if (
    values.length === 0 ||
    values.some((value): boolean => !Number.isSafeInteger(value) || value < 1 || value > 1440)
  ) {
    throw new Error('--paper-horizons must contain comma-separated integers from 1 to 1440.');
  }

  return [...new Set(values)].sort((left, right): number => right - left);
}

function decisionToleranceMinutes(): number {
  const raw = argument('--decision-tolerance') ?? process.env.PAPER_BET_DECISION_TOLERANCE_MINUTES;

  if (raw == null || raw.trim() === '') {
    return DEFAULT_PAPER_DECISION_TOLERANCE_MINUTES;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 60) {
    throw new Error('--decision-tolerance must be from 0 to 60 minutes.');
  }

  return value;
}

function diagnosticsFromPayload(row: CurrentSignalRow): {
  modelSources: string[];
  confidenceTiers: string[];
  reliabilityStatuses: string[];
  modelHistorySampleSizes: number[];
  currentRejectionReasons: string[];
  officialRejectionReasons: string[];
} {
  const payload = record(row.analysisPayload);
  const analysis = record(payload?.analysis);
  const candidates = array(analysis?.candidates)
    .map(record)
    .filter((value): value is AnyRecord => value != null);
  const modelSources = uniqueStrings([
    row.modelSource,
    text(analysis?.recommendationModelSource),
    ...candidates.map((candidate) => text(candidate.modelSource)),
  ]);
  const confidenceTiers = uniqueStrings([
    row.modelConfidenceTier,
    ...candidates.map((candidate) =>
      text(candidate.modelConfidenceTier ?? candidate.confidenceTier),
    ),
  ]);
  const reliabilityStatuses = uniqueStrings([
    row.reliabilityStatus,
    ...candidates.map((candidate) => text(candidate.reliabilityStatus)),
  ]);
  const modelHistorySampleSizes = [
    row.modelHistorySampleSize,
    ...candidates.map((candidate) =>
      finiteNumber(candidate.modelHistorySampleSize ?? candidate.historySampleSize),
    ),
  ].filter((value): value is number => value != null);
  const currentRejectionReasons = [
    ...new Set(
      candidates.flatMap((candidate) =>
        stringArray(candidate.currentSignalRejectionReasons ?? candidate.rejectionReasons),
      ),
    ),
  ].sort((left, right): number => left.localeCompare(right));
  const officialRejectionReasons = [
    ...new Set(candidates.flatMap((candidate) => stringArray(candidate.officialRejectionReasons))),
  ].sort((left, right): number => left.localeCompare(right));

  return {
    modelSources,
    confidenceTiers,
    reliabilityStatuses,
    modelHistorySampleSizes,
    currentRejectionReasons,
    officialRejectionReasons,
  };
}

function snapshotInput(row: CurrentSignalRow): DecisionOpportunitySnapshot {
  return {
    snapshotId: row.id,
    snapshotHash: row.snapshotHash,
    providerFixtureId: row.providerFixtureId,
    checkpointMinutes: row.checkpointMinutes,
    checkpointLabel: row.checkpointLabel,
    snapshotAsOf: row.snapshotAsOf,
    kickoffAt: row.kickoffAt,
    analysisStatus: row.status,
    candidateCount: row.candidateCount,
    currentEligibleCandidateCount: row.currentEligibleCandidateCount,
    officialEligibleCandidateCount: row.officialEligibleCandidateCount,
    ...diagnosticsFromPayload(row),
  };
}

async function loadSnapshots(input: {
  hours: number;
  providerFixtureId: number | null;
  reportAsOf: Date;
}): Promise<CurrentSignalRow[]> {
  const since = new Date(input.reportAsOf.getTime() - input.hours * 3_600_000);

  return (await prisma.scientificCurrentSignalSnapshot.findMany({
    where: {
      createdAt: { gte: since, lte: input.reportAsOf },
      providerFixtureId: input.providerFixtureId ?? undefined,
    },
    select: {
      id: true,
      providerFixtureId: true,
      checkpointMinutes: true,
      checkpointLabel: true,
      snapshotAsOf: true,
      kickoffAt: true,
      status: true,
      candidateCount: true,
      currentEligibleCandidateCount: true,
      officialEligibleCandidateCount: true,
      modelSource: true,
      modelConfidenceTier: true,
      modelHistorySampleSize: true,
      reliabilityStatus: true,
      analysisPayload: true,
      snapshotHash: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.providerFixtureId == null ? 5000 : 100,
  })) as CurrentSignalRow[];
}

async function loadPaperDecisions(providerFixtureIds: number[]): Promise<PaperDecisionEvidence[]> {
  if (providerFixtureIds.length === 0) return [];

  return (await prisma.scientificPaperBetDecision.findMany({
    where: { providerFixtureId: { in: providerFixtureIds } },
    select: {
      id: true,
      providerFixtureId: true,
      horizonMinutes: true,
      decisionAsOf: true,
      kickoffAt: true,
      decisionType: true,
      selectedMarket: true,
      selectedSelection: true,
    },
    orderBy: [{ decisionAsOf: 'asc' }, { id: 'asc' }],
  })) as PaperDecisionEvidence[];
}

async function loadFreshOddsCheckpoints(
  providerFixtureIds: number[],
): Promise<FreshOddsCheckpointEvidence[]> {
  if (providerFixtureIds.length === 0) return [];

  return (await prisma.apiFootballFreshOddsCheckpoint.findMany({
    where: { providerFixtureId: { in: providerFixtureIds } },
    select: {
      id: true,
      providerFixtureId: true,
      horizonMinutes: true,
      status: true,
      dueAt: true,
      attemptedAt: true,
      completedAt: true,
      attempts: true,
      normalizedOdds: true,
      pitUsableOdds: true,
      errorMessage: true,
    },
    orderBy: [{ providerFixtureId: 'asc' }, { horizonMinutes: 'desc' }],
  })) as FreshOddsCheckpointEvidence[];
}

function fixtureHorizonKey(providerFixtureId: number, horizonMinutes: number): string {
  return `${providerFixtureId}:${horizonMinutes}`;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'report';
  if (!['report', 'fixture'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const summaryOnly = process.argv.includes('--summary-only');
  const reportAsOf = new Date();
  const hours = hoursArgument();
  const providerFixtureId = fixtureArgument();
  const paperHorizons = parsePaperHorizons();
  const toleranceMinutes = decisionToleranceMinutes();

  if (command === 'fixture' && providerFixtureId == null) {
    throw new Error('fixture command requires --fixture PROVIDER_FIXTURE_ID.');
  }

  const sourceRows = await loadSnapshots({
    hours,
    providerFixtureId,
    reportAsOf,
  });
  const snapshots = sourceRows.map(snapshotInput);
  const providerFixtureIds = [...new Set(snapshots.map((row) => row.providerFixtureId))];
  const [paperDecisions, freshOddsCheckpoints] = await Promise.all([
    loadPaperDecisions(providerFixtureIds),
    loadFreshOddsCheckpoints(providerFixtureIds),
  ]);
  const decisionsByKey = new Map<string, PaperDecisionEvidence[]>();

  for (const decision of paperDecisions) {
    const key = fixtureHorizonKey(decision.providerFixtureId, decision.horizonMinutes);
    const values = decisionsByKey.get(key) ?? [];
    values.push(decision);
    decisionsByKey.set(key, values);
  }

  const checkpointByKey = new Map(
    freshOddsCheckpoints.map((row): [string, FreshOddsCheckpointEvidence] => [
      fixtureHorizonKey(row.providerFixtureId, row.horizonMinutes),
      row,
    ]),
  );
  const rows = snapshots.map((snapshot) => {
    const key = fixtureHorizonKey(snapshot.providerFixtureId, snapshot.checkpointMinutes);

    return auditDecisionOpportunity({
      snapshot,
      paperDecisions: decisionsByKey.get(key) ?? [],
      freshOddsCheckpoint: checkpointByKey.get(key) ?? null,
      reportAsOf,
      paperHorizons,
      decisionToleranceMinutes: toleranceMinutes,
    });
  });
  const audit = aggregateDecisionOpportunityAudit(rows);

  console.log(
    JSON.stringify(
      {
        event: 'R4.10.2.11.1_DECISION_OPPORTUNITY_MODEL_AVAILABILITY_AUDIT',
        version: DECISION_OPPORTUNITY_AUDIT_VERSION,
        generatedAt: reportAsOf.toISOString(),
        configuration: {
          hours,
          providerFixtureId,
          paperHorizons,
          decisionToleranceMinutes: toleranceMinutes,
          summaryOnly,
        },
        coverage: {
          currentSignalSnapshotRows: sourceRows.length,
          providerFixtures: providerFixtureIds.length,
          paperDecisionRowsRead: paperDecisions.length,
          freshOddsCheckpointRowsRead: freshOddsCheckpoints.length,
        },
        audit,
        detailRowsIncluded: !summaryOnly,
        rows: summaryOnly ? undefined : rows,
        lineage: {
          opportunitySource: 'ScientificCurrentSignalSnapshot',
          paperDecisionSource: 'ScientificPaperBetDecision',
          freshOddsSource: 'ApiFootballFreshOddsCheckpoint',
          appendOnlyDerivedReadModel: true,
          historicalRowsRewritten: false,
        },
        safety: {
          paperOnly: true,
          officialBestBetChanged: false,
          automaticPromotion: false,
          automaticBetPlacement: false,
          realMoneyExecution: false,
          externalApiCalled: false,
          databaseWritten: false,
        },
      },
      null,
      2,
    ),
  );
}

let exitCode = 0;

try {
  await main();
} catch (error) {
  exitCode = 2;
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
} finally {
  await prisma.$disconnect();
  process.exitCode = exitCode;
}
