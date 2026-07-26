export const SCIENTIFIC_BANKROLL_RISK_VERSION = 'v7.0-beta.1C-bankroll-staking-risk-v1';
export const SCIENTIFIC_BANKROLL_RISK_POLICY_VERSION = 'v7.0-beta.1C-risk-policy-v1';

const EPSILON = 1e-12;

export type ScientificRiskStakingMode = 'FLAT' | 'FRACTIONAL_KELLY';
export type ScientificRiskDecisionType = 'STAKE' | 'NO_STAKE';
export type ScientificRiskBand = 'NO_STAKE' | 'LOW' | 'STANDARD' | 'HIGH';
export type ScientificRiskSettlementResult = 'WIN' | 'LOSS' | 'PUSH' | 'VOID';

export interface ScientificRiskPolicyConfig {
  accountKey: string;
  policyVersion: string;
  stakingMode: ScientificRiskStakingMode;
  startingBankrollUnits: number;
  flatStakeUnits: number;
  kellyFraction: number;
  minimumStakeUnits: number;
  maximumStakeUnits: number;
  maximumStakeFraction: number;
  maximumOpenExposureFraction: number;
  maximumDailyExposureFraction: number;
  maximumLeagueExposureFraction: number;
  maximumDailyLossFraction: number;
  drawdownSoftLimit: number;
  drawdownHardLimit: number;
  minimumBankrollUnits: number;
  roundingUnits: number;
}

export interface ScientificRiskState {
  currentBankrollUnits: number;
  peakBankrollUnits: number;
  currentDrawdownFraction: number;
  maximumDrawdownFraction: number;
  openExposureUnits: number;
  dailyExposureUnits: number;
  leagueExposureUnits: number;
  dailyRealizedPnlUnits: number;
}

export interface ScientificRiskCandidate {
  decimalOdds: number;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
}

