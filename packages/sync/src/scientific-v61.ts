export const SCIENTIFIC_V61_VERSION = 'scientific-v6.1-evaluation-control';

const EPSILON = 1e-12;

export type ScientificRejectionReason =
  | 'NO_ODDS_AT_HORIZON'
  | 'LINEUP_BLOCKED'
  | 'QUARTER_LINE_DISABLED'
  | 'STALE_COMPLETE_MARKET'
  | 'INSUFFICIENT_COMPLETE_BOOKMAKERS'
  | 'INSUFFICIENT_REFERENCE_BOOKMAKERS'
  | 'MISSING_PROBABILITY_OR_QUOTE'
  | 'ODDS_OUT_OF_RANGE'
  | 'EXPECTED_VALUE_LOW'
  | 'EDGE_LOW'
  | 'CONFIDENCE_LOW'
  | 'DATA_QUALITY_LOW'
  | 'PROBABILITY_DISPERSION_HIGH'
  | 'ODDS_TOO_OLD'
  | 'MARKET_LIMIT'
  | 'CORRELATION_CLUSTER_LIMIT'
  | 'FIXTURE_LIMIT'
  | 'STAKE_BELOW_MINIMUM'
  | 'NO_POSITIVE_RISK_ADJUSTED_EDGE'
  | 'DRAWDOWN_HARD_STOP'
  | 'BANKROLL_HARD_STOP'
  | 'BANKROLL_DEPLETED'
  | 'FIXTURE_EXPOSURE_LIMIT'
  | 'DAILY_EXPOSURE_LIMIT';

export interface ScientificRejectionSnapshot {
  totalRejected: number;
  counts: Record<string, number>;
}

export class ScientificRejectionDiagnostics {
  private readonly counts = new Map<string, number>();

  reject(reason: ScientificRejectionReason | string, amount = 1): void {
    const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    if (safeAmount === 0) return;
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + safeAmount);
  }

  merge(snapshot: ScientificRejectionSnapshot | undefined): void {
    if (!snapshot) return;
    for (const [reason, amount] of Object.entries(snapshot.counts)) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      this.counts.set(reason, (this.counts.get(reason) ?? 0) + amount);
    }
  }

  snapshot(): ScientificRejectionSnapshot {
    const counts = Object.fromEntries(
      [...this.counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
    return {
      totalRejected: Object.values(counts).reduce((sum, value) => sum + value, 0),
      counts,
    };
  }
}

export interface CorrelationCandidateLike {
  marketKey: string;
  marketCode: string;
  selectionCode: string;
  correlationCluster: string;
  recommendationScore: number;
}

export interface ScientificCorrelationRules {
  maximumPerFixture: number;
  maximumPerMarket: number;
  maximumPerCorrelationCluster?: number;
}

/**
 * Applies deterministic portfolio control after probability/EV filters.
 * It avoids counting several highly dependent selections as independent bets.
 */
export function selectCorrelationControlledCandidates<
  Candidate extends CorrelationCandidateLike,
>(
  candidates: Candidate[],
  rules: ScientificCorrelationRules,
  diagnostics?: ScientificRejectionDiagnostics,
): Candidate[] {
  const maximumPerFixture = Math.max(1, Math.floor(rules.maximumPerFixture));
  const maximumPerMarket = Math.max(1, Math.floor(rules.maximumPerMarket));
  const maximumPerCorrelationCluster = Math.max(
    1,
    Math.floor(rules.maximumPerCorrelationCluster ?? 1),
  );
  const sorted = [...candidates].sort((left, right) => {
    const scoreDifference = right.recommendationScore - left.recommendationScore;
    if (Math.abs(scoreDifference) > EPSILON) return scoreDifference;
    const marketDifference = left.marketKey.localeCompare(right.marketKey);
    if (marketDifference !== 0) return marketDifference;
    return left.selectionCode.localeCompare(right.selectionCode);
  });

  const selected: Candidate[] = [];
  const marketCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();

  for (const candidate of sorted) {
    const marketCount = marketCounts.get(candidate.marketKey) ?? 0;
    if (marketCount >= maximumPerMarket) {
      diagnostics?.reject('MARKET_LIMIT');
      continue;
    }

    const clusterCount = clusterCounts.get(candidate.correlationCluster) ?? 0;
    if (clusterCount >= maximumPerCorrelationCluster) {
      diagnostics?.reject('CORRELATION_CLUSTER_LIMIT');
      continue;
    }

    if (selected.length >= maximumPerFixture) {
      diagnostics?.reject('FIXTURE_LIMIT');
      continue;
    }

    selected.push(candidate);
    marketCounts.set(candidate.marketKey, marketCount + 1);
    clusterCounts.set(candidate.correlationCluster, clusterCount + 1);
  }

  return selected;
}

export interface ScientificPredictionMetricInput {
  marketCode: string;
  probability?: number;
  actual?: 0 | 1;
  probabilities?: Record<string, number>;
  actualClass?: string;
}

export interface ScientificBetMetricInput {
  marketCode: string;
  result: 'WIN' | 'LOSS' | 'PUSH' | 'VOID';
  profitUnits: number;
  stakeUnits: number;
  decimalOdds: number;
  expectedValue: number;
}

interface MutableMarketMetrics {
  marketCode: string;
  predictionCount: number;
  brierTotal: number;
  logLossTotal: number;
  betCount: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  profitUnits: number;
  stakeUnits: number;
  oddsTotal: number;
  expectedValueTotal: number;
}

export interface ScientificMarketMetrics {
  marketCode: string;
  predictionCount: number;
  brierScore: number | null;
  logLoss: number | null;
  betCount: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  hitRate: number | null;
  profitUnits: number;
  roi: number | null;
  averageOdds: number | null;
  averageExpectedValue: number | null;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1 - EPSILON, Math.max(EPSILON, value));
}

