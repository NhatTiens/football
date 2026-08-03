import { prisma } from '@football-ai/database';

import { getCurrentScientificRecommendationMap } from './current-scientific-recommendation-engine.js';
import { PAPER_SHADOW_RECOMMENDATION_VERSION } from './paper-shadow-recommendation-core.js';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);

  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = argument(name);

  if (raw == null) return fallback;

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }

  return value;
}

function counts(values: readonly (string | null | undefined)[]): Array<{
  key: string;
  rows: number;
}> {
  const result = new Map<string, number>();

  for (const value of values) {
    const key = value ?? 'UNKNOWN';

    result.set(key, (result.get(key) ?? 0) + 1);
  }

  return [...result.entries()]
    .map(([key, rows]) => ({
      key,
      rows,
    }))
    .sort((left, right) => right.rows - left.rows || left.key.localeCompare(right.key));
}

async function main(): Promise<void> {
  const now = new Date();
  const hoursAhead = positiveInteger('--hours-ahead', 72, 720);
  const maximumFixtures = positiveInteger('--max-fixtures', 100, 120);
  const requestedFixture =
    argument('--fixture') == null ? null : positiveInteger('--fixture', 1, Number.MAX_SAFE_INTEGER);
  const until = new Date(now.getTime() + hoursAhead * 3_600_000);
  const sourceRows = await prisma.apiFootballFixtureSnapshot.findMany({
    where: {
      providerFixtureId: requestedFixture ?? undefined,
      kickoffAt: {
        gt: now,
        lte: until,
      },
      observedAt: {
        lte: now,
      },
    },
    select: {
      providerFixtureId: true,
      kickoffAt: true,
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
    take: 5000,
  });
  const latest = new Map<number, (typeof sourceRows)[number]>();

  for (const row of sourceRows) {
    if (!latest.has(row.providerFixtureId)) {
      latest.set(row.providerFixtureId, row);
    }
  }

  const providerFixtureIds = [...latest.values()]
    .sort((left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime())
    .slice(0, maximumFixtures)
    .map((row) => row.providerFixtureId);
  const analyses = await getCurrentScientificRecommendationMap({
    providerFixtureIds,
    now,
    maxFixtures: maximumFixtures,
  });
  const rows = [...analyses.values()].map((analysis) => {
    const selected = analysis.paperShadowRecommendation.selected;

    return {
      providerFixtureId: analysis.providerFixtureId,
      kickoffAt: analysis.kickoffAt,
      horizonMinutes: analysis.horizonMinutes,
      analysisStatus: analysis.status,
      officialRecommendationAvailable: analysis.recommendation != null,
      paperShadowStatus: analysis.paperShadowRecommendation.status,
      paperTrackEligible: selected?.paperTrackEligible ?? false,
      marketType: selected?.marketType ?? null,
      selection: selected?.selection ?? null,
      decimalOdds: selected?.decimalOdds ?? null,
      rawEdge: selected?.rawEdge ?? null,
      rawExpectedValue: selected?.rawExpectedValue ?? null,
      hierarchicalEdge: selected?.hierarchicalEdge ?? null,
      hierarchicalExpectedValue: selected?.hierarchicalExpectedValue ?? null,
      boundedProbabilityAdjustment: selected?.boundedProbabilityAdjustment ?? null,
      boundedAdjustedProbability: selected?.boundedAdjustedProbability ?? null,
      boundedEdge: selected?.boundedEdge ?? null,
      boundedExpectedValue: selected?.boundedExpectedValue ?? null,
      modelSource: selected?.modelSource ?? null,
      modelVersion: selected?.modelVersion ?? null,
      paperHdaContextApplied: analysis.paperHdaContext?.applied ?? false,
      paperHdaContextLineupShift: analysis.paperHdaContext?.lineupShift ?? null,
      paperHdaContextHeadToHeadShift:
        analysis.paperHdaContext?.headToHeadShift ?? null,
      paperHdaContextMaximumProbabilityShift:
        analysis.paperHdaContext?.maximumAbsoluteProbabilityShift ?? null,
      paperHdaContextEvidence: analysis.paperHdaContext?.evidence ?? null,
      paperHdaContextReasonCodes: analysis.paperHdaContext?.reasonCodes ?? [],
      flatStakeUnits: selected?.hypotheticalFlatStakeUnits ?? null,
      realStakeUnits: 0,
    };
  });
  const selected = rows.filter((row) => row.marketType != null);

  console.log(
    JSON.stringify(
      {
        event: 'R4.10.2.11.3_PAPER_SHADOW_RECOMMENDATION_PREVIEW',
        version: PAPER_SHADOW_RECOMMENDATION_VERSION,
        generatedAt: now.toISOString(),
        configuration: {
          hoursAhead,
          maximumFixtures,
          requestedFixture,
        },
        coverage: {
          providerFixtures: providerFixtureIds.length,
          evaluatedFixtures: rows.length,
          visiblePaperShadowPicks: selected.length,
          rawValueShadowPicks: rows.filter((row) => row.paperShadowStatus === 'RAW_VALUE_SHADOW')
            .length,
          hierarchicalValueShadowPicks: rows.filter(
            (row) => row.paperShadowStatus === 'HIERARCHICAL_VALUE_SHADOW',
          ).length,
          boundedValueShadowPicks: rows.filter(
            (row) => row.paperShadowStatus === 'BOUNDED_VALUE_SHADOW',
          ).length,
          diagnosticShadowPicks: rows.filter((row) => row.paperShadowStatus === 'DIAGNOSTIC_SHADOW')
            .length,
          paperTrackEligiblePicks: rows.filter((row) => row.paperTrackEligible).length,
          officialRecommendations: rows.filter((row) => row.officialRecommendationAvailable).length,
        },
        byStatus: counts(rows.map((row) => row.paperShadowStatus)),
        byMarket: counts(selected.map((row) => row.marketType)),
        byModelSource: counts(selected.map((row) => row.modelSource)),
        rows: process.argv.includes('--summary-only') ? undefined : rows,
        detailRowsIncluded: !process.argv.includes('--summary-only'),
        safety: {
          appendOnlySource: true,
          pitSafe: true,
          paperOnly: true,
          externalApiCalled: false,
          databaseWritten: false,
          historicalRowsRewritten: false,
          automaticPromotion: false,
          automaticBetPlacement: false,
          realMoneyExecution: false,
        },
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
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
} finally {
  await prisma.$disconnect();
  process.exitCode = exitCode;
}
