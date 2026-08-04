// R4.10.2.9_UI_EXPLAINABILITY_STATUS_CONSISTENCY: web DTO mirrors read-only candidate audit fields.
export interface PersonalLeagueDto {
  id: number;
  apiLeagueId: number;
  name: string;
  season: number;
  country?: string | null;
  logoUrl?: string | null;
}

export interface PersonalBacktestLeagueCoverageDto extends PersonalLeagueDto {
  finishedFixtures: number;
  upcomingFixtures: number;
}

export type PersonalFixtureState = 'BEST_BET' | 'NO_BET' | 'PREDICTION_ONLY' | 'WAITING_DATA';

export type PersonalMarketCode =
  'HDA' | 'BTTS' | 'OVER_UNDER_1_5' | 'OVER_UNDER_2_5' | 'OVER_UNDER_3_5';

export type PersonalMarketStatus =
  | 'BEST_BET'
  | 'ELIGIBLE_VALUE'
  | 'ANALYSIS_ONLY'
  | 'ODDS_AVAILABLE_WAITING_DECISION'
  | 'WAITING_ODDS'
  | 'EVALUATED_VALUE_AVAILABLE'
  | 'EVALUATED_NO_VALUE';

export interface PersonalMarketSelectionDto {
  code: 'HOME' | 'DRAW' | 'AWAY' | 'YES' | 'NO' | 'OVER' | 'UNDER';
  modelProbability: number | null;
  decimalOdds: number | null;
  bookmakerName: string | null;
  fairMarketProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  adjustedModelProbability?: number | null;
  conservativeProbability?: number | null;
  conservativeEdge?: number | null;
  conservativeExpectedValue?: number | null;
  riskAdjustedScore?: number | null;
  signalTier?: string | null;
  modelSource?: string | null;
  modelConfidenceTier?: string | null;
  modelHistorySampleSize?: number | null;
  valueExplainabilityWired?: boolean;
  reliabilityStatus: string | null;
  eligible: boolean;
  rejectionReasons: unknown;
  oddsSource: 'SCIENTIFIC_CANDIDATE' | 'LATEST_SNAPSHOT' | 'NONE';
  oddsObservedAt: string | null;
  oddsSourceUpdatedAt: string | null;
  oddsSourceAgeMinutes: number | null;
  oddsPitUsable: boolean | null;
}

export interface PersonalMarketPredictionDto {
  code: PersonalMarketCode;
  scientificMarketType:
    'MATCH_WINNER' | 'BTTS' | 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5';
  label: string;
  lineValue: number | null;
  status: PersonalMarketStatus;
  selectedAsBestBet: boolean;
  selections: PersonalMarketSelectionDto[];
}

export interface PersonalOddsDiagnosticsDto {
  snapshotRows: number;
  pitUsableRows: number;
  marketsWithOdds: number;
  latestObservedAt: string | null;
  latestSourceUpdatedAt: string | null;
  latestSourceAgeMinutes: number | null;
  latestCheckpoint: {
    horizonMinutes: number;
    horizonLabel: string;
    dueAt: string;
    status: string;
    attemptedAt: string | null;
    completedAt: string | null;
    normalizedOdds: number;
    insertedOdds: number;
    pitUsableOdds: number;
    errorMessage: string | null;
  } | null;
}

export interface PersonalMarketMovementDto {
  source: 'API_FOOTBALL_PIT_SNAPSHOT';
  available: boolean;
  movementAvailable: boolean;
  bookmakerCount: number;
  matchedBookmakerCount: number;
  openingConsensus: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  } | null;
  currentConsensus: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  } | null;
  movement: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  recentMovement: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  steamMoveDetected: boolean;
  steamDirection: 'HOME' | 'DRAW' | 'AWAY' | 'NONE';
  steamStrength: number;
  lateMove: boolean;
  qualityScore: number;
  observedFrom: string | null;
  observedTo: string | null;
  reasons: string[];
}

export interface PersonalTwoWayMarketMovementDto {
  source: 'API_FOOTBALL_PIT_SNAPSHOT';
  code: 'BTTS' | 'OVER_UNDER_1_5' | 'OVER_UNDER_2_5' | 'OVER_UNDER_3_5';
  label: string;
  providerMarketType: 'BTTS' | 'TOTAL_GOALS';
  lineValue: number | null;
  available: boolean;
  movementAvailable: boolean;
  bookmakerCount: number;
  matchedBookmakerCount: number;
  recentMatchedBookmakerCount: number;
  selections: Array<{
    code: 'YES' | 'NO' | 'OVER' | 'UNDER';
    openingProbability: number | null;
    currentProbability: number | null;
    movement: number | null;
    recentMovement: number | null;
  }>;
  steamMoveDetected: boolean;
  steamDirection: 'YES' | 'NO' | 'OVER' | 'UNDER' | 'NONE';
  steamStrength: number;
  bookmakerAgreement: number;
  lateMove: boolean;
  qualityScore: number;
  observedFrom: string | null;
  observedTo: string | null;
  reasons: string[];
}

