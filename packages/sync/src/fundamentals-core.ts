export const FUNDAMENTAL_WINDOWS = [5, 10, 20] as const;

export type FundamentalWindow = (typeof FUNDAMENTAL_WINDOWS)[number];

export type VenueRole = 'HOME' | 'AWAY';

export interface HistoricalTeamMetric {
  expectedGoals: number | null;
  shots: number | null;
  shotsOnGoal: number | null;
  possession: number | null;
  corners: number | null;
  capturedAt: Date | null;
}

export interface HistoricalFixture {
  fixtureId: number;
  leagueId: number;
  kickoffAt: Date;
  availableAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  homeMetric?: HistoricalTeamMetric | null;
  awayMetric?: HistoricalTeamMetric | null;
}

export interface FundamentalWindowSummary {
  matches: number;
  pointsPerGame: number;
  goalsFor: number;
  goalsAgainst: number;
  expectedGoalsFor: number;
  expectedGoalsAgainst: number;
  shots: number;
  shotsOnGoal: number;
  possession: number;
  corners: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  cleanSheetRate: number;
  bttsRate: number;
  over25Rate: number;
  metricCoverage: number;
}

export interface TeamFundamentals {
  teamId: number;
  leagueId: number;
  targetFixtureId: number;
  predictionAsOf: Date;
  venueRole: VenueRole;
  windows: Record<FundamentalWindow, FundamentalWindowSummary>;
  venueSummary: FundamentalWindowSummary;
  sampleSize: number;
  venueSampleSize: number;
  restDays: number;
  dataQualityScore: number;
  latestSourceFixtureId: number | null;
  latestSourceKickoffAt: Date | null;
  latestSourceAvailableAt: Date | null;
  sourceFixtureIds: number[];
}

export interface DixonColesTrainingMatch {
  fixtureId: number;
  kickoffAt: Date;
  availableAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
}

export interface DixonColesModel {
  leagueId: number;
  trainedFrom: Date;
  trainedThrough: Date;
  sampleSize: number;
  teamCount: number;
  halfLifeDays: number;
  rho: number;
  intercept: number;
  homeAdvantage: number;
  attacks: Record<string, number>;
  defenses: Record<string, number>;
}

export interface DixonColesProbabilities {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  matchWinner: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  over25: {
    OVER: number;
    UNDER: number;
  };
  btts: {
    YES: number;
    NO: number;
  };
  scoreGridMass: number;
}

export interface FundamentalsFixturePrediction {
  available: boolean;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  horizonMinutes: number;
  home: TeamFundamentals;
  away: TeamFundamentals;
  dixonColes: DixonColesModel | null;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  matchWinner: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  over25: {
    OVER: number;
    UNDER: number;
  };
  btts: {
    YES: number;
    NO: number;
  };
  dataQualityScore: number;
  reasons: string[];
}

interface TeamMatchView {
  fixtureId: number;
  kickoffAt: Date;
  availableAt: Date;
  venueRole: VenueRole;
  goalsFor: number;
  goalsAgainst: number;
  expectedGoalsFor: number;
  expectedGoalsAgainst: number;
  shots: number;
  shotsOnGoal: number;
  possession: number;
  corners: number;
  points: number;
  metricAvailable: boolean;
}

interface FitOptions {
  halfLifeDays?: number;
  iterations?: number;
  learningRate?: number;
  l2?: number;
  rhoMinimum?: number;
  rhoMaximum?: number;
  rhoStep?: number;
  maximumGoals?: number;
}

const DAY_MS = 86_400_000;
const EPSILON = 1e-12;

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | null | undefined, fallback: number): number {
  return value == null || !Number.isFinite(value) ? fallback : value;
}

