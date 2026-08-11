export type UserMarketRole = 'USER' | 'ANALYST' | 'ADMIN' | null | undefined;

type JsonRecord = Record<string, any>;

export function canAccessMatchWinner(role: UserMarketRole): boolean {
  return role === 'ANALYST' || role === 'ADMIN';
}

export function isMatchWinnerMarket(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
  return (
    normalized === 'MATCH_WINNER' ||
    normalized === 'HDA' ||
    normalized === '1X2'
  );
}

function hasAllowedModel(market: JsonRecord): boolean {
  return (
    !isMatchWinnerMarket(market.scientificMarketType) &&
    !isMatchWinnerMarket(market.code) &&
    Array.isArray(market.selections) &&
    market.selections.some(
      (selection: JsonRecord) =>
        selection != null &&
        typeof selection === 'object' &&
        selection.modelProbability != null,
    )
  );
}

function sanitizePaperShadow(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  const row = value as JsonRecord;
  const selected = row.selected;

  if (
    selected != null &&
    typeof selected === 'object' &&
    isMatchWinnerMarket((selected as JsonRecord).marketType)
  ) {
    return {
      ...row,
      status: 'NO_CANDIDATE',
      consideredCandidates: 0,
      validCandidates: 0,
      rawValueCandidates: 0,
      hierarchicalValueCandidates: 0,
      boundedValueCandidates: 0,
      selected: null,
    };
  }

  return row;
}

function sanitizeFixture(row: JsonRecord): JsonRecord {
  const allowedMarkets = Array.isArray(row.marketPredictions)
    ? row.marketPredictions.filter(
        (market: JsonRecord) =>
          market != null &&
          typeof market === 'object' &&
          !isMatchWinnerMarket(market.scientificMarketType) &&
          !isMatchWinnerMarket(market.code),
      )
    : [];

  const currentRecommendationWasMatchWinner = isMatchWinnerMarket(
    row.currentRecommendation?.marketType,
  );
  const decisionWasMatchWinner = isMatchWinnerMarket(row.decision?.selectedMarket);
  const paperShadowWasMatchWinner = isMatchWinnerMarket(
    row.paperShadowRecommendation?.selected?.marketType,
  );

  const nextDecision =
    row.decision == null
      ? null
      : decisionWasMatchWinner
        ? null
        : {
            ...row.decision,
            candidates: Array.isArray(row.decision.candidates)
              ? row.decision.candidates.filter(
                  (candidate: JsonRecord) =>
                    !isMatchWinnerMarket(candidate?.marketType),
                )
              : [],
          };

  const hasModel = allowedMarkets.some(hasAllowedModel);

  let nextState = row.state;
  if (decisionWasMatchWinner && row.state === 'BEST_BET') {
    nextState = hasModel ? 'PREDICTION_ONLY' : 'WAITING_DATA';
  }

  const nextCurrentRecommendation = currentRecommendationWasMatchWinner
    ? null
    : row.currentRecommendation ?? null;

  const nextPaperShadow = paperShadowWasMatchWinner
    ? sanitizePaperShadow(row.paperShadowRecommendation)
    : row.paperShadowRecommendation ?? null;

  const allowedMarketCount = allowedMarkets.filter((market: JsonRecord) =>
    Array.isArray(market.selections)
      ? market.selections.some(
          (selection: JsonRecord) => selection?.decimalOdds != null,
        )
      : false,
  ).length;

  return {
    ...row,
    prediction: {
      ...(row.prediction ?? {}),
      source: 'NONE',
      homeProbability: null,
      drawProbability: null,
      awayProbability: null,
      predictedSelection: null,
      providerAdvice: null,
      providerPredictedWinner: null,
      providerCapturedAt: null,
    },
    scientificHda: {
      ...(row.scientificHda ?? {}),
      available: false,
      source: 'NONE',
      homeProbability: null,
      drawProbability: null,
      awayProbability: null,
      predictedSelection: null,
      horizonMinutes: null,
      decisionAsOf: null,
      modelVersion: null,
    },
    providerHda: {
      ...(row.providerHda ?? {}),
      available: false,
      source: 'NONE',
      homeProbability: null,
      drawProbability: null,
      awayProbability: null,
      predictedSelection: null,
      advice: null,
      predictedWinner: null,
      capturedAt: null,
    },
    currentRecommendationStatus: currentRecommendationWasMatchWinner
      ? 'NO_VALUE_SIGNAL'
      : row.currentRecommendationStatus,
    currentRecommendationError: currentRecommendationWasMatchWinner
      ? 'USER_MARKET_SCOPE_BTTS_OU_ONLY'
      : row.currentRecommendationError,
    currentRecommendation: nextCurrentRecommendation,
    paperShadowRecommendation: nextPaperShadow,
    decision: nextDecision,
    stake: decisionWasMatchWinner ? null : row.stake ?? null,
    marketPredictions: allowedMarkets,
    marketMovement: null,
    oddsDiagnostics: {
      ...(row.oddsDiagnostics ?? {}),
      marketsWithOdds: allowedMarketCount,
    },
    state: nextState,
  };
}

