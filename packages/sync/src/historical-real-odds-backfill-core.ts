import { createHash } from 'node:crypto';

export const HISTORICAL_REAL_ODDS_BACKFILL_VERSION =
  'v7.0-beta.1B.2a-historical-real-odds-backfill-v1';
export const HISTORICAL_EXTERNAL_ODDS_PROVIDER = 'THE_ODDS_API' as const;
export const HISTORICAL_REAL_ODDS_HORIZON_MINUTES = 90 as const;
export const HISTORICAL_REAL_ODDS_CLOSING_MINUTES = 5 as const;

export interface HistoricalOddsTarget {
  fixtureId: number;
  providerFixtureId: number;
  providerLeagueId: number;
  season: number;
  leagueName: string;
  country: string | null;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: Date;
  decisionAsOf: Date;
  sportKey: string;
}

export interface TheOddsApiOutcome {
  name: string;
  price: number;
  point?: number | null;
}

export interface TheOddsApiMarket {
  key: string;
  last_update?: string | null;
  outcomes: TheOddsApiOutcome[];
}

export interface TheOddsApiBookmaker {
  key: string;
  title: string;
  last_update?: string | null;
  markets: TheOddsApiMarket[];
}

export interface TheOddsApiEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: TheOddsApiBookmaker[];
}

export interface TheOddsApiHistoricalResponse {
  timestamp: string;
  previous_timestamp?: string | null;
  next_timestamp?: string | null;
  data: TheOddsApiEvent[];
}

export interface HistoricalExternalOddsInsertRow {
  sourceProvider: string;
  sourceSportKey: string;
  sourceEventId: string;
  sourceSnapshotAt: Date;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  localFixtureId: number;
  providerFixtureId: number;
  providerLeagueId: number;
  season: number;
  kickoffAt: Date;
  bookmakerNamespaceId: number;
  bookmakerKey: string;
  bookmakerName: string;
  marketType: 'MATCH_WINNER';
  selection: 'HOME' | 'DRAW' | 'AWAY';
  lineValue: null;
  decimalOdds: number;
  pitUsable: boolean;
  rawPayloadHash: string;
  payloadHash: string;
}

export interface EventMatchResult {
  status: 'MATCHED' | 'NO_MATCH' | 'AMBIGUOUS';
  event: TheOddsApiEvent | null;
  candidates: Array<{
    eventId: string;
    kickoffDifferenceMinutes: number;
    homeScore: number;
    awayScore: number;
  }>;
}

export function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function normalizeTeamName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|afc|sc|ac|fk|club|football|soccer)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value: string): Set<string> {
  return new Set(normalizeTeamName(value).split(' ').filter(Boolean));
}

