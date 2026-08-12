import { prisma } from '@football-ai/database';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHADOW_CLOSING_PROXY_TARGET_MINUTES,
  SHADOW_CLOSING_PROXY_TOLERANCE_MINUTES,
  SHADOW_SETTLEMENT_VERSION,
  aggregateShadowSettlements,
  settleShadowCandidate,
  type ShadowClosingOddsSnapshot,
  type ShadowOutcomeSnapshot,
  type ShadowSettlementCandidate,
} from './shadow-settlement-core.js';
import {
  OU_LEGACY_HISTORY_REPLAY_VERSION,
  replayLegacyOuHistorySelection,
} from './ou-legacy-history-replay-core.js';

type AnyRecord = Record<string, unknown>;

interface CurrentSignalSnapshotRow {
  id: number;
  providerFixtureId: number;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: Date;
  kickoffAt: Date;
  analysisPayload: unknown;
  snapshotHash: string;
  createdAt: Date;
}

interface SourceOddsRow {
  id: number;
  observedAt: Date;
}

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function booleanValue(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }

  return null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
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

  const fixture = positiveInteger(raw);
  if (fixture == null) {
    throw new Error('--fixture must be a positive provider fixture id.');
  }

  return fixture;
}

function selectedCandidateFromPayload(
  row: CurrentSignalSnapshotRow,
): Omit<ShadowSettlementCandidate, 'sourceOddsObservedAt'> | null {
  const payload = record(row.analysisPayload);
  const analysis = record(payload?.analysis);
  const paperDecision = record(
    payload?.paperShadowRecommendation ?? analysis?.paperShadowRecommendation,
  );

  if (paperDecision != null) {
    const persistedSelected = record(paperDecision.selected);
    const selected =
      persistedSelected == null || record(persistedSelected.ouOppositeLineStrategy) != null
        ? persistedSelected
        : (replayLegacyOuHistorySelection({
            selected: persistedSelected,
            analysisCandidates: analysis?.candidates,
          }) ?? persistedSelected);
    if (selected != null && booleanValue(selected.paperTrackEligible) === true) {
      const oppositeLineStrategy = record(selected.ouOppositeLineStrategy);
      const legacyOuReplay = record(selected.legacyOuHistoryReplay);
      const marketType = text(selected.marketType);
      const selection = text(selected.selection);
      const decimalOdds = finiteNumber(selected.decimalOdds);
      const policy = record(paperDecision.policy);

      if (
        marketType != null &&
        selection != null &&
        decimalOdds != null &&
        booleanValue(policy?.paperOnly) === true &&
        booleanValue(selected.stakeEligible) === false &&
        booleanValue(paperDecision.pitSafe) === true &&
        booleanValue(paperDecision.automaticPromotion) === false &&
        booleanValue(paperDecision.automaticBetPlacement) === false &&
        booleanValue(paperDecision.realMoneyExecution) === false
      ) {
        return {
          snapshotId: row.id,
          snapshotHash: row.snapshotHash,
          providerFixtureId: row.providerFixtureId,
          checkpointMinutes: row.checkpointMinutes,
          checkpointLabel: row.checkpointLabel,
          snapshotAsOf: row.snapshotAsOf,
          kickoffAt: row.kickoffAt,
          marketType,
          selection,
          lineValue: finiteNumber(selected.lineValue),
          decimalOdds,
          bookmakerName: text(selected.bookmakerName),
          sourceOddsSnapshotId: positiveInteger(selected.sourceOddsSnapshotId),
          modelSource: text(selected.modelSource),
          modelVersion: text(selected.modelVersion),
          paperRecommendationVersion:
            legacyOuReplay == null
              ? text(paperDecision.version)
              : [text(paperDecision.version), OU_LEGACY_HISTORY_REPLAY_VERSION].filter(
                  (value): value is string => value != null,
                ).join('::'),
          rawModelProbability: finiteNumber(selected.modelProbability),
          paperModelProbability: finiteNumber(
            selected.boundedAdjustedProbability,
            selected.hierarchicalConservativeProbability,
            selected.modelProbability,
          ),
          fairMarketProbability: finiteNumber(selected.fairMarketProbability),
          edge: finiteNumber(selected.boundedEdge, selected.hierarchicalEdge, selected.edge),
          expectedValue: finiteNumber(
            selected.boundedExpectedValue,
            selected.hierarchicalExpectedValue,
            selected.expectedValue,
          ),
          sourcePredictionSelection: text(oppositeLineStrategy?.predictionSelection),
          sourcePredictionLineValue: finiteNumber(oppositeLineStrategy?.predictionLineValue),
          sourcePredictionProbability: finiteNumber(oppositeLineStrategy?.predictionProbability),
          shadowTier: text(paperDecision.status, selected.status),
          decisionSource: 'paperShadowRecommendation',
        };
      }
    }
  }

  const currentDecision = record(payload?.shadowCandidateDecision);

  if (currentDecision != null) {
    const selected = record(currentDecision.selected);
    if (selected == null) return null;

    const marketType = text(selected.marketType, selected.marketCode);
    const selection = text(selected.selection, selected.selectionCode);
    const decimalOdds = finiteNumber(selected.decimalOdds, selected.odds);

    if (marketType == null || selection == null || decimalOdds == null) {
      return null;
    }

    const policy = record(currentDecision.policy);

    if (
      booleanValue(policy?.paperOnly) !== true ||
      booleanValue(currentDecision.automaticBetPlacement) !== false ||
      booleanValue(currentDecision.realMoneyExecution) !== false ||
      booleanValue(currentDecision.officialBestBetChanged) !== false
    ) {
      return null;
    }

    return {
      snapshotId: row.id,
      snapshotHash: row.snapshotHash,
      providerFixtureId: row.providerFixtureId,
      checkpointMinutes: row.checkpointMinutes,
      checkpointLabel: row.checkpointLabel,
      snapshotAsOf: row.snapshotAsOf,
      kickoffAt: row.kickoffAt,
      marketType,
      selection,
      lineValue: finiteNumber(selected.lineValue),
      decimalOdds,
      bookmakerName: text(selected.bookmakerName, selected.bookmaker),
      sourceOddsSnapshotId: positiveInteger(selected.sourceOddsSnapshotId),
      shadowTier:
        text(selected.shadowTier) ??
        (text(currentDecision.status) === 'CURRENT_VALUE_AVAILABLE'
          ? 'CURRENT_VALUE_SHADOW'
          : 'SHADOW_CANDIDATE'),
      modelSource: text(selected.modelSource),
      modelVersion: text(selected.modelVersion),
      paperRecommendationVersion: null,
      rawModelProbability: finiteNumber(selected.modelProbability),
      paperModelProbability: finiteNumber(
        selected.boundedAdjustedProbability,
        selected.conservativeProbability,
        selected.modelProbability,
      ),
      fairMarketProbability: finiteNumber(selected.fairMarketProbability),
      edge: finiteNumber(selected.conservativeEdge, selected.edge),
      expectedValue: finiteNumber(selected.conservativeExpectedValue, selected.expectedValue),
      decisionSource: 'shadowCandidateDecision',
    };
  }

  const classification = record(payload?.shadowCandidate);
  const selected = record(classification?.selected);

  if (classification == null || selected == null) return null;

  const marketType = text(selected.marketType, selected.marketCode);
  const selection = text(selected.selection, selected.selectionCode);
  const decimalOdds = finiteNumber(selected.decimalOdds, selected.odds);

  if (marketType == null || selection == null || decimalOdds == null) {
    return null;
  }

  if (
    booleanValue(selected.shadowOnly) !== true ||
    booleanValue(selected.stakeEligible) !== false ||
    booleanValue(classification.automaticBetPlacement) !== false ||
    booleanValue(classification.realMoneyExecution) !== false ||
    booleanValue(classification.officialBestBetChanged) !== false
  ) {
    return null;
  }

  return {
    snapshotId: row.id,
    snapshotHash: row.snapshotHash,
    providerFixtureId: row.providerFixtureId,
    checkpointMinutes: row.checkpointMinutes,
    checkpointLabel: row.checkpointLabel,
    snapshotAsOf: row.snapshotAsOf,
    kickoffAt: row.kickoffAt,
    marketType,
    selection,
    lineValue: finiteNumber(selected.lineValue),
    decimalOdds,
    bookmakerName: text(selected.bookmakerName, selected.bookmaker),
    sourceOddsSnapshotId: positiveInteger(selected.sourceOddsSnapshotId),
    shadowTier: text(selected.shadowTier),
    modelSource: text(selected.modelSource),
    modelVersion: text(selected.modelVersion),
    paperRecommendationVersion: null,
    rawModelProbability: finiteNumber(selected.modelProbability),
    paperModelProbability: finiteNumber(
      selected.boundedAdjustedProbability,
      selected.conservativeProbability,
      selected.modelProbability,
    ),
    fairMarketProbability: finiteNumber(selected.fairMarketProbability),
    edge: finiteNumber(selected.conservativeEdge, selected.edge),
    expectedValue: finiteNumber(selected.conservativeExpectedValue, selected.expectedValue),
    decisionSource: 'shadowCandidate',
  };
}

