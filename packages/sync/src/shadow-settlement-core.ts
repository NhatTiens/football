export const SHADOW_SETTLEMENT_VERSION = 'v7.0-r4.10.2.11-shadow-settlement-outcome-clv-v1';

export const SHADOW_FLAT_STAKE_UNITS = 1 as const;
export const SHADOW_CLOSING_PROXY_TARGET_MINUTES = 5 as const;
export const SHADOW_CLOSING_PROXY_TOLERANCE_MINUTES = 8 as const;
export const SHADOW_CLOSING_MAX_SOURCE_AGE_MINUTES = 360 as const;
export const SHADOW_RELIABILITY_MINIMUM_SAMPLE = 30 as const;

export type ShadowSettlementResult = 'WIN' | 'LOSS' | 'VOID';

export type ShadowOutcomeLinkStatus =
  'FINAL_SCORE_LINKED' | 'VOID_STATUS_LINKED' | 'PENDING_FINAL_OUTCOME' | 'FINAL_SCORE_MISSING';

export type ShadowClosingLinkStatus =
  | 'CLOSING_PROXY_FRESH'
  | 'CLOSING_PROXY_STALE_SOURCE'
  | 'CLOSING_PROXY_SOURCE_AGE_UNKNOWN'
  | 'NO_MATCHING_CLOSING_PROXY';

export type ShadowSettlementStatus = 'SETTLED' | 'PENDING_OUTCOME' | 'INVALID_DECISION_LINEAGE';

export interface ShadowSettlementCandidate {
  snapshotId: number;
  snapshotHash: string;
  providerFixtureId: number;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: Date;
  kickoffAt: Date;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string | null;
  sourceOddsSnapshotId: number | null;
  sourceOddsObservedAt?: Date | null;
  modelSource?: string | null;
  modelVersion?: string | null;
  paperRecommendationVersion?: string | null;
  rawModelProbability?: number | null;
  paperModelProbability?: number | null;
  shadowTier: string | null;
  decisionSource: 'paperShadowRecommendation' | 'shadowCandidate' | 'shadowCandidateDecision';
}

export interface ShadowOutcomeSnapshot {
  id: number;
  providerFixtureId: number;
  statusShort: string;
  observedAt: Date;
  fulltimeHomeGoals: number | null;
  fulltimeAwayGoals: number | null;
}

export interface ShadowClosingOddsSnapshot {
  id: number;
  providerFixtureId: number;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  pitUsable: boolean;
}

export interface ShadowOutcomeLink {
  status: ShadowOutcomeLinkStatus;
  sourceFixtureSnapshotId: number | null;
  sourceFixtureObservedAt: string | null;
  statusShort: string | null;
  fulltimeHomeGoals: number | null;
  fulltimeAwayGoals: number | null;
}

export interface ShadowClosingLink {
  status: ShadowClosingLinkStatus;
  sourceOddsSnapshotId: number | null;
  sourceObservedAt: string | null;
  sourceUpdatedAt: string | null;
  bookmakerName: string | null;
  decimalOdds: number | null;
  minutesToKickoff: number | null;
  sourceAgeAtObservationMinutes: number | null;
  sourceAgeAtKickoffMinutes: number | null;
  targetMinutes: number;
  toleranceMinutes: number;
  maximumFreshSourceAgeMinutes: number;
  clvEligible: boolean;
}

