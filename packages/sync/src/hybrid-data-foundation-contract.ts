import { createHash } from 'node:crypto';

export const HYBRID_DATA_FOUNDATION_VERSION = 'v8.0-stage1-pit-data-foundation-v1';
export const HYBRID_REQUIRED_HORIZONS = [180, 90, 30, 10, 5] as const;

export type HybridDataFoundationStatus =
  | 'READY_FOR_BAYESIAN'
  | 'INSUFFICIENT_COVERAGE'
  | 'BLOCKED_PIT_OR_CONTRACT';

export type HybridPitFindingSeverity = 'ERROR' | 'WARNING';

export type HybridPitFindingCode =
  | 'PREDICTION_NOT_BEFORE_KICKOFF'
  | 'HORIZON_MISMATCH'
  | 'LABEL_NOT_AFTER_KICKOFF'
  | 'LABEL_NOT_AFTER_PREDICTION'
  | 'FEATURE_CONTRACT_MISMATCH'
  | 'FEATURE_NAMES_INVALID'
  | 'FEATURE_VECTOR_INVALID'
  | 'FEATURE_LENGTH_MISMATCH'
  | 'FEATURE_NON_FINITE'
  | 'LABEL_INVALID'
  | 'SOURCE_LINEAGE_MISSING'
  | 'SOURCE_PREDICTION_ASOF_MISMATCH'
  | 'SOURCE_HORIZON_MISMATCH'
  | 'DIXON_SNAPSHOT_MISSING'
  | 'DIXON_FIXTURE_MISMATCH'
  | 'DIXON_HORIZON_MISMATCH'
  | 'DIXON_ASOF_AFTER_FEATURE'
  | 'DIXON_TRAINING_LEAKAGE'
  | 'DIXON_HASH_MISMATCH'
  | 'HOME_FUNDAMENTAL_MISSING'
  | 'AWAY_FUNDAMENTAL_MISSING'
  | 'FUNDAMENTAL_FIXTURE_MISMATCH'
  | 'FUNDAMENTAL_HORIZON_MISMATCH'
  | 'FUNDAMENTAL_ASOF_AFTER_FEATURE'
  | 'FUNDAMENTAL_HASH_MISMATCH'
  | 'MARKET_OBSERVED_RANGE_INVALID'
  | 'MARKET_OBSERVED_AFTER_PREDICTION'
  | 'DUPLICATE_FIXTURE_HORIZON'
  | 'HORIZON_COVERAGE_SHORTFALL';

export interface HybridPitLineageReference {
  id: number;
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  payloadHash: string;
}

export interface HybridPitDixonReference extends HybridPitLineageReference {
  trainedThrough: Date;
}

export interface HybridPitSourcePayload {
  predictionAsOf: Date | null;
  horizonMinutes: number | null;
  dixonSnapshotId: number | null;
  homeFundamentalSnapshotId: number | null;
  awayFundamentalSnapshotId: number | null;
  dixonPayloadHash: string | null;
  homePayloadHash: string | null;
  awayPayloadHash: string | null;
  marketObservedFrom: Date | null;
  marketObservedTo: Date | null;
}

export interface HybridPitAuditRow {
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
  payloadHash: string;
  source: HybridPitSourcePayload;
  dixon: HybridPitDixonReference | null;
  homeFundamental: HybridPitLineageReference | null;
  awayFundamental: HybridPitLineageReference | null;
}

export interface HybridPitFinding {
  severity: HybridPitFindingSeverity;
  code: HybridPitFindingCode;
  message: string;
  rowId: number | null;
  fixtureId: number | null;
  horizonMinutes: number | null;
  evidence: Record<string, unknown>;
}

export interface HybridPitAuditOptions {
  expectedFeatureContractHash: string;
  requiredHorizons?: readonly number[];
  horizonToleranceMinutes?: number;
  minimumRowsPerHorizon?: number;
}

