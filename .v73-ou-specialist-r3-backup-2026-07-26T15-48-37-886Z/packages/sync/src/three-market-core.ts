export const THREE_MARKET_CORE_VERSION = 'v7.1-three-market-core-r1';
export const THREE_MARKET_TOTAL_LINES = [1.5, 2.5, 3.5] as const;

export type ThreeMarketTotalLine = (typeof THREE_MARKET_TOTAL_LINES)[number];
export type HdaSelection = 'HOME' | 'DRAW' | 'AWAY';
export type BttsSelection = 'YES' | 'NO';
export type TotalSelection = 'OVER' | 'UNDER';
export type PredictionConfidenceGrade = 'HIGH' | 'MEDIUM' | 'LOW' | 'PASS';

export interface ThreeMarketScoreCell {
  homeGoals: number;
  awayGoals: number;
  probability: number;
}

export interface ThreeMarketProbabilityPair<K extends string> {
  probabilities: Record<K, number>;
  selected: K;
  selectedProbability: number;
  margin: number;
  confidenceScore: number;
  grade: PredictionConfidenceGrade;
}

export interface ThreeMarketTotalProjection
  extends ThreeMarketProbabilityPair<TotalSelection> {
  line: ThreeMarketTotalLine;
}

export interface ThreeMarketProjection {
  version: typeof THREE_MARKET_CORE_VERSION;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  expectedTotalGoals: number;
  rho: number;
  maximumGoals: number;
  scoreGridMass: number;
  scoreGrid: ThreeMarketScoreCell[];
  hda: ThreeMarketProbabilityPair<HdaSelection>;
  totals: Record<ThreeMarketTotalLine, ThreeMarketTotalProjection>;
  btts: ThreeMarketProbabilityPair<BttsSelection>;
  bestPrediction: {
    market: 'HDA' | 'TOTAL_GOALS' | 'BTTS';
    selection: HdaSelection | TotalSelection | BttsSelection;
    line: ThreeMarketTotalLine | null;
    probability: number;
    confidenceScore: number;
    grade: PredictionConfidenceGrade;
  } | null;
}

export interface ThreeMarketProjectionInput {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho?: number;
  maximumGoals?: number;
  dataQuality?: number;
  uncertainty?: {
    hda?: number;
    over25?: number;
    btts?: number;
  };
  directModel?: {
    hda?: Partial<Record<HdaSelection, number>>;
    over25?: number;
    bttsYes?: number;
  };
  directModelReliability?: number;
}