export interface ShadowSettlementRow {
  version: string;
  status: ShadowSettlementStatus;
  providerFixtureId: number;
  snapshotId: number;
  snapshotHash: string;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: string;
  kickoffAt: string;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decisionOdds: number;
  bookmakerName: string | null;
  shadowTier: string | null;
  modelSource: string | null;
  modelVersion: string | null;
  paperRecommendationVersion: string | null;
  rawModelProbability: number | null;
  paperModelProbability: number | null;
  decisionSource: ShadowSettlementCandidate['decisionSource'];
  outcome: ShadowOutcomeLink;
  settlementResult: ShadowSettlementResult | null;
  flatStakeUnits: 1;
  hypotheticalProfitUnits: number | null;
  closing: ShadowClosingLink;
  clv: number | null;
  impliedProbabilityClv: number | null;
  lineageViolations: string[];
  paperOnly: true;
  stakeEligible: false;
  officialBestBetChanged: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

export type ShadowReliabilityStatus =
  'NO_SETTLED_SAMPLE' | 'ACCUMULATING_RESEARCH_SAMPLE' | 'RESEARCH_SAMPLE_AVAILABLE';

export interface ShadowReliabilityMetrics {
  rows: number;
  settled: number;
  pending: number;
  invalidLineage: number;
  wins: number;
  losses: number;
  voids: number;
  flatStakeUnits: number;
  hypotheticalProfitUnits: number;
  roi: number | null;
  hitRate: number | null;
  clvAvailable: number;
  clvEligible: number;
  staleClvExcluded: number;
  averageClv: number | null;
  positiveClvRate: number | null;
  reliabilityStatus: ShadowReliabilityStatus;
  promotionEligible: false;
}

export interface ShadowReliabilityGroup extends ShadowReliabilityMetrics {
  key: string;
  marketType: string | null;
  checkpointMinutes: number | null;
  modelSource: string | null;
}

export interface ShadowReliabilityReport {
  version: string;
  overall: ShadowReliabilityMetrics;
  byMarket: ShadowReliabilityGroup[];
  byHorizon: ShadowReliabilityGroup[];
  byMarketAndHorizon: ShadowReliabilityGroup[];
  byModelSource: ShadowReliabilityGroup[];
  byModelSourceMarketAndHorizon: ShadowReliabilityGroup[];
  paperOnly: true;
  officialBestBetChanged: false;
  automaticPromotion: false;
  realMoneyExecution: false;
}

const FINAL_SCORE_STATUSES = new Set(['FT', 'AET', 'PEN']);
const VOID_STATUSES = new Set(['CANC', 'ABD', 'AWD', 'WO']);

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function minutesBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 60_000;
}

function sameLine(left: number | null, right: number | null): boolean {
  return (
    (left == null && right == null) ||
    (left != null && right != null && Math.abs(left - right) < 1e-9)
  );
}

function normalizedText(value: string): string {
  return value.trim().toUpperCase();
}

