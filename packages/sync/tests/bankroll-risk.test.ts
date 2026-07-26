import { describe, expect, it } from 'vitest';
import {
  getScientificRiskPolicyConfig,
  planScientificPaperStake,
  scientificRiskDrawdownMultiplier,
  settleScientificPaperStake,
  type ScientificRiskState,
} from '../src/bankroll-risk-core.js';

function state(overrides: Partial<ScientificRiskState> = {}): ScientificRiskState {
  return {
    currentBankrollUnits: 100,
    peakBankrollUnits: 100,
    currentDrawdownFraction: 0,
    maximumDrawdownFraction: 0,
    openExposureUnits: 0,
    dailyExposureUnits: 0,
    leagueExposureUnits: 0,
    dailyRealizedPnlUnits: 0,
    ...overrides,
  };
}

const candidate = {
  decimalOdds: 2,
  modelProbability: 0.56,
  fairMarketProbability: 0.5,
  edge: 0.06,
  expectedValue: 0.12,
};

describe('beta.1C bankroll/staking/risk core', () => {
  it('defaults to flat, paper-oriented 100-unit bankroll policy', () => {
    const policy = getScientificRiskPolicyConfig({});
    expect(policy.stakingMode).toBe('FLAT');
    expect(policy.startingBankrollUnits).toBe(100);
    expect(policy.flatStakeUnits).toBe(1);
    expect(policy.maximumDailyExposureFraction).toBe(0.05);
    expect(policy.drawdownHardLimit).toBe(0.2);
  });

  it('never stakes a NO_BET paper decision', () => {
    const plan = planScientificPaperStake({
      paperDecisionType: 'NO_BET',
      candidate: null,
      policy: getScientificRiskPolicyConfig(),
      state: state(),
    });
    expect(plan.decisionType).toBe('NO_STAKE');
    expect(plan.reasons).toContain('PAPER_NO_BET');
  });

  it('stakes 1u under the default flat policy when risk is clean', () => {
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy: getScientificRiskPolicyConfig(),
      state: state(),
    });
    expect(plan.decisionType).toBe('STAKE');
    expect(plan.stakeUnits).toBe(1);
    expect(plan.stakeFraction).toBeCloseTo(0.01, 10);
  });

  it('supports fractional Kelly without full Kelly', () => {
    const policy = getScientificRiskPolicyConfig({
      stakingMode: 'FRACTIONAL_KELLY',
      kellyFraction: 0.25,
      maximumStakeUnits: 10,
      maximumStakeFraction: 0.1,
      maximumOpenExposureFraction: 0.5,
      maximumDailyExposureFraction: 0.5,
      maximumLeagueExposureFraction: 0.5,
      roundingUnits: 0.01,
    });
    const plan = planScientificPaperStake({ paperDecisionType: 'BEST_BET', candidate, policy, state: state() });
    expect(plan.fullKellyFraction).toBeCloseTo(0.12, 10);
    expect(plan.stakeUnits).toBeCloseTo(3, 8);
    expect(plan.appliedKellyFraction).toBe(0.25);
  });

  it('hard-stops on maximum drawdown', () => {
    const policy = getScientificRiskPolicyConfig();
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ currentBankrollUnits: 80, peakBankrollUnits: 100, currentDrawdownFraction: 0.2 }),
    });
    expect(plan.decisionType).toBe('NO_STAKE');
    expect(plan.reasons).toContain('DRAWDOWN_HARD_STOP');
  });

  it('soft drawdown reduces stake instead of increasing risk', () => {
    const policy = getScientificRiskPolicyConfig({ flatStakeUnits: 1, roundingUnits: 0.05 });
    const multiplier = scientificRiskDrawdownMultiplier(0.14, policy);
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ currentBankrollUnits: 86, peakBankrollUnits: 100, currentDrawdownFraction: 0.14 }),
    });
    expect(multiplier).toBeLessThan(1);
    expect(plan.stakeUnits).toBeLessThan(1);
    expect(plan.stakeUnits).toBeGreaterThan(0);
  });

  it('rejects when daily loss limit is reached', () => {
    const policy = getScientificRiskPolicyConfig({ maximumDailyLossFraction: 0.04 });
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ dailyRealizedPnlUnits: -4 }),
    });
    expect(plan.decisionType).toBe('NO_STAKE');
    expect(plan.reasons).toContain('DAILY_LOSS_LIMIT');
  });

  it('rejects when open exposure cap is exhausted', () => {
    const policy = getScientificRiskPolicyConfig({ maximumOpenExposureFraction: 0.1 });
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ openExposureUnits: 10 }),
    });
    expect(plan.reasons).toContain('MAX_OPEN_EXPOSURE');
  });

  it('rejects when daily exposure cap is exhausted', () => {
    const policy = getScientificRiskPolicyConfig({ maximumDailyExposureFraction: 0.05 });
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ dailyExposureUnits: 5 }),
    });
    expect(plan.reasons).toContain('MAX_DAILY_EXPOSURE');
  });

  it('rejects when league exposure cap is exhausted', () => {
    const policy = getScientificRiskPolicyConfig({ maximumLeagueExposureFraction: 0.04 });
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ leagueExposureUnits: 4 }),
    });
    expect(plan.reasons).toContain('MAX_LEAGUE_EXPOSURE');
  });

  it('caps stake per bet rather than exceeding the configured maximum', () => {
    const policy = getScientificRiskPolicyConfig({
      stakingMode: 'FLAT',
      flatStakeUnits: 3,
      maximumStakeUnits: 1.5,
      maximumStakeFraction: 0.05,
      maximumOpenExposureFraction: 0.5,
      maximumDailyExposureFraction: 0.5,
      maximumLeagueExposureFraction: 0.5,
    });
    const plan = planScientificPaperStake({ paperDecisionType: 'BEST_BET', candidate, policy, state: state() });
    expect(plan.stakeUnits).toBe(1.5);
    expect(plan.cappedBy).toContain('MAXIMUM_STAKE_UNITS');
  });

  it('stops when bankroll reaches the configured floor', () => {
    const policy = getScientificRiskPolicyConfig({ minimumBankrollUnits: 20 });
    const plan = planScientificPaperStake({
      paperDecisionType: 'BEST_BET',
      candidate,
      policy,
      state: state({ currentBankrollUnits: 20, peakBankrollUnits: 100, currentDrawdownFraction: 0 }),
    });
    expect(plan.reasons).toContain('MINIMUM_BANKROLL_STOP');
  });

  it('settles WIN and LOSS using the risk-adjusted stake', () => {
    expect(settleScientificPaperStake({ result: 'WIN', stakeUnits: 1.5, decimalOdds: 2.2 }).profitUnits).toBeCloseTo(1.8, 10);
    expect(settleScientificPaperStake({ result: 'LOSS', stakeUnits: 1.5, decimalOdds: 2.2 }).profitUnits).toBe(-1.5);
    expect(settleScientificPaperStake({ result: 'PUSH', stakeUnits: 1.5, decimalOdds: 2.2 }).profitUnits).toBe(0);
  });
});
