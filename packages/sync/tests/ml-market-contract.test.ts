import { describe, expect, it } from 'vitest';

import {
  ML_MARKET_FEATURE_CONTRACT_HASH,
  ML_MARKET_FEATURE_NAMES,
  applyMarketResidual,
  blendMlMarketPrediction,
  buildMlMarketFeatureVector,
  deterministicPayloadHash,
  normalizeMatchWinner,
  type MarketFeatureRow,
  type TeamFundamentalFeatureRow,
} from '../src/ml-market-contract.js';

function team(overrides: Partial<TeamFundamentalFeatureRow> = {}): TeamFundamentalFeatureRow {
  return {
    sampleSize: 20,
    venueSampleSize: 10,
    pointsPerGame5: 1.8,
    pointsPerGame10: 1.7,
    pointsPerGame20: 1.6,
    goalsFor5: 1.8,
    goalsFor10: 1.6,
    goalsAgainst5: 1,
    goalsAgainst10: 1.1,
    expectedGoalsFor10: 1.7,
    expectedGoalsAgainst10: 1.05,
    shots10: 13,
    shotsOnGoal10: 5.2,
    possession10: 55,
    corners10: 5.5,
    winRate10: 0.5,
    drawRate10: 0.3,
    cleanSheetRate10: 0.4,
    bttsRate10: 0.5,
    over25Rate10: 0.6,
    metricCoverage10: 0.8,
    venuePointsPerGame10: 2,
    venueGoalsFor10: 1.9,
    venueGoalsAgainst10: 0.9,
    restDays: 7,
    dataQualityScore: 0.75,
    ...overrides,
  };
}

function market(overrides: Partial<MarketFeatureRow> = {}): MarketFeatureRow {
  return {
    available: true,
    movementAvailable: false,
    bookmakerCount: 3,
    currentConsensus: {
      HOME: 0.5,
      DRAW: 0.28,
      AWAY: 0.22,
    },
    movement: {
      HOME: 0,
      DRAW: 0,
      AWAY: 0,
    },
    recentMovement: {
      HOME: 0,
      DRAW: 0,
      AWAY: 0,
    },
    averageDispersion: 0.02,
    bookmakerAgreement: 0.8,
    steamStrength: 0,
    qualityScore: 0.72,
    ...overrides,
  };
}

function featureInput() {
  return {
    horizonMinutes: 90,
    home: team(),
    away: team({
      pointsPerGame5: 1.2,
      pointsPerGame10: 1.3,
      pointsPerGame20: 1.35,
      goalsFor5: 1.1,
      expectedGoalsFor10: 1.15,
      possession10: 47,
      venuePointsPerGame10: 1.1,
      dataQualityScore: 0.7,
    }),
    dixonColes: {
      homeExpectedGoals: 1.65,
      awayExpectedGoals: 1.05,
      homeProbability: 0.52,
      drawProbability: 0.27,
      awayProbability: 0.21,
      over25Probability: 0.54,
      bttsProbability: 0.49,
      dataQualityScore: 0.71,
    },
    market: market(),
  };
}

