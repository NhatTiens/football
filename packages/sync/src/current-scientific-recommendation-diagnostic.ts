import { prisma } from '@football-ai/database';
import {
  getCurrentScientificRecommendation,
} from './current-scientific-recommendation-engine.js';

function fixtureId(): number {
  const raw =
    process.argv.find(
      (value: string): boolean =>
        value.startsWith(
          '--fixture=',
        ),
    )?.slice(
      '--fixture='.length,
    ) ??
    process.env
      .CURRENT_RECOMMENDATION_FIXTURE_ID ??
    '';

  const value =
    Number(raw);

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      'Use --fixture=<providerFixtureId>.',
    );
  }

  return value;
}

async function main(): Promise<void> {
  const providerFixtureId =
    fixtureId();

  const analysis =
    await getCurrentScientificRecommendation({
      providerFixtureId,
    });

  console.log(
    JSON.stringify(
      {
        diagnostic:
          'R4.10.2 CURRENT SCIENTIFIC RECOMMENDATION',
        analysis,
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
