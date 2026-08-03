import { prisma } from '@football-ai/database';

import {
  SHADOW_CANDIDATE_LEDGER_VERSION,
  type ShadowCandidateClassification,
} from './shadow-candidate-core.js';

interface SnapshotPayload {
  shadowCandidate?:
    ShadowCandidateClassification;
  analysis?: {
    candidates?: Array<{
      marketType?: string;
      selection?: string;
      lineValue?: number | null;
      decimalOdds?: number;
    }>;
  };
  integrity?: {
    appendOnly?: boolean;
    officialBestBetChanged?: boolean;
    automaticBetPlacement?: boolean;
    realMoneyExecution?: boolean;
  };
}

function fixtureArgument(): number | null {
  const index =
    process.argv.indexOf(
      '--fixture',
    );

  if (index < 0) {
    return null;
  }

  const value =
    Number(
      process.argv[index + 1],
    );

  return Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function sameLine(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  return (
    left == null &&
    right == null
  ) ||
    (
      typeof left === 'number' &&
      typeof right === 'number' &&
      Math.abs(
        left -
          right,
      ) < 1e-9
    );
}

async function main(): Promise<number> {
  const fixture =
    fixtureArgument();

  const rows =
    await prisma.scientificCurrentSignalSnapshot.findMany({
      where: {
        providerFixtureId:
          fixture ??
          undefined,
      },
      select: {
        id: true,
        providerFixtureId: true,
        checkpointMinutes: true,
        status: true,
        snapshotAsOf: true,
        kickoffAt: true,
        createdAt: true,
        analysisPayload: true,
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take: 200,
    });

  const matched =
    rows
      .map(
        (row) => ({
          row,
          payload:
            row.analysisPayload as unknown as SnapshotPayload,
        }),
      )
      .find(
        ({ payload }): boolean =>
          payload.shadowCandidate
            ?.version ===
          SHADOW_CANDIDATE_LEDGER_VERSION,
      );

  if (matched == null) {
    console.log(
      JSON.stringify(
        {
          event:
            'R4.10.2.10_NO_POST_PATCH_SHADOW_SNAPSHOT_YET',
          passed:
            false,
          fixture,
          rowsInspected:
            rows.length,
          action:
            'KEEP_NPM_RUN_DEV_RUNNING_UNTIL_NEXT_REAL_CHECKPOINT',
          externalApiCalled:
            false,
          databaseWritten:
            false,
          automaticBetPlacement:
            false,
          realMoneyExecution:
            false,
        },
        null,
        2,
      ),
    );

    return 3;
  }

  const {
    row,
    payload,
  } = matched;

  const shadow =
    payload.shadowCandidate as ShadowCandidateClassification;

  const selected =
    shadow.selected;

  const matchingCandidate =
    selected == null
      ? null
      : (
          payload.analysis
            ?.candidates ??
          []
        ).find(
          (candidate): boolean =>
            candidate.marketType ===
              selected.marketType &&
            candidate.selection ===
              selected.selection &&
            sameLine(
              candidate.lineValue,
              selected.lineValue,
            ) &&
            candidate.decimalOdds ===
              selected.decimalOdds,
        ) ??
        null;

  const duplicateKeyRows =
    await prisma.scientificCurrentSignalSnapshot.count({
      where: {
        providerFixtureId:
          row.providerFixtureId,
        checkpointMinutes:
          row.checkpointMinutes,
      },
    });

  const checks = [
    {
      name:
        'shadow classification version',
      passed:
        shadow.version ===
        SHADOW_CANDIDATE_LEDGER_VERSION,
      detail:
        shadow.version,
    },
    {
      name:
        'append-only fixture/checkpoint key',
      passed:
        duplicateKeyRows === 1,
      detail:
        `rows=${duplicateKeyRows}`,
    },
    {
      name:
        'shadow selected candidate lineage',
      passed:
        shadow.status ===
          'SHADOW_NO_CANDIDATE' ||
        matchingCandidate != null,
      detail:
        selected == null
          ? 'selected=null'
          : `${selected.marketType}:${selected.selection}@${selected.decimalOdds}`,
    },
    {
      name:
        'shadow only',
      passed:
        selected == null ||
        selected.shadowOnly ===
          true,
      detail:
        `shadowOnly=${String(selected?.shadowOnly ?? null)}`,
    },
    {
      name:
        'stake disabled',
      passed:
        selected == null ||
        selected.stakeEligible ===
          false,
      detail:
        `stakeEligible=${String(selected?.stakeEligible ?? null)}`,
    },
    {
      name:
        'official BEST BET unchanged',
      passed:
        shadow.officialBestBetChanged ===
          false &&
        payload.integrity
          ?.officialBestBetChanged !==
          true,
      detail:
        `shadow=${String(shadow.officialBestBetChanged)}`,
    },
    {
      name:
        'no automatic or real-money execution',
      passed:
        shadow.automaticBetPlacement ===
          false &&
        shadow.realMoneyExecution ===
          false &&
        payload.integrity
          ?.automaticBetPlacement !==
          true &&
        payload.integrity
          ?.realMoneyExecution !==
          true,
      detail:
        'automaticBetPlacement=false; realMoneyExecution=false',
    },
  ];

  const passed =
    checks.every(
      (check): boolean =>
        check.passed,
    );

  console.log(
    JSON.stringify(
      {
        event:
          'R4.10.2.10_PERSISTED_SHADOW_CANDIDATE_PROOF',
        passed,
        row: {
          id:
            row.id,
          providerFixtureId:
            row.providerFixtureId,
          checkpointMinutes:
            row.checkpointMinutes,
          status:
            row.status,
          snapshotAsOf:
            row.snapshotAsOf.toISOString(),
          kickoffAt:
            row.kickoffAt.toISOString(),
          createdAt:
            row.createdAt.toISOString(),
        },
        shadowCandidate:
          shadow,
        checks,
        externalApiCalled:
          false,
        databaseWritten:
          false,
        officialBestBetChanged:
          false,
        automaticBetPlacement:
          false,
        realMoneyExecution:
          false,
      },
      null,
      2,
    ),
  );

  return passed
    ? 0
    : 2;
}

let exitCode = 0;

try {
  exitCode =
    await main();
} catch (error) {
  exitCode = 2;

  console.error(
    error instanceof Error
      ? error.stack ??
          error.message
      : String(error),
  );
} finally {
  await prisma.$disconnect();
  process.exitCode =
    exitCode;
}
