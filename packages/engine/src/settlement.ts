export type SettlementResultCode = 'WIN' | 'LOSS' | 'PUSH' | 'VOID';

export interface SettleSelectionInput {
  marketCode: string;
  selectionCode: string;
  lineValue: number | null;
  homeGoals: number;
  awayGoals: number;
}

export function settleSelection(input: SettleSelectionInput): SettlementResultCode {
  const totalGoals = input.homeGoals + input.awayGoals;

  if (input.marketCode === 'MATCH_WINNER') {
    const actual =
      input.homeGoals > input.awayGoals
        ? 'HOME'
        : input.homeGoals < input.awayGoals
          ? 'AWAY'
          : 'DRAW';
    return actual === input.selectionCode ? 'WIN' : 'LOSS';
  }

  if (input.marketCode === 'TOTAL_GOALS_2_5') {
    const line = input.lineValue ?? 2.5;
    if (totalGoals === line) return 'PUSH';
    const actual = totalGoals > line ? 'OVER' : 'UNDER';
    return actual === input.selectionCode ? 'WIN' : 'LOSS';
  }

  if (input.marketCode === 'BTTS') {
    const actual = input.homeGoals > 0 && input.awayGoals > 0 ? 'YES' : 'NO';
    return actual === input.selectionCode ? 'WIN' : 'LOSS';
  }

  return 'VOID';
}

export function profitForSettlement(
  result: SettlementResultCode,
  decimalOdds: number,
  stakeUnits = 1,
): number {
  if (result === 'WIN') return (decimalOdds - 1) * stakeUnits;
  if (result === 'LOSS') return -stakeUnits;
  return 0;
}
