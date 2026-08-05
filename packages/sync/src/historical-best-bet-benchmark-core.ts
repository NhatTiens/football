import {
  assessBestBetCandidate,
  SCIENTIFIC_BEST_BET_POLICY_VERSION,
} from './scientific-best-bet-policy-contract.js';
import {
  decidePaperBet,
  settlePaperBetSelection,
  type PaperBetCandidateInput,
} from './paper-bet-ledger-core.js';
import {
  buildLivePaperBetCandidates,
  type LiveMarketType,
  type LiveModelProbabilities,
  type LiveOddsRow,
  type LiveReliabilityGate,
} from './real-odds-paper-bet-core.js';

export const HISTORICAL_BEST_BET_BENCHMARK_VERSION =
  'v7.0-beta.1B.2-real-odds-historical-best-bet-benchmark-v1';
export const HISTORICAL_BEST_BET_EVIDENCE_CLASS =
  'HISTORICAL_REAL_ODDS_DIAGNOSTIC_NON_PROMOTIONAL' as const;
export const HISTORICAL_BEST_BET_HORIZON_MINUTES = 90 as const;

export interface HistoricalMatchWinnerPrediction {
  HOME: number;
  DRAW: number;
  AWAY: number;
}

export interface HistoricalBenchmarkCandidateAudit {
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerId: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  sourceOddsSnapshotId: number | null;
  sourceOddsUpdatedAt: string | null;
  sourceOddsObservedAt: string | null;
  reliabilityStatus: string;
  reliabilityEligible: boolean;
  eligible: boolean;
  rejectionReasons: string[];
}

export interface HistoricalBenchmarkSelectedBet {
  marketType: 'MATCH_WINNER';
  selection: 'HOME' | 'DRAW' | 'AWAY';
  decimalOdds: number;
  bookmakerId: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  sourceOddsSnapshotId: number | null;
  settlementResult: 'WIN' | 'LOSS';
  stakeUnits: number;
  profitUnits: number;
  closingOdds: number | null;
  clvPriceRatio: number | null;
}

export interface HistoricalBenchmarkEventResult {
  fixtureId: number;
  providerFixtureId: number;
  leagueId: number;
  replayPredictionId: number;
  decisionAsOf: string;
  kickoffAt: string;
  decisionType: 'BEST_BET' | 'NO_BET' | 'NO_ODDS_COVERAGE';
  candidateCount: number;
  candidates: HistoricalBenchmarkCandidateAudit[];
  selectedBet: HistoricalBenchmarkSelectedBet | null;
  integrity: {
    pitSafePrediction: boolean;
    oddsRowsReceived: number;
    lateIngestionRows: number;
    futureOddsViolations: number;
    providerFixtureMismatches: number;
    decisionBeforeKickoff: boolean;
    realOddsOnly: true;
    syntheticOddsUsed: false;
  };
}

function effectiveOddsTime(row: LiveOddsRow): Date {
  return row.sourceUpdatedAt ?? row.observedAt;
}

function matchWinnerOnlyProbabilities(
  prediction: HistoricalMatchWinnerPrediction,
): LiveModelProbabilities {
  // Non-MATCH_WINNER values are deliberately NaN. The benchmark filters odds to
  // MATCH_WINNER before calling beta.1B.1's candidate engine, so these values must
  // never be consumed. If that contract changes, the existing probability guards
  // fail loudly instead of silently introducing synthetic model probabilities.
  return {
    MATCH_WINNER: prediction,
    TOTAL_GOALS_1_5: { OVER: Number.NaN, UNDER: Number.NaN },
    TOTAL_GOALS_2_5: { OVER: Number.NaN, UNDER: Number.NaN },
    TOTAL_GOALS_3_5: { OVER: Number.NaN, UNDER: Number.NaN },
    BTTS: { YES: Number.NaN, NO: Number.NaN },
  };
}

