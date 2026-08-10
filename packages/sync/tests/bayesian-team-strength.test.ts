import { describe, expect, it } from 'vitest';

import {
  BAYESIAN_TEAM_STRENGTH_VERSION,
  bayesianTeamStrengthPredictionHash,
  fitBayesianHierarchicalTeamStrength,
  type BayesianTrainingMatch,
} from '../src/bayesian-team-strength-contract.js';

const predictionAsOf = new Date('2026-01-20T12:00:00.000Z');
const datasetFingerprint = 'stage1-fingerprint';

function match(input: {
  fixtureId: number;
  daysAgo: number;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  availableAt?: Date;
}): BayesianTrainingMatch {
  const kickoffAt = new Date(predictionAsOf.getTime() - input.daysAgo * 86_400_000);
  return {
    fixtureId: input.fixtureId,
    leagueId: 39,
    kickoffAt,
    availableAt:
      input.availableAt ?? new Date(kickoffAt.getTime() + 180 * 60_000),
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeGoals: input.homeGoals,
    awayGoals: input.awayGoals,
  };
}

function neutralHistory(count = 20): BayesianTrainingMatch[] {
  return Array.from({ length: count }, (_, index) =>
    match({
      fixtureId: 100 + index,
      daysAgo: 40 - index,
      homeTeamId: 10 + (index % 4),
      awayTeamId: 20 + (index % 4),
      homeGoals: index % 3 === 0 ? 2 : 1,
      awayGoals: index % 4 === 0 ? 2 : 1,
    }),
  );
}

function fit(matches: BayesianTrainingMatch[], homeTeamId = 1) {
  return fitBayesianHierarchicalTeamStrength({
    fixtureId: 999,
    leagueId: 39,
    homeTeamId,
    awayTeamId: 2,
    predictionAsOf,
    matches,
    datasetFingerprint,
  });
}

describe('Bayesian hierarchical team strength', () => {
  it('is deterministic for the same dataset and fixed seed', () => {
    const rows = [
      ...neutralHistory(),
      match({ fixtureId: 1, daysAgo: 3, homeTeamId: 1, awayTeamId: 3, homeGoals: 3, awayGoals: 0 }),
    ];
    const first = fit(rows);
    const second = fit([...rows].reverse());

    expect(first).toEqual(second);
    expect(bayesianTeamStrengthPredictionHash(first)).toBe(
      bayesianTeamStrengthPredictionHash(second),
    );
    expect(first.version).toBe(BAYESIAN_TEAM_STRENGTH_VERSION);
  });

  it('strictly excludes results available exactly at predictionAsOf', () => {
    const row = match({
      fixtureId: 1,
      daysAgo: 1,
      homeTeamId: 1,
      awayTeamId: 2,
      homeGoals: 5,
      awayGoals: 0,
      availableAt: predictionAsOf,
    });
    const result = fit([row]);

    expect(result.trainingMatches).toBe(0);
    expect(result.trainedThrough).toBeNull();
    expect(result.priorOnly).toBe(true);
  });

  it('shrinks a low-sample team more strongly toward the league prior', () => {
    const background = neutralHistory(24);
    const sparse = fit([
      ...background,
      match({ fixtureId: 1, daysAgo: 2, homeTeamId: 1, awayTeamId: 30, homeGoals: 4, awayGoals: 0 }),
    ]);
    const established = fit([
      ...background,
      ...Array.from({ length: 10 }, (_, index) =>
        match({
          fixtureId: 300 + index,
          daysAgo: 12 - index,
          homeTeamId: 1,
          awayTeamId: 30 + index,
          homeGoals: 4,
          awayGoals: 0,
        }),
      ),
    ]);

    expect(sparse.home.rawMatches).toBe(1);
    expect(established.home.rawMatches).toBe(10);
    expect(Math.abs(sparse.homeAttackPosterior)).toBeLessThan(
      Math.abs(established.homeAttackPosterior),
    );
    expect(sparse.home.attack.varianceLogStrength).toBeGreaterThan(
      established.home.attack.varianceLogStrength,
    );
  });

  it('applies time decay so recent evidence has more effective weight', () => {
    const recent = fit([
      ...neutralHistory(),
      match({ fixtureId: 1, daysAgo: 2, homeTeamId: 1, awayTeamId: 3, homeGoals: 4, awayGoals: 0 }),
    ]);
    const old = fit([
      ...neutralHistory(),
      match({ fixtureId: 1, daysAgo: 720, homeTeamId: 1, awayTeamId: 3, homeGoals: 4, awayGoals: 0 }),
    ]);

    expect(recent.home.effectiveMatches).toBeGreaterThan(old.home.effectiveMatches);
    expect(recent.homeAttackPosterior).toBeGreaterThan(old.homeAttackPosterior);
  });

  it('returns finite posterior outputs and a strict training cutoff', () => {
    const result = fit(neutralHistory());
    const numericValues = [
      result.expectedHomeGoals,
      result.expectedAwayGoals,
      result.homeAttackPosterior,
      result.homeDefencePosterior,
      result.awayAttackPosterior,
      result.awayDefencePosterior,
      result.homeAdvantagePosterior,
      result.posteriorUncertainty,
    ];

    expect(numericValues.every(Number.isFinite)).toBe(true);
    expect(result.expectedHomeGoals).toBeGreaterThan(0);
    expect(result.expectedAwayGoals).toBeGreaterThan(0);
    expect(result.trainedThrough!.getTime()).toBeLessThan(result.predictionAsOf.getTime());
    expect(result.expectedHomeGoalsInterval.lower90).toBeLessThan(result.expectedHomeGoals);
    expect(result.expectedHomeGoalsInterval.upper90).toBeGreaterThan(result.expectedHomeGoals);
  });
});