async function loadSnapshots(input: {
  hours: number;
  providerFixtureId: number | null;
  providerFixtureIds?: number[];
  reportAsOf: Date;
  maximumSnapshots?: number;
}): Promise<CurrentSignalSnapshotRow[]> {
  const since = new Date(input.reportAsOf.getTime() - input.hours * 3_600_000);

  return (await prisma.scientificCurrentSignalSnapshot.findMany({
    where: {
      createdAt: { gte: since, lte: input.reportAsOf },
      providerFixtureId:
        input.providerFixtureId ??
        (input.providerFixtureIds?.length
          ? { in: input.providerFixtureIds }
          : undefined),
    },
    select: {
      id: true,
      providerFixtureId: true,
      checkpointMinutes: true,
      checkpointLabel: true,
      snapshotAsOf: true,
      kickoffAt: true,
      analysisPayload: true,
      snapshotHash: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take:
      input.providerFixtureId == null && !input.providerFixtureIds?.length
        ? Math.max(1, Math.min(5000, Math.floor(input.maximumSnapshots ?? 5000)))
        : Math.max(1, Math.min(5000, Math.floor(input.maximumSnapshots ?? 5000))),
  })) as CurrentSignalSnapshotRow[];
}

async function loadOutcomeSnapshots(input: {
  providerFixtureIds: number[];
  reportAsOf: Date;
}): Promise<ShadowOutcomeSnapshot[]> {
  if (input.providerFixtureIds.length === 0) return [];

  return (await prisma.apiFootballFixtureSnapshot.findMany({
    where: {
      providerFixtureId: { in: input.providerFixtureIds },
      observedAt: { lte: input.reportAsOf },
    },
    select: {
      id: true,
      providerFixtureId: true,
      statusShort: true,
      observedAt: true,
      fulltimeHomeGoals: true,
      fulltimeAwayGoals: true,
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    take: 10_000,
  })) as ShadowOutcomeSnapshot[];
}

async function loadClosingOdds(input: {
  candidates: readonly Omit<ShadowSettlementCandidate, 'sourceOddsObservedAt'>[];
  reportAsOf: Date;
}): Promise<ShadowClosingOddsSnapshot[]> {
  if (input.candidates.length === 0) return [];

  const providerFixtureIds = [...new Set(input.candidates.map((row) => row.providerFixtureId))];
  const earliestClosingBoundary = new Date(
    Math.min(...input.candidates.map((row) => row.kickoffAt.getTime())) -
      (SHADOW_CLOSING_PROXY_TARGET_MINUTES + SHADOW_CLOSING_PROXY_TOLERANCE_MINUTES) * 60_000,
  );
  const latestKickoff = new Date(
    Math.max(...input.candidates.map((row) => row.kickoffAt.getTime())),
  );

  return (await prisma.apiFootballOddsSnapshot.findMany({
    where: {
      providerFixtureId: { in: providerFixtureIds },
      pitUsable: true,
      observedAt: {
        gte: earliestClosingBoundary,
        lte:
          latestKickoff.getTime() < input.reportAsOf.getTime() ? latestKickoff : input.reportAsOf,
      },
    },
    select: {
      id: true,
      providerFixtureId: true,
      marketType: true,
      selection: true,
      lineValue: true,
      decimalOdds: true,
      bookmakerName: true,
      sourceUpdatedAt: true,
      observedAt: true,
      pitUsable: true,
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    take: 20_000,
  })) as ShadowClosingOddsSnapshot[];
}

async function loadDecisionOddsObservedAt(
  sourceOddsSnapshotIds: number[],
): Promise<Map<number, Date>> {
  if (sourceOddsSnapshotIds.length === 0) return new Map();

  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: { id: { in: sourceOddsSnapshotIds } },
    select: { id: true, observedAt: true },
  })) as SourceOddsRow[];

  return new Map(rows.map((row): [number, Date] => [row.id, row.observedAt]));
}