function emptyMetrics(marketCode: string): MutableMarketMetrics {
  return {
    marketCode,
    predictionCount: 0,
    brierTotal: 0,
    logLossTotal: 0,
    betCount: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: 0,
    profitUnits: 0,
    stakeUnits: 0,
    oddsTotal: 0,
    expectedValueTotal: 0,
  };
}

/** Collects proper scoring rules before bet filtering and betting metrics after filtering. */
export class ScientificEvaluationCollector {
  private readonly markets = new Map<string, MutableMarketMetrics>();

  private get(marketCode: string): MutableMarketMetrics {
    const existing = this.markets.get(marketCode);
    if (existing) return existing;
    const created = emptyMetrics(marketCode);
    this.markets.set(marketCode, created);
    return created;
  }

  recordPrediction(input: ScientificPredictionMetricInput): void {
    const metrics = this.get(input.marketCode);

    if (input.probabilities && input.actualClass) {
      const entries = Object.entries(input.probabilities);
      if (entries.length === 0) return;
      const normalizedTotal = entries.reduce(
        (sum, [, probability]) => sum + Math.max(0, probability),
        0,
      );
      if (normalizedTotal <= EPSILON) return;
      let brier = 0;
      let actualProbability = EPSILON;
      for (const [selectionCode, rawProbability] of entries) {
        const probability = clampProbability(
          Math.max(0, rawProbability) / normalizedTotal,
        );
        const outcome = selectionCode === input.actualClass ? 1 : 0;
        brier += (probability - outcome) ** 2;
        if (outcome === 1) actualProbability = probability;
      }
      // Mean squared error per class keeps scores comparable across markets.
      metrics.brierTotal += brier / entries.length;
      metrics.logLossTotal += -Math.log(actualProbability);
      metrics.predictionCount += 1;
      return;
    }

    if (input.probability === undefined || input.actual === undefined) return;
    const probability = clampProbability(input.probability);
    const actual = input.actual;
    metrics.brierTotal += (probability - actual) ** 2;
    metrics.logLossTotal +=
      -(actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability));
    metrics.predictionCount += 1;
  }

  recordBet(input: ScientificBetMetricInput): void {
    const metrics = this.get(input.marketCode);
    metrics.betCount += 1;
    metrics.profitUnits += input.profitUnits;
    metrics.stakeUnits += input.stakeUnits;
    metrics.oddsTotal += input.decimalOdds;
    metrics.expectedValueTotal += input.expectedValue;
    if (input.result === 'WIN') metrics.wins += 1;
    else if (input.result === 'LOSS') metrics.losses += 1;
    else if (input.result === 'PUSH') metrics.pushes += 1;
    else metrics.voids += 1;
  }

  snapshot(): ScientificMarketMetrics[] {
    return [...this.markets.values()]
      .sort((left, right) => left.marketCode.localeCompare(right.marketCode))
      .map((metrics) => {
        const settled = metrics.wins + metrics.losses;
        return {
          marketCode: metrics.marketCode,
          predictionCount: metrics.predictionCount,
          brierScore:
            metrics.predictionCount > 0
              ? metrics.brierTotal / metrics.predictionCount
              : null,
          logLoss:
            metrics.predictionCount > 0
              ? metrics.logLossTotal / metrics.predictionCount
              : null,
          betCount: metrics.betCount,
          wins: metrics.wins,
          losses: metrics.losses,
          pushes: metrics.pushes,
          voids: metrics.voids,
          hitRate: settled > 0 ? metrics.wins / settled : null,
          profitUnits: metrics.profitUnits,
          roi: metrics.stakeUnits > 0 ? metrics.profitUnits / metrics.stakeUnits : null,
          averageOdds:
            metrics.betCount > 0 ? metrics.oddsTotal / metrics.betCount : null,
          averageExpectedValue:
            metrics.betCount > 0
              ? metrics.expectedValueTotal / metrics.betCount
              : null,
        };
      });
  }

  overallBrierScore(): number | null {
    let total = 0;
    let count = 0;
    for (const metrics of this.markets.values()) {
      total += metrics.brierTotal;
      count += metrics.predictionCount;
    }
    return count > 0 ? total / count : null;
  }
}

export function stableScientificArtifactId(input: {
  version: string;
  trainedThrough: string;
  sampleSize: number;
  randomSeed?: number;
}): string {
  const source = [
    input.version,
    input.trainedThrough,
    input.sampleSize,
    input.randomSeed ?? 0,
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const timestamp = input.trainedThrough.replace(/[^0-9]/g, '').slice(0, 14);
  return `${input.version}-${timestamp}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
