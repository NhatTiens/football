import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { prisma } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import { getScientificMultiMarketReplayReport } from './scientific-multi-market-replay-engine.js';
import { actualBtts, actualOverLine } from './scientific-multi-market-replay-contract.js';
import {
  SCIENTIFIC_BEST_BET_EVIDENCE_CLASS,
  SCIENTIFIC_BEST_BET_POLICY,
  SCIENTIFIC_BEST_BET_POLICY_VERSION,
  assessMarketReliability,
  deriveBinaryClimatology,
  deriveMulticlassClimatology,
  type MarketReliabilityAssessment,
  type ModelMetricSummary,
  type ScientificBestBetMarket,
} from './scientific-best-bet-policy-contract.js';

interface ReplayPredictionRow {
  fixtureId: number;
  actualClass: string;
}

interface FixtureScoreRow {
  id: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface ScientificBestBetReliabilityReport {
  version: string;
  evidenceClass: typeof SCIENTIFIC_BEST_BET_EVIDENCE_CLASS;
  promotional: false;
  sourceReplay: {
    version: string;
    replayRunId: number;
    evaluationFixtures: number;
    pitViolations: number;
    dixonStoredProbabilityViolations: number;
    frozenHdaReplayMetricViolations: number;
  };
  policy: {
    minimumOdds: 1.4;
    minimumEdge: 0.04;
    minimumExpectedValue: 0.03;
    maximumBetsPerFixture: 1;
    minimumReliabilityRows: 150;
    minimumRelativeBrierSkillVsClimatology: 0.005;
    minimumLogLossSkillVsClimatology: 0.005;
    maximumEce: 0.05;
    stakeUnitsForEvaluation: 1;
  };
  reliability: Record<ScientificBestBetMarket, MarketReliabilityAssessment>;
  diagnosticEligibleMarkets: ScientificBestBetMarket[];
  blockedMarkets: ScientificBestBetMarket[];
  bestBetContract: {
    frozen: true;
    rankingOrder: readonly [
      'EXPECTED_VALUE_DESC',
      'EDGE_DESC',
      'MODEL_PROBABILITY_DESC',
      'DECIMAL_ODDS_ASC',
      'DETERMINISTIC_MARKET_SELECTION_TIEBREAK',
    ];
    noBetIsValidDecision: true;
    requiresReliabilityEligibility: true;
    requiresRealOdds: true;
    realBestBetExecutionEnabled: false;
    rationale: string;
  };
  safety: {
    historicalDataRewritten: false;
    liveApiCalled: false;
    syntheticOddsUsed: false;
    roiCalculated: false;
    clvCalculated: false;
    freshShadowRowsWritten: 0;
    productionRoutingChanged: false;
    automaticPromotion: false;
  };
  apiHandoff: {
    upgradeRequiredBeforeNextStage: true;
    requiredAtStage: 'v7.0-beta.1B';
    requiredCapabilities: string[];
  };
  artifactDirectory: string;
  payloadHash: string;
  nextStage: 'v7.0-beta.1B';
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
    process.env.SCIENTIFIC_BEST_BET_ARTIFACT_DIRECTORY ?? 'artifacts/provider/v7-beta1a4',
  );
}

function metricSummary(value: {
  rows: number;
  classCount: 2 | 3;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
}): ModelMetricSummary {
  return {
    rows: value.rows,
    classCount: value.classCount,
    accuracy: value.accuracy,
    brier: value.brier,
    logLoss: value.logLoss,
    ece: value.ece,
  };
}

function requireFinishedScore(fixture: FixtureScoreRow | undefined): {
  homeGoals: number;
  awayGoals: number;
} {
  if (fixture?.homeGoals == null || fixture.awayGoals == null) {
    throw new Error('beta.1A.4 requires a final score for every beta.1A.3 evaluation fixture.');
  }

  return {
    homeGoals: fixture.homeGoals,
    awayGoals: fixture.awayGoals,
  };
}

