export interface TeamDto {
  id: number;
  apiTeamId: number;
  name: string;
  code?: string | null;
  logoUrl?: string | null;
}

export interface LeagueDto {
  id: number;
  apiLeagueId: number;
  name: string;
  season: number;
  country?: string | null;
  logoUrl?: string | null;
}

export interface FixtureDto {
  id: number;
  apiFixtureId: number;
  kickoffAt: string;
  status: string;
  apiStatusShort?: string | null;
  round?: string | null;
  venueName?: string | null;
  score: { home?: number | null; away?: number | null };
  league: LeagueDto;
  homeTeam: TeamDto;
  awayTeam: TeamDto;
  recommendationCount?: number;
}

export interface RecommendationDto {
  id: number;
  rank?: number | null;
  marketCode: string;
  marketName: string;
  marketGroup: string;
  selectionCode: string;
  selectionName: string;
  lineValue?: number | null;
  odds: number;
  modelProbability: number;
  fairMarketProbability: number;
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  confidenceScore: number;
  dataQualityScore: number;
  recommendationScore: number;
  modelVersion: string;
  reasons: string[];
  status: string;
  settlementResult: string;
  simulatedProfitUnits?: number | null;
  generatedAt: string;
  expiresAt: string;
  bookmaker: { id: number; name: string };
  fixture?: FixtureDto;
}

export interface DashboardStats {
  upcomingFixtures: number;
  activeRecommendations: number;
  settledRecommendations: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  simulatedProfitUnits: number;
  yield: number | null;
  latestApiQuota: {
    dailyRemaining?: number | null;
    dailyLimit?: number | null;
    minuteRemaining?: number | null;
    minuteLimit?: number | null;
  } | null;
  lastSyncRuns: Array<{
    id: number;
    jobName: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    processed: number;
    inserted: number;
    updated: number;
  }>;
}

export interface FixtureDetailDto extends FixtureDto {
  referee?: string | null;
  externalPrediction?: {
    homeProbability?: number | null;
    drawProbability?: number | null;
    awayProbability?: number | null;
    advice?: string | null;
    predictedWinner?: string | null;
    capturedAt: string;
  } | null;
  latestOdds: Array<{
    id: number;
    bookmaker: string;
    marketCode: string;
    marketName: string;
    selectionCode: string;
    selectionName: string;
    lineValue?: number | null;
    odds: number;
    capturedAt: string;
  }>;
  recommendations: RecommendationDto[];
}

export interface BacktestRunDto {
  id: number;
  name: string;
  status: string;
  leagueId?: number | null;
  dateFrom: string;
  dateTo: string;
  fixtureLimit: number;
  stakeUnits: number;
  modelVersion: string;
  startedAt: string;
  finishedAt?: string | null;
  totalFixtures: number;
  eligibleFixtures: number;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  hitRate?: number | null;
  profitUnits: number;
  roi?: number | null;
  yieldRate?: number | null;
  averageOdds?: number | null;
  averageExpectedValue?: number | null;
  maximumDrawdown?: number | null;
  brierScore?: number | null;
  league?: LeagueDto | null;
}

export interface BacktestBetDto {
  id: number;
  predictedAt: string;
  kickoffAt: string;
  marketCode: string;
  marketName: string;
  selectionCode: string;
  selectionName: string;
  decimalOdds: number;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  confidenceScore: number;
  settlementResult: string;
  stakeUnits: number;
  profitUnits: number;
  homeGoals: number;
  awayGoals: number;
  bookmaker: { id: number; name: string };
  fixture: FixtureDto;
}

export interface BacktestMarketSummary {
  marketCode: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate?: number | null;
  profitUnits: number;
  roi?: number | null;
  averageOdds?: number | null;
}

export interface BacktestDetailDto extends BacktestRunDto {
  bets: BacktestBetDto[];
  byMarket: BacktestMarketSummary[];
  equityCurve: Array<{ index: number; kickoffAt: string; equity: number }>;
}