export interface HybridPitHorizonCoverage {
  horizonMinutes: number;
  rows: number;
  fixtures: number;
  marketAvailableRows: number;
  errorRows: number;
  minimumRequired: number;
  ready: boolean;
}

export interface HybridPitAuditResult {
  version: string;
  status: HybridDataFoundationStatus;
  rows: number;
  safeRows: number;
  fixtures: number;
  errors: number;
  warnings: number;
  duplicateGroups: number;
  findings: HybridPitFinding[];
  coverage: HybridPitHorizonCoverage[];
  safeRowIds: number[];
  datasetFingerprint: string;
}

function asFiniteNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map((entry) => Number(entry));
  return numbers.every((entry) => Number.isFinite(entry)) ? numbers : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null;
  return value as string[];
}

function finding(
  row: HybridPitAuditRow | null,
  severity: HybridPitFindingSeverity,
  code: HybridPitFindingCode,
  message: string,
  evidence: Record<string, unknown> = {},
): HybridPitFinding {
  return {
    severity,
    code,
    message,
    rowId: row?.id ?? null,
    fixtureId: row?.fixtureId ?? null,
    horizonMinutes: row?.horizonMinutes ?? null,
    evidence,
  };
}

function sameInstant(left: Date | null, right: Date): boolean {
  return left != null && left.getTime() === right.getTime();
}

function auditLineageReference(input: {
  row: HybridPitAuditRow;
  reference: HybridPitLineageReference | null;
  expectedHash: string | null;
  missingCode: 'HOME_FUNDAMENTAL_MISSING' | 'AWAY_FUNDAMENTAL_MISSING';
  label: string;
}): HybridPitFinding[] {
  const { row, reference, expectedHash, missingCode, label } = input;
  if (!reference) {
    return [finding(row, 'ERROR', missingCode, `${label} snapshot is missing.`)];
  }

  const findings: HybridPitFinding[] = [];
  if (reference.fixtureId !== row.fixtureId) {
    findings.push(
      finding(row, 'ERROR', 'FUNDAMENTAL_FIXTURE_MISMATCH', `${label} fixture does not match.`, {
        expected: row.fixtureId,
        received: reference.fixtureId,
      }),
    );
  }
  if (reference.horizonMinutes !== row.horizonMinutes) {
    findings.push(
      finding(row, 'ERROR', 'FUNDAMENTAL_HORIZON_MISMATCH', `${label} horizon does not match.`, {
        expected: row.horizonMinutes,
        received: reference.horizonMinutes,
      }),
    );
  }
  if (reference.predictionAsOf.getTime() > row.predictionAsOf.getTime()) {
    findings.push(
      finding(
        row,
        'ERROR',
        'FUNDAMENTAL_ASOF_AFTER_FEATURE',
        `${label} was captured after the feature decision time.`,
        {
          fundamentalPredictionAsOf: reference.predictionAsOf.toISOString(),
          featurePredictionAsOf: row.predictionAsOf.toISOString(),
        },
      ),
    );
  }
  if (expectedHash != null && expectedHash !== reference.payloadHash) {
    findings.push(
      finding(row, 'ERROR', 'FUNDAMENTAL_HASH_MISMATCH', `${label} payload hash does not match lineage.`, {
        expected: expectedHash,
        received: reference.payloadHash,
      }),
    );
  }
  return findings;
}

export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function fingerprintHybridPitRows(rows: readonly HybridPitAuditRow[]): string {
  const payload = [...rows]
    .sort(
      (left, right) =>
        left.kickoffAt.getTime() - right.kickoffAt.getTime() ||
        left.fixtureId - right.fixtureId ||
        right.horizonMinutes - left.horizonMinutes ||
        left.id - right.id,
    )
    .map((row) => ({
      fixtureId: row.fixtureId,
      leagueId: row.leagueId,
      predictionAsOf: row.predictionAsOf.toISOString(),
      kickoffAt: row.kickoffAt.toISOString(),
      labelAvailableAt: row.labelAvailableAt.toISOString(),
      horizonMinutes: row.horizonMinutes,
      featureContractHash: row.featureContractHash,
      payloadHash: row.payloadHash,
    }));
  return sha256(stableStringify(payload));
}

