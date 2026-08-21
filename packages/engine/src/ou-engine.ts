export const OU_ENGINE_VERSION = 'ou-engine-v1.0.0';
export const OU_STRATEGY_MIN_ODDS = 1.4;
export const OU_STRATEGY_MAX_ODDS = 2.5;
export const OU_PROBABILITY_EPSILON = 1e-6;
export const OU_ODDS_PROBABILITY_PROFILE_VERSION = 'ou-odds-probability-bands-starting-v1';

export type OuLine = 1.5 | 2.5 | 3.5;
export type OuSelection = 'OVER' | 'UNDER';
export type OuMarketCode = 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5';
export type OuQualificationStatus = 'QUALIFIED' | 'WATCH' | 'SKIP' | 'INVALID';
export type DataTier = 'A' | 'B' | 'C' | 'INSUFFICIENT';

export interface BinaryOuProbability { OVER: number; UNDER: number; }
export interface GoalDistributionBuckets {
  goals0: number; goals1: number; goals2: number; goals3: number; goals4: number; goals5: number; goals6Plus: number;
}
export interface OuProbabilitySet {
  TOTAL_GOALS_1_5: BinaryOuProbability;
  TOTAL_GOALS_2_5: BinaryOuProbability;
  TOTAL_GOALS_3_5: BinaryOuProbability;
}
export interface OuConsistencyResult {
  valid: boolean;
  status: 'VALID' | 'INVALID';
  reason: null | 'MODEL_CONSISTENCY_ERROR';
  errors: string[];
}
export interface GoalDistributionResult {
  goalDistributionId: string;
  version: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  rho: number;
  maximumGoalsPerTeam: number;
  rawTotalGoalProbabilities: number[];
  calibratedTotalGoalProbabilities: number[];
  buckets: GoalDistributionBuckets;
  rawMarkets: OuProbabilitySet;
  markets: OuProbabilitySet;
  calibration: { method: 'NONE' | 'COMMON_LOGIT_CDF_SHIFT'; delta: number; anchorUnder25: number | null };
  consistency: OuConsistencyResult;
}
export interface DistributionCalibrationModel {
  version: string;
  method: 'COMMON_LOGIT_CDF_SHIFT';
  delta: number;
  sampleSize: number;
  observations: number;
  fittedAt: string;
}
export interface DistributionCalibrationTrainingRow {
  rawUnder15: number; rawUnder25: number; rawUnder35: number; actualTotalGoals: number;
}
export interface VenueTeamSummary {
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  xgFor?: number | null;
  xgAgainst?: number | null;
  shots?: number | null;
  shotsOnTarget?: number | null;
  bigChances?: number | null;
}
export interface ExpectedGoalsFeatureInput {
  homeVenue: VenueTeamSummary;
  awayVenue: VenueTeamSummary;
  leagueHomeGoalsPerMatch: number;
  leagueAwayGoalsPerMatch: number;
  leagueHomeXgPerMatch?: number | null;
  leagueAwayXgPerMatch?: number | null;
  homeOpponentStrength?: number | null;
  awayOpponentStrength?: number | null;
  homeRecentMultiplier?: number | null;
  awayRecentMultiplier?: number | null;
}
export interface ExpectedGoalsEstimate {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  homeAttackStrength: number;
  homeDefenseStrength: number;
  awayAttackStrength: number;
  awayDefenseStrength: number;
  homeSampleWeight: number;
  awaySampleWeight: number;
  dataTier: DataTier;
}
export interface DataAvailability {
  historicalMatches: number;
  leagueHistoricalMatches: number;
  hasXg: boolean;
  hasShots: boolean;
  hasOdds: boolean;
  bookmakerCount: number;
  oddsAgeMinutes: number | null;
  hasLineup: boolean;
  hasInjuries: boolean;
  apiHealthy: boolean;
  modelUncertainty: number;
}
export interface DataQualityAssessment { score: number; tier: DataTier; eligible: boolean; reasons: string[]; }
export interface ConfidenceAssessment { score: number; label: 'Strong' | 'Good' | 'Watch' | 'Skip'; }
export interface ValueAssessment { edge: number; expectedValue: number; score: number; }
export interface OuQualificationInput {
  consistency: OuConsistencyResult;
  calibrationValid: boolean;
  dataQuality: DataQualityAssessment;
  confidence: ConfidenceAssessment;
  edge: number;
  expectedValue: number;
  odds: number;
  minimumDataQuality?: number;
  minimumConfidence?: number;
  minimumEdge?: number;
  minimumExpectedValue?: number;
  minimumOdds?: number;
  maximumOdds?: number;
  minimumProbability?: number | null;
  modelProbability?: number | null;
}
export interface OuQualificationResult { status: OuQualificationStatus; eligible: boolean; reasons: string[]; }
export interface CalibrationObservation { probability: number; actual: boolean; }
export interface CalibrationBucketResult {
  lowerInclusive: number; upperExclusive: number; sampleSize: number;
  meanPredicted: number | null; actualRate: number | null; calibrationGap: number | null;
}
export interface CalibrationReport {
  sampleSize: number; brierScore: number | null; logLoss: number | null; calibrationError: number | null;
  buckets: CalibrationBucketResult[];
  status: 'NO_DATA' | 'CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'MIXED';
}
export interface OuBacktestRow {
  market: string;
  odds: number;
  predictedProbability: number;
  actualWin: boolean;
  league: string;
  season: string;
  occurredAt: Date | string;
  stake?: number;
  realizedProfit?: number;
  expectedValue?: number;
  predictionOdds?: number | null;
  closingOdds?: number | null;
  modelVersion?: string | null;
}
export interface OuBacktestMetrics {
  sampleSize: number; wins: number; losses: number; winRate: number | null;
  totalStake: number; profit: number; roi: number | null; yield: number | null;
  brierScore: number | null; logLoss: number | null; calibrationError: number | null;
  averageExpectedValue: number | null; averageClv: number | null; maximumDrawdown: number;
}
export interface OuBacktestSlice { key: string; metrics: OuBacktestMetrics; }
export type AsianSettlement = 'FULL_WIN' | 'HALF_WIN' | 'PUSH' | 'HALF_LOSS' | 'FULL_LOSS';
export interface AsianSettlementResult {
  result: AsianSettlement;
  netProfitPerUnitStake: number;
  components: Array<{ line: number; stakeFraction: number; result: 'WIN' | 'PUSH' | 'LOSS'; netProfitPerUnitComponentStake: number }>;
}

