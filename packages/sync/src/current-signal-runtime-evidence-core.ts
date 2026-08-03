import { createHash } from 'node:crypto';

export const CURRENT_SIGNAL_RUNTIME_EVIDENCE_VERSION =
  'v7.0-r4.10.3.3-first-real-current-signal-evidence-v1';

export const CURRENT_SIGNAL_EVIDENCE_TERMINAL_STATUSES =
  [
    'AVAILABLE',
    'NO_VALUE_SIGNAL',
  ] as const;

export type CurrentSignalEvidenceTerminalStatus =
  (
    typeof CURRENT_SIGNAL_EVIDENCE_TERMINAL_STATUSES
  )[number];

export interface CurrentSignalCheckpointFixture {
  providerFixtureId: number;
  kickoffAt: Date;
}

export interface CurrentSignalCheckpointWindow {
  providerFixtureId: number;
  kickoffAt: Date;
  checkpointMinutes: number;
  checkpointLabel: string;
  targetAt: Date;
  windowStartsAt: Date;
  windowEndsAt: Date;
  secondsUntilWindowStarts: number;
  alreadyCaptured: boolean;
}

export interface CurrentSignalRuntimeEvidenceRow {
  id: number;
  providerFixtureId: number;
  localFixtureId: number | null;
  checkpointMinutes: number;
  checkpointLabel: string;
  actualHorizonMinutes: number;
  snapshotAsOf: Date;
  kickoffAt: Date;
  status: string;
  sourceOddsUpdatedAt: Date | null;
  sourceOddsFirstObservedAt: Date | null;
  sourceOddsReobservedAt: Date | null;
  sourceOddsFreshnessAt: Date | null;
  candidateCount: number;
  currentEligibleCandidateCount: number;
  officialEligibleCandidateCount: number;
  analysisPayload: unknown;
  snapshotHash: string;
  createdAt: Date;
}

export interface CurrentSignalEvidenceCheck {
  name: string;
  passed: boolean;
  required: boolean;
  detail: string;
}

export interface CurrentSignalRiskAuditSummary {
  candidateCountInPayload: number;
  riskRankedCandidateCount: number;
  lowConfidenceDiagnosticCount: number;
  riskAdjustedResearchCount: number;
  rawEligibleBeforeGuardCount: number;
  eligibleAfterGuardCount: number;
  longshotBlockedCount: number;
  quoteOutlierCount: number;
  recommendationHasRiskFields: boolean;
  recommendationSignalTier: string | null;
  recommendationRiskAdjustedScore: number | null;
  recommendationConservativeExpectedValue: number | null;
}

export interface CurrentSignalRuntimeEvidenceProof {
  version: string;
  passed: boolean;
  row: {
    id: number;
    providerFixtureId: number;
    localFixtureId: number | null;
    checkpointMinutes: number;
    checkpointLabel: string;
    actualHorizonMinutes: number;
    snapshotAsOf: string;
    kickoffAt: string;
    status: string;
    snapshotHash: string;
    createdAt: string;
  };
  duplicateKeyRows: number;
  recomputedSnapshotHash: string;
  riskAudit: CurrentSignalRiskAuditSummary;
  checks: CurrentSignalEvidenceCheck[];
  externalApiCalled: false;
  databaseWritten: false;
  realMoneyExecution: false;
}

function recordOf(
  value: unknown,
): Record<string, unknown> | null {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : null;
}

function arrayOf(
  value: unknown,
): unknown[] {
  return Array.isArray(value)
    ? value
    : [];
}

function finiteNumber(
  value: unknown,
): number | null {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function stringOf(
  value: unknown,
): string | null {
  return typeof value === 'string'
    ? value
    : null;
}

function booleanOf(
  value: unknown,
): boolean | null {
  return typeof value === 'boolean'
    ? value
    : null;
}

function canonicalize(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(
      canonicalize,
    );
  }

  if (
    value != null &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>,
      )
        .sort(
          (
            left,
            right,
          ): number =>
            left[0].localeCompare(
              right[0],
            ),
        )
        .map(
          (
            [
              key,
              item,
            ],
          ) => [
            key,
            canonicalize(item),
          ],
        ),
    );
  }

  return value;
}

export function currentSignalPayloadHash(
  payload: unknown,
): string {
  return createHash(
    'sha256',
  )
    .update(
      JSON.stringify(
        canonicalize(payload),
      ),
    )
    .digest(
      'hex',
    );
}

export function isCurrentSignalEvidenceTerminalStatus(
  status: string,
): status is CurrentSignalEvidenceTerminalStatus {
  return (
    CURRENT_SIGNAL_EVIDENCE_TERMINAL_STATUSES as
      readonly string[]
  ).includes(
    status,
  );
}

