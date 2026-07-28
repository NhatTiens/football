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
  const providerFixtureId =
    fixtureId();

  const analysis =
    await getCurrentScientificRecommendation({
      providerFixtureId,
    });

  const recommendation =
    analysis?.recommendation ??
    null;

  console.log(
    JSON.stringify(
      {
        diagnostic:
          'R4.10.2.4 CURRENT MODEL AVAILABILITY',
        providerFixtureId,
        status:
          analysis?.status ??
          null,
        error:
          analysis?.error ??
          null,
        modelSource:
          recommendation
            ?.modelSource ??
          null,
        modelFallbackReason:
          recommendation
            ?.modelFallbackReason ??
          null,
        modelConfidenceTier:
          recommendation
            ?.modelConfidenceTier ??
          null,
        modelHistorySampleSize:
          recommendation
            ?.modelHistorySampleSize ??
          null,
        dataQualityScore:
          recommendation
            ?.dataQualityScore ??
          null,
        recommendation,
        fallbackPolicy: {
          fallback:
            'SCIENTIFIC_BASELINE_FALLBACK',
          officialBestBetPromotion:
            false,
          databaseWritten:
            false,
          externalApiCalled:
            false,
        },
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
