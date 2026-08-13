import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { prisma } from '@football-ai/database';
import { sha256 } from './hybrid-data-foundation-contract.js';
import { V8_PAPER_RUNTIME_VERSION } from './v8-paper-runtime-engine.js';
import { getV8LiveDataReadiness } from './v8-live-data-readiness.js';
import {
  evaluateV8ShadowReleaseGate,
  V8_SHADOW_RELEASE_GATE_VERSION,
  V8_SHADOW_RELEASE_THRESHOLDS,
  type V8ReleaseBacktestEvidence,
  type V8ReleaseGateEvidence,
  type V8ReleasePaperEvidence,
} from './v8-shadow-release-gate-contract.js';

type JsonRecord = Record<string, unknown>;

interface Stage7ArtifactEvidence extends V8ReleaseBacktestEvidence {
  manifestPath: string | null;
  manifestSha256: string | null;
  datasetFingerprint: string | null;
}

interface V8PaperDecisionRow {
  providerFixtureId: number;
  horizonMinutes: number;
  decisionAsOf: Date;
  kickoffAt: Date;
  decisionType: string;
  sourceOddsUpdatedAt: Date | null;
  sourceOddsObservedAt: Date | null;
  modelProbability: number | null;
  settlement: {
    settledAt: Date;
    result: string;
    stakeUnits: number;
    profitUnits: number;
    clv: number | null;
  } | null;
}

function record(value: unknown): JsonRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((row): row is string => typeof row === 'string') : [];
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

function gitTagPresent(root: string, tag: string): boolean {
  try {
    return (
      execFileSync('git', ['tag', '--list', tag], { cwd: root, encoding: 'utf8' }).trim() === tag
    );
  } catch {
    return false;
  }
}

function latestStage7Manifest(root: string): string | null {
  const directory = resolve(
    root,
    process.env.HYBRID_BACKTEST_ARTIFACT_DIRECTORY ??
      'artifacts/hybrid/v8-stage7-champion-challenger',
  );
  if (!existsSync(directory)) return null;
  return (
    readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(resolve(directory, entry.name, 'manifest.json')),
      )
      .map((entry) => resolve(directory, entry.name, 'manifest.json'))
      .sort((left, right) => right.localeCompare(left))[0] ?? null
  );
}

function emptyBacktestEvidence(): Stage7ArtifactEvidence {
  return {
    artifactPresent: false,
    artifactHashVerified: false,
    manifestPath: null,
    manifestSha256: null,
    datasetFingerprint: null,
    status: null,
    promotionEligible: false,
    championEce: null,
    challengerEce: null,
    championRoi: null,
    challengerRoi: null,
    gateReasons: ['STAGE7_ARTIFACT_MISSING'],
  };
}

