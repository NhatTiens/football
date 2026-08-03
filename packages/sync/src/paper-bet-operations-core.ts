export const PAPER_BET_OPERATIONS_VERSION = 'v7.0-r4.10.2.11.2-paper-bet-operations-v1';

export const PAPER_BET_OPERATIONS_DEFAULT_TICK_SECONDS = 30 as const;
export const PAPER_BET_OPERATIONS_MINIMUM_TICK_SECONDS = 15 as const;
export const PAPER_BET_OPERATIONS_MAXIMUM_TICK_SECONDS = 300 as const;
export const PAPER_BET_RELIABILITY_TARGET_ROWS = 150 as const;
export const PAPER_BET_DECISION_HORIZONS = [90, 30, 5] as const;

export type PaperBetDecisionHorizon = (typeof PAPER_BET_DECISION_HORIZONS)[number];

export type PaperBetMappingStatus = 'MAPPED' | 'UNMAPPED' | 'MAPPING_MISMATCH';

export type PaperBetReadinessBlocker =
  | 'UNSUPPORTED_PAPER_HORIZON'
  | 'UNMAPPED_PROVIDER_FIXTURE'
  | 'PROVIDER_CORE_FIXTURE_MAPPING_MISMATCH'
  | 'NO_FRESH_PIT_ODDS'
  | 'NO_COMPLETE_REAL_ODDS_MARKET'
  | 'NO_DYNAMIC_DIXON_COLES_MODEL'
  | 'MODEL_TRAINED_AFTER_READINESS_AS_OF'
  | 'BEST_BET_HORIZON_NOT_VALIDATED'
  | 'FROZEN_T90_REGISTRY_UNAVAILABLE'
  | 'MATCH_WINNER_RELIABILITY_NOT_ELIGIBLE';

export type PaperBetReadinessStatus =
  'BEST_BET_ROUTE_READY' | 'PAPER_DECISION_READY_NO_BEST_BET_ROUTE' | 'BLOCKED';

export interface PaperBetFixtureReadinessInput {
  providerFixtureId: number;
  horizonMinutes: number;
  mappingStatus: PaperBetMappingStatus;
  freshPitOddsRows: number;
  completeMarketCount: number;
  dynamicModelAvailable: boolean;
  modelPitSafe: boolean;
  frozenT90RegistryAvailable: boolean;
  matchWinnerReliabilityEligible: boolean;
}

