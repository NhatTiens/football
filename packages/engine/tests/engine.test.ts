import { describe, expect, it } from 'vitest';
import {
  analyzeFixtureLineups,
  buildOddsConsensusOverUnderCandidates,
  buildRecommendationCandidates,
  deriveMarketProbabilities,
  expectedValue,
  removeVig,
  profitForSettlement,
  settleSelection,
} from '../src/index.js';

describe('odds math', () => {
  it('removes bookmaker margin', () => {
    const fair = removeVig([
      { code: 'HOME', odds: 2.1 },
      { code: 'DRAW', odds: 3.4 },
      { code: 'AWAY', odds: 3.6 },
    ]);
    expect(fair.reduce((sum, row) => sum + row.fairProbability, 0)).toBeCloseTo(1, 8);
  });

  it('calculates EV', () => {
    expect(expectedValue(0.5, 2.1)).toBeCloseTo(0.05, 8);
  });
});

describe('poisson markets', () => {
  it('produces normalized probabilities', () => {
    const markets = deriveMarketProbabilities({ home: 1.8, away: 1.1, sampleSize: 10 });
    expect(
      markets.MATCH_WINNER.HOME + markets.MATCH_WINNER.DRAW + markets.MATCH_WINNER.AWAY,
    ).toBeCloseTo(1, 8);
    expect(markets.TOTAL_GOALS_2_5.OVER + markets.TOTAL_GOALS_2_5.UNDER).toBeCloseTo(1, 8);
  });
});

