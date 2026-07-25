import {
  buildRecommendationCandidates,
  deriveMarketProbabilities,
  profitForSettlement,
  settleSelection,
  type ExpectedGoals,
  type LatestOdds,
  type MarketProbabilities,
  type ModelProbabilitySet,
  type RecommendationCandidate,
  type RecommendationRules,
  type SettlementResultCode,
} from '@football-ai/engine';

export const SCIENTIFIC_MULTI_MARKET_PORT_VERSION = 'v7.0-beta.1A.2-legacy-multi-market-port-v1';

export const SCIENTIFIC_MULTI_MARKET_PORT_POLICY = 'legacy-capability-port-non-promotional-v1';

export const FUTURE_BEST_BET_MINIMUM_ODDS = 1.4;

export type ScientificMarketCode = 'MATCH_WINNER' | 'TOTAL_GOALS' | 'BTTS';

export type ScientificSelectionCode = 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';

export interface ScientificMarketProbability {
  marketCode: ScientificMarketCode;
  selectionCode: ScientificSelectionCode;
  lineValue: number | null;
  probability: number;
  legacyMarketCode: 'MATCH_WINNER' | 'TOTAL_GOALS_2_5' | 'BTTS';
  source: 'LEGACY_POISSON_V1';
}

export interface ScientificPortedCandidate {
  marketCode: ScientificMarketCode;
  selectionCode: ScientificSelectionCode;
  lineValue: number | null;
  decimalOdds: number;
  modelProbability: number;
  fairMarketProbability: number;
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  confidenceScore: number;
  dataQualityScore: number;
  legacyRecommendationScore: number;
  bookmakerCount: number;
  bookmakerName: string;
  legacyMarketCode: 'MATCH_WINNER' | 'TOTAL_GOALS_2_5' | 'BTTS';
  evidenceClass: 'LEGACY_PORT_DIAGNOSTIC_ONLY';
  rankingPolicy: 'LEGACY_RECOMMENDATION_SCORE_DIAGNOSTIC_ONLY';
  reasons: string[];
}

export interface ScientificPortSettlement {
  result: SettlementResultCode;
  fixedStakeUnits: 1;
  profitUnits: number;
  promotional: false;
}

