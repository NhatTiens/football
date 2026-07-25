import { dixonColesTau } from './fundamentals-core.js';

export const SCIENTIFIC_MULTI_MARKET_REPLAY_VERSION =
  'v7.0-beta.1A.3-scientific-multi-market-replay-v1';

export const SCIENTIFIC_MULTI_MARKET_REPLAY_POLICY =
  'historical-t90-multi-market-non-promotional-v1';

export const SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES = 90;

export const SCIENTIFIC_TOTAL_GOAL_LINES = [1.5, 2.5, 3.5] as const;

export type ScientificTotalGoalLine = (typeof SCIENTIFIC_TOTAL_GOAL_LINES)[number];

export type MatchWinnerClass = 'HOME' | 'DRAW' | 'AWAY';

export type BinaryClass = 'POSITIVE' | 'NEGATIVE';

export interface ScoreGridMarketProbabilities {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho: number;
  maximumGoals: number;
  scoreGridMass: number;
  matchWinner: Record<MatchWinnerClass, number>;
  totalGoals: Record<
    ScientificTotalGoalLine,
    {
      OVER: number;
      UNDER: number;
    }
  >;
  btts: {
    YES: number;
    NO: number;
  };
}

export interface CalibrationBucket {
  lowerInclusive: number;
  upperExclusive: number;
  rows: number;
  meanConfidence: number | null;
  accuracy: number | null;
  absoluteGap: number | null;
}

export interface ScientificPredictionMetrics {
  rows: number;
  classCount: 2 | 3;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  brierSkillVsUniform: number | null;
  logLossSkillVsUniform: number | null;
  positiveRate: number | null;
  calibration: CalibrationBucket[];
}

const EPSILON = 1e-15;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
}

function poissonProbability(goals: number, lambda: number): number {
  let factorial = 1;

  for (let index = 2; index <= goals; index += 1) {
    factorial *= index;
  }

  return (Math.exp(-lambda) * lambda ** goals) / Math.max(1, factorial);
}

