import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@football-ai/database';

import { getScientificBestBetReliabilityReport } from './scientific-best-bet-reliability-engine.js';
import {
  HISTORICAL_BEST_BET_BENCHMARK_VERSION,
  HISTORICAL_BEST_BET_EVIDENCE_CLASS,
  HISTORICAL_BEST_BET_HORIZON_MINUTES,
  evaluateHistoricalMatchWinnerEvent,
  summarizeHistoricalBenchmark,
  type HistoricalBenchmarkEventResult,
} from './historical-best-bet-benchmark-core.js';
import {
  SCIENTIFIC_BEST_BET_POLICY,
  SCIENTIFIC_BEST_BET_POLICY_VERSION,
} from './scientific-best-bet-policy-contract.js';
import type { LiveOddsRow } from './real-odds-paper-bet-core.js';

interface ReplayRunRow {
  id: number;
  dateFrom: Date;
  dateTo: Date;
  status: string;
  providerVersion: string;
  payloadHash: string;
  finishedAt: Date | null;
}

interface ReplayPredictionRow {
  id: number;
  runId: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  candidateHomeProbability: number;
  candidateDrawProbability: number;
  candidateAwayProbability: number;
  pitSafe: boolean;
  payloadHash: string;
}

interface FixtureRow {
  id: number;
  apiFixtureId: number;
  leagueId: number;
  kickoffAt: Date;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface ClosingOddsRow {
  decimalOdds: number;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
}

export interface HistoricalBenchmarkOptions {
  dateFrom?: Date;
  dateTo?: Date;
  maxOddsAgeMinutes?: number;
  fixtureLimit?: number;
  writeArtifacts?: boolean;
}

function repoRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(current, '../../..');
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function effectiveOddsTime(row: { sourceUpdatedAt: Date | null; observedAt: Date }): Date {
  return row.sourceUpdatedAt ?? row.observedAt;
}

function validDate(value: Date | undefined, fallback: Date): Date {
  return value != null && Number.isFinite(value.getTime()) ? value : fallback;
}

function finitePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('fixtureLimit must be positive.');
  return Math.floor(value);
}

async function replayRunById(runId: number): Promise<ReplayRunRow> {
  const row = (await prisma.providerReplayRun.findFirst({
    where: { id: runId, status: 'SUCCESS' },
    select: {
      id: true,
      dateFrom: true,
      dateTo: true,
      status: true,
      providerVersion: true,
      payloadHash: true,
      finishedAt: true,
    },
  })) as ReplayRunRow | null;

  if (row == null) {
    throw new Error(`RELIABILITY_SOURCE_REPLAY_RUN_NOT_FOUND:${runId}`);
  }
  return row;
}

async function replayPredictions(input: {
  runId: number;
  dateFrom: Date;
  dateTo: Date;
  fixtureLimit: number;
}): Promise<ReplayPredictionRow[]> {
  const rows = (await prisma.providerReplayPrediction.findMany({
    where: {
      runId: input.runId,
      horizonMinutes: HISTORICAL_BEST_BET_HORIZON_MINUTES,
      pitSafe: true,
      kickoffAt: { gte: input.dateFrom, lte: input.dateTo },
    },
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
    take: input.fixtureLimit,
    select: {
      id: true,
      runId: true,
      fixtureId: true,
      leagueId: true,
      predictionAsOf: true,
      kickoffAt: true,
      horizonMinutes: true,
      candidateHomeProbability: true,
      candidateDrawProbability: true,
      candidateAwayProbability: true,
      pitSafe: true,
      payloadHash: true,
    },
  })) as ReplayPredictionRow[];

  const byFixture = new Map<number, ReplayPredictionRow>();
  for (const row of rows) {
    if (!byFixture.has(row.fixtureId)) byFixture.set(row.fixtureId, row);
  }
  return [...byFixture.values()];
}

async function loadFixture(fixtureId: number): Promise<FixtureRow | null> {
  return (await prisma.fixture.findUnique({
    where: { id: fixtureId },
    select: {
      id: true,
      apiFixtureId: true,
      leagueId: true,
      kickoffAt: true,
      homeGoals: true,
      awayGoals: true,
    },
  })) as FixtureRow | null;
}

