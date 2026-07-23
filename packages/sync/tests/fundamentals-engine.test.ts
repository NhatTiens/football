import { describe, expect, it } from 'vitest';

import {
  buildTeamFundamentals,
  dixonColesTau,
  exponentialTimeWeight,
  fitDynamicDixonColes,
  predictDixonColes,
  type DixonColesTrainingMatch,
  type HistoricalFixture,
} from '../src/fundamentals-core.js';

const DAY = 86_400_000;
const targetKickoff = new Date('2024-05-01T18:00:00.000Z');
const predictionAsOf = new Date('2024-05-01T16:30:00.000Z');

function fixture(input: {
  id: number;
  daysAgo: number;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  availableDelayHours?: number;
  metricCapturedDaysAgo?: number;
}): HistoricalFixture {
  const kickoffAt = new Date(targetKickoff.getTime() - input.daysAgo * DAY);
  const availableAt = new Date(kickoffAt.getTime() + (input.availableDelayHours ?? 3) * 3_600_000);
  const capturedAt =
    input.metricCapturedDaysAgo == null
      ? new Date(availableAt)
      : new Date(targetKickoff.getTime() - input.metricCapturedDaysAgo * DAY);

  return {
    fixtureId: input.id,
    leagueId: 1,
    kickoffAt,
    availableAt,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeGoals: input.homeGoals,
    awayGoals: input.awayGoals,
    homeMetric: {
      expectedGoals: input.homeGoals + 0.25,
      shots: 12,
      shotsOnGoal: 5,
      possession: 54,
      corners: 6,
      capturedAt,
    },
    awayMetric: {
      expectedGoals: input.awayGoals + 0.15,
      shots: 9,
      shotsOnGoal: 3,
      possession: 46,
      corners: 4,
      capturedAt,
    },
  };
}

function trainingMatches(count = 60): DixonColesTrainingMatch[] {
  return Array.from({ length: count }, (_, index) => {
    const homeTeamId = (index % 6) + 1;
    const awayTeamId = ((index + 2) % 6) + 1;
    const kickoffAt = new Date(predictionAsOf.getTime() - (count - index) * 2 * DAY);

    return {
      fixtureId: index + 1,
      kickoffAt,
      availableAt: new Date(kickoffAt.getTime() + 3 * 3_600_000),
      homeTeamId,
      awayTeamId,
      homeGoals: homeTeamId === 1 ? 3 : index % 4 === 0 ? 2 : 1,
      awayGoals: awayTeamId === 6 ? 0 : index % 5 === 0 ? 2 : 1,
    };
  });
}

