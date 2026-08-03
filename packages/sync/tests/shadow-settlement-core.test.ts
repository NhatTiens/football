import { describe, expect, it } from 'vitest';

import {
  aggregateShadowSettlements,
  selectShadowClosingProxy,
  settleShadowCandidate,
  settleShadowSelection,
  type ShadowClosingOddsSnapshot,
  type ShadowOutcomeSnapshot,
  type ShadowSettlementCandidate,
} from '../src/shadow-settlement-core.js';

const kickoffAt = new Date('2026-07-30T12:00:00.000Z');
const reportAsOf = new Date('2026-07-30T18:00:00.000Z');

function candidate(overrides: Partial<ShadowSettlementCandidate> = {}): ShadowSettlementCandidate {
  return {
    snapshotId: 101,
    snapshotHash: 'a'.repeat(64),
    providerFixtureId: 9001,
    checkpointMinutes: 30,
    checkpointLabel: 'T-30',
    snapshotAsOf: new Date('2026-07-30T11:30:00.000Z'),
    kickoffAt,
    marketType: 'MATCH_WINNER',
    selection: 'HOME',
    lineValue: null,
    decimalOdds: 2.1,
    bookmakerName: 'Research Book',
    sourceOddsSnapshotId: 501,
    sourceOddsObservedAt: new Date('2026-07-30T11:29:00.000Z'),
    shadowTier: 'DIAGNOSTIC_TRACKING_SHADOW',
    decisionSource: 'shadowCandidate',
    ...overrides,
  };
}

function outcome(overrides: Partial<ShadowOutcomeSnapshot> = {}): ShadowOutcomeSnapshot {
  return {
    id: 201,
    providerFixtureId: 9001,
    statusShort: 'FT',
    observedAt: new Date('2026-07-30T14:02:00.000Z'),
    fulltimeHomeGoals: 2,
    fulltimeAwayGoals: 1,
    ...overrides,
  };
}

function closing(overrides: Partial<ShadowClosingOddsSnapshot> = {}): ShadowClosingOddsSnapshot {
  return {
    id: 301,
    providerFixtureId: 9001,
    marketType: 'MATCH_WINNER',
    selection: 'HOME',
    lineValue: null,
    decimalOdds: 1.9,
    bookmakerName: 'Research Book',
    sourceUpdatedAt: new Date('2026-07-30T11:00:00.000Z'),
    observedAt: new Date('2026-07-30T11:55:00.000Z'),
    pitUsable: true,
    ...overrides,
  };
}

