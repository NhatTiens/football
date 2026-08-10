import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { prisma } from '@football-ai/database';
import { CALIBRATION_UNCERTAINTY_VERSION } from './calibration-uncertainty-contract.js';
import {
  loadCalibrationRuntime,
  type CalibratedFixturePrediction,
  type CalibratedMarketPrediction,
} from './calibration-uncertainty-engine.js';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';
import {
  MULTI_HORIZON_DECISION_VERSION,
  MULTI_HORIZON_POLICY,
  assessDecisionCandidate,
  buildMultiHorizonDecision,
  consensusFairProbabilities,
  type DecisionCandidate,
  type DecisionOddsQuote,
  type MultiHorizonDecision,
} from './multi-horizon-decision-contract.js';

export type MultiHorizonReadiness =
  | 'READY_FOR_BACKTEST'
  | 'BLOCKED_STAGE5'
  | 'BLOCKED_DECISION_INTEGRITY';

interface OddsDatabaseRow {
  id: number;
  fixtureId: number;
  bookmakerId: number;
  selectionCode: string;
  lineValue: number | null;
  decimalOdds: number;
  capturedAt: Date;
  market: { marketCode: string };
}

interface MarketOddsContext {
  fairProbabilities: Record<string, number>;
  bestQuotes: Map<string, DecisionOddsQuote>;
  completeBookmakers: number;
  oddsSnapshotIds: number[];
}

export interface MultiHorizonRuntimeResult {
  version: string;
  status: MultiHorizonReadiness;
  decisions: MultiHorizonDecision[];
  stage5DatasetFingerprint: string;
  datasetFingerprint: string;
  fixtures: number;
  expectedDecisions: number;
  decisionsRecorded: number;
  bestBets: number;
  noBets: number;
  candidateCount: number;
  eligibleCandidates: number;
  duplicateDecisionKeys: number;
  missingHorizons: number;
  oddsLeakageViolations: number;
  decisionsWithCompleteOdds: number;
  reasonCounts: Record<string, number>;
  configuration: {
    artifactDirectory: string;
    policy: typeof MULTI_HORIZON_POLICY;
  };
}

export interface MultiHorizonArtifactResult {
  directory: string;
  manifestPath: string;
  decisionsPath: string;
  candidatesPath: string;
  hashesPath: string;
  runtime: MultiHorizonRuntimeResult;
}

