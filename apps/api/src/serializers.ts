import type { JsonValue } from '@football-ai/database';

// PREDICTION_AI_V622_STAKE_SERIALIZER
interface StakeDisplayMetadata {
  stakeUnits: number;
  stakeFraction: number | null;
  stakeAmount: number | null;
  stakeCurrency: string | null;
  stakeProfile: string | null;
  stakeRiskBand: string | null;
}

function reasonStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function parseStakeDisplayMetadata(value: unknown): StakeDisplayMetadata | null {
  const reason = reasonStrings(value).find((entry) =>
    entry.includes('Mức cược đề xuất'),
  );
  if (!reason) return null;
  const match = reason.match(
    /Mức cược đề xuất\s+([\d.,]+)u\s+\(([\d.,]+)% bankroll(?:,\s*tương đương\s+([\d.\s,]+)\s+([A-Z]{3}))?\),\s*hồ sơ\s+([A-Z]+),\s*rủi ro\s+([A-Z_]+)\./i,
  );
  if (!match) return null;
  const stakeUnits = Number(match[1]!.replace(',', '.'));
  const stakePercent = Number(match[2]!.replace(',', '.'));
  const stakeAmount = match[3]
    ? Number(match[3].replace(/[.\s]/g, '').replace(',', '.'))
    : null;
  if (!Number.isFinite(stakeUnits)) return null;
  return {
    stakeUnits,
    stakeFraction: Number.isFinite(stakePercent) ? stakePercent / 100 : null,
    stakeAmount: stakeAmount != null && Number.isFinite(stakeAmount) ? stakeAmount : null,
    stakeCurrency: match[4]?.toUpperCase() ?? null,
    stakeProfile: match[5]?.toUpperCase() ?? null,
    stakeRiskBand: match[6]?.toUpperCase() ?? null,
  };
}

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
  const stake = parseStakeDisplayMetadata(recommendation.reasons);
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
    stakeUnits: stake?.stakeUnits ?? null,
    stakeFraction: stake?.stakeFraction ?? null,
    stakeAmount: stake?.stakeAmount ?? null,
    stakeCurrency: stake?.stakeCurrency ?? null,
    stakeProfile: stake?.stakeProfile ?? null,
    stakeRiskBand: stake?.stakeRiskBand ?? null,
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
