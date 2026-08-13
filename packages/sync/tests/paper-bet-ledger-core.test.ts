import { describe, expect, it } from 'vitest';

import {
  decidePaperBet,
  isCompletePaperBetOutcomeSnapshot,
  isCompletePaperBetScoreSnapshot,
  normalizePaperBetCandidate,
  settlePaperBetSelection,
  type PaperBetCandidateInput,
} from '../src/paper-bet-ledger-core.js';

function candidate(overrides: Partial<PaperBetCandidateInput> = {}): PaperBetCandidateInput {
  return {
    providerFixtureId: overrides.providerFixtureId ?? 100,
    marketType: overrides.marketType ?? 'MATCH_WINNER',
    selection: overrides.selection ?? 'HOME',
    lineValue: overrides.lineValue ?? null,
    decimalOdds: overrides.decimalOdds ?? 1.8,
    bookmakerId: overrides.bookmakerId ?? 8,
    bookmakerName: overrides.bookmakerName ?? 'Bet365',
    modelProbability: overrides.modelProbability ?? 0.62,
    fairMarketProbability: overrides.fairMarketProbability ?? 0.56,
    reliabilityStatus: overrides.reliabilityStatus ?? 'DIAGNOSTIC_ELIGIBLE',
    reliabilityEligible: overrides.reliabilityEligible ?? true,
    sourceOddsSnapshotId: overrides.sourceOddsSnapshotId ?? 1,
    sourceOddsUpdatedAt: overrides.sourceOddsUpdatedAt ?? new Date('2026-07-25T12:00:00Z'),
    sourceOddsObservedAt: overrides.sourceOddsObservedAt ?? new Date('2026-07-25T12:05:00Z'),
  };
}

