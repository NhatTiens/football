export interface ScientificFreshOddsHorizonDto {
  horizonMinutes: number;
  label: string;
  total: number;
  success: number;
  empty: number;
  retry: number;
  failed: number;
  skipped: number;
  pending: number;
  normalizedOdds: number;
  insertedOdds: number;
  pitUsableOdds: number;
}

export interface ScientificDecisionDto {
  id: number;
  providerFixtureId: number;
  localFixtureId?: number | null;
  horizonMinutes: number;
  decisionAsOf: string;
  kickoffAt: string;
  decisionType: string;
  selectedMarket?: string | null;
  selectedSelection?: string | null;
  lineValue?: number | null;
  decimalOdds?: number | null;
  bookmakerName?: string | null;
  modelProbability?: number | null;
  fairMarketProbability?: number | null;
  edge?: number | null;
  expectedValue?: number | null;
  modelVersion: string;
  policyVersion: string;
  decisionHash: string;
  createdAt: string;
  fixture?: {
    id: number;
    leagueId: number;
    league?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    kickoffAt?: string | null;
  } | null;
}

export interface ScientificDashboardDto {
  version: string;
  generatedAt: string;
  evidenceClass: string;
  freshOdds: {
    totalCheckpoints: number;
    completedCheckpoints: number;
    pendingCheckpoints: number;
    byStatus: Record<string, number>;
    byHorizon: ScientificFreshOddsHorizonDto[];
    latestCheckpoint: {
      id: number;
      providerFixtureId: number;
      providerLeagueId: number;
      kickoffAt: string;
      horizonMinutes: number;
      horizonLabel: string;
      dueAt: string;
      status: string;
      attempts: number;
      completedAt?: string | null;
      requestCount: number;
      normalizedOdds: number;
      insertedOdds: number;
      pitUsableOdds: number;
      errorMessage?: string | null;
      updatedAt: string;
    } | null;
  };
  paper: {
    totalDecisions: number;
    bestBets: number;
    noBets: number;
    settlements: number;
    recentDecisions: ScientificDecisionDto[];
  };
  risk: {
    policy: {
      id: number;
      accountKey: string;
      policyVersion: string;
      stakingMode: string;
      startingBankrollUnits: number;
      flatStakeUnits: number;
      maximumStakeFraction: number;
      maximumOpenExposureFraction: number;
      maximumDailyExposureFraction: number;
      maximumLeagueExposureFraction: number;
      maximumDailyLossFraction: number;
      drawdownSoftLimit: number;
      drawdownHardLimit: number;
      createdAt: string;
      payloadHash: string;
    } | null;
    stakeDecisions: Record<string, number>;
    settlements: Record<string, number>;
    metrics: {
      startingBankrollUnits: number;
      currentBankrollUnits: number;
      peakBankrollUnits: number;
      profitUnits: number;
      bankrollReturn: number | null;
      totalStakeDecisions: number;
      totalStakedUnits: number;
      settledStakeUnits: number;
      yieldRate: number | null;
      openExposureUnits: number;
      dailyExposureUnits: number;
      dailyRealizedPnlUnits: number;
      currentDrawdownFraction: number;
      maximumDrawdownFraction: number;
    } | null;
  };
  legacyBacktest: {
    id: number;
    name: string;
    status: string;
    dateFrom: string | null;
    dateTo: string | null;
    modelVersion: string;
    totalFixtures: number;
    totalBets: number;
    wins: number;
    losses: number;
    hitRate?: number | null;
    profitUnits: number;
    roi?: number | null;
    maximumDrawdown?: number | null;
    brierScore?: number | null;
    league?: string | null;
  } | null;
  readiness: {
    freshOddsOperational: boolean;
    freshOddsSuccessEvidence: boolean;
    riskPolicyFrozen: boolean;
    freshStakeEvidence: boolean;
    freshSettlementEvidence: boolean;
  };
  integrity: {
    readOnlyDashboard: boolean;
    paperOnly: boolean;
    syntheticOddsUsedByDashboard: boolean;
    externalApiCalledByDashboard: boolean;
    automaticBetPlacement: boolean;
    realMoneyExecution: boolean;
    automaticPromotion: boolean;
    sourceBestBetPolicyChanged: boolean;
    productionRoutingChanged: boolean;
  };
}