const NUMERIC_EPSILON = 1e-12;
function assertFinite(value: number, label: string): void { if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`); }
function assertProbability(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be in [0, 1].`);
}
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function clamp01(value: number): number { return clamp(value, 0, 1); }
function safeProbability(value: number): number { return clamp(value, 1e-9, 1 - 1e-9); }
function logit(probability: number): number { const p = safeProbability(probability); return Math.log(p / (1 - p)); }
function sigmoid(value: number): number {
  if (value >= 0) { const z = Math.exp(-value); return 1 / (1 + z); }
  const z = Math.exp(value); return z / (1 + z);
}
function poissonProbability(goals: number, lambda: number): number {
  if (goals < 0 || !Number.isInteger(goals)) return 0;
  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}
function dixonColesTau(input: { homeGoals: number; awayGoals: number; homeExpectedGoals: number; awayExpectedGoals: number; rho: number }): number {
  const { homeGoals, awayGoals, homeExpectedGoals: lambdaHome, awayExpectedGoals: lambdaAway, rho } = input;
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}
function normalizeDistribution(values: number[]): number[] {
  const sanitized = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const total = sanitized.reduce((sum, value) => sum + value, 0);
  if (total <= NUMERIC_EPSILON) throw new Error('GOAL_DISTRIBUTION_ZERO_MASS');
  return sanitized.map((value) => value / total);
}
function cdfFromPmf(pmf: number[]): number[] {
  const cdf: number[] = [];
  let cumulative = 0;
  for (const value of pmf) { cumulative += value; cdf.push(clamp01(cumulative)); }
  if (cdf.length > 0) cdf[cdf.length - 1] = 1;
  return cdf;
}
function pmfFromCdf(cdf: number[]): number[] {
  const pmf: number[] = [];
  let previous = 0;
  for (const value of cdf) {
    const current = clamp(value, previous, 1);
    pmf.push(Math.max(0, current - previous));
    previous = current;
  }
  return normalizeDistribution(pmf);
}
function underProbability(pmf: number[], line: OuLine): number {
  let value = 0;
  for (let goals = 0; goals <= Math.floor(line); goals += 1) value += pmf[goals] ?? 0;
  return clamp01(value);
}
function marketsFromPmf(pmf: number[]): OuProbabilitySet {
  const under15 = underProbability(pmf, 1.5);
  const under25 = underProbability(pmf, 2.5);
  const under35 = underProbability(pmf, 3.5);
  return {
    TOTAL_GOALS_1_5: { UNDER: under15, OVER: 1 - under15 },
    TOTAL_GOALS_2_5: { UNDER: under25, OVER: 1 - under25 },
    TOTAL_GOALS_3_5: { UNDER: under35, OVER: 1 - under35 },
  };
}
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function applyCommonLogitCdfShift(pmf: number[], delta: number): number[] {
  if (Math.abs(delta) <= 1e-15) return [...pmf];
  const rawCdf = cdfFromPmf(pmf);
  const calibratedCdf = rawCdf.map((value, index) => index === rawCdf.length - 1 ? 1 : sigmoid(logit(value) + delta));
  for (let index = 1; index < calibratedCdf.length; index += 1) {
    const previous = calibratedCdf[index - 1] ?? 0;
    calibratedCdf[index] = Math.max(previous, calibratedCdf[index] ?? previous);
  }
  return pmfFromCdf(calibratedCdf);
}

