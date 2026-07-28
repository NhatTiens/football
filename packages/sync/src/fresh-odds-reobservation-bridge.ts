import { prisma } from '@football-ai/database';

import {
  normalizeApiFootballPrematchOdds,
  type NormalizedApiFootballOdds,
} from './api-football-contract.js';
import type {
  LiveOddsRow,
} from './real-odds-paper-bet-core.js';

export const FRESH_ODDS_REOBSERVATION_BRIDGE_VERSION =
  'v7.0-r4.10.2.2-fresh-odds-reobservation-bridge-v1';

export const REOBSERVATION_RAW_KINDS = [
  'EARLY_PREMATCH_ODDS_DISCOVERY',
  'FRESH_PREMATCH_ODDS_HORIZON',
] as const;

export type OddsFreshnessBasis =
  | 'SOURCE_EFFECTIVE_AT'
  | 'REOBSERVED_AT';

export interface ReobservationOddsRow
  extends LiveOddsRow {
  betId: number;
}

interface RawOddsAttemptRow {
  id: number;
  kind: string;
  providerFixtureId: number | null;
  observedAt: Date;
  rawPayload: unknown;
}

interface ReobservedVersion {
  key: string;
  providerFixtureId: number;
  observedAt: Date;
  rawSnapshotId: number;
  rawKind: string;
}

export interface OddsFreshnessEvidence {
  sourceOddsSnapshotId: number;
  providerFixtureId: number;
  basis: OddsFreshnessBasis;
  freshnessAt: Date;
  sourceUpdatedAt: Date | null;
  firstObservedAt: Date;
  reobservedAt: Date | null;
  reobservationRawSnapshotId: number | null;
  reobservationKind: string | null;
  sourceAgeMinutes: number;
  reobservationAgeMinutes: number | null;
}

export interface OddsFreshnessSummary {
  providerFixtureId: number;
  maximumAgeMinutes: number;
  storedRowsExamined: number;
  activeRows: number;
  sourceFreshRows: number;
  reobservedRows: number;
  latestRawAttemptAt: string | null;
  latestRawAttemptKind: string | null;
  latestRawAttemptHadOdds: boolean | null;
  normalizedVersionsInLatestAttempt: number;
  matchedStoredRows: number;
  unmatchedReobservedVersions: number;
  latestFreshnessAt: string | null;
  policy:
    | 'LATEST_RAW_ATTEMPT_AUTHORITATIVE'
    | 'SOURCE_FRESHNESS_FALLBACK';
}

export interface FreshReobservedOddsResolution {
  activeOddsRows: ReobservationOddsRow[];
  evidenceBySnapshotId:
    Map<number, OddsFreshnessEvidence>;
  summaryByFixture:
    Map<number, OddsFreshnessSummary>;
}

const ODDS_TOKEN_DIGITS = 8;
const LINE_TOKEN_DIGITS = 3;

function lineToken(
  value: number | null,
): string {
  return value == null
    ? 'NONE'
    : value.toFixed(
        LINE_TOKEN_DIGITS,
      );
}

function oddsToken(
  value: number,
): string {
  return value.toFixed(
    ODDS_TOKEN_DIGITS,
  );
}

function sourceToken(
  value: Date | null,
): string {
  return value?.toISOString() ??
    'NO_SOURCE_UPDATED_AT';
}

function versionKey(input: {
  providerFixtureId: number;
  sourceUpdatedAt: Date | null;
  bookmakerId: number;
  betId: number;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
}): string {
  return [
    input.providerFixtureId,
    sourceToken(
      input.sourceUpdatedAt,
    ),
    input.bookmakerId,
    input.betId,
    input.marketType,
    input.selection,
    lineToken(
      input.lineValue,
    ),
    oddsToken(
      input.decimalOdds,
    ),
  ].join('::');
}

export function storedOddsVersionKey(
  row: ReobservationOddsRow,
): string {
  return versionKey({
    providerFixtureId:
      row.providerFixtureId,
    sourceUpdatedAt:
      row.sourceUpdatedAt,
    bookmakerId:
      row.bookmakerId,
    betId:
      row.betId,
    marketType:
      row.marketType,
    selection:
      row.selection,
    lineValue:
      row.lineValue,
    decimalOdds:
      row.decimalOdds,
  });
}