function average(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(
  values: ReadonlyArray<{
    value: number;
    weight: number;
  }>,
  fallback: number,
): number {
  const totalWeight = values.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= EPSILON) return fallback;
  return values.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function emptySummary(): FundamentalWindowSummary {
  return {
    matches: 0,
    pointsPerGame: 1.35,
    goalsFor: 1.25,
    goalsAgainst: 1.25,
    expectedGoalsFor: 1.25,
    expectedGoalsAgainst: 1.25,
    shots: 10,
    shotsOnGoal: 4,
    possession: 50,
    corners: 4.5,
    winRate: 0.33,
    drawRate: 0.34,
    lossRate: 0.33,
    cleanSheetRate: 0.25,
    bttsRate: 0.5,
    over25Rate: 0.5,
    metricCoverage: 0,
  };
}

function normalizeProbabilities<T extends string>(input: Record<T, number>): Record<T, number> {
  const entries = Object.entries(input) as Array<[T, number]>;
  const total = entries.reduce(
    (sum, [, value]) => sum + (Number.isFinite(value) ? Math.max(0, value) : 0),
    0,
  );

  if (total <= EPSILON) {
    const uniform = 1 / Math.max(1, entries.length);
    return Object.fromEntries(entries.map(([key]) => [key, uniform])) as Record<T, number>;
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, Math.max(0, value) / total]),
  ) as Record<T, number>;
}

function metricAvailableAt(
  metric: HistoricalTeamMetric | null | undefined,
  predictionAsOf: Date,
): boolean {
  return metric?.capturedAt != null && metric.capturedAt.getTime() <= predictionAsOf.getTime();
}

function toTeamViews(input: {
  fixtures: readonly HistoricalFixture[];
  teamId: number;
  targetFixtureId: number;
  targetKickoffAt: Date;
  predictionAsOf: Date;
}): TeamMatchView[] {
  assertValidDate(input.targetKickoffAt, 'targetKickoffAt');
  assertValidDate(input.predictionAsOf, 'predictionAsOf');

  const result: TeamMatchView[] = [];

  for (const fixture of input.fixtures) {
    assertValidDate(fixture.kickoffAt, 'kickoffAt');
    assertValidDate(fixture.availableAt, 'availableAt');

    if (
      fixture.fixtureId === input.targetFixtureId ||
      fixture.kickoffAt.getTime() >= input.targetKickoffAt.getTime() ||
      fixture.availableAt.getTime() > input.predictionAsOf.getTime()
    ) {
      continue;
    }

    const isHome = fixture.homeTeamId === input.teamId;
    const isAway = fixture.awayTeamId === input.teamId;
    if (!isHome && !isAway) continue;

    const ownMetric = isHome ? fixture.homeMetric : fixture.awayMetric;
    const opponentMetric = isHome ? fixture.awayMetric : fixture.homeMetric;
    const goalsFor = isHome ? fixture.homeGoals : fixture.awayGoals;
    const goalsAgainst = isHome ? fixture.awayGoals : fixture.homeGoals;
    const ownMetricAvailable = metricAvailableAt(ownMetric, input.predictionAsOf);
    const opponentMetricAvailable = metricAvailableAt(opponentMetric, input.predictionAsOf);

    result.push({
      fixtureId: fixture.fixtureId,
      kickoffAt: fixture.kickoffAt,
      availableAt: fixture.availableAt,
      venueRole: isHome ? 'HOME' : 'AWAY',
      goalsFor,
      goalsAgainst,
      expectedGoalsFor: ownMetricAvailable ? finite(ownMetric?.expectedGoals, goalsFor) : goalsFor,
      expectedGoalsAgainst: opponentMetricAvailable
        ? finite(opponentMetric?.expectedGoals, goalsAgainst)
        : goalsAgainst,
      shots: ownMetricAvailable ? finite(ownMetric?.shots, goalsFor * 7 + 5) : goalsFor * 7 + 5,
      shotsOnGoal: ownMetricAvailable
        ? finite(ownMetric?.shotsOnGoal, goalsFor * 2.2 + 1)
        : goalsFor * 2.2 + 1,
      possession: ownMetricAvailable ? finite(ownMetric?.possession, 50) : 50,
      corners: ownMetricAvailable ? finite(ownMetric?.corners, 4.5) : 4.5,
      points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
      metricAvailable: ownMetricAvailable && opponentMetricAvailable,
    });
  }

  return result.sort(
    (left, right) =>
      right.kickoffAt.getTime() - left.kickoffAt.getTime() || right.fixtureId - left.fixtureId,
  );
}

