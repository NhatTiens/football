import { describe, expect, it } from 'vitest';

import {
  FUTURE_BEST_BET_MINIMUM_ODDS,
  SCIENTIFIC_MULTI_MARKET_PORT_POLICY,
  SCIENTIFIC_MULTI_MARKET_PORT_VERSION,
  buildPortedLegacyCandidates,
  deriveLegacyScientificProbabilities,
  getScientificMultiMarketPortReport,
  legacyProbabilitiesToScientific,
  settlePortedLegacySelection,
  settlePortedLegacySelectionAtOdds,
  toLegacyModelProbabilitySet,
} from '../src/scientific-multi-market-port.js';

function sampleLegacyProbabilities() {
  return {
    MATCH_WINNER: {
      HOME: 0.5,
      DRAW: 0.3,
      AWAY: 0.2,
    },
    TOTAL_GOALS_2_5: {
      OVER: 0.6,
      UNDER: 0.4,
    },
    BTTS: {
      YES: 0.55,
      NO: 0.45,
    },
    expectedGoals: {
      home: 1.7,
      away: 1.2,
      sampleSize: 8,
    },
  };
}

describe('v7.0-beta.1A.2 legacy multi-market scientific port', () => {
  it('uses stable version', () => {
    expect(SCIENTIFIC_MULTI_MARKET_PORT_VERSION).toContain('beta.1A.2');
  });

  it('uses non-promotional policy', () => {
    expect(SCIENTIFIC_MULTI_MARKET_PORT_POLICY).toBe('legacy-capability-port-non-promotional-v1');
  });

  it('reserves future minimum odds 1.40', () => {
    expect(FUTURE_BEST_BET_MINIMUM_ODDS).toBe(1.4);
  });

  it('ports seven legacy selections', () => {
    expect(legacyProbabilitiesToScientific(sampleLegacyProbabilities())).toHaveLength(7);
  });

  it('ports HDA HOME', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'MATCH_WINNER' && row.selectionCode === 'HOME')
        ?.probability,
    ).toBe(0.5);
  });

  it('ports HDA DRAW', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'MATCH_WINNER' && row.selectionCode === 'DRAW')
        ?.probability,
    ).toBe(0.3);
  });

  it('ports HDA AWAY', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'MATCH_WINNER' && row.selectionCode === 'AWAY')
        ?.probability,
    ).toBe(0.2);
  });

  it('normalizes legacy O/U 2.5 to TOTAL_GOALS line 2.5', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'TOTAL_GOALS' && row.selectionCode === 'OVER')
        ?.lineValue,
    ).toBe(2.5);
  });

  it('ports Over 2.5 probability', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'TOTAL_GOALS' && row.selectionCode === 'OVER')
        ?.probability,
    ).toBe(0.6);
  });

  it('ports Under 2.5 probability', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'TOTAL_GOALS' && row.selectionCode === 'UNDER')
        ?.probability,
    ).toBe(0.4);
  });

  it('ports BTTS YES', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'BTTS' && row.selectionCode === 'YES')?.probability,
    ).toBe(0.55);
  });

  it('ports BTTS NO', () => {
    const rows = legacyProbabilitiesToScientific(sampleLegacyProbabilities());
    expect(
      rows.find((row) => row.marketCode === 'BTTS' && row.selectionCode === 'NO')?.probability,
    ).toBe(0.45);
  });

  it('round-trips scientific rows to legacy probability set', () => {
    const legacy = toLegacyModelProbabilitySet(
      legacyProbabilitiesToScientific(sampleLegacyProbabilities()),
    );
    expect(legacy).toEqual({
      MATCH_WINNER: {
        HOME: 0.5,
        DRAW: 0.3,
        AWAY: 0.2,
      },
      TOTAL_GOALS_2_5: {
        OVER: 0.6,
        UNDER: 0.4,
      },
      BTTS: {
        YES: 0.55,
        NO: 0.45,
      },
    });
  });

  it('rejects invalid probability', () => {
    const invalid = sampleLegacyProbabilities();
    invalid.BTTS.YES = 1.2;
    expect(() => legacyProbabilitiesToScientific(invalid)).toThrow();
  });

  it('rejects non-normalized HDA probabilities', () => {
    const invalid = sampleLegacyProbabilities();
    invalid.MATCH_WINNER.HOME = 0.7;
    expect(() => legacyProbabilitiesToScientific(invalid)).toThrow();
  });

  it('derives all seven selections from expected goals', () => {
    const rows = deriveLegacyScientificProbabilities({
      home: 1.6,
      away: 1.1,
      sampleSize: 10,
    });
    expect(rows).toHaveLength(7);
  });

  it('derived HDA sums to one', () => {
    const rows = deriveLegacyScientificProbabilities({
      home: 1.6,
      away: 1.1,
      sampleSize: 10,
    });
    const sum = rows
      .filter((row) => row.marketCode === 'MATCH_WINNER')
      .reduce((acc, row) => acc + row.probability, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('derived total goals sums to one', () => {
    const rows = deriveLegacyScientificProbabilities({
      home: 1.6,
      away: 1.1,
      sampleSize: 10,
    });
    const sum = rows
      .filter((row) => row.marketCode === 'TOTAL_GOALS')
      .reduce((acc, row) => acc + row.probability, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('derived BTTS sums to one', () => {
    const rows = deriveLegacyScientificProbabilities({
      home: 1.6,
      away: 1.1,
      sampleSize: 10,
    });
    const sum = rows
      .filter((row) => row.marketCode === 'BTTS')
      .reduce((acc, row) => acc + row.probability, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('settles HDA home win', () => {
    expect(
      settlePortedLegacySelection({
        marketCode: 'MATCH_WINNER',
        selectionCode: 'HOME',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 1,
      }).result,
    ).toBe('WIN');
  });

  it('settles HDA draw loss', () => {
    expect(
      settlePortedLegacySelection({
        marketCode: 'MATCH_WINNER',
        selectionCode: 'DRAW',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 1,
      }).result,
    ).toBe('LOSS');
  });

  it('settles Over 2.5 win', () => {
    expect(
      settlePortedLegacySelection({
        marketCode: 'TOTAL_GOALS',
        selectionCode: 'OVER',
        lineValue: 2.5,
        homeGoals: 2,
        awayGoals: 1,
      }).result,
    ).toBe('WIN');
  });

  it('settles Under 2.5 win', () => {
    expect(
      settlePortedLegacySelection({
        marketCode: 'TOTAL_GOALS',
        selectionCode: 'UNDER',
        lineValue: 2.5,
        homeGoals: 1,
        awayGoals: 1,
      }).result,
    ).toBe('WIN');
  });

  it('rejects new total-goal lines during beta.1A.2', () => {
    expect(() =>
      settlePortedLegacySelection({
        marketCode: 'TOTAL_GOALS',
        selectionCode: 'OVER',
        lineValue: 1.5,
        homeGoals: 2,
        awayGoals: 1,
      }),
    ).toThrow(/beta\.1A\.3/);
  });

  it('settles BTTS YES win', () => {
    expect(
      settlePortedLegacySelection({
        marketCode: 'BTTS',
        selectionCode: 'YES',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 1,
      }).result,
    ).toBe('WIN');
  });

  it('settles BTTS NO win', () => {
    expect(
      settlePortedLegacySelection({
        marketCode: 'BTTS',
        selectionCode: 'NO',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 0,
      }).result,
    ).toBe('WIN');
  });

  it('uses fixed one-unit settlement for scientific evaluation', () => {
    const result = settlePortedLegacySelectionAtOdds({
      marketCode: 'BTTS',
      selectionCode: 'YES',
      lineValue: null,
      decimalOdds: 1.8,
      homeGoals: 2,
      awayGoals: 1,
    });
    expect(result.fixedStakeUnits).toBe(1);
    expect(result.profitUnits).toBeCloseTo(0.8, 12);
  });

  it('rejects invalid decimal odds', () => {
    expect(() =>
      settlePortedLegacySelectionAtOdds({
        marketCode: 'BTTS',
        selectionCode: 'YES',
        lineValue: null,
        decimalOdds: 1,
        homeGoals: 2,
        awayGoals: 1,
      }),
    ).toThrow();
  });

  it('does not mark settlement evidence promotional', () => {
    expect(
      settlePortedLegacySelectionAtOdds({
        marketCode: 'MATCH_WINNER',
        selectionCode: 'HOME',
        lineValue: null,
        decimalOdds: 2,
        homeGoals: 1,
        awayGoals: 0,
      }).promotional,
    ).toBe(false);
  });

  it('builds a ported candidate using the legacy recommendation engine', () => {
    const now = new Date('2024-01-01T10:00:00Z');
    const odds = [
      {
        id: 1,
        bookmakerId: 1,
        bookmakerName: 'Book A',
        marketCode: 'BTTS' as const,
        marketName: 'Both Teams To Score',
        marketGroup: 'GOALS',
        selectionCode: 'YES',
        selectionName: 'Yes',
        lineValue: null,
        decimalOdds: 2,
        capturedAt: now,
      },
      {
        id: 2,
        bookmakerId: 1,
        bookmakerName: 'Book A',
        marketCode: 'BTTS' as const,
        marketName: 'Both Teams To Score',
        marketGroup: 'GOALS',
        selectionCode: 'NO',
        selectionName: 'No',
        lineValue: null,
        decimalOdds: 2,
        capturedAt: now,
      },
    ];
    const candidates = buildPortedLegacyCandidates({
      odds,
      probabilities: legacyProbabilitiesToScientific(sampleLegacyProbabilities()),
      rules: {
        minimumOdds: 1.4,
        maximumOdds: 10,
        minimumExpectedValue: -1,
        minimumEdge: -1,
        minimumConfidence: 0,
        minimumDataQuality: 0,
        maximumOddsAgeMinutes: 120,
        minimumBookmakers: 1,
        topPerFixture: 1,
      },
      now,
      historySampleSize: 10,
      dataQualityScore: 1,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.evidenceClass).toBe('LEGACY_PORT_DIAGNOSTIC_ONLY');
  });

  it('keeps legacy ranking non-promotional', () => {
    const report = getScientificMultiMarketPortReport();
    expect(report.scientificPort.legacyRankingPromotional).toBe(false);
  });

  it('does not activate best-bet policy in beta.1A.2', () => {
    const report = getScientificMultiMarketPortReport();
    expect(report.scientificPort.bestBetPolicyActivated).toBe(false);
  });

  it('does not activate 1.5 or 3.5 total-goal lines yet', () => {
    const report = getScientificMultiMarketPortReport();
    expect(report.scientificPort.newTotalGoalLinesActivated).toBe(false);
  });

  it('does not write fresh shadow evidence', () => {
    const report = getScientificMultiMarketPortReport();
    expect(report.scientificPort.freshShadowWrites).toBe(0);
  });

  it('does not change production', () => {
    const report = getScientificMultiMarketPortReport();
    expect(report.scientificPort.productionChanged).toBe(false);
  });

  it('points to beta.1A.3 next', () => {
    expect(getScientificMultiMarketPortReport().nextStage).toBe('v7.0-beta.1A.3');
  });
});