export function auditHybridPitRows(
  rows: readonly HybridPitAuditRow[],
  options: HybridPitAuditOptions,
): HybridPitAuditResult {
  const requiredHorizons = [...(options.requiredHorizons ?? HYBRID_REQUIRED_HORIZONS)];
  const toleranceMinutes = Math.max(0, options.horizonToleranceMinutes ?? 10);
  const minimumRowsPerHorizon = Math.max(1, options.minimumRowsPerHorizon ?? 50);
  const findings: HybridPitFinding[] = [];
  const errorRowIds = new Set<number>();

  const add = (entry: HybridPitFinding): void => {
    findings.push(entry);
    if (entry.severity === 'ERROR' && entry.rowId != null) errorRowIds.add(entry.rowId);
  };

  for (const row of rows) {
    if (row.predictionAsOf.getTime() >= row.kickoffAt.getTime()) {
      add(
        finding(row, 'ERROR', 'PREDICTION_NOT_BEFORE_KICKOFF', 'predictionAsOf must be before kickoffAt.', {
          predictionAsOf: row.predictionAsOf.toISOString(),
          kickoffAt: row.kickoffAt.toISOString(),
        }),
      );
    }

    const actualHorizonMinutes = (row.kickoffAt.getTime() - row.predictionAsOf.getTime()) / 60_000;
    if (Math.abs(actualHorizonMinutes - row.horizonMinutes) > toleranceMinutes) {
      add(
        finding(row, 'ERROR', 'HORIZON_MISMATCH', 'Stored horizon is outside the configured tolerance.', {
          expectedHorizonMinutes: row.horizonMinutes,
          actualHorizonMinutes,
          toleranceMinutes,
        }),
      );
    }

    if (row.labelAvailableAt.getTime() <= row.kickoffAt.getTime()) {
      add(
        finding(row, 'ERROR', 'LABEL_NOT_AFTER_KICKOFF', 'Label availability must be after kickoff.', {
          labelAvailableAt: row.labelAvailableAt.toISOString(),
          kickoffAt: row.kickoffAt.toISOString(),
        }),
      );
    }
    if (row.labelAvailableAt.getTime() <= row.predictionAsOf.getTime()) {
      add(
        finding(row, 'ERROR', 'LABEL_NOT_AFTER_PREDICTION', 'Label availability must be after predictionAsOf.'),
      );
    }

    if (row.featureContractHash !== options.expectedFeatureContractHash) {
      add(
        finding(row, 'ERROR', 'FEATURE_CONTRACT_MISMATCH', 'Feature contract hash does not match.', {
          expected: options.expectedFeatureContractHash,
          received: row.featureContractHash,
        }),
      );
    }

    const featureNames = asStringArray(row.featureNames);
    const featureVector = asFiniteNumberArray(row.featureVector);
    if (!featureNames) add(finding(row, 'ERROR', 'FEATURE_NAMES_INVALID', 'featureNames must be a string array.'));
    if (!Array.isArray(row.featureVector)) {
      add(finding(row, 'ERROR', 'FEATURE_VECTOR_INVALID', 'featureVector must be an array.'));
    } else if (!featureVector) {
      add(finding(row, 'ERROR', 'FEATURE_NON_FINITE', 'featureVector contains a non-finite value.'));
    }
    if (featureNames && featureVector && featureNames.length !== featureVector.length) {
      add(
        finding(row, 'ERROR', 'FEATURE_LENGTH_MISMATCH', 'featureNames and featureVector lengths differ.', {
          featureNames: featureNames.length,
          featureVector: featureVector.length,
        }),
      );
    }

    if (![0, 1, 2].includes(row.labelMatchWinner) || ![0, 1].includes(row.labelOver25) || ![0, 1].includes(row.labelBtts)) {
      add(
        finding(row, 'ERROR', 'LABEL_INVALID', 'One or more labels are outside the supported class range.', {
          labelMatchWinner: row.labelMatchWinner,
          labelOver25: row.labelOver25,
          labelBtts: row.labelBtts,
        }),
      );
    }

    if (
      row.source.dixonSnapshotId == null ||
      row.source.homeFundamentalSnapshotId == null ||
      row.source.awayFundamentalSnapshotId == null
    ) {
      add(finding(row, 'ERROR', 'SOURCE_LINEAGE_MISSING', 'Feature source lineage is incomplete.'));
    }
    if (!sameInstant(row.source.predictionAsOf, row.predictionAsOf)) {
      add(
        finding(row, 'ERROR', 'SOURCE_PREDICTION_ASOF_MISMATCH', 'Source predictionAsOf does not match the row.', {
          sourcePredictionAsOf: row.source.predictionAsOf?.toISOString() ?? null,
          rowPredictionAsOf: row.predictionAsOf.toISOString(),
        }),
      );
    }
    if (row.source.horizonMinutes !== row.horizonMinutes) {
      add(
        finding(row, 'ERROR', 'SOURCE_HORIZON_MISMATCH', 'Source horizon does not match the row.', {
          sourceHorizonMinutes: row.source.horizonMinutes,
          rowHorizonMinutes: row.horizonMinutes,
        }),
      );
    }

    if (!row.dixon) {
      add(finding(row, 'ERROR', 'DIXON_SNAPSHOT_MISSING', 'Dixon-Coles snapshot is missing.'));
    } else {
      if (row.dixon.fixtureId !== row.fixtureId) {
        add(
          finding(row, 'ERROR', 'DIXON_FIXTURE_MISMATCH', 'Dixon-Coles fixture does not match.', {
            expected: row.fixtureId,
            received: row.dixon.fixtureId,
          }),
        );
      }
      if (row.dixon.horizonMinutes !== row.horizonMinutes) {
        add(
          finding(row, 'ERROR', 'DIXON_HORIZON_MISMATCH', 'Dixon-Coles horizon does not match.', {
            expected: row.horizonMinutes,
            received: row.dixon.horizonMinutes,
          }),
        );
      }
      if (row.dixon.predictionAsOf.getTime() > row.predictionAsOf.getTime()) {
        add(
          finding(row, 'ERROR', 'DIXON_ASOF_AFTER_FEATURE', 'Dixon-Coles prediction is later than the feature row.'),
        );
      }
      if (row.dixon.trainedThrough.getTime() >= row.predictionAsOf.getTime()) {
        add(
          finding(row, 'ERROR', 'DIXON_TRAINING_LEAKAGE', 'Dixon-Coles trainedThrough must be strictly before predictionAsOf.', {
            trainedThrough: row.dixon.trainedThrough.toISOString(),
            predictionAsOf: row.predictionAsOf.toISOString(),
          }),
        );
      }
      if (row.source.dixonPayloadHash != null && row.source.dixonPayloadHash !== row.dixon.payloadHash) {
        add(
          finding(row, 'ERROR', 'DIXON_HASH_MISMATCH', 'Dixon-Coles payload hash does not match lineage.', {
            expected: row.source.dixonPayloadHash,
            received: row.dixon.payloadHash,
          }),
        );
      }
    }

    for (const entry of auditLineageReference({
      row,
      reference: row.homeFundamental,
      expectedHash: row.source.homePayloadHash,
      missingCode: 'HOME_FUNDAMENTAL_MISSING',
      label: 'Home fundamental',
    })) add(entry);
    for (const entry of auditLineageReference({
      row,
      reference: row.awayFundamental,
      expectedHash: row.source.awayPayloadHash,
      missingCode: 'AWAY_FUNDAMENTAL_MISSING',
      label: 'Away fundamental',
    })) add(entry);

    const observedFrom = row.source.marketObservedFrom;
    const observedTo = row.source.marketObservedTo;
    if (observedFrom && observedTo && observedFrom.getTime() > observedTo.getTime()) {
      add(
        finding(row, 'ERROR', 'MARKET_OBSERVED_RANGE_INVALID', 'Market observedFrom is after observedTo.', {
          observedFrom: observedFrom.toISOString(),
          observedTo: observedTo.toISOString(),
        }),
      );
    }
    if (observedTo && observedTo.getTime() > row.predictionAsOf.getTime()) {
      add(
        finding(row, 'ERROR', 'MARKET_OBSERVED_AFTER_PREDICTION', 'Market evidence was observed after predictionAsOf.', {
          observedTo: observedTo.toISOString(),
          predictionAsOf: row.predictionAsOf.toISOString(),
        }),
      );
    }
  }

  const duplicateGroups = new Map<string, HybridPitAuditRow[]>();
  for (const row of rows) {
    const key = `${row.fixtureId}:${row.horizonMinutes}:${row.featureContractHash}`;
    const group = duplicateGroups.get(key) ?? [];
    group.push(row);
    duplicateGroups.set(key, group);
  }
  let duplicateGroupCount = 0;
  for (const [key, group] of duplicateGroups) {
    if (group.length <= 1) continue;
    duplicateGroupCount += 1;
    for (const row of group) {
      add(
        finding(row, 'ERROR', 'DUPLICATE_FIXTURE_HORIZON', 'Multiple feature rows exist for one fixture/horizon contract.', {
          key,
          rowIds: group.map((entry) => entry.id),
        }),
      );
    }
  }

  const coverage = requiredHorizons.map((horizonMinutes) => {
    const horizonRows = rows.filter((row) => row.horizonMinutes === horizonMinutes);
    const errorRows = new Set(
      findings
        .filter(
          (entry) =>
            entry.severity === 'ERROR' &&
            entry.horizonMinutes === horizonMinutes &&
            entry.rowId != null,
        )
        .map((entry) => Number(entry.rowId)),
    ).size;
    const result: HybridPitHorizonCoverage = {
      horizonMinutes,
      rows: horizonRows.length,
      fixtures: new Set(horizonRows.map((row) => row.fixtureId)).size,
      marketAvailableRows: horizonRows.filter((row) => row.marketAvailable).length,
      errorRows,
      minimumRequired: minimumRowsPerHorizon,
      ready: horizonRows.length >= minimumRowsPerHorizon && errorRows === 0,
    };
    if (horizonRows.length < minimumRowsPerHorizon) {
      findings.push(
        finding(null, 'WARNING', 'HORIZON_COVERAGE_SHORTFALL', `T-${horizonMinutes} has insufficient rows.`, {
          horizonMinutes,
          rows: horizonRows.length,
          minimumRequired: minimumRowsPerHorizon,
        }),
      );
    }
    return result;
  });

  const errors = findings.filter((entry) => entry.severity === 'ERROR').length;
  const warnings = findings.filter((entry) => entry.severity === 'WARNING').length;
  const safeRows = rows.filter((row) => !errorRowIds.has(row.id));
  const coverageReady = coverage.every((entry) => entry.ready);
  const status: HybridDataFoundationStatus =
    errors > 0
      ? 'BLOCKED_PIT_OR_CONTRACT'
      : coverageReady
        ? 'READY_FOR_BAYESIAN'
        : 'INSUFFICIENT_COVERAGE';

  return {
    version: HYBRID_DATA_FOUNDATION_VERSION,
    status,
    rows: rows.length,
    safeRows: safeRows.length,
    fixtures: new Set(rows.map((row) => row.fixtureId)).size,
    errors,
    warnings,
    duplicateGroups: duplicateGroupCount,
    findings,
    coverage,
    safeRowIds: safeRows.map((row) => row.id),
    datasetFingerprint: fingerprintHybridPitRows(safeRows),
  };
}