describe('R4.10.2.11 shadow settlement and CLV', () => {
  it('links a final outcome and a fresh same-bookmaker T-5 proxy', () => {
    const row = settleShadowCandidate({
      candidate: candidate(),
      outcomeSnapshots: [outcome()],
      closingOddsSnapshots: [closing()],
      reportAsOf,
    });

    expect(row.status).toBe('SETTLED');
    expect(row.settlementResult).toBe('WIN');
    expect(row.hypotheticalProfitUnits).toBeCloseTo(1.1, 12);
    expect(row.outcome.sourceFixtureSnapshotId).toBe(201);
    expect(row.closing.status).toBe('CLOSING_PROXY_FRESH');
    expect(row.closing.clvEligible).toBe(true);
    expect(row.clv).toBeCloseTo(2.1 / 1.9 - 1, 12);
    expect(row.paperOnly).toBe(true);
    expect(row.stakeEligible).toBe(false);
    expect(row.realMoneyExecution).toBe(false);
  });

  it('normalizes total-goals market names for outcome and closing linkage', () => {
    const row = settleShadowCandidate({
      candidate: candidate({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        lineValue: 2.5,
        decimalOdds: 1.95,
      }),
      outcomeSnapshots: [outcome({ fulltimeHomeGoals: 2, fulltimeAwayGoals: 2 })],
      closingOddsSnapshots: [
        closing({
          marketType: 'TOTAL_GOALS',
          selection: 'OVER',
          lineValue: 2.5,
          decimalOdds: 1.85,
        }),
      ],
      reportAsOf,
    });

    expect(row.settlementResult).toBe('WIN');
    expect(row.hypotheticalProfitUnits).toBeCloseTo(0.95, 12);
    expect(row.closing.sourceOddsSnapshotId).toBe(301);
  });

  it('maps an exact-line push and unsupported settlement to VOID', () => {
    expect(
      settleShadowSelection({
        marketType: 'TOTAL_GOALS',
        selection: 'OVER',
        lineValue: 3,
        homeGoals: 2,
        awayGoals: 1,
      }),
    ).toBe('VOID');

    expect(
      settleShadowSelection({
        marketType: 'UNSUPPORTED_MARKET',
        selection: 'ANY',
        lineValue: null,
        homeGoals: 1,
        awayGoals: 0,
      }),
    ).toBe('VOID');
  });

  it('links terminal cancellation to a zero-profit VOID', () => {
    const row = settleShadowCandidate({
      candidate: candidate(),
      outcomeSnapshots: [
        outcome({
          statusShort: 'CANC',
          fulltimeHomeGoals: null,
          fulltimeAwayGoals: null,
        }),
      ],
      closingOddsSnapshots: [],
      reportAsOf,
    });

    expect(row.status).toBe('SETTLED');
    expect(row.outcome.status).toBe('VOID_STATUS_LINKED');
    expect(row.settlementResult).toBe('VOID');
    expect(row.hypotheticalProfitUnits).toBe(0);
  });

  it('rejects post-kickoff, wrong-line and wrong-bookmaker closing quotes', () => {
    const linked = selectShadowClosingProxy({
      candidate: candidate({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'UNDER',
        lineValue: 2.5,
      }),
      closingOddsSnapshots: [
        closing({
          marketType: 'TOTAL_GOALS',
          selection: 'UNDER',
          lineValue: 2.5,
          observedAt: new Date('2026-07-30T12:01:00.000Z'),
        }),
        closing({
          marketType: 'TOTAL_GOALS',
          selection: 'UNDER',
          lineValue: 3.5,
        }),
        closing({
          marketType: 'TOTAL_GOALS',
          selection: 'UNDER',
          lineValue: 2.5,
          bookmakerName: 'Other Book',
        }),
      ],
      reportAsOf,
    });

    expect(linked.status).toBe('NO_MATCHING_CLOSING_PROXY');
    expect(linked.sourceOddsSnapshotId).toBeNull();
  });

  it('calculates raw CLV but excludes a stale source from reliability CLV', () => {
    const row = settleShadowCandidate({
      candidate: candidate(),
      outcomeSnapshots: [outcome()],
      closingOddsSnapshots: [
        closing({
          sourceUpdatedAt: new Date('2026-07-29T12:00:00.000Z'),
        }),
      ],
      reportAsOf,
    });
    const report = aggregateShadowSettlements([row]);

    expect(row.clv).not.toBeNull();
    expect(row.closing.status).toBe('CLOSING_PROXY_STALE_SOURCE');
    expect(row.closing.clvEligible).toBe(false);
    expect(report.overall.clvAvailable).toBe(1);
    expect(report.overall.clvEligible).toBe(0);
    expect(report.overall.staleClvExcluded).toBe(1);
    expect(report.overall.averageClv).toBeNull();
  });

  it('blocks post-kickoff decision lineage from settlement metrics', () => {
    const row = settleShadowCandidate({
      candidate: candidate({
        snapshotAsOf: new Date('2026-07-30T12:01:00.000Z'),
      }),
      outcomeSnapshots: [outcome()],
      closingOddsSnapshots: [closing()],
      reportAsOf,
    });
    const report = aggregateShadowSettlements([row]);

    expect(row.status).toBe('INVALID_DECISION_LINEAGE');
    expect(row.settlementResult).toBeNull();
    expect(row.lineageViolations).toContain('DECISION_SNAPSHOT_AFTER_ALLOWED_AS_OF');
    expect(report.overall.settled).toBe(0);
    expect(report.overall.invalidLineage).toBe(1);
  });

  it('aggregates paper reliability by market and horizon without promotion', () => {
    const homeWin = settleShadowCandidate({
      candidate: candidate(),
      outcomeSnapshots: [outcome()],
      closingOddsSnapshots: [closing()],
      reportAsOf,
    });
    const bttsLoss = settleShadowCandidate({
      candidate: candidate({
        snapshotId: 102,
        snapshotHash: 'b'.repeat(64),
        checkpointMinutes: 90,
        checkpointLabel: 'T-90',
        marketType: 'BTTS',
        selection: 'NO',
        decimalOdds: 1.8,
      }),
      outcomeSnapshots: [outcome()],
      closingOddsSnapshots: [
        closing({
          marketType: 'BTTS',
          selection: 'NO',
          decimalOdds: 1.9,
        }),
      ],
      reportAsOf,
    });
    const report = aggregateShadowSettlements([homeWin, bttsLoss]);

    expect(report.overall.settled).toBe(2);
    expect(report.overall.wins).toBe(1);
    expect(report.overall.losses).toBe(1);
    expect(report.overall.hitRate).toBe(0.5);
    expect(report.overall.hypotheticalProfitUnits).toBeCloseTo(0.1, 12);
    expect(report.byMarket.map((row) => row.key)).toEqual(['BTTS', 'MATCH_WINNER']);
    expect(report.byHorizon.map((row) => row.key)).toEqual(['T-30', 'T-90']);
    expect(report.byMarketAndHorizon).toHaveLength(2);
    expect(report.overall.promotionEligible).toBe(false);
    expect(report.automaticPromotion).toBe(false);
  });
});