function benchmarkReliabilityGates(input: {
  matchWinnerStatus: string;
  matchWinnerEligible: boolean;
}): Record<LiveMarketType, LiveReliabilityGate> {
  const blocked = (market: LiveMarketType): LiveReliabilityGate => ({
    market,
    status: 'NOT_BENCHMARKED_IN_BETA_1B_2',
    eligible: false,
  });

  return {
    MATCH_WINNER: {
      market: 'MATCH_WINNER',
      status: input.matchWinnerStatus,
      eligible: input.matchWinnerEligible,
    },
    TOTAL_GOALS_1_5: blocked('TOTAL_GOALS_1_5'),
    TOTAL_GOALS_2_5: blocked('TOTAL_GOALS_2_5'),
    TOTAL_GOALS_3_5: blocked('TOTAL_GOALS_3_5'),
    BTTS: blocked('BTTS'),
  };
}

function candidateInputForScientificCandidate(
  candidates: ReturnType<typeof decidePaperBet>['normalizedCandidates'],
  scientificCandidate: ReturnType<typeof decidePaperBet>['normalizedCandidates'][number]['scientificCandidate'],
): PaperBetCandidateInput | null {
  return (
    candidates.find((candidate) => candidate.scientificCandidate === scientificCandidate)?.input ?? null
  );
}

function auditCandidates(
  normalized: ReturnType<typeof decidePaperBet>['normalizedCandidates'],
): HistoricalBenchmarkCandidateAudit[] {
  return normalized.map((item) => {
    const assessment = assessBestBetCandidate(item.scientificCandidate);
    return {
      marketType: item.input.marketType,
      selection: item.input.selection,
      lineValue: item.input.lineValue,
      decimalOdds: item.input.decimalOdds,
      bookmakerId: item.input.bookmakerId,
      bookmakerName: item.input.bookmakerName,
      modelProbability: item.input.modelProbability,
      fairMarketProbability: item.input.fairMarketProbability,
      edge: item.scientificCandidate.edge,
      expectedValue: item.scientificCandidate.expectedValue,
      sourceOddsSnapshotId: item.input.sourceOddsSnapshotId,
      sourceOddsUpdatedAt: item.input.sourceOddsUpdatedAt?.toISOString() ?? null,
      sourceOddsObservedAt: item.input.sourceOddsObservedAt?.toISOString() ?? null,
      reliabilityStatus: item.input.reliabilityStatus,
      reliabilityEligible: item.input.reliabilityEligible,
      eligible: assessment.eligible,
      rejectionReasons: assessment.rejectionReasons,
    };
  });
}