const EPSILON = 1e-12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite.`);
  }
}

function normalize<K extends string>(values: Record<K, number>): Record<K, number> {
  const keys = Object.keys(values) as K[];
  const total = keys.reduce((sum, key) => sum + Math.max(0, values[key] ?? 0), 0);
  if (total <= EPSILON) {
    const uniform = 1 / Math.max(1, keys.length);
    return Object.fromEntries(keys.map((key) => [key, uniform])) as Record<K, number>;
  }
  return Object.fromEntries(
    keys.map((key) => [key, Math.max(0, values[key] ?? 0) / total]),
  ) as Record<K, number>;
}

function poisson(goals: number, lambda: number): number {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return (Math.exp(-lambda) * lambda ** goals) / Math.max(1, factorial);
}

export function estimateThreeMarketRho(
  homeExpectedGoals: number,
  awayExpectedGoals: number,
): number {
  const total = homeExpectedGoals + awayExpectedGoals;
  const balance = 1 - clamp(Math.abs(homeExpectedGoals - awayExpectedGoals) / 3.5, 0, 0.8);
  return clamp(-0.09 * Math.exp(-Math.abs(total - 2.45) / 2.2) * balance, -0.12, -0.015);
}

function dixonColesTau(input: {
  homeGoals: number;
  awayGoals: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho: number;
}): number {
  if (input.homeGoals === 0 && input.awayGoals === 0) {
    return Math.max(0.05, 1 - input.homeExpectedGoals * input.awayExpectedGoals * input.rho);
  }
  if (input.homeGoals === 0 && input.awayGoals === 1) {
    return Math.max(0.05, 1 + input.homeExpectedGoals * input.rho);
  }
  if (input.homeGoals === 1 && input.awayGoals === 0) {
    return Math.max(0.05, 1 + input.awayExpectedGoals * input.rho);
  }
  if (input.homeGoals === 1 && input.awayGoals === 1) {
    return Math.max(0.05, 1 - input.rho);
  }
  return 1;
}

function logit(probability: number): number {
  const value = clamp(probability, 0.0001, 0.9999);
  return Math.log(value / (1 - value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-clamp(value, -35, 35)));
}

function blendBinaryInLogitSpace(base: number, direct: number | undefined, weight: number): number {
  if (direct === undefined || !Number.isFinite(direct)) return clamp(base, 0.001, 0.999);
  const boundedWeight = clamp(weight, 0, 0.8);
  return clamp(
    sigmoid(logit(base) * (1 - boundedWeight) + logit(direct) * boundedWeight),
    0.001,
    0.999,
  );
}

function blendMulticlass<K extends string>(
  base: Record<K, number>,
  direct: Partial<Record<K, number>> | undefined,
  weight: number,
): Record<K, number> {
  if (!direct) return normalize(base);
  const keys = Object.keys(base) as K[];
  const usable = keys.every((key) => Number.isFinite(direct[key]));
  if (!usable) return normalize(base);
  const boundedWeight = clamp(weight, 0, 0.8);
  const blended = {} as Record<K, number>;
  for (const key of keys) {
    blended[key] =
      Math.max(EPSILON, base[key] ?? 0) ** (1 - boundedWeight) *
      Math.max(EPSILON, Number(direct[key])) ** boundedWeight;
  }
  return normalize(blended);
}

function topSelection<K extends string>(probabilities: Record<K, number>): {
  selected: K;
  selectedProbability: number;
  margin: number;
} {
  const sorted = (Object.entries(probabilities) as Array<[K, number]>).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const first = sorted[0]!;
  const second = sorted[1]?.[1] ?? 0;
  return {
    selected: first[0],
    selectedProbability: first[1],
    margin: Math.max(0, first[1] - second),
  };
}

function confidenceGrade(score: number): PredictionConfidenceGrade {
  if (score >= 0.82) return 'HIGH';
  if (score >= 0.7) return 'MEDIUM';
  if (score >= 0.6) return 'LOW';
  return 'PASS';
}

function confidenceScore(input: {
  probability: number;
  margin: number;
  dataQuality: number;
  uncertainty: number;
  classCount: 2 | 3;
}): number {
  const classFloor = input.classCount === 3 ? 1 / 3 : 0.5;
  const probabilityStrength = clamp(
    (input.probability - classFloor) / Math.max(0.0001, 1 - classFloor),
    0,
    1,
  );
  const marginScale = input.classCount === 3 ? 0.35 : 0.5;
  const separation = clamp(input.margin / marginScale, 0, 1);
  const uncertaintyPenalty = clamp(input.uncertainty / 0.2, 0, 1);
  return clamp(
    0.36 * probabilityStrength +
      0.29 * separation +
      0.25 * input.dataQuality +
      0.1 * (1 - uncertaintyPenalty),
    0,
    1,
  );
}

function makeProbabilityPair<K extends string>(input: {
  probabilities: Record<K, number>;
  dataQuality: number;
  uncertainty: number;
  classCount: 2 | 3;
}): ThreeMarketProbabilityPair<K> {
  const probabilities = normalize(input.probabilities);
  const top = topSelection(probabilities);
  const score = confidenceScore({
    probability: top.selectedProbability,
    margin: top.margin,
    dataQuality: input.dataQuality,
    uncertainty: input.uncertainty,
    classCount: input.classCount,
  });
  return {
    probabilities,
    ...top,
    confidenceScore: score,
    grade: confidenceGrade(score),
  };
}

function buildScoreGrid(input: {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho: number;
  maximumGoals: number;
}): { scoreGrid: ThreeMarketScoreCell[]; mass: number } {
  const scoreGrid: ThreeMarketScoreCell[] = [];
  let mass = 0;
  for (let homeGoals = 0; homeGoals <= input.maximumGoals; homeGoals += 1) {
    const homeProbability = poisson(homeGoals, input.homeExpectedGoals);
    for (let awayGoals = 0; awayGoals <= input.maximumGoals; awayGoals += 1) {
      const rawProbability =
        homeProbability *
        poisson(awayGoals, input.awayExpectedGoals) *
        dixonColesTau({
          homeGoals,
          awayGoals,
          homeExpectedGoals: input.homeExpectedGoals,
          awayExpectedGoals: input.awayExpectedGoals,
          rho: input.rho,
        });
      mass += rawProbability;
      scoreGrid.push({ homeGoals, awayGoals, probability: rawProbability });
    }
  }
  const normalization = Math.max(EPSILON, mass);
  return {
    mass,
    scoreGrid: scoreGrid.map((cell) => ({
      ...cell,
      probability: cell.probability / normalization,
    })),
  };
}

function overProbability(scoreGrid: ThreeMarketScoreCell[], line: ThreeMarketTotalLine): number {
  return clamp(
    scoreGrid.reduce(
      (sum, cell) => sum + (cell.homeGoals + cell.awayGoals > line ? cell.probability : 0),
      0,
    ),
    0,
    1,
  );
}

function scoreGridMarkets(scoreGrid: ThreeMarketScoreCell[]): {
  hda: Record<HdaSelection, number>;
  btts: Record<BttsSelection, number>;
} {
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  for (const cell of scoreGrid) {
    if (cell.homeGoals > cell.awayGoals) home += cell.probability;
    else if (cell.homeGoals < cell.awayGoals) away += cell.probability;
    else draw += cell.probability;
    if (cell.homeGoals > 0 && cell.awayGoals > 0) bttsYes += cell.probability;
  }
  return {
    hda: normalize({ HOME: home, DRAW: draw, AWAY: away }),
    btts: normalize({ YES: bttsYes, NO: Math.max(0, 1 - bttsYes) }),
  };
}

function directModelWeight(input: ThreeMarketProjectionInput): number {
  const reliability = clamp(input.directModelReliability ?? 0.65, 0, 1);
  const quality = clamp(input.dataQuality ?? 0.65, 0, 1);
  return clamp(0.58 * reliability * (0.55 + 0.45 * quality), 0.08, 0.58);
}

function calibrateExpectedGoalsToOver25(input: {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho: number;
  maximumGoals: number;
  targetOver25: number | undefined;
  directWeight: number;
}): { homeExpectedGoals: number; awayExpectedGoals: number } {
  if (input.targetOver25 === undefined || !Number.isFinite(input.targetOver25)) {
    return {
      homeExpectedGoals: input.homeExpectedGoals,
      awayExpectedGoals: input.awayExpectedGoals,
    };
  }
  const baseGrid = buildScoreGrid(input).scoreGrid;
  const baseOver25 = overProbability(baseGrid, 2.5);
  const target = blendBinaryInLogitSpace(baseOver25, input.targetOver25, input.directWeight);
  const ratio = input.homeExpectedGoals / Math.max(EPSILON, input.awayExpectedGoals);
  let lower = 0.72;
  let upper = 1.32;
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const scale = (lower + upper) / 2;
    const total = (input.homeExpectedGoals + input.awayExpectedGoals) * scale;
    const away = total / (1 + ratio);
    const home = total - away;
    const grid = buildScoreGrid({
      homeExpectedGoals: home,
      awayExpectedGoals: away,
      rho: input.rho,
      maximumGoals: input.maximumGoals,
    }).scoreGrid;
    const probability = overProbability(grid, 2.5);
    if (probability < target) lower = scale;
    else upper = scale;
  }
  const scale = (lower + upper) / 2;
  return {
    homeExpectedGoals: clamp(input.homeExpectedGoals * scale, 0.05, 6),
    awayExpectedGoals: clamp(input.awayExpectedGoals * scale, 0.05, 6),
  };
}

export function buildThreeMarketProjection(
  input: ThreeMarketProjectionInput,
): ThreeMarketProjection {
  assertFinite(input.homeExpectedGoals, 'homeExpectedGoals');
  assertFinite(input.awayExpectedGoals, 'awayExpectedGoals');
  if (input.homeExpectedGoals < 0 || input.awayExpectedGoals < 0) {
    throw new RangeError('Expected goals must be non-negative.');
  }
  const safeHome = clamp(input.homeExpectedGoals, 0.05, 6);
  const safeAway = clamp(input.awayExpectedGoals, 0.05, 6);
  const maximumGoals = Math.max(7, Math.min(14, Math.floor(input.maximumGoals ?? 10)));
  const rho = clamp(
    input.rho ?? estimateThreeMarketRho(safeHome, safeAway),
    -0.2,
    0.2,
  );
  const dataQuality = clamp(input.dataQuality ?? 0.65, 0, 1);
  const modelWeight = directModelWeight(input);
  const calibratedGoals = calibrateExpectedGoalsToOver25({
    homeExpectedGoals: safeHome,
    awayExpectedGoals: safeAway,
    rho,
    maximumGoals,
    targetOver25: input.directModel?.over25,
    directWeight: modelWeight,
  });
  const grid = buildScoreGrid({
    homeExpectedGoals: calibratedGoals.homeExpectedGoals,
    awayExpectedGoals: calibratedGoals.awayExpectedGoals,
    rho,
    maximumGoals,
  });
  const raw = scoreGridMarkets(grid.scoreGrid);
  const hdaProbabilities = blendMulticlass(raw.hda, input.directModel?.hda, modelWeight);
  const bttsYes = blendBinaryInLogitSpace(
    raw.btts.YES,
    input.directModel?.bttsYes,
    modelWeight,
  );
  const hda = makeProbabilityPair({
    probabilities: hdaProbabilities,
    dataQuality,
    uncertainty: clamp(input.uncertainty?.hda ?? 0, 0, 0.25),
    classCount: 3,
  });
  const btts = makeProbabilityPair({
    probabilities: { YES: bttsYes, NO: 1 - bttsYes },
    dataQuality,
    uncertainty: clamp(input.uncertainty?.btts ?? 0, 0, 0.25),
    classCount: 2,
  });

  const totals = Object.fromEntries(
    THREE_MARKET_TOTAL_LINES.map((line) => {
      const over = overProbability(grid.scoreGrid, line);
      const pair = makeProbabilityPair({
        probabilities: { OVER: over, UNDER: 1 - over },
        dataQuality,
        uncertainty:
          line === 2.5 ? clamp(input.uncertainty?.over25 ?? 0, 0, 0.25) : 0,
        classCount: 2,
      });
      return [line, { line, ...pair }];
    }),
  ) as Record<ThreeMarketTotalLine, ThreeMarketTotalProjection>;

  const candidates = [
    {
      market: 'HDA' as const,
      selection: hda.selected,
      line: null,
      probability: hda.selectedProbability,
      confidenceScore: hda.confidenceScore,
      grade: hda.grade,
    },
    ...THREE_MARKET_TOTAL_LINES.map((line) => ({
      market: 'TOTAL_GOALS' as const,
      selection: totals[line].selected,
      line,
      probability: totals[line].selectedProbability,
      confidenceScore: totals[line].confidenceScore,
      grade: totals[line].grade,
    })),
    {
      market: 'BTTS' as const,
      selection: btts.selected,
      line: null,
      probability: btts.selectedProbability,
      confidenceScore: btts.confidenceScore,
      grade: btts.grade,
    },
  ].sort(
    (left, right) =>
      right.confidenceScore - left.confidenceScore ||
      right.probability - left.probability,
  );
  const best =
    candidates.find(
      (candidate) => candidate.grade === 'HIGH' || candidate.grade === 'MEDIUM',
    ) ?? null;

  return {
    version: THREE_MARKET_CORE_VERSION,
    homeExpectedGoals: calibratedGoals.homeExpectedGoals,
    awayExpectedGoals: calibratedGoals.awayExpectedGoals,
    expectedTotalGoals: calibratedGoals.homeExpectedGoals + calibratedGoals.awayExpectedGoals,
    rho,
    maximumGoals,
    scoreGridMass: grid.mass,
    scoreGrid: grid.scoreGrid,
    hda,
    totals,
    btts,
    bestPrediction: best,
  };
}