function candidateHasRiskFields(
  value: unknown,
): boolean {
  const candidate =
    recordOf(value);

  if (candidate == null) {
    return false;
  }

  return (
    stringOf(
      candidate.rankingVersion,
    ) != null &&
    stringOf(
      candidate.signalTier,
    ) != null &&
    finiteNumber(
      candidate.adjustedModelProbability,
    ) != null &&
    finiteNumber(
      candidate.conservativeProbability,
    ) != null &&
    finiteNumber(
      candidate.conservativeEdge,
    ) != null &&
    finiteNumber(
      candidate.conservativeExpectedValue,
    ) != null &&
    finiteNumber(
      candidate.riskAdjustedScore,
    ) != null &&
    finiteNumber(
      candidate.quoteCount,
    ) != null &&
    finiteNumber(
      candidate.quoteMedianOdds,
    ) != null &&
    finiteNumber(
      candidate.quoteAgreementRatio,
    ) != null &&
    booleanOf(
      candidate.quoteOutlier,
    ) != null
  );
}

export function summarizeCurrentSignalRiskAudit(
  analysisPayload: unknown,
): CurrentSignalRiskAuditSummary {
  const payload =
    recordOf(
      analysisPayload,
    );

  const analysis =
    recordOf(
      payload?.analysis,
    );

  const candidates =
    arrayOf(
      analysis?.candidates,
    );

  const recommendation =
    recordOf(
      analysis?.recommendation,
    );

  const riskRankedCandidateCount =
    candidates.filter(
      candidateHasRiskFields,
    ).length;

  const lowConfidenceDiagnosticCount =
    candidates.filter(
      (
        value: unknown,
      ): boolean =>
        stringOf(
          recordOf(value)
            ?.signalTier,
        ) ===
        'LOW_CONFIDENCE_DIAGNOSTIC',
    ).length;

  const riskAdjustedResearchCount =
    candidates.filter(
      (
        value: unknown,
      ): boolean =>
        stringOf(
          recordOf(value)
            ?.signalTier,
        ) ===
        'RISK_ADJUSTED_RESEARCH',
    ).length;

  const rawEligibleBeforeGuardCount =
    candidates.filter(
      (
        value: unknown,
      ): boolean =>
        booleanOf(
          recordOf(value)
            ?.rawSignalEligibleBeforeRiskGuard,
        ) === true,
    ).length;

  const eligibleAfterGuardCount =
    candidates.filter(
      (
        value: unknown,
      ): boolean =>
        booleanOf(
          recordOf(value)
            ?.currentSignalEligible,
        ) === true,
    ).length;

  const longshotBlockedCount =
    candidates.filter(
      (
        value: unknown,
      ): boolean => {
        const candidate =
          recordOf(value);

        const reasons =
          arrayOf(
            candidate
              ?.rejectionReasons,
          );

        return reasons.some(
          (
            reason: unknown,
          ): boolean =>
            typeof reason ===
              'string' &&
            reason.includes(
              'LONGSHOT',
            ),
        );
      },
    ).length;

  const quoteOutlierCount =
    candidates.filter(
      (
        value: unknown,
      ): boolean =>
        booleanOf(
          recordOf(value)
            ?.quoteOutlier,
        ) === true,
    ).length;

  return {
    candidateCountInPayload:
      candidates.length,
    riskRankedCandidateCount,
    lowConfidenceDiagnosticCount,
    riskAdjustedResearchCount,
    rawEligibleBeforeGuardCount,
    eligibleAfterGuardCount,
    longshotBlockedCount,
    quoteOutlierCount,
    recommendationHasRiskFields:
      recommendation != null &&
      candidateHasRiskFields(
        recommendation,
      ),
    recommendationSignalTier:
      stringOf(
        recommendation
          ?.signalTier,
      ),
    recommendationRiskAdjustedScore:
      finiteNumber(
        recommendation
          ?.riskAdjustedScore,
      ),
    recommendationConservativeExpectedValue:
      finiteNumber(
        recommendation
          ?.conservativeExpectedValue,
      ),
  };
}

function dateNotAfter(
  value: Date | null,
  boundary: Date,
): boolean {
  return (
    value == null ||
    value.getTime() <=
      boundary.getTime()
  );
}

function check(
  name: string,
  passed: boolean,
  detail: string,
  required = true,
): CurrentSignalEvidenceCheck {
  return {
    name,
    passed,
    required,
    detail,
  };
}