export type PersonalCurrentRecommendationStatus =
  | 'AVAILABLE'
  | 'NO_FRESH_PIT_ODDS'
  | 'NO_PROVIDER_FIXTURE_SNAPSHOT'
  | 'UNMAPPED_FIXTURE'
  | 'MAPPING_MISMATCH'
  | 'NO_MODEL'
  | 'NO_COMPLETE_MARKET'
  | 'NO_VALUE_SIGNAL'
  | 'NOT_EVALUATED';

export interface PersonalOuOppositeLineStrategyDto {
  version: string;
  strategy: 'OU_OPPOSITE_PROTECTED_LINE';
  predictionMarketType: 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5';
  predictionSelection: 'OVER' | 'UNDER';
  predictionLineValue: 1.5 | 2.5 | 3.5;
  predictionProbability: number;
  recommendedMarketType: 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5';
  recommendedSelection: 'OVER' | 'UNDER';
  recommendedLineValue: 1.5 | 2.5 | 3.5;
  lineShiftGoals: 0 | 1;
  boundaryClamped: boolean;
  paperOnly: true;
}

export interface PersonalCurrentRecommendationDto {
  source: 'CURRENT_SCIENTIFIC_PIT';
  version: string;
  calculatedAt: string;
  providerFixtureId: number;
  localFixtureId: number;
  kickoffAt: string;
  horizonMinutes: number;
  marketType: 'MATCH_WINNER' | 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5' | 'BTTS';
  selection: 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  rankingVersion: string;
  signalTier: 'RISK_ADJUSTED_RESEARCH';
  effectiveModelWeight: number;
  adjustedModelProbability: number;
  probabilityHaircut: number;
  conservativeProbability: number;
  conservativeEdge: number;
  conservativeExpectedValue: number;
  longshotPenalty: number;
  riskAdjustedScore: number;
  quoteCount: number;
  quoteMedianOdds: number;
  quoteAgreementRatio: number;
  quoteDeviationRatio: number;
  quoteOutlier: false;
  reliabilityStatus: string;
  modelSource: 'DYNAMIC_DIXON_COLES' | 'SCIENTIFIC_BASELINE_FALLBACK';
  modelFallbackReason: string | null;
  modelConfidenceTier: 'HIGH' | 'MEDIUM' | 'LIMITED';
  modelHistorySampleSize: number;
  currentSignalEligible: true;
  officialEligible: boolean;
  dataQualityScore: number;
  modelVersion: string;
  sourceOddsSnapshotId: number | null;
  sourceOddsEffectiveAt: string | null;
  sourceOddsUpdatedAt: string | null;
  sourceOddsFirstObservedAt: string | null;
  sourceOddsReobservedAt: string | null;
  sourceOddsFreshnessAt: string | null;
  oddsFreshnessBasis: 'SOURCE_EFFECTIVE_AT' | 'REOBSERVED_AT' | null;
  reobservationRawSnapshotId: number | null;
  reobservationKind: string | null;
  ouOppositeLineStrategy: PersonalOuOppositeLineStrategyDto | null;
  note: 'CURRENT_SIGNAL_NOT_OFFICIAL_BEST_BET';
}

export type PersonalPaperShadowStatus =
  | 'RAW_VALUE_SHADOW'
  | 'HIERARCHICAL_VALUE_SHADOW'
  | 'BOUNDED_VALUE_SHADOW'
  | 'DIAGNOSTIC_SHADOW'
  | 'NO_CANDIDATE';

