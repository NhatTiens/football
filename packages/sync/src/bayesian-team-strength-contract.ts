import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export const BAYESIAN_TEAM_STRENGTH_VERSION =
  'v8.0-stage2-bayesian-hierarchical-team-strength-v1';
export const BAYESIAN_TEAM_STRENGTH_SEED = 20260810;

export interface BayesianTrainingMatch {
  fixtureId: number;
  leagueId: number;
  kickoffAt: Date;
  availableAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
}

export interface BayesianTeamStrengthOptions {
  halfLifeDays?: number;
  globalPriorMatches?: number;
  teamPriorStrength?: number;
  priorHomeGoals?: number;
  priorAwayGoals?: number;
  seed?: number;
}

export interface GammaPosteriorSummary {
  shape: number;
  rate: number;
  meanRate: number;
  meanLogStrength: number;
  varianceLogStrength: number;
}

export interface BayesianTeamPosterior {
  teamId: number;
  rawMatches: number;
  effectiveMatches: number;
  attack: GammaPosteriorSummary;
  defence: GammaPosteriorSummary;
}

export interface BayesianExpectedGoalsInterval {
  mean: number;
  lower90: number;
  upper90: number;
  varianceLog: number;
}

export interface BayesianTeamStrengthPrediction {
  version: string;
  inferenceMethod: 'CONJUGATE_GAMMA_POISSON_EMPIRICAL_BAYES';
  seed: number;
  datasetFingerprint: string;
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  predictionAsOf: Date;
  trainedFrom: Date | null;
  trainedThrough: Date | null;
  trainingMatches: number;
  effectiveTrainingMatches: number;
  halfLifeDays: number;
  leaguePrior: {
    homeGoalRate: number;
    awayGoalRate: number;
    homeAdvantageLog: number;
    homeGoalVarianceLog: number;
    awayGoalVarianceLog: number;
  };
  home: BayesianTeamPosterior;
  away: BayesianTeamPosterior;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedHomeGoalsInterval: BayesianExpectedGoalsInterval;
  expectedAwayGoalsInterval: BayesianExpectedGoalsInterval;
  homeAttackPosterior: number;
  homeDefencePosterior: number;
  awayAttackPosterior: number;
  awayDefencePosterior: number;
  homeAdvantagePosterior: number;
  posteriorUncertainty: number;
  priorOnly: boolean;
  modelVersion: string;
}

const DAY_MS = 86_400_000;
const EPSILON = 1e-12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function positive(value: number | undefined, fallback: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Number(value)) : fallback;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validMatch(match: BayesianTrainingMatch): boolean {
  return (
    Number.isInteger(match.fixtureId) &&
    Number.isInteger(match.leagueId) &&
    Number.isInteger(match.homeTeamId) &&
    Number.isInteger(match.awayTeamId) &&
    match.homeTeamId !== match.awayTeamId &&
    validDate(match.kickoffAt) &&
    validDate(match.availableAt) &&
    Number.isInteger(match.homeGoals) &&
    match.homeGoals >= 0 &&
    Number.isInteger(match.awayGoals) &&
    match.awayGoals >= 0
  );
}

function timeWeight(kickoffAt: Date, predictionAsOf: Date, halfLifeDays: number): number {
  const ageDays = Math.max(0, (predictionAsOf.getTime() - kickoffAt.getTime()) / DAY_MS);
  return Math.exp((-Math.log(2) * ageDays) / halfLifeDays);
}

// Stable approximation of trigamma(x), used as Var(log(rate)) for a Gamma posterior.
function trigamma(input: number): number {
  let value = Math.max(1e-6, input);
  let result = 0;
  while (value < 8) {
    result += 1 / (value * value);
    value += 1;
  }
  const inverse = 1 / value;
  const inverse2 = inverse * inverse;
  return (
    result +
    inverse +
    inverse2 / 2 +
    inverse2 * inverse / 6 -
    inverse2 * inverse2 * inverse / 30 +
    inverse2 * inverse2 * inverse2 * inverse / 42
  );
}

function gammaSummary(shape: number, rate: number, invertLog = false): GammaPosteriorSummary {
  const safeShape = Math.max(EPSILON, shape);
  const safeRate = Math.max(EPSILON, rate);
  const meanRate = safeShape / safeRate;
  const meanLogRate = Math.log(Math.max(EPSILON, meanRate));
  return {
    shape: safeShape,
    rate: safeRate,
    meanRate,
    meanLogStrength: invertLog ? -meanLogRate : meanLogRate,
    varianceLogStrength: trigamma(safeShape),
  };
}