export interface ScientificRiskStakePlan {
  riskVersion: string;
  policyVersion: string;
  decisionType: ScientificRiskDecisionType;
  stakingMode: ScientificRiskStakingMode;
  stakeUnits: number;
  stakeFraction: number;
  requestedStakeUnits: number;
  fullKellyFraction: number | null;
  appliedKellyFraction: number | null;
  drawdownMultiplier: number;
  riskBand: ScientificRiskBand;
  cappedBy: string[];
  reasons: string[];
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw == null || raw.trim() === '' ? fallback : finiteNumber(raw, fallback);
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function modeFromEnvironment(): ScientificRiskStakingMode {
  const raw = process.env.SCIENTIFIC_RISK_STAKING_MODE?.trim().toUpperCase();
  return raw === 'FRACTIONAL_KELLY' ? 'FRACTIONAL_KELLY' : 'FLAT';
}

export function getScientificRiskPolicyConfig(
  overrides: Partial<ScientificRiskPolicyConfig> = {},
): ScientificRiskPolicyConfig {
  const startingBankrollUnits = positive(
    overrides.startingBankrollUnits ?? envNumber('SCIENTIFIC_RISK_STARTING_BANKROLL_UNITS', 100),
    100,
  );
  const drawdownSoftLimit = clamp(
    overrides.drawdownSoftLimit ?? envNumber('SCIENTIFIC_RISK_DRAWDOWN_SOFT_LIMIT', 0.08),
    0,
    0.9,
  );
  const drawdownHardLimit = clamp(
    overrides.drawdownHardLimit ?? envNumber('SCIENTIFIC_RISK_DRAWDOWN_HARD_LIMIT', 0.2),
    Math.min(0.99, drawdownSoftLimit + 0.001),
    0.99,
  );
  return {
    accountKey: overrides.accountKey ?? envString('SCIENTIFIC_RISK_ACCOUNT_KEY', 'PAPER_MAIN'),
    policyVersion: overrides.policyVersion ?? SCIENTIFIC_BANKROLL_RISK_POLICY_VERSION,
    stakingMode: overrides.stakingMode ?? modeFromEnvironment(),
    startingBankrollUnits,
    flatStakeUnits: positive(
      overrides.flatStakeUnits ?? envNumber('SCIENTIFIC_RISK_FLAT_STAKE_UNITS', 1),
      1,
    ),
    kellyFraction: clamp(
      overrides.kellyFraction ?? envNumber('SCIENTIFIC_RISK_KELLY_FRACTION', 0.25),
      0,
      0.5,
    ),
    minimumStakeUnits: Math.max(
      0,
      overrides.minimumStakeUnits ?? envNumber('SCIENTIFIC_RISK_MIN_STAKE_UNITS', 0.25),
    ),
    maximumStakeUnits: positive(
      overrides.maximumStakeUnits ?? envNumber('SCIENTIFIC_RISK_MAX_STAKE_UNITS', 1.5),
      1.5,
    ),
    maximumStakeFraction: clamp(
      overrides.maximumStakeFraction ?? envNumber('SCIENTIFIC_RISK_MAX_STAKE_FRACTION', 0.015),
      0.001,
      0.1,
    ),
    maximumOpenExposureFraction: clamp(
      overrides.maximumOpenExposureFraction ??
        envNumber('SCIENTIFIC_RISK_MAX_OPEN_EXPOSURE_FRACTION', 0.1),
      0.001,
      0.5,
    ),
    maximumDailyExposureFraction: clamp(
      overrides.maximumDailyExposureFraction ??
        envNumber('SCIENTIFIC_RISK_MAX_DAILY_EXPOSURE_FRACTION', 0.05),
      0.001,
      0.5,
    ),
    maximumLeagueExposureFraction: clamp(
      overrides.maximumLeagueExposureFraction ??
        envNumber('SCIENTIFIC_RISK_MAX_LEAGUE_EXPOSURE_FRACTION', 0.04),
      0.001,
      0.5,
    ),
    maximumDailyLossFraction: clamp(
      overrides.maximumDailyLossFraction ?? envNumber('SCIENTIFIC_RISK_MAX_DAILY_LOSS_FRACTION', 0.04),
      0.001,
      0.5,
    ),
    drawdownSoftLimit,
    drawdownHardLimit,
    minimumBankrollUnits: Math.max(
      0,
      overrides.minimumBankrollUnits ?? envNumber('SCIENTIFIC_RISK_MIN_BANKROLL_UNITS', 20),
    ),
    roundingUnits: positive(
      overrides.roundingUnits ?? envNumber('SCIENTIFIC_RISK_ROUNDING_UNITS', 0.05),
      0.05,
    ),
  };
}

function roundDown(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const safeStep = Math.max(EPSILON, step);
  return Math.floor((value + EPSILON) / safeStep) * safeStep;
}

export function scientificRiskDrawdownMultiplier(
  drawdownFraction: number,
  policy: ScientificRiskPolicyConfig,
): number {
  if (drawdownFraction >= policy.drawdownHardLimit) return 0;
  if (drawdownFraction <= policy.drawdownSoftLimit) return 1;
  const progress =
    (drawdownFraction - policy.drawdownSoftLimit) /
    Math.max(EPSILON, policy.drawdownHardLimit - policy.drawdownSoftLimit);
  return clamp(1 - progress * 0.75, 0.25, 1);
}

function noStakePlan(
  policy: ScientificRiskPolicyConfig,
  reason: string,
  extras: Partial<ScientificRiskStakePlan> = {},
): ScientificRiskStakePlan {
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    policyVersion: policy.policyVersion,
    decisionType: 'NO_STAKE',
    stakingMode: policy.stakingMode,
    stakeUnits: 0,
    stakeFraction: 0,
    requestedStakeUnits: extras.requestedStakeUnits ?? 0,
    fullKellyFraction: extras.fullKellyFraction ?? null,
    appliedKellyFraction:
      extras.appliedKellyFraction ?? (policy.stakingMode === 'FRACTIONAL_KELLY' ? policy.kellyFraction : null),
    drawdownMultiplier: extras.drawdownMultiplier ?? 0,
    riskBand: 'NO_STAKE',
    cappedBy: extras.cappedBy ?? [],
    reasons: [reason, ...(extras.reasons ?? [])],
  };
}

