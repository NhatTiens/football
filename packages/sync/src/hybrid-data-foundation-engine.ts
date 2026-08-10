import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { prisma } from '@football-ai/database';
import { ML_MARKET_FEATURE_CONTRACT_HASH } from './ml-market-contract.js';
import {
  HYBRID_DATA_FOUNDATION_VERSION,
  HYBRID_REQUIRED_HORIZONS,
  auditHybridPitRows,
  sha256,
  stableStringify,
  type HybridPitAuditResult,
  type HybridPitAuditRow,
  type HybridPitLineageReference,
  type HybridPitSourcePayload,
} from './hybrid-data-foundation-contract.js';

interface FeatureDatabaseRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  labelAvailableAt: Date;
  horizonMinutes: number;
  labelMatchWinner: number;
  labelOver25: number;
  labelBtts: number;
  fundamentalsAvailable: boolean;
  marketAvailable: boolean;
  bookmakerCount: number;
  marketHomeProbability: number | null;
  marketDrawProbability: number | null;
  marketAwayProbability: number | null;
  featureNames: unknown;
  featureVector: unknown;
  featureContractHash: string;
  sourcePayload: unknown;
  payloadHash: string;
}

interface DixonDatabaseRow {
  id: number;
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  trainedThrough: Date;
  payloadHash: string;
}

interface FundamentalDatabaseRow {
  id: number;
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  payloadHash: string;
}

export interface HybridDataFoundationConfiguration {
  horizons: number[];
  dateFrom: Date | null;
  dateTo: Date | null;
  horizonToleranceMinutes: number;
  minimumRowsPerHorizon: number;
  artifactDirectory: string;
}

export interface HybridDataFoundationRuntimeResult {
  configuration: HybridDataFoundationConfiguration;
  audit: HybridPitAuditResult;
  rows: HybridPitAuditRow[];
}

export interface HybridDataFoundationArtifactResult {
  directory: string;
  manifestPath: string;
  findingsPath: string;
  datasetPath: string | null;
  hashesPath: string;
  audit: HybridPitAuditResult;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function parseDate(name: string): Date | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} is not a valid date.`);
  return date;
}

function parseHorizons(): number[] {
  const raw = process.env.HYBRID_DATA_HORIZONS_MINUTES ?? HYBRID_REQUIRED_HORIZONS.join(',');
  const horizons = raw
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
  if (horizons.length === 0) throw new Error('HYBRID_DATA_HORIZONS_MINUTES cannot be empty.');
  return [...new Set(horizons)].sort((left, right) => right - left);
}

function repositoryRoot(): string {
  let current = process.cwd();
  while (true) {
    try {
      const packageJson = resolve(current, 'package.json');
      const schema = resolve(current, 'packages/database/prisma/schema.prisma');
      if (requireExists(packageJson) && requireExists(schema)) return current;
    } catch {
      // Continue walking to the parent directory.
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot locate repository root from ${process.cwd()}.`);
    current = parent;
  }
}

