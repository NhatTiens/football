import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { prisma } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import {
  actualBtts,
  actualMatchWinner,
  actualOverLine,
  deriveScientificScoreGridMarkets,
  evaluateBinaryPredictions,
  evaluateMatchWinnerPredictions,
  maximumAbsoluteDifference,
  SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES,
  SCIENTIFIC_MULTI_MARKET_REPLAY_POLICY,
  SCIENTIFIC_MULTI_MARKET_REPLAY_VERSION,
  SCIENTIFIC_TOTAL_GOAL_LINES,
  type MatchWinnerClass,
  type ScientificPredictionMetrics,
  type ScientificTotalGoalLine,
} from './scientific-multi-market-replay-contract.js';

const EQUIVALENCE_TOLERANCE = 1e-9;

interface ReplayRunRow {
  id: number;
  status: string;
  dateFrom: Date;
  dateTo: Date;
  predictions: number;
  settledPredictions: number;
  pitViolations: number;
  metrics: unknown;
  payloadHash: string;
}

interface ReplayPredictionRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  sourceFeaturePayloadHash: string;
  candidateHomeProbability: number;
  candidateDrawProbability: number;
  candidateAwayProbability: number;
  actualClass: string;
  pitSafe: boolean;
}

interface FixtureResultRow {
  id: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface FeatureLineageRow {
  fixtureId: number;
  predictionAsOf: Date;
  payloadHash: string;
  sourcePayload: unknown;
}

interface DixonSnapshotRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  horizonMinutes: number;
  trainedThrough: Date;
  rho: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  over25Probability: number;
  bttsProbability: number;
  payloadHash: string;
}

interface EvaluationPredictionArtifact {
  fixtureId: number;
  leagueId: number;
  predictionAsOf: string;
  kickoffAt: string;
  homeGoals: number;
  awayGoals: number;
  actualMatchWinner: MatchWinnerClass;
  sourceFeaturePayloadHash: string;
  sourceDixonPayloadHash: string;
  frozenHdaCandidate: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  dynamicDixonColes: {
    homeExpectedGoals: number;
    awayExpectedGoals: number;
    rho: number;
    MATCH_WINNER: {
      HOME: number;
      DRAW: number;
      AWAY: number;
    };
    TOTAL_GOALS_1_5: {
      OVER: number;
      UNDER: number;
    };
    TOTAL_GOALS_2_5: {
      OVER: number;
      UNDER: number;
    };
    TOTAL_GOALS_3_5: {
      OVER: number;
      UNDER: number;
    };
    BTTS: {
      YES: number;
      NO: number;
    };
  };
  actuals: {
    TOTAL_GOALS_1_5_OVER: boolean;
    TOTAL_GOALS_2_5_OVER: boolean;
    TOTAL_GOALS_3_5_OVER: boolean;
    BTTS_YES: boolean;
  };
  pitSafe: boolean;
  dixonStoredEquivalenceMaxAbsDiff: number;
}

