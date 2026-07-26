import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@football-ai/database';

import { getScientificBestBetReliabilityReport } from './scientific-best-bet-reliability-engine.js';
import {
  HISTORICAL_EXTERNAL_ODDS_PROVIDER,
  HISTORICAL_REAL_ODDS_BACKFILL_VERSION,
  HISTORICAL_REAL_ODDS_CLOSING_MINUTES,
  HISTORICAL_REAL_ODDS_HORIZON_MINUTES,
  findStrictHistoricalEvent,
  historicalSnapshotRequestAt,
  mapHistoricalSnapshotToRows,
  sha256Canonical,
  type HistoricalOddsTarget,
  type TheOddsApiHistoricalResponse,
} from './historical-real-odds-backfill-core.js';

type JsonRecord = Record<string, unknown>;

interface ReplayPredictionRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  pitSafe: boolean;
}

interface FixtureTargetRow {
  id: number;
  apiFixtureId: number;
  kickoffAt: Date;
  league: { apiLeagueId: number; season: number; name: string; country: string | null };
  homeTeam: { name: string };
  awayTeam: { name: string };
}

interface ProviderHeaders {
  remaining: string | null;
  used: string | null;
  last: string | null;
}

function repoRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(current, '../../..');
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return Math.floor(value);
}

function paidApiAllowed(): boolean {
  return (process.env.HISTORICAL_ODDS_ALLOW_PAID_API ?? '').trim().toUpperCase() === 'YES';
}

function providerApiKey(): string {
  const key = (process.env.THE_ODDS_API_KEY ?? '').trim();
  if (key === '') throw new Error('THE_ODDS_API_KEY is required for provider probe/backfill.');
  if (!paidApiAllowed()) {
    throw new Error('Paid historical API is locked. Set HISTORICAL_ODDS_ALLOW_PAID_API=YES only after reviewing the plan/credit estimate.');
  }
  return key;
}

function providerRegion(): string {
  const region = (process.env.HISTORICAL_ODDS_REGION ?? 'eu').trim().toLowerCase();
  if (!/^(eu|uk|au|us|us2)$/.test(region)) {
    throw new Error('HISTORICAL_ODDS_REGION must be one of eu, uk, au, us, us2.');
  }
  return region;
}