export function verifyCurrentSignalRuntimeEvidence(
  input: {
    row: CurrentSignalRuntimeEvidenceRow;
    duplicateKeyRows: number;
  },
): CurrentSignalRuntimeEvidenceProof {
  const row =
    input.row;

  const payload =
    recordOf(
      row.analysisPayload,
    );

  const analysis =
    recordOf(
      payload?.analysis,
    );

  const checkpoint =
    recordOf(
      payload?.checkpoint,
    );

  const integrity =
    recordOf(
      payload?.integrity,
    );

  const recommendation =
    recordOf(
      analysis?.recommendation,
    );

  const riskAudit =
    summarizeCurrentSignalRiskAudit(
      row.analysisPayload,
    );

  const recomputedSnapshotHash =
    currentSignalPayloadHash(
      row.analysisPayload,
    );

  const exactHorizonMinutes =
    (
      row.kickoffAt.getTime() -
      row.snapshotAsOf.getTime()
    ) /
    60_000;

  const terminalStatus =
    isCurrentSignalEvidenceTerminalStatus(
      row.status,
    );

  const riskCoverageSatisfied =
    row.candidateCount === 0
      ? false
      : (
          riskAudit
            .candidateCountInPayload ===
            row.candidateCount &&
          riskAudit
            .riskRankedCandidateCount ===
            row.candidateCount
        );

  const statusRecommendationConsistency =
    row.status ===
      'AVAILABLE'
      ? (
          recommendation != null &&
          riskAudit
            .recommendationHasRiskFields &&
          riskAudit
            .recommendationSignalTier ===
            'RISK_ADJUSTED_RESEARCH' &&
          booleanOf(
            recommendation
              .quoteOutlier,
          ) === false
        )
      : (
          row.status ===
            'NO_VALUE_SIGNAL' &&
          recommendation == null
        );

  const checks = [
    check(
      'terminal scientific evidence status',
      terminalStatus,
      `status=${row.status}; accepted=AVAILABLE|NO_VALUE_SIGNAL`,
    ),
    check(
      'append-only unique fixture/checkpoint key',
      input.duplicateKeyRows === 1,
      `rows with providerFixtureId=${row.providerFixtureId} and checkpoint=${row.checkpointMinutes}: ${input.duplicateKeyRows}`,
    ),
    check(
      'snapshot payload hash',
      recomputedSnapshotHash ===
        row.snapshotHash,
      `stored=${row.snapshotHash}; recomputed=${recomputedSnapshotHash}`,
    ),
    check(
      'snapshot before kickoff',
      row.snapshotAsOf.getTime() <=
        row.kickoffAt.getTime(),
      `snapshotAsOf=${row.snapshotAsOf.toISOString()}; kickoffAt=${row.kickoffAt.toISOString()}`,
    ),
    check(
      'positive actual horizon',
      row.actualHorizonMinutes > 0 &&
        exactHorizonMinutes > 0,
      `stored=${row.actualHorizonMinutes}; exact=${exactHorizonMinutes.toFixed(6)}`,
    ),
    check(
      'actual horizon matches timestamp lineage',
      Math.abs(
        row.actualHorizonMinutes -
        exactHorizonMinutes,
      ) <= 1.1,
      `stored=${row.actualHorizonMinutes}; exact=${exactHorizonMinutes.toFixed(6)}`,
    ),
    check(
      'checkpoint label and payload checkpoint',
      row.checkpointLabel ===
        `T-${row.checkpointMinutes}` &&
        finiteNumber(
          checkpoint?.minutes,
        ) ===
        row.checkpointMinutes,
      `label=${row.checkpointLabel}; payloadMinutes=${String(checkpoint?.minutes)}`,
    ),
    check(
      'payload fixture identity',
      finiteNumber(
        analysis
          ?.providerFixtureId,
      ) ===
        row.providerFixtureId &&
        stringOf(
          analysis?.status,
        ) ===
        row.status,
      `payloadFixture=${String(analysis?.providerFixtureId)}; payloadStatus=${String(analysis?.status)}`,
    ),
    check(
      'candidate count lineage',
      riskAudit
        .candidateCountInPayload ===
        row.candidateCount,
      `db=${row.candidateCount}; payload=${riskAudit.candidateCountInPayload}`,
    ),
    check(
      'Longshot Bias Guard fields persisted',
      riskCoverageSatisfied,
      `riskRanked=${riskAudit.riskRankedCandidateCount}/${row.candidateCount}`,
    ),
    check(
      'status/recommendation risk consistency',
      statusRecommendationConsistency,
      row.status ===
        'AVAILABLE'
        ? `tier=${String(riskAudit.recommendationSignalTier)}; quoteOutlier=${String(recommendation?.quoteOutlier)}`
        : `recommendation=${recommendation == null ? 'null' : 'present'}`,
    ),
    check(
      'append-only integrity flag',
      booleanOf(
        integrity?.appendOnly,
      ) === true,
      `appendOnly=${String(integrity?.appendOnly)}`,
    ),
    check(
      'no future backfill flag',
      booleanOf(
        integrity?.noFutureBackfill,
      ) === true,
      `noFutureBackfill=${String(integrity?.noFutureBackfill)}`,
    ),
    check(
      'official BEST BET unchanged',
      booleanOf(
        integrity?.officialBestBetChanged,
      ) === false,
      `officialBestBetChanged=${String(integrity?.officialBestBetChanged)}`,
    ),
    check(
      'no automatic or real-money execution',
      booleanOf(
        integrity?.automaticBetPlacement,
      ) === false &&
        booleanOf(
          integrity?.realMoneyExecution,
        ) === false,
      `automaticBetPlacement=${String(integrity?.automaticBetPlacement)}; realMoneyExecution=${String(integrity?.realMoneyExecution)}`,
    ),
    check(
      'odds timestamps are PIT-safe',
      dateNotAfter(
        row.sourceOddsUpdatedAt,
        row.snapshotAsOf,
      ) &&
        dateNotAfter(
          row.sourceOddsFirstObservedAt,
          row.snapshotAsOf,
        ) &&
        dateNotAfter(
          row.sourceOddsReobservedAt,
          row.snapshotAsOf,
        ) &&
        dateNotAfter(
          row.sourceOddsFreshnessAt,
          row.snapshotAsOf,
        ),
      `snapshotAsOf=${row.snapshotAsOf.toISOString()}`,
    ),
  ];

  const passed =
    checks.every(
      (
        item: CurrentSignalEvidenceCheck,
      ): boolean =>
        !item.required ||
        item.passed,
    );

  return {
    version:
      CURRENT_SIGNAL_RUNTIME_EVIDENCE_VERSION,
    passed,
    row: {
      id:
        row.id,
      providerFixtureId:
        row.providerFixtureId,
      localFixtureId:
        row.localFixtureId,
      checkpointMinutes:
        row.checkpointMinutes,
      checkpointLabel:
        row.checkpointLabel,
      actualHorizonMinutes:
        row.actualHorizonMinutes,
      snapshotAsOf:
        row.snapshotAsOf.toISOString(),
      kickoffAt:
        row.kickoffAt.toISOString(),
      status:
        row.status,
      snapshotHash:
        row.snapshotHash,
      createdAt:
        row.createdAt.toISOString(),
    },
    duplicateKeyRows:
      input.duplicateKeyRows,
    recomputedSnapshotHash,
    riskAudit,
    checks,
    externalApiCalled:
      false,
    databaseWritten:
      false,
    realMoneyExecution:
      false,
  };
}