function normalizedBookmaker(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function normalizedMarket(input: { marketType: string; lineValue: number | null }): {
  marketType: 'MATCH_WINNER' | 'TOTAL_GOALS' | 'BTTS' | 'UNSUPPORTED';
  lineValue: number | null;
} {
  const marketType = normalizedText(input.marketType);
  const totalMatch = /^TOTAL_GOALS_(\d+)_(\d+)$/.exec(marketType);
  const inferredLine = totalMatch == null ? null : Number(`${totalMatch[1]}.${totalMatch[2]}`);

  if (marketType === 'MATCH_WINNER') {
    return { marketType: 'MATCH_WINNER', lineValue: null };
  }

  if (marketType === 'BTTS') {
    return { marketType: 'BTTS', lineValue: null };
  }

  if (marketType === 'TOTAL_GOALS' || totalMatch != null) {
    return {
      marketType: 'TOTAL_GOALS',
      lineValue: input.lineValue ?? inferredLine,
    };
  }

  return {
    marketType: 'UNSUPPORTED',
    lineValue: input.lineValue,
  };
}

function matchingMarketAndLine(
  candidate: ShadowSettlementCandidate,
  quote: ShadowClosingOddsSnapshot,
): boolean {
  const candidateMarket = normalizedMarket(candidate);
  const quoteMarket = normalizedMarket(quote);

  return (
    candidateMarket.marketType !== 'UNSUPPORTED' &&
    candidateMarket.marketType === quoteMarket.marketType &&
    normalizedText(candidate.selection) === normalizedText(quote.selection) &&
    sameLine(candidateMarket.lineValue, quoteMarket.lineValue)
  );
}

function invalidDecisionLineage(candidate: ShadowSettlementCandidate, reportAsOf: Date): string[] {
  const violations: string[] = [];

  if (
    !Number.isSafeInteger(candidate.snapshotId) ||
    candidate.snapshotId <= 0 ||
    candidate.snapshotHash.trim().length === 0
  ) {
    violations.push('INVALID_APPEND_ONLY_SNAPSHOT_IDENTITY');
  }

  if (
    candidate.snapshotAsOf.getTime() > candidate.kickoffAt.getTime() ||
    candidate.snapshotAsOf.getTime() > reportAsOf.getTime()
  ) {
    violations.push('DECISION_SNAPSHOT_AFTER_ALLOWED_AS_OF');
  }

  if (
    candidate.sourceOddsObservedAt != null &&
    (candidate.sourceOddsObservedAt.getTime() > candidate.snapshotAsOf.getTime() ||
      candidate.sourceOddsObservedAt.getTime() > candidate.kickoffAt.getTime())
  ) {
    violations.push('DECISION_ODDS_AFTER_DECISION_AS_OF');
  }

  if (!finite(candidate.decimalOdds) || candidate.decimalOdds <= 1) {
    violations.push('INVALID_DECISION_ODDS');
  }

  return violations;
}

export function linkShadowOutcome(input: {
  candidate: ShadowSettlementCandidate;
  outcomeSnapshots: readonly ShadowOutcomeSnapshot[];
  reportAsOf: Date;
}): ShadowOutcomeLink {
  const eligible = input.outcomeSnapshots
    .filter(
      (row): boolean =>
        row.providerFixtureId === input.candidate.providerFixtureId &&
        row.observedAt.getTime() >= input.candidate.kickoffAt.getTime() &&
        row.observedAt.getTime() <= input.reportAsOf.getTime() &&
        (FINAL_SCORE_STATUSES.has(normalizedText(row.statusShort)) ||
          VOID_STATUSES.has(normalizedText(row.statusShort))),
    )
    .sort(
      (left, right): number =>
        right.observedAt.getTime() - left.observedAt.getTime() || right.id - left.id,
    );

  const linked = eligible[0] ?? null;

  if (linked == null) {
    return {
      status: 'PENDING_FINAL_OUTCOME',
      sourceFixtureSnapshotId: null,
      sourceFixtureObservedAt: null,
      statusShort: null,
      fulltimeHomeGoals: null,
      fulltimeAwayGoals: null,
    };
  }

  const statusShort = normalizedText(linked.statusShort);

  if (VOID_STATUSES.has(statusShort)) {
    return {
      status: 'VOID_STATUS_LINKED',
      sourceFixtureSnapshotId: linked.id,
      sourceFixtureObservedAt: linked.observedAt.toISOString(),
      statusShort,
      fulltimeHomeGoals: linked.fulltimeHomeGoals,
      fulltimeAwayGoals: linked.fulltimeAwayGoals,
    };
  }

  if (linked.fulltimeHomeGoals == null || linked.fulltimeAwayGoals == null) {
    return {
      status: 'FINAL_SCORE_MISSING',
      sourceFixtureSnapshotId: linked.id,
      sourceFixtureObservedAt: linked.observedAt.toISOString(),
      statusShort,
      fulltimeHomeGoals: linked.fulltimeHomeGoals,
      fulltimeAwayGoals: linked.fulltimeAwayGoals,
    };
  }

  return {
    status: 'FINAL_SCORE_LINKED',
    sourceFixtureSnapshotId: linked.id,
    sourceFixtureObservedAt: linked.observedAt.toISOString(),
    statusShort,
    fulltimeHomeGoals: linked.fulltimeHomeGoals,
    fulltimeAwayGoals: linked.fulltimeAwayGoals,
  };
}

export function selectShadowClosingProxy(input: {
  candidate: ShadowSettlementCandidate;
  closingOddsSnapshots: readonly ShadowClosingOddsSnapshot[];
  reportAsOf: Date;
  targetMinutes?: number;
  toleranceMinutes?: number;
  maximumFreshSourceAgeMinutes?: number;
}): ShadowClosingLink {
  const targetMinutes = input.targetMinutes ?? SHADOW_CLOSING_PROXY_TARGET_MINUTES;
  const toleranceMinutes = input.toleranceMinutes ?? SHADOW_CLOSING_PROXY_TOLERANCE_MINUTES;
  const maximumFreshSourceAgeMinutes =
    input.maximumFreshSourceAgeMinutes ?? SHADOW_CLOSING_MAX_SOURCE_AGE_MINUTES;
  const minimumMinutesToKickoff = Math.max(0, targetMinutes - toleranceMinutes);
  const maximumMinutesToKickoff = targetMinutes + toleranceMinutes;
  const candidateBookmaker =
    input.candidate.bookmakerName == null
      ? null
      : normalizedBookmaker(input.candidate.bookmakerName);

  const eligible = input.closingOddsSnapshots
    .filter((row): boolean => {
      const minutesToKickoff = minutesBetween(input.candidate.kickoffAt, row.observedAt);
      const bookmakerMatches =
        candidateBookmaker == null || normalizedBookmaker(row.bookmakerName) === candidateBookmaker;
      const sourceTimestampIsPitSafe =
        row.sourceUpdatedAt == null ||
        (row.sourceUpdatedAt.getTime() <= row.observedAt.getTime() &&
          row.sourceUpdatedAt.getTime() <= input.candidate.kickoffAt.getTime());

      return (
        row.providerFixtureId === input.candidate.providerFixtureId &&
        row.pitUsable &&
        finite(row.decimalOdds) &&
        row.decimalOdds > 1 &&
        bookmakerMatches &&
        matchingMarketAndLine(input.candidate, row) &&
        row.observedAt.getTime() <= input.reportAsOf.getTime() &&
        minutesToKickoff >= minimumMinutesToKickoff &&
        minutesToKickoff <= maximumMinutesToKickoff &&
        sourceTimestampIsPitSafe
      );
    })
    .sort((left, right): number => {
      const leftDistance = Math.abs(
        minutesBetween(input.candidate.kickoffAt, left.observedAt) - targetMinutes,
      );
      const rightDistance = Math.abs(
        minutesBetween(input.candidate.kickoffAt, right.observedAt) - targetMinutes,
      );

      return (
        leftDistance - rightDistance ||
        right.observedAt.getTime() - left.observedAt.getTime() ||
        right.id - left.id
      );
    });

  const linked = eligible[0] ?? null;

  if (linked == null) {
    return {
      status: 'NO_MATCHING_CLOSING_PROXY',
      sourceOddsSnapshotId: null,
      sourceObservedAt: null,
      sourceUpdatedAt: null,
      bookmakerName: null,
      decimalOdds: null,
      minutesToKickoff: null,
      sourceAgeAtObservationMinutes: null,
      sourceAgeAtKickoffMinutes: null,
      targetMinutes,
      toleranceMinutes,
      maximumFreshSourceAgeMinutes,
      clvEligible: false,
    };
  }

  const sourceAgeAtObservationMinutes =
    linked.sourceUpdatedAt == null
      ? null
      : minutesBetween(linked.observedAt, linked.sourceUpdatedAt);
  const sourceAgeAtKickoffMinutes =
    linked.sourceUpdatedAt == null
      ? null
      : minutesBetween(input.candidate.kickoffAt, linked.sourceUpdatedAt);
  const fresh =
    sourceAgeAtKickoffMinutes != null &&
    sourceAgeAtKickoffMinutes >= 0 &&
    sourceAgeAtKickoffMinutes <= maximumFreshSourceAgeMinutes;

  return {
    status:
      sourceAgeAtKickoffMinutes == null
        ? 'CLOSING_PROXY_SOURCE_AGE_UNKNOWN'
        : fresh
          ? 'CLOSING_PROXY_FRESH'
          : 'CLOSING_PROXY_STALE_SOURCE',
    sourceOddsSnapshotId: linked.id,
    sourceObservedAt: linked.observedAt.toISOString(),
    sourceUpdatedAt: linked.sourceUpdatedAt?.toISOString() ?? null,
    bookmakerName: linked.bookmakerName,
    decimalOdds: linked.decimalOdds,
    minutesToKickoff: minutesBetween(input.candidate.kickoffAt, linked.observedAt),
    sourceAgeAtObservationMinutes,
    sourceAgeAtKickoffMinutes,
    targetMinutes,
    toleranceMinutes,
    maximumFreshSourceAgeMinutes,
    clvEligible: fresh,
  };
}

export function settleShadowSelection(input: {
  marketType: string;
  selection: string;
  lineValue: number | null;
  homeGoals: number;
  awayGoals: number;
}): ShadowSettlementResult {
  const market = normalizedMarket(input);
  const selection = normalizedText(input.selection);

  if (market.marketType === 'MATCH_WINNER') {
    if (!['HOME', 'DRAW', 'AWAY'].includes(selection)) return 'VOID';

    const actual =
      input.homeGoals > input.awayGoals
        ? 'HOME'
        : input.homeGoals < input.awayGoals
          ? 'AWAY'
          : 'DRAW';

    return actual === selection ? 'WIN' : 'LOSS';
  }

  if (market.marketType === 'BTTS') {
    if (!['YES', 'NO'].includes(selection)) return 'VOID';

    const actual = input.homeGoals > 0 && input.awayGoals > 0 ? 'YES' : 'NO';
    return actual === selection ? 'WIN' : 'LOSS';
  }

  if (market.marketType === 'TOTAL_GOALS') {
    if (
      !['OVER', 'UNDER'].includes(selection) ||
      market.lineValue == null ||
      !finite(market.lineValue)
    ) {
      return 'VOID';
    }

    const totalGoals = input.homeGoals + input.awayGoals;
    if (Math.abs(totalGoals - market.lineValue) < 1e-9) return 'VOID';

    const actual = totalGoals > market.lineValue ? 'OVER' : 'UNDER';
    return actual === selection ? 'WIN' : 'LOSS';
  }

  return 'VOID';
}

export function hypotheticalFlatStakeProfit(
  result: ShadowSettlementResult,
  decimalOdds: number,
): number {
  if (result === 'WIN') {
    return (decimalOdds - 1) * SHADOW_FLAT_STAKE_UNITS;
  }

  if (result === 'LOSS') {
    return -SHADOW_FLAT_STAKE_UNITS;
  }

  return 0;
}

export function settleShadowCandidate(input: {
  candidate: ShadowSettlementCandidate;
  outcomeSnapshots: readonly ShadowOutcomeSnapshot[];
  closingOddsSnapshots: readonly ShadowClosingOddsSnapshot[];
  reportAsOf: Date;
  closingTargetMinutes?: number;
  closingToleranceMinutes?: number;
  maximumFreshSourceAgeMinutes?: number;
}): ShadowSettlementRow {
  const lineageViolations = invalidDecisionLineage(input.candidate, input.reportAsOf);
  const outcome = linkShadowOutcome({
    candidate: input.candidate,
    outcomeSnapshots: input.outcomeSnapshots,
    reportAsOf: input.reportAsOf,
  });
  const closing = selectShadowClosingProxy({
    candidate: input.candidate,
    closingOddsSnapshots: input.closingOddsSnapshots,
    reportAsOf: input.reportAsOf,
    targetMinutes: input.closingTargetMinutes,
    toleranceMinutes: input.closingToleranceMinutes,
    maximumFreshSourceAgeMinutes: input.maximumFreshSourceAgeMinutes,
  });
  const settlementResult =
    outcome.status === 'VOID_STATUS_LINKED'
      ? 'VOID'
      : outcome.status === 'FINAL_SCORE_LINKED' &&
          outcome.fulltimeHomeGoals != null &&
          outcome.fulltimeAwayGoals != null
        ? settleShadowSelection({
            marketType: input.candidate.marketType,
            selection: input.candidate.selection,
            lineValue: input.candidate.lineValue,
            homeGoals: outcome.fulltimeHomeGoals,
            awayGoals: outcome.fulltimeAwayGoals,
          })
        : null;
  const clv =
    closing.decimalOdds != null ? input.candidate.decimalOdds / closing.decimalOdds - 1 : null;
  const impliedProbabilityClv =
    closing.decimalOdds != null ? 1 / closing.decimalOdds - 1 / input.candidate.decimalOdds : null;

  return {
    version: SHADOW_SETTLEMENT_VERSION,
    status:
      lineageViolations.length > 0
        ? 'INVALID_DECISION_LINEAGE'
        : settlementResult == null
          ? 'PENDING_OUTCOME'
          : 'SETTLED',
    providerFixtureId: input.candidate.providerFixtureId,
    snapshotId: input.candidate.snapshotId,
    snapshotHash: input.candidate.snapshotHash,
    checkpointMinutes: input.candidate.checkpointMinutes,
    checkpointLabel: input.candidate.checkpointLabel,
    snapshotAsOf: input.candidate.snapshotAsOf.toISOString(),
    kickoffAt: input.candidate.kickoffAt.toISOString(),
    marketType: input.candidate.marketType,
    selection: input.candidate.selection,
    lineValue: input.candidate.lineValue,
    decisionOdds: input.candidate.decimalOdds,
    bookmakerName: input.candidate.bookmakerName,
    shadowTier: input.candidate.shadowTier,
    modelSource: input.candidate.modelSource ?? null,
    modelVersion: input.candidate.modelVersion ?? null,
    paperRecommendationVersion: input.candidate.paperRecommendationVersion ?? null,
    rawModelProbability: input.candidate.rawModelProbability ?? null,
    paperModelProbability: input.candidate.paperModelProbability ?? null,
    decisionSource: input.candidate.decisionSource,
    outcome,
    settlementResult: lineageViolations.length > 0 ? null : settlementResult,
    flatStakeUnits: SHADOW_FLAT_STAKE_UNITS,
    hypotheticalProfitUnits:
      lineageViolations.length > 0 || settlementResult == null
        ? null
        : hypotheticalFlatStakeProfit(settlementResult, input.candidate.decimalOdds),
    closing,
    clv: lineageViolations.length > 0 ? null : clv,
    impliedProbabilityClv: lineageViolations.length > 0 ? null : impliedProbabilityClv,
    lineageViolations,
    paperOnly: true,
    stakeEligible: false,
    officialBestBetChanged: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}

function metrics(rows: readonly ShadowSettlementRow[]): ShadowReliabilityMetrics {
  const settled = rows.filter(
    (row): boolean => row.status === 'SETTLED' && row.settlementResult != null,
  );
  const wins = settled.filter((row): boolean => row.settlementResult === 'WIN').length;
  const losses = settled.filter((row): boolean => row.settlementResult === 'LOSS').length;
  const voids = settled.filter((row): boolean => row.settlementResult === 'VOID').length;
  const flatStakeUnits = settled.length * SHADOW_FLAT_STAKE_UNITS;
  const hypotheticalProfitUnits = settled.reduce(
    (sum, row): number => sum + (row.hypotheticalProfitUnits ?? 0),
    0,
  );
  const clvAvailableRows = settled.filter((row): boolean => row.clv != null);
  const eligibleClv = settled
    .filter((row): boolean => row.closing.clvEligible && row.clv != null)
    .map((row): number => row.clv as number);
  const decisive = wins + losses;

  return {
    rows: rows.length,
    settled: settled.length,
    pending: rows.filter((row): boolean => row.status === 'PENDING_OUTCOME').length,
    invalidLineage: rows.filter((row): boolean => row.status === 'INVALID_DECISION_LINEAGE').length,
    wins,
    losses,
    voids,
    flatStakeUnits,
    hypotheticalProfitUnits,
    roi: flatStakeUnits > 0 ? hypotheticalProfitUnits / flatStakeUnits : null,
    hitRate: decisive > 0 ? wins / decisive : null,
    clvAvailable: clvAvailableRows.length,
    clvEligible: eligibleClv.length,
    staleClvExcluded: clvAvailableRows.length - eligibleClv.length,
    averageClv:
      eligibleClv.length > 0
        ? eligibleClv.reduce((sum, value): number => sum + value, 0) / eligibleClv.length
        : null,
    positiveClvRate:
      eligibleClv.length > 0
        ? eligibleClv.filter((value): boolean => value > 0).length / eligibleClv.length
        : null,
    reliabilityStatus:
      settled.length === 0
        ? 'NO_SETTLED_SAMPLE'
        : settled.length < SHADOW_RELIABILITY_MINIMUM_SAMPLE
          ? 'ACCUMULATING_RESEARCH_SAMPLE'
          : 'RESEARCH_SAMPLE_AVAILABLE',
    promotionEligible: false,
  };
}

function grouped(
  rows: readonly ShadowSettlementRow[],
  keyFor: (row: ShadowSettlementRow) => string,
  dimensionsFor: (row: ShadowSettlementRow) => {
    marketType: string | null;
    checkpointMinutes: number | null;
    modelSource: string | null;
  },
): ShadowReliabilityGroup[] {
  const groups = new Map<string, ShadowSettlementRow[]>();

  for (const row of rows) {
    const key = keyFor(row);
    const values = groups.get(key) ?? [];
    values.push(row);
    groups.set(key, values);
  }

  return [...groups.entries()]
    .map(([key, values]): ShadowReliabilityGroup => ({
      key,
      ...dimensionsFor(values[0] as ShadowSettlementRow),
      ...metrics(values),
    }))
    .sort((left, right): number => left.key.localeCompare(right.key));
}

export function aggregateShadowSettlements(
  rows: readonly ShadowSettlementRow[],
): ShadowReliabilityReport {
  return {
    version: SHADOW_SETTLEMENT_VERSION,
    overall: metrics(rows),
    byMarket: grouped(
      rows,
      (row): string => row.marketType,
      (row) => ({
        marketType: row.marketType,
        checkpointMinutes: null,
        modelSource: null,
      }),
    ),
    byHorizon: grouped(
      rows,
      (row): string => `T-${row.checkpointMinutes}`,
      (row) => ({
        marketType: null,
        checkpointMinutes: row.checkpointMinutes,
        modelSource: null,
      }),
    ),
    byMarketAndHorizon: grouped(
      rows,
      (row): string => `${row.marketType}:T-${row.checkpointMinutes}`,
      (row) => ({
        marketType: row.marketType,
        checkpointMinutes: row.checkpointMinutes,
        modelSource: null,
      }),
    ),
    byModelSource: grouped(
      rows,
      (row): string => row.modelSource ?? 'UNKNOWN_MODEL_SOURCE',
      (row) => ({
        marketType: null,
        checkpointMinutes: null,
        modelSource: row.modelSource,
      }),
    ),
    byModelSourceMarketAndHorizon: grouped(
      rows,
      (row): string =>
        `${row.modelSource ?? 'UNKNOWN_MODEL_SOURCE'}:${row.marketType}:T-${row.checkpointMinutes}`,
      (row) => ({
        marketType: row.marketType,
        checkpointMinutes: row.checkpointMinutes,
        modelSource: row.modelSource,
      }),
    ),
    paperOnly: true,
    officialBestBetChanged: false,
    automaticPromotion: false,
    realMoneyExecution: false,
  };
}