async function decisionOdds(input: {
  providerFixtureId: number;
  decisionAsOf: Date;
  kickoffAt: Date;
  maxOddsAgeMinutes: number;
}): Promise<LiveOddsRow[]> {
  const cutoff = new Date(input.decisionAsOf.getTime() - input.maxOddsAgeMinutes * 60_000);
  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: {
      providerFixtureId: input.providerFixtureId,
      pitUsable: true,
      marketType: 'MATCH_WINNER',
      OR: [
        { sourceUpdatedAt: { gte: cutoff, lte: input.decisionAsOf } },
        { sourceUpdatedAt: null, observedAt: { gte: cutoff, lte: input.decisionAsOf } },
      ],
      kickoffAt: { gt: input.decisionAsOf },
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      providerFixtureId: true,
      sourceUpdatedAt: true,
      observedAt: true,
      bookmakerId: true,
      bookmakerName: true,
      marketType: true,
      selection: true,
      lineValue: true,
      decimalOdds: true,
    },
  })) as LiveOddsRow[];

  return rows.filter((row) => {
    const effective = effectiveOddsTime(row).getTime();
    return (
      row.providerFixtureId === input.providerFixtureId &&
      row.marketType === 'MATCH_WINNER' &&
      row.lineValue == null &&
      effective <= input.decisionAsOf.getTime() &&
      effective >= cutoff.getTime() &&
      input.decisionAsOf.getTime() < input.kickoffAt.getTime()
    );
  });
}

