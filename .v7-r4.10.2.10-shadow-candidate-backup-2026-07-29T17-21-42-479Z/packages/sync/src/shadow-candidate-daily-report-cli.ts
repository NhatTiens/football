import { prisma } from '@football-ai/database';

import type {
  ShadowCandidateClassification,
} from './shadow-candidate-core.js';

interface SnapshotPayload {
  shadowCandidate?:
    ShadowCandidateClassification;
  analysis?: {
    status?: string;
  };
}

function hoursArgument(): number {
  const index =
    process.argv.indexOf(
      '--hours',
    );

  if (index < 0) {
    return 24;
  }

  const value =
    Number(
      process.argv[index + 1],
    );

  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 720
  ) {
    throw new Error(
      '--hours must be an integer from 1 to 720.',
    );
  }

  return value;
}

function increment(
  map: Map<string, number>,
  key: string,
): void {
  map.set(
    key,
    (map.get(key) ?? 0) + 1,
  );
}

function mapRows(
  map: Map<string, number>,
): Array<{
  key: string;
  rows: number;
}> {
  return [...map.entries()]
    .map(
      ([key, rows]) => ({
        key,
        rows,
      }),
    )
    .sort(
      (
        left,
        right,
      ): number =>
        right.rows -
          left.rows ||
        left.key.localeCompare(
          right.key,
        ),
    );
}

async function main(): Promise<void> {
  const hours =
    hoursArgument();

  const now =
    new Date();

  const since =
    new Date(
      now.getTime() -
        hours * 60 * 60 * 1000,
    );

  const rows =
    await prisma.scientificCurrentSignalSnapshot.findMany({
      where: {
        createdAt: {
          gte: since,
        },
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
    });

  const byMarket =
    new Map<string, number>();
  const byTier =
    new Map<string, number>();
  const byCheckpoint =
    new Map<string, number>();
  const byAnalysisStatus =
    new Map<string, number>();

  let withShadow = 0;
  let diagnosticTracking = 0;
  let provisionalValue = 0;
  let currentValue = 0;
  let officialEligibleObserved = 0;
  let invalidSafetyRows = 0;

  const latest = [] as Array<{
    snapshotId: number;
    providerFixtureId: number;
    checkpointMinutes: number;
    snapshotAsOf: string;
    analysisStatus: string;
    shadowStatus: string | null;
    market: string | null;
    selection: string | null;
    odds: number | null;
    shadowTier: string | null;
    riskAdjustedScore: number | null;
    conservativeExpectedValue: number | null;
    officialEligible: boolean;
  }>;

  for (const row of rows) {
    const payload =
      row.analysisPayload as unknown as SnapshotPayload;

    const shadow =
      payload.shadowCandidate ??
      null;

    increment(
      byCheckpoint,
      `T-${row.checkpointMinutes}`,
    );
    increment(
      byAnalysisStatus,
      row.status,
    );

    if (
      shadow == null ||
      shadow.status !==
        'SHADOW_CANDIDATE' ||
      shadow.selected == null
    ) {
      continue;
    }

    withShadow += 1;

    increment(
      byMarket,
      shadow.selected.marketType,
    );
    increment(
      byTier,
      shadow.selected.shadowTier,
    );

    if (
      shadow.selected.shadowTier ===
      'DIAGNOSTIC_TRACKING_SHADOW'
    ) {
      diagnosticTracking += 1;
    }

    if (
      shadow.selected.shadowTier ===
      'PROVISIONAL_VALUE_SHADOW'
    ) {
      provisionalValue += 1;
    }

    if (
      shadow.selected.shadowTier ===
      'CURRENT_VALUE_SHADOW'
    ) {
      currentValue += 1;
    }

    if (
      shadow.selected.officialEligible
    ) {
      officialEligibleObserved += 1;
    }

    if (
      shadow.selected.shadowOnly !==
        true ||
      shadow.selected.stakeEligible !==
        false ||
      shadow.automaticBetPlacement !==
        false ||
      shadow.realMoneyExecution !==
        false
    ) {
      invalidSafetyRows += 1;
    }

    if (latest.length < 20) {
      latest.push({
        snapshotId:
          row.id,
        providerFixtureId:
          row.providerFixtureId,
        checkpointMinutes:
          row.checkpointMinutes,
        snapshotAsOf:
          row.snapshotAsOf.toISOString(),
        analysisStatus:
          row.status,
        shadowStatus:
          shadow.status,
        market:
          shadow.selected.marketType,
        selection:
          shadow.selected.selection,
        odds:
          shadow.selected.decimalOdds,
        shadowTier:
          shadow.selected.shadowTier,
        riskAdjustedScore:
          shadow.selected.riskAdjustedScore,
        conservativeExpectedValue:
          shadow.selected.conservativeExpectedValue,
        officialEligible:
          shadow.selected.officialEligible,
      });
    }
  }

  const fixtures =
    new Set(
      rows.map(
        (row): number =>
          row.providerFixtureId,
      ),
    ).size;

  console.log(
    JSON.stringify(
      {
        event:
          'BETA2A_FRESH_SHADOW_DAILY_REPORT',
        window: {
          hours,
          since:
            since.toISOString(),
          until:
            now.toISOString(),
        },
        totals: {
          snapshotRows:
            rows.length,
          fixtures,
          rowsWithShadowCandidate:
            withShadow,
          currentValueShadow:
            currentValue,
          provisionalValueShadow:
            provisionalValue,
          diagnosticTrackingShadow:
            diagnosticTracking,
          officialEligibleObservedWithoutPromotion:
            officialEligibleObserved,
          invalidSafetyRows,
        },
        byCheckpoint:
          mapRows(
            byCheckpoint,
          ),
        byAnalysisStatus:
          mapRows(
            byAnalysisStatus,
          ),
        byMarket:
          mapRows(
            byMarket,
          ),
        byShadowTier:
          mapRows(
            byTier,
          ),
        latest,
        passed:
          invalidSafetyRows === 0,
        appendOnlySource:
          'ScientificCurrentSignalSnapshot.analysisPayload.shadowCandidate',
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
}

let exitCode = 0;

try {
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