describe('alpha.6 ML and market contract', () => {
  it('keeps a non-empty stable feature contract', () => {
    expect(ML_MARKET_FEATURE_NAMES.length).toBeGreaterThan(50);
    expect(ML_MARKET_FEATURE_CONTRACT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds one value for every feature name', () => {
    const result = buildMlMarketFeatureVector(featureInput());

    expect(result.featureVector).toHaveLength(ML_MARKET_FEATURE_NAMES.length);
  });

  it('produces only finite feature values', () => {
    const result = buildMlMarketFeatureVector(featureInput());

    expect(result.featureVector.every(Number.isFinite)).toBe(true);
  });

  it('preserves the contract hash in every vector', () => {
    const result = buildMlMarketFeatureVector(featureInput());

    expect(result.featureContractHash).toBe(ML_MARKET_FEATURE_CONTRACT_HASH);
  });

  it('marks current consensus as available', () => {
    const result = buildMlMarketFeatureVector(featureInput());

    expect(result.marketAvailable).toBe(true);
    expect(result.marketConsensus).toEqual({
      HOME: 0.5,
      DRAW: 0.28,
      AWAY: 0.22,
    });
  });

  it('falls back to Dixon-Coles when market is unavailable', () => {
    const input = featureInput();
    input.market = market({
      available: false,
      currentConsensus: null,
      bookmakerCount: 0,
      qualityScore: 0,
    });
    const result = buildMlMarketFeatureVector(input);

    expect(result.marketAvailable).toBe(false);
    expect(result.marketConsensus).toBeNull();
    const marketAvailableIndex = ML_MARKET_FEATURE_NAMES.indexOf('market_available');
    expect(result.featureVector[marketAvailableIndex]).toBe(0);
  });

  it('encodes horizon without changing the contract width', () => {
    const early = buildMlMarketFeatureVector({
      ...featureInput(),
      horizonMinutes: 90,
    });
    const late = buildMlMarketFeatureVector({
      ...featureInput(),
      horizonMinutes: 5,
    });

    expect(early.featureVector[0]).toBe(90 / 1440);
    expect(late.featureVector[0]).toBe(5 / 1440);
    expect(early.featureVector).toHaveLength(late.featureVector.length);
  });

  it('encodes home-away PPG differences', () => {
    const result = buildMlMarketFeatureVector(featureInput());
    const index = ML_MARKET_FEATURE_NAMES.indexOf('ppg_10_diff');

    expect(result.featureVector[index]).toBeCloseTo(0.4);
  });

  it('encodes Dixon-Coles versus market residuals', () => {
    const result = buildMlMarketFeatureVector(featureInput());
    const homeIndex = ML_MARKET_FEATURE_NAMES.indexOf('dixon_market_home_residual');
    const drawIndex = ML_MARKET_FEATURE_NAMES.indexOf('dixon_market_draw_residual');

    expect(result.featureVector[homeIndex]).toBeCloseTo(0.02);
    expect(result.featureVector[drawIndex]).toBeCloseTo(-0.01);
  });

  it('clamps non-finite inputs to safe values', () => {
    const input = featureInput();
    input.home.shots10 = Number.NaN;
    input.away.restDays = Number.POSITIVE_INFINITY;
    const result = buildMlMarketFeatureVector(input);

    expect(result.featureVector.every(Number.isFinite)).toBe(true);
  });

  it('normalizes match-winner probabilities', () => {
    const result = normalizeMatchWinner({
      HOME: 4,
      DRAW: 2,
      AWAY: 2,
    });

    expect(result.HOME + result.DRAW + result.AWAY).toBeCloseTo(1, 10);
    expect(result.HOME).toBeCloseTo(0.5);
  });

  it('uses a uniform fallback for zero mass', () => {
    const result = normalizeMatchWinner({
      HOME: 0,
      DRAW: 0,
      AWAY: 0,
    });

    expect(result.HOME).toBeCloseTo(1 / 3);
    expect(result.DRAW).toBeCloseTo(1 / 3);
    expect(result.AWAY).toBeCloseTo(1 / 3);
  });

  it('applies a market residual and renormalizes', () => {
    const result = applyMarketResidual({
      marketConsensus: {
        HOME: 0.5,
        DRAW: 0.28,
        AWAY: 0.22,
      },
      residual: {
        HOME: 0.04,
        DRAW: -0.02,
        AWAY: -0.02,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.HOME).toBeGreaterThan(0.5);
    expect(result!.HOME + result!.DRAW + result!.AWAY).toBeCloseTo(1, 10);
  });

  it('returns null residual prediction without market', () => {
    expect(
      applyMarketResidual({
        marketConsensus: null,
        residual: {
          HOME: 0.1,
          DRAW: -0.05,
          AWAY: -0.05,
        },
      }),
    ).toBeNull();
  });

  it('blends CatBoost with residual market output', () => {
    const result = blendMlMarketPrediction({
      catBoost: {
        HOME: 0.55,
        DRAW: 0.25,
        AWAY: 0.2,
      },
      residualMarket: {
        HOME: 0.5,
        DRAW: 0.3,
        AWAY: 0.2,
      },
      catBoostWeight: 0.6,
    });

    expect(result.HOME).toBeCloseTo(0.53);
    expect(result.DRAW).toBeCloseTo(0.27);
  });

  it('uses CatBoost alone without residual market output', () => {
    const result = blendMlMarketPrediction({
      catBoost: {
        HOME: 0.6,
        DRAW: 0.25,
        AWAY: 0.15,
      },
      residualMarket: null,
    });

    expect(result).toEqual({
      HOME: 0.6,
      DRAW: 0.25,
      AWAY: 0.15,
    });
  });

  it('creates deterministic payload hashes', () => {
    const left = deterministicPayloadHash('TEST', {
      b: 2,
      a: 1,
    });
    const right = deterministicPayloadHash('TEST', {
      a: 1,
      b: 2,
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes payload hash when content changes', () => {
    expect(deterministicPayloadHash('TEST', { a: 1 })).not.toBe(
      deterministicPayloadHash('TEST', { a: 2 }),
    );
  });

  it('separates movement and current consensus features', () => {
    const input = featureInput();
    input.market = market({
      movementAvailable: true,
      movement: {
        HOME: 0.03,
        DRAW: -0.01,
        AWAY: -0.02,
      },
      recentMovement: {
        HOME: 0.02,
        DRAW: -0.005,
        AWAY: -0.015,
      },
      steamStrength: 0.6,
    });
    const result = buildMlMarketFeatureVector(input);
    const movementIndex = ML_MARKET_FEATURE_NAMES.indexOf('market_movement_available');
    const steamIndex = ML_MARKET_FEATURE_NAMES.indexOf('market_steam_strength');

    expect(result.featureVector[movementIndex]).toBe(1);
    expect(result.featureVector[steamIndex]).toBeCloseTo(0.6);
  });

  it('never lets extreme inputs escape the feature bounds', () => {
    const input = featureInput();
    input.home.goalsFor10 = 1000;
    input.away.goalsAgainst10 = -1000;
    input.market.averageDispersion = 10;
    const result = buildMlMarketFeatureVector(input);

    expect(Math.max(...result.featureVector)).toBeLessThanOrEqual(20);
    expect(Math.min(...result.featureVector)).toBeGreaterThanOrEqual(-20);
  });
});