function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a probability in [0, 1].`);
  }
}

function assertNormalized(
  rows: ScientificMarketProbability[],
  marketCode: ScientificMarketCode,
  tolerance = 1e-8,
): void {
  const total = rows
    .filter((row) => row.marketCode === marketCode)
    .reduce((sum, row) => sum + row.probability, 0);

  if (Math.abs(total - 1) > tolerance) {
    throw new RangeError(`${marketCode} probabilities must sum to 1; received ${total}.`);
  }
}

export function legacyProbabilitiesToScientific(
  probabilities: MarketProbabilities,
): ScientificMarketProbability[] {
  const rows: ScientificMarketProbability[] = [
    {
      marketCode: 'MATCH_WINNER',
      selectionCode: 'HOME',
      lineValue: null,
      probability: probabilities.MATCH_WINNER.HOME,
      legacyMarketCode: 'MATCH_WINNER',
      source: 'LEGACY_POISSON_V1',
    },
    {
      marketCode: 'MATCH_WINNER',
      selectionCode: 'DRAW',
      lineValue: null,
      probability: probabilities.MATCH_WINNER.DRAW,
      legacyMarketCode: 'MATCH_WINNER',
      source: 'LEGACY_POISSON_V1',
    },
    {
      marketCode: 'MATCH_WINNER',
      selectionCode: 'AWAY',
      lineValue: null,
      probability: probabilities.MATCH_WINNER.AWAY,
      legacyMarketCode: 'MATCH_WINNER',
      source: 'LEGACY_POISSON_V1',
    },
    {
      marketCode: 'TOTAL_GOALS',
      selectionCode: 'OVER',
      lineValue: 2.5,
      probability: probabilities.TOTAL_GOALS_2_5.OVER,
      legacyMarketCode: 'TOTAL_GOALS_2_5',
      source: 'LEGACY_POISSON_V1',
    },
    {
      marketCode: 'TOTAL_GOALS',
      selectionCode: 'UNDER',
      lineValue: 2.5,
      probability: probabilities.TOTAL_GOALS_2_5.UNDER,
      legacyMarketCode: 'TOTAL_GOALS_2_5',
      source: 'LEGACY_POISSON_V1',
    },
    {
      marketCode: 'BTTS',
      selectionCode: 'YES',
      lineValue: null,
      probability: probabilities.BTTS.YES,
      legacyMarketCode: 'BTTS',
      source: 'LEGACY_POISSON_V1',
    },
    {
      marketCode: 'BTTS',
      selectionCode: 'NO',
      lineValue: null,
      probability: probabilities.BTTS.NO,
      legacyMarketCode: 'BTTS',
      source: 'LEGACY_POISSON_V1',
    },
  ];

  for (const row of rows) {
    assertProbability(row.probability, `${row.marketCode}:${row.selectionCode}`);
  }

  assertNormalized(rows, 'MATCH_WINNER');
  assertNormalized(rows, 'TOTAL_GOALS');
  assertNormalized(rows, 'BTTS');

  return rows;
}

export function deriveLegacyScientificProbabilities(
  expectedGoals: ExpectedGoals,
): ScientificMarketProbability[] {
  return legacyProbabilitiesToScientific(deriveMarketProbabilities(expectedGoals));
}

export function toLegacyModelProbabilitySet(
  rows: ScientificMarketProbability[],
): ModelProbabilitySet {
  const lookup = (
    marketCode: ScientificMarketCode,
    selectionCode: ScientificSelectionCode,
    lineValue: number | null = null,
  ): number => {
    const row = rows.find(
      (candidate) =>
        candidate.marketCode === marketCode &&
        candidate.selectionCode === selectionCode &&
        candidate.lineValue === lineValue,
    );

    if (!row) {
      throw new Error(
        `Missing scientific market probability ${marketCode}:${selectionCode}:${String(lineValue)}.`,
      );
    }

    return row.probability;
  };

  return {
    MATCH_WINNER: {
      HOME: lookup('MATCH_WINNER', 'HOME'),
      DRAW: lookup('MATCH_WINNER', 'DRAW'),
      AWAY: lookup('MATCH_WINNER', 'AWAY'),
    },
    TOTAL_GOALS_2_5: {
      OVER: lookup('TOTAL_GOALS', 'OVER', 2.5),
      UNDER: lookup('TOTAL_GOALS', 'UNDER', 2.5),
    },
    BTTS: {
      YES: lookup('BTTS', 'YES'),
      NO: lookup('BTTS', 'NO'),
    },
  };
}

function normalizeCandidate(candidate: RecommendationCandidate): ScientificPortedCandidate {
  const marketCode: ScientificMarketCode =
    candidate.marketCode === 'TOTAL_GOALS_2_5' ? 'TOTAL_GOALS' : candidate.marketCode;

  return {
    marketCode,
    selectionCode: candidate.selectionCode as ScientificSelectionCode,
    lineValue:
      candidate.marketCode === 'TOTAL_GOALS_2_5'
        ? (candidate.lineValue ?? 2.5)
        : candidate.lineValue,
    decimalOdds: candidate.decimalOdds,
    modelProbability: candidate.modelProbability,
    fairMarketProbability: candidate.fairMarketProbability,
    impliedProbability: candidate.impliedProbability,
    edge: candidate.edge,
    expectedValue: candidate.expectedValue,
    confidenceScore: candidate.confidenceScore,
    dataQualityScore: candidate.dataQualityScore,
    legacyRecommendationScore: candidate.recommendationScore,
    bookmakerCount: candidate.bookmakerCount,
    bookmakerName: candidate.bookmakerName,
    legacyMarketCode: candidate.marketCode,
    evidenceClass: 'LEGACY_PORT_DIAGNOSTIC_ONLY',
    rankingPolicy: 'LEGACY_RECOMMENDATION_SCORE_DIAGNOSTIC_ONLY',
    reasons: [...candidate.reasons],
  };
}

export function buildPortedLegacyCandidates(input: {
  odds: LatestOdds[];
  probabilities: ScientificMarketProbability[];
  rules: RecommendationRules;
  now: Date;
  historySampleSize: number;
  dataQualityScore: number;
  matchWinnerAgreement?: Record<'HOME' | 'DRAW' | 'AWAY', number>;
}): ScientificPortedCandidate[] {
  const legacy = buildRecommendationCandidates({
    odds: input.odds,
    probabilities: toLegacyModelProbabilitySet(input.probabilities),
    rules: input.rules,
    now: input.now,
    historySampleSize: input.historySampleSize,
    dataQualityScore: input.dataQualityScore,
    ...(input.matchWinnerAgreement ? { matchWinnerAgreement: input.matchWinnerAgreement } : {}),
  });

  return legacy.map(normalizeCandidate);
}

function toLegacySettlementInput(input: {
  marketCode: ScientificMarketCode;
  selectionCode: ScientificSelectionCode;
  lineValue: number | null;
  homeGoals: number;
  awayGoals: number;
}): {
  marketCode: string;
  selectionCode: string;
  lineValue: number | null;
  homeGoals: number;
  awayGoals: number;
} {
  if (input.marketCode === 'TOTAL_GOALS') {
    const line = input.lineValue ?? 2.5;

    if (line !== 2.5) {
      throw new RangeError(
        'beta.1A.2 ports legacy TOTAL_GOALS_2_5 only; other goal lines are reserved for beta.1A.3.',
      );
    }

    return {
      ...input,
      marketCode: 'TOTAL_GOALS_2_5',
      lineValue: 2.5,
    };
  }

  return input;
}

export function settlePortedLegacySelection(input: {
  marketCode: ScientificMarketCode;
  selectionCode: ScientificSelectionCode;
  lineValue: number | null;
  homeGoals: number;
  awayGoals: number;
}): ScientificPortSettlement {
  const result = settleSelection(toLegacySettlementInput(input));

  return {
    result,
    fixedStakeUnits: 1,
    profitUnits: profitForSettlement(result, 1, 1),
    promotional: false,
  };
}

export function settlePortedLegacySelectionAtOdds(input: {
  marketCode: ScientificMarketCode;
  selectionCode: ScientificSelectionCode;
  lineValue: number | null;
  decimalOdds: number;
  homeGoals: number;
  awayGoals: number;
}): ScientificPortSettlement {
  if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) {
    throw new RangeError('decimalOdds must be greater than 1.');
  }

  const result = settleSelection(toLegacySettlementInput(input));

  return {
    result,
    fixedStakeUnits: 1,
    profitUnits: profitForSettlement(result, input.decimalOdds, 1),
    promotional: false,
  };
}

export function getScientificMultiMarketPortReport(): {
  version: string;
  policy: string;
  legacyCapabilities: {
    predictionMarkets: string[];
    recommendationMarkets: string[];
    settlementMarkets: string[];
    hasEdge: true;
    hasExpectedValue: true;
    hasConfidence: true;
    hasDataQuality: true;
    hasCorrelationFiltering: true;
    hasVariableStakingElsewhere: true;
  };
  scientificPort: {
    normalizedMarkets: string[];
    probabilitySelections: number;
    fixedEvaluationStakeUnits: 1;
    legacyRankingPromotional: false;
    bestBetPolicyActivated: false;
    futureMinimumOdds: number;
    newTotalGoalLinesActivated: false;
    freshShadowWrites: 0;
    productionChanged: false;
  };
  nextStage: 'v7.0-beta.1A.3';
} {
  return {
    version: SCIENTIFIC_MULTI_MARKET_PORT_VERSION,
    policy: SCIENTIFIC_MULTI_MARKET_PORT_POLICY,
    legacyCapabilities: {
      predictionMarkets: ['MATCH_WINNER', 'TOTAL_GOALS_2_5', 'BTTS'],
      recommendationMarkets: ['MATCH_WINNER', 'TOTAL_GOALS_2_5', 'BTTS'],
      settlementMarkets: ['MATCH_WINNER', 'TOTAL_GOALS_2_5', 'BTTS'],
      hasEdge: true,
      hasExpectedValue: true,
      hasConfidence: true,
      hasDataQuality: true,
      hasCorrelationFiltering: true,
      hasVariableStakingElsewhere: true,
    },
    scientificPort: {
      normalizedMarkets: ['MATCH_WINNER', 'TOTAL_GOALS', 'BTTS'],
      probabilitySelections: 7,
      fixedEvaluationStakeUnits: 1,
      legacyRankingPromotional: false,
      bestBetPolicyActivated: false,
      futureMinimumOdds: FUTURE_BEST_BET_MINIMUM_ODDS,
      newTotalGoalLinesActivated: false,
      freshShadowWrites: 0,
      productionChanged: false,
    },
    nextStage: 'v7.0-beta.1A.3',
  };
}
