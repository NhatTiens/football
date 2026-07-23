export const SCIENTIFIC_STAKING_VERSION =
  'risk-adjusted-fractional-kelly-v6.2';

const EPSILON = 1e-12;

export type ScientificStakingProfile =
  | 'CONSERVATIVE'
  | 'BALANCED'
  | 'GROWTH'
  | 'CUSTOM';

export interface ScientificBankrollConfig {
  enabled: boolean;
  profile: ScientificStakingProfile;
  bankrollUnits: number;
  bankrollAmount: number | null;
  bankrollCurrency: string;
  fixedStakeUnits: number;
  kellyFraction: number;
  minimumStakeUnits: number;
  maximumStakeUnits: number;
  maximumStakeFraction: number;
  maximumFixtureExposureFraction: number;
  maximumDailyExposureFraction: number;
  roundingUnits: number;
  drawdownSoftLimit: number;
  drawdownHardLimit: number;
  edgeReference: number;
  expectedValueReference: number;
  currentDrawdownFraction: number;
  currentDailyExposureUnits: number;
}

export interface ScientificStakeCandidate {
  decimalOdds: number;
  modelProbability: number;
  expectedValue: number;
  edge: number;
  confidenceScore: number;
  dataQualityScore: number;
  recommendationScore: number;
}

export type ScientificStakeRiskBand =
  | 'NO_BET'
  | 'LOW'
  | 'STANDARD'
  | 'HIGH';

export interface ScientificStakePlan {
  stakingVersion: string;
  profile: ScientificStakingProfile;
  stakeUnits: number;
  stakeFraction: number;
  stakeAmount: number | null;
  stakeCurrency: string | null;
  fullKellyFraction: number;
  appliedKellyFraction: number;
  qualityMultiplier: number;
  edgeMultiplier: number;
  expectedValueMultiplier: number;
  drawdownMultiplier: number;
  riskBand: ScientificStakeRiskBand;
  cappedBy: string[];
  skippedReason: string | null;
}

export interface ScientificStakePortfolioBet<Candidate> {
  candidate: Candidate;
  stakePlan: ScientificStakePlan;
}

export interface ScientificStakePortfolio<Candidate> {
  bets: ScientificStakePortfolioBet<Candidate>[];
  totalStakeUnits: number;
  totalStakeAmount: number | null;
  rejectedForStake: number;
  rejectionReasons: Record<string, number>;
}

export interface ScientificBankrollSnapshot {
  stakingVersion: string;
  startingBankrollUnits: number;
  endingBankrollUnits: number;
  peakBankrollUnits: number;
  profitUnits: number;
  bankrollReturn: number;
  totalStakeUnits: number;
  averageStakeUnits: number | null;
  largestStakeUnits: number;
  maximumDrawdownUnits: number;
  maximumDrawdownFraction: number;
  betCount: number;
}

interface ProfileDefaults {
  kellyFraction: number;
  maximumStakeFraction: number;
  maximumFixtureExposureFraction: number;
  maximumDailyExposureFraction: number;
  maximumStakeUnits: number;
}