export function validateOuProbabilityConsistency(probabilities: OuProbabilitySet, epsilon = OU_PROBABILITY_EPSILON): OuConsistencyResult {
  const errors: string[] = [];
  const values = [
    probabilities.TOTAL_GOALS_1_5.UNDER, probabilities.TOTAL_GOALS_1_5.OVER,
    probabilities.TOTAL_GOALS_2_5.UNDER, probabilities.TOTAL_GOALS_2_5.OVER,
    probabilities.TOTAL_GOALS_3_5.UNDER, probabilities.TOTAL_GOALS_3_5.OVER,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < -epsilon || value > 1 + epsilon)) errors.push('PROBABILITY_OUT_OF_RANGE');
  const { UNDER: u15, OVER: o15 } = probabilities.TOTAL_GOALS_1_5;
  const { UNDER: u25, OVER: o25 } = probabilities.TOTAL_GOALS_2_5;
  const { UNDER: u35, OVER: o35 } = probabilities.TOTAL_GOALS_3_5;
  if (u15 > u25 + epsilon || u25 > u35 + epsilon) errors.push('UNDER_MONOTONICITY_VIOLATION');
  if (o15 + epsilon < o25 || o25 + epsilon < o35) errors.push('OVER_MONOTONICITY_VIOLATION');
  for (const [label, market] of [['1.5', probabilities.TOTAL_GOALS_1_5], ['2.5', probabilities.TOTAL_GOALS_2_5], ['3.5', probabilities.TOTAL_GOALS_3_5]] as const) {
    if (Math.abs(market.OVER + market.UNDER - 1) > epsilon) errors.push(`COMPLEMENT_VIOLATION_${label}`);
  }
  return { valid: errors.length === 0, status: errors.length === 0 ? 'VALID' : 'INVALID', reason: errors.length === 0 ? null : 'MODEL_CONSISTENCY_ERROR', errors };
}

export function buildOuGoalDistribution(input: {
  expectedHomeGoals: number; expectedAwayGoals: number; rho?: number; maximumGoalsPerTeam?: number;
  calibrationUnder25?: number | null; calibrationDelta?: number | null;
}): GoalDistributionResult {
  assertFinite(input.expectedHomeGoals, 'expectedHomeGoals');
  assertFinite(input.expectedAwayGoals, 'expectedAwayGoals');
  if (input.expectedHomeGoals < 0 || input.expectedAwayGoals < 0) throw new RangeError('Expected goals must be non-negative.');
  const rho = input.rho ?? 0;
  assertFinite(rho, 'rho');
  const maximumGoalsPerTeam = Math.max(8, Math.min(20, Math.floor(input.maximumGoalsPerTeam ?? 12)));
  const rawMass = Array.from({ length: maximumGoalsPerTeam * 2 + 1 }, () => 0);
  for (let homeGoals = 0; homeGoals <= maximumGoalsPerTeam; homeGoals += 1) {
    const homeP = poissonProbability(homeGoals, input.expectedHomeGoals);
    for (let awayGoals = 0; awayGoals <= maximumGoalsPerTeam; awayGoals += 1) {
      const raw = homeP * poissonProbability(awayGoals, input.expectedAwayGoals) * dixonColesTau({
        homeGoals, awayGoals, homeExpectedGoals: input.expectedHomeGoals, awayExpectedGoals: input.expectedAwayGoals, rho,
      });
      rawMass[homeGoals + awayGoals] = (rawMass[homeGoals + awayGoals] ?? 0) + Math.max(0, raw);
    }
  }
  const rawPmf = normalizeDistribution(rawMass);
  const rawMarkets = marketsFromPmf(rawPmf);
  let delta = input.calibrationDelta ?? 0;
  let anchorUnder25: number | null = null;
  if (input.calibrationUnder25 != null) {
    assertProbability(input.calibrationUnder25, 'calibrationUnder25');
    anchorUnder25 = input.calibrationUnder25;
    delta = logit(input.calibrationUnder25) - logit(rawMarkets.TOTAL_GOALS_2_5.UNDER);
  }
  assertFinite(delta, 'calibrationDelta');
  const calibratedPmf = applyCommonLogitCdfShift(rawPmf, delta);
  const markets = marketsFromPmf(calibratedPmf);
  const consistency = validateOuProbabilityConsistency(markets);
  if (!consistency.valid) throw new Error(`MODEL_CONSISTENCY_ERROR:${consistency.errors.join(',')}`);
  const buckets: GoalDistributionBuckets = {
    goals0: calibratedPmf[0] ?? 0, goals1: calibratedPmf[1] ?? 0, goals2: calibratedPmf[2] ?? 0,
    goals3: calibratedPmf[3] ?? 0, goals4: calibratedPmf[4] ?? 0, goals5: calibratedPmf[5] ?? 0,
    goals6Plus: calibratedPmf.slice(6).reduce((sum, value) => sum + value, 0),
  };
  const descriptor = [OU_ENGINE_VERSION, input.expectedHomeGoals.toFixed(8), input.expectedAwayGoals.toFixed(8), rho.toFixed(8), maximumGoalsPerTeam, delta.toFixed(10)].join('|');
  return {
    goalDistributionId: `gdist_${stableHash(descriptor)}`, version: OU_ENGINE_VERSION,
    expectedHomeGoals: input.expectedHomeGoals, expectedAwayGoals: input.expectedAwayGoals,
    expectedTotalGoals: input.expectedHomeGoals + input.expectedAwayGoals, rho, maximumGoalsPerTeam,
    rawTotalGoalProbabilities: rawPmf, calibratedTotalGoalProbabilities: calibratedPmf, buckets, rawMarkets, markets,
    calibration: { method: Math.abs(delta) <= 1e-15 ? 'NONE' : 'COMMON_LOGIT_CDF_SHIFT', delta, anchorUnder25 }, consistency,
  };
}

