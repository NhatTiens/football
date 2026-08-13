import {
  SCIENTIFIC_BEST_BET_POLICY_VERSION,
  type ScientificBestBetMarket,
} from './scientific-best-bet-policy-contract.js';
import type { PaperBetCandidateInput } from './paper-bet-ledger-core.js';
import {
  derivePaperOuTargetProbabilities,
  isPaperOuMarketType,
  isPaperOuSourceLine,
  mapPaperOuPredictionToModelSelection,
  type PaperOuSourceLine,
} from './paper-ou-model-selection-core.js';
export const LIVE_PAPER_BET_ENGINE_VERSION =
  'v7.0-ou-direct-model-selection-v1';

export const LIVE_PAPER_BET_HORIZONS = [90, 30, 5] as const;

export type DefaultLivePaperBetHorizon = (typeof LIVE_PAPER_BET_HORIZONS)[number];
export type LivePaperBetHorizon = number;

export type LiveMarketType =
  'MATCH_WINNER' | 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5' | 'BTTS';

export type LiveSelection = 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';

export interface LiveOddsRow {
  id: number;
  providerFixtureId: number;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  bookmakerId: number;
  bookmakerName: string;
  marketType: 'MATCH_WINNER' | 'TOTAL_GOALS' | 'BTTS';
  selection: LiveSelection;
  lineValue: number | null;
  decimalOdds: number;
}

export interface LiveModelProbabilities {
  MATCH_WINNER: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  TOTAL_GOALS_1_5: Record<'OVER' | 'UNDER', number>;
  TOTAL_GOALS_2_5: Record<'OVER' | 'UNDER', number>;
  TOTAL_GOALS_3_5: Record<'OVER' | 'UNDER', number>;
  BTTS: Record<'YES' | 'NO', number>;
}

export interface LiveReliabilityGate {
  market: LiveMarketType;
  status: string;
  eligible: boolean;
}

interface MarketDefinition {
  market: LiveMarketType;
  providerMarket: LiveOddsRow['marketType'];
  lineValue: number | null;
  selections: LiveSelection[];
}

const MARKET_DEFINITIONS: MarketDefinition[] = [
  {
    market: 'MATCH_WINNER',
    providerMarket: 'MATCH_WINNER',
    lineValue: null,
    selections: ['HOME', 'DRAW', 'AWAY'],
  },
  {
    market: 'TOTAL_GOALS_1_5',
    providerMarket: 'TOTAL_GOALS',
    lineValue: 1.5,
    selections: ['OVER', 'UNDER'],
  },
  {
    market: 'TOTAL_GOALS_2_5',
    providerMarket: 'TOTAL_GOALS',
    lineValue: 2.5,
    selections: ['OVER', 'UNDER'],
  },
  {
    market: 'TOTAL_GOALS_3_5',
    providerMarket: 'TOTAL_GOALS',
    lineValue: 3.5,
    selections: ['OVER', 'UNDER'],
  },
  {
    market: 'BTTS',
    providerMarket: 'BTTS',
    lineValue: null,
    selections: ['YES', 'NO'],
  },
];

const EPSILON = 1e-12;

function lineKey(lineValue: number | null): string {
  return lineValue == null ? 'NONE' : lineValue.toFixed(1);
}

function rowFreshness(row: LiveOddsRow): number {
  return row.sourceUpdatedAt?.getTime() ?? row.observedAt.getTime();
}

function sameLine(left: number | null, right: number | null): boolean {
  if (left == null || right == null) {
    return left == null && right == null;
  }

  return Math.abs(left - right) < EPSILON;
}

