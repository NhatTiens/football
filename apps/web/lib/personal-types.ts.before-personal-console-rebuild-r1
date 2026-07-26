export interface PersonalLeagueDto {
  id: number;
  apiLeagueId: number;
  name: string;
  season: number;
  country?: string | null;
  logoUrl?: string | null;
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
  decision: {
    id: number;
    decisionType: 'BEST_BET' | 'NO_BET' | string;
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
  state: 'BEST_BET' | 'NO_BET' | 'WAITING_PREDICTION' | 'WAITING_SCIENTIFIC_DECISION';
}

export interface PersonalUpcomingAnalysisDto {
  version: string;
  generatedAt: string;
  window: { from: string; to: string; days: number };
  counts: {
    fixtures: number;
    predicted: number;
    scientificDecisions: number;
    bestBets: number;
    noBets: number;
    waiting: number;
  };
  leagues: PersonalLeagueDto[];
  topBestBets: PersonalUpcomingFixtureDto[];
  fixtures: PersonalUpcomingFixtureDto[];
  integrity: {
    personalMode: boolean;
    readOnlyAnalysis: boolean;
    bestBetComesOnlyFromScientificPaperDecision: boolean;
    syntheticOddsUsed: boolean;
    realMoneyExecution: boolean;
    automaticBetPlacement: boolean;
    automaticPromotion: boolean;
  };
}

export interface PersonalBacktestRunResponse {
  mode: 'PERSONAL';
  adminTokenRequired: false;
  runs: Array<{ id: number; name: string }>;
}

export interface PersonalBacktestLeagueCoverageDto extends PersonalLeagueDto {
  finishedFixtures: number;
  upcomingFixtures: number;
}