export function planScientificPaperStake(input: {
  paperDecisionType: 'BEST_BET' | 'NO_BET';
  candidate: ScientificRiskCandidate | null;
  policy: ScientificRiskPolicyConfig;
  state: ScientificRiskState;
}): ScientificRiskStakePlan {
  const { paperDecisionType, candidate, policy, state } = input;
  if (paperDecisionType !== 'BEST_BET') return noStakePlan(policy, 'PAPER_NO_BET');
  if (candidate == null) return noStakePlan(policy, 'MISSING_SELECTED_BET');
  if (state.currentBankrollUnits <= policy.minimumBankrollUnits + EPSILON) {
    return noStakePlan(policy, 'MINIMUM_BANKROLL_STOP');
  }
  if (state.currentDrawdownFraction >= policy.drawdownHardLimit - EPSILON) {
    return noStakePlan(policy, 'DRAWDOWN_HARD_STOP');
  }
  const maximumDailyLossUnits = policy.startingBankrollUnits * policy.maximumDailyLossFraction;
  if (state.dailyRealizedPnlUnits <= -maximumDailyLossUnits + EPSILON) {
    return noStakePlan(policy, 'DAILY_LOSS_LIMIT');
  }
  if (
    candidate.decimalOdds <= 1 ||
    candidate.modelProbability <= 0 ||
    candidate.modelProbability >= 1 ||
    candidate.expectedValue <= 0 ||
    candidate.edge <= 0
  ) {
    return noStakePlan(policy, 'NO_POSITIVE_RISK_ADJUSTED_EDGE');
  }

  const bankroll = state.currentBankrollUnits;
  const openCap = bankroll * policy.maximumOpenExposureFraction;
  const dailyCap = bankroll * policy.maximumDailyExposureFraction;
  const leagueCap = bankroll * policy.maximumLeagueExposureFraction;
  const remainingOpen = Math.max(0, openCap - state.openExposureUnits);
  const remainingDaily = Math.max(0, dailyCap - state.dailyExposureUnits);
  const remainingLeague = Math.max(0, leagueCap - state.leagueExposureUnits);
  if (remainingOpen <= EPSILON) return noStakePlan(policy, 'MAX_OPEN_EXPOSURE');
  if (remainingDaily <= EPSILON) return noStakePlan(policy, 'MAX_DAILY_EXPOSURE');
  if (remainingLeague <= EPSILON) return noStakePlan(policy, 'MAX_LEAGUE_EXPOSURE');

  const ddMultiplier = scientificRiskDrawdownMultiplier(state.currentDrawdownFraction, policy);
  if (ddMultiplier <= EPSILON) return noStakePlan(policy, 'DRAWDOWN_HARD_STOP');

  let fullKellyFraction: number | null = null;
  let requestedStakeUnits: number;
  if (policy.stakingMode === 'FRACTIONAL_KELLY') {
    const oddsProfit = candidate.decimalOdds - 1;
    fullKellyFraction = Math.max(0, candidate.expectedValue / Math.max(EPSILON, oddsProfit));
    requestedStakeUnits = bankroll * fullKellyFraction * policy.kellyFraction * ddMultiplier;
  } else {
    requestedStakeUnits = policy.flatStakeUnits * ddMultiplier;
  }

  const maxByFraction = bankroll * policy.maximumStakeFraction;
  const caps = [
    { name: 'MAXIMUM_STAKE_UNITS', value: policy.maximumStakeUnits },
    { name: 'MAXIMUM_STAKE_FRACTION', value: maxByFraction },
    { name: 'MAX_OPEN_EXPOSURE', value: remainingOpen },
    { name: 'MAX_DAILY_EXPOSURE', value: remainingDaily },
    { name: 'MAX_LEAGUE_EXPOSURE', value: remainingLeague },
  ];
  const cappedBy = caps
    .filter((cap) => requestedStakeUnits > cap.value + EPSILON)
    .map((cap) => cap.name);
  const maximumAllowed = Math.min(...caps.map((cap) => cap.value));
  const stakeUnits = roundDown(Math.min(requestedStakeUnits, maximumAllowed), policy.roundingUnits);
  if (stakeUnits + EPSILON < policy.minimumStakeUnits) {
    return noStakePlan(policy, 'STAKE_BELOW_MINIMUM', {
      requestedStakeUnits,
      fullKellyFraction,
      appliedKellyFraction: policy.stakingMode === 'FRACTIONAL_KELLY' ? policy.kellyFraction : null,
      drawdownMultiplier: ddMultiplier,
      cappedBy,
    });
  }
  const stakeFraction = stakeUnits / bankroll;
  const relativeToPerBetCap = stakeFraction / Math.max(EPSILON, policy.maximumStakeFraction);
  const riskBand: ScientificRiskBand =
    relativeToPerBetCap < 0.34 ? 'LOW' : relativeToPerBetCap < 0.75 ? 'STANDARD' : 'HIGH';
  return {
    riskVersion: SCIENTIFIC_BANKROLL_RISK_VERSION,
    policyVersion: policy.policyVersion,
    decisionType: 'STAKE',
    stakingMode: policy.stakingMode,
    stakeUnits,
    stakeFraction,
    requestedStakeUnits,
    fullKellyFraction,
    appliedKellyFraction: policy.stakingMode === 'FRACTIONAL_KELLY' ? policy.kellyFraction : null,
    drawdownMultiplier: ddMultiplier,
    riskBand,
    cappedBy,
    reasons: [],
  };
}

export function settleScientificPaperStake(input: {
  result: ScientificRiskSettlementResult;
  stakeUnits: number;
  decimalOdds: number;
}): { result: ScientificRiskSettlementResult; stakeUnits: number; profitUnits: number } {
  if (!Number.isFinite(input.stakeUnits) || input.stakeUnits <= 0) {
    throw new RangeError('stakeUnits must be positive.');
  }
  if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) {
    throw new RangeError('decimalOdds must be greater than 1.');
  }
  const profitUnits =
    input.result === 'WIN'
      ? input.stakeUnits * (input.decimalOdds - 1)
      : input.result === 'LOSS'
        ? -input.stakeUnits
        : 0;
  return { result: input.result, stakeUnits: input.stakeUnits, profitUnits };
}