function normalize<T extends string>(values: Record<T, number>): Record<T, number> {
  const keys = Object.keys(values) as T[];
  const total = keys.reduce((sum, key) => sum + Math.max(0, values[key] ?? 0), 0);

  if (!Number.isFinite(total) || total <= EPSILON) {
    const uniform = 1 / Math.max(1, keys.length);

    return Object.fromEntries(keys.map((key) => [key, uniform])) as Record<T, number>;
  }

  return Object.fromEntries(
    keys.map((key) => [key, Math.max(0, values[key] ?? 0) / total]),
  ) as Record<T, number>;
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function deriveScientificScoreGridMarkets(input: {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho: number;
  maximumGoals?: number;
}): ScoreGridMarketProbabilities {
  assertFiniteNonNegative(input.homeExpectedGoals, 'homeExpectedGoals');
  assertFiniteNonNegative(input.awayExpectedGoals, 'awayExpectedGoals');

  if (!Number.isFinite(input.rho)) {
    throw new RangeError('rho must be finite.');
  }

  const maximumGoals = Math.max(6, Math.floor(input.maximumGoals ?? 10));

  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  let mass = 0;

  const totalOver = new Map<ScientificTotalGoalLine, number>(
    SCIENTIFIC_TOTAL_GOAL_LINES.map((line) => [line, 0]),
  );

  for (let homeGoals = 0; homeGoals <= maximumGoals; homeGoals += 1) {
    const homePoisson = poissonProbability(homeGoals, input.homeExpectedGoals);

    for (let awayGoals = 0; awayGoals <= maximumGoals; awayGoals += 1) {
      const probability =
        homePoisson *
        poissonProbability(awayGoals, input.awayExpectedGoals) *
        dixonColesTau({
          homeGoals,
          awayGoals,
          homeExpectedGoals: input.homeExpectedGoals,
          awayExpectedGoals: input.awayExpectedGoals,
          rho: input.rho,
        });

      mass += probability;

      if (homeGoals > awayGoals) {
        home += probability;
      } else if (homeGoals === awayGoals) {
        draw += probability;
      } else {
        away += probability;
      }

      const totalGoals = homeGoals + awayGoals;

      for (const line of SCIENTIFIC_TOTAL_GOAL_LINES) {
        if (totalGoals > line) {
          totalOver.set(line, (totalOver.get(line) ?? 0) + probability);
        }
      }

      if (homeGoals > 0 && awayGoals > 0) {
        bttsYes += probability;
      }
    }
  }

  const matchWinner = normalize({
    HOME: home,
    DRAW: draw,
    AWAY: away,
  });

  const totalGoals = Object.fromEntries(
    SCIENTIFIC_TOTAL_GOAL_LINES.map((line) => {
      const over = clampProbability((totalOver.get(line) ?? 0) / Math.max(EPSILON, mass));

      return [
        line,
        {
          OVER: over,
          UNDER: 1 - over,
        },
      ];
    }),
  ) as ScoreGridMarketProbabilities['totalGoals'];

  const bttsProbability = clampProbability(bttsYes / Math.max(EPSILON, mass));

  return {
    homeExpectedGoals: input.homeExpectedGoals,
    awayExpectedGoals: input.awayExpectedGoals,
    rho: input.rho,
    maximumGoals,
    scoreGridMass: mass,
    matchWinner,
    totalGoals,
    btts: {
      YES: bttsProbability,
      NO: 1 - bttsProbability,
    },
  };
}

function safeLog(value: number): number {
  return Math.log(Math.min(1 - EPSILON, Math.max(EPSILON, value)));
}

function makeCalibrationBuckets(
  rows: Array<{
    confidence: number;
    correct: boolean;
  }>,
  bucketCount = 10,
): CalibrationBucket[] {
  const count = Math.max(1, Math.floor(bucketCount));

  return Array.from(
    {
      length: count,
    },
    (_, index) => {
      const lowerInclusive = index / count;
      const upperExclusive = (index + 1) / count;
      const selected = rows.filter((row) => {
        const confidence = Math.min(1, Math.max(0, row.confidence));

        return confidence >= lowerInclusive && (index === count - 1 || confidence < upperExclusive);
      });

      if (selected.length === 0) {
        return {
          lowerInclusive,
          upperExclusive,
          rows: 0,
          meanConfidence: null,
          accuracy: null,
          absoluteGap: null,
        };
      }

      const meanConfidence =
        selected.reduce((sum, row) => sum + row.confidence, 0) / selected.length;
      const accuracy = selected.filter((row) => row.correct).length / selected.length;

      return {
        lowerInclusive,
        upperExclusive,
        rows: selected.length,
        meanConfidence,
        accuracy,
        absoluteGap: Math.abs(meanConfidence - accuracy),
      };
    },
  );
}

function expectedCalibrationError(buckets: CalibrationBucket[]): number | null {
  const rows = buckets.reduce((sum, bucket) => sum + bucket.rows, 0);

  if (rows === 0) {
    return null;
  }

  return buckets.reduce((sum, bucket) => sum + (bucket.absoluteGap ?? 0) * (bucket.rows / rows), 0);
}

function argmaxMatchWinner(probabilities: Record<MatchWinnerClass, number>): MatchWinnerClass {
  const entries = Object.entries(probabilities) as Array<[MatchWinnerClass, number]>;

  entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  return entries[0]![0];
}

export function evaluateMatchWinnerPredictions(
  rows: Array<{
    probabilities: Record<MatchWinnerClass, number>;
    actualClass: MatchWinnerClass;
  }>,
): ScientificPredictionMetrics {
  if (rows.length === 0) {
    return {
      rows: 0,
      classCount: 3,
      accuracy: null,
      brier: null,
      logLoss: null,
      ece: null,
      brierSkillVsUniform: null,
      logLossSkillVsUniform: null,
      positiveRate: null,
      calibration: makeCalibrationBuckets([]),
    };
  }

  let correct = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  const calibrationRows: Array<{
    confidence: number;
    correct: boolean;
  }> = [];

  for (const row of rows) {
    const predicted = argmaxMatchWinner(row.probabilities);
    const isCorrect = predicted === row.actualClass;

    if (isCorrect) {
      correct += 1;
    }

    for (const classCode of ['HOME', 'DRAW', 'AWAY'] as const) {
      const expected = row.actualClass === classCode ? 1 : 0;
      const probability = row.probabilities[classCode];

      brierTotal += (probability - expected) ** 2;
    }

    logLossTotal += -safeLog(row.probabilities[row.actualClass]);

    calibrationRows.push({
      confidence: row.probabilities[predicted],
      correct: isCorrect,
    });
  }

  const brier = brierTotal / rows.length;
  const logLoss = logLossTotal / rows.length;
  const uniformBrier = 2 / 3;
  const uniformLogLoss = Math.log(3);
  const calibration = makeCalibrationBuckets(calibrationRows);

  return {
    rows: rows.length,
    classCount: 3,
    accuracy: correct / rows.length,
    brier,
    logLoss,
    ece: expectedCalibrationError(calibration),
    brierSkillVsUniform: 1 - brier / uniformBrier,
    logLossSkillVsUniform: 1 - logLoss / uniformLogLoss,
    positiveRate: null,
    calibration,
  };
}

export function evaluateBinaryPredictions(
  rows: Array<{
    positiveProbability: number;
    actualPositive: boolean;
  }>,
): ScientificPredictionMetrics {
  if (rows.length === 0) {
    return {
      rows: 0,
      classCount: 2,
      accuracy: null,
      brier: null,
      logLoss: null,
      ece: null,
      brierSkillVsUniform: null,
      logLossSkillVsUniform: null,
      positiveRate: null,
      calibration: makeCalibrationBuckets([]),
    };
  }

  let correct = 0;
  let positives = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  const calibrationRows: Array<{
    confidence: number;
    correct: boolean;
  }> = [];

  for (const row of rows) {
    if (
      !Number.isFinite(row.positiveProbability) ||
      row.positiveProbability < 0 ||
      row.positiveProbability > 1
    ) {
      throw new RangeError('positiveProbability must be in [0, 1].');
    }

    const actual = row.actualPositive ? 1 : 0;
    const predictedPositive = row.positiveProbability >= 0.5;
    const isCorrect = predictedPositive === row.actualPositive;

    if (row.actualPositive) {
      positives += 1;
    }

    if (isCorrect) {
      correct += 1;
    }

    brierTotal += (row.positiveProbability - actual) ** 2;

    logLossTotal += row.actualPositive
      ? -safeLog(row.positiveProbability)
      : -safeLog(1 - row.positiveProbability);

    calibrationRows.push({
      confidence: predictedPositive ? row.positiveProbability : 1 - row.positiveProbability,
      correct: isCorrect,
    });
  }

  const brier = brierTotal / rows.length;
  const logLoss = logLossTotal / rows.length;
  const uniformBrier = 0.25;
  const uniformLogLoss = Math.log(2);
  const calibration = makeCalibrationBuckets(calibrationRows);

  return {
    rows: rows.length,
    classCount: 2,
    accuracy: correct / rows.length,
    brier,
    logLoss,
    ece: expectedCalibrationError(calibration),
    brierSkillVsUniform: 1 - brier / uniformBrier,
    logLossSkillVsUniform: 1 - logLoss / uniformLogLoss,
    positiveRate: positives / rows.length,
    calibration,
  };
}

export function actualMatchWinner(homeGoals: number, awayGoals: number): MatchWinnerClass {
  if (homeGoals > awayGoals) {
    return 'HOME';
  }

  if (homeGoals === awayGoals) {
    return 'DRAW';
  }

  return 'AWAY';
}

export function actualOverLine(
  homeGoals: number,
  awayGoals: number,
  line: ScientificTotalGoalLine,
): boolean {
  return homeGoals + awayGoals > line;
}

export function actualBtts(homeGoals: number, awayGoals: number): boolean {
  return homeGoals > 0 && awayGoals > 0;
}

export function maximumAbsoluteDifference(
  values: Array<{
    left: number;
    right: number;
  }>,
): number {
  return values.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value.left - value.right)),
    0,
  );
}
