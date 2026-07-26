import type { LeagueResponse } from '@football-ai/api-football';

import { getApiFootballClient } from './client.js';
import { trackApiResult } from './tracking.js';

export type CurrentCompetitionGroup =
  | 'ASEAN'
  | 'WAFCON'
  | 'UCL'
  | 'UEFA_EUROPA'
  | 'SEA'
  | 'ASIA'
  | 'EPL'
  | 'LALIGA';

type LeagueSeason = NonNullable<LeagueResponse['seasons']>[number];

export interface CurrentCompetition {
  apiLeagueId: number;
  season: number;
  name: string;
  country: string | null;
  group: CurrentCompetitionGroup;
  coverage: Record<string, unknown> | null;
}

interface DiscoveryOptions {
  groups?: CurrentCompetitionGroup[];
  maximumSea?: number;
  maximumAsia?: number;
}

const SEA_COUNTRIES = new Set([
  'vietnam',
  'thailand',
  'indonesia',
  'malaysia',
  'singapore',
  'philippines',
  'myanmar',
  'laos',
  'cambodia',
  'brunei',
  'timor-leste',
  'timor leste',
]);

const ASIA_COUNTRIES = new Set([
  'japan',
  'south-korea',
  'south korea',
  'china',
  'hong-kong',
  'hong kong',
  'macao',
  'india',
  'saudi-arabia',
  'saudi arabia',
  'united-arab-emirates',
  'united arab emirates',
  'qatar',
  'iran',
  'iraq',
  'jordan',
  'uzbekistan',
  'kazakhstan',
  'kyrgyzstan',
  'tajikistan',
  'turkmenistan',
  'kuwait',
  'bahrain',
  'oman',
  'lebanon',
  'syria',
  'australia',
]);

const SEA_PRIORITY = [
  'asean championship',
  'aff championship',
  'aff cup',
  'aff suzuki cup',
  'aff mitsubishi electric cup',
  'asean hyundai cup',
  'v.league 1',
  'thai league 1',
  'liga 1',
  'super league',
  'singapore premier league',
  'philippines football league',
  'national league',
  'lao league',
  'cambodian premier league',
];

const ASIA_PRIORITY = [
  'afc champions league elite',
  'afc champions league two',
  'j1 league',
  'k league 1',
  'pro league',
  'stars league',
  'indian super league',
  'super league',
];

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function isDemoCompetitionName(name: string): boolean {
  const normalized = normalize(name);
  return (
    normalized.includes('demo') ||
    normalized.includes('test') ||
    normalized.includes('mock') ||
    normalized.includes('synthetic') ||
    normalized.includes('sample')
  );
}


export function isAseanSeniorChampionshipName(name: string): boolean {
  const normalized = normalize(name);

  const excludedVariants = [
    'u19',
    'u20',
    'u21',
    'u22',
    'u23',
    'women',
    'woman',
    'club',
    'qualification',
    'qualifier',
  ];

  if (
    excludedVariants.some(
      (variant: string): boolean => normalized.includes(variant),
    )
  ) {
    return false;
  }

  return (
    normalized === 'asean championship' ||
    normalized === 'aff championship' ||
    normalized === 'aff cup' ||
    normalized === 'aff suzuki cup' ||
    normalized === 'aff mitsubishi electric cup' ||
    normalized === 'asean hyundai cup' ||
    normalized.includes('asean championship') ||
    normalized.includes('aff championship')
  );
}


export function isWafconSeniorCompetitionName(name: string): boolean {
  const normalized = normalize(name);

  const excludedVariants = [
    'qualification',
    'qualifier',
    'u17',
    'u20',
    'u23',
    'club',
  ];

  if (
    excludedVariants.some(
      (variant: string): boolean => normalized.includes(variant),
    )
  ) {
    return false;
  }

  return (
    normalized === 'africa cup of nations - women' ||
    normalized === "women's africa cup of nations" ||
    normalized === 'women africa cup of nations' ||
    normalized.includes("women's africa cup of nations") ||
    normalized.includes('wafcon')
  );
}

export function isUefaChampionsLeagueName(name: string): boolean {
  return normalize(name) === 'uefa champions league';
}

export function isUefaEuropaFamilyName(name: string): boolean {
  const normalized = normalize(name);
  return (
    normalized === 'uefa europa league' ||
    normalized === 'uefa europa conference league' ||
    normalized === 'uefa conference league'
  );
}

function classify(entry: LeagueResponse): CurrentCompetitionGroup | null {
  const country = normalize(entry.country?.name);
  const name = normalize(entry.league.name);

  if (isAseanSeniorChampionshipName(entry.league.name)) return 'ASEAN';
  if (isWafconSeniorCompetitionName(entry.league.name)) return 'WAFCON';
  if (isUefaChampionsLeagueName(entry.league.name)) return 'UCL';
  if (isUefaEuropaFamilyName(entry.league.name)) return 'UEFA_EUROPA';
  if (country === 'england' && name === 'premier league') return 'EPL';
  if (country === 'spain' && (name === 'la liga' || name === 'laliga')) return 'LALIGA';

  if (
    SEA_COUNTRIES.has(country) ||
    name.startsWith('asean ') ||
    name.includes('asean championship') ||
    name.includes('asean club championship')
  ) {
    return 'SEA';
  }

  if (
    ASIA_COUNTRIES.has(country) ||
    name.startsWith('afc ') ||
    name.startsWith('asian ') ||
    name.includes('afc champions league')
  ) {
    return 'ASIA';
  }

  return null;
}

