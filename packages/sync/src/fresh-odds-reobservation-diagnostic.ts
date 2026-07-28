import { prisma } from '@football-ai/database';

import {
  resolveFreshReobservedOdds,
  type ReobservationOddsRow,
} from './fresh-odds-reobservation-bridge.js';

function providerFixtureId(): number {
  const raw =
    process.argv.find(
      (value: string): boolean =>
        value.startsWith(
          '--fixture=',
        ),
    )?.slice(
      '--fixture='.length,
    ) ??
    '';

  const value =
    Number(raw);

  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      'Use --fixture=<providerFixtureId>.',
    );
  }

  return value;
}

async function main(): Promise<void> {
  const fixtureId =
    providerFixtureId();

  const now =
    new Date();

  const maximumAgeMinutes =
    Number(
      process.env
        .CURRENT_RECOMMENDATION_MAX_ODDS_AGE_MINUTES ??
        360,
    );

  const lookback =
    new Date(
      now.getTime() -
        14 *
          86_400_000,
    );

  const oddsRows =
    (await prisma.apiFootballOddsSnapshot.findMany({
      where: {
        providerFixtureId:
          fixtureId,
        pitUsable: true,
        observedAt: {
          gte: lookback,
          lte: now,
        },
        kickoffAt: {
          gt: now,
        },
      },
      select: {
        id: true,
        providerFixtureId: true,
        sourceUpdatedAt: true,
        observedAt: true,
        bookmakerId: true,
        bookmakerName: true,
        betId: true,
        marketType: true,
        selection: true,
        lineValue: true,
        decimalOdds: true,
      },
      orderBy: [
        {
          observedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take: 10000,
    })) as ReobservationOddsRow[];

  const resolved =
    await resolveFreshReobservedOdds({
      providerFixtureIds: [
        fixtureId,
      ],
      oddsRows,
      now,
      maximumAgeMinutes,
    });

  const evidence =
    [...resolved
      .evidenceBySnapshotId
      .values()]
      .sort(
        (
          left,
          right,
        ): number =>
          right.freshnessAt.getTime() -
          left.freshnessAt.getTime(),
      )
      .slice(
        0,
        40,
      )
      .map(
        (row) => ({
          sourceOddsSnapshotId:
            row.sourceOddsSnapshotId,
          basis:
            row.basis,
          freshnessAt:
            row.freshnessAt
              .toISOString(),
          sourceUpdatedAt:
            row.sourceUpdatedAt
              ?.toISOString() ??
            null,
          firstObservedAt:
            row.firstObservedAt
              .toISOString(),
          reobservedAt:
            row.reobservedAt
              ?.toISOString() ??
            null,
          reobservationRawSnapshotId:
            row
              .reobservationRawSnapshotId,
          reobservationKind:
            row.reobservationKind,
          sourceAgeMinutes:
            row.sourceAgeMinutes,
          reobservationAgeMinutes:
            row
              .reobservationAgeMinutes,
        }),
      );

  console.log(
    JSON.stringify(
      {
        diagnostic:
          'R4.10.2.2 FRESH ODDS RE-OBSERVATION',
        providerFixtureId:
          fixtureId,
        now:
          now.toISOString(),
        maximumAgeMinutes,
        storedOddsRows:
          oddsRows.length,
        summary:
          resolved
            .summaryByFixture
            .get(
              fixtureId,
            ) ??
          null,
        activeOddsRows:
          resolved
            .activeOddsRows
            .length,
        evidence,
        externalApiCalled:
          false,
        databaseWritten:
          false,
        migration:
          false,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  )
  .finally(async () => {
    await prisma.$disconnect();
  });