function summarize(rows: readonly TeamMatchView[], limit: number): FundamentalWindowSummary {
  const selected = rows.slice(0, limit);
  if (selected.length === 0) return emptySummary();

  const matches = selected.length;
  const wins = selected.filter((row) => row.goalsFor > row.goalsAgainst).length;
  const draws = selected.filter((row) => row.goalsFor === row.goalsAgainst).length;
  const losses = matches - wins - draws;

  return {
    matches,
    pointsPerGame: average(
      selected.map((row) => row.points),
      1.35,
    ),
    goalsFor: average(
      selected.map((row) => row.goalsFor),
      1.25,
    ),
    goalsAgainst: average(
      selected.map((row) => row.goalsAgainst),
      1.25,
    ),
    expectedGoalsFor: average(
      selected.map((row) => row.expectedGoalsFor),
      1.25,
    ),
    expectedGoalsAgainst: average(
      selected.map((row) => row.expectedGoalsAgainst),
      1.25,
    ),
    shots: average(
      selected.map((row) => row.shots),
      10,
    ),
    shotsOnGoal: average(
      selected.map((row) => row.shotsOnGoal),
      4,
    ),
    possession: average(
      selected.map((row) => row.possession),
      50,
    ),
    corners: average(
      selected.map((row) => row.corners),
      4.5,
    ),
    winRate: wins / matches,
    drawRate: draws / matches,
    lossRate: losses / matches,
    cleanSheetRate: selected.filter((row) => row.goalsAgainst === 0).length / matches,
    bttsRate: selected.filter((row) => row.goalsFor > 0 && row.goalsAgainst > 0).length / matches,
    over25Rate: selected.filter((row) => row.goalsFor + row.goalsAgainst > 2).length / matches,
    metricCoverage: selected.filter((row) => row.metricAvailable).length / matches,
  };
}

export function buildTeamFundamentals(input: {
  fixtures: readonly HistoricalFixture[];
  teamId: number;
  leagueId: number;
  targetFixtureId: number;
  targetKickoffAt: Date;
  predictionAsOf: Date;
  venueRole: VenueRole;
}): TeamFundamentals {
  const rows = toTeamViews(input);
  const windows = {
    5: summarize(rows, 5),
    10: summarize(rows, 10),
    20: summarize(rows, 20),
  } as Record<FundamentalWindow, FundamentalWindowSummary>;
  const venueRows = rows.filter((row) => row.venueRole === input.venueRole);
  const venueSummary = summarize(venueRows, 10);
  const latest = rows[0] ?? null;
  const sampleSize = windows[20].matches;
  const sampleQuality = clamp(sampleSize / 20, 0, 1);
  const venueQuality = clamp(venueSummary.matches / 10, 0, 1);
  const metricCoverage = windows[10].metricCoverage;
  const dataQualityScore = clamp(
    sampleQuality * 0.5 + venueQuality * 0.25 + metricCoverage * 0.25,
    0,
    1,
  );

  return {
    teamId: input.teamId,
    leagueId: input.leagueId,
    targetFixtureId: input.targetFixtureId,
    predictionAsOf: new Date(input.predictionAsOf),
    venueRole: input.venueRole,
    windows,
    venueSummary,
    sampleSize,
    venueSampleSize: venueSummary.matches,
    restDays: latest
      ? clamp((input.targetKickoffAt.getTime() - latest.kickoffAt.getTime()) / DAY_MS, 0, 45)
      : 7,
    dataQualityScore,
    latestSourceFixtureId: latest?.fixtureId ?? null,
    latestSourceKickoffAt: latest?.kickoffAt ?? null,
    latestSourceAvailableAt: latest?.availableAt ?? null,
    sourceFixtureIds: rows.slice(0, 20).map((row) => row.fixtureId),
  };
}

export function exponentialTimeWeight(input: {
  matchKickoffAt: Date;
  predictionAsOf: Date;
  halfLifeDays: number;
}): number {
  assertValidDate(input.matchKickoffAt, 'matchKickoffAt');
  assertValidDate(input.predictionAsOf, 'predictionAsOf');
  const ageDays = Math.max(
    0,
    (input.predictionAsOf.getTime() - input.matchKickoffAt.getTime()) / DAY_MS,
  );
  return Math.exp((-Math.log(2) * ageDays) / Math.max(1, input.halfLifeDays));
}

