export const PAPER_OU_MODEL_SELECTION_VERSION =
  'v7.0-ou-direct-model-selection-v1';

export const PAPER_OU_SOURCE_LINES = [1.5, 2.5, 3.5] as const;
export const PAPER_OU_SUPPORTED_LINES = [1.5, 2, 2.5, 3, 3.5] as const;

export type PaperOuSourceLine = (typeof PAPER_OU_SOURCE_LINES)[number];
export type PaperOuLine = (typeof PAPER_OU_SUPPORTED_LINES)[number];
export type PaperOuSelection = 'OVER' | 'UNDER';
export type PaperOuMarketType =
  | 'TOTAL_GOALS_1_5'
  | 'TOTAL_GOALS_2_5'
  | 'TOTAL_GOALS_3_5';

export interface PaperOuModelSelectionMapping {
  version: typeof PAPER_OU_MODEL_SELECTION_VERSION;
  strategy: 'OU_DIRECT_MODEL_SELECTION';
  predictionMarketType: PaperOuMarketType;
  predictionSelection: PaperOuSelection;
  predictionLineValue: PaperOuSourceLine;
  recommendedMarketType: PaperOuMarketType;
  recommendedSelection: PaperOuSelection;
  recommendedLineValue: PaperOuSourceLine;
  lineShiftGoals: 0;
  boundaryClamped: false;
  paperOnly: true;
}

export interface PaperOuModelSelectionStrategyAudit extends PaperOuModelSelectionMapping {
  predictionProbability: number;
  targetWinProbability?: number;
  targetPushProbability?: number;
  targetLossProbability?: number;
  targetEffectiveProbability?: number;
}

// Compatibility aliases for persisted payloads and downstream consumers. New
// runtime code uses the direct-model names above; the serialized field is kept
// stable so old append-only paper decisions remain readable.
export type PaperOuOppositeLineMapping = PaperOuModelSelectionMapping;
export type PaperOuOppositeLineStrategyAudit = PaperOuModelSelectionStrategyAudit;

export interface PaperOuTargetProbabilities {
  winProbability: number;
  pushProbability: number;
  lossProbability: number;
  effectiveProbability: number;
}

const EPSILON = 1e-12;

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('O/U probability must be finite.');
  }

  return Math.max(0, Math.min(1, value));
}

export function isPaperOuMarketType(value: string): value is PaperOuMarketType {
  return (
    value === 'TOTAL_GOALS_1_5' ||
    value === 'TOTAL_GOALS_2_5' ||
    value === 'TOTAL_GOALS_3_5'
  );
}

export function isPaperOuSourceLine(value: number | null): value is PaperOuSourceLine {
  return (
    value != null &&
    PAPER_OU_SOURCE_LINES.some((lineValue) => Math.abs(lineValue - value) < EPSILON)
  );
}

export function isPaperOuSupportedLine(value: number | null): value is PaperOuLine {
  return (
    value != null &&
    PAPER_OU_SUPPORTED_LINES.some((lineValue) => Math.abs(lineValue - value) < EPSILON)
  );
}

export function paperOuMarketForLine(lineValue: PaperOuLine): PaperOuMarketType {
  if (lineValue <= 2) return 'TOTAL_GOALS_1_5';
  if (lineValue <= 3) return 'TOTAL_GOALS_2_5';
  return 'TOTAL_GOALS_3_5';
}

export function paperOuLineForMarket(marketType: PaperOuMarketType): PaperOuSourceLine {
  if (marketType === 'TOTAL_GOALS_1_5') return 1.5;
  if (marketType === 'TOTAL_GOALS_2_5') return 2.5;
  return 3.5;
}

/**
 * Keeps the model result unchanged. If the model selects Over 2.5, the paper
 * recommendation is Over 2.5; no opposite selection or +/-0.5 line shift is
 * applied.
 */
export function mapPaperOuPredictionToModelSelection(input: {
  predictionSelection: PaperOuSelection;
  predictionLineValue: PaperOuSourceLine;
}): PaperOuModelSelectionMapping {
  const predictionMarketType = paperOuMarketForLine(input.predictionLineValue);

  return {
    version: PAPER_OU_MODEL_SELECTION_VERSION,
    strategy: 'OU_DIRECT_MODEL_SELECTION',
    predictionMarketType,
    predictionSelection: input.predictionSelection,
    predictionLineValue: input.predictionLineValue,
    recommendedMarketType: predictionMarketType,
    recommendedSelection: input.predictionSelection,
    recommendedLineValue: input.predictionLineValue,
    lineShiftGoals: 0,
    boundaryClamped: false,
    paperOnly: true,
  };
}

export function derivePaperOuTargetProbabilities(input: {
  mapping: PaperOuModelSelectionMapping;
  underProbabilities: {
    line1_5: number;
    line2_5: number;
    line3_5: number;
  };
  decimalOdds: number;
}): PaperOuTargetProbabilities {
  if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) {
    throw new RangeError('decimalOdds must be greater than 1.');
  }

  const under1_5 = clampProbability(input.underProbabilities.line1_5);
  const under2_5 = clampProbability(input.underProbabilities.line2_5);
  const under3_5 = clampProbability(input.underProbabilities.line3_5);

  const selection = input.mapping.recommendedSelection;
  const lineValue = input.mapping.recommendedLineValue;
  let winProbability: number;

  if (lineValue === 1.5) {
    winProbability = selection === 'OVER' ? 1 - under1_5 : under1_5;
  } else if (lineValue === 2.5) {
    winProbability = selection === 'OVER' ? 1 - under2_5 : under2_5;
  } else {
    winProbability = selection === 'OVER' ? 1 - under3_5 : under3_5;
  }

  winProbability = clampProbability(winProbability);

  return {
    winProbability,
    pushProbability: 0,
    lossProbability: 1 - winProbability,
    effectiveProbability: winProbability,
  };
}
