import { describe, expect, it } from 'vitest';

import {
  buildLivePaperBetCandidates,
  dueLivePaperBetHorizons,
  parseLivePaperBetHorizons,
  selectLatestLiveOddsRows,
  type LiveModelProbabilities,
  type LiveOddsRow,
  type LiveReliabilityGate,
} from '../src/real-odds-paper-bet-core.js';

function row(
  input: Partial<LiveOddsRow> &
    Pick<
      LiveOddsRow,
      | 'id'
      | 'bookmakerId'
      | 'bookmakerName'
      | 'marketType'
      | 'selection'
      | 'lineValue'
      | 'decimalOdds'
    >,
): LiveOddsRow {
  return {
    providerFixtureId: 100,
    sourceUpdatedAt: new Date('2026-07-25T10:00:00Z'),
    observedAt: new Date('2026-07-25T10:01:00Z'),
    ...input,
  };
}

const probabilities: LiveModelProbabilities = {
  MATCH_WINNER: {
    HOME: 0.55,
    DRAW: 0.25,
    AWAY: 0.2,
  },
  TOTAL_GOALS_1_5: {
    OVER: 0.75,
    UNDER: 0.25,
  },
  TOTAL_GOALS_2_5: {
    OVER: 0.53,
    UNDER: 0.47,
  },
  TOTAL_GOALS_3_5: {
    OVER: 0.31,
    UNDER: 0.69,
  },
  BTTS: {
    YES: 0.57,
    NO: 0.43,
  },
};

const reliability = Object.fromEntries(
  ['MATCH_WINNER', 'TOTAL_GOALS_1_5', 'TOTAL_GOALS_2_5', 'TOTAL_GOALS_3_5', 'BTTS'].map(
    (market) => [
      market,
      {
        market,
        status: market === 'MATCH_WINNER' ? 'DIAGNOSTIC_ELIGIBLE' : 'NO_PROVEN_SKILL',
        eligible: market === 'MATCH_WINNER',
      },
    ],
  ),
) as Record<keyof LiveModelProbabilities, LiveReliabilityGate>;