export function fitDistributionCalibration(rows: DistributionCalibrationTrainingRow[], options: { l2?: number; maxIterations?: number; tolerance?: number; fittedAt?: Date } = {}): DistributionCalibrationModel {
  const l2 = Math.max(0, options.l2 ?? 1e-3);
  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 80));
  const tolerance = Math.max(1e-12, options.tolerance ?? 1e-9);
  let delta = 0;
  let observations = 0;
  for (const row of rows) {
    assertProbability(row.rawUnder15, 'rawUnder15'); assertProbability(row.rawUnder25, 'rawUnder25'); assertProbability(row.rawUnder35, 'rawUnder35');
    if (row.rawUnder15 > row.rawUnder25 + OU_PROBABILITY_EPSILON || row.rawUnder25 > row.rawUnder35 + OU_PROBABILITY_EPSILON) throw new Error('CALIBRATION_TRAINING_ROW_INCONSISTENT');
    if (!Number.isFinite(row.actualTotalGoals) || row.actualTotalGoals < 0) throw new RangeError('actualTotalGoals must be non-negative.');
    observations += 3;
  }
  for (let iteration = 0; iteration < maxIterations && observations > 0; iteration += 1) {
    let gradient = l2 * delta;
    let hessian = l2;
    for (const row of rows) {
      for (const point of [
        { raw: row.rawUnder15, actual: row.actualTotalGoals <= 1 ? 1 : 0 },
        { raw: row.rawUnder25, actual: row.actualTotalGoals <= 2 ? 1 : 0 },
        { raw: row.rawUnder35, actual: row.actualTotalGoals <= 3 ? 1 : 0 },
      ]) {
        const p = sigmoid(logit(point.raw) + delta);
        gradient += p - point.actual;
        hessian += p * (1 - p);
      }
    }
    const step = gradient / Math.max(1e-12, hessian);
    delta -= step;
    if (Math.abs(step) < tolerance) break;
  }
  return { version: `${OU_ENGINE_VERSION}-cal-${stableHash(`${rows.length}|${delta.toFixed(12)}|${l2}`)}`, method: 'COMMON_LOGIT_CDF_SHIFT', delta, sampleSize: rows.length, observations, fittedAt: (options.fittedAt ?? new Date(0)).toISOString() };
}

function sampleShrinkage(matches: number, fullWeightMatches = 12): number { return clamp(matches / Math.max(1, fullWeightMatches), 0, 1); }
function safeRatio(numerator: number, denominator: number, fallback = 1): number { return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : fallback; }
function perMatch(total: number | null | undefined, matches: number): number | null { return total != null && Number.isFinite(total) && matches > 0 ? total / matches : null; }
export function classifyDataTier(input: { hasXg: boolean; hasShots: boolean; hasOdds: boolean; historicalMatches: number }): DataTier {
  if (input.historicalMatches <= 0) return 'INSUFFICIENT';
  if (input.hasXg && input.hasShots && input.hasOdds) return 'A';
  if (input.hasShots && input.hasOdds) return 'B';
  return 'C';
}
export function estimateVenueExpectedGoals(input: ExpectedGoalsFeatureInput): ExpectedGoalsEstimate {
  const homeMatches = Math.max(0, Math.floor(input.homeVenue.matches));
  const awayMatches = Math.max(0, Math.floor(input.awayVenue.matches));
  const homeWeight = sampleShrinkage(homeMatches), awayWeight = sampleShrinkage(awayMatches);
  const leagueHomeGoals = Math.max(0.05, input.leagueHomeGoalsPerMatch), leagueAwayGoals = Math.max(0.05, input.leagueAwayGoalsPerMatch);
  const homeGoalsFor = perMatch(input.homeVenue.goalsFor, homeMatches) ?? leagueHomeGoals;
  const homeGoalsAgainst = perMatch(input.homeVenue.goalsAgainst, homeMatches) ?? leagueAwayGoals;
  const awayGoalsFor = perMatch(input.awayVenue.goalsFor, awayMatches) ?? leagueAwayGoals;
  const awayGoalsAgainst = perMatch(input.awayVenue.goalsAgainst, awayMatches) ?? leagueHomeGoals;
  const homeXgFor = perMatch(input.homeVenue.xgFor, homeMatches), homeXgAgainst = perMatch(input.homeVenue.xgAgainst, homeMatches);
  const awayXgFor = perMatch(input.awayVenue.xgFor, awayMatches), awayXgAgainst = perMatch(input.awayVenue.xgAgainst, awayMatches);
  const leagueHomeXg = input.leagueHomeXgPerMatch ?? leagueHomeGoals, leagueAwayXg = input.leagueAwayXgPerMatch ?? leagueAwayGoals;
  const homeAttackObserved = homeXgFor != null ? 0.65 * safeRatio(homeXgFor, leagueHomeXg) + 0.35 * safeRatio(homeGoalsFor, leagueHomeGoals) : safeRatio(homeGoalsFor, leagueHomeGoals);
  const homeDefenseObserved = homeXgAgainst != null ? 0.65 * safeRatio(homeXgAgainst, leagueAwayXg) + 0.35 * safeRatio(homeGoalsAgainst, leagueAwayGoals) : safeRatio(homeGoalsAgainst, leagueAwayGoals);
  const awayAttackObserved = awayXgFor != null ? 0.65 * safeRatio(awayXgFor, leagueAwayXg) + 0.35 * safeRatio(awayGoalsFor, leagueAwayGoals) : safeRatio(awayGoalsFor, leagueAwayGoals);
  const awayDefenseObserved = awayXgAgainst != null ? 0.65 * safeRatio(awayXgAgainst, leagueHomeXg) + 0.35 * safeRatio(awayGoalsAgainst, leagueHomeGoals) : safeRatio(awayGoalsAgainst, leagueHomeGoals);
  const homeAttackStrength = 1 + homeWeight * (homeAttackObserved - 1), homeDefenseStrength = 1 + homeWeight * (homeDefenseObserved - 1);
  const awayAttackStrength = 1 + awayWeight * (awayAttackObserved - 1), awayDefenseStrength = 1 + awayWeight * (awayDefenseObserved - 1);
  const expectedHomeGoals = clamp(leagueHomeGoals * homeAttackStrength * awayDefenseStrength * clamp(input.homeOpponentStrength ?? 1, 0.65, 1.45) * clamp(input.homeRecentMultiplier ?? 1, 0.8, 1.2), 0.15, 5);
  const expectedAwayGoals = clamp(leagueAwayGoals * awayAttackStrength * homeDefenseStrength * clamp(input.awayOpponentStrength ?? 1, 0.65, 1.45) * clamp(input.awayRecentMultiplier ?? 1, 0.8, 1.2), 0.1, 4.5);
  const hasXg = homeXgFor != null && homeXgAgainst != null && awayXgFor != null && awayXgAgainst != null;
  const hasShots = input.homeVenue.shots != null && input.awayVenue.shots != null;
  return { expectedHomeGoals, expectedAwayGoals, expectedTotalGoals: expectedHomeGoals + expectedAwayGoals, homeAttackStrength, homeDefenseStrength, awayAttackStrength, awayDefenseStrength, homeSampleWeight: homeWeight, awaySampleWeight: awayWeight, dataTier: classifyDataTier({ hasXg, hasShots, hasOdds: true, historicalMatches: homeMatches + awayMatches }) };
}
export function exponentialRecencyWeight(ageDays: number, halfLifeDays = 60): number {
  assertFinite(ageDays, 'ageDays'); assertFinite(halfLifeDays, 'halfLifeDays');
  if (ageDays < 0 || halfLifeDays <= 0) throw new RangeError('ageDays must be >= 0 and halfLifeDays > 0.');
  return Math.exp((-Math.log(2) * ageDays) / halfLifeDays);
}

