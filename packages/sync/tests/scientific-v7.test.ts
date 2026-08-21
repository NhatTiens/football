import { describe, expect, it } from 'vitest';
import {
  SCIENTIFIC_FEATURE_NAMES_V7,
  SCIENTIFIC_MODEL_VERSION_V7,
  adaptFeatureWidth,
  applyIsotonicRegression,
  buildScientificArtifactV7,
  fitIsotonicRegression,
  isScientificModelArtifact,
  opponentAdjustedPpg,
  predictScientificModelV7,
  trainStackingWeights,
  type IsotonicCalibration,
  type ScientificModelArtifact,
  type StackTrainingRow,
} from '../src/scientific-model.js';
import { analyzeMarketFeatureSet, type MarketOddsRow } from '../src/scientific-market-features.js';

function oddsRow(
  bookmakerId: number,
  marketCode: string,
  selectionCode: string,
  decimalOdds: number,
  capturedAt: Date,
): MarketOddsRow {
  return { bookmakerId, marketCode, selectionCode, decimalOdds, capturedAt };
}

describe('PREDICTION_AI_V7 feature names', () => {
  it('extends v6 with market and context features', () => {
    expect(SCIENTIFIC_FEATURE_NAMES_V7.length).toBe(29);
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('marketHomeConsensus');
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('marketOver25Consensus');
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('marketMoveOver25');
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('opponentAdjustedFormDiff');
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('injuryWeightedDiff');
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('fatigueDensityDiff');
    expect(SCIENTIFIC_FEATURE_NAMES_V7).toContain('homeAdvantageTeam');
  });
});

describe('PREDICTION_AI_V7 market feature analysis', () => {
  const asOf = new Date('2026-08-20T12:00:00Z');

  it('computes no-vig consensus across bookmakers', () => {
    const rows: MarketOddsRow[] = [
      oddsRow(1, 'MATCH_WINNER', 'HOME', 2.0, new Date('2026-08-20T11:00:00Z')),
      oddsRow(1, 'MATCH_WINNER', 'DRAW', 3.4, new Date('2026-08-20T11:00:00Z')),
      oddsRow(1, 'MATCH_WINNER', 'AWAY', 3.8, new Date('2026-08-20T11:00:00Z')),
      oddsRow(2, 'MATCH_WINNER', 'HOME', 2.1, new Date('2026-08-20T11:30:00Z')),
      oddsRow(2, 'MATCH_WINNER', 'DRAW', 3.3, new Date('2026-08-20T11:30:00Z')),
      oddsRow(2, 'MATCH_WINNER', 'AWAY', 3.7, new Date('2026-08-20T11:30:00Z')),
    ];
    const result = analyzeMarketFeatureSet({ rows, asOf, minimumBookmakers: 2 });
    expect(result.available).toBe(true);
    expect(result.homeConsensus).not.toBeNull();
    expect(result.drawConsensus).not.toBeNull();
    expect(result.awayConsensus).not.toBeNull();
    expect(result.homeConsensus! + result.drawConsensus! + result.awayConsensus!).toBeCloseTo(1, 6);
    expect(result.bookmakerCount).toBe(2);
  });

  it('measures odds movement between opening and current consensus', () => {
    const opening = new Date('2026-08-19T10:00:00Z');
    const current = new Date('2026-08-20T11:00:00Z');
    const rows: MarketOddsRow[] = [
      oddsRow(1, 'MATCH_WINNER', 'HOME', 2.6, opening),
      oddsRow(1, 'MATCH_WINNER', 'DRAW', 3.2, opening),
      oddsRow(1, 'MATCH_WINNER', 'AWAY', 2.9, opening),
      oddsRow(1, 'MATCH_WINNER', 'HOME', 2.1, current),
      oddsRow(1, 'MATCH_WINNER', 'DRAW', 3.4, current),
      oddsRow(1, 'MATCH_WINNER', 'AWAY', 3.6, current),
    ];
    const result = analyzeMarketFeatureSet({ rows, asOf, minimumBookmakers: 1 });
    // Home odds shortened => home consensus increased => positive movement.
    expect(result.homeMovement).not.toBeNull();
    expect(result.homeMovement!).toBeGreaterThan(0);
  });

  it('rejects stale odds older than the max age window', () => {
    const rows: MarketOddsRow[] = [
      oddsRow(1, 'MATCH_WINNER', 'HOME', 2.0, new Date('2026-08-01T11:00:00Z')),
      oddsRow(1, 'MATCH_WINNER', 'DRAW', 3.4, new Date('2026-08-01T11:00:00Z')),
      oddsRow(1, 'MATCH_WINNER', 'AWAY', 3.8, new Date('2026-08-01T11:00:00Z')),
    ];
    const result = analyzeMarketFeatureSet({
      rows,
      asOf,
      minimumBookmakers: 1,
      maximumAgeHours: 24,
    });
    expect(result.available).toBe(false);
    expect(result.homeConsensus).toBeNull();
  });

  it('handles O/U and BTTS binary markets', () => {
    const rows: MarketOddsRow[] = [
      oddsRow(1, 'TOTAL_GOALS_2_5', 'OVER', 1.95, new Date('2026-08-20T11:00:00Z')),
      oddsRow(1, 'TOTAL_GOALS_2_5', 'UNDER', 1.85, new Date('2026-08-20T11:00:00Z')),
      oddsRow(2, 'TOTAL_GOALS_2_5', 'OVER', 1.9, new Date('2026-08-20T11:30:00Z')),
      oddsRow(2, 'TOTAL_GOALS_2_5', 'UNDER', 1.9, new Date('2026-08-20T11:30:00Z')),
      oddsRow(1, 'BTTS', 'YES', 1.8, new Date('2026-08-20T11:00:00Z')),
      oddsRow(1, 'BTTS', 'NO', 1.95, new Date('2026-08-20T11:00:00Z')),
    ];
    const result = analyzeMarketFeatureSet({ rows, asOf, minimumBookmakers: 1 });
    expect(result.over25Consensus).not.toBeNull();
    expect(result.bttsYesConsensus).not.toBeNull();
    expect(result.over25Consensus! + 0.5).toBeGreaterThan(0.5);
    expect(result.bttsYesConsensus!).toBeGreaterThan(0.4);
    expect(result.bttsYesConsensus!).toBeLessThan(0.6);
  });
});