describe('beta.1B.1 real-odds paper-bet core', () => {
  it('defaults to T-90/T-30/T-5', () => {
    expect(parseLivePaperBetHorizons(undefined)).toEqual([90, 30, 5]);
  });

  it('rejects unsupported T-180 decision horizon', () => {
    expect(() => parseLivePaperBetHorizons('180,90')).toThrow();
  });

  it('detects T-90 inside tolerance', () => {
    expect(
      dueLivePaperBetHorizons({
        now: new Date('2026-07-25T10:00:00Z'),
        kickoffAt: new Date('2026-07-25T11:29:00Z'),
        horizons: [90, 30, 5],
        toleranceMinutes: 2,
      }),
    ).toEqual([90]);
  });

  it('does not decide after kickoff', () => {
    expect(
      dueLivePaperBetHorizons({
        now: new Date('2026-07-25T12:00:00Z'),
        kickoffAt: new Date('2026-07-25T11:00:00Z'),
        horizons: [90, 30, 5],
        toleranceMinutes: 3,
      }),
    ).toEqual([]);
  });

  it('keeps the newest odds state for the same bookmaker/selection', () => {
    const result = selectLatestLiveOddsRows([
      row({
        id: 1,
        bookmakerId: 10,
        bookmakerName: 'Book A',
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        decimalOdds: 1.8,
        observedAt: new Date('2026-07-25T09:00:00Z'),
      }),
      row({
        id: 2,
        bookmakerId: 10,
        bookmakerName: 'Book A',
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        decimalOdds: 1.9,
        observedAt: new Date('2026-07-25T10:00:00Z'),
        sourceUpdatedAt: new Date('2026-07-25T10:00:00Z'),
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(2);
  });

  it('uses no-vig consensus and best available odds', () => {
    const odds = [
      row({
        id: 1,
        bookmakerId: 10,
        bookmakerName: 'Book A',
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        decimalOdds: 2.0,
      }),
      row({
        id: 2,
        bookmakerId: 10,
        bookmakerName: 'Book A',
        marketType: 'MATCH_WINNER',
        selection: 'DRAW',
        lineValue: null,
        decimalOdds: 3.5,
      }),
      row({
        id: 3,
        bookmakerId: 10,
        bookmakerName: 'Book A',
        marketType: 'MATCH_WINNER',
        selection: 'AWAY',
        lineValue: null,
        decimalOdds: 4.0,
      }),
      row({
        id: 4,
        bookmakerId: 20,
        bookmakerName: 'Book B',
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        decimalOdds: 2.1,
      }),
      row({
        id: 5,
        bookmakerId: 20,
        bookmakerName: 'Book B',
        marketType: 'MATCH_WINNER',
        selection: 'DRAW',
        lineValue: null,
        decimalOdds: 3.4,
      }),
      row({
        id: 6,
        bookmakerId: 20,
        bookmakerName: 'Book B',
        marketType: 'MATCH_WINNER',
        selection: 'AWAY',
        lineValue: null,
        decimalOdds: 3.9,
      }),
    ];

    const result = buildLivePaperBetCandidates({
      providerFixtureId: 100,
      oddsRows: odds,
      modelProbabilities: probabilities,
      reliability,
    });
    const home = result.candidates.find(
      (candidate) => candidate.marketType === 'MATCH_WINNER' && candidate.selection === 'HOME',
    );

    expect(home?.decimalOdds).toBe(2.1);
    expect(home?.bookmakerName).toBe('Book B');
    expect(home?.fairMarketProbability).toBeGreaterThan(0);
    expect(home?.fairMarketProbability).toBeLessThan(1);
    expect(result.marketCoverage[0]?.completeBookmakers).toBe(2);
  });

  it('does not create consensus from an incomplete bookmaker market', () => {
    const result = buildLivePaperBetCandidates({
      providerFixtureId: 100,
      oddsRows: [
        row({
          id: 1,
          bookmakerId: 10,
          bookmakerName: 'Book A',
          marketType: 'BTTS',
          selection: 'YES',
          lineValue: null,
          decimalOdds: 1.8,
        }),
      ],
      modelProbabilities: probabilities,
      reliability,
    });

    expect(result.candidates).toHaveLength(0);
  });

  it('does not mix an incomplete newer bookmaker state with an older complete state', () => {
    const result = buildLivePaperBetCandidates({
      providerFixtureId: 100,
      oddsRows: [
        row({
          id: 1,
          bookmakerId: 10,
          bookmakerName: 'Book A',
          marketType: 'MATCH_WINNER',
          selection: 'HOME',
          lineValue: null,
          decimalOdds: 2.0,
          sourceUpdatedAt: new Date('2026-07-25T09:00:00Z'),
          observedAt: new Date('2026-07-25T09:01:00Z'),
        }),
        row({
          id: 2,
          bookmakerId: 10,
          bookmakerName: 'Book A',
          marketType: 'MATCH_WINNER',
          selection: 'DRAW',
          lineValue: null,
          decimalOdds: 3.5,
          sourceUpdatedAt: new Date('2026-07-25T09:00:00Z'),
          observedAt: new Date('2026-07-25T09:01:00Z'),
        }),
        row({
          id: 3,
          bookmakerId: 10,
          bookmakerName: 'Book A',
          marketType: 'MATCH_WINNER',
          selection: 'AWAY',
          lineValue: null,
          decimalOdds: 4.0,
          sourceUpdatedAt: new Date('2026-07-25T09:00:00Z'),
          observedAt: new Date('2026-07-25T09:01:00Z'),
        }),
        row({
          id: 4,
          bookmakerId: 10,
          bookmakerName: 'Book A',
          marketType: 'MATCH_WINNER',
          selection: 'HOME',
          lineValue: null,
          decimalOdds: 9.9,
          sourceUpdatedAt: new Date('2026-07-25T10:00:00Z'),
          observedAt: new Date('2026-07-25T10:01:00Z'),
        }),
      ],
      modelProbabilities: probabilities,
      reliability,
    });
    const home = result.candidates.find(
      (candidate) => candidate.marketType === 'MATCH_WINNER' && candidate.selection === 'HOME',
    );

    expect(home?.decimalOdds).toBe(2);
    expect(result.marketCoverage[0]?.completeBookmakers).toBe(1);
  });

  it('replaces direct O/U candidates with exact half-goal opposite targets', () => {
    let id = 1;
    const odds: LiveOddsRow[] = [];
    const push = (
      marketType: LiveOddsRow['marketType'],
      selection: LiveOddsRow['selection'],
      lineValue: number | null,
      decimalOdds: number,
    ) => {
      odds.push(
        row({
          id: id++,
          bookmakerId: 10,
          bookmakerName: 'Book A',
          marketType,
          selection,
          lineValue,
          decimalOdds,
        }),
      );
    };

    push('MATCH_WINNER', 'HOME', null, 2.1);
    push('MATCH_WINNER', 'DRAW', null, 3.4);
    push('MATCH_WINNER', 'AWAY', null, 3.8);

    // Integer lines may exist in provider odds, but the direct model result
    // must keep its original 1.5/2.5/3.5 line.
    push('TOTAL_GOALS', 'OVER', 1.5, 1.91);
    push('TOTAL_GOALS', 'UNDER', 1.5, 1.81);
    push('TOTAL_GOALS', 'OVER', 2.0, 2.02);
    push('TOTAL_GOALS', 'UNDER', 2.0, 2.12);
    push('TOTAL_GOALS', 'OVER', 2.5, 1.93);
    push('TOTAL_GOALS', 'UNDER', 2.5, 1.83);
    push('TOTAL_GOALS', 'OVER', 3.0, 2.23);
    push('TOTAL_GOALS', 'UNDER', 3.0, 2.33);
    push('TOTAL_GOALS', 'OVER', 3.5, 1.95);
    push('TOTAL_GOALS', 'UNDER', 3.5, 1.85);

    push('BTTS', 'YES', null, 1.9);
    push('BTTS', 'NO', null, 1.9);

    const result = buildLivePaperBetCandidates({
      providerFixtureId: 100,
      oddsRows: odds,
      modelProbabilities: probabilities,
      reliability,
    });

    expect(result.candidates).toHaveLength(8);
    expect(result.candidates.filter((candidate) => candidate.reliabilityEligible)).toHaveLength(3);

    const ouCandidates = result.candidates.filter((candidate) =>
      candidate.marketType.startsWith('TOTAL_GOALS_'),
    );
    expect(ouCandidates).toHaveLength(3);

    const bySourceLine = new Map(
      ouCandidates.map((candidate) => [
        candidate.ouOppositeLineStrategy?.predictionLineValue,
        candidate,
      ]),
    );

    const from15 = bySourceLine.get(1.5);
    expect(from15?.marketType).toBe('TOTAL_GOALS_1_5');
    expect(from15?.selection).toBe('OVER');
    expect(from15?.lineValue).toBe(1.5);
    expect(from15?.decimalOdds).toBe(1.91);
    expect(from15?.ouOppositeLineStrategy?.predictionSelection).toBe('OVER');
    expect(from15?.ouOppositeLineStrategy?.recommendedSelection).toBe('OVER');
    expect(from15?.ouOppositeLineStrategy?.recommendedLineValue).toBe(1.5);
    expect(from15?.ouOppositeLineStrategy?.lineShiftGoals).toBe(0);

    const from25 = bySourceLine.get(2.5);
    expect(from25?.marketType).toBe('TOTAL_GOALS_2_5');
    expect(from25?.selection).toBe('OVER');
    expect(from25?.lineValue).toBe(2.5);
    expect(from25?.decimalOdds).toBe(1.93);
    expect(from25?.ouOppositeLineStrategy?.predictionSelection).toBe('OVER');
    expect(from25?.ouOppositeLineStrategy?.recommendedSelection).toBe('OVER');
    expect(from25?.ouOppositeLineStrategy?.recommendedLineValue).toBe(2.5);
    expect(from25?.ouOppositeLineStrategy?.lineShiftGoals).toBe(0);

    const from35 = bySourceLine.get(3.5);
    expect(from35?.marketType).toBe('TOTAL_GOALS_3_5');
    expect(from35?.selection).toBe('UNDER');
    expect(from35?.lineValue).toBe(3.5);
    expect(from35?.decimalOdds).toBe(1.85);
    expect(from35?.ouOppositeLineStrategy?.predictionSelection).toBe('UNDER');
    expect(from35?.ouOppositeLineStrategy?.recommendedSelection).toBe('UNDER');
    expect(from35?.ouOppositeLineStrategy?.recommendedLineValue).toBe(3.5);
    expect(from35?.ouOppositeLineStrategy?.lineShiftGoals).toBe(0);
  });

});
