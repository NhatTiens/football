import { prisma } from '@football-ai/database';

import {
  getCurrentScientificRecommendationMap,
} from './current-scientific-recommendation-engine.js';
import {
  buildShadowCandidateClassification,
} from './shadow-candidate-core.js';

function integerArgument(
  name: string,
): number | null {
  const index =
    process.argv.indexOf(
      `--${name}`,
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

async function upcomingFixtureIds(
  maximum: number,
): Promise<number[]> {
  const now =
    new Date();

  const rows =
    await prisma.apiFootballFixtureSnapshot.findMany({
      where: {
        kickoffAt: {
          gt: now,
        },
      },
      select: {
        providerFixtureId: true,
        observedAt: true,
      },
      orderBy: [
        {
          observedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take:
        maximum * 20,
    });

  return [
    ...new Set(
      rows.map(
        (row): number =>
          row.providerFixtureId,
      ),
    ),
  ].slice(
    0,
    maximum,
  );
}

async function main(): Promise<void> {
  const fixture =
    integerArgument(
      'fixture',
    );

  const providerFixtureIds =
    fixture == null
      ? await upcomingFixtureIds(
          40,
        )
      : [fixture];

  const now =
    new Date();

  const analyses =
    await getCurrentScientificRecommendationMap({
      providerFixtureIds,
      now,
      maxFixtures:
        Math.max(
          1,
          providerFixtureIds.length,
        ),
    });

  const rows =
    [...analyses.values()]
      .map(
        (analysis) => ({
          analysisStatus:
            analysis.status,
          analysisError:
            analysis.error,
          shadowCandidate:
            buildShadowCandidateClassification({
              providerFixtureId:
                analysis.providerFixtureId,
              checkpointMinutes:
                Math.max(
                  1,
                  Math.round(
                    analysis.horizonMinutes,
                  ),
                ),
              calculatedAt:
                analysis.calculatedAt,
              analysisStatus:
                analysis.status,
              candidates:
                analysis.candidates,
            }),
        }),
      )
      .sort(
        (
          left,
          right,
        ): number =>
          left.shadowCandidate
            .providerFixtureId -
          right.shadowCandidate
            .providerFixtureId,
      );

  console.log(
    JSON.stringify(
      {
        event:
          'R4.10.2.10_SHADOW_CANDIDATE_PREVIEW',
        generatedAt:
          now.toISOString(),
        requestedFixture:
          fixture,
        analyses:
          rows.length,
        shadowCandidates:
          rows.filter(
            (row): boolean =>
              row.shadowCandidate.status ===
              'SHADOW_CANDIDATE',
          ).length,
        rows,
        persisted:
          false,
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
