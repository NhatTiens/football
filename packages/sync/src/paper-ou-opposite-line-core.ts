export const PAPER_OU_OPPOSITE_LINE_VERSION =
  'v7.0-r4.10.2.11.6-ou-opposite-half-goal-v2';

export const PAPER_OU_SOURCE_LINES = [1.5, 2.5, 3.5] as const;
export const PAPER_OU_SUPPORTED_LINES = [1.5, 2, 2.5, 3, 3.5] as const;

export type PaperOuSourceLine = (typeof PAPER_OU_SOURCE_LINES)[number];
export type PaperOuLine = (typeof PAPER_OU_SUPPORTED_LINES)[number];
export type PaperOuSelection = 'OVER' | 'UNDER';
export type PaperOuMarketType =
  | 'TOTAL_GOALS_1_5'
  | 'TOTAL_GOALS_2_5'
  | 'TOTAL_GOALS_3_5';

export interface PaperOuOppositeLineMapping {
  version: typeof PAPER_OU_OPPOSITE_LINE_VERSION;
  strategy: 'OU_OPPOSITE_PROTECTED_HALF_GOAL';
  predictionMarketType: PaperOuMarketType;
  predictionSelection: PaperOuSelection;
  predictionLineValue: PaperOuSourceLine;
  recommendedMarketType: PaperOuMarketType;
  recommendedSelection: PaperOuSelection;
  recommendedLineValue: PaperOuLine;
  lineShiftGoals: 0 | 0.5;
  boundaryClamped: boolean;
  paperOnly: true;
}

export interface PaperOuOppositeLineStrategyAudit extends PaperOuOppositeLineMapping {
  predictionProbability: number;
  targetWinProbability?: number;
  targetPushProbability?: number;
  targetLossProbability?: number;
  targetEffectiveProbability?: number;
}

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

export function mapPaperOuPredictionToOppositeLine(input: {
  predictionSelection: PaperOuSelection;
  predictionLineValue: PaperOuSourceLine;
}): PaperOuOppositeLineMapping {
  const predictionMarketType = paperOuMarketForLine(input.predictionLineValue);
  const unclampedLine =
    input.predictionSelection === 'OVER'
      ? input.predictionLineValue + 0.5
      : input.predictionLineValue - 0.5;
  const recommendedLineValue = Math.max(1.5, Math.min(3.5, unclampedLine)) as PaperOuLine;
  const recommendedSelection: PaperOuSelection =
    input.predictionSelection === 'OVER' ? 'UNDER' : 'OVER';

  return {
    version: PAPER_OU_OPPOSITE_LINE_VERSION,
    strategy: 'OU_OPPOSITE_PROTECTED_HALF_GOAL',
    predictionMarketType,
    predictionSelection: input.predictionSelection,
    predictionLineValue: input.predictionLineValue,
    recommendedMarketType: predictionMarketType,
    recommendedSelection,
    recommendedLineValue,
    lineShiftGoals:
      Math.abs(recommendedLineValue - input.predictionLineValue) < EPSILON ? 0 : 0.5,
    boundaryClamped:
      Math.abs(recommendedLineValue - input.predictionLineValue) < EPSILON,
    paperOnly: true,
  };
}

export function derivePaperOuTargetProbabilities(input: {
  mapping: PaperOuOppositeLineMapping;
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
  const under2_5 = Math.max(
    under1_5,
    clampProbability(input.underProbabilities.line2_5),
  );
  const under3_5 = Math.max(
    under2_5,
    clampProbability(input.underProbabilities.line3_5),
  );

  const selection = input.mapping.recommendedSelection;
  const lineValue = input.mapping.recommendedLineValue;
  let winProbability: number;
  let pushProbability: number;
  let lossProbability: number;

  if (lineValue === 1.5) {
    winProbability = selection === 'OVER' ? 1 - under1_5 : under1_5;
    pushProbability = 0;
    lossProbability = 1 - winProbability;
  } else if (lineValue === 2) {
    pushProbability = under2_5 - under1_5;
    if (selection === 'OVER') {
      winProbability = 1 - under2_5;
      lossProbability = under1_5;
    } else {
      winProbability = under1_5;
      lossProbability = 1 - under2_5;
    }
  } else if (lineValue === 2.5) {
    winProbability = selection === 'OVER' ? 1 - under2_5 : under2_5;
    pushProbability = 0;
    lossProbability = 1 - winProbability;
  } else if (lineValue === 3) {
    pushProbability = under3_5 - under2_5;
    if (selection === 'OVER') {
      winProbability = 1 - under3_5;
      lossProbability = under2_5;
    } else {
      winProbability = under2_5;
      lossProbability = 1 - under3_5;
    }
  } else {
    winProbability = selection === 'OVER' ? 1 - under3_5 : under3_5;
    pushProbability = 0;
    lossProbability = 1 - winProbability;
  }

  winProbability = clampProbability(winProbability);
  pushProbability = clampProbability(pushProbability);
  lossProbability = clampProbability(lossProbability);

  const total = winProbability + pushProbability + lossProbability;
  if (total <= 0) {
    throw new Error('Invalid O/U probability decomposition.');
  }

  winProbability /= total;
  pushProbability /= total;
  lossProbability /= total;

  const effectiveProbability =
    winProbability + pushProbability / input.decimalOdds;

  return {
    winProbability,
    pushProbability,
    lossProbability,
    effectiveProbability,
  };
}
