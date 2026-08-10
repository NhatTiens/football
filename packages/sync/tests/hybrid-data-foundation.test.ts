import { describe, expect, it } from 'vitest';

import {
  auditHybridPitRows,
  fingerprintHybridPitRows,
  type HybridPitAuditRow,
} from '../src/hybrid-data-foundation-contract.js';

const contractHash = 'contract-hash';

function row(overrides: Partial<HybridPitAuditRow> = {}): HybridPitAuditRow {
  const predictionAsOf = new Date('2026-01-01T10:30:00.000Z');
  const kickoffAt = new Date('2026-01-01T12:00:00.000Z');
  const base: HybridPitAuditRow = {
    id: 1,
    fixtureId: 101,
    leagueId: 39,
    predictionAsOf,
    kickoffAt,
    labelAvailableAt: new Date('2026-01-01T15:00:00.000Z'),
    horizonMinutes: 90,
    labelMatchWinner: 0,
    labelOver25: 1,
    labelBtts: 1,
    fundamentalsAvailable: true,
    marketAvailable: true,
    bookmakerCount: 4,
    marketHomeProbability: 0.5,
    marketDrawProbability: 0.28,
    marketAwayProbability: 0.22,
    featureNames: ['a', 'b'],
    featureVector: [0.1, 0.2],
    featureContractHash: contractHash,
    payloadHash: 'feature-hash',
    source: {
      predictionAsOf,
      horizonMinutes: 90,
      dixonSnapshotId: 11,
      homeFundamentalSnapshotId: 21,
      awayFundamentalSnapshotId: 22,
      dixonPayloadHash: 'dixon-hash',
      homePayloadHash: 'home-hash',
      awayPayloadHash: 'away-hash',
      marketObservedFrom: new Date('2026-01-01T09:00:00.000Z'),
      marketObservedTo: new Date('2026-01-01T10:25:00.000Z'),
    },
    dixon: {
      id: 11,
      fixtureId: 101,
      horizonMinutes: 90,
      predictionAsOf,
      trainedThrough: new Date('2025-12-31T23:59:59.000Z'),
      payloadHash: 'dixon-hash',
    },
    homeFundamental: {
      id: 21,
      fixtureId: 101,
      horizonMinutes: 90,
      predictionAsOf,
      payloadHash: 'home-hash',
    },
    awayFundamental: {
      id: 22,
      fixtureId: 101,
      horizonMinutes: 90,
      predictionAsOf,
      payloadHash: 'away-hash',
    },
  };
  return { ...base, ...overrides };
}

describe('hybrid PIT data foundation', () => {
  it('passes a strict point-in-time row', () => {
    const result = auditHybridPitRows([row()], {
      expectedFeatureContractHash: contractHash,
      requiredHorizons: [90],
      minimumRowsPerHorizon: 1,
      horizonToleranceMinutes: 1,
    });
    expect(result.status).toBe('READY_FOR_BAYESIAN');
    expect(result.errors).toBe(0);
    expect(result.safeRows).toBe(1);
  });

  it('blocks trainedThrough equal to predictionAsOf', () => {
    const predictionAsOf = new Date('2026-01-01T10:30:00.000Z');
    const input = row({
      predictionAsOf,
      dixon: {
        id: 11,
        fixtureId: 101,
        horizonMinutes: 90,
        predictionAsOf,
        trainedThrough: predictionAsOf,
        payloadHash: 'dixon-hash',
      },
    });
    const result = auditHybridPitRows([input], {
      expectedFeatureContractHash: contractHash,
      requiredHorizons: [90],
      minimumRowsPerHorizon: 1,
    });
    expect(result.status).toBe('BLOCKED_PIT_OR_CONTRACT');
    expect(result.findings.some((entry) => entry.code === 'DIXON_TRAINING_LEAKAGE')).toBe(true);
  });

  it('blocks odds observed after decision time', () => {
    const input = row();
    input.source = {
      ...input.source,
      marketObservedTo: new Date('2026-01-01T10:31:00.000Z'),
    };
    const result = auditHybridPitRows([input], {
      expectedFeatureContractHash: contractHash,
      requiredHorizons: [90],
      minimumRowsPerHorizon: 1,
    });
    expect(result.findings.some((entry) => entry.code === 'MARKET_OBSERVED_AFTER_PREDICTION')).toBe(true);
  });

  it('blocks duplicate fixture/horizon rows', () => {
    const result = auditHybridPitRows([row(), row({ id: 2, payloadHash: 'other' })], {
      expectedFeatureContractHash: contractHash,
      requiredHorizons: [90],
      minimumRowsPerHorizon: 1,
    });
    expect(result.duplicateGroups).toBe(1);
    expect(result.findings.filter((entry) => entry.code === 'DUPLICATE_FIXTURE_HORIZON')).toHaveLength(2);
  });

  it('reports missing required horizon coverage without inventing rows', () => {
    const result = auditHybridPitRows([row()], {
      expectedFeatureContractHash: contractHash,
      requiredHorizons: [180, 90],
      minimumRowsPerHorizon: 1,
    });
    expect(result.status).toBe('INSUFFICIENT_COVERAGE');
    expect(result.coverage.find((entry) => entry.horizonMinutes === 180)?.rows).toBe(0);
  });

  it('creates a stable fingerprint independent of input order', () => {
    const first = row();
    const second = row({
      id: 2,
      fixtureId: 102,
      payloadHash: 'feature-hash-2',
      dixon: { ...row().dixon!, fixtureId: 102 },
      homeFundamental: { ...row().homeFundamental!, fixtureId: 102 },
      awayFundamental: { ...row().awayFundamental!, fixtureId: 102 },
    });
    expect(fingerprintHybridPitRows([first, second])).toBe(fingerprintHybridPitRows([second, first]));
  });
});