function countStates(fixtures: JsonRecord[], state: string): number {
  return fixtures.filter((row) => row.state === state).length;
}

export function sanitizeUserPredictionAnalysis<T extends JsonRecord>(analysis: T): T {
  const fixtures = Array.isArray(analysis.fixtures)
    ? analysis.fixtures.map((row: JsonRecord) => sanitizeFixture(row))
    : [];

  const originalTopLimit = Array.isArray(analysis.topBestBets)
    ? Math.max(1, analysis.topBestBets.length)
    : 10;

  const statusKeys = Object.keys(analysis.currentRecommendationStatusCounts ?? {});
  const statusCounts: Record<string, number> = {};
  for (const key of statusKeys) statusCounts[key] = 0;

  for (const row of fixtures) {
    const status = row.currentRecommendationStatus;
    if (typeof status === 'string') {
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
  }

  const counts = {
    ...(analysis.counts ?? {}),
    fixtures: fixtures.length,
    predicted: fixtures.filter((row) =>
      Array.isArray(row.marketPredictions)
        ? row.marketPredictions.some(hasAllowedModel)
        : false,
    ).length,
    scientificDecisions: fixtures.filter((row) => row.decision != null).length,
    bestBets: countStates(fixtures, 'BEST_BET'),
    currentRecommendations: fixtures.filter(
      (row) => row.currentRecommendation != null,
    ).length,
    paperRecommendations: fixtures.filter(
      (row) => row.paperShadowRecommendation?.selected != null,
    ).length,
    noBets: countStates(fixtures, 'NO_BET'),
    predictionOnly: countStates(fixtures, 'PREDICTION_ONLY'),
    waitingData: countStates(fixtures, 'WAITING_DATA'),
    scientificHdaReady: 0,
    providerHdaAvailable: 0,
    fixturesWithMarketMovement: 0,
    fixturesWithMultiMarketMovement: fixtures.filter(
      (row) =>
        Array.isArray(row.multiMarketMovements) &&
        row.multiMarketMovements.length > 0,
    ).length,
  };

  return {
    ...analysis,
    counts,
    currentRecommendationStatusCounts: statusCounts,
    topBestBets: fixtures
      .filter((row) => row.state === 'BEST_BET')
      .slice(0, originalTopLimit),
    fixtures,
    integrity: {
      ...(analysis.integrity ?? {}),
      userMarketScope: 'BTTS_OU_ONLY',
    },
  };
}

export function sanitizeUserPredictionRefresh<T extends JsonRecord>(payload: T): T {
  if (payload == null || typeof payload !== 'object' || payload.analysis == null) {
    return payload;
  }

  return {
    ...payload,
    analysis: sanitizeUserPredictionAnalysis(payload.analysis),
  };
}
