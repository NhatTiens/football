import { prisma } from '@football-ai/database';

import {
  selectCurrentShadowCandidate,
  type CurrentShadowCandidateDecision,
} from './current-shadow-candidate-core.js';

type AnyRecord = Record<string, unknown>;

interface SnapshotRow {
  id: number;
  providerFixtureId: number;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: Date;
  kickoffAt: Date;
  status: string;
  analysisPayload: unknown;
  snapshotHash: string;
}

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function decisionFromPayload(value: unknown): CurrentShadowCandidateDecision {
  const payload = record(value);
  const persisted = record(payload?.shadowCandidateDecision);

  if (
    persisted != null &&
    typeof persisted.status === 'string' &&
    typeof persisted.version === 'string'
  ) {
    return persisted as unknown as CurrentShadowCandidateDecision;
  }

  const analysis = record(payload?.analysis);
  return selectCurrentShadowCandidate(array(analysis?.candidates));
}

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function rows(input: {
  providerFixtureId?: number;
  hours?: number;
}): Promise<SnapshotRow[]> {
  const createdAtGte =
    input.hours == null
      ? undefined
      : new Date(Date.now() - input.hours * 3_600_000);

  return (await prisma.scientificCurrentSignalSnapshot.findMany({
    where: {
      providerFixtureId: input.providerFixtureId,
      snapshotAsOf:
        createdAtGte == null
          ? undefined
          : {
              gte: createdAtGte,
            },
    },
    select: {
      id: true,
      providerFixtureId: true,
      checkpointMinutes: true,
      checkpointLabel: true,
      snapshotAsOf: true,
      kickoffAt: true,
      status: true,
      analysisPayload: true,
      snapshotHash: true,
    },
    orderBy: [
      { snapshotAsOf: 'desc' },
      { id: 'desc' },
    ],
    take: input.providerFixtureId == null ? 5000 : 100,
  })) as SnapshotRow[];
}

async function fixture(providerFixtureId: number): Promise<void> {
  const data = await rows({ providerFixtureId });

  console.log(
    JSON.stringify(
      {
        version: 'v7.0-r4.10.2.10-shadow-candidate-ledger-beta2a-v1',
        providerFixtureId,
        rows: data.map((row) => ({
          id: row.id,
          checkpoint: row.checkpointLabel,
          checkpointMinutes: row.checkpointMinutes,
          snapshotAsOf: row.snapshotAsOf.toISOString(),
          kickoffAt: row.kickoffAt.toISOString(),
          currentStatus: row.status,
          shadow: decisionFromPayload(row.analysisPayload),
          snapshotHash: row.snapshotHash,
        })),
        externalApiCalled: false,
        databaseWritten: false,
        realMoneyExecution: false,
      },
      null,
      2,
    ),
  );
}

async function coverage(hours: number): Promise<void> {
  const data = await rows({ hours });
  const statusCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();
  const checkpointCounts = new Map<string, number>();
  let persistedShadowFieldRows = 0;

  for (const row of data) {
    const payload = record(row.analysisPayload);
    if (record(payload?.shadowCandidateDecision) != null) {
      persistedShadowFieldRows += 1;
    }

    const decision = decisionFromPayload(row.analysisPayload);
    statusCounts.set(
      decision.status,
      (statusCounts.get(decision.status) ?? 0) + 1,
    );

    const market = decision.selected?.marketType ?? 'NONE';
    marketCounts.set(market, (marketCounts.get(market) ?? 0) + 1);
    checkpointCounts.set(
      row.checkpointLabel,
      (checkpointCounts.get(row.checkpointLabel) ?? 0) + 1,
    );
  }

  const sortMap = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, count]) => ({ key, count }));

  console.log(
    JSON.stringify(
      {
        version: 'v7.0-r4.10.2.10-shadow-candidate-ledger-beta2a-v1',
        mode: 'BETA_2A_FRESH_SHADOW_DAILY_READONLY_COVERAGE',
        hours,
        rows: data.length,
        fixtures: new Set(data.map((row) => row.providerFixtureId)).size,
        persistedShadowFieldRows,
        derivedLegacyRows: data.length - persistedShadowFieldRows,
        byShadowStatus: sortMap(statusCounts),
        bySelectedMarket: sortMap(marketCounts),
        byCheckpoint: sortMap(checkpointCounts),
        appendOnlySource: 'ScientificCurrentSignalSnapshot.analysisPayload',
        officialBestBetChanged: false,
        externalApiCalled: false,
        databaseWritten: false,
        automaticBetPlacement: false,
        realMoneyExecution: false,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';

  if (command === 'fixture') {
    const providerFixtureId = positiveInteger(process.argv[3]);
    if (providerFixtureId == null) {
      throw new Error('fixture requires a positive provider fixture id.');
    }
    await fixture(providerFixtureId);
    return;
  }

  if (command === 'coverage') {
    const hours = positiveInteger(process.argv[3]) ?? 168;
    await coverage(hours);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