export function evaluateHistoricalMatchWinnerEvent(input: {
  fixtureId: number;
  providerFixtureId: number;
  leagueId: number;
  replayPredictionId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  pitSafePrediction: boolean;
  prediction: HistoricalMatchWinnerPrediction;
  oddsRows: LiveOddsRow[];
  matchWinnerReliabilityStatus: string;
  matchWinnerReliabilityEligible: boolean;
  homeGoals: number;
  awayGoals: number;
  closingOdds?: number | null;
}): HistoricalBenchmarkEventResult {
  if (!Number.isFinite(input.predictionAsOf.getTime()) || !Number.isFinite(input.kickoffAt.getTime())) {
    throw new TypeError('predictionAsOf and kickoffAt must be valid Dates.');
  }
  if (input.predictionAsOf.getTime() >= input.kickoffAt.getTime()) {
    throw new Error('HISTORICAL_BENCHMARK_DECISION_NOT_BEFORE_KICKOFF');
  }
  if (!Number.isInteger(input.homeGoals) || input.homeGoals < 0 || !Number.isInteger(input.awayGoals) || input.awayGoals < 0) {
    throw new RangeError('Historical benchmark requires non-negative integer final scores.');
  }

  const providerFixtureMismatches = input.oddsRows.filter(
    (row) => row.providerFixtureId !== input.providerFixtureId,
  ).length;
  const lateIngestionRows = input.oddsRows.filter(
    (row) => row.observedAt.getTime() > input.predictionAsOf.getTime(),
  ).length;
  // Historical backfills may be ingested after the match. PIT eligibility is based on
  // the provider/source timestamp when present, falling back to observedAt only when
  // the source did not provide an update timestamp.
  const futureOddsViolations = input.oddsRows.filter(
    (row) => effectiveOddsTime(row).getTime() > input.predictionAsOf.getTime(),
  ).length;

  if (providerFixtureMismatches > 0) {
    throw new Error('HISTORICAL_BENCHMARK_PROVIDER_FIXTURE_MISMATCH');
  }
  if (futureOddsViolations > 0) {
    throw new Error('HISTORICAL_BENCHMARK_FUTURE_ODDS_VIOLATION');
  }
  if (!input.pitSafePrediction) {
    throw new Error('HISTORICAL_BENCHMARK_PREDICTION_NOT_PIT_SAFE');
  }

  const matchWinnerOdds = input.oddsRows.filter(
    (row) => row.marketType === 'MATCH_WINNER' && row.lineValue == null,
  );
  const candidateSet = buildLivePaperBetCandidates({
    providerFixtureId: input.providerFixtureId,
    oddsRows: matchWinnerOdds,
    modelProbabilities: matchWinnerOnlyProbabilities(input.prediction),
    reliability: benchmarkReliabilityGates({
      matchWinnerStatus: input.matchWinnerReliabilityStatus,
      matchWinnerEligible: input.matchWinnerReliabilityEligible,
    }),
  });

  const integrity = {
    pitSafePrediction: input.pitSafePrediction,
    oddsRowsReceived: matchWinnerOdds.length,
    lateIngestionRows,
    futureOddsViolations,
    providerFixtureMismatches,
    decisionBeforeKickoff: true,
    realOddsOnly: true as const,
    syntheticOddsUsed: false as const,
  };

  if (candidateSet.candidates.length === 0) {
    return {
      fixtureId: input.fixtureId,
      providerFixtureId: input.providerFixtureId,
      leagueId: input.leagueId,
      replayPredictionId: input.replayPredictionId,
      decisionAsOf: input.predictionAsOf.toISOString(),
      kickoffAt: input.kickoffAt.toISOString(),
      decisionType: 'NO_ODDS_COVERAGE',
      candidateCount: 0,
      candidates: [],
      selectedBet: null,
      integrity,
    };
  }

  const decided = decidePaperBet({
    providerFixtureId: input.providerFixtureId,
    localFixtureId: input.fixtureId,
    horizonMinutes: HISTORICAL_BEST_BET_HORIZON_MINUTES,
    decisionAsOf: input.predictionAsOf,
    kickoffAt: input.kickoffAt,
    modelVersion: HISTORICAL_BEST_BET_BENCHMARK_VERSION,
    policyVersion: SCIENTIFIC_BEST_BET_POLICY_VERSION,
    candidates: candidateSet.candidates,
  });
  const audits = auditCandidates(decided.normalizedCandidates);

  if (decided.decision.decision === 'NO_BET') {
    return {
      fixtureId: input.fixtureId,
      providerFixtureId: input.providerFixtureId,
      leagueId: input.leagueId,
      replayPredictionId: input.replayPredictionId,
      decisionAsOf: input.predictionAsOf.toISOString(),
      kickoffAt: input.kickoffAt.toISOString(),
      decisionType: 'NO_BET',
      candidateCount: audits.length,
      candidates: audits,
      selectedBet: null,
      integrity,
    };
  }

  const selectedInput = candidateInputForScientificCandidate(
    decided.normalizedCandidates,
    decided.decision.selected,
  );
  if (selectedInput == null || selectedInput.marketType !== 'MATCH_WINNER') {
    throw new Error('HISTORICAL_BENCHMARK_SELECTED_CANDIDATE_MAPPING_FAILED');
  }
  if (!['HOME', 'DRAW', 'AWAY'].includes(selectedInput.selection)) {
    throw new Error('HISTORICAL_BENCHMARK_UNEXPECTED_MATCH_WINNER_SELECTION');
  }

  const settlement = settlePaperBetSelection({
    marketType: selectedInput.marketType,
    selection: selectedInput.selection,
    lineValue: null,
    homeGoals: input.homeGoals,
    awayGoals: input.awayGoals,
    decimalOdds: selectedInput.decimalOdds,
    stakeUnits: 1,
  });
  if (settlement.result === 'VOID') {
    throw new Error('HISTORICAL_BENCHMARK_MATCH_WINNER_CANNOT_VOID');
  }
  const closingOdds =
    input.closingOdds != null && Number.isFinite(input.closingOdds) && input.closingOdds > 1
      ? input.closingOdds
      : null;
  const clvPriceRatio = closingOdds == null ? null : selectedInput.decimalOdds / closingOdds - 1;

  return {
    fixtureId: input.fixtureId,
    providerFixtureId: input.providerFixtureId,
    leagueId: input.leagueId,
    replayPredictionId: input.replayPredictionId,
    decisionAsOf: input.predictionAsOf.toISOString(),
    kickoffAt: input.kickoffAt.toISOString(),
    decisionType: 'BEST_BET',
    candidateCount: audits.length,
    candidates: audits,
    selectedBet: {
      marketType: 'MATCH_WINNER',
      selection: selectedInput.selection as 'HOME' | 'DRAW' | 'AWAY',
      decimalOdds: selectedInput.decimalOdds,
      bookmakerId: selectedInput.bookmakerId,
      bookmakerName: selectedInput.bookmakerName,
      modelProbability: selectedInput.modelProbability,
      fairMarketProbability: selectedInput.fairMarketProbability,
      edge: decided.decision.selected.edge,
      expectedValue: decided.decision.selected.expectedValue,
      sourceOddsSnapshotId: selectedInput.sourceOddsSnapshotId,
      settlementResult: settlement.result,
      stakeUnits: settlement.stakeUnits,
      profitUnits: settlement.profitUnits,
      closingOdds,
      clvPriceRatio,
    },
    integrity,
  };
}

