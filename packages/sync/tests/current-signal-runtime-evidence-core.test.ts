import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildUpcomingCurrentSignalCheckpointWindows,
  currentSignalPayloadHash,
  summarizeCurrentSignalRiskAudit,
  verifyCurrentSignalRuntimeEvidence,
  type CurrentSignalRuntimeEvidenceRow,
} from '../src/current-signal-runtime-evidence-core.js';

function samplePayload() {
  return {
    ledgerVersion:
      'v7.0-r4.10.3-current-signal-snapshot-ledger-v1',
    checkpoint: {
      minutes:
        90,
      label:
        'T-90',
      exactMinutesToKickoff:
        90,
      toleranceReason:
        'CURRENT_ANALYSIS_TERMINAL_AT_CHECKPOINT',
    },
    analysis: {
      providerFixtureId:
        123,
      localFixtureId:
        45,
      status:
        'NO_VALUE_SIGNAL',
      recommendation:
        null,
      candidates: [
        {
          marketType:
            'MATCH_WINNER',
          selection:
            'AWAY',
          rawSignalEligibleBeforeRiskGuard:
            true,
          currentSignalEligible:
            false,
          rejectionReasons: [
            'CURRENT_LIMITED_CONFIDENCE_LONGSHOT_BLOCKED',
          ],
          rankingVersion:
            'v7.0-r4.10.2.6-risk-adjusted-ranking-v1',
          signalTier:
            'LOW_CONFIDENCE_DIAGNOSTIC',
          adjustedModelProbability:
            0.18,
          conservativeProbability:
            0.16,
          conservativeEdge:
            -0.01,
          conservativeExpectedValue:
            -0.04,
          riskAdjustedScore:
            -0.22,
          quoteCount:
            3,
          quoteMedianOdds:
            5.8,
          quoteAgreementRatio:
            0.91,
          quoteOutlier:
            false,
        },
      ],
    },
    context: {
      latestLineupCapturedAt:
        null,
      latestInjuryCapturedAt:
        null,
    },
    integrity: {
      appendOnly:
        true,
      officialBestBetChanged:
        false,
      noFutureBackfill:
        true,
      externalApiCalled:
        false,
      automaticBetPlacement:
        false,
      realMoneyExecution:
        false,
    },
  };
}

function sampleRow(): CurrentSignalRuntimeEvidenceRow {
  const payload =
    samplePayload();

  return {
    id:
      1,
    providerFixtureId:
      123,
    localFixtureId:
      45,
    checkpointMinutes:
      90,
    checkpointLabel:
      'T-90',
    actualHorizonMinutes:
      90,
    snapshotAsOf:
      new Date(
        '2026-07-29T10:30:00.000Z',
      ),
    kickoffAt:
      new Date(
        '2026-07-29T12:00:00.000Z',
      ),
    status:
      'NO_VALUE_SIGNAL',
    sourceOddsUpdatedAt:
      new Date(
        '2026-07-29T10:20:00.000Z',
      ),
    sourceOddsFirstObservedAt:
      new Date(
        '2026-07-29T10:10:00.000Z',
      ),
    sourceOddsReobservedAt:
      new Date(
        '2026-07-29T10:20:00.000Z',
      ),
    sourceOddsFreshnessAt:
      new Date(
        '2026-07-29T10:20:00.000Z',
      ),
    candidateCount:
      1,
    currentEligibleCandidateCount:
      0,
    officialEligibleCandidateCount:
      0,
    analysisPayload:
      payload,
    snapshotHash:
      currentSignalPayloadHash(
        payload,
      ),
    createdAt:
      new Date(
        '2026-07-29T10:30:01.000Z',
      ),
  };
}

describe(
  'R4.10.3.3 current signal runtime evidence',
  () => {
    it(
      'hashes canonical JSON independently of object key order',
      () => {
        expect(
          currentSignalPayloadHash({
            b: 2,
            a: 1,
          }),
        ).toBe(
          currentSignalPayloadHash({
            a: 1,
            b: 2,
          }),
        );
      },
    );

    it(
      'summarizes persisted longshot risk fields',
      () => {
        expect(
          summarizeCurrentSignalRiskAudit(
            samplePayload(),
          ),
        ).toMatchObject({
          candidateCountInPayload:
            1,
          riskRankedCandidateCount:
            1,
          lowConfidenceDiagnosticCount:
            1,
          rawEligibleBeforeGuardCount:
            1,
          eligibleAfterGuardCount:
            0,
          longshotBlockedCount:
            1,
        });
      },
    );

    it(
      'passes a genuine append-only NO_VALUE_SIGNAL proof',
      () => {
        const proof =
          verifyCurrentSignalRuntimeEvidence({
            row:
              sampleRow(),
            duplicateKeyRows:
              1,
          });

        expect(
          proof.passed,
        ).toBe(
          true,
        );
      },
    );

    it(
      'fails when snapshot hash is not authentic',
      () => {
        const row =
          sampleRow();

        row.snapshotHash =
          '0'.repeat(
            64,
          );

        const proof =
          verifyCurrentSignalRuntimeEvidence({
            row,
            duplicateKeyRows:
              1,
          });

        expect(
          proof.passed,
        ).toBe(
          false,
        );

        expect(
          proof.checks.find(
            (
              item,
            ) =>
              item.name ===
              'snapshot payload hash',
          )?.passed,
        ).toBe(
          false,
        );
      },
    );

    it(
      'fails duplicate fixture/checkpoint evidence',
      () => {
        const proof =
          verifyCurrentSignalRuntimeEvidence({
            row:
              sampleRow(),
            duplicateKeyRows:
              2,
          });

        expect(
          proof.passed,
        ).toBe(
          false,
        );
      },
    );

    it(
      'orders genuine future checkpoint windows without creating backfill windows',
      () => {
        const now =
          new Date(
            '2026-07-29T10:00:00.000Z',
          );

        const windows =
          buildUpcomingCurrentSignalCheckpointWindows({
            fixtures: [
              {
                providerFixtureId:
                  10,
                kickoffAt:
                  new Date(
                    '2026-07-29T12:00:00.000Z',
                  ),
              },
            ],
            checkpoints: [
              90,
              30,
            ],
            toleranceMinutes:
              2,
            now,
            until:
              new Date(
                '2026-07-29T12:00:00.000Z',
              ),
          });

        expect(
          windows.map(
            (
              row,
            ) =>
              row.checkpointLabel,
          ),
        ).toEqual([
          'T-90',
          'T-30',
        ]);

        expect(
          windows[0]
            ?.windowStartsAt
            .toISOString(),
        ).toBe(
          '2026-07-29T10:28:00.000Z',
        );
      },
    );
  },
);