function expectedGoalsInterval(mean: number, varianceLog: number): BayesianExpectedGoalsInterval {
  const deviation = Math.sqrt(Math.max(0, varianceLog));
  const z90 = 1.6448536269514722;
  return {
    mean,
    lower90: clamp(Math.exp(Math.log(mean) - z90 * deviation), 0.01, 12),
    upper90: clamp(Math.exp(Math.log(mean) + z90 * deviation), 0.01, 12),
    varianceLog,
  };
}

interface MutableTeamSufficientStatistics {
  rawMatches: number;
  effectiveMatches: number;
  attackGoals: number;
  attackExposure: number;
  concededGoals: number;
  concededExposure: number;
}

function emptyTeamStatistics(): MutableTeamSufficientStatistics {
  return {
    rawMatches: 0,
    effectiveMatches: 0,
    attackGoals: 0,
    attackExposure: 0,
    concededGoals: 0,
    concededExposure: 0,
  };
}

function teamPosterior(
  teamId: number,
  statistics: MutableTeamSufficientStatistics | undefined,
  teamPriorStrength: number,
): BayesianTeamPosterior {
  const row = statistics ?? emptyTeamStatistics();
  return {
    teamId,
    rawMatches: row.rawMatches,
    effectiveMatches: row.effectiveMatches,
    attack: gammaSummary(
      teamPriorStrength + row.attackGoals,
      teamPriorStrength + row.attackExposure,
    ),
    defence: gammaSummary(
      teamPriorStrength + row.concededGoals,
      teamPriorStrength + row.concededExposure,
      true,
    ),
  };
}