export function removeTwoWayVig(overOdds: number, underOdds: number): { OVER: number; UNDER: number; rawOver: number; rawUnder: number; overround: number } {
  if (!Number.isFinite(overOdds) || !Number.isFinite(underOdds) || overOdds <= 1 || underOdds <= 1) throw new RangeError('Decimal odds must be finite and > 1.');
  const rawOver = 1 / overOdds, rawUnder = 1 / underOdds, overround = rawOver + rawUnder;
  return { OVER: rawOver / overround, UNDER: rawUnder / overround, rawOver, rawUnder, overround };
}
export function calculateOuValue(modelProbability: number, fairMarketProbability: number, decimalOdds: number): ValueAssessment {
  assertProbability(modelProbability, 'modelProbability'); assertProbability(fairMarketProbability, 'fairMarketProbability');
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) throw new RangeError('decimalOdds must be > 1.');
  const edge = modelProbability - fairMarketProbability, expectedValue = modelProbability * decimalOdds - 1;
  return { edge, expectedValue, score: clamp(50 + edge * 300 + expectedValue * 150, 0, 100) };
}
export function probabilityThresholdForOdds(odds: number): number {
  if (!Number.isFinite(odds) || odds < 1.4 || odds > 2.5) return 1;
  if (odds < 1.5) return 0.72;
  if (odds < 1.6) return 0.69;
  if (odds < 1.8) return 0.65;
  if (odds < 2.0) return 0.61;
  if (odds < 2.2) return 0.58;
  return 0.55;
}
export function assessDataQuality(input: DataAvailability): DataQualityAssessment {
  const reasons: string[] = [];
  const historyScore = clamp(input.historicalMatches / 20, 0, 1), leagueScore = clamp(input.leagueHistoricalMatches / 100, 0, 1);
  const marketScore = input.hasOdds ? clamp(input.bookmakerCount / 5, 0, 1) : 0;
  const freshnessScore = input.oddsAgeMinutes == null ? 0 : clamp(1 - input.oddsAgeMinutes / 360, 0, 1);
  const completenessScore = [input.hasXg, input.hasShots, input.hasLineup, input.hasInjuries].filter(Boolean).length / 4;
  const uncertaintyScore = 1 - clamp(input.modelUncertainty, 0, 1), healthScore = input.apiHealthy ? 1 : 0;
  const score = 100 * (0.22 * historyScore + 0.12 * leagueScore + 0.18 * marketScore + 0.12 * freshnessScore + 0.14 * completenessScore + 0.14 * uncertaintyScore + 0.08 * healthScore);
  if (input.historicalMatches < 3) reasons.push('TOO_LITTLE_HISTORICAL_DATA');
  if (input.leagueHistoricalMatches < 20) reasons.push('LEAGUE_SAMPLE_TOO_SMALL');
  if (!input.hasOdds || input.bookmakerCount < 2) reasons.push('ODDS_NOT_RELIABLE');
  if (input.oddsAgeMinutes == null || input.oddsAgeMinutes > 360) reasons.push('ODDS_STALE');
  if (!input.hasXg) reasons.push('XG_UNAVAILABLE');
  if (!input.hasLineup) reasons.push('LINEUP_UNAVAILABLE');
  if (!input.hasInjuries) reasons.push('INJURY_DATA_UNAVAILABLE');
  if (!input.apiHealthy) reasons.push('API_DATA_ERROR');
  if (input.modelUncertainty > 0.45) reasons.push('MODEL_UNCERTAINTY_HIGH');
  const tier = classifyDataTier({ hasXg: input.hasXg, hasShots: input.hasShots, hasOdds: input.hasOdds, historicalMatches: input.historicalMatches });
  return { score, tier, eligible: score >= 55 && input.apiHealthy && input.historicalMatches >= 3 && input.hasOdds && input.bookmakerCount >= 2, reasons };
}
export function calculateConfidenceScore(input: { modelAgreement: number; calibrationReliability: number; dataQualityScore: number; sampleReliability: number; lineupCompleteness: number; injuryCompleteness: number; uncertainty: number; historicalStability: number }): ConfidenceAssessment {
  const normalizedDataQuality = input.dataQualityScore > 1 ? input.dataQualityScore / 100 : input.dataQualityScore;
  const score = 100 * (0.18 * clamp01(input.modelAgreement) + 0.18 * clamp01(input.calibrationReliability) + 0.2 * clamp01(normalizedDataQuality) + 0.1 * clamp01(input.sampleReliability) + 0.08 * clamp01(input.lineupCompleteness) + 0.06 * clamp01(input.injuryCompleteness) + 0.12 * (1 - clamp01(input.uncertainty)) + 0.08 * clamp01(input.historicalStability));
  return { score, label: score >= 80 ? 'Strong' : score >= 70 ? 'Good' : score >= 60 ? 'Watch' : 'Skip' };
}
export function assessOuQualification(input: OuQualificationInput): OuQualificationResult {
  if (!input.consistency.valid) return { status: 'INVALID', eligible: false, reasons: ['MODEL_CONSISTENCY_ERROR', ...input.consistency.errors] };
  const reasons: string[] = [];
  if (!input.calibrationValid) reasons.push('CALIBRATION_INVALID');
  if (!input.dataQuality.eligible || input.dataQuality.score < (input.minimumDataQuality ?? 55)) reasons.push('DATA_QUALITY_INSUFFICIENT');
  if (input.confidence.score < (input.minimumConfidence ?? 60)) reasons.push('CONFIDENCE_INSUFFICIENT');
  if (input.edge < (input.minimumEdge ?? 0.02)) reasons.push('EDGE_BELOW_THRESHOLD');
  if (input.expectedValue < (input.minimumExpectedValue ?? 0.02)) reasons.push('EV_BELOW_THRESHOLD');
  if (input.odds < (input.minimumOdds ?? OU_STRATEGY_MIN_ODDS) || input.odds > (input.maximumOdds ?? OU_STRATEGY_MAX_ODDS)) reasons.push('ODDS_OUT_OF_RANGE');
  if (input.minimumProbability != null && input.modelProbability != null && input.modelProbability < input.minimumProbability) reasons.push('PROBABILITY_BELOW_ODDS_BAND_THRESHOLD');
  if (reasons.length > 0) return { status: input.confidence.score >= 60 && reasons.every((reason) => reason === 'EDGE_BELOW_THRESHOLD' || reason === 'EV_BELOW_THRESHOLD') ? 'WATCH' : 'SKIP', eligible: false, reasons };
  return { status: 'QUALIFIED', eligible: true, reasons: [] };
}

