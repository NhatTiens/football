import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export const BAYESIAN_PREDICTIVE_MARKETS_VERSION =
  'v8.0-stage3-bayesian-predictive-markets-v1';
export const BAYESIAN_TOTAL_GOAL_LINES = [1.5, 2, 2.5, 3, 3.5] as const;

export interface ProbabilityWithUncertainty {
  probability: number;
  standardDeviation: number;
  lower90: number;
  upper90: number;
}

export interface ThreeWayMarketProbability {
  WIN: number;
  PUSH: number;
  LOSS: number;
  uncertainty: {
    WIN: ProbabilityWithUncertainty;
    PUSH: ProbabilityWithUncertainty;
    LOSS: ProbabilityWithUncertainty;
  };
}

export interface BayesianPredictiveMarkets {
  version: string;
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  maximumGoals: number;
  homeGoalDistribution: number[];
  awayGoalDistribution: number[];
  scoreMatrix: number[][];
  hda: {
    HOME: number;
    DRAW: number;
    AWAY: number;
    uncertainty: {
      HOME: ProbabilityWithUncertainty;
      DRAW: ProbabilityWithUncertainty;
      AWAY: ProbabilityWithUncertainty;
    };
  };
  btts: {
    YES: number;
    NO: number;
    uncertainty: {
      YES: ProbabilityWithUncertainty;
      NO: ProbabilityWithUncertainty;
    };
  };
  totalGoals: Array<{
    line: number;
    OVER: ThreeWayMarketProbability;
    UNDER: ThreeWayMarketProbability;
  }>;
  modelVersion: string;
  sourceTeamStrengthVersion: string;
  sourceTeamStrengthHash: string;
}

interface ScenarioMarketValues {
  weight: number;
  homeGoals: number[];
  awayGoals: number[];
  scoreMatrix: number[][];
  hda: { HOME: number; DRAW: number; AWAY: number };
  btts: { YES: number; NO: number };
  totals: Array<{
    line: number;
    over: { WIN: number; PUSH: number; LOSS: number };
    under: { WIN: number; PUSH: number; LOSS: number };
  }>;
}

const SCENARIO_NODES = [-2, -1, 0, 1, 2] as const;
const SCENARIO_WEIGHTS = [
  0.05448868454964294,
  0.24420134200323335,
  0.40261994689424746,
  0.24420134200323335,
  0.05448868454964294,
] as const;
const EPSILON = 1e-12;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize(values: number[]): number[] {
  const safe = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) return safe.map(() => 1 / Math.max(1, safe.length));
  return safe.map((value) => value / total);
}

function poissonDistribution(lambda: number, maximumGoals: number): number[] {
  const probabilities = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximumGoals; goals += 1) {
    probabilities.push((probabilities[goals - 1]! * lambda) / goals);
  }
  return normalize(probabilities);
}

function scoreMatrix(home: number[], away: number[]): number[][] {
  const matrix = home.map((homeProbability) =>
    away.map((awayProbability) => homeProbability * awayProbability),
  );
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  return matrix.map((row) => row.map((value) => value / Math.max(EPSILON, total)));
}

function baseScenario(lambdaHome: number, lambdaAway: number, maximumGoals: number): ScenarioMarketValues {
  const homeGoals = poissonDistribution(lambdaHome, maximumGoals);
  const awayGoals = poissonDistribution(lambdaAway, maximumGoals);
  const matrix = scoreMatrix(homeGoals, awayGoals);
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  const totalDistribution = Array.from({ length: maximumGoals * 2 + 1 }, () => 0);

  for (let homeScore = 0; homeScore < matrix.length; homeScore += 1) {
    for (let awayScore = 0; awayScore < matrix[homeScore]!.length; awayScore += 1) {
      const probability = matrix[homeScore]![awayScore]!;
      if (homeScore > awayScore) home += probability;
      else if (homeScore === awayScore) draw += probability;
      else away += probability;
      if (homeScore > 0 && awayScore > 0) bttsYes += probability;
      const totalGoals = homeScore + awayScore;
      totalDistribution[totalGoals] = (totalDistribution[totalGoals] ?? 0) + probability;
    }
  }

  const totals = BAYESIAN_TOTAL_GOAL_LINES.map((line) => {
    let overWin = 0;
    let push = 0;
    let overLoss = 0;
    for (let goals = 0; goals < totalDistribution.length; goals += 1) {
      const probability = totalDistribution[goals]!;
      if (goals > line) overWin += probability;
      else if (Number.isInteger(line) && goals === line) push += probability;
      else overLoss += probability;
    }
    return {
      line,
      over: { WIN: overWin, PUSH: push, LOSS: overLoss },
      under: { WIN: overLoss, PUSH: push, LOSS: overWin },
    };
  });

  return {
    weight: 1,
    homeGoals,
    awayGoals,
    scoreMatrix: matrix,
    hda: { HOME: home, DRAW: draw, AWAY: away },
    btts: { YES: bttsYes, NO: 1 - bttsYes },
    totals,
  };
}

