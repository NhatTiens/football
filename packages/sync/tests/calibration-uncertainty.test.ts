import { describe, expect, it } from 'vitest';

import {
  applyTemperature,
  fitTemperatureCalibrator,
  probabilityMetrics,
  temporalFixtureSplit,
  type CalibrationObservation,
} from '../src/calibration-uncertainty-contract.js';

function observation(index: number, probability: number, outcome: 'YES' | 'NO'): CalibrationObservation {
  return {
    fixtureId: index,
    leagueId: 1,
    horizonMinutes: 30,
    kickoffAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    marketKey: 'BTTS',
    probabilities: { YES: probability, NO: 1 - probability },
    outcome,
    componentDisagreement: 0.04,
  };
}

describe('Stage 5 calibration and uncertainty contract', () => {
  it('normalizes temperature-scaled probabilities', () => {
    const result = applyTemperature({ HOME: 0.7, DRAW: 0.2, AWAY: 0.1 }, 1.5);
    expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(result.HOME).toBeLessThan(0.7);
  });

  it('computes finite multiclass metrics', () => {
    const metrics = probabilityMetrics([
      observation(1, 0.7, 'YES'),
      observation(2, 0.3, 'NO'),
    ]);
    expect(metrics.samples).toBe(2);
    expect(metrics.brierScore).toBeGreaterThanOrEqual(0);
    expect(metrics.logLoss).toBeGreaterThanOrEqual(0);
    expect(metrics.ece).toBeGreaterThanOrEqual(0);
  });

  it('uses an identity calibrator for insufficient samples', () => {
    const calibrator = fitTemperatureCalibrator({
      observations: [observation(1, 0.9, 'NO')],
      scope: 'MARKET_HORIZON',
      marketKey: 'BTTS',
      horizonMinutes: 30,
      minimumSamples: 60,
    });
    expect(calibrator.accepted).toBe(false);
    expect(calibrator.temperature).toBe(1);
    expect(calibrator.rejectionReason).toBe('INSUFFICIENT_CALIBRATION_SAMPLE');
  });

  it('produces deterministic calibration artifacts', () => {
    const rows = Array.from({ length: 80 }, (_, index) =>
      observation(index, index % 2 === 0 ? 0.9 : 0.1, index % 4 === 0 ? 'YES' : 'NO'),
    );
    const first = fitTemperatureCalibrator({
      observations: rows,
      scope: 'MARKET_HORIZON',
      marketKey: 'BTTS',
      horizonMinutes: 30,
    });
    const second = fitTemperatureCalibrator({
      observations: rows,
      scope: 'MARKET_HORIZON',
      marketKey: 'BTTS',
      horizonMinutes: 30,
    });
    expect(first).toEqual(second);
  });

  it('splits all horizons of a fixture into the same chronological partition', () => {
    const split = temporalFixtureSplit({
      fixtures: Array.from({ length: 10 }, (_, index) => ({
        fixtureId: index + 1,
        kickoffAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      })),
    });
    expect([...split.values()].filter((value) => value === 'TRAIN')).toHaveLength(6);
    expect([...split.values()].filter((value) => value === 'CALIBRATION')).toHaveLength(2);
    expect([...split.values()].filter((value) => value === 'TEST')).toHaveLength(2);
  });
});
