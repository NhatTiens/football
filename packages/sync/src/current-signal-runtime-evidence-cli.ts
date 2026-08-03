import { prisma } from '@football-ai/database';

import {
  captureDueCurrentSignalSnapshots,
  getCurrentSignalSnapshotCoverage,
} from './current-signal-snapshot-engine.js';
import {
  parseCurrentSignalCheckpoints,
} from './current-signal-snapshot-core.js';
import {
  CURRENT_SIGNAL_RUNTIME_EVIDENCE_VERSION,
  buildUpcomingCurrentSignalCheckpointWindows,
  isCurrentSignalEvidenceTerminalStatus,
  verifyCurrentSignalRuntimeEvidence,
  type CurrentSignalRuntimeEvidenceRow,
} from './current-signal-runtime-evidence-core.js';

interface ProviderFixtureSnapshotRow {
  id: number;
  providerFixtureId: number;
  kickoffAt: Date;
  observedAt: Date;
}

function command(): string {
  return (
    process.argv[2] ??
    'schedule'
  )
    .trim()
    .toLowerCase();
}

function argument(
  name: string,
): string | null {
  const prefix =
    `--${name}=`;

  return (
    process.argv.find(
      (
        value: string,
      ): boolean =>
        value.startsWith(
          prefix,
        ),
    )?.slice(
      prefix.length,
    ) ??
    null
  );
}