export function normalizedOddsVersionKey(
  row: NormalizedApiFootballOdds,
): string {
  return versionKey({
    providerFixtureId:
      row.providerFixtureId,
    sourceUpdatedAt:
      row.sourceUpdatedAt,
    bookmakerId:
      row.bookmakerId,
    betId:
      row.betId,
    marketType:
      row.marketType,
    selection:
      row.selection,
    lineValue:
      row.lineValue,
    decimalOdds:
      row.decimalOdds,
  });
}

function ageMinutes(
  now: Date,
  then: Date,
): number {
  return Math.max(
    0,
    (
      now.getTime() -
      then.getTime()
    ) /
    60_000,
  );
}

function latestRawAttemptByFixture(
  rows: RawOddsAttemptRow[],
): Map<number, RawOddsAttemptRow> {
  const latest =
    new Map<
      number,
      RawOddsAttemptRow
    >();

  for (const row of rows) {
    if (
      row.providerFixtureId == null ||
      latest.has(
        row.providerFixtureId,
      )
    ) {
      continue;
    }

    latest.set(
      row.providerFixtureId,
      row,
    );
  }

  return latest;
}

// R410253_RAW_SNAPSHOT_SORT_MEMORY_GUARD
interface RawAttemptMaximumObservedAt {
  _max: {
    observedAt: Date | null;
  };
}

async function mapWithBoundedConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (
    value: TInput,
    index: number,
  ) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (
    !Number.isSafeInteger(
      concurrency,
    ) ||
    concurrency < 1
  ) {
    throw new RangeError(
      'concurrency must be a positive integer.',
    );
  }

  const output =
    new Array<TOutput>(
      values.length,
    );

  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index =
        nextIndex;

      nextIndex += 1;

      if (index >= values.length) {
        return;
      }

      output[index] =
        await mapper(
          values[index]!,
          index,
        );
    }
  }

  const workerCount =
    Math.min(
      concurrency,
      values.length,
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      async (): Promise<void> =>
        worker(),
    ),
  );

  return output;
}

async function loadLatestRawAttemptsWithoutGlobalSort(
  input: {
    providerFixtureIds: number[];
    cutoff: Date;
    now: Date;
  },
): Promise<RawOddsAttemptRow[]> {
  if (
    input.providerFixtureIds.length ===
    0
  ) {
    return [];
  }

  const rows =
    await mapWithBoundedConcurrency(
      input.providerFixtureIds,
      4,
      async (
        providerFixtureId: number,
      ): Promise<
        RawOddsAttemptRow | null
      > => {
        const maximum =
          (await prisma.apiFootballDataSnapshot.aggregate({
            where: {
              kind: {
                in: [
                  ...REOBSERVATION_RAW_KINDS,
                ],
              },
              providerFixtureId,
              observedAt: {
                gte:
                  input.cutoff,
                lte:
                  input.now,
              },
            },
            _max: {
              observedAt: true,
            },
          })) as RawAttemptMaximumObservedAt;

        const maximumObservedAt =
          maximum._max.observedAt;

        if (
          maximumObservedAt == null
        ) {
          return null;
        }

        return (
          (await prisma.apiFootballDataSnapshot.findFirst({
            where: {
              kind: {
                in: [
                  ...REOBSERVATION_RAW_KINDS,
                ],
              },
              providerFixtureId,
              observedAt:
                maximumObservedAt,
            },
            select: {
              id: true,
              kind: true,
              providerFixtureId: true,
              observedAt: true,
              rawPayload: true,
            },
            orderBy: {
              id: 'desc',
            },
          })) as RawOddsAttemptRow | null
        );
      },
    );

  return rows.filter(
    (
      row:
        RawOddsAttemptRow | null,
    ): row is RawOddsAttemptRow =>
      row != null,
  );
}

