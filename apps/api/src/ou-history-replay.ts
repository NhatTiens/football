import { prisma } from '@football-ai/database';
import {
  PAPER_OU_OPPOSITE_LINE_VERSION,
  isPaperOuSourceLine,
  mapPaperOuPredictionToOppositeLine,
  type PaperOuSelection,
} from '@football-ai/sync';

export type OuHistoryReplayStatus =
  | 'NOT_OU'
  | 'CURRENT_HALF_GOAL_RULE'
  | 'REPLAYED_FROM_PIT_ODDS'
  | 'MISSING_SOURCE_AUDIT'
  | 'MISSING_TARGET_PIT_ODDS';

export interface OuHistorySettlement {
  result: string;
  stakeUnits: number;
  profitUnits: number;
  fulltimeHomeGoals: number;
  fulltimeAwayGoals: number;
  clv: number | null;
  settledAt: string | null;
}

export interface ReplayableOuHistoryRow {
  id: string;
  source: 'PAPER_LEDGER' | 'PAPER_SHADOW';
  providerFixtureId: number;
  decisionAsOf: string;
  kickoffAt: string;
  decisionType: string;
  market: string | null;
  selection: string | null;
  lineValue: number | null;
  decimalOdds: number | null;
  bookmakerName: string | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  policyVersion: string;
  sourcePredictionSelection: string | null;
  sourcePredictionLineValue: number | null;
  sourcePredictionProbability: number | null;
  settlement: OuHistorySettlement | null;
}

type OddsQuote = {
  id: number;
  providerFixtureId: number;
  observedAt: Date;
  sourceUpdatedAt: Date | null;
  bookmakerId: number;
  bookmakerName: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
};

export type SourceAudit = {
  version: string | null;
  predictionSelection: PaperOuSelection;
  predictionLineValue: number;
  predictionProbability: number | null;
};

const EPSILON = 1e-9;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function selectionValue(value: unknown): PaperOuSelection | null {
  return value === 'OVER' || value === 'UNDER' ? value : null;
}

function strategyFromCandidate(value: unknown): SourceAudit | null {
  const candidate = asRecord(value);
  const input = asRecord(candidate?.input);
  const strategy = asRecord(input?.ouOppositeLineStrategy);
  const predictionSelection = selectionValue(strategy?.predictionSelection);
  const predictionLineValue = numberValue(strategy?.predictionLineValue);

  if (
    predictionSelection == null ||
    predictionLineValue == null ||
    !isPaperOuSourceLine(predictionLineValue)
  ) {
    return null;
  }

  return {
    version: typeof strategy?.version === 'string' ? strategy.version : null,
    predictionSelection,
    predictionLineValue,
    predictionProbability: numberValue(strategy?.predictionProbability),
  };
}

export function extractOuAuditFromDecisionPayload(payload: unknown): SourceAudit | null {
  const record = asRecord(payload);
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  const decision = asRecord(record?.decision);
  const selected = asRecord(decision?.selected);

  if (selected != null) {
    for (const candidateValue of candidates) {
      const candidate = asRecord(candidateValue);
      const scientific = asRecord(candidate?.scientificCandidate);
      const strategy = strategyFromCandidate(candidateValue);

      if (
        strategy != null &&
        scientific?.selection === selected.selection &&
        numberValue(scientific?.lineValue) === numberValue(selected.lineValue) &&
        numberValue(scientific?.decimalOdds) === numberValue(selected.decimalOdds)
      ) {
        return strategy;
      }
    }
  }

  for (const candidateValue of candidates) {
    const strategy = strategyFromCandidate(candidateValue);
    if (strategy != null) return strategy;
  }

  return null;
}