describe('fundamentals engine core', () => {
  it('excludes the target fixture', () => {
    const rows = [
      fixture({
        id: 99,
        daysAgo: 0,
        homeTeamId: 1,
        awayTeamId: 2,
        homeGoals: 5,
        awayGoals: 0,
      }),
      fixture({
        id: 1,
        daysAgo: 4,
        homeTeamId: 1,
        awayTeamId: 3,
        homeGoals: 2,
        awayGoals: 1,
      }),
    ];

    const result = buildTeamFundamentals({
      fixtures: rows,
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.sampleSize).toBe(1);
    expect(result.sourceFixtureIds).toEqual([1]);
  });

  it('excludes future fixtures', () => {
    const future = fixture({
      id: 2,
      daysAgo: -1,
      homeTeamId: 1,
      awayTeamId: 3,
      homeGoals: 4,
      awayGoals: 0,
    });
    const past = fixture({
      id: 1,
      daysAgo: 4,
      homeTeamId: 1,
      awayTeamId: 3,
      homeGoals: 2,
      awayGoals: 1,
    });

    const result = buildTeamFundamentals({
      fixtures: [future, past],
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.sourceFixtureIds).toEqual([1]);
  });

  it('enforces result availability lag', () => {
    const unavailable = fixture({
      id: 1,
      daysAgo: 0.05,
      homeTeamId: 1,
      awayTeamId: 3,
      homeGoals: 4,
      awayGoals: 0,
      availableDelayHours: 5,
    });

    const result = buildTeamFundamentals({
      fixtures: [unavailable],
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.sampleSize).toBe(0);
  });

  it('builds 5, 10 and 20 match windows', () => {
    const fixtures = Array.from({ length: 24 }, (_, index) =>
      fixture({
        id: index + 1,
        daysAgo: index + 1,
        homeTeamId: index % 2 === 0 ? 1 : 3,
        awayTeamId: index % 2 === 0 ? 3 : 1,
        homeGoals: 2,
        awayGoals: 1,
      }),
    );

    const result = buildTeamFundamentals({
      fixtures,
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.windows[5].matches).toBe(5);
    expect(result.windows[10].matches).toBe(10);
    expect(result.windows[20].matches).toBe(20);
  });

  it('separates home and away venue form', () => {
    const rows = [
      fixture({
        id: 1,
        daysAgo: 2,
        homeTeamId: 1,
        awayTeamId: 3,
        homeGoals: 3,
        awayGoals: 0,
      }),
      fixture({
        id: 2,
        daysAgo: 4,
        homeTeamId: 3,
        awayTeamId: 1,
        homeGoals: 4,
        awayGoals: 0,
      }),
    ];

    const home = buildTeamFundamentals({
      fixtures: rows,
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });
    const away = buildTeamFundamentals({
      fixtures: rows,
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'AWAY',
    });

    expect(home.venueSummary.pointsPerGame).toBe(3);
    expect(away.venueSummary.pointsPerGame).toBe(0);
  });

  it('uses metrics captured before predictionAsOf', () => {
    const row = fixture({
      id: 1,
      daysAgo: 5,
      homeTeamId: 1,
      awayTeamId: 3,
      homeGoals: 1,
      awayGoals: 0,
      metricCapturedDaysAgo: 2,
    });

    const result = buildTeamFundamentals({
      fixtures: [row],
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.windows[5].expectedGoalsFor).toBeCloseTo(1.25);
    expect(result.windows[5].metricCoverage).toBe(1);
  });

  it('does not use metrics captured after predictionAsOf', () => {
    const row = fixture({
      id: 1,
      daysAgo: 5,
      homeTeamId: 1,
      awayTeamId: 3,
      homeGoals: 1,
      awayGoals: 0,
      metricCapturedDaysAgo: -2,
    });

    const result = buildTeamFundamentals({
      fixtures: [row],
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.windows[5].expectedGoalsFor).toBe(1);
    expect(result.windows[5].metricCoverage).toBe(0);
  });

  it('calculates finite rest days', () => {
    const result = buildTeamFundamentals({
      fixtures: [
        fixture({
          id: 1,
          daysAgo: 5,
          homeTeamId: 1,
          awayTeamId: 3,
          homeGoals: 1,
          awayGoals: 0,
        }),
      ],
      teamId: 1,
      leagueId: 1,
      targetFixtureId: 99,
      targetKickoffAt: targetKickoff,
      predictionAsOf,
      venueRole: 'HOME',
    });

    expect(result.restDays).toBeCloseTo(5);
  });

  it('gives recent matches larger time weight', () => {
    const recent = exponentialTimeWeight({
      matchKickoffAt: new Date(predictionAsOf.getTime() - 10 * DAY),
      predictionAsOf,
      halfLifeDays: 100,
    });
    const old = exponentialTimeWeight({
      matchKickoffAt: new Date(predictionAsOf.getTime() - 200 * DAY),
      predictionAsOf,
      halfLifeDays: 100,
    });

    expect(recent).toBeGreaterThan(old);
  });

  it('has half weight at one half-life', () => {
    const weight = exponentialTimeWeight({
      matchKickoffAt: new Date(predictionAsOf.getTime() - 100 * DAY),
      predictionAsOf,
      halfLifeDays: 100,
    });

    expect(weight).toBeCloseTo(0.5, 6);
  });

  it('keeps Dixon-Coles tau positive', () => {
    for (const [homeGoals, awayGoals] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 2],
    ]) {
      expect(
        dixonColesTau({
          homeGoals,
          awayGoals,
          homeExpectedGoals: 1.4,
          awayExpectedGoals: 1.1,
          rho: -0.12,
        }),
      ).toBeGreaterThan(0);
    }
  });

  it('returns null with insufficient training history', () => {
    expect(
      fitDynamicDixonColes({
        leagueId: 1,
        matches: trainingMatches(10),
        predictionAsOf,
      }),
    ).toBeNull();
  });

  it('fits a finite dynamic Dixon-Coles model', () => {
    const model = fitDynamicDixonColes({
      leagueId: 1,
      matches: trainingMatches(),
      predictionAsOf,
      options: {
        iterations: 60,
      },
    });

    expect(model).not.toBeNull();
    expect(Number.isFinite(model?.intercept)).toBe(true);
    expect(Number.isFinite(model?.homeAdvantage)).toBe(true);
    expect(Number.isFinite(model?.rho)).toBe(true);
  });

  it('never trains through predictionAsOf', () => {
    const model = fitDynamicDixonColes({
      leagueId: 1,
      matches: trainingMatches(),
      predictionAsOf,
      options: {
        iterations: 60,
      },
    });

    expect(model?.trainedThrough.getTime()).toBeLessThanOrEqual(predictionAsOf.getTime());
  });

  it('normalizes match winner probabilities', () => {
    const model = fitDynamicDixonColes({
      leagueId: 1,
      matches: trainingMatches(),
      predictionAsOf,
      options: {
        iterations: 60,
      },
    });
    expect(model).not.toBeNull();

    const prediction = predictDixonColes({
      model: model!,
      homeTeamId: 1,
      awayTeamId: 6,
    });
    const total =
      prediction.matchWinner.HOME + prediction.matchWinner.DRAW + prediction.matchWinner.AWAY;

    expect(total).toBeCloseTo(1, 8);
  });

  it('normalizes over 2.5 probabilities', () => {
    const model = fitDynamicDixonColes({
      leagueId: 1,
      matches: trainingMatches(),
      predictionAsOf,
      options: {
        iterations: 60,
      },
    });
    const prediction = predictDixonColes({
      model: model!,
      homeTeamId: 1,
      awayTeamId: 6,
    });

    expect(prediction.over25.OVER + prediction.over25.UNDER).toBeCloseTo(1, 8);
  });

  it('normalizes BTTS probabilities', () => {
    const model = fitDynamicDixonColes({
      leagueId: 1,
      matches: trainingMatches(),
      predictionAsOf,
      options: {
        iterations: 60,
      },
    });
    const prediction = predictDixonColes({
      model: model!,
      homeTeamId: 1,
      awayTeamId: 6,
    });

    expect(prediction.btts.YES + prediction.btts.NO).toBeCloseTo(1, 8);
  });

  it('produces positive bounded expected goals', () => {
    const model = fitDynamicDixonColes({
      leagueId: 1,
      matches: trainingMatches(),
      predictionAsOf,
      options: {
        iterations: 60,
      },
    });
    const prediction = predictDixonColes({
      model: model!,
      homeTeamId: 1,
      awayTeamId: 6,
    });

    expect(prediction.homeExpectedGoals).toBeGreaterThan(0);
    expect(prediction.awayExpectedGoals).toBeGreaterThan(0);
    expect(prediction.homeExpectedGoals).toBeLessThanOrEqual(5);
    expect(prediction.awayExpectedGoals).toBeLessThanOrEqual(4.5);
  });
});
