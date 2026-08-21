import { describe, expect, it } from 'vitest';
import {
  assessOuQualification,
  backtestByCompositeSlice,
  backtestByMarket,
  backtestByModelVersion,
  backtestByOddsRange,
  backtestByTimePeriod,
  buildCalibrationReport,
  buildOuGoalDistribution,
  calculateConfidenceScore,
  closingLineValue,
  estimateVenueExpectedGoals,
  fitDistributionCalibration,
  fractionalKellyStake,
  assessDataQuality,
  probabilityThresholdForOdds,
  removeTwoWayVig,
  settleAsianTotal,
  validateOuProbabilityConsistency,
} from '../src/ou-engine.js';

describe('O/U goal distribution engine', () => {
  it('rejects the historical non-monotone regression example', () => {
    const result = validateOuProbabilityConsistency({
      TOTAL_GOALS_1_5: { UNDER: 0.713, OVER: 0.287 },
      TOTAL_GOALS_2_5: { UNDER: 0.531, OVER: 0.469 },
      TOTAL_GOALS_3_5: { UNDER: 0.758, OVER: 0.242 },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('MODEL_CONSISTENCY_ERROR');
    expect(result.errors).toContain('UNDER_MONOTONICITY_VIOLATION');
  });

  it('always derives monotone O/U markets from one calibrated goal distribution', () => {
    for (let index = 0; index < 5_000; index += 1) {
      const expectedHomeGoals = 0.05 + Math.random() * 4.95;
      const expectedAwayGoals = 0.05 + Math.random() * 4.45;
      const rho = -0.35 + Math.random() * 0.7;
      const calibrationUnder25 = 0.03 + Math.random() * 0.94;
      const result = buildOuGoalDistribution({
        expectedHomeGoals,
        expectedAwayGoals,
        rho,
        calibrationUnder25,
      });
      const { TOTAL_GOALS_1_5: m15, TOTAL_GOALS_2_5: m25, TOTAL_GOALS_3_5: m35 } = result.markets;
      expect(result.consistency.valid).toBe(true);
      expect(result.calibratedTotalGoalProbabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
      expect(m15.UNDER).toBeLessThanOrEqual(m25.UNDER + 1e-9);
      expect(m25.UNDER).toBeLessThanOrEqual(m35.UNDER + 1e-9);
      expect(m15.OVER + 1e-9).toBeGreaterThanOrEqual(m25.OVER);
      expect(m25.OVER + 1e-9).toBeGreaterThanOrEqual(m35.OVER);
      expect(m25.UNDER).toBeCloseTo(calibrationUnder25, 7);
      expect(m15.UNDER + m15.OVER).toBeCloseTo(1, 10);
      expect(m25.UNDER + m25.OVER).toBeCloseTo(1, 10);
      expect(m35.UNDER + m35.OVER).toBeCloseTo(1, 10);
    }
  });

  it('removes two-way vig before model-vs-market comparison', () => {
    const fair = removeTwoWayVig(1.8, 2.0);
    expect(fair.OVER + fair.UNDER).toBeCloseTo(1, 12);
    expect(fair.rawOver + fair.rawUnder).toBeGreaterThan(1);
  });

  it('hard-blocks O/U odds outside 1.40-2.50', () => {
    const distribution = buildOuGoalDistribution({ expectedHomeGoals: 1.4, expectedAwayGoals: 1.1, calibrationUnder25: 0.65 });
    const dataQuality = assessDataQuality({
      historicalMatches: 20,
      leagueHistoricalMatches: 200,
      hasXg: true,
      hasShots: true,
      hasOdds: true,
      bookmakerCount: 5,
      oddsAgeMinutes: 15,
      hasLineup: true,
      hasInjuries: true,
      apiHealthy: true,
      modelUncertainty: 0.1,
    });
    const confidence = calculateConfidenceScore({
      modelAgreement: 0.9,
      calibrationReliability: 0.9,
      dataQualityScore: dataQuality.score,
      sampleReliability: 0.9,
      lineupCompleteness: 1,
      injuryCompleteness: 1,
      uncertainty: 0.1,
      historicalStability: 0.85,
    });
    const assessment = assessOuQualification({
      consistency: distribution.consistency,
      calibrationValid: true,
      dataQuality,
      confidence,
      edge: 0.1,
      expectedValue: 0.2,
      odds: 3.6,
      modelProbability: 0.7,
    });
    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons).toContain('ODDS_OUT_OF_RANGE');
    expect(probabilityThresholdForOdds(3.6)).toBe(1);
  });

  it('reports calibration and backtest slices with sample size', () => {
    const calibration = buildCalibrationReport([
      { probability: 0.7, actual: true },
      { probability: 0.7, actual: false },
      { probability: 0.7, actual: true },
      { probability: 0.7, actual: true },
    ]);
    expect(calibration.sampleSize).toBe(4);
    expect(calibration.brierScore).not.toBeNull();
    const rows = [
      { market: 'U2.5', odds: 1.8, predictedProbability: 0.62, actualWin: true, league: 'EPL', season: '2025', occurredAt: '2025-01-01', modelVersion: 'ou-v1' },
      { market: 'O2.5', odds: 2.1, predictedProbability: 0.52, actualWin: false, league: 'EPL', season: '2025', occurredAt: '2025-01-02', modelVersion: 'ou-v1' },
    ];
    expect(backtestByMarket(rows).every((slice) => slice.metrics.sampleSize > 0)).toBe(true);
    expect(backtestByOddsRange(rows).every((slice) => slice.metrics.sampleSize > 0)).toBe(true);
    expect(backtestByTimePeriod(rows)).toHaveLength(1);
    expect(backtestByTimePeriod(rows, 'QUARTER')).toHaveLength(1);
    expect(backtestByModelVersion(rows)).toHaveLength(1);
    expect(backtestByCompositeSlice(rows)).toHaveLength(2);
  });


  it('estimates separate home/away strengths with shrinkage instead of one season average', () => {
    const estimate = estimateVenueExpectedGoals({
      homeVenue: { matches: 12, goalsFor: 24, goalsAgainst: 10, xgFor: 22, xgAgainst: 11, shots: 170, shotsOnTarget: 70 },
      awayVenue: { matches: 12, goalsFor: 10, goalsAgainst: 20, xgFor: 11, xgAgainst: 19, shots: 120, shotsOnTarget: 42 },
      leagueHomeGoalsPerMatch: 1.55,
      leagueAwayGoalsPerMatch: 1.2,
      leagueHomeXgPerMatch: 1.5,
      leagueAwayXgPerMatch: 1.18,
      homeOpponentStrength: 1.05,
      awayOpponentStrength: 0.95,
      homeRecentMultiplier: 1.04,
      awayRecentMultiplier: 0.96,
    });
    expect(estimate.expectedHomeGoals).toBeGreaterThan(estimate.expectedAwayGoals);
    expect(estimate.homeAttackStrength).not.toBe(estimate.awayAttackStrength);
    expect(estimate.homeSampleWeight).toBeGreaterThan(0);
    expect(estimate.awaySampleWeight).toBeGreaterThan(0);
  });

  it('fits one distribution calibration shift and keeps CLV/Kelly conservative', () => {
    const calibration = fitDistributionCalibration([
      { rawUnder15: 0.35, rawUnder25: 0.58, rawUnder35: 0.76, actualTotalGoals: 2 },
      { rawUnder15: 0.30, rawUnder25: 0.52, rawUnder35: 0.72, actualTotalGoals: 4 },
      { rawUnder15: 0.42, rawUnder25: 0.67, rawUnder35: 0.82, actualTotalGoals: 1 },
    ]);
    expect(Number.isFinite(calibration.delta)).toBe(true);
    expect(calibration.sampleSize).toBe(3);
    expect(closingLineValue(1.90, 1.80)).toBeGreaterThan(0);
    const stake = fractionalKellyStake({
      calibratedProbability: 0.62, decimalOdds: 1.9, uncertaintyPenalty: 0.03,
      kellyFraction: 0.2, maximumStakeFraction: 0.015, dailyExposureRemainingFraction: 0.1,
      fixtureExposureRemainingFraction: 0.03, marketExposureRemainingFraction: 0.05,
      correlatedExposureRemainingFraction: 0.02,
    });
    expect(stake.conservativeProbability).toBeLessThan(0.62);
    expect(stake.stakeFraction).toBeLessThanOrEqual(0.015);
  });

  it('settles Asian quarter lines correctly', () => {
    expect(settleAsianTotal(2, 'OVER', 2.25, 1.9).result).toBe('HALF_LOSS');
    expect(settleAsianTotal(2, 'UNDER', 2.25, 1.9).result).toBe('HALF_WIN');
    expect(settleAsianTotal(3, 'OVER', 2.25, 1.9).result).toBe('FULL_WIN');
  });
});
