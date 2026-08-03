import { describe, expect, it } from 'vitest';

import {
  aggregateDecisionOpportunityAudit,
  auditDecisionOpportunity,
  type DecisionOpportunitySnapshot,
  type FreshOddsCheckpointEvidence,
  type PaperDecisionEvidence,
} from '../src/decision-opportunity-audit-core.js';

const kickoffAt = new Date('2026-07-30T12:00:00.000Z');
const reportAsOf = new Date('2026-07-30T16:00:00.000Z');

function snapshot(
  overrides: Partial<DecisionOpportunitySnapshot> = {},
): DecisionOpportunitySnapshot {
  return {
    snapshotId: 101,
    snapshotHash: 'a'.repeat(64),
    providerFixtureId: 9001,
    checkpointMinutes: 90,
    checkpointLabel: 'T-90',
    snapshotAsOf: new Date('2026-07-30T10:30:00.000Z'),
    kickoffAt,
    analysisStatus: 'AVAILABLE',
    candidateCount: 12,
    currentEligibleCandidateCount: 2,
    officialEligibleCandidateCount: 0,
    modelSources: ['SCIENTIFIC_BASELINE_FALLBACK'],
    confidenceTiers: ['LIMITED'],
    reliabilityStatuses: ['DIAGNOSTIC_ELIGIBLE'],
    modelHistorySampleSizes: [0],
    currentRejectionReasons: [
      'CURRENT_BASELINE_FALLBACK_RESEARCH_ONLY',
      'CURRENT_MODEL_HISTORY_INSUFFICIENT',
    ],
    officialRejectionReasons: ['CURRENT_BASELINE_FALLBACK_NOT_OFFICIAL'],
    ...overrides,
  };
}