function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a probability in [0, 1].`);
  }
}

function modelProbability(
  probabilities: LiveModelProbabilities,
  market: LiveMarketType,
  selection: LiveSelection,
): number {
  const marketValues = probabilities[market] as Record<string, number>;
  const value = marketValues[selection];

  if (value == null) {
    throw new Error(`Missing model probability for ${market}:${selection}.`);
  }

  assertProbability(value, `${market}:${selection}`);

  return value;
}

export interface ParseLivePaperBetHorizonsOptions {
  allowFlexible?: boolean;
  minimumMinutes?: number;
  maximumMinutes?: number;
}

export function parseLivePaperBetHorizons(
  value: string | undefined,
  options: ParseLivePaperBetHorizonsOptions = {},
): LivePaperBetHorizon[] {
  if (value == null || value.trim() === '') {
    return [...LIVE_PAPER_BET_HORIZONS];
  }

  const parsed = value.split(',').map((item) => Number(item.trim()));

  if (!options.allowFlexible) {
    if (
      parsed.some((item) => !LIVE_PAPER_BET_HORIZONS.includes(item as DefaultLivePaperBetHorizon))
    ) {
      throw new Error(
        'PAPER_BET_HORIZONS_MINUTES supports only 90,30,5 unless flexible research mode is explicitly enabled.',
      );
    }

    return [...new Set(parsed)].sort((left, right) => right - left);
  }

  const minimumMinutes = options.minimumMinutes ?? 1;
  const maximumMinutes = options.maximumMinutes ?? 1440;

  if (
    parsed.length === 0 ||
    parsed.some((item) => !Number.isInteger(item) || item < minimumMinutes || item > maximumMinutes)
  ) {
    throw new Error(
      `Flexible PAPER_BET_HORIZONS_MINUTES must contain integers in ${minimumMinutes}..${maximumMinutes}.`,
    );
  }

  return [...new Set(parsed)].sort((left, right) => right - left);
}

export function dueLivePaperBetHorizons(input: {
  now: Date;
  kickoffAt: Date;
  horizons: LivePaperBetHorizon[];
  toleranceMinutes: number;
}): LivePaperBetHorizon[] {
  if (!Number.isFinite(input.now.getTime()) || !Number.isFinite(input.kickoffAt.getTime())) {
    throw new TypeError('now and kickoffAt must be valid Dates.');
  }

  if (!Number.isFinite(input.toleranceMinutes) || input.toleranceMinutes < 0) {
    throw new RangeError('toleranceMinutes must be finite and non-negative.');
  }

  const minutesToKickoff = (input.kickoffAt.getTime() - input.now.getTime()) / 60_000;

  if (minutesToKickoff <= 0) {
    return [];
  }

  return input.horizons.filter(
    (horizon) => Math.abs(minutesToKickoff - horizon) <= input.toleranceMinutes,
  );
}

export function selectLatestLiveOddsRows(rows: LiveOddsRow[]): LiveOddsRow[] {
  const ordered = [...rows].sort(
    (left, right) =>
      rowFreshness(right) - rowFreshness(left) ||
      right.observedAt.getTime() - left.observedAt.getTime() ||
      right.id - left.id,
  );
  const result = new Map<string, LiveOddsRow>();

  for (const row of ordered) {
    const key = [row.bookmakerId, row.marketType, lineKey(row.lineValue), row.selection].join(':');

    if (!result.has(key)) {
      result.set(key, row);
    }
  }

  return [...result.values()];
}

function coherentLatestRowsForDefinition(
  rows: LiveOddsRow[],
  definition: MarketDefinition,
): LiveOddsRow[] {
  const relevant = rows.filter(
    (row) =>
      row.marketType === definition.providerMarket &&
      sameLine(row.lineValue, definition.lineValue) &&
      definition.selections.includes(row.selection),
  );
  const states = new Map<string, LiveOddsRow[]>();

  for (const row of relevant) {
    const sourceTime = row.sourceUpdatedAt?.toISOString() ?? 'NO_SOURCE_TIME';
    const key = [row.bookmakerId, sourceTime, row.observedAt.toISOString()].join(':');
    const bucket = states.get(key) ?? [];

    bucket.push(row);
    states.set(key, bucket);
  }

  const latestComplete = new Map<
    number,
    {
      freshness: number;
      observedAt: number;
      rows: LiveOddsRow[];
    }
  >();

  for (const stateRows of states.values()) {
    const selections = new Set(stateRows.map((row) => row.selection));

    if (definition.selections.some((selection) => !selections.has(selection))) {
      continue;
    }

    const representative = stateRows[0];

    if (!representative) {
      continue;
    }

    const candidate = {
      freshness: rowFreshness(representative),
      observedAt: representative.observedAt.getTime(),
      rows: stateRows,
    };
    const existing = latestComplete.get(representative.bookmakerId);

    if (
      existing == null ||
      candidate.freshness > existing.freshness ||
      (candidate.freshness === existing.freshness && candidate.observedAt > existing.observedAt)
    ) {
      latestComplete.set(representative.bookmakerId, candidate);
    }
  }

  return [...latestComplete.values()].flatMap((state) => state.rows);
}

function normalizedNoVig(
  rows: LiveOddsRow[],
  selections: LiveSelection[],
): Record<string, number> | null {
  const bySelection = new Map<string, LiveOddsRow>(rows.map((row) => [row.selection, row]));

  if (selections.some((selection) => !bySelection.has(selection))) {
    return null;
  }

  const inverse = Object.fromEntries(
    selections.map((selection) => {
      const odds = bySelection.get(selection)!.decimalOdds;

      if (!Number.isFinite(odds) || odds <= 1) {
        throw new RangeError(`Invalid decimal odds for ${selection}.`);
      }

      return [selection, 1 / odds];
    }),
  );
  const total = selections.reduce((sum, selection) => sum + Number(inverse[selection]), 0);

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return Object.fromEntries(
    selections.map((selection) => [selection, Number(inverse[selection]) / total]),
  );
}

function consensusForDefinition(
  rows: LiveOddsRow[],
  definition: MarketDefinition,
): {
  fair: Record<string, number>;
  completeBookmakers: number;
} | null {
  const relevant = coherentLatestRowsForDefinition(rows, definition);
  const byBookmaker = new Map<number, LiveOddsRow[]>();

  for (const row of relevant) {
    const bucket = byBookmaker.get(row.bookmakerId) ?? [];

    bucket.push(row);
    byBookmaker.set(row.bookmakerId, bucket);
  }

  const bookmakerFair = [...byBookmaker.values()]
    .map((bookmakerRows) => normalizedNoVig(bookmakerRows, definition.selections))
    .filter((value): value is Record<string, number> => value != null);

  if (bookmakerFair.length === 0) {
    return null;
  }

  const fair = Object.fromEntries(
    definition.selections.map((selection) => [
      selection,
      bookmakerFair.reduce((sum, item) => sum + Number(item[selection]), 0) / bookmakerFair.length,
    ]),
  );

  return {
    fair,
    completeBookmakers: bookmakerFair.length,
  };
}

function bestOddsForSelection(
  rows: LiveOddsRow[],
  definition: MarketDefinition,
  selection: LiveSelection,
): LiveOddsRow | null {
  const candidates = coherentLatestRowsForDefinition(rows, definition).filter(
    (row) => row.selection === selection && Number.isFinite(row.decimalOdds) && row.decimalOdds > 1,
  );

  candidates.sort(
    (left, right) =>
      right.decimalOdds - left.decimalOdds ||
      rowFreshness(right) - rowFreshness(left) ||
      left.bookmakerId - right.bookmakerId,
  );

  return candidates[0] ?? null;
}

function toPolicyMarket(market: LiveMarketType): ScientificBestBetMarket {
  return market;
}

function isOuMarketDefinition(
  definition: MarketDefinition,
): definition is MarketDefinition & {
  market: 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5';
  lineValue: PaperOuSourceLine;
} {
  return (
    isPaperOuMarketType(definition.market) &&
    isPaperOuSourceLine(definition.lineValue)
  );
}

export function buildLivePaperBetCandidates(input: {
  providerFixtureId: number;
  oddsRows: LiveOddsRow[];
  modelProbabilities: LiveModelProbabilities;
  reliability: Record<LiveMarketType, LiveReliabilityGate>;
}): {
  candidates: PaperBetCandidateInput[];
  marketCoverage: Array<{
    market: LiveMarketType;
    completeBookmakers: number;
    candidates: number;
  }>;
} {
  const latest = input.oddsRows;
  const candidates: PaperBetCandidateInput[] = [];
  const marketCoverage: Array<{
    market: LiveMarketType;
    completeBookmakers: number;
    candidates: number;
  }> = [];
  const underProbabilities = {
    line1_5: input.modelProbabilities.TOTAL_GOALS_1_5.UNDER,
    line2_5: input.modelProbabilities.TOTAL_GOALS_2_5.UNDER,
    line3_5: input.modelProbabilities.TOTAL_GOALS_3_5.UNDER,
  };

  for (const definition of MARKET_DEFINITIONS) {
    if (isOuMarketDefinition(definition)) {
      let candidateCount = 0;
      let completeBookmakers = 0;

      // Không đọc xác suất O/U khi không có odds đúng line mô hình đang đánh giá.
      // Benchmark HDA-only cố ý dùng NaN cho các market không được benchmark.
      const hasRelevantOuOdds = latest.some(
        (row) =>
          row.marketType === definition.providerMarket &&
          sameLine(row.lineValue, definition.lineValue),
      );

      if (!hasRelevantOuOdds) {
        marketCoverage.push({
          market: definition.market,
          completeBookmakers: 0,
          candidates: 0,
        });
        continue;
      }

      const overProbability = modelProbability(
        input.modelProbabilities,
        definition.market,
        'OVER',
      );
      const underProbability = modelProbability(
        input.modelProbabilities,
        definition.market,
        'UNDER',
      );

      const sourceSelection: 'OVER' | 'UNDER' | null =
        overProbability > underProbability
          ? 'OVER'
          : underProbability > overProbability
            ? 'UNDER'
            : null;

      // Chỉ tạo PAPER candidate khi mô hình nghiêng rõ về một cửa.
      // Nếu xác suất hai cửa bằng nhau thì không tự ý lựa chọn.
      if (sourceSelection) {
        const mapping = mapPaperOuPredictionToModelSelection({
          predictionSelection: sourceSelection,
          predictionLineValue: definition.lineValue,
        });

        const targetDefinition: MarketDefinition = {
          ...definition,
          lineValue: mapping.recommendedLineValue,
          selections: ['OVER', 'UNDER'],
        };

        const targetConsensus = consensusForDefinition(
          latest,
          targetDefinition,
        );

        if (targetConsensus) {
          completeBookmakers = targetConsensus.completeBookmakers;

          const bestOdds = bestOddsForSelection(
            latest,
            targetDefinition,
            mapping.recommendedSelection,
          );

          const fair =
            targetConsensus.fair[mapping.recommendedSelection];

          if (bestOdds && fair != null) {
            const sourceProbability =
              sourceSelection === 'OVER'
                ? overProbability
                : underProbability;

            const targetProbabilities =
              derivePaperOuTargetProbabilities({
                mapping,
                underProbabilities,
                decimalOdds: bestOdds.decimalOdds,
              });

            const gate = input.reliability[definition.market];

            candidates.push({
              providerFixtureId: input.providerFixtureId,
              marketType: toPolicyMarket(definition.market),
              selection: mapping.recommendedSelection,
              lineValue: mapping.recommendedLineValue,
              decimalOdds: bestOdds.decimalOdds,
              bookmakerId: bestOdds.bookmakerId,
              bookmakerName: bestOdds.bookmakerName,
              modelProbability:
                targetProbabilities.effectiveProbability,
              fairMarketProbability: fair,
              reliabilityStatus: gate.status,
              reliabilityEligible: gate.eligible,
              sourceOddsSnapshotId: bestOdds.id,
              sourceOddsUpdatedAt: bestOdds.sourceUpdatedAt,
              sourceOddsObservedAt: bestOdds.observedAt,
              ouOppositeLineStrategy: {
                ...mapping,
                predictionProbability: sourceProbability,
                targetWinProbability:
                  targetProbabilities.winProbability,
                targetPushProbability:
                  targetProbabilities.pushProbability,
                targetLossProbability:
                  targetProbabilities.lossProbability,
                targetEffectiveProbability:
                  targetProbabilities.effectiveProbability,
              },
            });

            candidateCount = 1;
          }
        }
      }

      marketCoverage.push({
        market: definition.market,
        completeBookmakers,
        candidates: candidateCount,
      });
      continue;
    }

    const consensus = consensusForDefinition(latest, definition);

    if (!consensus) {
      marketCoverage.push({
        market: definition.market,
        completeBookmakers: 0,
        candidates: 0,
      });
      continue;
    }

    let candidateCount = 0;

    for (const selection of definition.selections) {
      const bestOdds = bestOddsForSelection(latest, definition, selection);

      if (!bestOdds) {
        continue;
      }
      const fair = consensus.fair[selection];

      if (fair == null) {
        continue;
      }

      const gate = input.reliability[definition.market];
      const probability = modelProbability(
        input.modelProbabilities,
        definition.market,
        selection,
      );

      candidates.push({
        providerFixtureId: input.providerFixtureId,
        marketType: toPolicyMarket(definition.market),
        selection,
        lineValue: definition.lineValue,
        decimalOdds: bestOdds.decimalOdds,
        bookmakerId: bestOdds.bookmakerId,
        bookmakerName: bestOdds.bookmakerName,
        modelProbability: probability,
        fairMarketProbability: fair,
        reliabilityStatus: gate.status,
        reliabilityEligible: gate.eligible,
        sourceOddsSnapshotId: bestOdds.id,
        sourceOddsUpdatedAt: bestOdds.sourceUpdatedAt,
        sourceOddsObservedAt: bestOdds.observedAt,
      });
      candidateCount += 1;
    }

    marketCoverage.push({
      market: definition.market,
      completeBookmakers: consensus.completeBookmakers,
      candidates: candidateCount,
    });
  }

  return {
    candidates,
    marketCoverage,
  };
}

export function livePaperBetPolicyVersion(): string {
  return SCIENTIFIC_BEST_BET_POLICY_VERSION;
}