export interface PaperBetFixtureReadiness {
  providerFixtureId: number;
  horizonMinutes: number;
  status: PaperBetReadinessStatus;
  paperDecisionReady: boolean;
  bestBetRouteReady: boolean;
  decisionBlockers: PaperBetReadinessBlocker[];
  bestBetBlockers: PaperBetReadinessBlocker[];
  paperOnly: true;
  automaticPromotion: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

function supportedHorizon(value: number): value is PaperBetDecisionHorizon {
  return PAPER_BET_DECISION_HORIZONS.includes(value as PaperBetDecisionHorizon);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function selectedMarketFromAnalysisPayload(value: unknown): string | null {
  const payload = unknownRecord(value);
  const analysis = unknownRecord(payload?.analysis) ?? payload;
  const currentDecision = unknownRecord(analysis?.shadowCandidateDecision);
  const classification = unknownRecord(analysis?.shadowCandidate);
  const selected =
    unknownRecord(currentDecision?.selected) ??
    unknownRecord(classification?.selected) ??
    unknownRecord(analysis?.recommendation);

  for (const market of [selected?.marketType, selected?.marketCode]) {
    if (typeof market === 'string' && market.trim().length > 0) {
      return market.trim();
    }
  }

  return null;
}

export function evaluatePaperBetFixtureReadiness(
  input: PaperBetFixtureReadinessInput,
): PaperBetFixtureReadiness {
  const decisionBlockers: PaperBetReadinessBlocker[] = [];

  if (!supportedHorizon(input.horizonMinutes)) {
    decisionBlockers.push('UNSUPPORTED_PAPER_HORIZON');
  }

  if (input.mappingStatus === 'UNMAPPED') {
    decisionBlockers.push('UNMAPPED_PROVIDER_FIXTURE');
  } else if (input.mappingStatus === 'MAPPING_MISMATCH') {
    decisionBlockers.push('PROVIDER_CORE_FIXTURE_MAPPING_MISMATCH');
  }

  if (input.freshPitOddsRows <= 0) {
    decisionBlockers.push('NO_FRESH_PIT_ODDS');
  }

  if (input.completeMarketCount <= 0) {
    decisionBlockers.push('NO_COMPLETE_REAL_ODDS_MARKET');
  }

  if (!input.dynamicModelAvailable) {
    decisionBlockers.push('NO_DYNAMIC_DIXON_COLES_MODEL');
  }

  if (input.dynamicModelAvailable && !input.modelPitSafe) {
    decisionBlockers.push('MODEL_TRAINED_AFTER_READINESS_AS_OF');
  }

  const paperDecisionReady = decisionBlockers.length === 0;
  const bestBetBlockers = [...decisionBlockers];

  if (supportedHorizon(input.horizonMinutes) && input.horizonMinutes !== 90) {
    bestBetBlockers.push('BEST_BET_HORIZON_NOT_VALIDATED');
  }

  if (input.horizonMinutes === 90 && !input.frozenT90RegistryAvailable) {
    bestBetBlockers.push('FROZEN_T90_REGISTRY_UNAVAILABLE');
  }

  if (input.horizonMinutes === 90 && !input.matchWinnerReliabilityEligible) {
    bestBetBlockers.push('MATCH_WINNER_RELIABILITY_NOT_ELIGIBLE');
  }

  const normalizedDecisionBlockers = unique(decisionBlockers);
  const normalizedBestBetBlockers = unique(bestBetBlockers);
  const bestBetRouteReady = normalizedBestBetBlockers.length === 0;

  return {
    providerFixtureId: input.providerFixtureId,
    horizonMinutes: input.horizonMinutes,
    status: bestBetRouteReady
      ? 'BEST_BET_ROUTE_READY'
      : paperDecisionReady
        ? 'PAPER_DECISION_READY_NO_BEST_BET_ROUTE'
        : 'BLOCKED',
    paperDecisionReady,
    bestBetRouteReady,
    decisionBlockers: normalizedDecisionBlockers,
    bestBetBlockers: normalizedBestBetBlockers,
    paperOnly: true,
    automaticPromotion: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}

export function nextPaperBetDecisionHorizon(
  exactMinutesToKickoff: number,
): PaperBetDecisionHorizon | null {
  if (!Number.isFinite(exactMinutesToKickoff) || exactMinutesToKickoff <= 0) {
    return null;
  }

  for (const horizon of PAPER_BET_DECISION_HORIZONS) {
    if (exactMinutesToKickoff >= horizon) return horizon;
  }

  return null;
}

export function parsePaperBetOperationsTickSeconds(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') {
    return PAPER_BET_OPERATIONS_DEFAULT_TICK_SECONDS;
  }

  const value = Number(raw);

  if (
    !Number.isInteger(value) ||
    value < PAPER_BET_OPERATIONS_MINIMUM_TICK_SECONDS ||
    value > PAPER_BET_OPERATIONS_MAXIMUM_TICK_SECONDS
  ) {
    throw new Error(
      `PAPER_BET_OPERATIONS_TICK_SECONDS must be an integer from ${PAPER_BET_OPERATIONS_MINIMUM_TICK_SECONDS} to ${PAPER_BET_OPERATIONS_MAXIMUM_TICK_SECONDS}.`,
    );
  }

  return value;
}

export type ReliabilityAccumulationStatus =
  'NO_SETTLED_SAMPLE' | 'ACCUMULATING' | 'TARGET_REACHED_METRICS_BLOCKED' | 'RELIABILITY_ELIGIBLE';

export interface ReliabilityAccumulationInput {
  key: string;
  marketType: string;
  horizonMinutes: number;
  persistedRows: number;
  settledRows: number;
  invalidRows: number;
  diagnosticEligible: boolean;
  targetRows?: number;
  blockingReasons?: string[];
}

export interface ReliabilityAccumulationProgress {
  key: string;
  marketType: string;
  horizonMinutes: number;
  persistedRows: number;
  settledRows: number;
  invalidRows: number;
  targetRows: number;
  remainingRows: number;
  progressRate: number;
  status: ReliabilityAccumulationStatus;
  diagnosticEligible: boolean;
  blockingReasons: string[];
  automaticPromotion: false;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function buildReliabilityAccumulationProgress(
  input: ReliabilityAccumulationInput,
): ReliabilityAccumulationProgress {
  const targetRows = Math.max(
    1,
    nonNegativeInteger(input.targetRows ?? PAPER_BET_RELIABILITY_TARGET_ROWS),
  );
  const persistedRows = nonNegativeInteger(input.persistedRows);
  const settledRows = Math.min(persistedRows, nonNegativeInteger(input.settledRows));
  const invalidRows = Math.min(persistedRows, nonNegativeInteger(input.invalidRows));
  const remainingRows = Math.max(0, targetRows - settledRows);
  const progressRate = Math.min(1, settledRows / targetRows);
  const status: ReliabilityAccumulationStatus =
    settledRows === 0
      ? 'NO_SETTLED_SAMPLE'
      : settledRows < targetRows
        ? 'ACCUMULATING'
        : input.diagnosticEligible
          ? 'RELIABILITY_ELIGIBLE'
          : 'TARGET_REACHED_METRICS_BLOCKED';

  return {
    key: input.key,
    marketType: input.marketType,
    horizonMinutes: input.horizonMinutes,
    persistedRows,
    settledRows,
    invalidRows,
    targetRows,
    remainingRows,
    progressRate,
    status,
    diagnosticEligible: input.diagnosticEligible,
    blockingReasons: unique(input.blockingReasons ?? []),
    automaticPromotion: false,
  };
}
