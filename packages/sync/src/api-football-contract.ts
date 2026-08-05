export const API_FOOTBALL_PROVIDER_VERSION = 'v7.0-beta.1B-api-football-real-provider-v1';

export const API_FOOTBALL_PROVIDER_KEY = 'api-football-v3';

export const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';

export const API_FOOTBALL_PREMATCH_HISTORY_DAYS = 7;

export const API_FOOTBALL_DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export const API_FOOTBALL_LEAGUE_PROFILE_VERSION = 'global-asia-expanded-v1';

export const API_FOOTBALL_MAJOR_8_LEAGUE_IDS = [
  2, // UEFA Champions League
  3, // UEFA Europa League
  39, // England Premier League
  61, // France Ligue 1
  78, // Germany Bundesliga
  135, // Italy Serie A
  140, // Spain La Liga
  253, // Major League Soccer
] as const;

export const API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES = [
  'Vietnam',
  'Thailand',
  'Indonesia',
  'Malaysia',
  'Singapore',
  'Philippines',
] as const;

export const API_FOOTBALL_ASIA_COUNTRIES = [
  'Japan',
  'South Korea',
  'China',
  'Saudi Arabia',
  'Qatar',
  'United Arab Emirates',
  'Australia',
  'India',
  'Iran',
  'Uzbekistan',
] as const;

export type ApiFootballLeagueGroup = 'GLOBAL_MAJOR' | 'SOUTHEAST_ASIA' | 'ASIA' | 'AFC';

export interface ApiFootballLeagueProfileEntry {
  id: number;
  name: string;
  type: string | null;
  country: string | null;
  logo: string | null;
  group: ApiFootballLeagueGroup;
  currentSeason: number | null;
  coverage: unknown;
  score: number;
}

export const API_FOOTBALL_SUPPORTED_TOTAL_LINES = [1.5, 2, 2.5, 3, 3.5] as const;

export type ApiFootballSupportedTotalLine = (typeof API_FOOTBALL_SUPPORTED_TOTAL_LINES)[number];

export type ApiFootballScientificMarket = 'MATCH_WINNER' | 'TOTAL_GOALS' | 'BTTS';

export type ApiFootballScientificSelection =
  'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';

export interface NormalizedApiFootballOdds {
  providerFixtureId: number;
  providerLeagueId: number;
  season: number;
  kickoffAt: Date;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  bookmakerId: number;
  bookmakerName: string;
  betId: number;
  betName: string;
  marketType: ApiFootballScientificMarket;
  selection: ApiFootballScientificSelection;
  lineValue: ApiFootballSupportedTotalLine | null;
  decimalOdds: number;
  pitUsable: boolean;
}

export interface NormalizedApiFootballFixture {
  providerFixtureId: number;
  providerLeagueId: number;
  season: number;
  kickoffAt: Date;
  statusShort: string;
  homeProviderTeamId: number;
  awayProviderTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
  fulltimeHomeGoals: number | null;
  fulltimeAwayGoals: number | null;
}

export interface ApiFootballResponseEnvelope<T = unknown> {
  get?: string;
  parameters?: unknown;
  errors?: unknown;
  results?: number;
  paging?: {
    current?: number;
    total?: number;
  };
  response?: T;
}