function lambdaScenarios(mean: number, varianceLog: number): Array<{ value: number; weight: number }> {
  const deviation = Math.sqrt(Math.max(0, varianceLog));
  const raw = SCENARIO_NODES.map((node, index) => ({
    value: mean * Math.exp(node * deviation - varianceLog / 2),
    weight: SCENARIO_WEIGHTS[index]!,
  }));
  const weightedMean = raw.reduce((sum, row) => sum + row.value * row.weight, 0);
  const scale = mean / Math.max(EPSILON, weightedMean);
  return raw.map((row) => ({ value: clamp(row.value * scale, 0.01, 10), weight: row.weight }));
}

function uncertainty(
  scenarios: ScenarioMarketValues[],
  selector: (scenario: ScenarioMarketValues) => number,
): ProbabilityWithUncertainty {
  const probability = scenarios.reduce(
    (sum, scenario) => sum + scenario.weight * selector(scenario),
    0,
  );
  const variance = scenarios.reduce(
    (sum, scenario) =>
      sum + scenario.weight * (selector(scenario) - probability) ** 2,
    0,
  );
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  const z90 = 1.6448536269514722;
  return {
    probability: clamp(probability),
    standardDeviation,
    lower90: clamp(probability - z90 * standardDeviation),
    upper90: clamp(probability + z90 * standardDeviation),
  };
}

function weightedVector(
  scenarios: ScenarioMarketValues[],
  selector: (scenario: ScenarioMarketValues) => number[],
): number[] {
  const length = selector(scenarios[0]!).length;
  return normalize(
    Array.from({ length }, (_, index) =>
      scenarios.reduce(
        (sum, scenario) => sum + scenario.weight * selector(scenario)[index]!,
        0,
      ),
    ),
  );
}

function weightedMatrix(scenarios: ScenarioMarketValues[]): number[][] {
  const size = scenarios[0]!.scoreMatrix.length;
  const matrix = Array.from({ length: size }, (_, homeScore) =>
    Array.from({ length: size }, (_, awayScore) =>
      scenarios.reduce(
        (sum, scenario) =>
          sum + scenario.weight * scenario.scoreMatrix[homeScore]![awayScore]!,
        0,
      ),
    ),
  );
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  return matrix.map((row) => row.map((value) => value / Math.max(EPSILON, total)));
}

function threeWay(
  scenarios: ScenarioMarketValues[],
  lineIndex: number,
  side: 'over' | 'under',
): ThreeWayMarketProbability {
  const win = uncertainty(scenarios, (scenario) => scenario.totals[lineIndex]![side].WIN);
  const push = uncertainty(scenarios, (scenario) => scenario.totals[lineIndex]![side].PUSH);
  const loss = uncertainty(scenarios, (scenario) => scenario.totals[lineIndex]![side].LOSS);
  const normalized = normalize([win.probability, push.probability, loss.probability]);
  return {
    WIN: normalized[0]!,
    PUSH: normalized[1]!,
    LOSS: normalized[2]!,
    uncertainty: {
      WIN: { ...win, probability: normalized[0]! },
      PUSH: { ...push, probability: normalized[1]! },
      LOSS: { ...loss, probability: normalized[2]! },
    },
  };
}

