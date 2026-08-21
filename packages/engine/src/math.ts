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
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function normalizeProbabilities<T extends string>(
  probabilities: Record<T, number>,
): Record<T, number> {
  const entries = Object.entries(probabilities) as [T, number][];
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0);
  if (total <= 0) throw new Error('Probabilities must have a positive total.');
  return Object.fromEntries(
    entries.map(([key, value]) => [key, Math.max(0, value) / total]),
  ) as Record<T, number>;
}

// ============================================================================
// PREDICTION_AI_V7 helpers — shared numeric/statistical utilities
// ============================================================================

export function mean(values: number[]): number {
  if (values.length === 0) throw new Error('Mean requires at least one value.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function softmax(values: number[]): number[] {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export function sigmoid(value: number): number {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

export function logit(probability: number): number {
  const bounded = clamp(probability, 1e-9, 1 - 1e-9);
  return Math.log(bounded / (1 - bounded));
}

export function inverseLogit(value: number): number {
  return sigmoid(value);
}

export function weightedMean(values: number[], weights: number[]): number {
  if (values.length === 0) throw new Error('Weighted mean requires at least one value.');
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (totalWeight <= 0) return mean(values);
  return (
    values.reduce((sum, value, index) => sum + value * Math.max(0, weights[index] ?? 0), 0) /
    totalWeight
  );
}

/**
 * Exponential recency decay weight for a sample that is `ageDays` old.
 * After one half-life the sample contributes half of its original weight.
 */
export function expDecayWeight(ageDays: number, halfLifeDays = 60): number {
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;
  if (halfLifeDays <= 0) return 1;
  return Math.exp((-ageDays * Math.LN2) / halfLifeDays);
}

/**
 * Effective sample size of a weight vector (Kish's formula).
 * Used to know how much information a recency-weighted average really holds.
 */
export function effectiveSampleSize(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return 0;
  const squared = weights.reduce((sum, weight) => sum + Math.max(0, weight) ** 2, 0);
  return squared > 0 ? total ** 2 / squared : 0;
}