describe('recommendation ranking', () => {
  it('returns candidates that pass configured thresholds', () => {
    const now = new Date();
    const candidates = buildRecommendationCandidates({
      now,
      historySampleSize: 10,
      dataQualityScore: 0.9,
      rules: {
        minimumOdds: 1.4,
        maximumOdds: 4,
        minimumExpectedValue: 0.02,
        minimumEdge: 0.01,
        minimumConfidence: 0.4,
        minimumDataQuality: 0.5,
        maximumOddsAgeMinutes: 60,
        minimumBookmakers: 1,
        topPerFixture: 3,
      },
      probabilities: {
        MATCH_WINNER: { HOME: 0.6, DRAW: 0.22, AWAY: 0.18 },
        TOTAL_GOALS_2_5: { OVER: 0.62, UNDER: 0.38 },
        BTTS: { YES: 0.58, NO: 0.42 },
      },
      odds: [
        {
          id: 1,
          bookmakerId: 1,
          bookmakerName: 'A',
          marketCode: 'TOTAL_GOALS_2_5',
          marketName: 'Goals O/U',
          marketGroup: 'TOTALS',
          selectionCode: 'OVER',
          selectionName: 'Over 2.5',
          lineValue: 2.5,
          decimalOdds: 1.9,
          capturedAt: now,
        },
        {
          id: 2,
          bookmakerId: 1,
          bookmakerName: 'A',
          marketCode: 'TOTAL_GOALS_2_5',
          marketName: 'Goals O/U',
          marketGroup: 'TOTALS',
          selectionCode: 'UNDER',
          selectionName: 'Under 2.5',
          lineValue: 2.5,
          decimalOdds: 1.95,
          capturedAt: now,
        },
      ],
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.expectedValue).toBeGreaterThan(0);
  });
});


describe('settlement', () => {
  it('settles 1X2, totals and BTTS correctly', () => {
    expect(settleSelection({ marketCode: 'MATCH_WINNER', selectionCode: 'HOME', lineValue: null, homeGoals: 2, awayGoals: 1 })).toBe('WIN');
    expect(settleSelection({ marketCode: 'TOTAL_GOALS_2_5', selectionCode: 'OVER', lineValue: 2.5, homeGoals: 2, awayGoals: 1 })).toBe('WIN');
    expect(settleSelection({ marketCode: 'BTTS', selectionCode: 'NO', lineValue: null, homeGoals: 2, awayGoals: 0 })).toBe('WIN');
  });

  it('calculates fixed-stake profit', () => {
    expect(profitForSettlement('WIN', 2.1, 1)).toBeCloseTo(1.1);
    expect(profitForSettlement('LOSS', 2.1, 1)).toBe(-1);
    expect(profitForSettlement('PUSH', 2.1, 1)).toBe(0);
  });
});


describe('odds-only over/under consensus', () => {
  it('finds a value price using leave-one-bookmaker-out consensus', () => {
    const now = new Date();
    const common = {
      marketCode: 'TOTAL_GOALS_2_5' as const,
      marketName: 'Goals O/U',
      marketGroup: 'TOTALS',
      lineValue: 2.5,
      capturedAt: now,
    };
    const candidates = buildOddsConsensusOverUnderCandidates({
      now,
      rules: {
        lineValue: 2.5,
        minimumOdds: 1.6,
        maximumOdds: 2.5,
        minimumExpectedValue: 0.01,
        minimumEdge: 0.005,
        minimumConfidence: 0.2,
        minimumDataQuality: 0.2,
        maximumOddsAgeMinutes: 60,
        minimumCompleteBookmakers: 3,
        minimumReferenceBookmakers: 2,
        maximumProbabilityStddev: 0.05,
        topPerFixture: 1,
      },
      odds: [
        { ...common, id: 1, bookmakerId: 1, bookmakerName: 'A', selectionCode: 'OVER', selectionName: 'Over 2.5', decimalOdds: 1.91 },
        { ...common, id: 2, bookmakerId: 1, bookmakerName: 'A', selectionCode: 'UNDER', selectionName: 'Under 2.5', decimalOdds: 1.91 },
        { ...common, id: 3, bookmakerId: 2, bookmakerName: 'B', selectionCode: 'OVER', selectionName: 'Over 2.5', decimalOdds: 1.90 },
        { ...common, id: 4, bookmakerId: 2, bookmakerName: 'B', selectionCode: 'UNDER', selectionName: 'Under 2.5', decimalOdds: 1.92 },
        { ...common, id: 5, bookmakerId: 3, bookmakerName: 'C', selectionCode: 'OVER', selectionName: 'Over 2.5', decimalOdds: 2.05 },
        { ...common, id: 6, bookmakerId: 3, bookmakerName: 'C', selectionCode: 'UNDER', selectionName: 'Under 2.5', decimalOdds: 1.78 },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.selectionCode).toBe('OVER');
    expect(candidates[0]!.bookmakerName).toBe('C');
    expect(candidates[0]!.expectedValue).toBeGreaterThan(0);
  });
});


describe('lineup impact', () => {
  it('blocks recommendations when confirmed lineups are required but missing', () => {
    const baseTeam = {
      teamId: 1,
      teamName: 'Team A',
      confirmed: false,
      starterCount: 0,
      formation: null,
      historyMatches: 8,
      previousLineupOverlap: null,
      rotationCount: null,
      missingRegulars: [],
    };
    const result = analyzeFixtureLineups({
      home: baseTeam,
      away: { ...baseTeam, teamId: 2, teamName: 'Team B' },
      rules: {
        enabled: true,
        requireConfirmed: true,
        minimumHistoryMatches: 5,
        rotationWarningThreshold: 4,
        probabilityAdjustmentEnabled: true,
        maximumProbabilityAdjustment: 0.025,
      },
    });
    expect(result.blockRecommendation).toBe(true);
  });

  it('moves Over probability upward when a regular goalkeeper is absent', () => {
    const result = analyzeFixtureLineups({
      home: {
        teamId: 1,
        teamName: 'Team A',
        confirmed: true,
        starterCount: 11,
        formation: '4-3-3',
        historyMatches: 10,
        previousLineupOverlap: 10,
        rotationCount: 1,
        missingRegulars: [
          {
            playerId: 10,
            playerName: 'Regular goalkeeper',
            positionGroup: 'GOALKEEPER',
            starts: 9,
            historyMatches: 10,
            startRate: 0.9,
          },
        ],
      },
      away: {
        teamId: 2,
        teamName: 'Team B',
        confirmed: true,
        starterCount: 11,
        formation: '4-2-3-1',
        historyMatches: 10,
        previousLineupOverlap: 11,
        rotationCount: 0,
        missingRegulars: [],
      },
      rules: {
        enabled: true,
        requireConfirmed: true,
        minimumHistoryMatches: 5,
        rotationWarningThreshold: 4,
        probabilityAdjustmentEnabled: true,
        maximumProbabilityAdjustment: 0.025,
      },
    });
    expect(result.blockRecommendation).toBe(false);
    expect(result.overProbabilityAdjustment).toBeGreaterThan(0);
  });
});