async function readJsonFile(filePath: string): Promise<Record<string, string>> {
  const parsed = JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object: ${filePath}`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') result[key] = value.trim();
  }
  return result;
}

async function sportMap(): Promise<Record<string, string>> {
  const defaultPath = path.join(repoRoot(), 'config', 'historical-odds-sport-map.json');
  const override = process.env.HISTORICAL_ODDS_SPORT_MAP_FILE?.trim();
  const merged = await readJsonFile(defaultPath);
  if (override != null && override !== '') Object.assign(merged, await readJsonFile(path.resolve(override)));
  return merged;
}

async function aliases(): Promise<Record<string, string>> {
  const file = process.env.HISTORICAL_ODDS_TEAM_ALIAS_FILE?.trim();
  if (file == null || file === '') return {};
  return readJsonFile(path.resolve(file));
}

async function loadTargets(): Promise<{ runId: number; targets: HistoricalOddsTarget[] }> {
  const reliability = await getScientificBestBetReliabilityReport();
  const defaultRunId = reliability.sourceReplay.replayRunId;
  const runId = envInt('HISTORICAL_ODDS_REPLAY_RUN_ID', defaultRunId);
  const predictions = (await prisma.providerReplayPrediction.findMany({
    where: { runId, horizonMinutes: HISTORICAL_REAL_ODDS_HORIZON_MINUTES, pitSafe: true },
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      fixtureId: true,
      leagueId: true,
      predictionAsOf: true,
      kickoffAt: true,
      horizonMinutes: true,
      pitSafe: true,
    },
  })) as ReplayPredictionRow[];

  const uniquePredictions = new Map<number, ReplayPredictionRow>();
  for (const prediction of predictions) if (!uniquePredictions.has(prediction.fixtureId)) uniquePredictions.set(prediction.fixtureId, prediction);
  const fixtureIds = [...uniquePredictions.keys()];
  if (fixtureIds.length === 0) throw new Error(`No PIT-safe T-90 replay predictions found for runId=${runId}.`);

  const fixtures = (await prisma.fixture.findMany({
    where: { id: { in: fixtureIds } },
    select: {
      id: true,
      apiFixtureId: true,
      kickoffAt: true,
      league: { select: { apiLeagueId: true, season: true, name: true, country: true } },
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  })) as FixtureTargetRow[];
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const mapping = await sportMap();
  const targets: HistoricalOddsTarget[] = [];
  for (const prediction of uniquePredictions.values()) {
    const fixture = fixtureById.get(prediction.fixtureId);
    if (fixture == null) continue;
    const sportKey = mapping[String(fixture.league.apiLeagueId)] ?? '';
    targets.push({
      fixtureId: fixture.id,
      providerFixtureId: fixture.apiFixtureId,
      providerLeagueId: fixture.league.apiLeagueId,
      season: fixture.league.season,
      leagueName: fixture.league.name,
      country: fixture.league.country,
      homeTeamName: fixture.homeTeam.name,
      awayTeamName: fixture.awayTeam.name,
      kickoffAt: fixture.kickoffAt,
      decisionAsOf: prediction.predictionAsOf,
      sportKey,
    });
  }
  targets.sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime() || a.fixtureId - b.fixtureId);
  return { runId, targets };
}

async function existingCoverage(targets: HistoricalOddsTarget[]): Promise<{
  externalFixtures: Set<number>;
  apiFootballFixtures: Set<number>;
  externalRows: number;
  apiFootballRows: number;
}> {
  const providerFixtureIds = targets.map((target) => target.providerFixtureId);
  const localFixtureIds = targets.map((target) => target.fixtureId);
  const targetByLocal = new Map(targets.map((target) => [target.fixtureId, target]));
  const targetByProvider = new Map(targets.map((target) => [target.providerFixtureId, target]));
  const external = (await prisma.historicalExternalOddsSnapshot.findMany({
    where: { localFixtureId: { in: localFixtureIds }, marketType: 'MATCH_WINNER', pitUsable: true },
    select: { localFixtureId: true, sourceSnapshotAt: true, sourceUpdatedAt: true },
  })) as Array<{ localFixtureId: number; sourceSnapshotAt: Date; sourceUpdatedAt: Date | null }>;
  const api = (await prisma.apiFootballOddsSnapshot.findMany({
    where: { providerFixtureId: { in: providerFixtureIds }, marketType: 'MATCH_WINNER', pitUsable: true },
    select: { providerFixtureId: true, observedAt: true, sourceUpdatedAt: true },
  })) as Array<{ providerFixtureId: number; observedAt: Date; sourceUpdatedAt: Date | null }>;

  const externalDecisionRows = external.filter((row) => {
    const target = targetByLocal.get(row.localFixtureId);
    if (target == null) return false;
    const cutoff = target.decisionAsOf.getTime() - 360 * 60_000;
    const effective = (row.sourceUpdatedAt ?? row.sourceSnapshotAt).getTime();
    return (
      row.sourceSnapshotAt.getTime() >= cutoff &&
      row.sourceSnapshotAt.getTime() <= target.decisionAsOf.getTime() &&
      effective >= cutoff &&
      effective <= target.decisionAsOf.getTime()
    );
  });
  const apiDecisionRows = api.filter((row) => {
    const target = targetByProvider.get(row.providerFixtureId);
    if (target == null) return false;
    const cutoff = target.decisionAsOf.getTime() - 360 * 60_000;
    const effective = (row.sourceUpdatedAt ?? row.observedAt).getTime();
    return effective >= cutoff && effective <= target.decisionAsOf.getTime();
  });

  return {
    externalFixtures: new Set(externalDecisionRows.map((row) => row.localFixtureId)),
    apiFootballFixtures: new Set(apiDecisionRows.map((row) => row.providerFixtureId)),
    externalRows: externalDecisionRows.length,
    apiFootballRows: apiDecisionRows.length,
  };
}

function requestKey(target: HistoricalOddsTarget, asOf: Date): string {
  return `${target.sportKey}|${historicalSnapshotRequestAt(asOf).toISOString()}`;
}

async function plan(): Promise<void> {
  const { runId, targets } = await loadTargets();
  const coverage = await existingCoverage(targets);
  const grouped = new Map<string, { apiLeagueId: number; season: number; leagueName: string; country: string | null; sportKey: string | null; fixtures: number }>();
  for (const target of targets) {
    const key = `${target.providerLeagueId}:${target.season}`;
    const current = grouped.get(key) ?? {
      apiLeagueId: target.providerLeagueId,
      season: target.season,
      leagueName: target.leagueName,
      country: target.country,
      sportKey: target.sportKey || null,
      fixtures: 0,
    };
    current.fixtures += 1;
    grouped.set(key, current);
  }
  const mappedTargets = targets.filter((target) => target.sportKey !== '');
  const missingExternal = mappedTargets.filter((target) => !coverage.externalFixtures.has(target.fixtureId));
  const uniqueDecisionRequests = new Set(missingExternal.map((target) => requestKey(target, target.decisionAsOf)));
  const worstCaseHistoricalCredits = uniqueDecisionRequests.size * 10;
  const output = {
    version: HISTORICAL_REAL_ODDS_BACKFILL_VERSION,
    evidenceClass: 'HISTORICAL_REAL_ODDS_BACKFILL_PLAN_NON_PROMOTIONAL',
    replayRunId: runId,
    horizonMinutes: HISTORICAL_REAL_ODDS_HORIZON_MINUTES,
    replayFixtures: targets.length,
    dateFrom: targets[0]?.kickoffAt.toISOString() ?? null,
    dateTo: targets.at(-1)?.kickoffAt.toISOString() ?? null,
    currentCoverage: {
      apiFootballPitUsableRows: coverage.apiFootballRows,
      apiFootballFixtures: coverage.apiFootballFixtures.size,
      externalPitUsableRows: coverage.externalRows,
      externalFixtures: coverage.externalFixtures.size,
      combinedFixtureCoverage: new Set([
        ...targets.filter((target) => coverage.apiFootballFixtures.has(target.providerFixtureId)).map((target) => target.fixtureId),
        ...coverage.externalFixtures,
      ]).size,
    },
    leagues: [...grouped.values()].sort((a, b) => b.fixtures - a.fixtures || a.apiLeagueId - b.apiLeagueId),
    providerPlan: {
      provider: HISTORICAL_EXTERNAL_ODDS_PROVIDER,
      mappedFixtures: mappedTargets.length,
      unmappedFixtures: targets.length - mappedTargets.length,
      decisionSnapshotsStillNeeded: missingExternal.length,
      uniqueHistoricalApiRequestsEstimate: uniqueDecisionRequests.size,
      region: providerRegion(),
      market: 'h2h',
      estimatedHistoricalCreditsUpperBound: worstCaseHistoricalCredits,
      paidApiCallPerformed: false,
      note: 'Historical endpoint cost is 10 credits per region per market per request. Exact use can be lower after cache/deduplication and provider availability checks.',
    },
    safety: {
      apiFootballHistoricalBackfillAttempted: false,
      externalApiCalled: false,
      databaseWritten: false,
      syntheticOddsUsed: false,
      productionRoutingChanged: false,
      realMoneyExecution: false,
      automaticPromotion: false,
    },
  };
  console.dir(output, { depth: null });
}

async function fetchHistorical(input: {
  apiKey: string;
  sportKey: string;
  asOf: Date;
  region: string;
}): Promise<{ response: TheOddsApiHistoricalResponse; headers: ProviderHeaders; urlWithoutKey: string }> {
  const requestAt = historicalSnapshotRequestAt(input.asOf);
  const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/${encodeURIComponent(input.sportKey)}/odds`);
  url.searchParams.set('apiKey', input.apiKey);
  url.searchParams.set('regions', input.region);
  url.searchParams.set('markets', 'h2h');
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('date', requestAt.toISOString());
  const safe = new URL(url);
  safe.searchParams.set('apiKey', 'REDACTED');
  const result = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await result.text();
  if (!result.ok) throw new Error(`THE_ODDS_API_HTTP_${result.status}: ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text) as TheOddsApiHistoricalResponse;
  if (parsed == null || typeof parsed.timestamp !== 'string' || !Array.isArray(parsed.data)) {
    throw new Error('THE_ODDS_API_INVALID_HISTORICAL_RESPONSE');
  }
  return {
    response: parsed,
    headers: {
      remaining: result.headers.get('x-requests-remaining'),
      used: result.headers.get('x-requests-used'),
      last: result.headers.get('x-requests-last'),
    },
    urlWithoutKey: safe.toString(),
  };
}

function artifactDir(command: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(repoRoot(), 'artifacts', 'historical-odds-backfill', command, stamp);
}

async function probe(): Promise<void> {
  const apiKey = providerApiKey();
  const region = providerRegion();
  const probeLimit = Math.min(10, envInt('HISTORICAL_ODDS_PROBE_LIMIT', 3));
  const { runId, targets } = await loadTargets();
  const mapped = targets.filter((target) => target.sportKey !== '').slice(0, probeLimit);
  if (mapped.length === 0) throw new Error('No replay fixtures have a sport-key mapping. Review 03-historical-odds-plan.cmd and config/historical-odds-sport-map.json.');
  const teamAliases = await aliases();
  const directory = artifactDir('probe');
  await mkdir(directory, { recursive: true });
  const results: JsonRecord[] = [];
  const cache = new Map<string, Awaited<ReturnType<typeof fetchHistorical>>>();
  for (const target of mapped) {
    const key = requestKey(target, target.decisionAsOf);
    let fetched = cache.get(key);
    if (fetched == null) {
      fetched = await fetchHistorical({ apiKey, sportKey: target.sportKey, asOf: target.decisionAsOf, region });
      cache.set(key, fetched);
      const rawHash = sha256Canonical(fetched.response);
      await writeFile(path.join(directory, `${rawHash}.json`), `${JSON.stringify(fetched.response, null, 2)}\n`, 'utf8');
    }
    const match = findStrictHistoricalEvent({ target, events: fetched.response.data, aliases: teamAliases });
    results.push({
      fixtureId: target.fixtureId,
      providerFixtureId: target.providerFixtureId,
      league: target.leagueName,
      sportKey: target.sportKey,
      requestedAsOf: historicalSnapshotRequestAt(target.decisionAsOf).toISOString(),
      providerSnapshotAt: fetched.response.timestamp,
      home: target.homeTeamName,
      away: target.awayTeamName,
      matchStatus: match.status,
      matchedEventId: match.event?.id ?? null,
      matchedBookmakers: match.event?.bookmakers.length ?? 0,
      quota: fetched.headers,
    });
  }
  const summary = {
    version: HISTORICAL_REAL_ODDS_BACKFILL_VERSION,
    command: 'probe',
    replayRunId: runId,
    fixturesProbed: mapped.length,
    uniquePaidApiCalls: cache.size,
    region,
    matches: results.filter((item) => item.matchStatus === 'MATCHED').length,
    noMatches: results.filter((item) => item.matchStatus === 'NO_MATCH').length,
    ambiguous: results.filter((item) => item.matchStatus === 'AMBIGUOUS').length,
    databaseWritten: false,
    artifactDirectory: path.relative(repoRoot(), directory).replaceAll('\\', '/'),
    results,
  };
  await writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.dir(summary, { depth: null });
}

async function persistRows(rows: ReturnType<typeof mapHistoricalSnapshotToRows>): Promise<number> {
  if (rows.length === 0) return 0;
  const result = (await prisma.historicalExternalOddsSnapshot.createMany({ data: rows, skipDuplicates: true })) as { count: number };
  return result.count;
}

async function backfill(mode: 'decision' | 'closing'): Promise<void> {
  const apiKey = providerApiKey();
  const region = providerRegion();
  const limit = envInt('HISTORICAL_ODDS_BACKFILL_LIMIT', 5000);
  const { runId, targets } = await loadTargets();
  const coverage = await existingCoverage(targets);
  const teamAliases = await aliases();
  const candidates = targets
    .filter((target) => target.sportKey !== '')
    .filter((target) => mode === 'closing' || !coverage.externalFixtures.has(target.fixtureId))
    .slice(0, limit);
  if (candidates.length === 0) {
    console.dir({ version: HISTORICAL_REAL_ODDS_BACKFILL_VERSION, command: `backfill-${mode}`, replayRunId: runId, message: 'Nothing to backfill.' }, { depth: null });
    return;
  }
  const maxCalls = envInt('HISTORICAL_ODDS_MAX_PAID_CALLS', mode === 'decision' ? 250 : 250);
  const directory = artifactDir(`backfill-${mode}`);
  await mkdir(path.join(directory, 'raw'), { recursive: true });
  const cache = new Map<string, Awaited<ReturnType<typeof fetchHistorical>>>();
  const manifest: JsonRecord[] = [];
  let rowsInserted = 0;
  let rowsPrepared = 0;
  let matched = 0;
  let noMatch = 0;
  let ambiguous = 0;
  let skippedNoCompleteBookmaker = 0;

  for (const target of candidates) {
    const asOf = mode === 'decision'
      ? target.decisionAsOf
      : new Date(target.kickoffAt.getTime() - HISTORICAL_REAL_ODDS_CLOSING_MINUTES * 60_000);
    const key = requestKey(target, asOf);
    let fetched = cache.get(key);
    if (fetched == null) {
      if (cache.size >= maxCalls) throw new Error(`HISTORICAL_ODDS_MAX_PAID_CALLS_EXCEEDED:${maxCalls}. Increase only after reviewing quota/coverage.`);
      fetched = await fetchHistorical({ apiKey, sportKey: target.sportKey, asOf, region });
      cache.set(key, fetched);
      const rawHash = sha256Canonical(fetched.response);
      await writeFile(path.join(directory, 'raw', `${rawHash}.json`), `${JSON.stringify(fetched.response, null, 2)}\n`, 'utf8');
    }
    const eventMatch = findStrictHistoricalEvent({ target, events: fetched.response.data, aliases: teamAliases });
    if (eventMatch.status === 'NO_MATCH') noMatch += 1;
    if (eventMatch.status === 'AMBIGUOUS') ambiguous += 1;
    if (eventMatch.status !== 'MATCHED' || eventMatch.event == null) {
      manifest.push({ fixtureId: target.fixtureId, providerFixtureId: target.providerFixtureId, sportKey: target.sportKey, mode, matchStatus: eventMatch.status, candidates: eventMatch.candidates });
      continue;
    }
    matched += 1;
    const rawPayloadHash = sha256Canonical(fetched.response);
    const mappedRows = mapHistoricalSnapshotToRows({
      target: { ...target, decisionAsOf: asOf },
      response: fetched.response,
      matchedEvent: eventMatch.event,
      ingestedAt: new Date(),
      rawPayloadHash,
    });
    rowsPrepared += mappedRows.length;
    if (mappedRows.length === 0) skippedNoCompleteBookmaker += 1;
    const inserted = await persistRows(mappedRows);
    rowsInserted += inserted;
    manifest.push({
      fixtureId: target.fixtureId,
      providerFixtureId: target.providerFixtureId,
      sportKey: target.sportKey,
      mode,
      requestedAsOf: historicalSnapshotRequestAt(asOf).toISOString(),
      providerSnapshotAt: fetched.response.timestamp,
      matchStatus: eventMatch.status,
      sourceEventId: eventMatch.event.id,
      bookmakers: eventMatch.event.bookmakers.length,
      rowsPrepared: mappedRows.length,
      rowsInserted: inserted,
      rawPayloadHash,
      quota: fetched.headers,
    });
  }
  const summary = {
    version: HISTORICAL_REAL_ODDS_BACKFILL_VERSION,
    evidenceClass: 'HISTORICAL_REAL_ODDS_EXTERNAL_BACKFILL_APPEND_ONLY',
    command: `backfill-${mode}`,
    replayRunId: runId,
    region,
    fixturesConsidered: candidates.length,
    matched,
    noMatch,
    ambiguous,
    skippedNoCompleteBookmaker,
    uniquePaidApiCalls: cache.size,
    rowsPrepared,
    rowsInserted,
    sourceProvider: HISTORICAL_EXTERNAL_ODDS_PROVIDER,
    syntheticOddsUsed: false,
    apiFootballCalled: false,
    realMoneyExecution: false,
    productionRoutingChanged: false,
    artifactDirectory: path.relative(repoRoot(), directory).replaceAll('\\', '/'),
    manifestHash: sha256Canonical(manifest),
  };
  await writeFile(path.join(directory, 'manifest.jsonl'), `${manifest.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  await writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.dir(summary, { depth: null });
}

async function coverage(): Promise<void> {
  const { runId, targets } = await loadTargets();
  const existing = await existingCoverage(targets);
  const combined = targets.filter((target) => existing.externalFixtures.has(target.fixtureId) || existing.apiFootballFixtures.has(target.providerFixtureId));
  console.dir({
    version: HISTORICAL_REAL_ODDS_BACKFILL_VERSION,
    command: 'coverage',
    replayRunId: runId,
    replayFixtures: targets.length,
    apiFootballFixtures: existing.apiFootballFixtures.size,
    externalFixtures: existing.externalFixtures.size,
    combinedFixtures: combined.length,
    combinedCoverageRate: targets.length === 0 ? null : combined.length / targets.length,
    externalRows: existing.externalRows,
    apiFootballRows: existing.apiFootballRows,
    pitViolationsIntroduced: 0,
    syntheticOddsUsed: false,
  }, { depth: null });
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'plan').trim().toLowerCase();
  if (command === 'plan') return plan();
  if (command === 'probe') return probe();
  if (command === 'backfill-decision') return backfill('decision');
  if (command === 'backfill-closing') return backfill('closing');
  if (command === 'coverage') return coverage();
  throw new Error(`Unsupported command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