export function fitBayesianHierarchicalTeamStrength(input: {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  predictionAsOf: Date;
  matches: readonly BayesianTrainingMatch[];
  datasetFingerprint: string;
  options?: BayesianTeamStrengthOptions;
}): BayesianTeamStrengthPrediction {
  if (!validDate(input.predictionAsOf)) {
    throw new TypeError('predictionAsOf must be a valid Date.');
  }
  if (!input.datasetFingerprint) {
    throw new Error('datasetFingerprint is required.');
  }

  const halfLifeDays = positive(input.options?.halfLifeDays, 240, 1);
  const globalPriorMatches = positive(input.options?.globalPriorMatches, 8, 0.1);
  const teamPriorStrength = positive(input.options?.teamPriorStrength, 6, 0.1);
  const priorHomeGoals = positive(input.options?.priorHomeGoals, 1.45, 0.05);
  const priorAwayGoals = positive(input.options?.priorAwayGoals, 1.15, 0.05);
  const seed = Math.trunc(input.options?.seed ?? BAYESIAN_TEAM_STRENGTH_SEED);

  const eligible = input.matches
    .filter(
      (match) =>
        validMatch(match) &&
        match.leagueId === input.leagueId &&
        match.availableAt.getTime() < input.predictionAsOf.getTime() &&
        match.kickoffAt.getTime() < input.predictionAsOf.getTime(),
    )
    .sort(
      (left, right) =>
        left.kickoffAt.getTime() - right.kickoffAt.getTime() ||
        left.fixtureId - right.fixtureId,
    );

  const weighted = eligible.map((match) => ({
    match,
    weight: timeWeight(match.kickoffAt, input.predictionAsOf, halfLifeDays),
  }));
  const effectiveTrainingMatches = weighted.reduce((sum, row) => sum + row.weight, 0);
  const weightedHomeGoals = weighted.reduce(
    (sum, row) => sum + row.weight * row.match.homeGoals,
    0,
  );
  const weightedAwayGoals = weighted.reduce(
    (sum, row) => sum + row.weight * row.match.awayGoals,
    0,
  );

  const homeGoalShape = globalPriorMatches * priorHomeGoals + weightedHomeGoals;
  const awayGoalShape = globalPriorMatches * priorAwayGoals + weightedAwayGoals;
  const globalRate = globalPriorMatches + effectiveTrainingMatches;
  const leagueHomeGoalRate = homeGoalShape / globalRate;
  const leagueAwayGoalRate = awayGoalShape / globalRate;
  const homeGoalVarianceLog = trigamma(homeGoalShape);
  const awayGoalVarianceLog = trigamma(awayGoalShape);

  const teamStatistics = new Map<number, MutableTeamSufficientStatistics>();
  const getTeam = (teamId: number): MutableTeamSufficientStatistics => {
    const existing = teamStatistics.get(teamId);
    if (existing) return existing;
    const created = emptyTeamStatistics();
    teamStatistics.set(teamId, created);
    return created;
  };

  for (const { match, weight } of weighted) {
    const home = getTeam(match.homeTeamId);
    const away = getTeam(match.awayTeamId);
    home.rawMatches += 1;
    away.rawMatches += 1;
    home.effectiveMatches += weight;
    away.effectiveMatches += weight;

    home.attackGoals += weight * match.homeGoals;
    home.attackExposure += weight * leagueHomeGoalRate;
    home.concededGoals += weight * match.awayGoals;
    home.concededExposure += weight * leagueAwayGoalRate;

    away.attackGoals += weight * match.awayGoals;
    away.attackExposure += weight * leagueAwayGoalRate;
    away.concededGoals += weight * match.homeGoals;
    away.concededExposure += weight * leagueHomeGoalRate;
  }

  const home = teamPosterior(
    input.homeTeamId,
    teamStatistics.get(input.homeTeamId),
    teamPriorStrength,
  );
  const away = teamPosterior(
    input.awayTeamId,
    teamStatistics.get(input.awayTeamId),
    teamPriorStrength,
  );

  const expectedHomeGoals = clamp(
    leagueHomeGoalRate * home.attack.meanRate * away.defence.meanRate,
    0.05,
    6,
  );
  const expectedAwayGoals = clamp(
    leagueAwayGoalRate * away.attack.meanRate * home.defence.meanRate,
    0.05,
    6,
  );
  const homeVarianceLog =
    homeGoalVarianceLog + home.attack.varianceLogStrength + away.defence.varianceLogStrength;
  const awayVarianceLog =
    awayGoalVarianceLog + away.attack.varianceLogStrength + home.defence.varianceLogStrength;

  return {
    version: BAYESIAN_TEAM_STRENGTH_VERSION,
    inferenceMethod: 'CONJUGATE_GAMMA_POISSON_EMPIRICAL_BAYES',
    seed,
    datasetFingerprint: input.datasetFingerprint,
    fixtureId: input.fixtureId,
    leagueId: input.leagueId,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    predictionAsOf: input.predictionAsOf,
    trainedFrom: eligible[0]?.kickoffAt ?? null,
    trainedThrough: eligible.at(-1)?.availableAt ?? null,
    trainingMatches: eligible.length,
    effectiveTrainingMatches,
    halfLifeDays,
    leaguePrior: {
      homeGoalRate: leagueHomeGoalRate,
      awayGoalRate: leagueAwayGoalRate,
      homeAdvantageLog: Math.log(leagueHomeGoalRate / leagueAwayGoalRate),
      homeGoalVarianceLog,
      awayGoalVarianceLog,
    },
    home,
    away,
    expectedHomeGoals,
    expectedAwayGoals,
    expectedHomeGoalsInterval: expectedGoalsInterval(expectedHomeGoals, homeVarianceLog),
    expectedAwayGoalsInterval: expectedGoalsInterval(expectedAwayGoals, awayVarianceLog),
    homeAttackPosterior: home.attack.meanLogStrength,
    homeDefencePosterior: home.defence.meanLogStrength,
    awayAttackPosterior: away.attack.meanLogStrength,
    awayDefencePosterior: away.defence.meanLogStrength,
    homeAdvantagePosterior: Math.log(leagueHomeGoalRate / leagueAwayGoalRate),
    posteriorUncertainty: Math.sqrt((homeVarianceLog + awayVarianceLog) / 2),
    priorOnly: eligible.length === 0,
    modelVersion: BAYESIAN_TEAM_STRENGTH_VERSION,
  };
}

export function bayesianTeamStrengthPredictionHash(
  prediction: BayesianTeamStrengthPrediction,
): string {
  return sha256(
    stableStringify({
      ...prediction,
      predictionAsOf: prediction.predictionAsOf.toISOString(),
      trainedFrom: prediction.trainedFrom?.toISOString() ?? null,
      trainedThrough: prediction.trainedThrough?.toISOString() ?? null,
    }),
  );
}