function makeCalibrationBuckets(rows: CalibrationObservation[]): CalibrationBucketResult[] {
  const boundaries = [0, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 1.000000001];
  const result: CalibrationBucketResult[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const lower = boundaries[index]!, upper = boundaries[index + 1]!;
    const selected = rows.filter((row) => row.probability >= lower && row.probability < upper);
    if (selected.length === 0) { result.push({ lowerInclusive: lower, upperExclusive: Math.min(1, upper), sampleSize: 0, meanPredicted: null, actualRate: null, calibrationGap: null }); continue; }
    const meanPredicted = selected.reduce((sum, row) => sum + row.probability, 0) / selected.length;
    const actualRate = selected.filter((row) => row.actual).length / selected.length;
    result.push({ lowerInclusive: lower, upperExclusive: Math.min(1, upper), sampleSize: selected.length, meanPredicted, actualRate, calibrationGap: actualRate - meanPredicted });
  }
  return result;
}
export function buildCalibrationReport(rows: CalibrationObservation[]): CalibrationReport {
  for (const row of rows) assertProbability(row.probability, 'probability');
  if (rows.length === 0) return { sampleSize: 0, brierScore: null, logLoss: null, calibrationError: null, buckets: makeCalibrationBuckets([]), status: 'NO_DATA' };
  let brier = 0, logLoss = 0;
  for (const row of rows) {
    const y = row.actual ? 1 : 0;
    brier += (row.probability - y) ** 2;
    const p = safeProbability(row.probability);
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  const buckets = makeCalibrationBuckets(rows);
  const ece = buckets.reduce((sum, bucket) => sum + Math.abs(bucket.calibrationGap ?? 0) * (bucket.sampleSize / rows.length), 0);
  const weightedBias = buckets.reduce((sum, bucket) => sum + (bucket.calibrationGap ?? 0) * (bucket.sampleSize / rows.length), 0);
  const status: CalibrationReport['status'] = ece <= 0.04 ? 'CALIBRATED' : weightedBias < -0.02 ? 'OVERCONFIDENT' : weightedBias > 0.02 ? 'UNDERCONFIDENT' : 'MIXED';
  return { sampleSize: rows.length, brierScore: brier / rows.length, logLoss: logLoss / rows.length, calibrationError: ece, buckets, status };
}
export function closingLineValue(predictionOdds: number | null | undefined, closingOdds: number | null | undefined): number | null {
  if (predictionOdds == null || closingOdds == null || !Number.isFinite(predictionOdds) || !Number.isFinite(closingOdds) || predictionOdds <= 1 || closingOdds <= 1) return null;
  return predictionOdds / closingOdds - 1;
}
function maximumDrawdown(profits: number[]): number {
  let equity = 0, peak = 0, drawdown = 0;
  for (const profit of profits) { equity += profit; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity); }
  return drawdown;
}
export function calculateBacktestMetrics(rows: OuBacktestRow[]): OuBacktestMetrics {
  if (rows.length === 0) return { sampleSize: 0, wins: 0, losses: 0, winRate: null, totalStake: 0, profit: 0, roi: null, yield: null, brierScore: null, logLoss: null, calibrationError: null, averageExpectedValue: null, averageClv: null, maximumDrawdown: 0 };
  const observations: CalibrationObservation[] = [], profits: number[] = [], evs: number[] = [], clvs: number[] = [];
  let wins = 0, totalStake = 0;
  for (const row of rows) {
    assertProbability(row.predictedProbability, 'predictedProbability');
    const stake = row.stake ?? 1;
    if (!Number.isFinite(stake) || stake < 0) throw new RangeError('stake must be non-negative.');
    const profit = row.realizedProfit ?? (row.actualWin ? stake * (row.odds - 1) : -stake);
    if (row.actualWin) wins += 1;
    totalStake += stake; profits.push(profit); observations.push({ probability: row.predictedProbability, actual: row.actualWin });
    if (row.expectedValue != null && Number.isFinite(row.expectedValue)) evs.push(row.expectedValue);
    const clv = closingLineValue(row.predictionOdds ?? row.odds, row.closingOdds); if (clv != null) clvs.push(clv);
  }
  const calibration = buildCalibrationReport(observations), profit = profits.reduce((sum, value) => sum + value, 0);
  return { sampleSize: rows.length, wins, losses: rows.length - wins, winRate: wins / rows.length, totalStake, profit, roi: totalStake > 0 ? profit / totalStake : null, yield: totalStake > 0 ? profit / totalStake : null, brierScore: calibration.brierScore, logLoss: calibration.logLoss, calibrationError: calibration.calibrationError, averageExpectedValue: evs.length ? evs.reduce((sum, value) => sum + value, 0) / evs.length : null, averageClv: clvs.length ? clvs.reduce((sum, value) => sum + value, 0) / clvs.length : null, maximumDrawdown: maximumDrawdown(profits) };
}
function oddsBand(odds: number): string {
  if (odds < 1.4) return '<1.40'; if (odds < 1.6) return '1.40-1.60'; if (odds < 1.8) return '1.60-1.80'; if (odds < 2) return '1.80-2.00'; if (odds < 2.25) return '2.00-2.25'; if (odds <= 2.5) return '2.25-2.50'; return '>2.50';
}
function groupBacktestRows(rows: OuBacktestRow[], key: (row: OuBacktestRow) => string): OuBacktestSlice[] {
  const grouped = new Map<string, OuBacktestRow[]>();
  for (const row of rows) { const groupKey = key(row), bucket = grouped.get(groupKey) ?? []; bucket.push(row); grouped.set(groupKey, bucket); }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupKey, groupRows]) => ({ key: groupKey, metrics: calculateBacktestMetrics(groupRows) }));
}
export function backtestByMarket(rows: OuBacktestRow[]): OuBacktestSlice[] { return groupBacktestRows(rows, (row) => row.market); }
export function backtestByOddsRange(rows: OuBacktestRow[]): OuBacktestSlice[] { return groupBacktestRows(rows, (row) => oddsBand(row.odds)); }
export function backtestByLeague(rows: OuBacktestRow[]): OuBacktestSlice[] { return groupBacktestRows(rows, (row) => row.league); }
export function backtestBySeason(rows: OuBacktestRow[]): OuBacktestSlice[] { return groupBacktestRows(rows, (row) => row.season); }
export function backtestByModelVersion(rows: OuBacktestRow[]): OuBacktestSlice[] { return groupBacktestRows(rows, (row) => row.modelVersion?.trim() || 'UNKNOWN'); }
export function backtestByTimePeriod(rows: OuBacktestRow[], period: 'MONTH' | 'QUARTER' = 'MONTH'): OuBacktestSlice[] {
  return groupBacktestRows(rows, (row) => {
    const date = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt);
    if (Number.isNaN(date.getTime())) return 'UNKNOWN';
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    if (period === 'QUARTER') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}
export function backtestByCompositeSlice(rows: OuBacktestRow[]): OuBacktestSlice[] { return groupBacktestRows(rows, (row) => `${row.market}|${oddsBand(row.odds)}|${row.league}|${row.season}`); }

function splitAsianLine(line: number): Array<{ line: number; fraction: number }> {
  const quarter = Math.round(line * 4) / 4, fraction = Math.round((quarter - Math.floor(quarter)) * 100) / 100;
  if (fraction === 0 || fraction === 0.5) return [{ line: quarter, fraction: 1 }];
  if (fraction === 0.25) return [{ line: Math.floor(quarter), fraction: 0.5 }, { line: Math.floor(quarter) + 0.5, fraction: 0.5 }];
  if (fraction === 0.75) return [{ line: Math.floor(quarter) + 0.5, fraction: 0.5 }, { line: Math.floor(quarter) + 1, fraction: 0.5 }];
  throw new RangeError('Asian total line must be integer, .25, .5, or .75.');
}
function settleAsianComponent(totalGoals: number, selection: OuSelection, line: number, decimalOdds: number): { result: 'WIN' | 'PUSH' | 'LOSS'; net: number } {
  const comparison = totalGoals - line;
  const win = selection === 'OVER' ? comparison > NUMERIC_EPSILON : comparison < -NUMERIC_EPSILON;
  const loss = selection === 'OVER' ? comparison < -NUMERIC_EPSILON : comparison > NUMERIC_EPSILON;
  if (win) return { result: 'WIN', net: decimalOdds - 1 }; if (loss) return { result: 'LOSS', net: -1 }; return { result: 'PUSH', net: 0 };
}
export function settleAsianTotal(totalGoals: number, selection: OuSelection, line: number, decimalOdds: number): AsianSettlementResult {
  if (!Number.isFinite(totalGoals) || totalGoals < 0) throw new RangeError('totalGoals must be non-negative.');
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) throw new RangeError('decimalOdds must be > 1.');
  const components = splitAsianLine(line).map((part) => { const settled = settleAsianComponent(totalGoals, selection, part.line, decimalOdds); return { line: part.line, stakeFraction: part.fraction, result: settled.result, netProfitPerUnitComponentStake: settled.net }; });
  const net = components.reduce((sum, component) => sum + component.stakeFraction * component.netProfitPerUnitComponentStake, 0);
  const wins = components.filter((component) => component.result === 'WIN').length, losses = components.filter((component) => component.result === 'LOSS').length, pushes = components.filter((component) => component.result === 'PUSH').length;
  let result: AsianSettlement;
  if (wins === components.length) result = 'FULL_WIN'; else if (losses === components.length) result = 'FULL_LOSS'; else if (pushes === components.length) result = 'PUSH'; else if (wins > 0 && losses === 0) result = 'HALF_WIN'; else if (losses > 0 && wins === 0) result = 'HALF_LOSS'; else result = net > 0 ? 'HALF_WIN' : net < 0 ? 'HALF_LOSS' : 'PUSH';
  return { result, netProfitPerUnitStake: net, components };
}
export function asianTotalExpectedValue(input: { totalGoalProbabilities: number[]; selection: OuSelection; line: number; decimalOdds: number }): number {
  const pmf = normalizeDistribution(input.totalGoalProbabilities);
  let ev = 0;
  for (let goals = 0; goals < pmf.length; goals += 1) ev += (pmf[goals] ?? 0) * settleAsianTotal(goals, input.selection, input.line, input.decimalOdds).netProfitPerUnitStake;
  return ev;
}
export function fractionalKellyStake(input: { calibratedProbability: number; decimalOdds: number; uncertaintyPenalty?: number; kellyFraction?: number; maximumStakeFraction?: number; dailyExposureRemainingFraction?: number; fixtureExposureRemainingFraction?: number; marketExposureRemainingFraction?: number; correlatedExposureRemainingFraction?: number }): { conservativeProbability: number; fullKelly: number; stakeFraction: number } {
  assertProbability(input.calibratedProbability, 'calibratedProbability');
  if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) throw new RangeError('decimalOdds must be > 1.');
  const conservativeProbability = clamp01(input.calibratedProbability - Math.max(0, input.uncertaintyPenalty ?? 0));
  const b = input.decimalOdds - 1, q = 1 - conservativeProbability, fullKelly = Math.max(0, (b * conservativeProbability - q) / b);
  const caps = [Math.max(0, input.maximumStakeFraction ?? 0.015), Math.max(0, input.dailyExposureRemainingFraction ?? 1), Math.max(0, input.fixtureExposureRemainingFraction ?? 1), Math.max(0, input.marketExposureRemainingFraction ?? 1), Math.max(0, input.correlatedExposureRemainingFraction ?? 1)];
  return { conservativeProbability, fullKelly, stakeFraction: Math.min(fullKelly * clamp(input.kellyFraction ?? 0.2, 0, 1), ...caps) };
}
