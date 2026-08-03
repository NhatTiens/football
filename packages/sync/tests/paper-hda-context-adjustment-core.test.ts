import { describe, expect, it } from 'vitest';

import {
  PAPER_HDA_CONTEXT_ADJUSTMENT_VERSION,
  buildPaperHdaContextAdjustment,
  type PaperHdaContextAdjustmentInput,
} from '../src/paper-hda-context-adjustment-core.js';

function baseInput(
  overrides: Partial<PaperHdaContextAdjustmentInput> = {},
): PaperHdaContextAdjustmentInput {
  return {
    baseline: {
      HOME: 0.42,
      DRAW: 0.29,
      AWAY: 0.29,
    },
    homeLineup: {
      confirmed: false,
      rotationCount: null,
      missingRegulars: [],
    },
    awayLineup: {
      confirmed: false,
      rotationCount: null,
      missingRegulars: [],
    },
    homeSuspensions: 0,
    awaySuspensions: 0,
    headToHead: [],
    ...overrides,
  };
}

describe('paper HDA contextual adjustment', () => {
  it('does not infer player impact from an unconfirmed lineup or a small H2H sample', () => {
    const result = buildPaperHdaContextAdjustment(
      baseInput({
        homeLineup: {
          confirmed: false,
          rotationCount: null,
          missingRegulars: [
            {
              playerName: 'Unconfirmed absence',
              positionGroup: 'ATTACKER',
              startRate: 1,
            },
          ],
        },
        homeSuspensions: 1,
        headToHead: [
          { homeGoals: 3, awayGoals: 0, ageDays: 30 },
          { homeGoals: 2, awayGoals: 0, ageDays: 60 },
          { homeGoals: 9, awayGoals: 0, ageDays: -1 },
        ],
      }),
    );

    expect(result.version).toBe(PAPER_HDA_CONTEXT_ADJUSTMENT_VERSION);
    expect(result.applied).toBe(false);
    expect(result.probabilities).toEqual({
      HOME: 0.42,
      DRAW: 0.29,
      AWAY: 0.29,
    });
    expect(result.evidence.eligibleHeadToHeadMatches).toBe(2);
    expect(result.reasonCodes).toContain('HOME_LINEUP_UNCONFIRMED_NO_PLAYER_SHIFT');
    expect(result.reasonCodes).toContain('H2H_SAMPLE_TOO_SMALL_NO_SHIFT');
    expect(result.reasonCodes).toContain(
      'SUSPENSION_EVIDENCE_PRESENT_BASELINE_INJURY_ADJUSTMENT',
    );
  });

  it('moves probability away from a confirmed team missing a high-start-rate attacker', () => {
    const result = buildPaperHdaContextAdjustment(
      baseInput({
        homeLineup: {
          confirmed: true,
          rotationCount: 3,
          missingRegulars: [
            {
              playerName: 'Regular attacker',
              positionGroup: 'ATTACKER',
              startRate: 0.9,
            },
          ],
        },
        awayLineup: {
          confirmed: true,
          rotationCount: 2,
          missingRegulars: [],
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.lineupShift).toBeLessThan(0);
    expect(result.probabilities.HOME).toBeLessThan(0.42);
    expect(result.probabilities.AWAY).toBeGreaterThan(0.29);
    expect(result.reasonCodes).toContain('CONFIRMED_LINEUP_PLAYER_IMPACT_APPLIED');
  });

  it('uses only sufficiently sized, recency-weighted H2H evidence', () => {
    const result = buildPaperHdaContextAdjustment(
      baseInput({
        headToHead: [
          { homeGoals: 2, awayGoals: 0, ageDays: 20 },
          { homeGoals: 1, awayGoals: 0, ageDays: 90 },
          { homeGoals: 3, awayGoals: 1, ageDays: 180 },
        ],
      }),
    );

    expect(result.headToHeadShift).toBeGreaterThan(0);
    expect(result.probabilities.HOME).toBeGreaterThan(0.42);
    expect(result.probabilities.AWAY).toBeLessThan(0.29);
    expect(result.reasonCodes).toContain('RECENCY_WEIGHTED_H2H_APPLIED');
  });

  it('normalizes probabilities and caps contextual movement under extreme evidence', () => {
    const missingRegulars = Array.from({ length: 11 }, (_, index) => ({
      playerName: `Starter ${index + 1}`,
      positionGroup: 'ATTACKER' as const,
      startRate: 1,
    }));
    const result = buildPaperHdaContextAdjustment(
      baseInput({
        homeLineup: {
          confirmed: true,
          rotationCount: 11,
          missingRegulars,
        },
        awayLineup: {
          confirmed: true,
          rotationCount: 0,
          missingRegulars: [],
        },
        headToHead: Array.from({ length: 8 }, (_, index) => ({
          homeGoals: 0,
          awayGoals: 4,
          ageDays: index * 20,
        })),
        maximumProbabilityShift: 0.02,
      }),
    );

    const total =
      result.probabilities.HOME + result.probabilities.DRAW + result.probabilities.AWAY;
    expect(total).toBeCloseTo(1, 12);
    expect(result.maximumAbsoluteProbabilityShift).toBeLessThanOrEqual(0.020000001);
    expect(result.reasonCodes).toContain('CONTEXT_SHIFT_CAPPED');
  });
});