function nameRank(group: CurrentCompetitionGroup, name: string): number {
  const normalized = normalize(name);
  const preferred =
    group === 'SEA'
      ? SEA_PRIORITY
      : group === 'ASIA'
        ? ASIA_PRIORITY
        : [];

  const exact = preferred.findIndex((value: string): boolean => normalized === value);
  if (exact >= 0) return exact;

  const partial = preferred.findIndex(
    (value: string): boolean => normalized.includes(value),
  );
  return partial >= 0 ? partial + 20 : 100;
}

function competitionScore(row: CurrentCompetition): number {
  if (row.group === 'ASEAN') return 30_000;
  if (row.group === 'WAFCON') return 29_500;
  if (row.group === 'UCL') return 29_000;
  if (row.group === 'UEFA_EUROPA') {
    return normalize(row.name) === 'uefa europa league' ? 28_500 : 28_000;
  }
  if (row.group === 'EPL') return 10_000;
  if (row.group === 'LALIGA') return 9_900;
  if (row.group === 'SEA') return 9_000 - nameRank(row.group, row.name);
  return 8_000 - nameRank(row.group, row.name);
}

function currentSeason(entry: LeagueResponse) {
  return (
    entry.seasons
      ?.filter((season: LeagueSeason): boolean => season.current === true)
      .sort(
        (left: LeagueSeason, right: LeagueSeason): number => right.year - left.year,
      )[0] ?? null
  );
}

export async function discoverCurrentPriorityCompetitions(
  options: DiscoveryOptions = {},
): Promise<{
  competitions: CurrentCompetition[];
  apiRequests: number;
  quotaRemainingDay: number | null;
  quotaRemainingMinute: number | null;
}> {
  const groups =
    options.groups && options.groups.length > 0
      ? new Set(options.groups)
      : new Set<CurrentCompetitionGroup>([
          'ASEAN',
          'WAFCON',
          'UCL',
          'UEFA_EUROPA',
          'SEA',
          'ASIA',
          'EPL',
          'LALIGA',
        ]);

  const maximumSea = Math.max(1, Math.min(12, options.maximumSea ?? 8));
  const maximumAsia = Math.max(1, Math.min(12, options.maximumAsia ?? 8));

  const client = getApiFootballClient();
  const result = await client.getLeagues({ current: true });
  await trackApiResult('leagues-current', result);

  const candidates: CurrentCompetition[] = [];

  for (const entry of result.data) {
    if (isDemoCompetitionName(entry.league.name)) continue;

    const group = classify(entry);
    if (!group || !groups.has(group)) continue;

    const season = currentSeason(entry);
    if (!season) continue;

    candidates.push({
      apiLeagueId: entry.league.id,
      season: season.year,
      name: entry.league.name,
      country: entry.country?.name ?? null,
      group,
      coverage: season.coverage ?? null,
    });
  }

  const unique = [
    ...new Map(
      candidates.map((row: CurrentCompetition) => [
        `${row.apiLeagueId}:${row.season}`,
        row,
      ]),
    ).values(),
  ];

  const sea = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'SEA')
    .sort(
      (left: CurrentCompetition, right: CurrentCompetition): number =>
        competitionScore(right) - competitionScore(left),
    )
    .slice(0, maximumSea);

  const asia = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'ASIA')
    .sort(
      (left: CurrentCompetition, right: CurrentCompetition): number =>
        competitionScore(right) - competitionScore(left),
    )
    .slice(0, maximumAsia);

  const asean = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'ASEAN')
    .slice(0, 1);

  const wafcon = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'WAFCON')
    .slice(0, 1);

  const ucl = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'UCL')
    .slice(0, 1);

  const uefaEuropa = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'UEFA_EUROPA')
    .sort(
      (left: CurrentCompetition, right: CurrentCompetition): number =>
        competitionScore(right) - competitionScore(left),
    )
    .slice(0, 2);

  const epl = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'EPL')
    .slice(0, 1);

  const laLiga = unique
    .filter((row: CurrentCompetition): boolean => row.group === 'LALIGA')
    .slice(0, 1);

  const competitions = [
    ...asean,
    ...wafcon,
    ...ucl,
    ...uefaEuropa,
    ...sea,
    ...asia,
    ...epl,
    ...laLiga,
  ]
    .filter((row: CurrentCompetition): boolean => groups.has(row.group))
    .sort(
      (left: CurrentCompetition, right: CurrentCompetition): number =>
        competitionScore(right) - competitionScore(left),
    );

  return {
    competitions,
    apiRequests: 1,
    quotaRemainingDay: result.rateLimit.dailyRemaining ?? null,
    quotaRemainingMinute: result.rateLimit.minuteRemaining ?? null,
  };
}