export interface ScientificMultiMarketReplayReport {
  version: string;
  policy: string;
  evidenceClass: 'HISTORICAL_REPLAY_DIAGNOSTIC_ONLY';
  promotional: false;
  replaySource: {
    runId: number;
    payloadHash: string;
    dateFrom: string;
    dateTo: string;
    requestedHorizonMinutes: 90;
  };
  coverage: {
    replayPredictions: number;
    fixtureResultsResolved: number;
    featureLineageResolved: number;
    dixonSnapshotsResolved: number;
    evaluationFixtures: number;
    evaluationRows: number;
    missingFixtureResults: number;
    missingFeatureLineage: number;
    missingDixonSnapshots: number;
    actualClassMismatches: number;
    pitViolations: number;
  };
  equivalence: {
    tolerance: number;
    dixonStoredProbabilityViolations: number;
    maximumDixonStoredProbabilityAbsDiff: number;
    frozenHdaReplayMetricViolations: number;
    maximumFrozenHdaReplayMetricAbsDiff: number;
  };
  metrics: {
    MATCH_WINNER: ScientificPredictionMetrics & {
      source: 'FROZEN_ALPHA8_CANDIDATE';
    };
    TOTAL_GOALS_1_5: ScientificPredictionMetrics & {
      source: 'DYNAMIC_DIXON_COLES_SCORE_GRID';
      positiveSelection: 'OVER';
      lineValue: 1.5;
    };
    TOTAL_GOALS_2_5: ScientificPredictionMetrics & {
      source: 'DYNAMIC_DIXON_COLES_SCORE_GRID';
      positiveSelection: 'OVER';
      lineValue: 2.5;
    };
    TOTAL_GOALS_3_5: ScientificPredictionMetrics & {
      source: 'DYNAMIC_DIXON_COLES_SCORE_GRID';
      positiveSelection: 'OVER';
      lineValue: 3.5;
    };
    BTTS: ScientificPredictionMetrics & {
      source: 'DYNAMIC_DIXON_COLES_SCORE_GRID';
      positiveSelection: 'YES';
    };
  };
  binaryMarketRanking: {
    byBrier: string[];
    byLogLoss: string[];
    byEce: string[];
    byAccuracy: string[];
  };
  interpretationRules: {
    compareHdaDirectlyWithBinaryMetrics: false;
    reason: string;
    oddsUsed: false;
    roiCalculated: false;
    bestBetSelected: false;
  };
  safety: {
    historicalDataRewritten: false;
    oddsRequired: false;
    liveApiCalled: false;
    bestBetPolicyActivated: false;
    freshShadowRowsWritten: 0;
    productionModelChanged: false;
    automaticPromotion: false;
  };
  artifactDirectory: string;
  payloadHash: string;
  nextStage: 'v7.0-beta.1A.4';
}

function repositoryRoot(): string {
  let current = process.cwd();

  while (true) {
    if (
      existsSync(resolve(current, '.git')) &&
      existsSync(resolve(current, 'packages/database/prisma/schema.prisma'))
    ) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error(`Cannot locate repository root from ${process.cwd()}.`);
    }

    current = parent;
  }
}

