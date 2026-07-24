import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { prisma, type InputJsonValue } from '@football-ai/database';

import { ML_MARKET_FEATURE_CONTRACT_HASH } from './ml-market-contract.js';
import { deterministicHash } from './scientific-evaluation-contract.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';
import {
  SCIENTIFIC_DEVELOPMENT_POLICY_VERSION,
  SCIENTIFIC_DIAGNOSTIC_VERSION,
} from './scientific-diagnostic-contract.js';

interface SourceEvaluationRun {
  id: number;
  candidateVersion: string;
  baselineVersion: string;
  featureContractHash: string;
  artifactDirectory: string;
  status: string;
  promotionStatus: string;
}

interface SourceOofRow {
  fixtureId: number;
  leagueId: number;
  predictionAsOf: string;
  kickoffAt: string;
  labelAvailableAt?: string;
  horizonMinutes: number;
  foldNumber: number;
  splitRole: string;
  trainedThrough: string;
  labels: {
    matchWinner: number;
    over25: number;
    btts: number;
  };
  baseline: number[];
  dixonColes: number[];
  market: number[] | null;
  catBoost: number[];
  residualMarket: number[] | null;
  stacked: number[];
  calibrated: number[];
  decisionOdds: unknown;
  closingOdds: unknown;
  marketQuality?: number;
  featureContractHash: string;
  featurePayloadHash: string;
  baselinePayloadHash?: string;
  [key: string]: unknown;
}

interface SourceFeatureRow {
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  labelAvailableAt: Date;
  marketAvailable: boolean;
  featureNames: unknown;
  featureVector: unknown;
  featureContractHash: string;
  payloadHash: string;
}

interface PythonDiagnosticMetadata {
  diagnosticVersion: string;
  developmentPolicyVersion: string;
  version: string;
  sourceEvaluationRunId: number;
  sourceFeatureContractHash: string;
  datasetFingerprint: string;
  artifactDirectory: string;
  artifactSha256: Record<string, string>;
  rows: number;
  fixtures: number;
  developmentRows: number;
  evaluationRows: number;
  leakageViolations: number;
  developmentCandidateCount: number;
  diagnosticSummary: Record<string, unknown>;
  configuration: Record<string, unknown>;
  paths: {
    developmentCandidates: string;
    [key: string]: string;
  };
  metadataPath: string;
  apiCalled: boolean;
  productionModelChanged: boolean;
  automaticPromotion: boolean;
}

interface PythonDevelopmentSelection {
  horizonMinutes: number;
  marketBranch: string;
  status: string;
  fixtures?: number;
  fitFixtures?: number;
  calibrationFixtures?: number;
  validationFixtures?: number;
  baselineValidationMetrics?: Record<string, unknown>;
  selected?: {
    experimentId?: string;
    method?: string;
    sources?: string[];
    weights?: Record<string, number>;
    temperature?: number;
    maximumProbabilityShift?: number;
    fitMetrics?: Record<string, unknown>;
    calibration?: Record<string, unknown>;
    validationMetrics?: Record<string, unknown>;
    baselineValidationMetrics?: Record<string, unknown>;
    gates?: Record<string, boolean>;
    deltas?: Record<string, number | null>;
    evaluationHoldoutUsedForSelection?: boolean;
  } | null;
  evaluationHoldoutUsedForSelection?: boolean;
}

interface PythonDevelopmentReport {
  policyVersion: string;
  evaluationHoldoutUsedForSelection: boolean;
  selectedDevelopmentCandidates: number;
  results: PythonDevelopmentSelection[];
  [key: string]: unknown;
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
    process.env.SCIENTIFIC_DIAGNOSTIC_ARTIFACT_DIRECTORY ?? 'artifacts/diagnostics/v7-alpha71',
  );
}

function pythonScriptPath(): string {
  return resolve(repositoryRoot(), 'scripts/ml/scientific_diagnostic_improvement.py');
}