function integerArgument(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw =
    argument(
      name,
    );

  if (raw == null) {
    return fallback;
  }

  const value =
    Number(
      raw,
    );

  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `--${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }

  return value;
}

function numberArgument(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw =
    argument(
      name,
    );

  if (raw == null) {
    return fallback;
  }

  const value =
    Number(
      raw,
    );

  if (
    !Number.isFinite(
      value,
    ) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `--${name} must be a number from ${minimum} to ${maximum}.`,
    );
  }

  return value;
}

function fixtureIds(): number[] | undefined {
  const raw =
    argument(
      'fixture',
    );

  if (raw == null) {
    return undefined;
  }

  const values =
    raw
      .split(
        ',',
      )
      .map(
        (
          value: string,
        ): number =>
          Number(
            value.trim(),
          ),
      )
      .filter(
        (
          value: number,
        ): boolean =>
          Number.isSafeInteger(
            value,
          ) &&
          value > 0,
      );

  if (
    values.length ===
    0
  ) {
    throw new Error(
      '--fixture must contain one or more positive provider fixture IDs.',
    );
  }

  return [
    ...new Set(
      values,
    ),
  ];
}

function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise<void>(
    (
      resolve,
    ) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function latestProviderFixtures(
  rows: ProviderFixtureSnapshotRow[],
): ProviderFixtureSnapshotRow[] {
  const latest =
    new Map<
      number,
      ProviderFixtureSnapshotRow
    >();

  for (
    const row of
    rows
  ) {
    const existing =
      latest.get(
        row.providerFixtureId,
      );

    if (
      existing == null ||
      row.observedAt.getTime() >
        existing.observedAt.getTime() ||
      (
        row.observedAt.getTime() ===
          existing.observedAt.getTime() &&
        row.id >
          existing.id
      )
    ) {
      latest.set(
        row.providerFixtureId,
        row,
      );
    }
  }

  return [
    ...latest.values(),
  ];
}

async function loadUpcomingProviderFixtures(input: {
  now: Date;
  until: Date;
  checkpoints: number[];
  toleranceMinutes: number;
  providerFixtureIds?: number[];
  maximumFixtures: number;
}): Promise<
  ProviderFixtureSnapshotRow[]
> {
  const maximumCheckpoint =
    Math.max(
      ...input.checkpoints,
    );

  const latestKickoff =
    new Date(
      input.until.getTime() +
      (
        maximumCheckpoint +
        input.toleranceMinutes +
        5
      ) *
      60_000,
    );

  const rows =
    (await prisma.apiFootballFixtureSnapshot.findMany({
      where: {
        providerFixtureId:
          input.providerFixtureIds == null
            ? undefined
            : {
                in:
                  input
                    .providerFixtureIds,
              },
        kickoffAt: {
          gt:
            input.now,
          lte:
            latestKickoff,
        },
      },
      select: {
        id: true,
        providerFixtureId: true,
        kickoffAt: true,
        observedAt: true,
      },
      orderBy: [
        {
          kickoffAt:
            'asc',
        },
        {
          id:
            'desc',
        },
      ],
      take:
        input.maximumFixtures *
        12,
    })) as ProviderFixtureSnapshotRow[];

  return latestProviderFixtures(
    rows,
  )
    .sort(
      (
        left:
          ProviderFixtureSnapshotRow,
        right:
          ProviderFixtureSnapshotRow,
      ): number =>
        left.kickoffAt.getTime() -
          right.kickoffAt.getTime() ||
        left.providerFixtureId -
          right.providerFixtureId,
    )
    .slice(
      0,
      input.maximumFixtures,
    );
}

async function upcomingSchedule(input: {
  now: Date;
  hours: number;
  providerFixtureIds?: number[];
  maximumFixtures?: number;
  limit?: number;
}): Promise<{
  version: string;
  now: string;
  until: string;
  checkpoints: number[];
  toleranceMinutes: number;
  providerFixtures: number;
  windows: Array<{
    providerFixtureId: number;
    kickoffAt: string;
    checkpointMinutes: number;
    checkpointLabel: string;
    targetAt: string;
    windowStartsAt: string;
    windowEndsAt: string;
    secondsUntilWindowStarts: number;
    alreadyCaptured: boolean;
  }>;
  nextUncapturedWindow: {
    providerFixtureId: number;
    checkpointLabel: string;
    windowStartsAt: string;
    targetAt: string;
    windowEndsAt: string;
  } | null;
  externalApiCalled: false;
  databaseWritten: false;
  realMoneyExecution: false;
}> {
  const checkpoints =
    parseCurrentSignalCheckpoints();

  const toleranceMinutes =
    numberArgument(
      'tolerance-minutes',
      Number(
        process.env
          .CURRENT_SIGNAL_SNAPSHOT_TOLERANCE_MINUTES ??
        2,
      ),
      0.25,
      10,
    );

  const until =
    new Date(
      input.now.getTime() +
      input.hours *
      60 *
      60_000,
    );

  const fixtures =
    await loadUpcomingProviderFixtures({
      now:
        input.now,
      until,
      checkpoints,
      toleranceMinutes,
      providerFixtureIds:
        input.providerFixtureIds,
      maximumFixtures:
        input.maximumFixtures ??
        300,
    });

  const existing =
    fixtures.length ===
      0
      ? []
      : await prisma.scientificCurrentSignalSnapshot.findMany({
          where: {
            providerFixtureId: {
              in:
                fixtures.map(
                  (
                    row:
                      ProviderFixtureSnapshotRow,
                  ): number =>
                    row
                      .providerFixtureId,
                ),
            },
            checkpointMinutes: {
              in:
                checkpoints,
            },
          },
          select: {
            providerFixtureId:
              true,
            checkpointMinutes:
              true,
          },
        });

  const existingKeys =
    existing.map(
      (
        row: {
          providerFixtureId: number;
          checkpointMinutes: number;
        },
      ): string =>
        `${row.providerFixtureId}:${row.checkpointMinutes}`,
    );

  const windows =
    buildUpcomingCurrentSignalCheckpointWindows({
      fixtures:
        fixtures.map(
          (
            row:
              ProviderFixtureSnapshotRow,
          ) => ({
            providerFixtureId:
              row.providerFixtureId,
            kickoffAt:
              row.kickoffAt,
          }),
        ),
      checkpoints,
      toleranceMinutes,
      now:
        input.now,
      until,
      alreadyCapturedKeys:
        existingKeys,
    });

  const limited =
    windows.slice(
      0,
      input.limit ??
      50,
    );

  const next =
    windows.find(
      (
        row,
      ): boolean =>
        !row.alreadyCaptured,
    ) ??
    null;

  return {
    version:
      CURRENT_SIGNAL_RUNTIME_EVIDENCE_VERSION,
    now:
      input.now.toISOString(),
    until:
      until.toISOString(),
    checkpoints,
    toleranceMinutes,
    providerFixtures:
      fixtures.length,
    windows:
      limited.map(
        (
          row,
        ) => ({
          providerFixtureId:
            row.providerFixtureId,
          kickoffAt:
            row.kickoffAt.toISOString(),
          checkpointMinutes:
            row.checkpointMinutes,
          checkpointLabel:
            row.checkpointLabel,
          targetAt:
            row.targetAt.toISOString(),
          windowStartsAt:
            row.windowStartsAt.toISOString(),
          windowEndsAt:
            row.windowEndsAt.toISOString(),
          secondsUntilWindowStarts:
            row.secondsUntilWindowStarts,
          alreadyCaptured:
            row.alreadyCaptured,
        }),
      ),
    nextUncapturedWindow:
      next == null
        ? null
        : {
            providerFixtureId:
              next.providerFixtureId,
            checkpointLabel:
              next.checkpointLabel,
            windowStartsAt:
              next.windowStartsAt.toISOString(),
            targetAt:
              next.targetAt.toISOString(),
            windowEndsAt:
              next.windowEndsAt.toISOString(),
          },
    externalApiCalled:
      false,
    databaseWritten:
      false,
    realMoneyExecution:
      false,
  };
}

const evidenceRowSelect = {
  id: true,
  providerFixtureId: true,
  localFixtureId: true,
  checkpointMinutes: true,
  checkpointLabel: true,
  actualHorizonMinutes: true,
  snapshotAsOf: true,
  kickoffAt: true,
  status: true,
  sourceOddsUpdatedAt: true,
  sourceOddsFirstObservedAt: true,
  sourceOddsReobservedAt: true,
  sourceOddsFreshnessAt: true,
  candidateCount: true,
  currentEligibleCandidateCount: true,
  officialEligibleCandidateCount: true,
  analysisPayload: true,
  snapshotHash: true,
  createdAt: true,
} as const;

async function proveRow(
  row:
    CurrentSignalRuntimeEvidenceRow,
) {
  const duplicateKeyRows =
    await prisma.scientificCurrentSignalSnapshot.count({
      where: {
        providerFixtureId:
          row.providerFixtureId,
        checkpointMinutes:
          row.checkpointMinutes,
      },
    });

  return verifyCurrentSignalRuntimeEvidence({
    row,
    duplicateKeyRows,
  });
}

async function latestTerminalEvidenceRow(
  createdAtGte?: Date,
  providerFixtureIds?: number[],
): Promise<
  CurrentSignalRuntimeEvidenceRow |
  null
> {
  return (
    (await prisma.scientificCurrentSignalSnapshot.findFirst({
      where: {
        providerFixtureId:
          providerFixtureIds == null
            ? undefined
            : {
                in:
                  providerFixtureIds,
              },
        status: {
          in: [
            'AVAILABLE',
            'NO_VALUE_SIGNAL',
          ],
        },
        createdAt:
          createdAtGte == null
            ? undefined
            : {
                gte:
                  createdAtGte,
              },
      },
      select:
        evidenceRowSelect,
      orderBy: [
        {
          createdAt:
            'desc',
        },
        {
          id:
            'desc',
        },
      ],
    })) as
      CurrentSignalRuntimeEvidenceRow |
      null
  );
}

async function proofCommand(): Promise<void> {
  const id =
    argument(
      'id',
    );

  const fixture =
    fixtureIds()?.[0];

  const row =
    id == null
      ? (
          (await prisma.scientificCurrentSignalSnapshot.findFirst({
            where: {
              providerFixtureId:
                fixture,
              status: {
                in: [
                  'AVAILABLE',
                  'NO_VALUE_SIGNAL',
                ],
              },
            },
            select:
              evidenceRowSelect,
            orderBy: [
              {
                createdAt:
                  'desc',
              },
              {
                id:
                  'desc',
              },
            ],
          })) as
            CurrentSignalRuntimeEvidenceRow |
            null
        )
      : (
          (await prisma.scientificCurrentSignalSnapshot.findUnique({
            where: {
              id:
                integerArgument(
                  'id',
                  0,
                  1,
                  2_147_483_647,
                ),
            },
            select:
              evidenceRowSelect,
          })) as
            CurrentSignalRuntimeEvidenceRow |
            null
        );

  if (row == null) {
    throw new Error(
      'NO_TERMINAL_CURRENT_SIGNAL_SNAPSHOT_EVIDENCE',
    );
  }

  const proof =
    await proveRow(
      row,
    );

  console.log(
    JSON.stringify(
      proof,
      null,
      2,
    ),
  );

  if (!proof.passed) {
    process.exitCode = 2;
  }
}

async function watchFirstCommand(): Promise<void> {
  const startedAt =
    new Date();

  const maxWaitMinutes =
    integerArgument(
      'max-wait-minutes',
      720,
      1,
      1440,
    );

  const pollSeconds =
    integerArgument(
      'poll-seconds',
      15,
      5,
      300,
    );

  const selectedFixtureIds =
    fixtureIds();

  const existing =
    await latestTerminalEvidenceRow(
      undefined,
      selectedFixtureIds,
    );

  if (existing != null) {
    const proof =
      await proveRow(
        existing,
      );

    console.log(
      JSON.stringify(
        {
          mode:
            'EXISTING_TERMINAL_EVIDENCE',
          proof,
        },
        null,
        2,
      ),
    );

    if (proof.passed) {
      return;
    }

    console.log(
      JSON.stringify(
        {
          event:
            'EXISTING_TERMINAL_EVIDENCE_REJECTED_CONTINUE_WATCHING',
          reason:
            'LEGACY_OR_INVALID_PROOF_DOES_NOT_AUTHORIZE_NEW_EVIDENCE',
          rejectedRowId:
            existing.id,
          rejectedProviderFixtureId:
            existing.providerFixtureId,
          appendOnlyRowChanged:
            false,
        },
        null,
        2,
      ),
    );
  }

  const deadline =
    new Date(
      startedAt.getTime() +
      maxWaitMinutes *
      60_000,
    );

  if (
    selectedFixtureIds != null
  ) {
    const selectedFixtureSchedule =
      await upcomingSchedule({
        now:
          startedAt,
        hours:
          Math.max(
            1,
            maxWaitMinutes /
              60,
          ),
        providerFixtureIds:
          selectedFixtureIds,
        maximumFixtures:
          selectedFixtureIds
            .length,
        limit:
          Math.max(
            1,
            selectedFixtureIds
              .length *
              5,
          ),
      });

    if (
      selectedFixtureSchedule
        .nextUncapturedWindow ==
      null
    ) {
      console.log(
        JSON.stringify(
          {
            event:
              'NO_FUTURE_CHECKPOINT_WINDOW_FOR_SELECTED_FIXTURE',
            providerFixtureIds:
              selectedFixtureIds,
            reason:
              'FIXTURE_MAY_BE_FINISHED_OR_OUTSIDE_THE_SELECTED_WAIT_HORIZON',
            schedule:
              selectedFixtureSchedule,
            databaseWritten:
              false,
            externalApiCalled:
              false,
            realMoneyExecution:
              false,
          },
          null,
          2,
        ),
      );

      process.exitCode =
        4;
      return;
    }
  }

  console.log(
    JSON.stringify(
      {
        version:
          CURRENT_SIGNAL_RUNTIME_EVIDENCE_VERSION,
        mode:
          'WAIT_FOR_FIRST_GENUINE_CHECKPOINT',
        startedAt:
          startedAt.toISOString(),
        deadline:
          deadline.toISOString(),
        pollSeconds,
        providerFixtureIds:
          selectedFixtureIds ??
          null,
        externalApiCalled:
          false,
        databaseWritePolicy:
          'APPEND_ONLY_DUE_CHECKPOINT_ONLY',
        noFutureBackfill:
          true,
        realMoneyExecution:
          false,
      },
      null,
      2,
    ),
  );

  let lastScheduleFingerprint =
    '';

  while (
    Date.now() <=
    deadline.getTime()
  ) {
    const now =
      new Date();

    const capture =
      await captureDueCurrentSignalSnapshots({
        now,
        providerFixtureIds:
          selectedFixtureIds,
      });

    if (
      capture.inserted > 0
    ) {
      console.log(
        JSON.stringify(
          {
            event:
              'CHECKPOINT_ROWS_INSERTED',
            capturedAt:
              capture.capturedAt,
            inserted:
              capture.inserted,
            rows:
              capture.rows.filter(
                (
                  row,
                ): boolean =>
                  row.writeStatus ===
                  'INSERTED',
              ),
          },
          null,
          2,
        ),
      );
    }

    const evidence =
      await latestTerminalEvidenceRow(
        startedAt,
        selectedFixtureIds,
      );

    if (evidence != null) {
      const proof =
        await proveRow(
          evidence,
        );

      console.log(
        JSON.stringify(
          {
            event:
              'FIRST_REAL_CURRENT_SIGNAL_EVIDENCE',
            proof,
          },
          null,
          2,
        ),
      );

      if (!proof.passed) {
        process.exitCode = 2;
      }

      return;
    }

    const schedule =
      await upcomingSchedule({
        now,
        hours:
          Math.max(
            1,
            (
              deadline.getTime() -
              now.getTime()
            ) /
            3_600_000,
          ),
        providerFixtureIds:
          selectedFixtureIds,
        maximumFixtures:
          300,
        limit:
          5,
      });

    const fingerprint =
      JSON.stringify(
        schedule
          .nextUncapturedWindow,
      );

    if (
      fingerprint !==
      lastScheduleFingerprint
    ) {
      console.log(
        JSON.stringify(
          {
            event:
              'NEXT_GENUINE_CHECKPOINT_WINDOW',
            checkedAt:
              now.toISOString(),
            next:
              schedule
                .nextUncapturedWindow,
            currentCoverage:
              await getCurrentSignalSnapshotCoverage(),
          },
          null,
          2,
        ),
      );

      lastScheduleFingerprint =
        fingerprint;
    }

    await sleep(
      pollSeconds *
      1_000,
    );
  }

  const finalSchedule =
    await upcomingSchedule({
      now:
        new Date(),
      hours:
        24,
      providerFixtureIds:
        selectedFixtureIds,
      maximumFixtures:
        300,
      limit:
        10,
    });

  console.log(
    JSON.stringify(
      {
        event:
          'WATCH_TIMEOUT_WITHOUT_TERMINAL_EVIDENCE',
        startedAt:
          startedAt.toISOString(),
        deadline:
          deadline.toISOString(),
        finalSchedule,
        externalApiCalled:
          false,
        databaseWritten:
          false,
        realMoneyExecution:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 3;
}

async function main(): Promise<void> {
  const selectedCommand =
    command();

  if (
    selectedCommand ===
    'schedule'
  ) {
    console.log(
      JSON.stringify(
        await upcomingSchedule({
          now:
            new Date(),
          hours:
            numberArgument(
              'hours',
              24,
              1,
              168,
            ),
          providerFixtureIds:
            fixtureIds(),
          maximumFixtures:
            integerArgument(
              'max-fixtures',
              300,
              1,
              1000,
            ),
          limit:
            integerArgument(
              'limit',
              50,
              1,
              500,
            ),
        }),
        null,
        2,
      ),
    );

    return;
  }

  if (
    selectedCommand ===
    'watch-first'
  ) {
    await watchFirstCommand();
    return;
  }

  if (
    selectedCommand ===
    'proof'
  ) {
    await proofCommand();
    return;
  }

  throw new Error(
    'Use schedule, watch-first, or proof.',
  );
}

main()
  .catch(
    (
      error: unknown,
    ) => {
      console.error(
        error,
      );
      process.exitCode = 1;
    },
  )
  .finally(
    async () => {
      await prisma.$disconnect();
    },
  );