function sourceFromRow(row: ReplayableOuHistoryRow): SourceAudit | null {
  const explicitSelection = selectionValue(row.sourcePredictionSelection);
  const explicitLine = row.sourcePredictionLineValue;

  if (
    explicitSelection != null &&
    explicitLine != null &&
    isPaperOuSourceLine(explicitLine)
  ) {
    return {
      version: null,
      predictionSelection: explicitSelection,
      predictionLineValue: explicitLine,
      predictionProbability: row.sourcePredictionProbability,
    };
  }

  const legacySelection = selectionValue(row.selection);
  if (
    legacySelection != null &&
    row.lineValue != null &&
    isPaperOuSourceLine(row.lineValue)
  ) {
    return {
      version: null,
      predictionSelection: legacySelection,
      predictionLineValue: row.lineValue,
      predictionProbability: row.modelProbability,
    };
  }

  return null;
}

function isOuRow(row: ReplayableOuHistoryRow): boolean {
  return (
    row.market?.startsWith('TOTAL_GOALS') === true ||
    row.selection === 'OVER' ||
    row.selection === 'UNDER'
  );
}

function sameNumber(left: number | null, right: number | null): boolean {
  return left != null && right != null && Math.abs(left - right) < EPSILON;
}

function settleOu(
  selection: PaperOuSelection,
  lineValue: number,
  odds: number,
  settlement: OuHistorySettlement,
): OuHistorySettlement {
  const totalGoals = settlement.fulltimeHomeGoals + settlement.fulltimeAwayGoals;
  let result: 'WIN' | 'LOSS' | 'VOID';

  if (Math.abs(totalGoals - lineValue) < EPSILON) {
    result = 'VOID';
  } else if (selection === 'OVER') {
    result = totalGoals > lineValue ? 'WIN' : 'LOSS';
  } else {
    result = totalGoals < lineValue ? 'WIN' : 'LOSS';
  }

  const stakeUnits =
    Number.isFinite(settlement.stakeUnits) && settlement.stakeUnits > 0
      ? settlement.stakeUnits
      : 1;
  const profitUnits =
    result === 'WIN'
      ? stakeUnits * (odds - 1)
      : result === 'LOSS'
        ? -stakeUnits
        : 0;

  return {
    ...settlement,
    result,
    stakeUnits,
    profitUnits,
    clv: null,
  };
}

function chooseQuote(
  quotes: OddsQuote[],
  row: ReplayableOuHistoryRow,
  selection: PaperOuSelection,
  lineValue: number,
): OddsQuote | null {
  const decisionTime = new Date(row.decisionAsOf).getTime();

  const candidates = quotes
    .filter(
      (quote) =>
        quote.providerFixtureId === row.providerFixtureId &&
        quote.selection === selection &&
        sameNumber(quote.lineValue, lineValue) &&
        quote.observedAt.getTime() <= decisionTime &&
        (quote.sourceUpdatedAt == null ||
          quote.sourceUpdatedAt.getTime() <= decisionTime) &&
        Number.isFinite(quote.decimalOdds) &&
        quote.decimalOdds > 1,
    )
    .sort(
      (left, right) =>
        right.observedAt.getTime() - left.observedAt.getTime() ||
        (right.sourceUpdatedAt?.getTime() ?? 0) -
          (left.sourceUpdatedAt?.getTime() ?? 0) ||
        right.decimalOdds - left.decimalOdds ||
        left.bookmakerId - right.bookmakerId ||
        right.id - left.id,
    );

  const latestObservedAt = candidates[0]?.observedAt.getTime();
  if (latestObservedAt == null) return null;

  return (
    candidates
      .filter((candidate) => candidate.observedAt.getTime() === latestObservedAt)
      .sort(
        (left, right) =>
          right.decimalOdds - left.decimalOdds ||
          left.bookmakerId - right.bookmakerId ||
          right.id - left.id,
      )[0] ?? null
  );
}

export async function replayOuBetHistoryRows<T extends ReplayableOuHistoryRow>(
  rows: T[],
  reportAsOf: Date,
): Promise<
  Array<
    T & {
      ouRuleVersion: string | null;
      historyReplayStatus: OuHistoryReplayStatus;
      historyStrategyEligible: boolean;
    }
  >
