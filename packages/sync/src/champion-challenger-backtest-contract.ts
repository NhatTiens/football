import type { DecisionCandidate, MultiHorizonDecision } from './multi-horizon-decision-contract.js';

export const CHAMPION_CHALLENGER_BACKTEST_VERSION =
  'v8.0-stage7-walk-forward-champion-challenger-v1';

export type BenchmarkModel = 'V7_5_DIXON_CHAMPION' | 'V8_BAYESIAN' | 'V8_HYBRID';
export type BetSettlement = 'WIN' | 'LOSS' | 'VOID';

export interface SettledBenchmarkBet {
  model: BenchmarkModel;
  decisionId: string;
  fixtureId: number;
  leagueId: number;
  horizon: number;
  kickoffAt: string;
  marketKey: string;
  selection: string;
  decimalOdds: number;
  closingOdds: number | null;
  clv: number | null;
  result: BetSettlement;
  profitUnits: number;
}

export interface BettingPerformance {
  decisions: number;
  bestBets: number;
  noBets: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  totalStakeUnits: number;
  turnover: number;
  profitUnits: number;
  roi: number | null;
  maximumDrawdownUnits: number;
  betFrequency: number;
  clvRows: number;
  meanClv: number | null;
}

export function settleBenchmarkCandidate(
  candidate: DecisionCandidate,
  outcome: string,
): BetSettlement {
  if (candidate.marketKey === 'HDA' || candidate.marketKey === 'BTTS') {
    return candidate.selection === outcome ? 'WIN' : 'LOSS';
  }
  if (candidate.marketKey.startsWith('TOTAL_GOALS:')) {
    if (outcome === 'PUSH') return 'VOID';
    if (candidate.selection === 'OVER') return outcome === 'ABOVE' ? 'WIN' : 'LOSS';
    if (candidate.selection === 'UNDER') return outcome === 'BELOW' ? 'WIN' : 'LOSS';
  }
  throw new Error(`Cannot settle ${candidate.marketKey}/${candidate.selection} against ${outcome}.`);
}

export function profitForSettlement(result: BetSettlement, decimalOdds: number): number {
  if (result === 'WIN') return decimalOdds - 1;
  if (result === 'LOSS') return -1;
  return 0;
}

export function maximumDrawdown(profits: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let maximum = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return maximum;
}

export function summarizeBettingPerformance(input: {
  decisions: readonly MultiHorizonDecision[];
  bets: readonly SettledBenchmarkBet[];
}): BettingPerformance {
  const ordered = [...input.bets].sort(
    (left, right) =>
      new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() ||
      left.fixtureId - right.fixtureId ||
      right.horizon - left.horizon,
  );
  const wins = ordered.filter((row) => row.result === 'WIN').length;
  const losses = ordered.filter((row) => row.result === 'LOSS').length;
  const voids = ordered.filter((row) => row.result === 'VOID').length;
  const totalStakeUnits = wins + losses;
  const profitUnits = ordered.reduce((sum, row) => sum + row.profitUnits, 0);
  const clv = ordered.map((row) => row.clv).filter((value): value is number => value != null);
  return {
    decisions: input.decisions.length,
    bestBets: ordered.length,
    noBets: input.decisions.length - ordered.length,
    wins,
    losses,
    voids,
    hitRate: totalStakeUnits ? wins / totalStakeUnits : null,
    totalStakeUnits,
    turnover: ordered.length,
    profitUnits,
    roi: totalStakeUnits ? profitUnits / totalStakeUnits : null,
    maximumDrawdownUnits: maximumDrawdown(ordered.map((row) => row.profitUnits)),
    betFrequency: input.decisions.length ? ordered.length / input.decisions.length : 0,
    clvRows: clv.length,
    meanClv: clv.length ? clv.reduce((sum, value) => sum + value, 0) / clv.length : null,
  };
}