function loadStage7ArtifactEvidence(root: string): Stage7ArtifactEvidence {
  const manifestPath = latestStage7Manifest(root);
  if (!manifestPath) return emptyBacktestEvidence();
  try {
    const manifestContent = readFileSync(manifestPath, 'utf8');
    const manifest = record(JSON.parse(manifestContent));
    const hashesPath = resolve(dirname(manifestPath), 'sha256.json');
    const hashes = existsSync(hashesPath)
      ? record(JSON.parse(readFileSync(hashesPath, 'utf8')))
      : null;
    const summary = record(manifest?.summary);
    const models = record(summary?.models);
    const champion = record(models?.V7_5_DIXON_CHAMPION);
    const challenger = record(models?.V8_HYBRID);
    const championPerformance = record(champion?.performance);
    const challengerPerformance = record(challenger?.performance);
    const championCalibration = record(champion?.calibration);
    const challengerCalibration = record(challenger?.calibration);
    const championGate = record(summary?.championGate);
    const actualHash = sha256(manifestContent);
    return {
      artifactPresent: true,
      artifactHashVerified: hashes?.['manifest.json'] === actualHash,
      manifestPath: relative(root, manifestPath).replaceAll('\\', '/'),
      manifestSha256: actualHash,
      datasetFingerprint:
        typeof manifest?.datasetFingerprint === 'string' ? manifest.datasetFingerprint : null,
      status: typeof manifest?.status === 'string' ? manifest.status : null,
      promotionEligible: championGate?.promotionEligible === true,
      championEce: finite(championCalibration?.ece),
      challengerEce: finite(challengerCalibration?.ece),
      championRoi: finite(championPerformance?.roi),
      challengerRoi: finite(challengerPerformance?.roi),
      gateReasons: strings(championGate?.reasons),
    };
  } catch (error) {
    return {
      ...emptyBacktestEvidence(),
      artifactPresent: true,
      manifestPath: relative(root, manifestPath).replaceAll('\\', '/'),
      gateReasons: [
        `STAGE7_ARTIFACT_READ_ERROR:${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

function maximumDrawdown(profits: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function binaryEce(
  rows: Array<{ probability: number; outcome: number }>,
  bins = 10,
): number | null {
  if (!rows.length) return null;
  let ece = 0;
  for (let index = 0; index < bins; index += 1) {
    const low = index / bins;
    const high = (index + 1) / bins;
    const bucket = rows.filter(
      (row) =>
        row.probability >= low &&
        (index === bins - 1 ? row.probability <= high : row.probability < high),
    );
    if (!bucket.length) continue;
    const confidence = bucket.reduce((sum, row) => sum + row.probability, 0) / bucket.length;
    const accuracy = bucket.reduce((sum, row) => sum + row.outcome, 0) / bucket.length;
    ece += (bucket.length / rows.length) * Math.abs(accuracy - confidence);
  }
  return ece;
}

async function loadPaperEvidence(now: Date): Promise<V8ReleasePaperEvidence> {
  const decisions = (await prisma.scientificPaperBetDecision.findMany({
    where: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION } },
    select: {
      providerFixtureId: true,
      horizonMinutes: true,
      decisionAsOf: true,
      kickoffAt: true,
      decisionType: true,
      sourceOddsUpdatedAt: true,
      sourceOddsObservedAt: true,
      modelProbability: true,
      settlement: {
        select: {
          settledAt: true,
          result: true,
          stakeUnits: true,
          profitUnits: true,
          clv: true,
        },
      },
    },
    orderBy: [{ decisionAsOf: 'asc' }, { id: 'asc' }],
  })) as V8PaperDecisionRow[];
  const bestBets = decisions.filter((row) => row.decisionType === 'BEST_BET');
  const settled = bestBets
    .filter((row) => row.settlement != null)
    .sort(
      (left, right) => left.settlement!.settledAt.getTime() - right.settlement!.settledAt.getTime(),
    );
  const semanticCounts = new Map<string, number>();
  for (const decision of decisions) {
    const key = `${decision.providerFixtureId}:${decision.horizonMinutes}`;
    semanticCounts.set(key, (semanticCounts.get(key) ?? 0) + 1);
  }
  const duplicateSemanticDecisions = [...semanticCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const sourceOddsAfterDecisionViolations = decisions.filter(
    (row) =>
      (row.sourceOddsObservedAt != null && row.sourceOddsObservedAt > row.decisionAsOf) ||
      (row.sourceOddsUpdatedAt != null && row.sourceOddsUpdatedAt > row.decisionAsOf),
  ).length;
  const maturedCutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const maturedBestBetsMissingSettlement = bestBets.filter(
    (row) => row.kickoffAt <= maturedCutoff && row.settlement == null,
  ).length;
  const firstDecisionAt = decisions[0]?.decisionAsOf ?? null;
  const observationSpanDays = firstDecisionAt
    ? (now.getTime() - firstDecisionAt.getTime()) / (24 * 60 * 60_000)
    : 0;
  const activeDecisionDays = new Set(
    decisions.map((row) => row.decisionAsOf.toISOString().slice(0, 10)),
  ).size;
  const stake = settled.reduce((sum, row) => sum + row.settlement!.stakeUnits, 0);
  const profit = settled.reduce((sum, row) => sum + row.settlement!.profitUnits, 0);
  const clvRows = settled
    .map((row) => row.settlement!.clv)
    .filter((value): value is number => value != null);
  const calibrationRows = settled
    .filter(
      (row) =>
        row.modelProbability != null &&
        (row.settlement!.result === 'WIN' || row.settlement!.result === 'LOSS'),
    )
    .map((row) => ({
      probability: row.modelProbability!,
      outcome: row.settlement!.result === 'WIN' ? 1 : 0,
    }));
  return {
    decisions: decisions.length,
    bestBets: bestBets.length,
    noBets: decisions.length - bestBets.length,
    settledBestBets: settled.length,
    activeDecisionDays,
    observationSpanDays,
    duplicateSemanticDecisions,
    sourceOddsAfterDecisionViolations,
    maturedBestBetsMissingSettlement,
    roi: stake > 0 ? profit / stake : null,
    meanClv: clvRows.length
      ? clvRows.reduce((sum, value) => sum + value, 0) / clvRows.length
      : null,
    ece: binaryEce(calibrationRows),
    maximumDrawdownUnits: settled.length
      ? maximumDrawdown(settled.map((row) => row.settlement!.profitUnits))
      : null,
  };
}

export async function getV8ShadowReleaseGate(now = new Date()) {
  const root = repositoryRoot();
  const [paper, liveData] = await Promise.all([
    loadPaperEvidence(now),
    getV8LiveDataReadiness(now),
  ]);
  const backtest = loadStage7ArtifactEvidence(root);
  const evidence: V8ReleaseGateEvidence = {
    baseline: {
      championTagPresent: gitTagPresent(root, 'v7.5-current-champion'),
      stage1TagPresent: gitTagPresent(root, 'v8.0-stage1-pit-foundation'),
      currentChampionChanged: false,
    },
    backtest,
    paper,
    liveData: {
      status: liveData.status,
      blockers: liveData.blockers,
    },
    policy: {
      // v7 and v8 now both evaluate the model-selected O/U line directly. Keep
      // promotion blocked until fresh comparison evidence is produced under the
      // new v7 runtime version.
      ouPolicyParityCertified: false,
      reason: 'DIRECT_LINE_POLICY_CHANGED_REQUIRES_FRESH_COMPARISON',
    },
  };
  const decision = evaluateV8ShadowReleaseGate(evidence);
  return {
    generatedAt: now.toISOString(),
    ...decision,
    thresholds: V8_SHADOW_RELEASE_THRESHOLDS,
    evidence,
    safety: {
      auditOnly: true,
      appendOnly: true,
      pointInTime: true,
      paperOnly: true,
      externalApiCalled: false,
      databaseWritten: false,
      schemaChanged: false,
      automaticPromotion: false,
      currentChampionChanged: false,
      tagCreated: false,
    },
  };
}