function repositoryRoot(): string {
  let current = process.cwd();
  while (true) {
    if (
      existsSync(resolve(current, 'package.json')) &&
      existsSync(resolve(current, 'packages/database/prisma/schema.prisma'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Unable to locate repository root.');
    current = parent;
  }
}

function configuration() {
  const root = repositoryRoot();
  return {
    artifactDirectory: resolve(
      root,
      process.env.HYBRID_DECISION_ARTIFACT_DIRECTORY ??
        'artifacts/hybrid/v8-stage6-multi-horizon-decisions',
    ),
    policy: MULTI_HORIZON_POLICY,
  };
}

function supportedOddsMarket(marketKey: string): { marketCode: string; line: number | null } | null {
  if (marketKey === 'HDA') return { marketCode: 'MATCH_WINNER', line: null };
  if (marketKey === 'BTTS') return { marketCode: 'BTTS', line: null };
  if (marketKey.startsWith('TOTAL_GOALS:')) {
    const line = Number(marketKey.slice('TOTAL_GOALS:'.length));
    return Number.isFinite(line) ? { marketCode: 'TOTAL_GOALS_2_5', line } : null;
  }
  return null;
}

function marketSelections(marketKey: string): string[] {
  if (marketKey === 'HDA') return ['HOME', 'DRAW', 'AWAY'];
  if (marketKey === 'BTTS') return ['YES', 'NO'];
  if (marketKey.startsWith('TOTAL_GOALS:')) return ['UNDER', 'OVER'];
  return [];
}

function modelProbability(
  market: CalibratedMarketPrediction,
  selection: string,
): { win: number; push: number } {
  if (selection === 'UNDER') {
    return {
      win: market.calibratedProbability.BELOW ?? 0,
      push: market.calibratedProbability.PUSH ?? 0,
    };
  }
  if (selection === 'OVER') {
    return {
      win: market.calibratedProbability.ABOVE ?? 0,
      push: market.calibratedProbability.PUSH ?? 0,
    };
  }
  return { win: market.calibratedProbability[selection] ?? 0, push: 0 };
}

function latestOddsContext(input: {
  rows: OddsDatabaseRow[];
  marketKey: string;
  decisionAsOf: Date;
}): MarketOddsContext | null {
  const supported = supportedOddsMarket(input.marketKey);
  if (!supported) return null;
  const expectedSelections = marketSelections(input.marketKey);
  const lowerBound = new Date(
    input.decisionAsOf.getTime() - MULTI_HORIZON_POLICY.maximumOddsAgeMinutes * 60_000,
  );
  const latest = new Map<string, OddsDatabaseRow>();
  for (const row of input.rows) {
    if (row.market.marketCode !== supported.marketCode) continue;
    if (supported.line != null && Math.abs((row.lineValue ?? Number.NaN) - supported.line) > 1e-9) {
      continue;
    }
    if (!expectedSelections.includes(row.selectionCode)) continue;
    if (row.capturedAt.getTime() > input.decisionAsOf.getTime()) continue;
    if (row.capturedAt.getTime() < lowerBound.getTime()) continue;
    const key = `${row.bookmakerId}:${row.selectionCode}`;
    const existing = latest.get(key);
    if (!existing || row.capturedAt.getTime() > existing.capturedAt.getTime()) latest.set(key, row);
  }
  const byBookmaker = new Map<number, OddsDatabaseRow[]>();
  for (const row of latest.values()) {
    const rows = byBookmaker.get(row.bookmakerId) ?? [];
    rows.push(row);
    byBookmaker.set(row.bookmakerId, rows);
  }
  const complete = [...byBookmaker.values()].filter(
    (rows) => expectedSelections.every((selection) => rows.some((row) => row.selectionCode === selection)),
  );
  if (complete.length < MULTI_HORIZON_POLICY.minimumCompleteBookmakers) return null;
  const bookmakerQuotes: DecisionOddsQuote[][] = complete.map((rows) =>
    expectedSelections.map((selection) => {
      const row = rows.find((candidate) => candidate.selectionCode === selection)!;
      return {
        oddsSnapshotId: row.id,
        bookmakerId: row.bookmakerId,
        selection,
        decimalOdds: row.decimalOdds,
        capturedAt: row.capturedAt.toISOString(),
      };
    }),
  );
  const bestQuotes = new Map<string, DecisionOddsQuote>();
  for (const quote of bookmakerQuotes.flat()) {
    const existing = bestQuotes.get(quote.selection);
    if (!existing || quote.decimalOdds > existing.decimalOdds) bestQuotes.set(quote.selection, quote);
  }
  return {
    fairProbabilities: consensusFairProbabilities(bookmakerQuotes),
    bestQuotes,
    completeBookmakers: complete.length,
    oddsSnapshotIds: [...new Set(bookmakerQuotes.flat().map((quote) => quote.oddsSnapshotId))],
  };
}

function buildCandidates(input: {
  row: CalibratedFixturePrediction;
  odds: OddsDatabaseRow[];
}): DecisionCandidate[] {
  const decisionAsOf = new Date(input.row.predictionAsOf);
  const candidates: DecisionCandidate[] = [];
  for (const market of input.row.markets) {
    const context = latestOddsContext({ rows: input.odds, marketKey: market.marketKey, decisionAsOf });
    const line = market.marketKey.startsWith('TOTAL_GOALS:')
      ? Number(market.marketKey.slice('TOTAL_GOALS:'.length))
      : null;
    for (const selection of marketSelections(market.marketKey)) {
      const probability = modelProbability(market, selection);
      candidates.push(
        assessDecisionCandidate({
          marketKey: market.marketKey,
          selection,
          line,
          modelProbability: probability.win,
          pushProbability: probability.push,
          fairMarketProbability: context?.fairProbabilities[selection] ?? null,
          quote: context?.bestQuotes.get(selection) ?? null,
          reliability: market.reliability,
          uncertainty: market.uncertainty,
          uncertaintyPenalty: market.uncertaintyPenalty,
        }),
      );
    }
  }
  return candidates;
}

function emptyRuntime(
  status: MultiHorizonReadiness,
  stage5DatasetFingerprint: string,
): MultiHorizonRuntimeResult {
  return {
    version: MULTI_HORIZON_DECISION_VERSION,
    status,
    decisions: [],
    stage5DatasetFingerprint,
    datasetFingerprint: sha256(''),
    fixtures: 0,
    expectedDecisions: 0,
    decisionsRecorded: 0,
    bestBets: 0,
    noBets: 0,
    candidateCount: 0,
    eligibleCandidates: 0,
    duplicateDecisionKeys: 0,
    missingHorizons: 0,
    oddsLeakageViolations: 0,
    decisionsWithCompleteOdds: 0,
    reasonCounts: {},
    configuration: configuration(),
  };
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export async function loadMultiHorizonDecisionRuntime(): Promise<MultiHorizonRuntimeResult> {
  const config = configuration();
  const stage5 = await loadCalibrationRuntime();
  if (stage5.status !== 'READY_FOR_DECISION_ENGINE') {
    return emptyRuntime('BLOCKED_STAGE5', stage5.datasetFingerprint);
  }
  const rows = stage5.rows.filter((row) => row.split === 'TEST');
  const fixtureIds = [...new Set(rows.map((row) => row.fixtureId))];
  const odds = (await prisma.oddsSnapshot.findMany({
    where: {
      fixtureId: { in: fixtureIds },
      isLive: false,
      market: { marketCode: { in: ['MATCH_WINNER', 'TOTAL_GOALS_2_5', 'BTTS'] } },
    },
    select: {
      id: true,
      fixtureId: true,
      bookmakerId: true,
      selectionCode: true,
      lineValue: true,
      decimalOdds: true,
      capturedAt: true,
      market: { select: { marketCode: true } },
    },
    orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
  })) as OddsDatabaseRow[];
  const oddsByFixture = new Map<number, OddsDatabaseRow[]>();
  for (const row of odds) {
    const values = oddsByFixture.get(row.fixtureId) ?? [];
    values.push(row);
    oddsByFixture.set(row.fixtureId, values);
  }
  const decisions = rows
    .map((row) =>
      buildMultiHorizonDecision({
        fixtureId: row.fixtureId,
        decisionAsOf: row.predictionAsOf,
        kickoffAt: row.kickoffAt,
        horizon: row.horizonMinutes,
        candidates: buildCandidates({ row, odds: oddsByFixture.get(row.fixtureId) ?? [] }),
        modelVersion: CALIBRATION_UNCERTAINTY_VERSION,
        stage5RowHash: row.rowHash,
      }),
    )
    .sort(
      (left, right) =>
        new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() ||
        left.fixtureId - right.fixtureId ||
        right.horizon - left.horizon,
    );
  const decisionKeys = decisions.map((row) => `${row.fixtureId}:${row.horizon}:${row.decisionAsOf}`);
  const duplicateDecisionKeys = decisionKeys.length - new Set(decisionKeys).size;
  let missingHorizons = 0;
  for (const fixtureId of fixtureIds) {
    const fixtureHorizons = new Set(
      decisions.filter((row) => row.fixtureId === fixtureId).map((row) => row.horizon),
    );
    missingHorizons += MULTI_HORIZON_POLICY.horizonsMinutes.filter(
      (horizon) => !fixtureHorizons.has(horizon),
    ).length;
  }
  const oddsMap = new Map(odds.map((row) => [row.id, row]));
  let oddsLeakageViolations = 0;
  for (const decision of decisions) {
    const decisionAsOf = new Date(decision.decisionAsOf).getTime();
    for (const candidate of decision.candidateMarkets) {
      if (candidate.oddsSnapshotId == null) continue;
      if ((oddsMap.get(candidate.oddsSnapshotId)?.capturedAt.getTime() ?? Number.POSITIVE_INFINITY) > decisionAsOf) {
        oddsLeakageViolations += 1;
      }
    }
  }
  const reasonCounts: Record<string, number> = {};
  for (const reason of decisions.flatMap((decision) =>
    decision.candidateMarkets.flatMap((candidate) => candidate.reasonCodes),
  )) {
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  const datasetFingerprint = sha256(
    stableStringify({
      stage5: stage5.datasetFingerprint,
      decisions: decisions.map((row) => row.decisionId),
    }),
  );
  const expectedDecisions = fixtureIds.length * MULTI_HORIZON_POLICY.horizonsMinutes.length;
  const status: MultiHorizonReadiness =
    decisions.length === expectedDecisions &&
    duplicateDecisionKeys === 0 &&
    missingHorizons === 0 &&
    oddsLeakageViolations === 0
      ? 'READY_FOR_BACKTEST'
      : 'BLOCKED_DECISION_INTEGRITY';
  return {
    version: MULTI_HORIZON_DECISION_VERSION,
    status,
    decisions,
    stage5DatasetFingerprint: stage5.datasetFingerprint,
    datasetFingerprint,
    fixtures: fixtureIds.length,
    expectedDecisions,
    decisionsRecorded: decisions.length,
    bestBets: decisions.filter((row) => row.decision === 'BEST_BET').length,
    noBets: decisions.filter((row) => row.decision === 'NO_BET').length,
    candidateCount: decisions.reduce((sum, row) => sum + row.candidateMarkets.length, 0),
    eligibleCandidates: decisions.reduce(
      (sum, row) => sum + row.candidateMarkets.filter((candidate) => candidate.eligible).length,
      0,
    ),
    duplicateDecisionKeys,
    missingHorizons,
    oddsLeakageViolations,
    decisionsWithCompleteOdds: decisions.filter((row) =>
      row.candidateMarkets.some((candidate) => candidate.fairMarketProbability != null),
    ).length,
    reasonCounts,
    configuration: config,
  };
}

export function multiHorizonDecisionSummary(
  runtime: MultiHorizonRuntimeResult,
): Record<string, unknown> {
  return {
    version: runtime.version,
    status: runtime.status,
    fixtures: runtime.fixtures,
    expectedDecisions: runtime.expectedDecisions,
    decisionsRecorded: runtime.decisionsRecorded,
    bestBets: runtime.bestBets,
    noBets: runtime.noBets,
    candidateCount: runtime.candidateCount,
    eligibleCandidates: runtime.eligibleCandidates,
    decisionsWithCompleteOdds: runtime.decisionsWithCompleteOdds,
    duplicateDecisionKeys: runtime.duplicateDecisionKeys,
    missingHorizons: runtime.missingHorizons,
    oddsLeakageViolations: runtime.oddsLeakageViolations,
    reasonCounts: runtime.reasonCounts,
    stage5DatasetFingerprint: runtime.stage5DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    configuration: runtime.configuration,
    appendOnly: true,
    pointInTime: true,
    paperOnly: true,
    riskOverlayApplied: false,
    apiCalled: false,
    schemaChanged: false,
    currentChampionChanged: false,
  };
}

export async function writeMultiHorizonDecisionArtifacts(): Promise<MultiHorizonArtifactResult> {
  const runtime = await loadMultiHorizonDecisionRuntime();
  if (runtime.status !== 'READY_FOR_BACKTEST') {
    throw new Error(`Stage 6 artifact export blocked: ${runtime.status}.`);
  }
  const root = repositoryRoot();
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });
  const decisionsContent = runtime.decisions.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const decisionsPath = resolve(directory, 'decisions.jsonl');
  writeFileSync(decisionsPath, decisionsContent, 'utf8');
  const candidatesContent =
    runtime.decisions
      .flatMap((decision) =>
        decision.candidateMarkets.map((candidate) => ({
          decisionId: decision.decisionId,
          fixtureId: decision.fixtureId,
          decisionAsOf: decision.decisionAsOf,
          horizon: decision.horizon,
          candidate,
        })),
      )
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n';
  const candidatesPath = resolve(directory, 'candidates.jsonl');
  writeFileSync(candidatesPath, candidatesContent, 'utf8');
  const manifest = {
    version: runtime.version,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.status,
    stage5DatasetFingerprint: runtime.stage5DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    summary: multiHorizonDecisionSummary(runtime),
    configuration: {
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
      policy: runtime.configuration.policy,
    },
    files: { decisions: 'decisions.jsonl', candidates: 'candidates.jsonl', hashes: 'sha256.json' },
    safety: {
      appendOnly: true,
      pointInTime: true,
      paperOnly: true,
      riskOverlayApplied: false,
      apiCalled: false,
      schemaChanged: false,
      currentChampionChanged: false,
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  const manifestPath = resolve(directory, 'manifest.json');
  writeFileSync(manifestPath, manifestContent, 'utf8');
  const hashes = {
    'manifest.json': sha256(manifestContent),
    'decisions.jsonl': sha256(decisionsContent),
    'candidates.jsonl': sha256(candidatesContent),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  return { directory, manifestPath, decisionsPath, candidatesPath, hashesPath, runtime };
}