export interface ApiFootballQuotaSnapshot {
  requestsLimitDay: number | null;
  requestsRemainingDay: number | null;
  rateLimitPerMinute: number | null;
  rateRemainingPerMinute: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeBetName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function classifyApiFootballBetName(betName: string): ApiFootballScientificMarket | null {
  const normalized = normalizeBetName(betName);

  if (normalized === 'match winner' || normalized === 'fulltime result') {
    return 'MATCH_WINNER';
  }

  if (normalized === 'goals over/under') {
    return 'TOTAL_GOALS';
  }

  if (normalized === 'both teams score' || normalized === 'both teams to score') {
    return 'BTTS';
  }

  return null;
}

export function parseApiFootballSelection(
  marketType: ApiFootballScientificMarket,
  rawValue: unknown,
): {
  selection: ApiFootballScientificSelection;
  lineValue: ApiFootballSupportedTotalLine | null;
} | null {
  const value = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();

  if (marketType === 'MATCH_WINNER') {
    const normalized = value.toLowerCase();

    if (normalized === 'home') {
      return {
        selection: 'HOME',
        lineValue: null,
      };
    }

    if (normalized === 'draw') {
      return {
        selection: 'DRAW',
        lineValue: null,
      };
    }

    if (normalized === 'away') {
      return {
        selection: 'AWAY',
        lineValue: null,
      };
    }

    return null;
  }

  if (marketType === 'BTTS') {
    const normalized = value.toLowerCase();

    if (normalized === 'yes') {
      return {
        selection: 'YES',
        lineValue: null,
      };
    }

    if (normalized === 'no') {
      return {
        selection: 'NO',
        lineValue: null,
      };
    }

    return null;
  }

  const match = /^(over|under)\s+(\d+(?:\.\d+)?)$/i.exec(value);

  if (!match) {
    return null;
  }

  const line = Number(match[2]);

  if (!API_FOOTBALL_SUPPORTED_TOTAL_LINES.includes(line as ApiFootballSupportedTotalLine)) {
    return null;
  }

  return {
    selection: match[1]!.toUpperCase() as 'OVER' | 'UNDER',
    lineValue: line as ApiFootballSupportedTotalLine,
  };
}

export function normalizeApiFootballPrematchOdds(
  payload: unknown,
  observedAt: Date,
): NormalizedApiFootballOdds[] {
  if (!Number.isFinite(observedAt.getTime())) {
    throw new TypeError('observedAt must be a valid Date.');
  }

  const envelope = asRecord(payload);
  const response = Array.isArray(envelope?.response) ? envelope.response : [];

  const rows: NormalizedApiFootballOdds[] = [];

  for (const item of response) {
    const row = asRecord(item);
    const league = asRecord(row?.league);
    const fixture = asRecord(row?.fixture);
    const providerFixtureId = numberValue(fixture?.id);
    const providerLeagueId = numberValue(league?.id);
    const season = numberValue(league?.season);
    const kickoffAt = dateValue(fixture?.date);
    const sourceUpdatedAt = dateValue(row?.update);

    if (
      providerFixtureId == null ||
      providerLeagueId == null ||
      season == null ||
      kickoffAt == null
    ) {
      continue;
    }

    const bookmakers = Array.isArray(row?.bookmakers) ? row.bookmakers : [];

    for (const bookmakerValue of bookmakers) {
      const bookmaker = asRecord(bookmakerValue);
      const bookmakerId = numberValue(bookmaker?.id);
      const bookmakerName = stringValue(bookmaker?.name);
      const bets = Array.isArray(bookmaker?.bets) ? bookmaker.bets : [];

      if (bookmakerId == null || bookmakerName == null) {
        continue;
      }

      for (const betValue of bets) {
        const bet = asRecord(betValue);
        const betId = numberValue(bet?.id);
        const betName = stringValue(bet?.name);

        if (betId == null || betName == null) {
          continue;
        }

        const marketType = classifyApiFootballBetName(betName);

        if (!marketType) {
          continue;
        }

        const values = Array.isArray(bet?.values) ? bet.values : [];

        for (const valueItem of values) {
          const oddsValue = asRecord(valueItem);
          const parsedSelection = parseApiFootballSelection(marketType, oddsValue?.value);
          const decimalOdds = numberValue(oddsValue?.odd);

          if (!parsedSelection || decimalOdds == null || decimalOdds <= 1) {
            continue;
          }

          const pitUsable =
            sourceUpdatedAt != null &&
            sourceUpdatedAt.getTime() <= observedAt.getTime() &&
            observedAt.getTime() < kickoffAt.getTime();

          rows.push({
            providerFixtureId,
            providerLeagueId,
            season,
            kickoffAt,
            sourceUpdatedAt,
            observedAt,
            bookmakerId,
            bookmakerName,
            betId,
            betName,
            marketType,
            selection: parsedSelection.selection,
            lineValue: parsedSelection.lineValue,
            decimalOdds,
            pitUsable,
          });
        }
      }
    }
  }

  return rows;
}

export function normalizeApiFootballFixtures(payload: unknown): NormalizedApiFootballFixture[] {
  const envelope = asRecord(payload);
  const response = Array.isArray(envelope?.response) ? envelope.response : [];

  const rows: NormalizedApiFootballFixture[] = [];

  for (const item of response) {
    const row = asRecord(item);
    const fixture = asRecord(row?.fixture);
    const league = asRecord(row?.league);
    const teams = asRecord(row?.teams);
    const home = asRecord(teams?.home);
    const away = asRecord(teams?.away);
    const goals = asRecord(row?.goals);
    const score = asRecord(row?.score);
    const fulltime = asRecord(score?.fulltime);
    const status = asRecord(fixture?.status);

    const providerFixtureId = numberValue(fixture?.id);
    const providerLeagueId = numberValue(league?.id);
    const season = numberValue(league?.season);
    const kickoffAt = dateValue(fixture?.date);
    const homeProviderTeamId = numberValue(home?.id);
    const awayProviderTeamId = numberValue(away?.id);
    const homeTeamName = stringValue(home?.name);
    const awayTeamName = stringValue(away?.name);

    if (
      providerFixtureId == null ||
      providerLeagueId == null ||
      season == null ||
      kickoffAt == null ||
      homeProviderTeamId == null ||
      awayProviderTeamId == null ||
      homeTeamName == null ||
      awayTeamName == null
    ) {
      continue;
    }

    rows.push({
      providerFixtureId,
      providerLeagueId,
      season,
      kickoffAt,
      statusShort: stringValue(status?.short) ?? 'UNKNOWN',
      homeProviderTeamId,
      awayProviderTeamId,
      homeTeamName,
      awayTeamName,
      homeGoals: numberValue(goals?.home),
      awayGoals: numberValue(goals?.away),
      fulltimeHomeGoals: numberValue(fulltime?.home),
      fulltimeAwayGoals: numberValue(fulltime?.away),
    });
  }

  return rows;
}

export function parseApiFootballQuotaHeaders(headers: {
  get(name: string): string | null;
}): ApiFootballQuotaSnapshot {
  const parse = (name: string): number | null => {
    const value = headers.get(name);

    if (value == null) {
      return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    requestsLimitDay: parse('x-ratelimit-requests-limit'),
    requestsRemainingDay: parse('x-ratelimit-requests-remaining'),
    rateLimitPerMinute: parse('x-ratelimit-limit'),
    rateRemainingPerMinute: parse('x-ratelimit-remaining'),
  };
}

export function parseCommaSeparatedIds(value: string | undefined): number[] {
  if (value == null || value.trim() === '') {
    return [];
  }

  const result = value.split(',').map((token) => Number(token.trim()));

  if (result.some((item) => !Number.isInteger(item) || item <= 0)) {
    throw new Error(`Invalid comma-separated id list: ${value}`);
  }

  return [...new Set(result)];
}

export function utcDateString(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('value must be a valid Date.');
  }

  return value.toISOString().slice(0, 10);
}

export function lastUtcDates(endDate: Date, count: number): string[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError('count must be a positive integer.');
  }