export function maximumDrawdown(profits: number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

export function summarizeHistoricalBenchmark(events: HistoricalBenchmarkEventResult[]): {
  replayEvents: number;
  oddsCoveredEvents: number;
  noOddsCoverage: number;
  bestBets: number;
  noBets: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  stakeUnits: number;
  profitUnits: number;
  roi: number | null;
  yieldRate: number | null;
  averageOdds: number | null;
  averageExpectedValue: number | null;
  maximumDrawdownUnits: number;
  clvRows: number;
  averageClvPriceRatio: number | null;
  positiveClvRate: number | null;
  futureOddsViolations: number;
  providerFixtureMismatches: number;
} {
  const bestBets = events.filter(
    (event): event is HistoricalBenchmarkEventResult & { selectedBet: HistoricalBenchmarkSelectedBet } =>
      event.decisionType === 'BEST_BET' && event.selectedBet != null,
  );
  const wins = bestBets.filter((event) => event.selectedBet.settlementResult === 'WIN').length;
  const losses = bestBets.filter((event) => event.selectedBet.settlementResult === 'LOSS').length;
  const stakeUnits = bestBets.reduce((sum, event) => sum + event.selectedBet.stakeUnits, 0);
  const profitUnits = bestBets.reduce((sum, event) => sum + event.selectedBet.profitUnits, 0);
  const clvValues = bestBets
    .map((event) => event.selectedBet.clvPriceRatio)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    replayEvents: events.length,
    oddsCoveredEvents: events.filter((event) => event.decisionType !== 'NO_ODDS_COVERAGE').length,
    noOddsCoverage: events.filter((event) => event.decisionType === 'NO_ODDS_COVERAGE').length,
    bestBets: bestBets.length,
    noBets: events.filter((event) => event.decisionType === 'NO_BET').length,
    wins,
    losses,
    hitRate: bestBets.length === 0 ? null : wins / bestBets.length,
    stakeUnits,
    profitUnits,
    roi: stakeUnits === 0 ? null : profitUnits / stakeUnits,
    yieldRate: stakeUnits === 0 ? null : profitUnits / stakeUnits,
    averageOdds:
      bestBets.length === 0
        ? null
        : bestBets.reduce((sum, event) => sum + event.selectedBet.decimalOdds, 0) / bestBets.length,
    averageExpectedValue:
      bestBets.length === 0
        ? null
        : bestBets.reduce((sum, event) => sum + event.selectedBet.expectedValue, 0) / bestBets.length,
    maximumDrawdownUnits: maximumDrawdown(bestBets.map((event) => event.selectedBet.profitUnits)),
    clvRows: clvValues.length,
    averageClvPriceRatio:
      clvValues.length === 0 ? null : clvValues.reduce((sum, value) => sum + value, 0) / clvValues.length,
    positiveClvRate:
      clvValues.length === 0 ? null : clvValues.filter((value) => value > 0).length / clvValues.length,
    futureOddsViolations: events.reduce(
      (sum, event) => sum + event.integrity.futureOddsViolations,
      0,
    ),
    providerFixtureMismatches: events.reduce(
      (sum, event) => sum + event.integrity.providerFixtureMismatches,
      0,
    ),
  };
}
