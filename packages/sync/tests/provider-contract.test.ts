import { describe, expect, it } from 'vitest';

import {
  BETA1A_PROVIDER_VERSION,
  BETA1A_REPLAY_EVIDENCE_CLASS,
  BETA1A_REPLAY_POLICY_VERSION,
  assertReplaySchedulerPlan,
  buildReplaySchedulerPlan,
  classifyMatchWinner,
  normalizeReplayProbabilities,
  parseFootballProviderMode,
  pointInTimeSafe,
  replayBrierScore,
  replayEvidenceCanPromote,
  replayLogLoss,
  resultAvailableAt,
} from '../src/provider-contract.js';

describe('v7.0-beta.1A provider replay contract', () => {
  it('uses stable beta.1A identifiers', () => {
    expect(BETA1A_PROVIDER_VERSION).toContain('beta.1A');
    expect(BETA1A_REPLAY_POLICY_VERSION).toBe('historical-replay-non-promotional-v1');
    expect(BETA1A_REPLAY_EVIDENCE_CLASS).toBe('REPLAY_ONLY_NON_PROMOTIONAL');
  });

  it('defaults provider mode to replay', () => {
    expect(parseFootballProviderMode(undefined)).toBe('REPLAY');
  });

  it('parses replay mode case-insensitively', () => {
    expect(parseFootballProviderMode(' replay ')).toBe('REPLAY');
  });

  it('parses live mode', () => {
    expect(parseFootballProviderMode('LIVE')).toBe('LIVE');
  });

  it('rejects unsupported provider mode', () => {
    expect(() => parseFootballProviderMode('mock')).toThrow();
  });

  it('calculates result availability after kickoff', () => {
    const kickoff = new Date('2024-01-01T12:00:00Z');
    const available = resultAvailableAt(kickoff, 180);

    expect(available.toISOString()).toBe('2024-01-01T15:00:00.000Z');
  });

  it('rejects negative result availability lag', () => {
    expect(() => resultAvailableAt(new Date(), -1)).toThrow();
  });

  it('builds six replay scheduler events', () => {
    const plan = buildReplaySchedulerPlan(new Date('2024-01-01T12:00:00Z'));

    expect(plan).toHaveLength(6);
  });

  it('schedules T90 exactly ninety minutes before kickoff', () => {
    const kickoff = new Date('2024-01-01T12:00:00Z');
    const plan = buildReplaySchedulerPlan(kickoff);
    const t90 = plan.find((event) => event.type === 'T90_SHADOW_TRIGGER');

    expect(t90?.scheduledAt.toISOString()).toBe('2024-01-01T10:30:00.000Z');
  });

  it('keeps every prematch scheduler event before kickoff', () => {
    const kickoff = new Date('2024-01-01T12:00:00Z');
    const plan = buildReplaySchedulerPlan(kickoff);

    expect(() => assertReplaySchedulerPlan(kickoff, plan)).not.toThrow();

    for (const event of plan) {
      if (event.prematch) {
        expect(event.scheduledAt.getTime()).toBeLessThan(kickoff.getTime());
      }
    }
  });

  it('rejects a prematch event at kickoff', () => {
    const kickoff = new Date('2024-01-01T12:00:00Z');
    const plan = buildReplaySchedulerPlan(kickoff);
    plan[2] = {
      ...plan[2]!,
      scheduledAt: new Date(kickoff),
    };

    expect(() => assertReplaySchedulerPlan(kickoff, plan)).toThrow();
  });

  it('rejects non-chronological scheduler events', () => {
    const kickoff = new Date('2024-01-01T12:00:00Z');
    const plan = buildReplaySchedulerPlan(kickoff);
    plan[1] = {
      ...plan[1]!,
      scheduledAt: new Date(plan[0]!.scheduledAt),
    };

    expect(() => assertReplaySchedulerPlan(kickoff, plan)).toThrow();
  });

  it('accepts a source captured exactly at predictionAsOf', () => {
    const asOf = new Date('2024-01-01T10:30:00Z');

    expect(pointInTimeSafe(new Date(asOf), asOf)).toBe(true);
  });

  it('rejects future source timestamps', () => {
    const asOf = new Date('2024-01-01T10:30:00Z');

    expect(pointInTimeSafe(new Date('2024-01-01T10:31:00Z'), asOf)).toBe(false);
  });

  it('treats missing optional source timestamp as PIT-safe', () => {
    expect(pointInTimeSafe(null, new Date())).toBe(true);
  });

  it('classifies home win', () => {
    expect(classifyMatchWinner(2, 1)).toBe('HOME');
  });

  it('classifies draw', () => {
    expect(classifyMatchWinner(1, 1)).toBe('DRAW');
  });

  it('classifies away win', () => {
    expect(classifyMatchWinner(0, 2)).toBe('AWAY');
  });

  it('normalizes replay probabilities', () => {
    const result = normalizeReplayProbabilities({
      HOME: 4,
      DRAW: 3,
      AWAY: 3,
    });

    expect(result.HOME + result.DRAW + result.AWAY).toBeCloseTo(1);
    expect(result.HOME).toBeCloseTo(0.4);
  });

  it('uses uniform probabilities for invalid zero mass', () => {
    const result = normalizeReplayProbabilities({
      HOME: 0,
      DRAW: 0,
      AWAY: 0,
    });

    expect(result.HOME).toBeCloseTo(1 / 3);
  });

  it('computes zero Brier for a perfect prediction', () => {
    expect(
      replayBrierScore(
        {
          HOME: 1,
          DRAW: 0,
          AWAY: 0,
        },
        'HOME',
      ),
    ).toBeCloseTo(0);
  });

  it('computes low log-loss for a confident correct prediction', () => {
    expect(
      replayLogLoss(
        {
          HOME: 0.9,
          DRAW: 0.05,
          AWAY: 0.05,
        },
        'HOME',
      ),
    ).toBeLessThan(0.2);
  });

  it('never allows replay evidence to promote', () => {
    expect(replayEvidenceCanPromote(BETA1A_REPLAY_EVIDENCE_CLASS)).toBe(false);
  });

  it('never allows any evidence string through the replay promotion function', () => {
    expect(replayEvidenceCanPromote('ELIGIBLE_FOR_MANUAL_REVIEW')).toBe(false);
  });
});