  const dates: string[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    dates.push(utcDateString(new Date(endDate.getTime() - offset * 86_400_000)));
  }

  return dates;
}

export function apiFootballTimezone(): string {
  const configured = process.env.API_FOOTBALL_TIMEZONE?.trim();

  return configured && configured.length > 0 ? configured : API_FOOTBALL_DEFAULT_TIMEZONE;
}

export function resolveApiFootballLeagueIds(): number[] {
  const profile = (process.env.API_FOOTBALL_LEAGUE_PROFILE ?? 'MAJOR_8').trim().toUpperCase();
  const configured = parseCommaSeparatedIds(process.env.API_FOOTBALL_LEAGUE_IDS);

  if (profile === 'NONE') {
    return [...new Set(configured)];
  }

  if (profile === 'MAJOR_8' || profile === 'GLOBAL_ASIA') {
    return [...new Set([...API_FOOTBALL_MAJOR_8_LEAGUE_IDS, ...configured])];
  }

  throw new Error(
    `Unsupported API_FOOTBALL_LEAGUE_PROFILE=${profile}. Supported: GLOBAL_ASIA, MAJOR_8, NONE.`,
  );
}

function normalizedLeagueToken(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedCountryAliases(value: string): string[] {
  const normalized = normalizedLeagueToken(value);

  if (normalized === 'south korea') {
    return ['south korea', 'south korea republic', 'korea republic', 'korea south'];
  }

  if (normalized === 'united arab emirates') {
    return ['united arab emirates', 'uae'];
  }

  return [normalized];
}

const SOUTHEAST_ASIA_COUNTRY_TOKENS = new Set(
  API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES.flatMap(normalizedCountryAliases),
);

const ASIA_COUNTRY_TOKENS = new Set(API_FOOTBALL_ASIA_COUNTRIES.flatMap(normalizedCountryAliases));

export function classifyApiFootballLeagueRegion(input: {
  leagueId: number;
  leagueName: string | null | undefined;
  countryName: string | null | undefined;
}): ApiFootballLeagueGroup | null {
  if (
    API_FOOTBALL_MAJOR_8_LEAGUE_IDS.includes(
      input.leagueId as (typeof API_FOOTBALL_MAJOR_8_LEAGUE_IDS)[number],
    )
  ) {
    return 'GLOBAL_MAJOR';
  }

  const country = normalizedLeagueToken(input.countryName);
  const leagueName = normalizedLeagueToken(input.leagueName);

  if (SOUTHEAST_ASIA_COUNTRY_TOKENS.has(country)) {
    return 'SOUTHEAST_ASIA';
  }

  if (ASIA_COUNTRY_TOKENS.has(country)) {
    return 'ASIA';
  }

  const afcClubCompetition =
    leagueName.includes('afc champions league') ||
    leagueName.includes('afc cup') ||
    leagueName.includes('afc challenge league');

  if (afcClubCompetition) {
    return 'AFC';
  }

  return null;
}

function leaguePriorityScore(input: {
  id: number;
  name: string;
  type: string | null;
  group: ApiFootballLeagueGroup;
}): number {
  const name = normalizedLeagueToken(input.name);
  let score =
    input.group === 'GLOBAL_MAJOR'
      ? 1000
      : input.group === 'SOUTHEAST_ASIA'
        ? 900
        : input.group === 'AFC'
          ? 850
          : 800;

  if (normalizedLeagueToken(input.type) === 'league') {
    score += 50;
  }

  for (const firstTierToken of [
    'premier league',
    'super league',
    'league 1',
    'liga 1',
    'j1 league',
    'k league 1',
    'pro league',
    'stars league',
    'a league',
    'v league 1',
    'thai league 1',
  ]) {
    if (name.includes(firstTierToken)) {
      score += 30;
      break;
    }
  }

  return score;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteInteger(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;

  return Number.isInteger(number) ? number : null;
}

export function parseApiFootballLeagueProfile(payload: unknown): ApiFootballLeagueProfileEntry[] {
  const envelope = recordValue(payload);
  const response = Array.isArray(envelope?.response) ? envelope.response : [];
  const entries: ApiFootballLeagueProfileEntry[] = [];

  for (const item of response) {
    const row = recordValue(item);
    const league = recordValue(row?.league);
    const country = recordValue(row?.country);
    const id = finiteInteger(league?.id);
    const name = typeof league?.name === 'string' ? league.name : null;

    if (id == null || name == null) {
      continue;
    }

    const countryName = typeof country?.name === 'string' ? country.name : null;
    const group = classifyApiFootballLeagueRegion({
      leagueId: id,
      leagueName: name,
      countryName,
    });

    if (group == null) {
      continue;
    }

    const seasons = Array.isArray(row?.seasons) ? row.seasons : [];
    const currentSeasonRow = seasons.find((season) => recordValue(season)?.current === true);
    const currentSeason = finiteInteger(recordValue(currentSeasonRow)?.year);
    const coverage = recordValue(currentSeasonRow)?.coverage ?? null;
    const type = typeof league?.type === 'string' ? league.type : null;
    const logo = typeof league?.logo === 'string' ? league.logo : null;

    entries.push({
      id,
      name,
      type,
      country: countryName,
      logo,
      group,
      currentSeason,
      coverage,
      score: leaguePriorityScore({
        id,
        name,
        type,
        group,
      }),
    });
  }

  const byId = new Map<number, ApiFootballLeagueProfileEntry>();

  for (const entry of entries) {
    const existing = byId.get(entry.id);

    if (existing == null || entry.score > existing.score) {
      byId.set(entry.id, entry);
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.country?.localeCompare(right.country ?? '') ||
      left.name.localeCompare(right.name),
  );
}

export function apiFootballLeagueProfile(): string {
  return (process.env.API_FOOTBALL_LEAGUE_PROFILE ?? 'GLOBAL_ASIA').trim().toUpperCase();
}

export function formatDateTimeInTimeZone(
  value: Date,
  timeZone: string = API_FOOTBALL_DEFAULT_TIMEZONE,
): string {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError('value must be a valid Date.');
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export function dateStringInTimeZone(
  value: Date,
  timeZone: string = API_FOOTBALL_DEFAULT_TIMEZONE,
): string {
  return formatDateTimeInTimeZone(value, timeZone).slice(0, 10);
}

export function lastDatesInTimeZone(
  endDate: Date,
  count: number,
  timeZone: string = API_FOOTBALL_DEFAULT_TIMEZONE,
): string[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError('count must be a positive integer.');
  }

  const result: string[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (result.length < count) {
    const date = dateStringInTimeZone(new Date(endDate.getTime() - offset * 86_400_000), timeZone);

    if (!seen.has(date)) {
      seen.add(date);
      result.push(date);
    }

    offset += 1;
  }

  return result.reverse();
}

export function buildVietnamHorizonSchedule(kickoffAt: Date): {
  kickoffVietnam: string;
  t180Vietnam: string;
  t90Vietnam: string;
  t30Vietnam: string;
  t5Vietnam: string;
  timezone: 'Asia/Ho_Chi_Minh';
} {
  const subtract = (minutes: number) => new Date(kickoffAt.getTime() - minutes * 60_000);

  return {
    kickoffVietnam: formatDateTimeInTimeZone(kickoffAt, 'Asia/Ho_Chi_Minh'),
    t180Vietnam: formatDateTimeInTimeZone(subtract(180), 'Asia/Ho_Chi_Minh'),
    t90Vietnam: formatDateTimeInTimeZone(subtract(90), 'Asia/Ho_Chi_Minh'),
    t30Vietnam: formatDateTimeInTimeZone(subtract(30), 'Asia/Ho_Chi_Minh'),
    t5Vietnam: formatDateTimeInTimeZone(subtract(5), 'Asia/Ho_Chi_Minh'),
    timezone: 'Asia/Ho_Chi_Minh',
  };
}