export function teamNameScore(left: string, right: string): number {
  const a = normalizeTeamName(left);
  const b = normalizeTeamName(right);
  if (a === '' || b === '') return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return 0.94;
  const aa = tokens(a);
  const bb = tokens(b);
  const union = new Set([...aa, ...bb]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  return intersection / union.size;
}

function aliasName(name: string, aliases: Record<string, string>): string {
  return aliases[name] ?? aliases[normalizeTeamName(name)] ?? name;
}

export function findStrictHistoricalEvent(input: {
  target: HistoricalOddsTarget;
  events: TheOddsApiEvent[];
  kickoffToleranceMinutes?: number;
  aliases?: Record<string, string>;
}): EventMatchResult {
  const tolerance = Math.max(1, Math.floor(input.kickoffToleranceMinutes ?? 10));
  const aliases = input.aliases ?? {};
  const expectedHome = aliasName(input.target.homeTeamName, aliases);
  const expectedAway = aliasName(input.target.awayTeamName, aliases);
  const candidates: EventMatchResult['candidates'] = [];

  for (const event of input.events) {
    const kickoff = new Date(event.commence_time);
    if (!Number.isFinite(kickoff.getTime())) continue;
    const kickoffDifferenceMinutes = Math.abs(kickoff.getTime() - input.target.kickoffAt.getTime()) / 60_000;
    if (kickoffDifferenceMinutes > tolerance) continue;
    const homeScore = teamNameScore(expectedHome, event.home_team);
    const awayScore = teamNameScore(expectedAway, event.away_team);
    if (homeScore < 0.78 || awayScore < 0.78) continue;
    candidates.push({ eventId: event.id, kickoffDifferenceMinutes, homeScore, awayScore });
  }

  candidates.sort(
    (a, b) =>
      b.homeScore + b.awayScore - (a.homeScore + a.awayScore) ||
      a.kickoffDifferenceMinutes - b.kickoffDifferenceMinutes ||
      a.eventId.localeCompare(b.eventId),
  );
  if (candidates.length === 0) return { status: 'NO_MATCH', event: null, candidates };
  if (candidates.length > 1) {
    const first = candidates[0];
    const second = candidates[1];
    if (first == null || second == null) return { status: 'AMBIGUOUS', event: null, candidates };
    const firstQuality = first.homeScore + first.awayScore - first.kickoffDifferenceMinutes / 100;
    const secondQuality = second.homeScore + second.awayScore - second.kickoffDifferenceMinutes / 100;
    if (firstQuality - secondQuality < 0.12) return { status: 'AMBIGUOUS', event: null, candidates };
  }
  const winnerId = candidates[0]?.eventId;
  const event = winnerId == null ? null : input.events.find((item) => item.id === winnerId) ?? null;
  return event == null
    ? { status: 'NO_MATCH', event: null, candidates }
    : { status: 'MATCHED', event, candidates };
}

export function deterministicBookmakerNamespaceId(bookmakerKey: string): number {
  const hex = createHash('sha256').update(bookmakerKey).digest('hex').slice(0, 8);
  const value = Number.parseInt(hex, 16) % 800_000_000;
  return -(1_000_000_000 + value);
}

export function historicalSnapshotRequestAt(asOf: Date): Date {
  if (!Number.isFinite(asOf.getTime())) throw new TypeError('asOf must be a valid Date.');
  const fiveMinuteHistoryStart = Date.parse('2022-09-01T00:00:00.000Z');
  const cadenceMinutes = asOf.getTime() < fiveMinuteHistoryStart ? 10 : 5;
  const cadenceMs = cadenceMinutes * 60_000;
  return new Date(Math.floor(asOf.getTime() / cadenceMs) * cadenceMs);
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (value == null || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function selectionForOutcome(input: {
  outcomeName: string;
  event: TheOddsApiEvent;
}): 'HOME' | 'DRAW' | 'AWAY' | null {
  const name = normalizeTeamName(input.outcomeName);
  if (name === 'draw' || name === 'tie') return 'DRAW';
  if (teamNameScore(input.outcomeName, input.event.home_team) >= 0.9) return 'HOME';
  if (teamNameScore(input.outcomeName, input.event.away_team) >= 0.9) return 'AWAY';
  return null;
}

export function mapHistoricalSnapshotToRows(input: {
  target: HistoricalOddsTarget;
  response: TheOddsApiHistoricalResponse;
  matchedEvent: TheOddsApiEvent;
  ingestedAt: Date;
  rawPayloadHash?: string;
}): HistoricalExternalOddsInsertRow[] {
  const snapshotAt = new Date(input.response.timestamp);
  if (!Number.isFinite(snapshotAt.getTime())) throw new Error('INVALID_HISTORICAL_SNAPSHOT_TIMESTAMP');
  const rawPayloadHash = input.rawPayloadHash ?? sha256Canonical(input.response);
  const rows: HistoricalExternalOddsInsertRow[] = [];

  for (const bookmaker of input.matchedEvent.bookmakers) {
    const market = bookmaker.markets.find((item) => item.key === 'h2h');
    if (market == null) continue;
    const mapped = market.outcomes
      .map((outcome) => ({ outcome, selection: selectionForOutcome({ outcomeName: outcome.name, event: input.matchedEvent }) }))
      .filter(
        (item): item is { outcome: TheOddsApiOutcome; selection: 'HOME' | 'DRAW' | 'AWAY' } =>
          item.selection != null && Number.isFinite(item.outcome.price) && item.outcome.price > 1,
      );
    const selections = new Set(mapped.map((item) => item.selection));
    if (selections.size !== 3 || !selections.has('HOME') || !selections.has('DRAW') || !selections.has('AWAY')) {
      continue;
    }

    const sourceUpdatedAt =
      parseOptionalDate(market.last_update) ?? parseOptionalDate(bookmaker.last_update) ?? snapshotAt;
    const pitUsable =
      snapshotAt.getTime() <= input.target.decisionAsOf.getTime() &&
      sourceUpdatedAt.getTime() <= input.target.decisionAsOf.getTime() &&
      input.target.decisionAsOf.getTime() < input.target.kickoffAt.getTime();

    for (const item of mapped) {
      const payloadBase = {
        sourceProvider: HISTORICAL_EXTERNAL_ODDS_PROVIDER,
        sourceSportKey: input.target.sportKey,
        sourceEventId: input.matchedEvent.id,
        sourceSnapshotAt: snapshotAt.toISOString(),
        sourceUpdatedAt: sourceUpdatedAt.toISOString(),
        localFixtureId: input.target.fixtureId,
        providerFixtureId: input.target.providerFixtureId,
        providerLeagueId: input.target.providerLeagueId,
        season: input.target.season,
        kickoffAt: input.target.kickoffAt.toISOString(),
        bookmakerKey: bookmaker.key,
        bookmakerName: bookmaker.title,
        marketType: 'MATCH_WINNER',
        selection: item.selection,
        decimalOdds: item.outcome.price,
        rawPayloadHash,
      };
      rows.push({
        sourceProvider: HISTORICAL_EXTERNAL_ODDS_PROVIDER,
        sourceSportKey: input.target.sportKey,
        sourceEventId: input.matchedEvent.id,
        sourceSnapshotAt: snapshotAt,
        sourceUpdatedAt,
        observedAt: input.ingestedAt,
        localFixtureId: input.target.fixtureId,
        providerFixtureId: input.target.providerFixtureId,
        providerLeagueId: input.target.providerLeagueId,
        season: input.target.season,
        kickoffAt: input.target.kickoffAt,
        bookmakerNamespaceId: deterministicBookmakerNamespaceId(bookmaker.key),
        bookmakerKey: bookmaker.key,
        bookmakerName: bookmaker.title,
        marketType: 'MATCH_WINNER',
        selection: item.selection,
        lineValue: null,
        decimalOdds: item.outcome.price,
        pitUsable,
        rawPayloadHash,
        payloadHash: sha256Canonical(payloadBase),
      });
    }
  }
  return rows;
}