function artifactRoot(): string {
  return resolve(
    repositoryRoot(),
    process.env.SCIENTIFIC_MULTI_MARKET_REPLAY_ARTIFACT_DIRECTORY ??
      'artifacts/provider/v7-beta1a3',
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dixonSnapshotIdFromFeature(sourcePayload: unknown): number | null {
  return numberValue(asRecord(sourcePayload)?.dixonSnapshotId);
}

function replayCandidateMetricRecord(metrics: unknown): {
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
} {
  const candidate = asRecord(asRecord(metrics)?.candidate);

  return {
    accuracy: numberValue(candidate?.accuracy),
    brier: numberValue(candidate?.brier),
    logLoss: numberValue(candidate?.logLoss),
  };
}

function absoluteMetricDifferences(
  left: {
    accuracy: number | null;
    brier: number | null;
    logLoss: number | null;
  },
  right: ScientificPredictionMetrics,
): number[] {
  const result: number[] = [];

  for (const [key, value] of Object.entries(left) as Array<
    ['accuracy' | 'brier' | 'logLoss', number | null]
  >) {
    const other = right[key];

    if (value != null && other != null) {
      result.push(Math.abs(value - other));
    }
  }

  return result;
}

function metricValue(
  metrics: ScientificPredictionMetrics,
  key: 'brier' | 'logLoss' | 'ece' | 'accuracy',
): number {
  const value = metrics[key];

  return value == null ? Number.POSITIVE_INFINITY : value;
}

function rankBinaryMarkets(
  rows: Array<{
    market: string;
    metrics: ScientificPredictionMetrics;
  }>,
  key: 'brier' | 'logLoss' | 'ece' | 'accuracy',
  descending = false,
): string[] {
  return [...rows]
    .sort((left, right) => {
      const leftValue = metricValue(left.metrics, key);
      const rightValue = metricValue(right.metrics, key);

      return descending
        ? rightValue - leftValue || left.market.localeCompare(right.market)
        : leftValue - rightValue || left.market.localeCompare(right.market);
    })
    .map((row) => row.market);
}

function ensureProbabilityTriplet(input: { HOME: number; DRAW: number; AWAY: number }): void {
  const total = input.HOME + input.DRAW + input.AWAY;

  if (
    [input.HOME, input.DRAW, input.AWAY].some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    ) ||
    Math.abs(total - 1) > 1e-6
  ) {
    throw new Error(`Invalid frozen HDA candidate probability triplet: ${JSON.stringify(input)}.`);
  }
}

export async function runScientificMultiMarketReplay(
  input: {
    writeArtifacts?: boolean;
  } = {},
): Promise<ScientificMultiMarketReplayReport> {
  const replayRun = (await prisma.providerReplayRun.findFirst({
    where: {
      status: 'SUCCESS',
    },
    orderBy: {
      startedAt: 'desc',
    },
  })) as ReplayRunRow | null;

  if (!replayRun) {
    throw new Error('No successful beta.1A provider replay exists.');
  }

  const replayPredictions = (await prisma.providerReplayPrediction.findMany({
    where: {
      runId: replayRun.id,
      horizonMinutes: SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES,
    },
    select: {
      id: true,
      fixtureId: true,
      leagueId: true,
      predictionAsOf: true,
      kickoffAt: true,
      horizonMinutes: true,
      sourceFeaturePayloadHash: true,
      candidateHomeProbability: true,
      candidateDrawProbability: true,
      candidateAwayProbability: true,
      actualClass: true,
      pitSafe: true,
    },
    orderBy: [
      {
        kickoffAt: 'asc',
      },
      {
        fixtureId: 'asc',
      },
    ],
  })) as ReplayPredictionRow[];

  if (replayPredictions.length === 0) {
    throw new Error('Latest beta.1A replay contains no T-90 predictions.');
  }

  const fixtureIds = replayPredictions.map((row) => row.fixtureId);
  const featureHashes = replayPredictions.map((row) => row.sourceFeaturePayloadHash);

  const [fixtureResults, featureRows] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        id: {
          in: fixtureIds,
        },
      },
      select: {
        id: true,
        homeGoals: true,
        awayGoals: true,
      },
    }) as Promise<FixtureResultRow[]>,
    prisma.mlFeatureSnapshot.findMany({
      where: {
        payloadHash: {
          in: featureHashes,
        },
      },
      select: {
        fixtureId: true,
        predictionAsOf: true,
        payloadHash: true,
        sourcePayload: true,
      },
    }) as Promise<FeatureLineageRow[]>,
  ]);

  const fixtureResultMap = new Map(fixtureResults.map((row) => [row.id, row]));
  const featureMap = new Map(featureRows.map((row) => [row.payloadHash, row]));

  const dixonIds = [
    ...new Set(
      featureRows
        .map((row) => dixonSnapshotIdFromFeature(row.sourcePayload))
        .filter((value): value is number => value != null),
    ),
  ];

  const dixonRows =
    dixonIds.length > 0
      ? ((await prisma.dixonColesPredictionSnapshot.findMany({
          where: {
            id: {
              in: dixonIds,
            },
          },
          select: {
            id: true,
            fixtureId: true,
            leagueId: true,
            predictionAsOf: true,
            horizonMinutes: true,
            trainedThrough: true,
            rho: true,
            homeExpectedGoals: true,
            awayExpectedGoals: true,
            homeProbability: true,
            drawProbability: true,
            awayProbability: true,
            over25Probability: true,
            bttsProbability: true,
            payloadHash: true,
          },
        })) as DixonSnapshotRow[])
      : [];

  const dixonMap = new Map(dixonRows.map((row) => [row.id, row]));

  let missingFixtureResults = 0;
  let missingFeatureLineage = 0;
  let missingDixonSnapshots = 0;
  let actualClassMismatches = 0;
  let pitViolations = 0;
  let dixonStoredProbabilityViolations = 0;
  let maximumDixonStoredProbabilityAbsDiff = 0;

  const artifacts: EvaluationPredictionArtifact[] = [];

  const hdaRows: Array<{
    probabilities: Record<MatchWinnerClass, number>;
    actualClass: MatchWinnerClass;
  }> = [];
  const overRows = new Map<
    ScientificTotalGoalLine,
    Array<{
      positiveProbability: number;
      actualPositive: boolean;
    }>
  >(SCIENTIFIC_TOTAL_GOAL_LINES.map((line) => [line, []]));
  const bttsRows: Array<{
    positiveProbability: number;
    actualPositive: boolean;
  }> = [];

  let fixtureResultsResolved = 0;
  let featureLineageResolved = 0;
  let dixonSnapshotsResolved = 0;

  for (const prediction of replayPredictions) {
    const fixture = fixtureResultMap.get(prediction.fixtureId);

    if (fixture?.homeGoals == null || fixture.awayGoals == null) {
      missingFixtureResults += 1;
      continue;
    }

    fixtureResultsResolved += 1;

    const feature = featureMap.get(prediction.sourceFeaturePayloadHash);

    if (!feature) {
      missingFeatureLineage += 1;
      continue;
    }

    featureLineageResolved += 1;

    const dixonId = dixonSnapshotIdFromFeature(feature.sourcePayload);
    const dixon = dixonId == null ? null : (dixonMap.get(dixonId) ?? null);

    if (!dixon) {
      missingDixonSnapshots += 1;
      continue;
    }

    dixonSnapshotsResolved += 1;

    if (
      !prediction.pitSafe ||
      prediction.predictionAsOf.getTime() > prediction.kickoffAt.getTime() ||
      feature.predictionAsOf.getTime() > prediction.predictionAsOf.getTime() ||
      dixon.predictionAsOf.getTime() > prediction.predictionAsOf.getTime() ||
      dixon.trainedThrough.getTime() > prediction.predictionAsOf.getTime() ||
      dixon.fixtureId !== prediction.fixtureId ||
      dixon.horizonMinutes !== SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES
    ) {
      pitViolations += 1;
    }

    const actualHda = actualMatchWinner(fixture.homeGoals, fixture.awayGoals);

    if (prediction.actualClass !== actualHda) {
      actualClassMismatches += 1;
    }

    const frozenCandidate = {
      HOME: prediction.candidateHomeProbability,
      DRAW: prediction.candidateDrawProbability,
      AWAY: prediction.candidateAwayProbability,
    };

    ensureProbabilityTriplet(frozenCandidate);

    const scoreGrid = deriveScientificScoreGridMarkets({
      homeExpectedGoals: dixon.homeExpectedGoals,
      awayExpectedGoals: dixon.awayExpectedGoals,
      rho: dixon.rho,
      maximumGoals: 10,
    });

    const dixonDifference = maximumAbsoluteDifference([
      {
        left: scoreGrid.matchWinner.HOME,
        right: dixon.homeProbability,
      },
      {
        left: scoreGrid.matchWinner.DRAW,
        right: dixon.drawProbability,
      },
      {
        left: scoreGrid.matchWinner.AWAY,
        right: dixon.awayProbability,
      },
      {
        left: scoreGrid.totalGoals[2.5].OVER,
        right: dixon.over25Probability,
      },
      {
        left: scoreGrid.btts.YES,
        right: dixon.bttsProbability,
      },
    ]);

    maximumDixonStoredProbabilityAbsDiff = Math.max(
      maximumDixonStoredProbabilityAbsDiff,
      dixonDifference,
    );

    if (dixonDifference > EQUIVALENCE_TOLERANCE) {
      dixonStoredProbabilityViolations += 1;
    }

    hdaRows.push({
      probabilities: frozenCandidate,
      actualClass: actualHda,
    });

    for (const line of SCIENTIFIC_TOTAL_GOAL_LINES) {
      overRows.get(line)!.push({
        positiveProbability: scoreGrid.totalGoals[line].OVER,
        actualPositive: actualOverLine(fixture.homeGoals, fixture.awayGoals, line),
      });
    }

    bttsRows.push({
      positiveProbability: scoreGrid.btts.YES,
      actualPositive: actualBtts(fixture.homeGoals, fixture.awayGoals),
    });

    artifacts.push({
      fixtureId: prediction.fixtureId,
      leagueId: prediction.leagueId,
      predictionAsOf: prediction.predictionAsOf.toISOString(),
      kickoffAt: prediction.kickoffAt.toISOString(),
      homeGoals: fixture.homeGoals,
      awayGoals: fixture.awayGoals,
      actualMatchWinner: actualHda,
      sourceFeaturePayloadHash: prediction.sourceFeaturePayloadHash,
      sourceDixonPayloadHash: dixon.payloadHash,
      frozenHdaCandidate: frozenCandidate,
      dynamicDixonColes: {
        homeExpectedGoals: dixon.homeExpectedGoals,
        awayExpectedGoals: dixon.awayExpectedGoals,
        rho: dixon.rho,
        MATCH_WINNER: scoreGrid.matchWinner,
        TOTAL_GOALS_1_5: scoreGrid.totalGoals[1.5],
        TOTAL_GOALS_2_5: scoreGrid.totalGoals[2.5],
        TOTAL_GOALS_3_5: scoreGrid.totalGoals[3.5],
        BTTS: scoreGrid.btts,
      },
      actuals: {
        TOTAL_GOALS_1_5_OVER: actualOverLine(fixture.homeGoals, fixture.awayGoals, 1.5),
        TOTAL_GOALS_2_5_OVER: actualOverLine(fixture.homeGoals, fixture.awayGoals, 2.5),
        TOTAL_GOALS_3_5_OVER: actualOverLine(fixture.homeGoals, fixture.awayGoals, 3.5),
        BTTS_YES: actualBtts(fixture.homeGoals, fixture.awayGoals),
      },
      pitSafe: prediction.pitSafe,
      dixonStoredEquivalenceMaxAbsDiff: dixonDifference,
    });
  }

  const hdaMetrics = evaluateMatchWinnerPredictions(hdaRows);
  const over15Metrics = evaluateBinaryPredictions(overRows.get(1.5)!);
  const over25Metrics = evaluateBinaryPredictions(overRows.get(2.5)!);
  const over35Metrics = evaluateBinaryPredictions(overRows.get(3.5)!);
  const bttsMetrics = evaluateBinaryPredictions(bttsRows);

  const storedHdaMetrics = replayCandidateMetricRecord(replayRun.metrics);
  const hdaMetricDifferences = absoluteMetricDifferences(storedHdaMetrics, hdaMetrics);
  const maximumFrozenHdaReplayMetricAbsDiff =
    hdaMetricDifferences.length > 0 ? Math.max(...hdaMetricDifferences) : 0;
  const frozenHdaReplayMetricViolations = hdaMetricDifferences.filter(
    (difference) => difference > EQUIVALENCE_TOLERANCE,
  ).length;

  const binaryRows = [
    {
      market: 'TOTAL_GOALS_1_5',
      metrics: over15Metrics,
    },
    {
      market: 'TOTAL_GOALS_2_5',
      metrics: over25Metrics,
    },
    {
      market: 'TOTAL_GOALS_3_5',
      metrics: over35Metrics,
    },
    {
      market: 'BTTS',
      metrics: bttsMetrics,
    },
  ];

  const reportWithoutArtifact = {
    version: SCIENTIFIC_MULTI_MARKET_REPLAY_VERSION,
    policy: SCIENTIFIC_MULTI_MARKET_REPLAY_POLICY,
    evidenceClass: 'HISTORICAL_REPLAY_DIAGNOSTIC_ONLY' as const,
    promotional: false as const,
    replaySource: {
      runId: replayRun.id,
      payloadHash: replayRun.payloadHash,
      dateFrom: replayRun.dateFrom.toISOString(),
      dateTo: replayRun.dateTo.toISOString(),
      requestedHorizonMinutes: SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES as 90,
    },
    coverage: {
      replayPredictions: replayPredictions.length,
      fixtureResultsResolved,
      featureLineageResolved,
      dixonSnapshotsResolved,
      evaluationFixtures: artifacts.length,
      evaluationRows: artifacts.length * 5,
      missingFixtureResults,
      missingFeatureLineage,
      missingDixonSnapshots,
      actualClassMismatches,
      pitViolations: pitViolations + replayRun.pitViolations,
    },
    equivalence: {
      tolerance: EQUIVALENCE_TOLERANCE,
      dixonStoredProbabilityViolations,
      maximumDixonStoredProbabilityAbsDiff,
      frozenHdaReplayMetricViolations,
      maximumFrozenHdaReplayMetricAbsDiff,
    },
    metrics: {
      MATCH_WINNER: {
        ...hdaMetrics,
        source: 'FROZEN_ALPHA8_CANDIDATE' as const,
      },
      TOTAL_GOALS_1_5: {
        ...over15Metrics,
        source: 'DYNAMIC_DIXON_COLES_SCORE_GRID' as const,
        positiveSelection: 'OVER' as const,
        lineValue: 1.5 as const,
      },
      TOTAL_GOALS_2_5: {
        ...over25Metrics,
        source: 'DYNAMIC_DIXON_COLES_SCORE_GRID' as const,
        positiveSelection: 'OVER' as const,
        lineValue: 2.5 as const,
      },
      TOTAL_GOALS_3_5: {
        ...over35Metrics,
        source: 'DYNAMIC_DIXON_COLES_SCORE_GRID' as const,
        positiveSelection: 'OVER' as const,
        lineValue: 3.5 as const,
      },
      BTTS: {
        ...bttsMetrics,
        source: 'DYNAMIC_DIXON_COLES_SCORE_GRID' as const,
        positiveSelection: 'YES' as const,
      },
    },
    binaryMarketRanking: {
      byBrier: rankBinaryMarkets(binaryRows, 'brier'),
      byLogLoss: rankBinaryMarkets(binaryRows, 'logLoss'),
      byEce: rankBinaryMarkets(binaryRows, 'ece'),
      byAccuracy: rankBinaryMarkets(binaryRows, 'accuracy', true),
    },
    interpretationRules: {
      compareHdaDirectlyWithBinaryMetrics: false as const,
      reason:
        'MATCH_WINNER is a 3-class task while totals and BTTS are binary; raw accuracy/Brier scales are not directly comparable across those task types.',
      oddsUsed: false as const,
      roiCalculated: false as const,
      bestBetSelected: false as const,
    },
    safety: {
      historicalDataRewritten: false as const,
      oddsRequired: false as const,
      liveApiCalled: false as const,
      bestBetPolicyActivated: false as const,
      freshShadowRowsWritten: 0 as const,
      productionModelChanged: false as const,
      automaticPromotion: false as const,
    },
    nextStage: 'v7.0-beta.1A.4' as const,
  };

  const payloadHash = deterministicHash('SCIENTIFIC_MULTI_MARKET_REPLAY', reportWithoutArtifact);
  const artifactDirectory = resolve(
    artifactRoot(),
    `${SCIENTIFIC_MULTI_MARKET_REPLAY_VERSION}-${payloadHash.slice(0, 12)}`,
  );
  const relativeArtifactDirectory = relative(repositoryRoot(), artifactDirectory).replaceAll(
    '\\',
    '/',
  );

  const report: ScientificMultiMarketReplayReport = {
    ...reportWithoutArtifact,
    artifactDirectory: relativeArtifactDirectory,
    payloadHash,
  };

  if (input.writeArtifacts !== false) {
    mkdirSync(artifactDirectory, {
      recursive: true,
    });

    writeFileSync(
      resolve(artifactDirectory, 'multi-market-replay-report.json'),
      JSON.stringify(report, null, 2) + '\n',
      'utf8',
    );

    writeFileSync(
      resolve(artifactDirectory, 'multi-market-predictions.jsonl'),
      artifacts.map((row) => JSON.stringify(row)).join('\n') + '\n',
      'utf8',
    );
  }

  return report;
}

