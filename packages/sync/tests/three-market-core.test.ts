import { describe, expect, it } from 'vitest';
import {
  THREE_MARKET_TOTAL_LINES,
  buildThreeMarketProjection,
} from '../src/three-market-core.js';

describe('three-market-core', () => {
  it('keeps HDA and binary markets normalized', () => {
    const projection = buildThreeMarketProjection({
      homeExpectedGoals: 1.75,
      awayExpectedGoals: 1.05,
      dataQuality: 0.9,
    });

    expect(
      projection.hda.probabilities.HOME +
        projection.hda.probabilities.DRAW +
        projection.hda.probabilities.AWAY,
    ).toBeCloseTo(1, 10);
    expect(projection.btts.probabilities.YES + projection.btts.probabilities.NO).toBeCloseTo(1, 10);
    for (const line of THREE_MARKET_TOTAL_LINES) {
      expect(
        projection.totals[line].probabilities.OVER +
          projection.totals[line].probabilities.UNDER,
      ).toBeCloseTo(1, 10);
    }
  });

  it('keeps total-goal lines monotonic', () => {
    const projection = buildThreeMarketProjection({
      homeExpectedGoals: 1.6,
      awayExpectedGoals: 1.25,
    });
    expect(projection.totals[1.5].probabilities.OVER).toBeGreaterThanOrEqual(
      projection.totals[2.5].probabilities.OVER,
    );
    expect(projection.totals[2.5].probabilities.OVER).toBeGreaterThanOrEqual(
      projection.totals[3.5].probabilities.OVER,
    );
  });

  it('moves the entire total-goal distribution toward a direct O2.5 model', () => {
    const baseline = buildThreeMarketProjection({
      homeExpectedGoals: 1.25,
      awayExpectedGoals: 1.05,
      dataQuality: 0.9,
    });
    const upgraded = buildThreeMarketProjection({
      homeExpectedGoals: 1.25,
      awayExpectedGoals: 1.05,
      dataQuality: 0.9,
      directModelReliability: 0.9,
      directModel: { over25: 0.74 },
    });
    expect(upgraded.totals[2.5].probabilities.OVER).toBeGreaterThan(
      baseline.totals[2.5].probabilities.OVER,
    );
    expect(upgraded.totals[1.5].probabilities.OVER).toBeGreaterThanOrEqual(
      upgraded.totals[2.5].probabilities.OVER,
    );
    expect(upgraded.totals[2.5].probabilities.OVER).toBeGreaterThanOrEqual(
      upgraded.totals[3.5].probabilities.OVER,
    );
  });

  it('lets BTTS react independently to the direct specialist', () => {
    const baseline = buildThreeMarketProjection({
      homeExpectedGoals: 1.45,
      awayExpectedGoals: 1.35,
      dataQuality: 0.85,
    });
    const upgraded = buildThreeMarketProjection({
      homeExpectedGoals: 1.45,
      awayExpectedGoals: 1.35,
      dataQuality: 0.85,
      directModelReliability: 0.9,
      directModel: { bttsYes: 0.78 },
    });
    expect(upgraded.btts.probabilities.YES).toBeGreaterThan(
      baseline.btts.probabilities.YES,
    );
  });

  it('lets HDA react to a direct multiclass specialist while staying normalized', () => {
    const projection = buildThreeMarketProjection({
      homeExpectedGoals: 1.35,
      awayExpectedGoals: 1.2,
      dataQuality: 0.92,
      directModelReliability: 0.9,
      directModel: {
        hda: { HOME: 0.62, DRAW: 0.23, AWAY: 0.15 },
      },
    });
    expect(projection.hda.probabilities.HOME).toBeGreaterThan(
      projection.hda.probabilities.AWAY,
    );
    expect(
      projection.hda.probabilities.HOME +
        projection.hda.probabilities.DRAW +
        projection.hda.probabilities.AWAY,
    ).toBeCloseTo(1, 10);
  });

  it('uses PASS when confidence is weak', () => {
    const projection = buildThreeMarketProjection({
      homeExpectedGoals: 1.15,
      awayExpectedGoals: 1.15,
      dataQuality: 0.25,
      uncertainty: { hda: 0.2, over25: 0.2, btts: 0.2 },
    });
    expect(projection.hda.grade).toBe('PASS');
    expect(projection.bestPrediction).toBeNull();
  });
});