describe('v7.0-beta.1B paper bet ledger core', () => {
  it('refetches a final snapshot until both full-time scores are present', () => {
    const incomplete = {
      statusShort: 'FT',
      fulltimeHomeGoals: 2,
      fulltimeAwayGoals: null,
    };

    expect(isCompletePaperBetOutcomeSnapshot(incomplete)).toBe(false);
    expect(isCompletePaperBetScoreSnapshot(incomplete)).toBe(false);
    expect(
      isCompletePaperBetOutcomeSnapshot({
        ...incomplete,
        fulltimeAwayGoals: 1,
      }),
    ).toBe(true);
  });

  it('treats terminal void statuses as complete without inventing a score', () => {
    expect(
      isCompletePaperBetOutcomeSnapshot({
        statusShort: 'CANC',
        fulltimeHomeGoals: null,
        fulltimeAwayGoals: null,
      }),
    ).toBe(true);
  });

  it('normalizes HDA candidate edge and EV', () => {
    const result = normalizePaperBetCandidate(candidate());

    expect(result.scientificCandidate.edge).toBeCloseTo(0.06, 12);
    expect(result.scientificCandidate.expectedValue).toBeCloseTo(0.116, 12);
  });

  it('maps O/U 1.5 line automatically', () => {
    const result = normalizePaperBetCandidate(
      candidate({
        marketType: 'TOTAL_GOALS_1_5',
        selection: 'OVER',
      }),
    );

    expect(result.scientificCandidate.lineValue).toBe(1.5);
  });

  it('maps O/U 2.5 line automatically', () => {
    expect(
      normalizePaperBetCandidate(
        candidate({
          marketType: 'TOTAL_GOALS_2_5',
          selection: 'UNDER',
        }),
      ).scientificCandidate.lineValue,
    ).toBe(2.5);
  });

  it('maps O/U 3.5 line automatically', () => {
    expect(
      normalizePaperBetCandidate(
        candidate({
          marketType: 'TOTAL_GOALS_3_5',
          selection: 'OVER',
        }),
      ).scientificCandidate.lineValue,
    ).toBe(3.5);
  });

  it('keeps BTTS line null', () => {
    expect(
      normalizePaperBetCandidate(
        candidate({
          marketType: 'BTTS',
          selection: 'YES',
        }),
      ).scientificCandidate.lineValue,
    ).toBeNull();
  });

  it('selects BEST_BET for eligible qualifying candidate', () => {
    const result = decidePaperBet({
      providerFixtureId: 100,
      horizonMinutes: 90,
      decisionAsOf: new Date('2026-07-25T16:30:00Z'),
      kickoffAt: new Date('2026-07-25T18:00:00Z'),
      modelVersion: 'model',
      policyVersion: 'policy',
      candidates: [candidate()],
    });

    expect(result.decision.decision).toBe('BEST_BET');
  });

  it('returns NO_BET for reliability-blocked candidate', () => {
    const result = decidePaperBet({
      providerFixtureId: 100,
      horizonMinutes: 90,
      decisionAsOf: new Date('2026-07-25T16:30:00Z'),
      kickoffAt: new Date('2026-07-25T18:00:00Z'),
      modelVersion: 'model',
      policyVersion: 'policy',
      candidates: [
        candidate({
          reliabilityEligible: false,
          reliabilityStatus: 'NO_PROVEN_SKILL',
        }),
      ],
    });

    expect(result.decision.decision).toBe('NO_BET');
  });

  it('rejects decision at or after kickoff', () => {
    expect(() =>
      decidePaperBet({
        providerFixtureId: 100,
        horizonMinutes: 0,
        decisionAsOf: new Date('2026-07-25T18:00:00Z'),
        kickoffAt: new Date('2026-07-25T18:00:00Z'),
        modelVersion: 'model',
        policyVersion: 'policy',
        candidates: [],
      }),
    ).toThrow();
  });

  it('rejects candidate pool containing another fixture', () => {
    expect(() =>
      decidePaperBet({
        providerFixtureId: 100,
        horizonMinutes: 90,
        decisionAsOf: new Date('2026-07-25T16:30:00Z'),
        kickoffAt: new Date('2026-07-25T18:00:00Z'),
        modelVersion: 'model',
        policyVersion: 'policy',
        candidates: [
          candidate({
            providerFixtureId: 101,
          }),
        ],
      }),
    ).toThrow();
  });

  it('settles HOME win', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 1,
        decimalOdds: 1.8,
      }),
    ).toEqual({
      result: 'WIN',
      stakeUnits: 1,
      profitUnits: 0.8,
    });
  });

  it('settles HOME loss', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        homeGoals: 1,
        awayGoals: 1,
        decimalOdds: 1.8,
      }).result,
    ).toBe('LOSS');
  });

  it('settles DRAW win', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'MATCH_WINNER',
        selection: 'DRAW',
        lineValue: null,
        homeGoals: 1,
        awayGoals: 1,
        decimalOdds: 3.2,
      }).result,
    ).toBe('WIN');
  });

  it('settles AWAY win', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'MATCH_WINNER',
        selection: 'AWAY',
        lineValue: null,
        homeGoals: 0,
        awayGoals: 1,
        decimalOdds: 2.2,
      }).result,
    ).toBe('WIN');
  });

  it('settles Over 1.5 win at 1-1', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_1_5',
        selection: 'OVER',
        lineValue: 1.5,
        homeGoals: 1,
        awayGoals: 1,
        decimalOdds: 1.5,
      }).result,
    ).toBe('WIN');
  });

  it('settles Under 1.5 win at 1-0', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_1_5',
        selection: 'UNDER',
        lineValue: 1.5,
        homeGoals: 1,
        awayGoals: 0,
        decimalOdds: 2.0,
      }).result,
    ).toBe('WIN');
  });

  it('settles Over 2.5 win at 2-1', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        lineValue: 2.5,
        homeGoals: 2,
        awayGoals: 1,
        decimalOdds: 1.9,
      }).result,
    ).toBe('WIN');
  });

  it('settles Under 2.5 win at 1-1', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'UNDER',
        lineValue: 2.5,
        homeGoals: 1,
        awayGoals: 1,
        decimalOdds: 1.9,
      }).result,
    ).toBe('WIN');
  });

  it('settles Over 3.5 win at 3-1', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_3_5',
        selection: 'OVER',
        lineValue: 3.5,
        homeGoals: 3,
        awayGoals: 1,
        decimalOdds: 3.0,
      }).result,
    ).toBe('WIN');
  });

  it('settles Under 3.5 win at 2-1', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_3_5',
        selection: 'UNDER',
        lineValue: 3.5,
        homeGoals: 2,
        awayGoals: 1,
        decimalOdds: 1.4,
      }).result,
    ).toBe('WIN');
  });

  it('settles BTTS YES win', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'BTTS',
        selection: 'YES',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 1,
        decimalOdds: 1.8,
      }).result,
    ).toBe('WIN');
  });

  it('settles BTTS NO win', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'BTTS',
        selection: 'NO',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 0,
        decimalOdds: 1.8,
      }).result,
    ).toBe('WIN');
  });

  it('uses fixed 1u loss', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'BTTS',
        selection: 'YES',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 0,
        decimalOdds: 3,
      }).profitUnits,
    ).toBe(-1);
  });

  it('supports explicit stake for accounting utility', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        homeGoals: 1,
        awayGoals: 0,
        decimalOdds: 2,
        stakeUnits: 2,
      }).profitUnits,
    ).toBe(2);
  });

  it('rejects missing total-goals line', () => {
    expect(() =>
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        lineValue: null,
        homeGoals: 2,
        awayGoals: 1,
        decimalOdds: 2,
      }),
    ).toThrow();
  });

  it('rejects unsupported market', () => {
    expect(() =>
      settlePaperBetSelection({
        marketType: 'CORRECT_SCORE',
        selection: '1-0',
        lineValue: null,
        homeGoals: 1,
        awayGoals: 0,
        decimalOdds: 5,
      }),
    ).toThrow();
  });

  it('rejects non-positive stake', () => {
    expect(() =>
      settlePaperBetSelection({
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        homeGoals: 1,
        awayGoals: 0,
        decimalOdds: 2,
        stakeUnits: 0,
      }),
    ).toThrow();
  });
});