function poissonProbability(goals: number, lambda: number): number {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) {
    factorial *= index;
  }
  return (Math.exp(-lambda) * lambda ** goals) / Math.max(1, factorial);
}

export function dixonColesTau(input: {
  homeGoals: number;
  awayGoals: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  rho: number;
}): number {
  const { homeGoals, awayGoals, homeExpectedGoals, awayExpectedGoals, rho } = input;

  if (homeGoals === 0 && awayGoals === 0) {
    return Math.max(EPSILON, 1 - homeExpectedGoals * awayExpectedGoals * rho);
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return Math.max(EPSILON, 1 + homeExpectedGoals * rho);
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return Math.max(EPSILON, 1 + awayExpectedGoals * rho);
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return Math.max(EPSILON, 1 - rho);
  }
  return 1;
}

function expectedGoalsFromParameters(input: {
  model: DixonColesModel;
  homeTeamId: number;
  awayTeamId: number;
}): {
  home: number;
  away: number;
} {
  const homeAttack = input.model.attacks[String(input.homeTeamId)] ?? 0;
  const awayAttack = input.model.attacks[String(input.awayTeamId)] ?? 0;
  const homeDefense = input.model.defenses[String(input.homeTeamId)] ?? 0;
  const awayDefense = input.model.defenses[String(input.awayTeamId)] ?? 0;

  return {
    home: clamp(
      Math.exp(input.model.intercept + input.model.homeAdvantage + homeAttack - awayDefense),
      0.15,
      5,
    ),
    away: clamp(Math.exp(input.model.intercept + awayAttack - homeDefense), 0.1, 4.5),
  };
}

function lowScoreLogLikelihood(input: {
  matches: readonly DixonColesTrainingMatch[];
  model: DixonColesModel;
  predictionAsOf: Date;
  rho: number;
}): number {
  let result = 0;

  for (const match of input.matches) {
    const lambdas = expectedGoalsFromParameters({
      model: input.model,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    });
    const weight = exponentialTimeWeight({
      matchKickoffAt: match.kickoffAt,
      predictionAsOf: input.predictionAsOf,
      halfLifeDays: input.model.halfLifeDays,
    });
    const tau = dixonColesTau({
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      homeExpectedGoals: lambdas.home,
      awayExpectedGoals: lambdas.away,
      rho: input.rho,
    });

    result += weight * Math.log(Math.max(EPSILON, tau));
  }

  return result;
}

