export const PAPER_OU_OPPOSITE_LINE_VERSION =
  'v7.0-r4.10.2.11.6-ou-opposite-protected-line-history-v2';

export const PAPER_OU_SUPPORTED_LINES = [1.5, 2.5, 3.5] as const;

export type PaperOuLine = (typeof PAPER_OU_SUPPORTED_LINES)[number];
export type PaperOuSelection = 'OVER' | 'UNDER';
export type PaperOuMarketType = 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5';

export interface PaperOuOppositeLineMapping {
  version: typeof PAPER_OU_OPPOSITE_LINE_VERSION;
  strategy: 'OU_OPPOSITE_PROTECTED_LINE';
  predictionMarketType: PaperOuMarketType;
  predictionSelection: PaperOuSelection;
  predictionLineValue: PaperOuLine;
  recommendedMarketType: PaperOuMarketType;
  recommendedSelection: PaperOuSelection;
  recommendedLineValue: PaperOuLine;
  lineShiftGoals: 0 | 1;
  boundaryClamped: boolean;
  paperOnly: true;
}

export interface PaperOuOppositeLineStrategyAudit extends PaperOuOppositeLineMapping {
  predictionProbability: number;
}

export function isPaperOuMarketType(value: string): value is PaperOuMarketType {
  return value === 'TOTAL_GOALS_1_5' || value === 'TOTAL_GOALS_2_5' || value === 'TOTAL_GOALS_3_5';
}

export function paperOuMarketForLine(lineValue: PaperOuLine): PaperOuMarketType {
  if (lineValue === 1.5) return 'TOTAL_GOALS_1_5';
  if (lineValue === 2.5) return 'TOTAL_GOALS_2_5';
  return 'TOTAL_GOALS_3_5';
}

export function paperOuLineForMarket(marketType: PaperOuMarketType): PaperOuLine {
  if (marketType === 'TOTAL_GOALS_1_5') return 1.5;
  if (marketType === 'TOTAL_GOALS_2_5') return 2.5;
  return 3.5;
}

const PAPER_OU_RULE = {
  'OVER:1.5': { recommendedSelection: 'UNDER', recommendedLineValue: 2.5 },
  'OVER:2.5': { recommendedSelection: 'UNDER', recommendedLineValue: 3.5 },
  'OVER:3.5': { recommendedSelection: 'UNDER', recommendedLineValue: 3.5 },
  'UNDER:1.5': { recommendedSelection: 'OVER', recommendedLineValue: 1.5 },
  'UNDER:2.5': { recommendedSelection: 'OVER', recommendedLineValue: 1.5 },
  'UNDER:3.5': { recommendedSelection: 'OVER', recommendedLineValue: 2.5 },
} as const satisfies Record<`${PaperOuSelection}:${PaperOuLine}`, {
  recommendedSelection: PaperOuSelection;
  recommendedLineValue: PaperOuLine;
}>;

export function mapPaperOuPredictionToOppositeLine(input: {
  predictionSelection: PaperOuSelection;
  predictionLineValue: PaperOuLine;
}): PaperOuOppositeLineMapping {
  const predictionMarketType = paperOuMarketForLine(input.predictionLineValue);
  const rule = PAPER_OU_RULE[`${input.predictionSelection}:${input.predictionLineValue}`];

  if (rule == null) {
    throw new Error(
      `Unsupported O/U paper mapping: ${input.predictionSelection} ${input.predictionLineValue}`,
    );
  }

  return {
    version: PAPER_OU_OPPOSITE_LINE_VERSION,
    strategy: 'OU_OPPOSITE_PROTECTED_LINE',
    predictionMarketType,
    predictionSelection: input.predictionSelection,
    predictionLineValue: input.predictionLineValue,
    recommendedMarketType: paperOuMarketForLine(rule.recommendedLineValue),
    recommendedSelection: rule.recommendedSelection,
    recommendedLineValue: rule.recommendedLineValue,
    lineShiftGoals: rule.recommendedLineValue === input.predictionLineValue ? 0 : 1,
    boundaryClamped: rule.recommendedLineValue === input.predictionLineValue,
    paperOnly: true,
  };
}