export async function getScientificMultiMarketReplayReport(): Promise<ScientificMultiMarketReplayReport> {
  return runScientificMultiMarketReplay({
    writeArtifacts: false,
  });
}

export async function getScientificMultiMarketReplaySummary(): Promise<{
  version: string;
  replayRunId: number;
  evaluationFixtures: number;
  evaluationRows: number;
  pitViolations: number;
  dixonStoredProbabilityViolations: number;
  frozenHdaReplayMetricViolations: number;
  markets: Array<{
    market: string;
    source: string;
    rows: number;
    accuracy: number | null;
    brier: number | null;
    logLoss: number | null;
    ece: number | null;
    brierSkillVsUniform: number | null;
    logLossSkillVsUniform: number | null;
    positiveRate: number | null;
  }>;
  binaryRankingByBrier: string[];
  binaryRankingByLogLoss: string[];
  binaryRankingByEce: string[];
  binaryRankingByAccuracy: string[];
  oddsUsed: false;
  roiCalculated: false;
  bestBetSelected: false;
  promotional: false;
  nextStage: 'v7.0-beta.1A.4';
}> {
  const report = await runScientificMultiMarketReplay({
    writeArtifacts: false,
  });

  return {
    version: report.version,
    replayRunId: report.replaySource.runId,
    evaluationFixtures: report.coverage.evaluationFixtures,
    evaluationRows: report.coverage.evaluationRows,
    pitViolations: report.coverage.pitViolations,
    dixonStoredProbabilityViolations: report.equivalence.dixonStoredProbabilityViolations,
    frozenHdaReplayMetricViolations: report.equivalence.frozenHdaReplayMetricViolations,
    markets: [
      {
        market: 'MATCH_WINNER',
        source: report.metrics.MATCH_WINNER.source,
        rows: report.metrics.MATCH_WINNER.rows,
        accuracy: report.metrics.MATCH_WINNER.accuracy,
        brier: report.metrics.MATCH_WINNER.brier,
        logLoss: report.metrics.MATCH_WINNER.logLoss,
        ece: report.metrics.MATCH_WINNER.ece,
        brierSkillVsUniform: report.metrics.MATCH_WINNER.brierSkillVsUniform,
        logLossSkillVsUniform: report.metrics.MATCH_WINNER.logLossSkillVsUniform,
        positiveRate: report.metrics.MATCH_WINNER.positiveRate,
      },
      {
        market: 'TOTAL_GOALS_1_5',
        source: report.metrics.TOTAL_GOALS_1_5.source,
        rows: report.metrics.TOTAL_GOALS_1_5.rows,
        accuracy: report.metrics.TOTAL_GOALS_1_5.accuracy,
        brier: report.metrics.TOTAL_GOALS_1_5.brier,
        logLoss: report.metrics.TOTAL_GOALS_1_5.logLoss,
        ece: report.metrics.TOTAL_GOALS_1_5.ece,
        brierSkillVsUniform: report.metrics.TOTAL_GOALS_1_5.brierSkillVsUniform,
        logLossSkillVsUniform: report.metrics.TOTAL_GOALS_1_5.logLossSkillVsUniform,
        positiveRate: report.metrics.TOTAL_GOALS_1_5.positiveRate,
      },
      {
        market: 'TOTAL_GOALS_2_5',
        source: report.metrics.TOTAL_GOALS_2_5.source,
        rows: report.metrics.TOTAL_GOALS_2_5.rows,
        accuracy: report.metrics.TOTAL_GOALS_2_5.accuracy,
        brier: report.metrics.TOTAL_GOALS_2_5.brier,
        logLoss: report.metrics.TOTAL_GOALS_2_5.logLoss,
        ece: report.metrics.TOTAL_GOALS_2_5.ece,
        brierSkillVsUniform: report.metrics.TOTAL_GOALS_2_5.brierSkillVsUniform,
        logLossSkillVsUniform: report.metrics.TOTAL_GOALS_2_5.logLossSkillVsUniform,
        positiveRate: report.metrics.TOTAL_GOALS_2_5.positiveRate,
      },
      {
        market: 'TOTAL_GOALS_3_5',
        source: report.metrics.TOTAL_GOALS_3_5.source,
        rows: report.metrics.TOTAL_GOALS_3_5.rows,
        accuracy: report.metrics.TOTAL_GOALS_3_5.accuracy,
        brier: report.metrics.TOTAL_GOALS_3_5.brier,
        logLoss: report.metrics.TOTAL_GOALS_3_5.logLoss,
        ece: report.metrics.TOTAL_GOALS_3_5.ece,
        brierSkillVsUniform: report.metrics.TOTAL_GOALS_3_5.brierSkillVsUniform,
        logLossSkillVsUniform: report.metrics.TOTAL_GOALS_3_5.logLossSkillVsUniform,
        positiveRate: report.metrics.TOTAL_GOALS_3_5.positiveRate,
      },
      {
        market: 'BTTS',
        source: report.metrics.BTTS.source,
        rows: report.metrics.BTTS.rows,
        accuracy: report.metrics.BTTS.accuracy,
        brier: report.metrics.BTTS.brier,
        logLoss: report.metrics.BTTS.logLoss,
        ece: report.metrics.BTTS.ece,
        brierSkillVsUniform: report.metrics.BTTS.brierSkillVsUniform,
        logLossSkillVsUniform: report.metrics.BTTS.logLossSkillVsUniform,
        positiveRate: report.metrics.BTTS.positiveRate,
      },
    ],
    binaryRankingByBrier: report.binaryMarketRanking.byBrier,
    binaryRankingByLogLoss: report.binaryMarketRanking.byLogLoss,
    binaryRankingByEce: report.binaryMarketRanking.byEce,
    binaryRankingByAccuracy: report.binaryMarketRanking.byAccuracy,
    oddsUsed: false,
    roiCalculated: false,
    bestBetSelected: false,
    promotional: false,
    nextStage: 'v7.0-beta.1A.4',
  };
}