function requireExists(path: string): boolean {
  try {
    execFileSync(process.execPath, ['-e', `require('node:fs').accessSync(${JSON.stringify(path)})`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function configuration(): HybridDataFoundationConfiguration {
  const root = repositoryRoot();
  return {
    horizons: parseHorizons(),
    dateFrom: parseDate('HYBRID_DATA_DATE_FROM'),
    dateTo: parseDate('HYBRID_DATA_DATE_TO'),
    horizonToleranceMinutes: Math.max(0, envNumber('HYBRID_DATA_HORIZON_TOLERANCE_MINUTES', 10)),
    minimumRowsPerHorizon: Math.max(1, Math.floor(envNumber('HYBRID_DATA_MIN_ROWS_PER_HORIZON', 50))),
    artifactDirectory: resolve(
      root,
      process.env.HYBRID_DATA_ARTIFACT_DIRECTORY ?? 'artifacts/hybrid/v8-data-foundation',
    ),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseSourcePayload(value: unknown): HybridPitSourcePayload {
  const source = asRecord(value);
  const market = asRecord(source?.market);
  return {
    predictionAsOf: asDate(source?.predictionAsOf),
    horizonMinutes: asInteger(source?.horizonMinutes),
    dixonSnapshotId: asInteger(source?.dixonSnapshotId),
    homeFundamentalSnapshotId: asInteger(source?.homeFundamentalSnapshotId),
    awayFundamentalSnapshotId: asInteger(source?.awayFundamentalSnapshotId),
    dixonPayloadHash: asString(source?.dixonPayloadHash),
    homePayloadHash: asString(source?.homePayloadHash),
    awayPayloadHash: asString(source?.awayPayloadHash),
    marketObservedFrom: asDate(market?.observedFrom),
    marketObservedTo: asDate(market?.observedTo),
  };
}

function lineageReference(row: FundamentalDatabaseRow | undefined): HybridPitLineageReference | null {
  if (!row) return null;
  return {
    id: row.id,
    fixtureId: row.fixtureId,
    horizonMinutes: row.horizonMinutes,
    predictionAsOf: row.predictionAsOf,
    payloadHash: row.payloadHash,
  };
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export async function loadHybridDataFoundation(): Promise<HybridDataFoundationRuntimeResult> {
  const config = configuration();
  const allFeatureRows = (await prisma.mlFeatureSnapshot.findMany({
    where: {
      featureContractHash: ML_MARKET_FEATURE_CONTRACT_HASH,
      horizonMinutes: { in: config.horizons },
      ...(config.dateFrom || config.dateTo
        ? {
            predictionAsOf: {
              ...(config.dateFrom ? { gte: config.dateFrom } : {}),
              ...(config.dateTo ? { lte: config.dateTo } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      fixtureId: true,
      leagueId: true,
      predictionAsOf: true,
      kickoffAt: true,
      labelAvailableAt: true,
      horizonMinutes: true,
      labelMatchWinner: true,
      labelOver25: true,
      labelBtts: true,
      fundamentalsAvailable: true,
      marketAvailable: true,
      bookmakerCount: true,
      marketHomeProbability: true,
      marketDrawProbability: true,
      marketAwayProbability: true,
      featureNames: true,
      featureVector: true,
      featureContractHash: true,
      sourcePayload: true,
      payloadHash: true,
    },
    orderBy: [{ id: 'desc' }],
  })) as FeatureDatabaseRow[];

  // Append-only supersession:
  // retain historical rows in the database, but use only the newest row for
  // each fixture/horizon/feature-contract when building the Stage 1 dataset.
  const canonicalByKey = new Map<string, FeatureDatabaseRow>();
  for (const row of allFeatureRows) {
    const key = `${row.fixtureId}:${row.horizonMinutes}:${row.featureContractHash}`;
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, row);
  }
  const featureRows = [...canonicalByKey.values()].sort(
    (left, right) =>
      left.kickoffAt.getTime() - right.kickoffAt.getTime() ||
      left.fixtureId - right.fixtureId ||
      right.horizonMinutes - left.horizonMinutes ||
      left.id - right.id,
  );

  const sources = new Map<number, HybridPitSourcePayload>();
  const dixonIds = new Set<number>();
  const fundamentalIds = new Set<number>();
  for (const row of featureRows) {
    const source = parseSourcePayload(row.sourcePayload);
    sources.set(row.id, source);
    if (source.dixonSnapshotId != null) dixonIds.add(source.dixonSnapshotId);
    if (source.homeFundamentalSnapshotId != null) fundamentalIds.add(source.homeFundamentalSnapshotId);
    if (source.awayFundamentalSnapshotId != null) fundamentalIds.add(source.awayFundamentalSnapshotId);
  }

  const dixonRows = dixonIds.size
    ? ((await prisma.dixonColesPredictionSnapshot.findMany({
        where: { id: { in: [...dixonIds] } },
        select: {
          id: true,
          fixtureId: true,
          horizonMinutes: true,
          predictionAsOf: true,
          trainedThrough: true,
          payloadHash: true,
        },
      })) as DixonDatabaseRow[])
    : [];
  const fundamentalRows = fundamentalIds.size
    ? ((await prisma.teamFundamentalSnapshot.findMany({
        where: { id: { in: [...fundamentalIds] } },
        select: {
          id: true,
          fixtureId: true,
          horizonMinutes: true,
          predictionAsOf: true,
          payloadHash: true,
        },
      })) as FundamentalDatabaseRow[])
    : [];

  const dixonMap = new Map(dixonRows.map((row) => [row.id, row]));
  const fundamentalMap = new Map(fundamentalRows.map((row) => [row.id, row]));
  const rows: HybridPitAuditRow[] = featureRows.map((row) => {
    const source = sources.get(row.id) ?? parseSourcePayload(null);
    const dixon = source.dixonSnapshotId == null ? undefined : dixonMap.get(source.dixonSnapshotId);
    return {
      ...row,
      source,
      dixon: dixon
        ? {
            id: dixon.id,
            fixtureId: dixon.fixtureId,
            horizonMinutes: dixon.horizonMinutes,
            predictionAsOf: dixon.predictionAsOf,
            trainedThrough: dixon.trainedThrough,
            payloadHash: dixon.payloadHash,
          }
        : null,
      homeFundamental:
        source.homeFundamentalSnapshotId == null
          ? null
          : lineageReference(fundamentalMap.get(source.homeFundamentalSnapshotId)),
      awayFundamental:
        source.awayFundamentalSnapshotId == null
          ? null
          : lineageReference(fundamentalMap.get(source.awayFundamentalSnapshotId)),
    };
  });

  const audit = auditHybridPitRows(rows, {
    expectedFeatureContractHash: ML_MARKET_FEATURE_CONTRACT_HASH,
    requiredHorizons: config.horizons,
    horizonToleranceMinutes: config.horizonToleranceMinutes,
    minimumRowsPerHorizon: config.minimumRowsPerHorizon,
  });
  return { configuration: config, audit, rows };
}

function datasetLine(row: HybridPitAuditRow): Record<string, unknown> {
  return {
    fixtureId: row.fixtureId,
    leagueId: row.leagueId,
    predictionAsOf: row.predictionAsOf.toISOString(),
    kickoffAt: row.kickoffAt.toISOString(),
    labelAvailableAt: row.labelAvailableAt.toISOString(),
    horizonMinutes: row.horizonMinutes,
    labels: {
      matchWinner: row.labelMatchWinner,
      over25: row.labelOver25,
      btts: row.labelBtts,
    },
    market: {
      available: row.marketAvailable,
      bookmakerCount: row.bookmakerCount,
      homeProbability: row.marketHomeProbability,
      drawProbability: row.marketDrawProbability,
      awayProbability: row.marketAwayProbability,
      observedFrom: row.source.marketObservedFrom?.toISOString() ?? null,
      observedTo: row.source.marketObservedTo?.toISOString() ?? null,
    },
    features: {
      names: row.featureNames,
      vector: row.featureVector,
      contractHash: row.featureContractHash,
    },
    lineage: {
      featurePayloadHash: row.payloadHash,
      dixonSnapshotId: row.source.dixonSnapshotId,
      dixonPayloadHash: row.source.dixonPayloadHash,
      dixonTrainedThrough: row.dixon?.trainedThrough.toISOString() ?? null,
      homeFundamentalSnapshotId: row.source.homeFundamentalSnapshotId,
      homeFundamentalPayloadHash: row.source.homePayloadHash,
      awayFundamentalSnapshotId: row.source.awayFundamentalSnapshotId,
      awayFundamentalPayloadHash: row.source.awayPayloadHash,
    },
  };
}

export async function writeHybridDataFoundationArtifacts(input: {
  includeDataset: boolean;
}): Promise<HybridDataFoundationArtifactResult> {
  const runtime = await loadHybridDataFoundation();
  if (input.includeDataset && runtime.audit.status !== 'READY_FOR_BAYESIAN') {
    throw new Error(
      `Dataset export blocked: ${runtime.audit.status}. Run coverage/audit and resolve all gates first.`,
    );
  }

  const root = repositoryRoot();
  const safeIds = new Set(runtime.audit.safeRowIds);
  const safeRows = runtime.rows.filter((row) => safeIds.has(row.id));
  const datasetContent = safeRows.map((row) => JSON.stringify(datasetLine(row))).join('\n') + (safeRows.length ? '\n' : '');
  const datasetHash = sha256(datasetContent);
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.audit.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });

  const findingsContent = runtime.audit.findings.map((entry) => JSON.stringify(entry)).join('\n') +
    (runtime.audit.findings.length ? '\n' : '');
  const findingsPath = resolve(directory, 'findings.jsonl');
  writeFileSync(findingsPath, findingsContent, 'utf8');

  let datasetPath: string | null = null;
  if (input.includeDataset) {
    datasetPath = resolve(directory, 'dataset.jsonl');
    writeFileSync(datasetPath, datasetContent, 'utf8');
  }

  const manifest = {
    version: HYBRID_DATA_FOUNDATION_VERSION,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.audit.status,
    featureContractHash: ML_MARKET_FEATURE_CONTRACT_HASH,
    configuration: {
      ...runtime.configuration,
      dateFrom: runtime.configuration.dateFrom?.toISOString() ?? null,
      dateTo: runtime.configuration.dateTo?.toISOString() ?? null,
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
    },
    summary: {
      rows: runtime.audit.rows,
      safeRows: runtime.audit.safeRows,
      fixtures: runtime.audit.fixtures,
      errors: runtime.audit.errors,
      warnings: runtime.audit.warnings,
      duplicateGroups: runtime.audit.duplicateGroups,
      coverage: runtime.audit.coverage,
    },
    datasetFingerprint: runtime.audit.datasetFingerprint,
    files: {
      dataset: datasetPath ? 'dataset.jsonl' : null,
      findings: 'findings.jsonl',
      hashes: 'sha256.json',
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  const manifestPath = resolve(directory, 'manifest.json');
  writeFileSync(manifestPath, manifestContent, 'utf8');

  const hashes = {
    'manifest.json': sha256(manifestContent),
    'findings.jsonl': sha256(findingsContent),
    ...(datasetPath ? { 'dataset.jsonl': datasetHash } : {}),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');

  return { directory, manifestPath, findingsPath, datasetPath, hashesPath, audit: runtime.audit };
}

export function hybridDataFoundationSummary(result: HybridDataFoundationRuntimeResult): Record<string, unknown> {
  return {
    version: HYBRID_DATA_FOUNDATION_VERSION,
    status: result.audit.status,
    rows: result.audit.rows,
    safeRows: result.audit.safeRows,
    fixtures: result.audit.fixtures,
    errors: result.audit.errors,
    warnings: result.audit.warnings,
    duplicateGroups: result.audit.duplicateGroups,
    coverage: result.audit.coverage,
    datasetFingerprint: result.audit.datasetFingerprint,
    featureContractHash: ML_MARKET_FEATURE_CONTRACT_HASH,
    configuration: {
      ...result.configuration,
      dateFrom: result.configuration.dateFrom?.toISOString() ?? null,
      dateTo: result.configuration.dateTo?.toISOString() ?? null,
    },
    apiCalled: false,
    schemaChanged: false,
  };
}