export function fitDynamicDixonColes(input: {
  leagueId: number;
  matches: readonly DixonColesTrainingMatch[];
  predictionAsOf: Date;
  options?: FitOptions;
}): DixonColesModel | null {
  assertValidDate(input.predictionAsOf, 'predictionAsOf');

  const eligible = input.matches
    .filter(
      (match) =>
        match.availableAt.getTime() <= input.predictionAsOf.getTime() &&
        match.kickoffAt.getTime() < input.predictionAsOf.getTime(),
    )
    .sort(
      (left, right) =>
        left.kickoffAt.getTime() - right.kickoffAt.getTime() || left.fixtureId - right.fixtureId,
    );

  if (eligible.length < 12) return null;

  const options = {
    halfLifeDays: Math.max(30, input.options?.halfLifeDays ?? 240),
    iterations: Math.max(25, Math.floor(input.options?.iterations ?? 220)),
    learningRate: clamp(input.options?.learningRate ?? 0.012, 0.0005, 0.08),
    l2: clamp(input.options?.l2 ?? 0.018, 0, 0.2),
    rhoMinimum: clamp(input.options?.rhoMinimum ?? -0.2, -0.35, 0.1),
    rhoMaximum: clamp(input.options?.rhoMaximum ?? 0.2, -0.1, 0.35),
    rhoStep: clamp(input.options?.rhoStep ?? 0.005, 0.001, 0.05),
  };

  const teamIds = [
    ...new Set(eligible.flatMap((match) => [match.homeTeamId, match.awayTeamId])),
  ].sort((left, right) => left - right);

  const attacks = new Map<number, number>(teamIds.map((teamId) => [teamId, 0]));
  const defenses = new Map<number, number>(teamIds.map((teamId) => [teamId, 0]));

  const weightedHomeGoals = weightedAverage(
    eligible.map((match) => ({
      value: match.homeGoals,
      weight: exponentialTimeWeight({
        matchKickoffAt: match.kickoffAt,
        predictionAsOf: input.predictionAsOf,
        halfLifeDays: options.halfLifeDays,
      }),
    })),
    1.45,
  );
  const weightedAwayGoals = weightedAverage(
    eligible.map((match) => ({
      value: match.awayGoals,
      weight: exponentialTimeWeight({
        matchKickoffAt: match.kickoffAt,
        predictionAsOf: input.predictionAsOf,
        halfLifeDays: options.halfLifeDays,
      }),
    })),
    1.15,
  );
  let intercept = Math.log(Math.max(0.3, weightedAwayGoals));
  let homeAdvantage = Math.log(Math.max(0.6, weightedHomeGoals / Math.max(0.3, weightedAwayGoals)));

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const attackGradient = new Map<number, number>(teamIds.map((teamId) => [teamId, 0]));
    const defenseGradient = new Map<number, number>(teamIds.map((teamId) => [teamId, 0]));
    let interceptGradient = 0;
    let homeGradient = 0;
    let totalWeight = 0;

    for (const match of eligible) {
      const weight = exponentialTimeWeight({
        matchKickoffAt: match.kickoffAt,
        predictionAsOf: input.predictionAsOf,
        halfLifeDays: options.halfLifeDays,
      });
      const homeLambda = clamp(
        Math.exp(
          intercept +
            homeAdvantage +
            (attacks.get(match.homeTeamId) ?? 0) -
            (defenses.get(match.awayTeamId) ?? 0),
        ),
        0.05,
        6,
      );
      const awayLambda = clamp(
        Math.exp(
          intercept + (attacks.get(match.awayTeamId) ?? 0) - (defenses.get(match.homeTeamId) ?? 0),
        ),
        0.05,
        6,
      );
      const homeResidual = match.homeGoals - homeLambda;
      const awayResidual = match.awayGoals - awayLambda;

      attackGradient.set(
        match.homeTeamId,
        (attackGradient.get(match.homeTeamId) ?? 0) + weight * homeResidual,
      );
      attackGradient.set(
        match.awayTeamId,
        (attackGradient.get(match.awayTeamId) ?? 0) + weight * awayResidual,
      );
      defenseGradient.set(
        match.awayTeamId,
        (defenseGradient.get(match.awayTeamId) ?? 0) - weight * homeResidual,
      );
      defenseGradient.set(
        match.homeTeamId,
        (defenseGradient.get(match.homeTeamId) ?? 0) - weight * awayResidual,
      );
      interceptGradient += weight * (homeResidual + awayResidual);
      homeGradient += weight * homeResidual;
      totalWeight += weight;
    }

    const scale = options.learningRate / Math.max(1, totalWeight);

    for (const teamId of teamIds) {
      const attack = attacks.get(teamId) ?? 0;
      const defense = defenses.get(teamId) ?? 0;
      attacks.set(
        teamId,
        clamp(
          attack + scale * ((attackGradient.get(teamId) ?? 0) - options.l2 * attack * totalWeight),
          -1.7,
          1.7,
        ),
      );
      defenses.set(
        teamId,
        clamp(
          defense +
            scale * ((defenseGradient.get(teamId) ?? 0) - options.l2 * defense * totalWeight),
          -1.7,
          1.7,
        ),
      );
    }

    intercept = clamp(intercept + scale * interceptGradient * 0.5, -1.4, 1.2);
    homeAdvantage = clamp(homeAdvantage + scale * homeGradient * 0.5, -0.35, 0.75);

    const attackMean = average(
      teamIds.map((teamId) => attacks.get(teamId) ?? 0),
      0,
    );
    const defenseMean = average(
      teamIds.map((teamId) => defenses.get(teamId) ?? 0),
      0,
    );

    for (const teamId of teamIds) {
      attacks.set(teamId, (attacks.get(teamId) ?? 0) - attackMean);
      defenses.set(teamId, (defenses.get(teamId) ?? 0) - defenseMean);
    }
    intercept += attackMean - defenseMean;
  }

  const baseModel: DixonColesModel = {
    leagueId: input.leagueId,
    trainedFrom: eligible[0]!.kickoffAt,
    trainedThrough: eligible[eligible.length - 1]!.availableAt,
    sampleSize: eligible.length,
    teamCount: teamIds.length,
    halfLifeDays: options.halfLifeDays,
    rho: 0,
    intercept,
    homeAdvantage,
    attacks: Object.fromEntries(
      teamIds.map((teamId) => [String(teamId), attacks.get(teamId) ?? 0]),
    ),
    defenses: Object.fromEntries(
      teamIds.map((teamId) => [String(teamId), defenses.get(teamId) ?? 0]),
    ),
  };

  let bestRho = 0;
  let bestLikelihood = Number.NEGATIVE_INFINITY;

  for (let rho = options.rhoMinimum; rho <= options.rhoMaximum + EPSILON; rho += options.rhoStep) {
    const likelihood = lowScoreLogLikelihood({
      matches: eligible,
      model: baseModel,
      predictionAsOf: input.predictionAsOf,
      rho,
    });

    if (likelihood > bestLikelihood) {
      bestLikelihood = likelihood;
      bestRho = rho;
    }
  }

  return {
    ...baseModel,
    rho: clamp(bestRho, -0.35, 0.35),
  };
}

