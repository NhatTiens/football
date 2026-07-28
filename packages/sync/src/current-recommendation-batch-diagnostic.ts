import { prisma } from '@football-ai/database';

import {
  getPrioritizedCurrentRecommendationBatch,
} from './current-recommendation-batch-engine.js';

interface DiagnosticFixtureRow {
  apiFixtureId: number;
  kickoffAt: Date;
  league: {
    name: string;
  };
  homeTeam: {
    name: string;
  };
  awayTeam: {
    name: string;
  };
}

function fixtureArgument(): number | null {
  const raw =
    process.argv.find(
      (value: string): boolean =>
        value.startsWith(
          '--fixture=',
        ),
    )?.slice(
      '--fixture='.length,
    ) ??
    null;

  if (raw == null) {
    return null;
  }

  const value =
    Number(raw);

  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      '--fixture must be a positive provider fixture ID.',
    );
  }

  return value;
}

async function main(): Promise<void> {
  const now =
    new Date();

  const providerFixtureId =
    fixtureArgument();

  const fixtures =
    (await prisma.fixture.findMany({
      where: {
        status:
          'UPCOMING',
        kickoffAt: {
          gt:
            now,
        },
        apiFixtureId:
          providerFixtureId == null
            ? {
                gt: 0,
              }
            : providerFixtureId,
      },
      select: {
        apiFixtureId: true,
        kickoffAt: true,
        league: {
          select: {
            name: true,
          },
        },
        homeTeam: {
          select: {
            name: true,
          },
        },
        awayTeam: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        kickoffAt: 'asc',
      },
      take:
        providerFixtureId == null
          ? 300
          : 1,
    })) as DiagnosticFixtureRow[];

  const result =
    await getPrioritizedCurrentRecommendationBatch({
      fixtures:
        fixtures.map(
          (fixture) => ({
            providerFixtureId:
              fixture.apiFixtureId,
            kickoffAt:
              fixture.kickoffAt,
          }),
        ),
      now,
      maximumFixtures:
        providerFixtureId == null
          ? undefined
          : 1,
      chunkSize:
        providerFixtureId == null
          ? undefined
          : 1,
    });

  console.log(
    JSON.stringify(
      {
        diagnostic:
          'R4.10.2.5 CURRENT RECOMMENDATION BATCH',
        now:
          now.toISOString(),
        requestedFixture:
          providerFixtureId,
        fixtures:
          fixtures.map(
            (fixture) => ({
              providerFixtureId:
                fixture.apiFixtureId,
              kickoffAt:
                fixture.kickoffAt
                  .toISOString(),
              league:
                fixture.league.name,
              home:
                fixture.homeTeam.name,
              away:
                fixture.awayTeam.name,
            }),
          ),
        diagnostics:
          result.diagnostics,
        priority:
          result
            .prioritizedFixtures
            .slice(
              0,
              50,
            )
            .map(
              (fixture) => ({
                providerFixtureId:
                  fixture
                    .providerFixtureId,
                minutesToKickoff:
                  fixture
                    .minutesToKickoff,
                priorityReason:
                  fixture
                    .priorityReason,
                nearestCheckpointMinutes:
                  fixture
                    .nearestCheckpointMinutes,
                checkpointDistanceMinutes:
                  fixture
                    .checkpointDistanceMinutes,
                hasRecentRawAttempt:
                  fixture
                    .hasRecentRawAttempt,
                hasPitOdds:
                  fixture
                    .hasPitOdds,
              }),
            ),
        analyses:
          [
            ...result
              .analyses
              .entries(),
          ].map(
            (
              [
                fixtureId,
                analysis,
              ],
            ) => ({
              providerFixtureId:
                fixtureId,
              status:
                analysis.status,
              error:
                analysis.error,
              recommendation:
                analysis
                  .recommendation,
              oddsFreshness:
                analysis
                  .oddsFreshness,
            }),
          ),
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