function emptySummary(input: {
  providerFixtureId: number;
  maximumAgeMinutes: number;
  storedRowsExamined: number;
}): OddsFreshnessSummary {
  return {
    providerFixtureId:
      input.providerFixtureId,
    maximumAgeMinutes:
      input.maximumAgeMinutes,
    storedRowsExamined:
      input.storedRowsExamined,
    activeRows: 0,
    sourceFreshRows: 0,
    reobservedRows: 0,
    latestRawAttemptAt: null,
    latestRawAttemptKind: null,
    latestRawAttemptHadOdds: null,
    normalizedVersionsInLatestAttempt: 0,
    matchedStoredRows: 0,
    unmatchedReobservedVersions: 0,
    latestFreshnessAt: null,
    policy:
      'SOURCE_FRESHNESS_FALLBACK',
  };
}

export function emptyOddsFreshnessSummary(
  providerFixtureId: number,
  maximumAgeMinutes: number,
): OddsFreshnessSummary {
  return emptySummary({
    providerFixtureId,
    maximumAgeMinutes,
    storedRowsExamined: 0,
  });
}

export async function resolveFreshReobservedOdds(
  input: {
    providerFixtureIds: number[];
    oddsRows: ReobservationOddsRow[];
    now: Date;
    maximumAgeMinutes: number;
  },
): Promise<FreshReobservedOddsResolution> {
  if (
    !Number.isFinite(
      input.now.getTime(),
    )
  ) {
    throw new TypeError(
      'now must be a valid Date.',
    );
  }

  if (
    !Number.isFinite(
      input.maximumAgeMinutes,
    ) ||
    input.maximumAgeMinutes <= 0
  ) {
    throw new RangeError(
      'maximumAgeMinutes must be positive.',
    );
  }

  const providerFixtureIds = [
    ...new Set(
      input.providerFixtureIds.filter(
        (value: number): boolean =>
          Number.isSafeInteger(
            value,
          ) &&
          value > 0,
      ),
    ),
  ];

  const cutoff =
    new Date(
      input.now.getTime() -
        input.maximumAgeMinutes *
          60_000,
    );

  const rowsByFixture =
    new Map<
      number,
      ReobservationOddsRow[]
    >();

  for (
    const row of input.oddsRows
  ) {
    const rows =
      rowsByFixture.get(
        row.providerFixtureId,
      ) ?? [];

    rows.push(row);

    rowsByFixture.set(
      row.providerFixtureId,
      rows,
    );
  }

  const rawRows =
    await loadLatestRawAttemptsWithoutGlobalSort({
      providerFixtureIds,
      cutoff,
      now:
        input.now,
    });

  const latestRaw =
    latestRawAttemptByFixture(
      rawRows,
    );

  const activeOddsRows:
    ReobservationOddsRow[] = [];

  const evidenceBySnapshotId =
    new Map<
      number,
      OddsFreshnessEvidence
    >();

  const summaryByFixture =
    new Map<
      number,
      OddsFreshnessSummary
    >();

  for (
    const providerFixtureId of
    providerFixtureIds
  ) {
    const storedRows =
      rowsByFixture.get(
        providerFixtureId,
      ) ?? [];

    const latestAttempt =
      latestRaw.get(
        providerFixtureId,
      ) ?? null;

    const summary =
      emptySummary({
        providerFixtureId,
        maximumAgeMinutes:
          input.maximumAgeMinutes,
        storedRowsExamined:
          storedRows.length,
      });

    const latestFreshnessTimes:
      Date[] = [];

    if (
      latestAttempt != null
    ) {
      summary.policy =
        'LATEST_RAW_ATTEMPT_AUTHORITATIVE';
      summary.latestRawAttemptAt =
        latestAttempt.observedAt
          .toISOString();
      summary.latestRawAttemptKind =
        latestAttempt.kind;

      const normalized =
        normalizeApiFootballPrematchOdds(
          latestAttempt.rawPayload,
          latestAttempt.observedAt,
        ).filter(
          (
            row: NormalizedApiFootballOdds,
          ): boolean =>
            row.providerFixtureId ===
              providerFixtureId &&
            row.pitUsable,
        );

      summary.latestRawAttemptHadOdds =
        normalized.length > 0;
      summary.normalizedVersionsInLatestAttempt =
        normalized.length;

      const reobservedVersions =
        new Map<
          string,
          ReobservedVersion
        >();

      for (
        const row of normalized
      ) {
        const key =
          normalizedOddsVersionKey(
            row,
          );

        if (
          !reobservedVersions.has(
            key,
          )
        ) {
          reobservedVersions.set(
            key,
            {
              key,
              providerFixtureId,
              observedAt:
                latestAttempt
                  .observedAt,
              rawSnapshotId:
                latestAttempt.id,
              rawKind:
                latestAttempt.kind,
            },
          );
        }
      }

      const matchedKeys =
        new Set<string>();

      for (
        const row of storedRows
      ) {
        const key =
          storedOddsVersionKey(
            row,
          );

        const reobserved =
          reobservedVersions.get(
            key,
          );

        if (
          reobserved == null
        ) {
          continue;
        }

        matchedKeys.add(
          key,
        );

        activeOddsRows.push(
          row,
        );

        const sourceEffectiveAt =
          row.sourceUpdatedAt ??
          row.observedAt;

        const freshnessAt =
          reobserved.observedAt;

        latestFreshnessTimes.push(
          freshnessAt,
        );

        const sourceFresh =
          sourceEffectiveAt.getTime() >=
          cutoff.getTime();

        if (sourceFresh) {
          summary.sourceFreshRows += 1;
        }

        summary.reobservedRows += 1;
        summary.matchedStoredRows += 1;

        evidenceBySnapshotId.set(
          row.id,
          {
            sourceOddsSnapshotId:
              row.id,
            providerFixtureId,
            basis:
              'REOBSERVED_AT',
            freshnessAt,
            sourceUpdatedAt:
              row.sourceUpdatedAt,
            firstObservedAt:
              row.observedAt,
            reobservedAt:
              reobserved.observedAt,
            reobservationRawSnapshotId:
              reobserved
                .rawSnapshotId,
            reobservationKind:
              reobserved.rawKind,
            sourceAgeMinutes:
              ageMinutes(
                input.now,
                sourceEffectiveAt,
              ),
            reobservationAgeMinutes:
              ageMinutes(
                input.now,
                reobserved.observedAt,
              ),
          },
        );
      }

      summary.unmatchedReobservedVersions =
        [...reobservedVersions.keys()]
          .filter(
            (key: string): boolean =>
              !matchedKeys.has(
                key,
              ),
          )
          .length;
    } else {
      // Fallback only when there is no recent raw API attempt.
      // This preserves the existing source/first-observed freshness rule.
      for (
        const row of storedRows
      ) {
        const sourceEffectiveAt =
          row.sourceUpdatedAt ??
          row.observedAt;

        if (
          sourceEffectiveAt.getTime() <
            cutoff.getTime() ||
          sourceEffectiveAt.getTime() >
            input.now.getTime()
        ) {
          continue;
        }

        activeOddsRows.push(
          row,
        );

        latestFreshnessTimes.push(
          sourceEffectiveAt,
        );

        summary.sourceFreshRows += 1;

        evidenceBySnapshotId.set(
          row.id,
          {
            sourceOddsSnapshotId:
              row.id,
            providerFixtureId,
            basis:
              'SOURCE_EFFECTIVE_AT',
            freshnessAt:
              sourceEffectiveAt,
            sourceUpdatedAt:
              row.sourceUpdatedAt,
            firstObservedAt:
              row.observedAt,
            reobservedAt: null,
            reobservationRawSnapshotId:
              null,
            reobservationKind: null,
            sourceAgeMinutes:
              ageMinutes(
                input.now,
                sourceEffectiveAt,
              ),
            reobservationAgeMinutes:
              null,
          },
        );
      }
    }

    summary.activeRows =
      latestFreshnessTimes.length;

    summary.latestFreshnessAt =
      latestFreshnessTimes
        .sort(
          (
            left: Date,
            right: Date,
          ): number =>
            right.getTime() -
            left.getTime(),
        )[0]
        ?.toISOString() ??
      null;

    summaryByFixture.set(
      providerFixtureId,
      summary,
    );
  }

  return {
    activeOddsRows,
    evidenceBySnapshotId,
    summaryByFixture,
  };
}