export async function buildShadowSettlementRuntimeReport(input: {
  hours: number;
  providerFixtureId: number | null;
  providerFixtureIds?: number[];
  reportAsOf: Date;
  maximumSnapshots?: number;
}) {
  const snapshots = await loadSnapshots(input);
  const normalized = snapshots
    .map(selectedCandidateFromPayload)
    .filter(
      (value): value is Omit<ShadowSettlementCandidate, 'sourceOddsObservedAt'> => value != null,
    );
  const providerFixtureIds = [...new Set(normalized.map((row) => row.providerFixtureId))];
  const sourceOddsSnapshotIds = [
    ...new Set(
      normalized
        .map((row) => row.sourceOddsSnapshotId)
        .filter((value): value is number => value != null),
    ),
  ];
  const [outcomeSnapshots, closingOddsSnapshots, sourceObservedAt] = await Promise.all([
    loadOutcomeSnapshots({ providerFixtureIds, reportAsOf: input.reportAsOf }),
    loadClosingOdds({ candidates: normalized, reportAsOf: input.reportAsOf }),
    loadDecisionOddsObservedAt(sourceOddsSnapshotIds),
  ]);
  const candidates = normalized.map((row): ShadowSettlementCandidate => ({
    ...row,
    sourceOddsObservedAt:
      row.sourceOddsSnapshotId == null
        ? null
        : (sourceObservedAt.get(row.sourceOddsSnapshotId) ?? null),
  }));
  const rows = candidates.map((candidate) =>
    settleShadowCandidate({
      candidate,
      outcomeSnapshots,
      closingOddsSnapshots,
      reportAsOf: input.reportAsOf,
    }),
  );

  return {
    snapshots,
    candidates,
    outcomeSnapshots,
    closingOddsSnapshots,
    rows,
    reliability: aggregateShadowSettlements(rows),
  };
}
async function main(): Promise<void> {
  const command = process.argv[2] ?? 'report';
  if (!['report', 'fixture'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const reportAsOf = new Date();
  const hours = hoursArgument();
  const providerFixtureId = fixtureArgument();

  if (command === 'fixture' && providerFixtureId == null) {
    throw new Error('fixture command requires --fixture PROVIDER_FIXTURE_ID.');
  }

  const { snapshots, candidates, outcomeSnapshots, closingOddsSnapshots, rows, reliability } =
    await buildShadowSettlementRuntimeReport({
      hours,
      providerFixtureId,
      reportAsOf,
    });

  console.log(
    JSON.stringify(
      {
        event: 'R4.10.2.11_SHADOW_SETTLEMENT_OUTCOME_CLV_REPORT',
        version: SHADOW_SETTLEMENT_VERSION,
        generatedAt: reportAsOf.toISOString(),
        window: {
          hours,
          providerFixtureId,
        },
        coverage: {
          sourceSnapshotRows: snapshots.length,
          rowsWithPersistedShadowCandidate: candidates.length,
          outcomeSnapshotRowsRead: outcomeSnapshots.length,
          closingOddsRowsRead: closingOddsSnapshots.length,
        },
        reliability,
        rows,
        lineage: {
          shadow:
            'ScientificCurrentSignalSnapshot.analysisPayload.paperShadowRecommendation|analysis.paperShadowRecommendation|shadowCandidateDecision|shadowCandidate',
          outcome: 'ApiFootballFixtureSnapshot',
          closingProxy: 'ApiFootballOddsSnapshot',
          closingTarget: 'T-5',
          closingToleranceMinutes: SHADOW_CLOSING_PROXY_TOLERANCE_MINUTES,
          appendOnlyDerivedReadModel: true,
          legacyOuHistoryReplay: OU_LEGACY_HISTORY_REPLAY_VERSION,
          historicalRowsRewritten: false,
        },
        safety: {
          paperOnly: true,
          stakeEligible: false,
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

const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]).toLocaleLowerCase('en-US') ===
    fileURLToPath(import.meta.url).toLocaleLowerCase('en-US');

if (invokedDirectly) {
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
}
