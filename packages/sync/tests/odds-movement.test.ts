import { describe, expect, it } from 'vitest';

import { analyzeMatchWinnerOddsMovement, type OddsMovementRow } from '../src/odds-movement.js';

const kickoffAt = new Date('2026-08-01T20:00:00.000Z');
const predictionAsOf = new Date('2026-08-01T18:30:00.000Z');

function market(input: {
  bookmakerId: number;
  capturedAt: string;
  home: number;
  draw: number;
  away: number;
  offset?: number;
}): OddsMovementRow[] {
  const offset = input.offset ?? input.bookmakerId * 100;
  return [
    {
      id: offset + 1,
      bookmakerId: input.bookmakerId,
      bookmakerName: `Book ${input.bookmakerId}`,
      selectionCode: 'HOME',
      decimalOdds: input.home,
      capturedAt: new Date(input.capturedAt),
    },
    {
      id: offset + 2,
      bookmakerId: input.bookmakerId,
      bookmakerName: `Book ${input.bookmakerId}`,
      selectionCode: 'DRAW',
      decimalOdds: input.draw,
      capturedAt: new Date(input.capturedAt),
    },
    {
      id: offset + 3,
      bookmakerId: input.bookmakerId,
      bookmakerName: `Book ${input.bookmakerId}`,
      selectionCode: 'AWAY',
      decimalOdds: input.away,
      capturedAt: new Date(input.capturedAt),
    },
  ];
}

function rows(): OddsMovementRow[] {
  return [
    ...market({
      bookmakerId: 1,
      capturedAt: '2026-08-01T12:00:00.000Z',
      home: 2.2,
      draw: 3.4,
      away: 3.4,
    }),
    ...market({
      bookmakerId: 2,
      capturedAt: '2026-08-01T12:00:00.000Z',
      home: 2.15,
      draw: 3.45,
      away: 3.5,
    }),
    ...market({
      bookmakerId: 3,
      capturedAt: '2026-08-01T12:00:00.000Z',
      home: 2.25,
      draw: 3.35,
      away: 3.3,
    }),
    ...market({
      bookmakerId: 1,
      capturedAt: '2026-08-01T17:45:00.000Z',
      home: 1.88,
      draw: 3.6,
      away: 4.2,
      offset: 1000,
    }),
    ...market({
      bookmakerId: 2,
      capturedAt: '2026-08-01T17:45:00.000Z',
      home: 1.9,
      draw: 3.55,
      away: 4.15,
      offset: 2000,
    }),
    ...market({
      bookmakerId: 3,
      capturedAt: '2026-08-01T17:45:00.000Z',
      home: 1.92,
      draw: 3.5,
      away: 4.1,
      offset: 3000,
    }),
  ];
}

describe('odds movement feature engine', () => {
  it('removes vig and normalizes current consensus', () => {
    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: rows(),
      options: { minimumBookmakers: 3 },
    });

    expect(result.available).toBe(true);
    expect(result.currentConsensus?.HOME).toBeGreaterThan(0.48);
    expect(
      (result.currentConsensus?.HOME ?? 0) +
        (result.currentConsensus?.DRAW ?? 0) +
        (result.currentConsensus?.AWAY ?? 0),
    ).toBeCloseTo(1, 10);
  });

  it('selects opening and current snapshots point-in-time', () => {
    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: rows(),
      options: { minimumBookmakers: 3 },
    });

    expect(result.movementAvailable).toBe(true);
    expect(result.movement.HOME).toBeGreaterThan(0);
    expect(result.movement.AWAY).toBeLessThan(0);
  });

  it('excludes snapshots after predictionAsOf', () => {
    const future = market({
      bookmakerId: 1,
      capturedAt: '2026-08-01T19:00:00.000Z',
      home: 1.2,
      draw: 6,
      away: 10,
      offset: 9000,
    });
    const baseline = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: rows(),
      options: { minimumBookmakers: 3 },
    });
    const changed = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: [...rows(), ...future],
      options: { minimumBookmakers: 3 },
    });

    expect(changed.currentConsensus).toEqual(baseline.currentConsensus);
    expect(
      changed.auditObservations.every(
        (row) => row.availableAt.getTime() <= predictionAsOf.getTime(),
      ),
    ).toBe(true);
  });

  it('detects a multi-bookmaker steam move', () => {
    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: rows(),
      options: {
        minimumBookmakers: 3,
        steamWindowMinutes: 60,
        steamProbabilityThreshold: 0.015,
        steamAgreementThreshold: 0.66,
      },
    });

    expect(result.steamMoveDetected).toBe(true);
    expect(result.steamDirection).toBe('HOME');
    expect(result.bookmakerAgreement).toBe(1);
  });

  it('does not treat one-bookmaker noise as steam', () => {
    const late = new Date('2026-08-01T17:45:00.000Z').getTime();
    const filtered = rows().filter(
      (row) => !(row.capturedAt.getTime() === late && row.bookmakerId !== 1),
    );
    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: filtered,
      options: {
        minimumBookmakers: 3,
        steamWindowMinutes: 60,
        steamProbabilityThreshold: 0.01,
        steamAgreementThreshold: 0.66,
      },
    });

    expect(result.steamMoveDetected).toBe(false);
  });

  it('is unavailable with insufficient complete bookmakers', () => {
    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: market({
        bookmakerId: 1,
        capturedAt: '2026-08-01T17:45:00.000Z',
        home: 2,
        draw: 3.5,
        away: 4,
      }),
      options: { minimumBookmakers: 3 },
    });

    expect(result.available).toBe(false);
    expect(result.bookmakerCount).toBe(1);
  });

  it('rejects incoherent selection timestamps', () => {
    const source = market({
      bookmakerId: 1,
      capturedAt: '2026-08-01T17:00:00.000Z',
      home: 2,
      draw: 3.5,
      away: 4,
    });
    source[2] = {
      ...source[2]!,
      capturedAt: new Date('2026-08-01T18:00:00.000Z'),
    };

    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: source,
      options: {
        minimumBookmakers: 1,
        maximumQuoteSpreadMinutes: 15,
      },
    });

    expect(result.available).toBe(false);
  });

  it('returns a stable finite feature-vector contract', () => {
    const result = analyzeMatchWinnerOddsMovement({
      fixtureId: 10,
      kickoffAt,
      predictionAsOf,
      rows: rows(),
      options: { minimumBookmakers: 3 },
    });

    expect(result.featureVector).toHaveLength(result.featureNames.length);
    expect(result.featureNames).toContain('market_steam_strength');
    expect(result.featureVector.every(Number.isFinite)).toBe(true);
  });
});
