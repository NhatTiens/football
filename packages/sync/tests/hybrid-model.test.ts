import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HYBRID_WEIGHT_REGISTRY,
  buildHybridMarketPrediction,
  hybridMarketPredictionHash,
  resolveHybridComponentWeights,
  type HybridModelComponent,
  type HybridWeightRegistry,
} from '../src/hybrid-model-contract.js';

const hdaComponents: HybridModelComponent[] = [
  {
    component: 'BAYESIAN',
    modelVersion: 'bayesian-v1',
    probabilities: { HOME: 0.5, DRAW: 0.28, AWAY: 0.22 },
  },
  {
    component: 'DIXON_COLES',
    modelVersion: 'dixon-v1',
    probabilities: { HOME: 0.46, DRAW: 0.3, AWAY: 0.24 },
  },
  {
    component: 'ML_SPECIALIST',
    modelVersion: 'ml-v1',
    probabilities: { HOME: 0.53, DRAW: 0.25, AWAY: 0.22 },
  },
];

describe('v8 hybrid model selection', () => {
  it('normalizes the blended probability and records every component', () => {
    const result = buildHybridMarketPrediction({
      market: 'HDA',
      leagueId: 39,
      horizonMinutes: 30,
      components: hdaComponents,
    });
    expect(
      result.rawProbability.HOME +
        result.rawProbability.DRAW +
        result.rawProbability.AWAY,
    ).toBeCloseTo(1, 12);
    expect(result.selectedModel).toBe('WEIGHTED_ENSEMBLE');
    expect(result.componentProbabilities).toHaveLength(3);
    expect(Object.values(result.componentWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
      12,
    );
  });

  it('falls back explicitly when specialist components are unavailable', () => {
    const result = buildHybridMarketPrediction({
      market: 'BTTS',
      leagueId: 39,
      horizonMinutes: 90,
      components: [
        {
          component: 'BAYESIAN',
          modelVersion: 'bayesian-v1',
          probabilities: { YES: 0.58, NO: 0.42 },
        },
      ],
    });
    expect(result.selectedModel).toBe('BAYESIAN');
    expect(result.fallbackReason).toContain('DIXON_COLES_UNAVAILABLE');
    expect(result.fallbackReason).toContain('ML_SPECIALIST_UNAVAILABLE');
    expect(result.fallbackReason).toContain('SINGLE_COMPONENT_FALLBACK');
  });

  it('supports market, horizon and league-specific weights', () => {
    const registry: HybridWeightRegistry = {
      ...DEFAULT_HYBRID_WEIGHT_REGISTRY,
      leagueMultipliers: { '39': { BAYESIAN: 2, ML_SPECIALIST: 0.5 } },
    };
    const early = resolveHybridComponentWeights({
      market: 'HDA',
      leagueId: 39,
      horizonMinutes: 180,
      availableComponents: ['BAYESIAN', 'DIXON_COLES', 'ML_SPECIALIST'],
      registry,
    });
    const late = resolveHybridComponentWeights({
      market: 'HDA',
      leagueId: 39,
      horizonMinutes: 5,
      availableComponents: ['BAYESIAN', 'DIXON_COLES', 'ML_SPECIALIST'],
      registry,
    });
    expect(early.BAYESIAN).toBeGreaterThan(early.ML_SPECIALIST);
    expect(late.ML_SPECIALIST).toBeGreaterThan(early.ML_SPECIALIST);
  });

  it('preserves an explicit push class for integer totals', () => {
    const result = buildHybridMarketPrediction({
      market: 'TOTAL_GOALS',
      line: 2,
      leagueId: 39,
      horizonMinutes: 30,
      components: [
        {
          component: 'BAYESIAN',
          modelVersion: 'bayesian-v1',
          probabilities: { BELOW: 0.35, PUSH: 0.24, ABOVE: 0.41 },
        },
        {
          component: 'DIXON_COLES',
          modelVersion: 'dixon-v1',
          probabilities: { BELOW: 0.32, PUSH: 0.26, ABOVE: 0.42 },
        },
      ],
    });
    expect(result.rawProbability.PUSH).toBeGreaterThan(0);
    expect(
      result.rawProbability.BELOW + result.rawProbability.PUSH + result.rawProbability.ABOVE,
    ).toBeCloseTo(1, 12);
  });

  it('does not admit market odds as a core model component', () => {
    const components = Object.keys(DEFAULT_HYBRID_WEIGHT_REGISTRY.baseWeights.HDA);
    expect(components).toEqual(['BAYESIAN', 'DIXON_COLES', 'ML_SPECIALIST']);
    expect(components).not.toContain('MARKET');
  });

  it('is deterministic and hash-stable', () => {
    const input = {
      market: 'HDA' as const,
      leagueId: 39,
      horizonMinutes: 30,
      components: hdaComponents,
    };
    const first = buildHybridMarketPrediction(input);
    const second = buildHybridMarketPrediction(input);
    expect(first).toEqual(second);
    expect(hybridMarketPredictionHash(first)).toBe(hybridMarketPredictionHash(second));
  });
});
