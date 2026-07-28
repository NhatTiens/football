import { prisma } from '@football-ai/database';

import {
  getPersonalTwoWayMarketMovements,
} from './personal-two-way-market-movement.js';

function positiveInteger(
  value: string | undefined,
): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

async function main(): Promise<void> {
  const providerFixtureId =
    positiveInteger(process.argv[2]);

  if (providerFixtureId == null) {
    throw new Error(
      'Usage: npm run odds:multimarket-movement -w @football-ai/sync -- <providerFixtureId>',
    );
  }

  const fixture =
    await prisma.fixture.findFirst({
      where: { apiFixtureId: providerFixtureId },
      select: {
        apiFixtureId: true,
        kickoffAt: true,
        homeTeam: {
          select: { name: true },
        },
        awayTeam: {
          select: { name: true },
        },
      },
    });

  if (fixture == null) {
    throw new Error(
      `No local fixture mapped to providerFixtureId=${providerFixtureId}.`,
    );
  }

  const map =
    await getPersonalTwoWayMarketMovements({
      fixtures: [
        {
          providerFixtureId:
            fixture.apiFixtureId,
          kickoffAt: fixture.kickoffAt,
        },
      ],
      predictionAsOf: new Date(),
    });

  console.log(
    JSON.stringify(
      {
        providerFixtureId,
        fixture:
          `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`,
        kickoffAt:
          fixture.kickoffAt.toISOString(),
        movements:
          map.get(providerFixtureId) ?? [],
        externalApiCalled: false,
        databaseWritten: false,
        scientificDecisionCreated: false,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
