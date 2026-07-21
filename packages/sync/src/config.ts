import type {
  OverUnderConsensusRules,
  RecommendationRules,
} from '@football-ai/engine';

export interface LeagueConfiguration {
  leagueId: number;
  season: number;
}

function numberEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseLeagueConfigurations(
  value = process.env.API_FOOTBALL_LEAGUES ?? '',
): LeagueConfiguration[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [league, season] = item.split(':').map(Number);
      if (!Number.isInteger(league) || !Number.isInteger(season)) {
        throw new Error(`Invalid API_FOOTBALL_LEAGUES entry: ${item}`);
      }
      return { leagueId: league!, season: season! };
    });
}

export function getRecommendationRules(): RecommendationRules {
  return {
    minimumOdds: numberEnvironment('RECOMMENDATION_MIN_ODDS', 1.4),
    maximumOdds: numberEnvironment('RECOMMENDATION_MAX_ODDS', 4),
    minimumExpectedValue: numberEnvironment('RECOMMENDATION_MIN_EV', 0.05),
    minimumEdge: numberEnvironment('RECOMMENDATION_MIN_EDGE', 0.03),
    minimumConfidence: numberEnvironment('RECOMMENDATION_MIN_CONFIDENCE', 0.55),
    minimumDataQuality: numberEnvironment('RECOMMENDATION_MIN_DATA_QUALITY', 0.55),
    maximumOddsAgeMinutes: numberEnvironment('RECOMMENDATION_MAX_ODDS_AGE_MINUTES', 180),
    minimumBookmakers: numberEnvironment('RECOMMENDATION_MIN_BOOKMAKERS', 1),
    topPerFixture: numberEnvironment('RECOMMENDATION_TOP_PER_FIXTURE', 3),
  };
}

export function getOverUnderConsensusRules(): OverUnderConsensusRules {
  const base = getRecommendationRules();
  return {
    lineValue: numberEnvironment('OU_LINE', 2.5),
    minimumOdds: numberEnvironment('OU_MIN_ODDS', base.minimumOdds),
    maximumOdds: numberEnvironment('OU_MAX_ODDS', base.maximumOdds),
    minimumExpectedValue: numberEnvironment('OU_MIN_EV', base.minimumExpectedValue),
    minimumEdge: numberEnvironment('OU_MIN_EDGE', base.minimumEdge),
    minimumConfidence: numberEnvironment('OU_MIN_CONFIDENCE', base.minimumConfidence),
    minimumDataQuality: numberEnvironment('OU_MIN_DATA_QUALITY', base.minimumDataQuality),
    maximumOddsAgeMinutes: numberEnvironment(
      'OU_MAX_ODDS_AGE_MINUTES',
      base.maximumOddsAgeMinutes,
    ),
    minimumCompleteBookmakers: numberEnvironment(
      'OU_MIN_COMPLETE_BOOKMAKERS',
      Math.max(3, base.minimumBookmakers),
    ),
    minimumReferenceBookmakers: numberEnvironment('OU_MIN_REFERENCE_BOOKMAKERS', 2),
    maximumProbabilityStddev: numberEnvironment('OU_MAX_PROBABILITY_STDDEV', 0.04),
    topPerFixture: numberEnvironment('OU_TOP_PER_FIXTURE', 1),
  };
}

export function getFixtureHoursAhead(): number {
  return numberEnvironment('RECOMMENDATION_FIXTURE_HOURS_AHEAD', 96);
}