describe('PREDICTION_AI_V7 stacking meta-learner', () => {
  function syntheticRows(count = 120): StackTrainingRow[] {
    const rows: StackTrainingRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const draw = index % 2 === 0;
      const label = draw ? 1 : 0;
      const marketSignal = label === 1 ? 0.75 : 0.25;
      const poissonSignal = index % 3 === 0 ? 0.6 : 0.4;
      const row: StackTrainingRow = {
        // Market component perfectly separates draw (class 1) from home (class 0);
        // the other components are near-uniform noise.
        matchWinnerComponents: [
          [0.45, 0.3, 0.25],
          [0.4, 0.32, 0.28],
          [0.42, 0.31, 0.27],
          draw ? [0.2, 0.7, 0.1] : [0.7, 0.2, 0.1],
        ],
        over25Components: [[poissonSignal], [0.5], [marketSignal]],
        bttsComponents: [[poissonSignal], [0.5], [marketSignal]],
        matchWinnerClass: label as 0 | 1,
        over25: label as 0 | 1,
        btts: label as 0 | 1,
      };
      rows.push(row);
    }
    return rows;
  }

  it('learns to trust the informative component', () => {
    const weights = trainStackingWeights(syntheticRows(), {
      epochs: 200,
      learningRate: 0.05,
    });
    // The market component (index 3 / index 2) is perfectly informative;
    // the learned weight should dominate.
    const marketWinnerWeight = weights.matchWinner[3]!;
    const marketBinaryWeight = weights.over25[2]!;
    expect(marketWinnerWeight).toBeGreaterThan(0.4);
    expect(marketBinaryWeight).toBeGreaterThan(0.4);
    // Simplex constraints.
    expect(weights.matchWinner.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(weights.over25.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(weights.btts.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
  });

  it('reports validation log loss', () => {
    const weights = trainStackingWeights(syntheticRows(), { epochs: 100 });
    expect(weights.validationLogLoss.matchWinner).not.toBeNull();
    expect(weights.validationLogLoss.over25).not.toBeNull();
    expect(weights.validationLogLoss.btts).not.toBeNull();
  });
});

describe('PREDICTION_AI_V7 isotonic calibration', () => {
  it('is monotonic non-decreasing', () => {
    const probabilities = Array.from({ length: 200 }, (_, index) => 0.05 + (index / 200) * 0.9);
    const labels = probabilities.map((probability) => (probability + 0.08 > 0.5 ? 1 : 0));
    const calibration = fitIsotonicRegression(probabilities, labels, 20);
    for (let index = 1; index < calibration.values.length; index += 1) {
      expect(calibration.values[index]!).toBeGreaterThanOrEqual(
        calibration.values[index - 1]! - 1e-9,
      );
    }
  });

  it('maps low probabilities lower and high probabilities higher', () => {
    // Boundary at exactly 0.5 is labelled 0 (p > 0.5 only) to avoid ambiguity.
    const probabilities = Array.from({ length: 400 }, (_, index) => (index / 400) * 0.99 + 0.005);
    const labels = probabilities.map((probability) => (probability > 0.5 ? 1 : 0));
    const calibration = fitIsotonicRegression(probabilities, labels, 20);
    const low = applyIsotonicRegression(0.1, calibration);
    const high = applyIsotonicRegression(0.9, calibration);
    const midHigh = applyIsotonicRegression(0.7, calibration);
    expect(high).toBeGreaterThan(low);
    expect(midHigh).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(0.5);
    expect(low).toBeLessThan(0.5);
  });

  it('returns probability unchanged when empty', () => {
    const calibration: IsotonicCalibration = {
      thresholds: [],
      values: [],
      fittedAt: new Date().toISOString(),
      sampleSize: 0,
    };
    expect(applyIsotonicRegression(0.7, calibration)).toBeCloseTo(0.7, 6);
  });
});

describe('PREDICTION_AI_V7 artifact assembly and prediction', () => {
  function baseArtifact(): ScientificModelArtifact {
    return {
      version: 'scientific-ensemble-dixon-coles-v6',
      featureNames: [...SCIENTIFIC_FEATURE_NAMES_V7],
      means: new Array(29).fill(0),
      standardDeviations: new Array(29).fill(1),
      matchWinnerWeights: [
        [
          0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
          0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
        ],
        [
          0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
          0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
        ],
        [
          0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
          0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
        ],
      ],
      over15Weights: new Array(29).fill(0),
      over25Weights: new Array(29).fill(0),
      over35Weights: new Array(29).fill(0),
      bttsWeights: new Array(29).fill(0),
      sampleSize: 100,
      trainedAt: '2026-08-01T00:00:00.000Z',
      trainedThrough: '2026-07-01T00:00:00.000Z',
      epochs: 100,
      learningRate: 0.01,
      l2: 0.01,
      members: [],
      transform: {
        activeFeatureIndices: [],
        quadraticFeatureIndices: [],
        interactionPairs: [],
        expandedFeatureNames: [],
      },
      calibration: {
        matchWinnerTemperature: 1,
        over25: { scale: 1, bias: 0 },
        btts: { scale: 1, bias: 0 },
      },
    };
  }

  it('buildScientificArtifactV7 marks version and preserves fields', () => {
    const artifact = buildScientificArtifactV7({
      base: baseArtifact(),
      stacking: {
        matchWinner: [0.4, 0.2, 0.2, 0.2],
        over25: [0.5, 0.3, 0.2],
        btts: [0.5, 0.3, 0.2],
        fittedAt: '2026-08-21T00:00:00.000Z',
        sampleSize: 100,
        validationLogLoss: { matchWinner: 1.0, over25: 0.6, btts: 0.6 },
      },
      isotonic: {
        over25: fitIsotonicRegression(
          Array.from({ length: 100 }, (_, index) => index / 100),
          Array.from({ length: 100 }, (_, index) => (index > 50 ? 1 : 0)),
        ),
      },
    });
    expect(artifact.version).toBe(SCIENTIFIC_MODEL_VERSION_V7);
    expect(isScientificModelArtifact(artifact)).toBe(true);
    expect(artifact.featureNames.length).toBe(29);
    expect(artifact.stacking?.matchWinner.length).toBe(4);
    expect(artifact.isotonic?.over25).toBeDefined();
  });

  it('predictScientificModelV7 blends components and normalizes', () => {
    const artifact = buildScientificArtifactV7({
      base: baseArtifact(),
      stacking: {
        matchWinner: [0.1, 0.1, 0.1, 0.7],
        over25: [0.2, 0.1, 0.7],
        btts: [0.2, 0.1, 0.7],
        fittedAt: '2026-08-21T00:00:00.000Z',
        sampleSize: 100,
        validationLogLoss: { matchWinner: 1.0, over25: 0.6, btts: 0.6 },
      },
    });
    const prediction = predictScientificModelV7({
      artifact,
      features: new Array(29).fill(0.5),
      poissonMatchWinner: { HOME: 0.4, DRAW: 0.3, AWAY: 0.3 },
      poissonOver25: 0.45,
      poissonBttsYes: 0.5,
      eloMatchWinner: { HOME: 0.35, DRAW: 0.32, AWAY: 0.33 },
      marketMatchWinner: { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 },
      marketOver25: 0.7,
      marketBttsYes: 0.65,
    });
    // Market (weight 0.7) pushes home probability up vs poisson/elo alone.
    expect(prediction.matchWinner.HOME).toBeGreaterThan(0.5);
    const total =
      prediction.matchWinner.HOME + prediction.matchWinner.DRAW + prediction.matchWinner.AWAY;
    expect(total).toBeCloseTo(1, 6);
    expect(prediction.over25.OVER).toBeGreaterThan(0.5);
    expect(prediction.btts.YES).toBeGreaterThan(0.5);
  });

  it('predictScientificModelV7 falls back when market is missing', () => {
    const artifact = buildScientificArtifactV7({
      base: baseArtifact(),
      stacking: {
        matchWinner: [0.1, 0.1, 0.1, 0.7],
        over25: [0.2, 0.1, 0.7],
        btts: [0.2, 0.1, 0.7],
        fittedAt: '2026-08-21T00:00:00.000Z',
        sampleSize: 100,
        validationLogLoss: { matchWinner: 1.0, over25: 0.6, btts: 0.6 },
      },
    });
    const prediction = predictScientificModelV7({
      artifact,
      features: new Array(29).fill(0.5),
      poissonMatchWinner: { HOME: 0.4, DRAW: 0.3, AWAY: 0.3 },
      poissonOver25: 0.45,
      poissonBttsYes: 0.5,
      eloMatchWinner: { HOME: 0.35, DRAW: 0.32, AWAY: 0.33 },
      marketMatchWinner: null,
      marketOver25: null,
      marketBttsYes: null,
    });
    const total =
      prediction.matchWinner.HOME + prediction.matchWinner.DRAW + prediction.matchWinner.AWAY;
    expect(total).toBeCloseTo(1, 6);
    expect(prediction.over25.OVER).toBeGreaterThan(0);
    expect(prediction.over25.OVER).toBeLessThan(1);
  });

  it('adaptFeatureWidth slices v7 vectors for v6 artifacts', () => {
    const artifact = baseArtifact();
    const vector = new Array(29).fill(0.5);
    const adapted = adaptFeatureWidth(vector, {
      ...artifact,
      featureNames: [
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
        'g',
        'h',
        'i',
        'j',
        'k',
        'l',
        'm',
        'n',
        'o',
        'p',
      ],
    });
    expect(adapted.length).toBe(16);
    expect(adaptFeatureWidth(new Array(29).fill(0.5), artifact).length).toBe(29);
  });
});

describe('PREDICTION_AI_V7 opponent-adjusted form', () => {
  it('down-weights results against much weaker or much stronger opponents', () => {
    // Wins over weak teams + loss to a strong team: the loss carries more
    // weight than the wins, so adjusted ppg is BELOW the raw mean (2.0).
    const mixedWeak = [
      { points: 3, opponentRating: 1200 },
      { points: 3, opponentRating: 1300 },
      { points: 0, opponentRating: 1400 },
    ];
    // Losses to elite teams + win vs a merely strong team: the win counts
    // less, adjusted ppg stays BELOW the raw mean (1.0).
    const mixedStrong = [
      { points: 0, opponentRating: 1850 },
      { points: 0, opponentRating: 1800 },
      { points: 3, opponentRating: 1700 },
    ];
    const againstWeak = opponentAdjustedPpg(mixedWeak);
    const againstStrong = opponentAdjustedPpg(mixedStrong);
    expect(againstWeak).toBeLessThan(2);
    expect(againstWeak).toBeGreaterThan(1);
    expect(againstStrong).toBeLessThan(1);
    expect(againstStrong).toBeGreaterThan(0);
    expect(againstWeak).toBeGreaterThan(againstStrong);
  });

  it('falls back when empty', () => {
    expect(opponentAdjustedPpg([])).toBeCloseTo(1.35, 6);
  });
});
