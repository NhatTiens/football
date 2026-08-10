import { describe, expect, it } from 'vitest';

import {
  evaluateV8ShadowReleaseGate,
  type V8ReleaseGateEvidence,
} from '../src/v8-shadow-release-gate-contract.js';

function eligibleEvidence(): V8ReleaseGateEvidence {
  return {
    baseline: {
      championTagPresent: true,
      stage1TagPresent: true,
      currentChampionChanged: false,
    },
    backtest: {
      artifactPresent: true,
      artifactHashVerified: true,
      status: 'READY_FOR_PAPER_RUNTIME',
      promotionEligible: true,
      championEce: 0.04,
      challengerEce: 0.035,
      championRoi: 0.1,
      challengerRoi: 0.12,
      gateReasons: [],
    },
    paper: {
      decisions: 300,
      bestBets: 150,
      noBets: 150,
      settledBestBets: 120,
      activeDecisionDays: 35,
      observationSpanDays: 36,
      duplicateSemanticDecisions: 0,
      sourceOddsAfterDecisionViolations: 0,
      maturedBestBetsMissingSettlement: 0,
      roi: 0.03,
      meanClv: 0.01,
      ece: 0.045,
      maximumDrawdownUnits: 12,
    },
    liveData: { status: 'READY_FOR_SHADOW_INPUT', blockers: [] },
    policy: { ouPolicyParityCertified: true, reason: null },
  };
}

describe('Stage 11 v8 shadow release gate', () => {
  it('requires manual review even when all evidence passes', () => {
    const result = evaluateV8ShadowReleaseGate(eligibleEvidence());
    expect(result.status).toBe('READY_FOR_MANUAL_PROMOTION_REVIEW');
    expect(result.promotionEligible).toBe(true);
    expect(result.automaticPromotion).toBe(false);
    expect(result.currentChampionChanged).toBe(false);
  });

  it('blocks empty paper evidence, stale live data and uncertified O/U parity', () => {
    const evidence = eligibleEvidence();
    evidence.paper.decisions = 0;
    evidence.paper.settledBestBets = 0;
    evidence.paper.activeDecisionDays = 0;
    evidence.paper.observationSpanDays = 0;
    evidence.paper.roi = null;
    evidence.paper.meanClv = null;
    evidence.paper.ece = null;
    evidence.paper.maximumDrawdownUnits = null;
    evidence.liveData.status = 'BLOCKED_LIVE_DATA_FRESHNESS';
    evidence.policy.ouPolicyParityCertified = false;
    const result = evaluateV8ShadowReleaseGate(evidence);
    expect(result.promotionEligible).toBe(false);
    expect(result.blockers).toContain('PAPER_SETTLED_BEST_BETS_BELOW_100');
    expect(result.blockers).toContain('STAGE10_LIVE_DATA_NOT_READY');
    expect(result.blockers).toContain('V7_V8_PAPER_OU_POLICY_PARITY_NOT_CERTIFIED');
  });

  it('blocks PIT violations and semantic duplicates', () => {
    const evidence = eligibleEvidence();
    evidence.paper.duplicateSemanticDecisions = 1;
    evidence.paper.sourceOddsAfterDecisionViolations = 1;
    const result = evaluateV8ShadowReleaseGate(evidence);
    expect(result.blockers).toContain('DUPLICATE_SEMANTIC_PAPER_DECISIONS');
    expect(result.blockers).toContain('SOURCE_ODDS_AFTER_DECISION_PIT_VIOLATION');
  });
});