export interface PersonalPaperShadowRecommendationDto {
  version: string;
  providerFixtureId: number;
  horizonMinutes: number;
  calculatedAt: string;
  status: PersonalPaperShadowStatus;
  consideredCandidates: number;
  validCandidates: number;
  rawValueCandidates: number;
  hierarchicalValueCandidates: number;
  boundedValueCandidates: number;
  selected: {
    rank: 1;
    status: Exclude<PersonalPaperShadowStatus, 'NO_CANDIDATE'>;
    marketType: string;
    selection: string;
    lineValue: number | null;
    decimalOdds: number;
    bookmakerName: string | null;
    modelProbability: number;
    fairMarketProbability: number;
    rawEdge: number;
    rawExpectedValue: number;
    hierarchicalModelWeight: number;
    hierarchicalProbability: number;
    hierarchicalProbabilityHaircut: number;
    hierarchicalConservativeProbability: number;
    hierarchicalEdge: number;
    hierarchicalExpectedValue: number;
    boundedProbabilityAdjustment: number;
    boundedAdjustedProbability: number;
    boundedEdge: number;
    boundedExpectedValue: number;
    paperScore: number;
    rawValuePassed: boolean;
    hierarchicalValuePassed: boolean;
    boundedValuePassed: boolean;
    paperTrackEligible: boolean;
    hypotheticalFlatStakeUnits: 1;
    stakeEligible: false;
    officialEligible: false;
    reliabilityStatus: string | null;
    modelSource: string | null;
    modelVersion: string | null;
    modelConfidenceTier: string | null;
    modelHistorySampleSize: number;
    modelDataQualityScore: number;
    reasonCodes: string[];
    ouOppositeLineStrategy: PersonalOuOppositeLineStrategyDto | null;
  } | null;
  pitSafe: true;
  paperOnly: true;
  historicalRowsRewritten: false;
  automaticPromotion: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

export interface PersonalUpcomingFixtureDto {
  fixture: {
    id: number;
    apiFixtureId: number;
    kickoffAt: string;
    round?: string | null;
    league: PersonalLeagueDto;
    homeTeam: {
      id: number;
      apiTeamId: number;
      name: string;
      logoUrl?: string | null;
    };
    awayTeam: {
      id: number;
      apiTeamId: number;
      name: string;
      logoUrl?: string | null;
    };
  };
  prediction: {
    source: 'SCIENTIFIC_DECISION' | 'API_FOOTBALL' | 'NONE';
    homeProbability: number | null;
    drawProbability: number | null;
    awayProbability: number | null;
    predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
    providerAdvice?: string | null;
    providerPredictedWinner?: string | null;
    providerCapturedAt?: string | null;
  };
  scientificHda: {
    available: boolean;
    source: 'SCIENTIFIC_DECISION' | 'NONE';
    homeProbability: number | null;
    drawProbability: number | null;
    awayProbability: number | null;
    predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
    horizonMinutes: number | null;
    decisionAsOf: string | null;
    modelVersion: string | null;
  };
  providerHda: {
    available: boolean;
    source: 'API_FOOTBALL' | 'NONE';
    homeProbability: number | null;
    drawProbability: number | null;
    awayProbability: number | null;
    predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
    advice: string | null;
    predictedWinner: string | null;
    capturedAt: string | null;
  };
  currentRecommendationStatus: PersonalCurrentRecommendationStatus;
  currentRecommendationError: string | null;
  currentRecommendation: PersonalCurrentRecommendationDto | null;
  paperShadowRecommendation: PersonalPaperShadowRecommendationDto | null;
  decision: {
    id: number;
    decisionType: string;
    horizonMinutes: number;
    decisionAsOf: string;
    selectedMarket?: string | null;
    selectedSelection?: string | null;
    lineValue?: number | null;
    decimalOdds?: number | null;
    bookmakerName?: string | null;
    modelProbability?: number | null;
    fairMarketProbability?: number | null;
    edge?: number | null;
    expectedValue?: number | null;
    reliabilityStatus?: string | null;
    modelVersion: string;
    policyVersion: string;
    candidateCount: number;
    rejectedCandidateCount: number;
    candidates: Array<{
      marketType: string;
      selection: string;
      lineValue?: number | null;
      decimalOdds: number;
      bookmakerName: string;
      modelProbability: number;
      fairMarketProbability: number;
      edge: number;
      expectedValue: number;
      reliabilityStatus: string;
      eligible: boolean;
      rejectionReasons: unknown;
    }>;
  } | null;
  stake: {
    stakeDecisionType: string;
    stakingMode: string;
    stakeUnits: number;
    stakeFraction: number;
    riskBand: string;
    riskReasons: unknown;
    evaluatedAt: string;
  } | null;
  nextCheckpoint: {
    horizonMinutes: number;
    horizonLabel: string;
    dueAt: string;
    status: string;
  } | null;
  marketPredictions: PersonalMarketPredictionDto[];
  oddsDiagnostics: PersonalOddsDiagnosticsDto;
  marketMovement: PersonalMarketMovementDto | null;
  multiMarketMovements: PersonalTwoWayMarketMovementDto[];
  state: PersonalFixtureState;
}

export interface PersonalCurrentRecommendationBatchDto {
  version: string;
  requestedFixtures: number;
  selectedFixtures: number;
  evaluatedFixtures: number;
  notEvaluatedFixtures: number;
  maximumFixtures: number;
  chunkSize: number;
  chunksPlanned: number;
  chunksCompleted: number;
  failedChunks: number;
  singleFixtureRetries: number;
  singleFixtureRetrySuccesses: number;
  missingProviderSnapshotClassifications: number;
  recentRawAttemptFixtures: number;
  pitOddsFixtures: number;
  checkpointPriorityFixtures: number;
  kickoffWithin6hFixtures: number;
  signalQueryError: string | null;
  errors: Array<{
    scope: 'SIGNALS' | 'CHUNK' | 'SINGLE';
    providerFixtureIds: number[];
    reason: string;
  }>;
  strategy: 'CHECKPOINT_RAW_ODDS_KICKOFF_CHUNKED_FAULT_ISOLATION';
  externalApiCalled: false;
  databaseWritten: false;
  realMoneyExecution: false;
}

export interface PersonalUpcomingAnalysisDto {
  version: string;
  generatedAt: string;
  window: {
    from: string;
    to: string;
    days: number;
  };
  counts: {
    fixtures: number;
    predicted: number;
    scientificDecisions: number;
    bestBets: number;
    currentRecommendations: number;
    paperRecommendations: number;
    noBets: number;
    predictionOnly: number;
    waitingData: number;
    fixturesWithOdds?: number;
    fixturesWithPitUsableOdds?: number;
    scientificHdaReady?: number;
    providerHdaAvailable?: number;
    fixturesWithMarketMovement?: number;
    fixturesWithMultiMarketMovement?: number;
  };
  currentRecommendationBatch: PersonalCurrentRecommendationBatchDto;
  currentRecommendationStatusCounts: Record<PersonalCurrentRecommendationStatus, number>;
  leagues: PersonalLeagueDto[];
  topBestBets: PersonalUpcomingFixtureDto[];
  fixtures: PersonalUpcomingFixtureDto[];
  integrity: {
    personalMode: boolean;
    readOnlyAnalysis: boolean;
    predictionIsNotBestBet: boolean;
    currentRecommendationIsShadowSignal: boolean;
    currentRecommendationDoesNotChangeBestBet: boolean;
    recommendationStatusDashboard: boolean;
    currentRecommendationBatchPriority: boolean;
    currentRecommendationChunkFaultIsolation: boolean;
    missingProviderSnapshotTerminalClassification: boolean;
    longshotBiasGuardRiskAdjustedRanking: boolean;
    completeRecommendationCoverage: boolean;
    bestBetComesOnlyFromScientificPaperDecision: boolean;
    syntheticOddsUsed: boolean;
    realMoneyExecution: boolean;
    automaticBetPlacement: boolean;
    automaticPromotion: boolean;
    providerPredictionNeverLabeledAsScientificModel?: boolean;
    scientificHdaNeverFallsBackToProvider?: boolean;
    earlyOddsDoNotCreateBestBet?: boolean;
    marketMovementUsesPitSnapshotsOnly?: boolean;
    multiMarketMovementUsesPitSnapshotsOnly?: boolean;
    multiMarketMovementDoesNotChangeBestBet?: boolean;
  };
}

export type CurrentCompetitionGroup =
  'ASEAN' | 'WAFCON' | 'UCL' | 'UEFA_EUROPA' | 'SEA' | 'ASIA' | 'EPL' | 'LALIGA';

export interface PersonalRefreshResponse {
  version: string;
  command: 'refresh-current-only';
  analysis: PersonalUpcomingAnalysisDto;
  discovery: {
    source: 'API_FOOTBALL_CURRENT_TRUE';
    apiRequests: number;
    quotaRemainingDay: number | null;
    quotaRemainingMinute: number | null;
    competitions: Array<{
      apiLeagueId: number;
      season: number;
      name: string;
      country: string | null;
      group: CurrentCompetitionGroup;
      coverage: Record<string, unknown> | null;
    }>;
  };
  safety: {
    personalMode: true;
    adminTokenRequired: false;
    externalApiCalled: true;
    databaseWritten: true;
    syntheticOddsUsed: false;
    automaticBetPlacement: false;
    realMoneyExecution: false;
    automaticPromotion: false;
    currentFixturesOnly?: boolean;
    demoCompetitionsExcluded?: boolean;
    pastFixturesExcludedFromPredictions?: boolean;
  };
}

export interface PersonalBacktestRunResponse {
  mode: 'PERSONAL';
  adminTokenRequired: false;
  runs: Array<{
    id: number;
    name: string;
    leagueId: number | null;
    leagueName: string | null;
  }>;
}