function pythonExecutable(): string {
  const configured = process.env.ML_PYTHON_EXECUTABLE;

  if (configured?.trim()) {
    return resolve(repositoryRoot(), configured.trim());
  }

  const candidates =
    process.platform === 'win32'
      ? [
          resolve(repositoryRoot(), '.venv-alpha6/Scripts/python.exe'),
          resolve(repositoryRoot(), '.venv-alpha7/Scripts/python.exe'),
          'python',
          'py',
        ]
      : [
          resolve(repositoryRoot(), '.venv-alpha6/bin/python'),
          resolve(repositoryRoot(), '.venv-alpha7/bin/python'),
          'python3',
          'python',
        ];

  return (
    candidates.find(
      (candidate) =>
        candidate === 'python' ||
        candidate === 'python3' ||
        candidate === 'py' ||
        existsSync(candidate),
    ) ?? 'python'
  );
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index] ?? '') as Record<string, unknown>;
    } catch {
      // Ignore Python informational output before the final JSON line.
    }
  }

  throw new Error(`Python did not return a JSON result.\n${stdout}`);
}

function runPython(args: string[]): Record<string, unknown> {
  const executable = pythonExecutable();
  const executableName = executable.toLowerCase();
  const commandArgs =
    executableName.endsWith('py') || executableName.endsWith('py.exe')
      ? ['-3', pythonScriptPath(), ...args]
      : [pythonScriptPath(), ...args];
  const result = spawnSync(executable, commandArgs, {
    cwd: repositoryRoot(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONUTF8: '1',
    },
    maxBuffer: 128 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Python diagnostic failed with exit code ${String(result.status)}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return parseLastJsonLine(result.stdout ?? '');
}

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) {
    throw new Error(`Artifact file does not exist: ${path}`);
  }

  return readFileSync(path, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as T);
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array.`);
  }

  return value as string[];
}

function asNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const result = value.map((entry) => Number(entry));

  if (result.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} contains a non-finite number.`);
  }

  return result;
}

function chunk<T>(rows: T[], size = 250): T[][] {
  const output: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }

  return output;
}

async function latestSuccessfulEvaluation(): Promise<SourceEvaluationRun> {
  const run = await prisma.scientificEvaluationRun.findFirst({
    where: {
      status: 'SUCCESS',
    },
    orderBy: {
      startedAt: 'desc',
    },
    select: {
      id: true,
      candidateVersion: true,
      baselineVersion: true,
      featureContractHash: true,
      artifactDirectory: true,
      status: true,
      promotionStatus: true,
    },
  });

  if (!run) {
    throw new Error('No successful alpha.7 ScientificEvaluationRun exists.');
  }

  if (run.featureContractHash !== ML_MARKET_FEATURE_CONTRACT_HASH) {
    throw new Error('Latest alpha.7 run uses a different ML feature contract.');
  }

  return run as SourceEvaluationRun;
}

function sourceOofPath(run: SourceEvaluationRun): string {
  return resolve(repositoryRoot(), run.artifactDirectory, 'oof_predictions.jsonl');
}