function decision(overrides: Partial<PaperDecisionEvidence> = {}): PaperDecisionEvidence {
  return {
    id: 201,
    providerFixtureId: 9001,
    horizonMinutes: 90,
    decisionAsOf: new Date('2026-07-30T10:30:00.000Z'),
    kickoffAt,
    decisionType: 'NO_BET',
    selectedMarket: null,
    selectedSelection: null,
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<FreshOddsCheckpointEvidence> = {},
): FreshOddsCheckpointEvidence {
  return {
    id: 301,
    providerFixtureId: 9001,
    horizonMinutes: 90,
    status: 'SUCCESS',
    dueAt: new Date('2026-07-30T10:30:00.000Z'),
    attemptedAt: new Date('2026-07-30T10:30:00.000Z'),
    completedAt: new Date('2026-07-30T10:30:20.000Z'),
    attempts: 1,
    normalizedOdds: 15,
    pitUsableOdds: 15,
    errorMessage: null,
    ...overrides,
  };
}

describe('R4.10.2.11.1 decision opportunity audit', () => {
  it('does not call a non-paper horizon an operational gap', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot({
        checkpointMinutes: 60,
        checkpointLabel: 'T-60',
      }),
      paperDecisions: [],
      freshOddsCheckpoint: null,
      reportAsOf,
    });

    expect(row.scheduledPaperHorizon).toBe(false);
    expect(row.paperDecisionLinkStatus).toBe('NOT_CONFIGURED_HORIZON');
    expect(row.opportunityClassification).toBe('NOT_APPLICABLE');
    expect(row.primaryReason).toBe('PAPER_HORIZON_NOT_CONFIGURED');
  });

  it('keeps an open decision window pending', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot(),
      paperDecisions: [],
      freshOddsCheckpoint: checkpoint(),
      reportAsOf: new Date('2026-07-30T10:31:00.000Z'),
    });

    expect(row.paperDecisionLinkStatus).toBe('PENDING_DECISION_WINDOW');
    expect(row.opportunityClassification).toBe('PENDING');
    expect(row.primaryReason).toBe('DECISION_WINDOW_PENDING');
  });

  it('links a PIT-valid paper BEST_BET decision', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot({
        officialEligibleCandidateCount: 1,
        modelSources: ['DYNAMIC_DIXON_COLES'],
        confidenceTiers: ['HIGH'],
        modelHistorySampleSizes: [20],
      }),
      paperDecisions: [
        decision({
          decisionType: 'BEST_BET',
          selectedMarket: 'MATCH_WINNER',
          selectedSelection: 'HOME',
        }),
      ],
      freshOddsCheckpoint: checkpoint(),
      reportAsOf,
    });

    expect(row.paperDecisionLinkStatus).toBe('BEST_BET_LINKED');
    expect(row.linkedDecisionId).toBe(201);
    expect(row.opportunityClassification).toBe('COVERED');
    expect(row.modelAvailabilityStatus).toBe('DYNAMIC_MODEL_AVAILABLE');
    expect(row.primaryReason).toBe('PAPER_BEST_BET_RECORDED');
  });

  it('links NO_BET as a valid terminal paper decision', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot(),
      paperDecisions: [decision()],
      freshOddsCheckpoint: checkpoint(),
      reportAsOf,
    });

    expect(row.paperDecisionLinkStatus).toBe('NO_BET_LINKED');
    expect(row.opportunityClassification).toBe('COVERED');
    expect(row.primaryReason).toBe('PAPER_NO_BET_RECORDED');
  });

  it('classifies a matured fallback opportunity without a decision', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot(),
      paperDecisions: [],
      freshOddsCheckpoint: checkpoint(),
      reportAsOf,
    });

    expect(row.paperDecisionLinkStatus).toBe('MISSING_EXPECTED_DECISION');
    expect(row.opportunityClassification).toBe('OPERATIONAL_GAP');
    expect(row.modelAvailabilityStatus).toBe('BASELINE_FALLBACK_ONLY');
    expect(row.promotionEvidenceStatus).toBe('RESEARCH_SIGNAL_ONLY');
    expect(row.primaryReason).toBe('BASELINE_FALLBACK_OFFICIAL_LOCK');
    expect(row.reasonCodes).toContain('DECISION_CYCLE_MISSING');
    expect(row.reasonCodes).toContain('LIMITED_CONFIDENCE_RESEARCH_ONLY');
  });

  it('separates missing odds/model prerequisites from decision-cycle gaps', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot({
        analysisStatus: 'NO_FRESH_PIT_ODDS',
        candidateCount: 0,
        currentEligibleCandidateCount: 0,
        modelSources: [],
        confidenceTiers: [],
        reliabilityStatuses: [],
        modelHistorySampleSizes: [],
      }),
      paperDecisions: [],
      freshOddsCheckpoint: checkpoint({
        status: 'EMPTY',
        pitUsableOdds: 0,
      }),
      reportAsOf,
    });

    expect(row.opportunityClassification).toBe('PREREQUISITE_GAP');
    expect(row.primaryReason).toBe('SNAPSHOT_NO_FRESH_PIT_ODDS');
    expect(row.reasonCodes).toContain('MODEL_OUTPUT_UNAVAILABLE');
    expect(row.reasonCodes).toContain('NO_PIT_USABLE_ODDS');
  });

  it('rejects a paper decision outside its PIT horizon window', () => {
    const row = auditDecisionOpportunity({
      snapshot: snapshot(),
      paperDecisions: [
        decision({
          decisionAsOf: new Date('2026-07-30T10:35:00.000Z'),
        }),
      ],
      freshOddsCheckpoint: checkpoint(),
      reportAsOf,
    });

    expect(row.paperDecisionLinkStatus).toBe('INVALID_DECISION_LINEAGE');
    expect(row.opportunityClassification).toBe('INVALID');
    expect(row.reasonCodes).toContain('PAPER_DECISION_WINDOW_MISMATCH');
  });

  it('aggregates terminal coverage and model availability by horizon', () => {
    const covered = auditDecisionOpportunity({
      snapshot: snapshot(),
      paperDecisions: [decision()],
      freshOddsCheckpoint: checkpoint(),
      reportAsOf,
    });
    const missing = auditDecisionOpportunity({
      snapshot: snapshot({
        snapshotId: 102,
        snapshotHash: 'b'.repeat(64),
        providerFixtureId: 9002,
        checkpointMinutes: 30,
        checkpointLabel: 'T-30',
      }),
      paperDecisions: [],
      freshOddsCheckpoint: checkpoint({
        id: 302,
        providerFixtureId: 9002,
        horizonMinutes: 30,
        dueAt: new Date('2026-07-30T11:30:00.000Z'),
      }),
      reportAsOf,
    });
    const report = aggregateDecisionOpportunityAudit([covered, missing]);

    expect(report.overall.scheduled).toBe(2);
    expect(report.overall.maturedScheduled).toBe(2);
    expect(report.overall.covered).toBe(1);
    expect(report.overall.terminalDecisionCoverageRate).toBe(0.5);
    expect(report.overall.operationalGaps).toBe(1);
    expect(report.overall.fallbackModelRows).toBe(2);
    expect(report.byHorizon.map((row) => row.key)).toEqual(['T-90', 'T-30']);
    expect(report.automaticPromotion).toBe(false);
    expect(report.realMoneyExecution).toBe(false);
  });
});