export function buildUpcomingCurrentSignalCheckpointWindows(
  input: {
    fixtures: CurrentSignalCheckpointFixture[];
    checkpoints: number[];
    toleranceMinutes: number;
    now: Date;
    until: Date;
    alreadyCapturedKeys?: Iterable<string>;
  },
): CurrentSignalCheckpointWindow[] {
  const captured =
    new Set<string>(
      input.alreadyCapturedKeys ??
      [],
    );

  const rows:
    CurrentSignalCheckpointWindow[] =
    [];

  for (
    const fixture of
    input.fixtures
  ) {
    for (
      const checkpointMinutes of
      input.checkpoints
    ) {
      const targetAt =
        new Date(
          fixture.kickoffAt.getTime() -
          checkpointMinutes *
            60_000,
        );

      const windowStartsAt =
        new Date(
          targetAt.getTime() -
          input.toleranceMinutes *
            60_000,
        );

      const windowEndsAt =
        new Date(
          targetAt.getTime() +
          input.toleranceMinutes *
            60_000,
        );

      if (
        windowEndsAt.getTime() <
          input.now.getTime() ||
        windowStartsAt.getTime() >
          input.until.getTime()
      ) {
        continue;
      }

      const key =
        `${fixture.providerFixtureId}:${checkpointMinutes}`;

      rows.push({
        providerFixtureId:
          fixture.providerFixtureId,
        kickoffAt:
          fixture.kickoffAt,
        checkpointMinutes,
        checkpointLabel:
          `T-${checkpointMinutes}`,
        targetAt,
        windowStartsAt,
        windowEndsAt,
        secondsUntilWindowStarts:
          Math.max(
            0,
            Math.ceil(
              (
                windowStartsAt.getTime() -
                input.now.getTime()
              ) /
              1_000,
            ),
          ),
        alreadyCaptured:
          captured.has(
            key,
          ),
      });
    }
  }

  return rows.sort(
    (
      left,
      right,
    ): number =>
      left.windowStartsAt.getTime() -
        right.windowStartsAt.getTime() ||
      left.kickoffAt.getTime() -
        right.kickoffAt.getTime() ||
      right.checkpointMinutes -
        left.checkpointMinutes ||
      left.providerFixtureId -
        right.providerFixtureId,
  );
}