> {
  const ouRows = rows.filter(isOuRow);
  const fixtureIds = [...new Set(ouRows.map((row) => row.providerFixtureId))];

  const quotes =
    fixtureIds.length === 0
      ? []
      : ((await prisma.apiFootballOddsSnapshot.findMany({
          where: {
            providerFixtureId: { in: fixtureIds },
            marketType: 'TOTAL_GOALS',
            lineValue: { in: [1.5, 2, 3, 3.5] },
            pitUsable: true,
            observedAt: { lte: reportAsOf },
          },
          select: {
            id: true,
            providerFixtureId: true,
            observedAt: true,
            sourceUpdatedAt: true,
            bookmakerId: true,
            bookmakerName: true,
            selection: true,
            lineValue: true,
            decimalOdds: true,
          },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: Math.min(100_000, Math.max(1000, fixtureIds.length * 400)),
        })) as OddsQuote[]);

  return rows.map((row) => {
    if (!isOuRow(row)) {
      return {
        ...row,
        ouRuleVersion: null,
        historyReplayStatus: 'NOT_OU' as const,
        historyStrategyEligible: true,
      };
    }

    const source = sourceFromRow(row);
    if (source == null) {
      return {
        ...row,
        settlement: null,
        ouRuleVersion: null,
        historyReplayStatus: 'MISSING_SOURCE_AUDIT' as const,
        historyStrategyEligible: false,
      };
    }

    const mapping = mapPaperOuPredictionToOppositeLine({
      predictionSelection: source.predictionSelection,
      predictionLineValue: source.predictionLineValue as 1.5 | 2.5 | 3.5,
    });
    const alreadyCurrent =
      row.selection === mapping.recommendedSelection &&
      sameNumber(row.lineValue, mapping.recommendedLineValue) &&
      row.sourcePredictionSelection != null &&
      row.sourcePredictionLineValue != null;

    if (alreadyCurrent) {
      return {
        ...row,
        ouRuleVersion: PAPER_OU_OPPOSITE_LINE_VERSION,
        historyReplayStatus: 'CURRENT_HALF_GOAL_RULE' as const,
        historyStrategyEligible: true,
      };
    }

    const quote = chooseQuote(
      quotes,
      row,
      mapping.recommendedSelection,
      mapping.recommendedLineValue,
    );

    if (quote == null) {
      return {
        ...row,
        sourcePredictionSelection: source.predictionSelection,
        sourcePredictionLineValue: source.predictionLineValue,
        sourcePredictionProbability: source.predictionProbability,
        selection: mapping.recommendedSelection,
        lineValue: mapping.recommendedLineValue,
        decimalOdds: null,
        bookmakerName: null,
        modelProbability: null,
        fairMarketProbability: null,
        edge: null,
        expectedValue: null,
        settlement: null,
        ouRuleVersion: PAPER_OU_OPPOSITE_LINE_VERSION,
        historyReplayStatus: 'MISSING_TARGET_PIT_ODDS' as const,
        historyStrategyEligible: false,
      };
    }

    return {
      ...row,
      sourcePredictionSelection: source.predictionSelection,
      sourcePredictionLineValue: source.predictionLineValue,
      sourcePredictionProbability: source.predictionProbability,
      selection: mapping.recommendedSelection,
      lineValue: mapping.recommendedLineValue,
      decimalOdds: quote.decimalOdds,
      bookmakerName: quote.bookmakerName,
      modelProbability: null,
      fairMarketProbability: null,
      edge: null,
      expectedValue: null,
      settlement:
        row.settlement == null
          ? null
          : settleOu(
              mapping.recommendedSelection,
              mapping.recommendedLineValue,
              quote.decimalOdds,
              row.settlement,
            ),
      ouRuleVersion: PAPER_OU_OPPOSITE_LINE_VERSION,
      historyReplayStatus: 'REPLAYED_FROM_PIT_ODDS' as const,
      historyStrategyEligible: true,
    };
  });
}
