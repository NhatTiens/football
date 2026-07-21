import type { JsonValue } from '@football-ai/database';

export function fixtureSummary(fixture: any) {
  return {
    id: fixture.id,
    apiFixtureId: fixture.apiFixtureId,
    kickoffAt: fixture.kickoffAt,
    status: fixture.status,
    apiStatusShort: fixture.apiStatusShort,
    round: fixture.round,
    venueName: fixture.venueName,
    score: {
      home: fixture.homeGoals,
      away: fixture.awayGoals,
    },
    league: fixture.league && {
      id: fixture.league.id,
      apiLeagueId: fixture.league.apiLeagueId,
      name: fixture.league.name,
      season: fixture.league.season,
      country: fixture.league.country,
      logoUrl: fixture.league.logoUrl,
    },
    homeTeam: fixture.homeTeam && {
      id: fixture.homeTeam.id,
      apiTeamId: fixture.homeTeam.apiTeamId,
      name: fixture.homeTeam.name,
      code: fixture.homeTeam.code,
      logoUrl: fixture.homeTeam.logoUrl,
    },
    awayTeam: fixture.awayTeam && {
      id: fixture.awayTeam.id,
      apiTeamId: fixture.awayTeam.apiTeamId,
      name: fixture.awayTeam.name,
      code: fixture.awayTeam.code,
      logoUrl: fixture.awayTeam.logoUrl,
    },
    recommendationCount: fixture._count?.recommendations,
  };
}

export function recommendationDto(recommendation: any) {
  return {
    id: recommendation.id,
    rank: recommendation.rankNumber,
    marketCode: recommendation.marketCode,
    marketName: recommendation.marketName,
    marketGroup: recommendation.marketGroup,
    selectionCode: recommendation.selectionCode,
    selectionName: recommendation.selectionName,
    lineValue: recommendation.lineValue,
    odds: recommendation.decimalOdds,
    modelProbability: recommendation.modelProbability,
    fairMarketProbability: recommendation.fairMarketProbability,
    impliedProbability: recommendation.impliedProbability,
    edge: recommendation.edge,
    expectedValue: recommendation.expectedValue,
    confidenceScore: recommendation.confidenceScore,
    dataQualityScore: recommendation.dataQualityScore,
    recommendationScore: recommendation.recommendationScore,
    modelVersion: recommendation.modelVersion,
    reasons: recommendation.reasons as JsonValue,
    status: recommendation.status,
    settlementResult: recommendation.settlementResult,
    simulatedProfitUnits: recommendation.simulatedProfitUnits,
    generatedAt: recommendation.generatedAt,
    expiresAt: recommendation.expiresAt,
    bookmaker: recommendation.bookmaker && {
      id: recommendation.bookmaker.id,
      name: recommendation.bookmaker.name,
    },
    fixture: recommendation.fixture ? fixtureSummary(recommendation.fixture) : undefined,
  };
}