export function buildBayesianPredictiveMarkets(input: {
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  homeGoalsVarianceLog: number;
  awayGoalsVarianceLog: number;
  sourceTeamStrengthVersion: string;
  sourceTeamStrengthHash: string;
  maximumGoals?: number;
}): BayesianPredictiveMarkets {
  if (!(input.predictionAsOf instanceof Date) || !Number.isFinite(input.predictionAsOf.getTime())) {
    throw new TypeError('predictionAsOf must be a valid Date.');
  }
  if (
    !Number.isFinite(input.expectedHomeGoals) ||
    !Number.isFinite(input.expectedAwayGoals) ||
    input.expectedHomeGoals <= 0 ||
    input.expectedAwayGoals <= 0
  ) {
    throw new RangeError('Expected goals must be finite and positive.');
  }
  const maximumGoals = Math.max(7, Math.min(16, Math.trunc(input.maximumGoals ?? 12)));
  const homeScenarios = lambdaScenarios(input.expectedHomeGoals, input.homeGoalsVarianceLog);
  const awayScenarios = lambdaScenarios(input.expectedAwayGoals, input.awayGoalsVarianceLog);
  const scenarios: ScenarioMarketValues[] = [];
  for (const home of homeScenarios) {
    for (const away of awayScenarios) {
      scenarios.push({
        ...baseScenario(home.value, away.value, maximumGoals),
        weight: home.weight * away.weight,
      });
    }
  }

  const homeUncertainty = uncertainty(scenarios, (scenario) => scenario.hda.HOME);
  const drawUncertainty = uncertainty(scenarios, (scenario) => scenario.hda.DRAW);
  const awayUncertainty = uncertainty(scenarios, (scenario) => scenario.hda.AWAY);
  const hda = normalize([
    homeUncertainty.probability,
    drawUncertainty.probability,
    awayUncertainty.probability,
  ]);
  const bttsYes = uncertainty(scenarios, (scenario) => scenario.btts.YES);
  const bttsNo = uncertainty(scenarios, (scenario) => scenario.btts.NO);
  const btts = normalize([bttsYes.probability, bttsNo.probability]);

  return {
    version: BAYESIAN_PREDICTIVE_MARKETS_VERSION,
    fixtureId: input.fixtureId,
    horizonMinutes: input.horizonMinutes,
    predictionAsOf: input.predictionAsOf,
    expectedHomeGoals: input.expectedHomeGoals,
    expectedAwayGoals: input.expectedAwayGoals,
    maximumGoals,
    homeGoalDistribution: weightedVector(scenarios, (scenario) => scenario.homeGoals),
    awayGoalDistribution: weightedVector(scenarios, (scenario) => scenario.awayGoals),
    scoreMatrix: weightedMatrix(scenarios),
    hda: {
      HOME: hda[0]!,
      DRAW: hda[1]!,
      AWAY: hda[2]!,
      uncertainty: {
        HOME: { ...homeUncertainty, probability: hda[0]! },
        DRAW: { ...drawUncertainty, probability: hda[1]! },
        AWAY: { ...awayUncertainty, probability: hda[2]! },
      },
    },
    btts: {
      YES: btts[0]!,
      NO: btts[1]!,
      uncertainty: {
        YES: { ...bttsYes, probability: btts[0]! },
        NO: { ...bttsNo, probability: btts[1]! },
      },
    },
    totalGoals: BAYESIAN_TOTAL_GOAL_LINES.map((line, index) => ({
      line,
      OVER: threeWay(scenarios, index, 'over'),
      UNDER: threeWay(scenarios, index, 'under'),
    })),
    modelVersion: BAYESIAN_PREDICTIVE_MARKETS_VERSION,
    sourceTeamStrengthVersion: input.sourceTeamStrengthVersion,
    sourceTeamStrengthHash: input.sourceTeamStrengthHash,
  };
}

export function bayesianPredictiveMarketsHash(markets: BayesianPredictiveMarkets): string {
  return sha256(
    stableStringify({
      ...markets,
      predictionAsOf: markets.predictionAsOf.toISOString(),
    }),
  );
}