const PROFILE_DEFAULTS: Record<Exclude<ScientificStakingProfile, 'CUSTOM'>, ProfileDefaults> = {
  CONSERVATIVE: {
    kellyFraction: 0.1,
    maximumStakeFraction: 0.01,
    maximumFixtureExposureFraction: 0.015,
    maximumDailyExposureFraction: 0.05,
    maximumStakeUnits: 1,
  },
  BALANCED: {
    kellyFraction: 0.2,
    maximumStakeFraction: 0.015,
    maximumFixtureExposureFraction: 0.025,
    maximumDailyExposureFraction: 0.08,
    maximumStakeUnits: 1.5,
  },
  GROWTH: {
    kellyFraction: 0.3,
    maximumStakeFraction: 0.02,
    maximumFixtureExposureFraction: 0.03,
    maximumDailyExposureFraction: 0.1,
    maximumStakeUnits: 2,
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function numberEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumberEnvironment(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringEnvironment(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

function booleanEnvironment(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

function profileEnvironment(): ScientificStakingProfile {
  const raw = process.env.SCIENTIFIC_STAKING_PROFILE?.trim().toUpperCase();
  if (
    raw === 'CONSERVATIVE' ||
    raw === 'BALANCED' ||
    raw === 'GROWTH' ||
    raw === 'CUSTOM'
  ) {
    return raw;
  }
  return 'BALANCED';
}

function roundDown(value: number, step: number): number {
  if (value <= 0) return 0;
  const safeStep = Math.max(EPSILON, step);
  return Math.floor((value + EPSILON) / safeStep) * safeStep;
}

function profileDefaults(profile: ScientificStakingProfile): ProfileDefaults {
  if (profile === 'CUSTOM') return PROFILE_DEFAULTS.BALANCED;
  return PROFILE_DEFAULTS[profile];
}

export function getScientificBankrollConfig(
  overrides: Partial<ScientificBankrollConfig> = {},
): ScientificBankrollConfig {
  const profile = overrides.profile ?? profileEnvironment();
  const defaults = profileDefaults(profile);
  const bankrollUnits = Math.max(
    1,
    overrides.bankrollUnits ??
      numberEnvironment('SCIENTIFIC_BANKROLL_UNITS', 100),
  );
  const drawdownSoftLimit = clamp(
    overrides.drawdownSoftLimit ??
      numberEnvironment('SCIENTIFIC_DRAWDOWN_SOFT_LIMIT', 0.08),
    0,
    0.9,
  );
  const drawdownHardLimit = clamp(
    overrides.drawdownHardLimit ??
      numberEnvironment('SCIENTIFIC_DRAWDOWN_HARD_LIMIT', 0.2),
    drawdownSoftLimit + 0.001,
    0.99,
  );

  return {
    enabled:
      overrides.enabled ??
      booleanEnvironment('SCIENTIFIC_STAKING_ENABLED', true),
    profile,
    bankrollUnits,
    bankrollAmount:
      overrides.bankrollAmount ??
      nullableNumberEnvironment('SCIENTIFIC_BANKROLL_AMOUNT'),
    bankrollCurrency:
      overrides.bankrollCurrency ??
      stringEnvironment('SCIENTIFIC_BANKROLL_CURRENCY', 'VND'),
    fixedStakeUnits: Math.max(
      0.01,
      overrides.fixedStakeUnits ??
        numberEnvironment('SCIENTIFIC_FIXED_STAKE_UNITS', 1),
    ),
    kellyFraction: clamp(
      overrides.kellyFraction ??
        numberEnvironment(
          'SCIENTIFIC_KELLY_FRACTION',
          defaults.kellyFraction,
        ),
      0,
      0.5,
    ),
    minimumStakeUnits: Math.max(
      0,
      overrides.minimumStakeUnits ??
        numberEnvironment('SCIENTIFIC_MIN_STAKE_UNITS', 0.1),
    ),
    maximumStakeUnits: Math.max(
      0.01,
      overrides.maximumStakeUnits ??
        numberEnvironment(
          'SCIENTIFIC_MAX_STAKE_UNITS',
          defaults.maximumStakeUnits,
        ),
    ),
    maximumStakeFraction: clamp(
      overrides.maximumStakeFraction ??
        numberEnvironment(
          'SCIENTIFIC_MAX_STAKE_FRACTION',
          defaults.maximumStakeFraction,
        ),
      0.001,
      0.05,
    ),
    maximumFixtureExposureFraction: clamp(
      overrides.maximumFixtureExposureFraction ??
        numberEnvironment(
          'SCIENTIFIC_MAX_FIXTURE_EXPOSURE_FRACTION',
          defaults.maximumFixtureExposureFraction,
        ),
      0.001,
      0.1,
    ),
    maximumDailyExposureFraction: clamp(
      overrides.maximumDailyExposureFraction ??
        numberEnvironment(
          'SCIENTIFIC_MAX_DAILY_EXPOSURE_FRACTION',
          defaults.maximumDailyExposureFraction,
        ),
      0.001,
      0.25,
    ),
    roundingUnits: Math.max(
      0.001,
      overrides.roundingUnits ??
        numberEnvironment('SCIENTIFIC_STAKE_ROUNDING_UNITS', 0.05),
    ),
    drawdownSoftLimit,
    drawdownHardLimit,
    edgeReference: Math.max(
      0.001,
      overrides.edgeReference ??
        numberEnvironment('SCIENTIFIC_STAKE_EDGE_REFERENCE', 0.06),
    ),
    expectedValueReference: Math.max(
      0.001,
      overrides.expectedValueReference ??
        numberEnvironment('SCIENTIFIC_STAKE_EV_REFERENCE', 0.12),
    ),
    currentDrawdownFraction: clamp(
      overrides.currentDrawdownFraction ??
        numberEnvironment('SCIENTIFIC_CURRENT_DRAWDOWN_FRACTION', 0),
      0,
      1,
    ),
    currentDailyExposureUnits: Math.max(
      0,
      overrides.currentDailyExposureUnits ??
        numberEnvironment('SCIENTIFIC_CURRENT_DAILY_EXPOSURE_UNITS', 0),
    ),
  };
}

function drawdownMultiplier(
  drawdownFraction: number,
  config: ScientificBankrollConfig,
): number {
  if (drawdownFraction >= config.drawdownHardLimit) return 0;
  if (drawdownFraction <= config.drawdownSoftLimit) return 1;
  const progress =
    (drawdownFraction - config.drawdownSoftLimit) /
    Math.max(EPSILON, config.drawdownHardLimit - config.drawdownSoftLimit);
  return clamp(1 - progress * 0.8, 0.2, 1);
}

function noBetPlan(
  config: ScientificBankrollConfig,
  skippedReason: string,
): ScientificStakePlan {
  return {
    stakingVersion: SCIENTIFIC_STAKING_VERSION,
    profile: config.profile,
    stakeUnits: 0,
    stakeFraction: 0,
    stakeAmount: null,
    stakeCurrency: null,
    fullKellyFraction: 0,
    appliedKellyFraction: config.enabled ? config.kellyFraction : 0,
    qualityMultiplier: 0,
    edgeMultiplier: 0,
    expectedValueMultiplier: 0,
    drawdownMultiplier: 0,
    riskBand: 'NO_BET',
    cappedBy: [],
    skippedReason,
  };
}

export function calculateScientificStake(input: {
  candidate: ScientificStakeCandidate;
  config: ScientificBankrollConfig;
  currentBankrollUnits?: number;
  peakBankrollUnits?: number;
  maximumAdditionalStakeUnits?: number;
}): ScientificStakePlan {
  const { candidate, config } = input;
  const currentBankrollUnits = Math.max(
    0,
    input.currentBankrollUnits ?? config.bankrollUnits,
  );
  const peakBankrollUnits = Math.max(
    currentBankrollUnits,
    input.peakBankrollUnits ?? currentBankrollUnits,
  );
  if (currentBankrollUnits <= EPSILON) {
    return noBetPlan(config, 'BANKROLL_DEPLETED');
  }
  if (
    candidate.decimalOdds <= 1 ||
    candidate.expectedValue <= 0 ||
    candidate.edge <= 0 ||
    candidate.modelProbability <= 0 ||
    candidate.modelProbability >= 1
  ) {
    return noBetPlan(config, 'NO_POSITIVE_RISK_ADJUSTED_EDGE');
  }

  const observedDrawdown =
    peakBankrollUnits > EPSILON
      ? Math.max(0, (peakBankrollUnits - currentBankrollUnits) / peakBankrollUnits)
      : 0;
  const effectiveDrawdown = Math.max(
    observedDrawdown,
    config.currentDrawdownFraction,
  );
  const drawdownRiskMultiplier = drawdownMultiplier(
    effectiveDrawdown,
    config,
  );
  if (drawdownRiskMultiplier <= 0) {
    return noBetPlan(config, 'DRAWDOWN_HARD_STOP');
  }

  const oddsProfit = candidate.decimalOdds - 1;
  const fullKellyFraction = Math.max(
    0,
    candidate.expectedValue / Math.max(EPSILON, oddsProfit),
  );
  const qualityMultiplier = clamp(
    Math.sqrt(
      clamp(candidate.confidenceScore, 0, 1) *
        clamp(candidate.dataQualityScore, 0, 1),
    ),
    0,
    1,
  );
  const edgeMultiplier = clamp(
    candidate.edge / config.edgeReference,
    0.15,
    1,
  );
  const expectedValueMultiplier = clamp(
    candidate.expectedValue / config.expectedValueReference,
    0.15,
    1,
  );

  const uncappedFraction = config.enabled
    ? fullKellyFraction *
      config.kellyFraction *
      qualityMultiplier *
      edgeMultiplier *
      expectedValueMultiplier *
      drawdownRiskMultiplier
    : config.fixedStakeUnits / currentBankrollUnits;

  const cappedBy: string[] = [];
  const maximumByUnits = config.maximumStakeUnits;
  const maximumByFraction =
    currentBankrollUnits * config.maximumStakeFraction;
  let maximumUnits = Math.min(maximumByUnits, maximumByFraction);
  if (input.maximumAdditionalStakeUnits !== undefined) {
    const additionalCap = Math.max(0, input.maximumAdditionalStakeUnits);
    maximumUnits = Math.min(maximumUnits, additionalCap);
  }

  const uncappedUnits = currentBankrollUnits * Math.max(0, uncappedFraction);
  if (uncappedUnits > maximumByUnits + EPSILON) {
    cappedBy.push('MAXIMUM_STAKE_UNITS');
  }
  if (uncappedUnits > maximumByFraction + EPSILON) {
    cappedBy.push('MAXIMUM_STAKE_FRACTION');
  }
  if (
    input.maximumAdditionalStakeUnits !== undefined &&
    uncappedUnits > Math.max(0, input.maximumAdditionalStakeUnits) + EPSILON
  ) {
    cappedBy.push('PORTFOLIO_EXPOSURE');
  }
  const stakeUnits = roundDown(
    Math.min(uncappedUnits, maximumUnits),
    config.roundingUnits,
  );
  if (stakeUnits + EPSILON < config.minimumStakeUnits) {
    return {
      ...noBetPlan(config, 'STAKE_BELOW_MINIMUM'),
      fullKellyFraction,
      appliedKellyFraction: config.enabled ? config.kellyFraction : 0,
      qualityMultiplier,
      edgeMultiplier,
      expectedValueMultiplier,
      drawdownMultiplier: drawdownRiskMultiplier,
      cappedBy,
    };
  }

  const stakeFraction = stakeUnits / currentBankrollUnits;
  const capFraction = Math.max(EPSILON, config.maximumStakeFraction);
  const relativeRisk = stakeFraction / capFraction;
  const riskBand: ScientificStakeRiskBand =
    relativeRisk < 0.34 ? 'LOW' : relativeRisk < 0.75 ? 'STANDARD' : 'HIGH';
  const stakeAmount =
    config.bankrollAmount == null
      ? null
      : config.bankrollAmount * stakeFraction;

  return {
    stakingVersion: SCIENTIFIC_STAKING_VERSION,
    profile: config.profile,
    stakeUnits,
    stakeFraction,
    stakeAmount,
    stakeCurrency: stakeAmount == null ? null : config.bankrollCurrency,
    fullKellyFraction,
    appliedKellyFraction: config.enabled ? config.kellyFraction : 0,
    qualityMultiplier,
    edgeMultiplier,
    expectedValueMultiplier,
    drawdownMultiplier: drawdownRiskMultiplier,
    riskBand,
    cappedBy,
    skippedReason: null,
  };
}

export function allocateScientificStakePortfolio<
  Candidate extends ScientificStakeCandidate,
>(input: {
  candidates: Candidate[];
  config: ScientificBankrollConfig;
  currentBankrollUnits?: number;
  peakBankrollUnits?: number;
  currentDailyExposureUnits?: number;
}): ScientificStakePortfolio<Candidate> {
  const currentBankrollUnits = Math.max(
    0,
    input.currentBankrollUnits ?? input.config.bankrollUnits,
  );
  const peakBankrollUnits = Math.max(
    currentBankrollUnits,
    input.peakBankrollUnits ?? currentBankrollUnits,
  );
  const fixtureCap =
    currentBankrollUnits * input.config.maximumFixtureExposureFraction;
  const dailyCap =
    currentBankrollUnits * input.config.maximumDailyExposureFraction;
  const existingDailyExposure = Math.max(
    0,
    input.currentDailyExposureUnits ?? input.config.currentDailyExposureUnits,
  );
  let fixtureExposure = 0;
  let dailyExposure = existingDailyExposure;
  let rejectedForStake = 0;
  const rejectionReasons: Record<string, number> = {};
  const bets: ScientificStakePortfolioBet<Candidate>[] = [];

  const sorted = [...input.candidates].sort((left, right) => {
    const scoreDifference =
      right.recommendationScore - left.recommendationScore;
    if (Math.abs(scoreDifference) > EPSILON) return scoreDifference;
    return right.expectedValue - left.expectedValue;
  });

  for (const candidate of sorted) {
    const remainingFixture = Math.max(0, fixtureCap - fixtureExposure);
    const remainingDaily = Math.max(0, dailyCap - dailyExposure);
    const maximumAdditionalStakeUnits = Math.min(
      remainingFixture,
      remainingDaily,
    );
    const stakePlan = calculateScientificStake({
      candidate,
      config: input.config,
      currentBankrollUnits,
      peakBankrollUnits,
      maximumAdditionalStakeUnits,
    });
    if (stakePlan.stakeUnits <= 0) {
      rejectedForStake += 1;
      const reason = stakePlan.skippedReason ?? 'STAKE_BELOW_MINIMUM';
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
      continue;
    }
    bets.push({ candidate, stakePlan });
    fixtureExposure += stakePlan.stakeUnits;
    dailyExposure += stakePlan.stakeUnits;
  }

  const totalStakeUnits = bets.reduce(
    (sum, bet) => sum + bet.stakePlan.stakeUnits,
    0,
  );
  const totalStakeAmount =
    input.config.bankrollAmount == null
      ? null
      : bets.reduce(
          (sum, bet) => sum + (bet.stakePlan.stakeAmount ?? 0),
          0,
        );
  return {
    bets,
    totalStakeUnits,
    totalStakeAmount,
    rejectedForStake,
    rejectionReasons,
  };
}

export function formatScientificStakeReason(
  plan: ScientificStakePlan,
): string {
  const amountText =
    plan.stakeAmount == null
      ? ''
      : `, tương đương ${Math.round(plan.stakeAmount).toLocaleString('vi-VN')} ${plan.stakeCurrency ?? ''}`.trimEnd();
  return `Mức cược đề xuất ${plan.stakeUnits.toFixed(2)}u (${(
    plan.stakeFraction * 100
  ).toFixed(2)}% bankroll${amountText}), hồ sơ ${plan.profile}, rủi ro ${plan.riskBand}.`;
}

export function summarizeScientificBankrollConfig(
  config: ScientificBankrollConfig,
): Record<string, string | number | boolean | null> {
  return {
    stakingVersion: SCIENTIFIC_STAKING_VERSION,
    enabled: config.enabled,
    profile: config.profile,
    bankrollUnits: config.bankrollUnits,
    bankrollAmount: config.bankrollAmount,
    bankrollCurrency: config.bankrollCurrency,
    kellyFraction: config.kellyFraction,
    minimumStakeUnits: config.minimumStakeUnits,
    maximumStakeUnits: config.maximumStakeUnits,
    maximumStakeFraction: config.maximumStakeFraction,
    maximumFixtureExposureFraction: config.maximumFixtureExposureFraction,
    maximumDailyExposureFraction: config.maximumDailyExposureFraction,
    drawdownSoftLimit: config.drawdownSoftLimit,
    drawdownHardLimit: config.drawdownHardLimit,
  };
}

export class ScientificBankrollTracker {
  readonly startingBankrollUnits: number;
  currentBankrollUnits: number;
  peakBankrollUnits: number;
  private totalStakeUnits = 0;
  private largestStakeUnits = 0;
  private maximumDrawdownUnits = 0;
  private maximumDrawdownFraction = 0;
  private betCount = 0;
  private activeDateKey: string | null = null;
  private activeDailyExposureUnits = 0;

  constructor(startingBankrollUnits: number) {
    this.startingBankrollUnits = Math.max(1, startingBankrollUnits);
    this.currentBankrollUnits = this.startingBankrollUnits;
    this.peakBankrollUnits = this.startingBankrollUnits;
  }

  dailyExposureUnits(at: Date): number {
    const key = at.toISOString().slice(0, 10);
    if (this.activeDateKey !== key) return 0;
    return this.activeDailyExposureUnits;
  }

  recordBet(at: Date, stakeUnits: number, profitUnits: number): void {
    const key = at.toISOString().slice(0, 10);
    if (this.activeDateKey !== key) {
      this.activeDateKey = key;
      this.activeDailyExposureUnits = 0;
    }
    const safeStake = Math.max(0, stakeUnits);
    const safeProfit = Number.isFinite(profitUnits) ? profitUnits : 0;
    this.activeDailyExposureUnits += safeStake;
    this.totalStakeUnits += safeStake;
    this.largestStakeUnits = Math.max(this.largestStakeUnits, safeStake);
    this.betCount += 1;
    this.currentBankrollUnits = Math.max(
      0,
      this.currentBankrollUnits + safeProfit,
    );
    this.peakBankrollUnits = Math.max(
      this.peakBankrollUnits,
      this.currentBankrollUnits,
    );
    const drawdownUnits = Math.max(
      0,
      this.peakBankrollUnits - this.currentBankrollUnits,
    );
    const drawdownFraction =
      this.peakBankrollUnits > EPSILON
        ? drawdownUnits / this.peakBankrollUnits
        : 0;
    this.maximumDrawdownUnits = Math.max(
      this.maximumDrawdownUnits,
      drawdownUnits,
    );
    this.maximumDrawdownFraction = Math.max(
      this.maximumDrawdownFraction,
      drawdownFraction,
    );
  }

  snapshot(): ScientificBankrollSnapshot {
    const profitUnits =
      this.currentBankrollUnits - this.startingBankrollUnits;
    return {
      stakingVersion: SCIENTIFIC_STAKING_VERSION,
      startingBankrollUnits: this.startingBankrollUnits,
      endingBankrollUnits: this.currentBankrollUnits,
      peakBankrollUnits: this.peakBankrollUnits,
      profitUnits,
      bankrollReturn: profitUnits / this.startingBankrollUnits,
      totalStakeUnits: this.totalStakeUnits,
      averageStakeUnits:
        this.betCount > 0 ? this.totalStakeUnits / this.betCount : null,
      largestStakeUnits: this.largestStakeUnits,
      maximumDrawdownUnits: this.maximumDrawdownUnits,
      maximumDrawdownFraction: this.maximumDrawdownFraction,
      betCount: this.betCount,
    };
  }
}

export function parseScientificBankrollSnapshot(
  value: unknown,
): ScientificBankrollSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const requiredNumbers = [
    'startingBankrollUnits',
    'endingBankrollUnits',
    'profitUnits',
    'totalStakeUnits',
    'maximumDrawdownFraction',
  ] as const;
  if (
    requiredNumbers.some(
      (key) => typeof record[key] !== 'number' || !Number.isFinite(record[key]),
    )
  ) {
    return null;
  }
  return record as unknown as ScientificBankrollSnapshot;
}