async function exportDiagnosticInput(run: SourceEvaluationRun): Promise<{
  path: string;
  rows: number;
  fixtures: number;
}> {
  const oofRows = readJsonLines<SourceOofRow>(sourceOofPath(run));

  if (oofRows.length === 0) {
    throw new Error('The alpha.7 OOF artifact is empty.');
  }

  const payloadHashes = [...new Set(oofRows.map((row) => row.featurePayloadHash))];
  const features = (await prisma.mlFeatureSnapshot.findMany({
    where: {
      payloadHash: {
        in: payloadHashes,
      },
      featureContractHash: run.featureContractHash,
    },
    select: {
      fixtureId: true,
      horizonMinutes: true,
      predictionAsOf: true,
      labelAvailableAt: true,
      marketAvailable: true,
      featureNames: true,
      featureVector: true,
      featureContractHash: true,
      payloadHash: true,
    },
  })) as SourceFeatureRow[];
  const featureMap = new Map(features.map((feature) => [feature.payloadHash, feature]));

  const missing = oofRows.filter((row) => !featureMap.has(row.featurePayloadHash));

  if (missing.length > 0) {
    throw new Error(`${missing.length} OOF rows have no matching MlFeatureSnapshot.`);
  }

  const outputRows = oofRows.map((row) => {
    const feature = featureMap.get(row.featurePayloadHash)!;
    const featureNames = asStringArray(feature.featureNames, 'featureNames');
    const featureVector = asNumberArray(feature.featureVector, 'featureVector');

    if (featureNames.length !== featureVector.length) {
      throw new Error(`Feature width mismatch for ${row.featurePayloadHash}.`);
    }

    if (feature.fixtureId !== row.fixtureId || feature.horizonMinutes !== row.horizonMinutes) {
      throw new Error(`Feature identity mismatch for ${row.featurePayloadHash}.`);
    }

    return {
      ...row,
      sourceEvaluationRunId: run.id,
      sourceCandidateVersion: run.candidateVersion,
      sourceBaselineVersion: run.baselineVersion,
      sourcePromotionStatus: run.promotionStatus,
      labelAvailableAt: feature.labelAvailableAt.toISOString(),
      featureNames,
      featureVector,
      featureContractHash: feature.featureContractHash,
      databaseMarketAvailable: feature.marketAvailable,
    };
  });

  const outputPath = resolve(artifactRoot(), `source-run-${run.id}`, 'diagnostic_input.jsonl');
  mkdirSync(dirname(outputPath), {
    recursive: true,
  });
  writeFileSync(outputPath, outputRows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

  return {
    path: outputPath,
    rows: outputRows.length,
    fixtures: new Set(outputRows.map((row) => row.fixtureId)).size,
  };
}

function selectedDevelopmentRows(path: string): PythonDevelopmentReport {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as PythonDevelopmentReport;

  if (
    parsed.evaluationHoldoutUsedForSelection !== false ||
    parsed.policyVersion !== SCIENTIFIC_DEVELOPMENT_POLICY_VERSION
  ) {
    throw new Error('Python development report violated the alpha.7.1 selection boundary.');
  }

  return parsed;
}

export async function runScientificDiagnosticImprovement(): Promise<SyncSummary> {
  return runTrackedSync('scientific-diagnostic-run', async () => {
    const sourceRun = await latestSuccessfulEvaluation();
    const input = await exportDiagnosticInput(sourceRun);
    const outputRoot = artifactRoot();
    mkdirSync(outputRoot, {
      recursive: true,
    });

    const result = runPython([
      'diagnose',
      '--input',
      input.path,
      '--output-dir',
      outputRoot,
      '--minimum-branch-fixtures',
      String(Math.floor(envNumber('SCIENTIFIC_DIAGNOSTIC_MIN_BRANCH_FIXTURES', 36))),
      '--minimum-validation-fixtures',
      String(Math.floor(envNumber('SCIENTIFIC_DIAGNOSTIC_MIN_VALIDATION_FIXTURES', 12))),
      '--blend-step',
      String(envNumber('SCIENTIFIC_DIAGNOSTIC_BLEND_STEP', 0.05)),
      '--minimum-baseline-weight',
      String(envNumber('SCIENTIFIC_DIAGNOSTIC_MIN_BASELINE_WEIGHT', 0.5)),
      '--maximum-probability-shift',
      String(envNumber('SCIENTIFIC_DIAGNOSTIC_MAX_PROBABILITY_SHIFT', 0.08)),
      '--minimum-brier-improvement',
      String(envNumber('SCIENTIFIC_DIAGNOSTIC_MIN_BRIER_IMPROVEMENT', 0.002)),
      '--maximum-logloss-regression',
      String(envNumber('SCIENTIFIC_DIAGNOSTIC_MAX_LOGLOSS_REGRESSION', 0.005)),
      '--maximum-ece-regression',
      String(envNumber('SCIENTIFIC_DIAGNOSTIC_MAX_ECE_REGRESSION', 0.02)),
    ]) as unknown as PythonDiagnosticMetadata;

    if (
      result.diagnosticVersion !== SCIENTIFIC_DIAGNOSTIC_VERSION ||
      result.developmentPolicyVersion !== SCIENTIFIC_DEVELOPMENT_POLICY_VERSION ||
      result.sourceEvaluationRunId !== sourceRun.id ||
      result.sourceFeatureContractHash !== sourceRun.featureContractHash ||
      result.leakageViolations !== 0 ||
      result.apiCalled ||
      result.productionModelChanged ||
      result.automaticPromotion
    ) {
      throw new Error('Python returned an incompatible or unsafe diagnostic artifact.');
    }

    const artifactDirectory = relative(
      repositoryRoot(),
      resolve(result.artifactDirectory),
    ).replaceAll('\\', '/');
    const diagnosticRun = await prisma.scientificDiagnosticRun.create({
      data: {
        sourceEvaluationRunId: sourceRun.id,
        diagnosticVersion: result.diagnosticVersion,
        developmentPolicyVersion: result.developmentPolicyVersion,
        status: 'RUNNING',
        sourceCandidateVersion: sourceRun.candidateVersion,
        baselineVersion: sourceRun.baselineVersion,
        featureContractHash: sourceRun.featureContractHash,
        artifactDirectory,
        artifactSha256: jsonValue(result.artifactSha256),
        rows: result.rows,
        fixtures: result.fixtures,
        developmentRows: result.developmentRows,
        evaluationRows: result.evaluationRows,
        leakageViolations: result.leakageViolations,
        developmentCandidateCount: result.developmentCandidateCount,
        diagnosticSummary: jsonValue(result.diagnosticSummary),
        configuration: jsonValue(result.configuration),
      },
      select: {
        id: true,
      },
    });

    try {
      const development = selectedDevelopmentRows(resolve(result.paths.developmentCandidates));
      const writes = development.results.map((selection) => {
        const selected = selection.selected ?? null;
        const sourcePayload = {
          diagnosticRunId: diagnosticRun.id,
          sourceEvaluationRunId: sourceRun.id,
          horizonMinutes: selection.horizonMinutes,
          marketBranch: selection.marketBranch,
          status: selection.status,
          selected,
          evaluationHoldoutUsed: selection.evaluationHoldoutUsedForSelection ?? false,
        };
        const payloadHash = deterministicHash('SCIENTIFIC_DEVELOPMENT_CANDIDATE', sourcePayload);

        return {
          diagnosticRunId: diagnosticRun.id,
          horizonMinutes: selection.horizonMinutes,
          marketBranch: selection.marketBranch,
          status: selection.status,
          method: selected?.method ?? 'NONE',
          experimentId: selected?.experimentId ?? null,
          sources: jsonValue(selected?.sources ?? []),
          weights: jsonValue(selected?.weights ?? {}),
          temperature: selected?.temperature ?? null,
          maximumProbabilityShift: selected?.maximumProbabilityShift ?? null,
          fitFixtures: selection.fitFixtures ?? 0,
          calibrationFixtures: selection.calibrationFixtures ?? 0,
          validationFixtures: selection.validationFixtures ?? 0,
          fitMetrics: jsonValue(selected?.fitMetrics ?? {}),
          calibrationMetrics: jsonValue(selected?.calibration ?? {}),
          validationMetrics: jsonValue(selected?.validationMetrics ?? {}),
          baselineValidationMetrics: jsonValue(
            selected?.baselineValidationMetrics ?? selection.baselineValidationMetrics ?? {},
          ),
          gates: jsonValue(selected?.gates ?? {}),
          deltas: jsonValue(selected?.deltas ?? {}),
          evaluationHoldoutUsed: selection.evaluationHoldoutUsedForSelection ?? false,
          payloadHash,
        };
      });

      for (const rows of chunk(writes)) {
        await prisma.scientificDevelopmentCandidate.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }

      await prisma.scientificDiagnosticRun.update({
        where: {
          id: diagnosticRun.id,
        },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
        },
      });

      return {
        processed: result.rows,
        inserted: writes.length + 1,
        updated: 1,
        metadata: jsonValue({
          diagnosticRunId: diagnosticRun.id,
          sourceEvaluationRunId: sourceRun.id,
          sourceCandidateVersion: sourceRun.candidateVersion,
          sourcePromotionStatus: sourceRun.promotionStatus,
          rows: result.rows,
          fixtures: result.fixtures,
          developmentRows: result.developmentRows,
          excludedOpenedEvaluationRows: result.evaluationRows,
          developmentCandidateCount: result.developmentCandidateCount,
          leakageViolations: result.leakageViolations,
          artifactDirectory,
          evaluationHoldoutUsedForSelection: false,
          apiCalled: false,
          productionModelChanged: false,
          automaticPromotion: false,
        }),
      };
    } catch (error) {
      await prisma.scientificDiagnosticRun.update({
        where: {
          id: diagnosticRun.id,
        },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  });
}

export async function getScientificDiagnosticCoverage(): Promise<{
  diagnosticRuns: number;
  successfulRuns: number;
  failedRuns: number;
  developmentCandidates: number;
  safeDevelopmentCandidates: number;
  evaluationHoldoutUseViolations: number;
  leakageViolations: number;
  byHorizon: Array<{
    horizonMinutes: number;
    candidates: number;
    safeCandidates: number;
  }>;
  latestRun: unknown;
}> {
  const [
    diagnosticRuns,
    successfulRuns,
    failedRuns,
    developmentCandidates,
    safeDevelopmentCandidates,
    evaluationHoldoutUseViolations,
    runLeakage,
    groups,
    latestRun,
  ] = await Promise.all([
    prisma.scientificDiagnosticRun.count(),
    prisma.scientificDiagnosticRun.count({
      where: {
        status: 'SUCCESS',
      },
    }),
    prisma.scientificDiagnosticRun.count({
      where: {
        status: 'FAILED',
      },
    }),
    prisma.scientificDevelopmentCandidate.count(),
    prisma.scientificDevelopmentCandidate.count({
      where: {
        status: 'DEVELOPMENT_CANDIDATE',
      },
    }),
    prisma.scientificDevelopmentCandidate.count({
      where: {
        evaluationHoldoutUsed: true,
      },
    }),
    prisma.scientificDiagnosticRun.aggregate({
      _sum: {
        leakageViolations: true,
      },
    }),
    prisma.scientificDevelopmentCandidate.groupBy({
      by: ['horizonMinutes', 'status'],
      _count: {
        _all: true,
      },
      orderBy: {
        horizonMinutes: 'desc',
      },
    }),
    prisma.scientificDiagnosticRun.findFirst({
      orderBy: {
        startedAt: 'desc',
      },
    }),
  ]);
  const horizonMap = new Map<
    number,
    {
      candidates: number;
      safeCandidates: number;
    }
  >();

  for (const row of groups) {
    const current = horizonMap.get(row.horizonMinutes) ?? {
      candidates: 0,
      safeCandidates: 0,
    };
    current.candidates += row._count._all;

    if (row.status === 'DEVELOPMENT_CANDIDATE') {
      current.safeCandidates += row._count._all;
    }

    horizonMap.set(row.horizonMinutes, current);
  }

  return {
    diagnosticRuns,
    successfulRuns,
    failedRuns,
    developmentCandidates,
    safeDevelopmentCandidates,
    evaluationHoldoutUseViolations,
    leakageViolations: runLeakage._sum.leakageViolations ?? 0,
    byHorizon: [...horizonMap.entries()]
      .sort(([left], [right]) => right - left)
      .map(([horizonMinutes, value]) => ({
        horizonMinutes,
        ...value,
      })),
    latestRun,
  };
}

export async function getScientificDevelopmentReport(): Promise<{
  run: unknown;
  candidates: unknown[];
} | null> {
  const run = await prisma.scientificDiagnosticRun.findFirst({
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

  const candidates = await prisma.scientificDevelopmentCandidate.findMany({
    where: {
      diagnosticRunId: run.id,
    },
    orderBy: [
      {
        horizonMinutes: 'desc',
      },
      {
        marketBranch: 'asc',
      },
    ],
  });

  return {
    run,
    candidates,
  };
}
