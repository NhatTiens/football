export interface PricedSelection {
  code: string;
  odds: number;
}

export interface FairSelection extends PricedSelection {
  impliedProbability: number;
  fairProbability: number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function impliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new Error('Decimal odds must be a finite number greater than 1.');
  }
  return 1 / decimalOdds;
}

export function expectedValue(probability: number, decimalOdds: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error('Probability must be between 0 and 1.');
  }
  return probability * decimalOdds - 1;
}

export function edge(modelProbability: number, fairMarketProbability: number): number {
  return modelProbability - fairMarketProbability;
}

export function removeVig(selections: PricedSelection[]): FairSelection[] {
  if (selections.length < 2) {
    throw new Error('At least two selections are required to remove bookmaker margin.');
  }

  const withImplied = selections.map((selection) => ({
    ...selection,
    impliedProbability: impliedProbability(selection.odds),
  }));
  const overround = withImplied.reduce((sum, selection) => sum + selection.impliedProbability, 0);

  if (overround <= 0) {
    throw new Error('Invalid overround.');
  }

  return withImplied.map((selection) => ({
    ...selection,
    fairProbability: selection.impliedProbability / overround,
  }));
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('Median requires at least one value.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function normalizeProbabilities<T extends string>(
  probabilities: Record<T, number>,
): Record<T, number> {
  const entries = Object.entries(probabilities) as [T, number][];
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0);
  if (total <= 0) throw new Error('Probabilities must have a positive total.');
  return Object.fromEntries(entries.map(([key, value]) => [key, Math.max(0, value) / total])) as Record<
    T,
    number
  >;
}