export async function runScientificBestBetReliability(
  input: {
    writeArtifacts?: boolean;
  } = {},
): Promise<ScientificBestBetReliabilityReport> {
  const replay = await getScientificMultiMarketReplayReport();

  if (
    replay.coverage.pitViolations !== 0 ||
    replay.equivalence.dixonStoredProbabilityViolations !== 0 ||
    replay.equivalence.frozenHdaReplayMetricViolations !== 0
  ) {
    throw new Error('beta.1A.3 scientific gates must be clean before beta.1A.4.');
  }

  const predictions = (await prisma.providerReplayPrediction.findMany({
    where: {
      runId: replay.replaySource.runId,
      horizonMinutes: 90,
    },
    select: {
      fixtureId: true,
      actualClass: true,
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

  if (predictions.length !== replay.coverage.evaluationFixtures) {
    throw new Error(
      `Replay row mismatch: beta.1A.3 evaluated ${replay.coverage.evaluationFixtures}, beta.1A.4 resolved ${predictions.length}.`,
    );
  }

  const fixtureIds = predictions.map((row) => row.fixtureId);
  const fixtures = (await prisma.fixture.findMany({
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
  })) as FixtureScoreRow[];

  const fixtureMap = new Map(fixtures.map((row) => [row.id, row]));

  const hdaActuals = predictions.map((row) => {
    if (!['HOME', 'DRAW', 'AWAY'].includes(row.actualClass)) {
      throw new Error(`Unsupported MATCH_WINNER class: ${row.actualClass}.`);
    }

    return row.actualClass;
  });

  const over15: boolean[] = [];
  const over25: boolean[] = [];
  const over35: boolean[] = [];
  const btts: boolean[] = [];

  for (const prediction of predictions) {
    const score = requireFinishedScore(fixtureMap.get(prediction.fixtureId));

    over15.push(actualOverLine(score.homeGoals, score.awayGoals, 1.5));
    over25.push(actualOverLine(score.homeGoals, score.awayGoals, 2.5));
    over35.push(actualOverLine(score.homeGoals, score.awayGoals, 3.5));
    btts.push(actualBtts(score.homeGoals, score.awayGoals));
  }

  const reliability = {
    MATCH_WINNER: assessMarketReliability({
      market: 'MATCH_WINNER',
      model: metricSummary(replay.metrics.MATCH_WINNER),
      climatology: deriveMulticlassClimatology(hdaActuals, ['HOME', 'DRAW', 'AWAY']),
    }),
    TOTAL_GOALS_1_5: assessMarketReliability({
      market: 'TOTAL_GOALS_1_5',
      model: metricSummary(replay.metrics.TOTAL_GOALS_1_5),
      climatology: deriveBinaryClimatology(over15),
    }),
    TOTAL_GOALS_2_5: assessMarketReliability({
      market: 'TOTAL_GOALS_2_5',
      model: metricSummary(replay.metrics.TOTAL_GOALS_2_5),
      climatology: deriveBinaryClimatology(over25),
    }),
    TOTAL_GOALS_3_5: assessMarketReliability({
      market: 'TOTAL_GOALS_3_5',
      model: metricSummary(replay.metrics.TOTAL_GOALS_3_5),
      climatology: deriveBinaryClimatology(over35),
    }),
    BTTS: assessMarketReliability({
      market: 'BTTS',
      model: metricSummary(replay.metrics.BTTS),
      climatology: deriveBinaryClimatology(btts),
    }),
  } satisfies Record<ScientificBestBetMarket, MarketReliabilityAssessment>;

  const markets = Object.keys(reliability) as ScientificBestBetMarket[];
  const diagnosticEligibleMarkets = markets.filter(
    (market) => reliability[market].diagnosticEligible,
  );
  const blockedMarkets = markets.filter((market) => !reliability[market].diagnosticEligible);

  const reportWithoutArtifact = {
    version: SCIENTIFIC_BEST_BET_POLICY_VERSION,
    evidenceClass: SCIENTIFIC_BEST_BET_EVIDENCE_CLASS,
    promotional: false as const,
    sourceReplay: {
      version: replay.version,
      replayRunId: replay.replaySource.runId,
      evaluationFixtures: replay.coverage.evaluationFixtures,
      pitViolations: replay.coverage.pitViolations,
      dixonStoredProbabilityViolations: replay.equivalence.dixonStoredProbabilityViolations,
      frozenHdaReplayMetricViolations: replay.equivalence.frozenHdaReplayMetricViolations,
    },
    policy: {
      minimumOdds: SCIENTIFIC_BEST_BET_POLICY.minimumOdds,
      minimumEdge: SCIENTIFIC_BEST_BET_POLICY.minimumEdge,
      minimumExpectedValue: SCIENTIFIC_BEST_BET_POLICY.minimumExpectedValue,
      maximumBetsPerFixture: SCIENTIFIC_BEST_BET_POLICY.maximumBetsPerFixture,
      minimumReliabilityRows: SCIENTIFIC_BEST_BET_POLICY.minimumReliabilityRows,
      minimumRelativeBrierSkillVsClimatology:
        SCIENTIFIC_BEST_BET_POLICY.minimumRelativeBrierSkillVsClimatology,
      minimumLogLossSkillVsClimatology: SCIENTIFIC_BEST_BET_POLICY.minimumLogLossSkillVsClimatology,
      maximumEce: SCIENTIFIC_BEST_BET_POLICY.maximumEce,
      stakeUnitsForEvaluation: SCIENTIFIC_BEST_BET_POLICY.stakeUnitsForEvaluation,
    },
    reliability,
    diagnosticEligibleMarkets,
    blockedMarkets,
    bestBetContract: {
      frozen: true as const,
      rankingOrder: [
        'EXPECTED_VALUE_DESC',
        'EDGE_DESC',
        'MODEL_PROBABILITY_DESC',
        'DECIMAL_ODDS_ASC',
        'DETERMINISTIC_MARKET_SELECTION_TIEBREAK',
      ] as const,
      noBetIsValidDecision: true as const,
      requiresReliabilityEligibility: true as const,
      requiresRealOdds: true as const,
      realBestBetExecutionEnabled: false as const,
      rationale:
        'The selection contract is frozen now, but real BEST BET execution remains disabled until beta.1B provides timestamped real bookmaker odds.',
    },
    safety: {
      historicalDataRewritten: false as const,
      liveApiCalled: false as const,
      syntheticOddsUsed: false as const,
      roiCalculated: false as const,
      clvCalculated: false as const,
      freshShadowRowsWritten: 0 as const,
      productionRoutingChanged: false as const,
      automaticPromotion: false as const,
    },
    apiHandoff: {
      upgradeRequiredBeforeNextStage: true as const,
      requiredAtStage: 'v7.0-beta.1B' as const,
      requiredCapabilities: [
        'HISTORICAL_FIXTURES_RESULTS',
        'HISTORICAL_TEAM_MATCH_STATISTICS',
        'TIMESTAMPED_HISTORICAL_MATCH_WINNER_ODDS',
        'TIMESTAMPED_HISTORICAL_TOTAL_GOALS_ODDS',
        'TIMESTAMPED_HISTORICAL_BTTS_ODDS',
        'LIVE_FIXTURES_RESULTS',
        'LIVE_MATCH_WINNER_ODDS',
        'LIVE_TOTAL_GOALS_ODDS',
        'LIVE_BTTS_ODDS',
        'PREFER_STANDINGS_INJURIES_LINEUPS_WITH_AVAILABILITY_TIMESTAMPS',
      ],
    },
    nextStage: 'v7.0-beta.1B' as const,
  };

  const payloadHash = deterministicHash('SCIENTIFIC_BEST_BET_RELIABILITY', reportWithoutArtifact);
  const artifactDirectory = resolve(
    artifactRoot(),
    `${SCIENTIFIC_BEST_BET_POLICY_VERSION}-${payloadHash.slice(0, 12)}`,
  );
  const relativeArtifactDirectory = relative(repositoryRoot(), artifactDirectory).replaceAll(
    '\\',
    '/',
  );

  const report: ScientificBestBetReliabilityReport = {
    ...reportWithoutArtifact,
    artifactDirectory: relativeArtifactDirectory,
    payloadHash,
  };

  if (input.writeArtifacts !== false) {
    mkdirSync(artifactDirectory, {
      recursive: true,
    });

    writeFileSync(
      resolve(artifactDirectory, 'best-bet-reliability-report.json'),
      JSON.stringify(report, null, 2) + '\n',
      'utf8',
    );
  }

  return report;
}

export async function getScientificBestBetReliabilitySummary(): Promise<{
  version: string;
  evaluationFixtures: number;
  policy: ScientificBestBetReliabilityReport['policy'];
  markets: Array<{
    market: ScientificBestBetMarket;
    status: string;
    diagnosticEligible: boolean;
    rows: number;
    modelBrier: number | null;
    climatologyBrier: number;
    relativeBrierSkillVsClimatology: number | null;
    modelLogLoss: number | null;
    climatologyLogLoss: number;
    logLossSkillVsClimatology: number | null;
    ece: number | null;
    reasons: string[];
  }>;
  diagnosticEligibleMarkets: ScientificBestBetMarket[];
  blockedMarkets: ScientificBestBetMarket[];
  bestBetContractFrozen: true;
  realBestBetExecutionEnabled: false;
  apiUpgradeRequiredBeforeNextStage: true;
  nextStage: 'v7.0-beta.1B';
}> {
  const report = await runScientificBestBetReliability({
    writeArtifacts: false,
  });

  const marketOrder: ScientificBestBetMarket[] = [
    'MATCH_WINNER',
    'TOTAL_GOALS_1_5',
    'TOTAL_GOALS_2_5',
    'TOTAL_GOALS_3_5',
    'BTTS',
  ];

  return {
    version: report.version,
    evaluationFixtures: report.sourceReplay.evaluationFixtures,
    policy: report.policy,
    markets: marketOrder.map((market) => {
      const item = report.reliability[market];

      return {
        market,
        status: item.status,
        diagnosticEligible: item.diagnosticEligible,
        rows: item.model.rows,
        modelBrier: item.model.brier,
        climatologyBrier: item.climatology.brier,
        relativeBrierSkillVsClimatology: item.relativeBrierSkillVsClimatology,
        modelLogLoss: item.model.logLoss,
        climatologyLogLoss: item.climatology.logLoss,
        logLossSkillVsClimatology: item.logLossSkillVsClimatology,
        ece: item.model.ece,
        reasons: item.reasons,
      };
    }),
    diagnosticEligibleMarkets: report.diagnosticEligibleMarkets,
    blockedMarkets: report.blockedMarkets,
    bestBetContractFrozen: true,
    realBestBetExecutionEnabled: false,
    apiUpgradeRequiredBeforeNextStage: true,
    nextStage: 'v7.0-beta.1B',
  };
}

export async function getScientificBestBetReliabilityReport(): Promise<ScientificBestBetReliabilityReport> {
  return runScientificBestBetReliability({
    writeArtifacts: false,
  });
}