async function closingOdds(input: {
  providerFixtureId: number;
  bookmakerId: number;
  selection: string;
  decisionAsOf: Date;
  kickoffAt: Date;
}): Promise<number | null> {
  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: {
      providerFixtureId: input.providerFixtureId,
      bookmakerId: input.bookmakerId,
      marketType: 'MATCH_WINNER',
      selection: input.selection,
      pitUsable: true,
      OR: [
        { sourceUpdatedAt: { gte: input.decisionAsOf, lt: input.kickoffAt } },
        { sourceUpdatedAt: null, observedAt: { gte: input.decisionAsOf, lt: input.kickoffAt } },
      ],
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      decimalOdds: true,
      sourceUpdatedAt: true,
      observedAt: true,
    },
  })) as ClosingOddsRow[];

  const valid = rows
    .filter((row) => effectiveOddsTime(row).getTime() < input.kickoffAt.getTime())
    .filter((row) => Number.isFinite(row.decimalOdds) && row.decimalOdds > 1)
    .sort(
      (left, right) =>
        effectiveOddsTime(right).getTime() - effectiveOddsTime(left).getTime() ||
        right.observedAt.getTime() - left.observedAt.getTime(),
    );
  return valid[0]?.decimalOdds ?? null;
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function betsCsv(events: HistoricalBenchmarkEventResult[]): string {
  const header = [
    'fixtureId',
    'providerFixtureId',
    'leagueId',
    'decisionAsOf',
    'kickoffAt',
    'selection',
    'bookmakerId',
    'bookmakerName',
    'decimalOdds',
    'modelProbability',
    'fairMarketProbability',
    'edge',
    'expectedValue',
    'settlementResult',
    'stakeUnits',
    'profitUnits',
    'closingOdds',
    'clvPriceRatio',
  ];
  const lines = [header.join(',')];
  for (const event of events) {
    if (event.selectedBet == null) continue;
    const bet = event.selectedBet;
    lines.push(
      [
        event.fixtureId,
        event.providerFixtureId,
        event.leagueId,
        event.decisionAsOf,
        event.kickoffAt,
        bet.selection,
        bet.bookmakerId,
        bet.bookmakerName,
        bet.decimalOdds,
        bet.modelProbability,
        bet.fairMarketProbability,
        bet.edge,
        bet.expectedValue,
        bet.settlementResult,
        bet.stakeUnits,
        bet.profitUnits,
        bet.closingOdds,
        bet.clvPriceRatio,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function writeArtifacts(input: {
  summary: unknown;
  events: HistoricalBenchmarkEventResult[];
  integrity: unknown;
}): Promise<string> {
  const payloadHash = sha256({ summary: input.summary, integrity: input.integrity });
  const relative = path.join('artifacts', 'backtest', 'v7-beta1b2', payloadHash.slice(0, 12));
  const directory = path.join(repoRoot(), relative);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(input.summary, null, 2)}\n`, 'utf8'),
    writeFile(
      path.join(directory, 'decisions.jsonl'),
      `${input.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    ),
    writeFile(path.join(directory, 'bets.csv'), betsCsv(input.events), 'utf8'),
    writeFile(path.join(directory, 'integrity.json'), `${JSON.stringify(input.integrity, null, 2)}\n`, 'utf8'),
  ]);
  return relative.replaceAll('\\', '/');
}

export async function runHistoricalBestBetBenchmark(
  options: HistoricalBenchmarkOptions = {},
): Promise<Record<string, unknown>> {
  const reliabilityReport = await getScientificBestBetReliabilityReport();
  const replayRun = await replayRunById(reliabilityReport.sourceReplay.replayRunId);
  const dateFrom = validDate(options.dateFrom, replayRun.dateFrom);
  const dateTo = validDate(options.dateTo, replayRun.dateTo);
  if (dateFrom.getTime() > dateTo.getTime()) throw new RangeError('dateFrom must not be after dateTo.');

  const maxOddsAgeMinutes = Math.max(1, options.maxOddsAgeMinutes ?? 360);
  const fixtureLimit = finitePositiveInteger(options.fixtureLimit, 5000);
  const matchWinnerReliability = reliabilityReport.reliability.MATCH_WINNER;
  if (matchWinnerReliability == null) {
    throw new Error('MATCH_WINNER_RELIABILITY_REPORT_MISSING');
  }

  const predictions = await replayPredictions({
    runId: replayRun.id,
    dateFrom,
    dateTo,
    fixtureLimit,
  });
  const events: HistoricalBenchmarkEventResult[] = [];
  const skipped = {
    missingFixture: 0,
    missingFinalScore: 0,
    fixtureKickoffMismatch: 0,
  };

  for (const prediction of predictions) {
    const fixture = await loadFixture(prediction.fixtureId);
    if (fixture == null) {
      skipped.missingFixture += 1;
      continue;
    }
    if (fixture.homeGoals == null || fixture.awayGoals == null) {
      skipped.missingFinalScore += 1;
      continue;
    }
    if (Math.abs(fixture.kickoffAt.getTime() - prediction.kickoffAt.getTime()) > 60_000) {
      skipped.fixtureKickoffMismatch += 1;
      continue;
    }

    const oddsRows = await decisionOdds({
      providerFixtureId: fixture.apiFixtureId,
      decisionAsOf: prediction.predictionAsOf,
      kickoffAt: fixture.kickoffAt,
      maxOddsAgeMinutes,
    });
    let event = evaluateHistoricalMatchWinnerEvent({
      fixtureId: fixture.id,
      providerFixtureId: fixture.apiFixtureId,
      leagueId: fixture.leagueId,
      replayPredictionId: prediction.id,
      predictionAsOf: prediction.predictionAsOf,
      kickoffAt: fixture.kickoffAt,
      pitSafePrediction: prediction.pitSafe,
      prediction: {
        HOME: prediction.candidateHomeProbability,
        DRAW: prediction.candidateDrawProbability,
        AWAY: prediction.candidateAwayProbability,
      },
      oddsRows,
      matchWinnerReliabilityStatus: matchWinnerReliability.status,
      matchWinnerReliabilityEligible: matchWinnerReliability.diagnosticEligible,
      homeGoals: fixture.homeGoals,
      awayGoals: fixture.awayGoals,
    });

    if (event.selectedBet != null) {
      const close = await closingOdds({
        providerFixtureId: fixture.apiFixtureId,
        bookmakerId: event.selectedBet.bookmakerId,
        selection: event.selectedBet.selection,
        decisionAsOf: prediction.predictionAsOf,
        kickoffAt: fixture.kickoffAt,
      });
      event = evaluateHistoricalMatchWinnerEvent({
        fixtureId: fixture.id,
        providerFixtureId: fixture.apiFixtureId,
        leagueId: fixture.leagueId,
        replayPredictionId: prediction.id,
        predictionAsOf: prediction.predictionAsOf,
        kickoffAt: fixture.kickoffAt,
        pitSafePrediction: prediction.pitSafe,
        prediction: {
          HOME: prediction.candidateHomeProbability,
          DRAW: prediction.candidateDrawProbability,
          AWAY: prediction.candidateAwayProbability,
        },
        oddsRows,
        matchWinnerReliabilityStatus: matchWinnerReliability.status,
        matchWinnerReliabilityEligible: matchWinnerReliability.diagnosticEligible,
        homeGoals: fixture.homeGoals,
        awayGoals: fixture.awayGoals,
        closingOdds: close,
      });
    }
    events.push(event);
  }

  const metrics = summarizeHistoricalBenchmark(events);
  const integrity = {
    pitViolations: metrics.futureOddsViolations,
    lateIngestionRows: events.reduce((sum, event) => sum + event.integrity.lateIngestionRows, 0),
    providerFixtureMismatches: metrics.providerFixtureMismatches,
    predictionRowsNotPitSafe: predictions.filter((row) => !row.pitSafe).length,
    maximumBetsPerFixtureObserved: events.some((event) => event.selectedBet != null) ? 1 : 0,
    policyMaximumBetsPerFixture: SCIENTIFIC_BEST_BET_POLICY.maximumBetsPerFixture,
    onlyReliabilityEligibleMarketCanBet: events.every(
      (event) => event.selectedBet == null || matchWinnerReliability.diagnosticEligible,
    ),
    decisionUsesClosingOdds: false,
    syntheticOddsUsed: false,
    apiCalled: false,
    paperBetLedgerWritten: false,
    productionRoutingChanged: false,
    realMoneyExecution: false,
    promotional: false,
  };
  const summaryBase = {
    version: HISTORICAL_BEST_BET_BENCHMARK_VERSION,
    evidenceClass: HISTORICAL_BEST_BET_EVIDENCE_CLASS,
    promotional: false,
    policyVersion: SCIENTIFIC_BEST_BET_POLICY_VERSION,
    policy: SCIENTIFIC_BEST_BET_POLICY,
    sourceReplay: {
      runId: replayRun.id,
      providerVersion: replayRun.providerVersion,
      payloadHash: replayRun.payloadHash,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      horizonMinutes: HISTORICAL_BEST_BET_HORIZON_MINUTES,
    },
    reliability: {
      MATCH_WINNER: {
        status: matchWinnerReliability.status,
        eligible: matchWinnerReliability.diagnosticEligible,
        rows: matchWinnerReliability.model.rows,
        relativeBrierSkillVsClimatology: matchWinnerReliability.relativeBrierSkillVsClimatology,
        logLossSkillVsClimatology: matchWinnerReliability.logLossSkillVsClimatology,
        ece: matchWinnerReliability.model.ece,
      },
      blockedMarkets: ['TOTAL_GOALS_1_5', 'TOTAL_GOALS_2_5', 'TOTAL_GOALS_3_5', 'BTTS'],
    },
    coverage: {
      replayPredictionsLoaded: predictions.length,
      evaluatedEvents: events.length,
      skipped,
      maxOddsAgeMinutes,
      fixtureLimit,
      oddsCoveredEvents: metrics.oddsCoveredEvents,
      noOddsCoverage: metrics.noOddsCoverage,
    },
    metrics,
    integrity,
    safety: {
      externalApiCalled: false,
      syntheticOddsUsed: false,
      productionModelChanged: false,
      automaticPromotion: false,
      realMoneyExecution: false,
      paperBetLedgerWritten: false,
    },
    nextStage: 'v7.0-beta.1C-after-beta.1B.2-review',
  };

  const artifactDirectory = options.writeArtifacts === false
    ? null
    : await writeArtifacts({ summary: summaryBase, events, integrity });
  const payloadHash = sha256({ summaryBase, events });

  return {
    ...summaryBase,
    artifactDirectory,
    payloadHash,
  };
}

export async function getHistoricalBestBetBenchmarkCoverage(
  options: HistoricalBenchmarkOptions = {},
): Promise<Record<string, unknown>> {
  return runHistoricalBestBetBenchmark({ ...options, writeArtifacts: false });
}