export function predictDixonColes(input: {
  model: DixonColesModel;
  homeTeamId: number;
  awayTeamId: number;
  maximumGoals?: number;
}): DixonColesProbabilities {
  const lambdas = expectedGoalsFromParameters(input);
  const maximumGoals = Math.max(6, Math.floor(input.maximumGoals ?? 10));
  let home = 0;
  let draw = 0;
  let away = 0;
  let over = 0;
  let bttsYes = 0;
  let mass = 0;

  for (let homeGoals = 0; homeGoals <= maximumGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maximumGoals; awayGoals += 1) {
      const probability =
        poissonProbability(homeGoals, lambdas.home) *
        poissonProbability(awayGoals, lambdas.away) *
        dixonColesTau({
          homeGoals,
          awayGoals,
          homeExpectedGoals: lambdas.home,
          awayExpectedGoals: lambdas.away,
          rho: input.model.rho,
        });

      mass += probability;
      if (homeGoals > awayGoals) home += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else away += probability;
      if (homeGoals + awayGoals > 2) over += probability;
      if (homeGoals > 0 && awayGoals > 0) {
        bttsYes += probability;
      }
    }
  }

  const matchWinner = normalizeProbabilities({
    HOME: home,
    DRAW: draw,
    AWAY: away,
  });
  const overProbability = clamp(over / Math.max(EPSILON, mass), 0, 1);
  const bttsProbability = clamp(bttsYes / Math.max(EPSILON, mass), 0, 1);

  return {
    homeExpectedGoals: lambdas.home,
    awayExpectedGoals: lambdas.away,
    matchWinner,
    over25: {
      OVER: overProbability,
      UNDER: 1 - overProbability,
    },
    btts: {
      YES: bttsProbability,
      NO: 1 - bttsProbability,
    },
    scoreGridMass: mass,
  };
}

export function unavailableFundamentalsPrediction(input: {
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  horizonMinutes: number;
  home: TeamFundamentals;
  away: TeamFundamentals;
  reason: string;
}): FundamentalsFixturePrediction {
  return {
    available: false,
    fixtureId: input.fixtureId,
    leagueId: input.leagueId,
    predictionAsOf: input.predictionAsOf,
    horizonMinutes: input.horizonMinutes,
    home: input.home,
    away: input.away,
    dixonColes: null,
    homeExpectedGoals: input.home.windows[10].expectedGoalsFor,
    awayExpectedGoals: input.away.windows[10].expectedGoalsFor,
    matchWinner: {
      HOME: 1 / 3,
      DRAW: 1 / 3,
      AWAY: 1 / 3,
    },
    over25: {
      OVER: 0.5,
      UNDER: 0.5,
    },
    btts: {
      YES: 0.5,
      NO: 0.5,
    },
    dataQualityScore: (input.home.dataQualityScore + input.away.dataQualityScore) / 2,
    reasons: [input.reason],
  };
}
