import { describe, expect, it } from 'vitest';
import {
  binaryPrevalenceBaseline,
  multiclassClimatologyBaseline,
  pearsonCorrelation,
  properScoreSkill,
  rankAuc,
  summarizeHorizonSensitivity,
} from '../src/predictive-signal-audit.js';

describe('R4 predictive signal audit helpers', () => {
  it('computes rank AUC and correlation', () => {
    expect(rankAuc([0.1, 0.2, 0.8, 0.9], [false, false, true, true])).toBeCloseTo(1, 8);
    expect(pearsonCorrelation([1,2,3,4], [2,4,6,8])).toBeCloseTo(1, 8);
  });

  it('computes prevalence/climatology proper-score baselines', () => {
    const binary = binaryPrevalenceBaseline([true, true, true, false]);
    expect(binary.brier).toBeCloseTo(0.1875, 8);
    expect((binary.logLoss ?? 0) > 0).toBe(true);
    const multi = multiclassClimatologyBaseline(['HOME','HOME','DRAW','AWAY']);
    expect((multi.brier ?? 0) > 0).toBe(true);
    expect(properScoreSkill(0.15, 0.2)).toBeCloseTo(0.25, 8);
  });

  it('detects unchanged horizons', () => {
    const make = (fixtureId: number, horizonMinutes: number, shift: number) => ({
      fixtureId,
      horizonMinutes,
      features: [1 + shift, 2],
      probabilities: {
        hdaHome: 0.5 + shift,
        hdaDraw: 0.25,
        hdaAway: 0.25 - shift,
        over15: 0.8,
        over25: 0.55,
        over35: 0.3,
        btts: 0.52,
      },
      coverage: { model: true, marketMovement: false, lineup: false, injury: false },
    });
    const summary = summarizeHorizonSensitivity([
      make(1, 90, 0),
      make(1, 30, 0),
      make(1, 5, 0.01),
    ], [90,30,5]);
    expect(summary[0]!.featureChangeCoverage).toBe(0);
    expect(summary[1]!.featureChangeCoverage).toBe(1);
  });
});
