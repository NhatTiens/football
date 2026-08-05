import {
  isPaperOuMarketType,
  mapPaperOuPredictionToOppositeLine,
  paperOuLineForMarket,
  paperOuMarketForLine,
  type PaperOuLine,
  type PaperOuMarketType,
  type PaperOuSelection,
} from './paper-ou-opposite-line-core.js';

export const OU_LEGACY_HISTORY_REPLAY_VERSION =
  'v7.0-ou-legacy-history-pit-replay-v1';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizedSelection(value: unknown): PaperOuSelection | null {
  const selection = text(value)?.toUpperCase();
  return selection === 'OVER' || selection === 'UNDER' ? selection : null;
}

function supportedLine(value: number | null): PaperOuLine | null {
  return value === 1.5 || value === 2.5 || value === 3.5 ? value : null;
}

function normalizedOuIdentity(value: UnknownRecord): {
  marketType: PaperOuMarketType;
  lineValue: PaperOuLine;
  selection: PaperOuSelection;
} | null {
  const rawMarket = text(value.marketType, value.market, value.marketCode)?.toUpperCase() ?? null;
  const selection = normalizedSelection(value.selection ?? value.selectionCode);
  if (selection == null || rawMarket == null) return null;

  let lineValue = supportedLine(finiteNumber(value.lineValue));
  let marketType: PaperOuMarketType | null = null;

  if (isPaperOuMarketType(rawMarket)) {
    marketType = rawMarket;
    lineValue ??= paperOuLineForMarket(rawMarket);
  } else if (rawMarket === 'TOTAL_GOALS' && lineValue != null) {
    marketType = paperOuMarketForLine(lineValue);
  }

  return marketType == null || lineValue == null
    ? null
    : { marketType, lineValue, selection };
}

function sameOuIdentity(
  value: UnknownRecord,
  expected: {
    marketType: PaperOuMarketType;
    lineValue: PaperOuLine;
    selection: PaperOuSelection;
  },
): boolean {
  const normalized = normalizedOuIdentity(value);
  return (
    normalized != null &&
    normalized.marketType === expected.marketType &&
    normalized.lineValue === expected.lineValue &&
    normalized.selection === expected.selection
  );
}

/**
 * Reconstructs the historical paper O/U view from the immutable PIT snapshot.
 * It never writes to the database and never invents a quote. Replay succeeds only
 * when the exact mapped target candidate, including its decision-time odds, is
 * present in analysis.candidates of the same ScientificCurrentSignalSnapshot.
 */
export function replayLegacyOuHistorySelection(input: {
  selected: unknown;
  analysisCandidates: unknown;
}): UnknownRecord | null {
  const selected = record(input.selected);
  if (selected == null || record(selected.ouOppositeLineStrategy) != null) return null;

  const source = normalizedOuIdentity(selected);
  if (source == null) return null;

  const mapping = mapPaperOuPredictionToOppositeLine({
    predictionSelection: source.selection,
    predictionLineValue: source.lineValue,
  });
  const candidateValues = Array.isArray(input.analysisCandidates)
    ? input.analysisCandidates
    : [];
  const candidates = candidateValues
    .map(record)
    .filter((value): value is UnknownRecord => value != null);

  const sourceCandidate =
    candidates.find((candidate) => sameOuIdentity(candidate, source)) ?? null;
  const target =
    candidates.find((candidate) =>
      sameOuIdentity(candidate, {
        marketType: mapping.recommendedMarketType,
        selection: mapping.recommendedSelection,
        lineValue: mapping.recommendedLineValue,
      }),
    ) ?? null;

  if (target == null) return null;

  const targetOdds = finiteNumber(target.decimalOdds, target.odds);
  if (targetOdds == null || targetOdds <= 1) return null;

  const predictionProbability = finiteNumber(
    selected.modelProbability,
    selected.rawModelProbability,
    sourceCandidate?.modelProbability,
  );
  const replayStrategy = {
    ...mapping,
    predictionProbability,
  };

  return {
    ...selected,
    ...target,
    marketType: mapping.recommendedMarketType,
    selection: mapping.recommendedSelection,
    lineValue: mapping.recommendedLineValue,
    decimalOdds: targetOdds,
    bookmakerName: text(target.bookmakerName, target.bookmaker),
    sourceOddsSnapshotId: finiteNumber(target.sourceOddsSnapshotId),
    modelProbability: finiteNumber(target.modelProbability),
    fairMarketProbability: finiteNumber(target.fairMarketProbability),
    edge: finiteNumber(target.edge),
    expectedValue: finiteNumber(target.expectedValue),
    boundedAdjustedProbability: finiteNumber(target.boundedAdjustedProbability),
    hierarchicalConservativeProbability: finiteNumber(
      target.hierarchicalConservativeProbability,
    ),
    boundedEdge: finiteNumber(target.boundedEdge),
    hierarchicalEdge: finiteNumber(target.hierarchicalEdge),
    boundedExpectedValue: finiteNumber(target.boundedExpectedValue),
    hierarchicalExpectedValue: finiteNumber(target.hierarchicalExpectedValue),
    paperTrackEligible: selected.paperTrackEligible,
    stakeEligible: selected.stakeEligible,
    status: selected.status,
    ouOppositeLineStrategy: replayStrategy,
    legacyOuHistoryReplay: {
      version: OU_LEGACY_HISTORY_REPLAY_VERSION,
      source: 'ScientificCurrentSignalSnapshot.analysis.candidates',
      sourceSnapshotOnly: true,
      exactTargetCandidateRequired: true,
      originalSnapshotMutated: false,
      databaseWritten: false,
    },
  };
}
