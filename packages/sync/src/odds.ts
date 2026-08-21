import type { OddsResponse } from '@football-ai/api-football';
import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import { getApiFootballClient } from './client.js';
import { apiFootballTimezone } from './api-football-contract.js';
import { getFixtureHoursAhead } from './config.js';
import {
  apiQuotaAllowsRequest,
  apiQuotaReserveFromEnvironment,
  runTrackedSync,
  trackApiResult,
  type SyncSummary,
} from './tracking.js';

interface NormalizedMarket {
  marketCode: 'MATCH_WINNER' | 'TOTAL_GOALS_2_5' | 'BTTS';
  marketName: string;
  marketGroup: string;
  selectionCode: string;
  selectionName: string;
  lineValue: number | null;
}

/** PREDICTION_AI_V7_QUOTA: max fixtures synced per odds run (default 40). */
function oddsSyncMaxFixtures(): number {
  const parsed = Number(process.env.ODDS_SYNC_MAX_FIXTURES);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 40;
}

function normalizeMarket(betName: string, value: string): NormalizedMarket | null {
  const market = betName.trim().toLowerCase();
  const selection = value.trim().toLowerCase();

  if (market === 'match winner' || market.includes('match winner')) {
    const map: Record<string, string> = { home: 'HOME', draw: 'DRAW', away: 'AWAY' };
    const selectionCode = map[selection];
    if (!selectionCode) return null;
    return {
      marketCode: 'MATCH_WINNER',
      marketName: 'Match Winner',
      marketGroup: 'RESULT',
      selectionCode,
      selectionName: value,
      lineValue: null,
    };
  }

  if (market.includes('goals over/under') || market.includes('over/under')) {
    const match = selection.match(/(over|under)\s*([0-9.]+)/i);
    if (!match) return null;
    const lineValue = Number(match[2]);
    if (!Number.isFinite(lineValue) || lineValue < 0) return null;
    return {
      marketCode: 'TOTAL_GOALS_2_5',
      marketName: `Goals Over/Under ${lineValue}`,
      marketGroup: 'TOTALS',
      selectionCode: match[1]!.toUpperCase(),
      selectionName: value,
      lineValue,
    };
  }

  if (market.includes('both teams score')) {
    const selectionCode = selection === 'yes' ? 'YES' : selection === 'no' ? 'NO' : undefined;
    if (!selectionCode) return null;
    return {
      marketCode: 'BTTS',
      marketName: 'Both Teams To Score',
      marketGroup: 'GOALS',
      selectionCode,
      selectionName: value,
      lineValue: null,
    };
  }

  return null;
}

async function saveOddsResponse(
  fixtureId: number,
  item: OddsResponse,
): Promise<{ processed: number; inserted: number }> {
  let processed = 0;
  let inserted = 0;
  const apiUpdatedAt = item.update ? new Date(item.update) : undefined;

  for (const bookmakerEntry of item.bookmakers ?? []) {
    const bookmaker = await prisma.bookmaker.upsert({
      where: { apiBookmakerId: bookmakerEntry.id },
      update: { name: bookmakerEntry.name },
      create: { apiBookmakerId: bookmakerEntry.id, name: bookmakerEntry.name },
    });

    for (const bet of bookmakerEntry.bets ?? []) {
      for (const value of bet.values ?? []) {
        const normalized = normalizeMarket(bet.name, value.value);
        const decimalOdds = Number(value.odd);
        if (!normalized || !Number.isFinite(decimalOdds) || decimalOdds <= 1) continue;
        processed += 1;

        const market = await prisma.bettingMarket.upsert({
          where: { marketCode: normalized.marketCode },
          update: {
            apiBetId: bet.id,
            name: normalized.marketName,
            marketGroup: normalized.marketGroup,
            lineValue: normalized.lineValue,
          },
          create: {
            apiBetId: bet.id,
            marketCode: normalized.marketCode,
            name: normalized.marketName,
            marketGroup: normalized.marketGroup,
            lineValue: normalized.lineValue,
          },
        });

        const previous = await prisma.oddsSnapshot.findFirst({
          where: {
            fixtureId,
            bookmakerId: bookmaker.id,
            marketId: market.id,
            selectionCode: normalized.selectionCode,
            lineValue: normalized.lineValue,
          },
          orderBy: { capturedAt: 'desc' },
        });

        if (
          previous &&
          Math.abs(previous.decimalOdds - decimalOdds) < 0.0001 &&
          (!apiUpdatedAt || previous.apiUpdatedAt?.getTime() === apiUpdatedAt.getTime())
        ) {
          continue;
        }

        await prisma.oddsSnapshot.create({
          data: {
            fixtureId,
            bookmakerId: bookmaker.id,
            marketId: market.id,
            selectionCode: normalized.selectionCode,
            selectionName: normalized.selectionName,
            lineValue: normalized.lineValue,
            decimalOdds,
            apiUpdatedAt,
            capturedAt: new Date(),
            rawPayload: value as unknown as InputJsonValue,
          },
        });
        inserted += 1;
      }
    }
  }

  return { processed, inserted };
}

export async function syncOdds(options: { fixtureIds?: number[] } = {}): Promise<SyncSummary> {
  return runTrackedSync('sync-odds', async () => {
    const now = new Date();
    const maximum = new Date(now.getTime() + getFixtureHoursAhead() * 3_600_000);

    // PREDICTION_AI_V7_QUOTA: protect the daily request budget. When the
    // remaining quota is at or below the reserve, skip this run (odds refresh
    // can wait) unless an explicit fixture list was requested.
    const reserve = apiQuotaReserveFromEnvironment();
    if (options.fixtureIds == null && !(await apiQuotaAllowsRequest(reserve))) {
      return {
        processed: 0,
        inserted: 0,
        updated: 0,
        metadata: { skipped: 'QUOTA_RESERVE', minimumRemaining: reserve },
      };
    }

    const client = getApiFootballClient();

    // PREDICTION_AI_V7_QUOTA: scheduled runs use the BULK-BY-DATE path — one
    // request per date returns odds for every fixture that day (paginated).
    // This replaces N per-fixture calls (92+) with ~4-8 calls total per run.
    // Manual runs with explicit fixtureIds keep the per-fixture path.
    if (options.fixtureIds == null) {
      return syncOddsByDate({ client, now });
    }

    const fixtures = await prisma.fixture.findMany({
      where: { id: { in: options.fixtureIds }, status: FixtureStatus.UPCOMING },
      orderBy: { kickoffAt: 'asc' },
      take: oddsSyncMaxFixtures(),
    });

    let processed = 0;
    let inserted = 0;

    for (const fixture of fixtures) {
      let page = 1;
      let totalPages = 1;
      do {
        const result = await client.getOdds({ fixture: fixture.apiFixtureId, page });
        await trackApiResult(`odds?page=${page}`, result);
        totalPages = Math.max(1, result.paging.total);
        for (const item of result.data) {
          const summary = await saveOddsResponse(fixture.id, item);
          processed += summary.processed;
          inserted += summary.inserted;
        }
        page += 1;
      } while (page <= totalPages);
    }

    return { processed, inserted, updated: 0, metadata: { fixtures: fixtures.length } };
  });
}

/** PREDICTION_AI_V7_QUOTA: number of future dates covered by a bulk odds run. */
function oddsSyncDaysAhead(): number {
  const parsed = Number(process.env.ODDS_SYNC_DAYS_AHEAD);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 4;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

interface BulkOddsClient {
  getOdds(params: {
    date?: string;
    timezone?: string;
    page?: number;
  }): Promise<
    import('@football-ai/api-football').ApiFootballResult<
      import('@football-ai/api-football').OddsResponse
    >
  >;
}

/**
 * PREDICTION_AI_V7_QUOTA: fetch odds for all upcoming fixtures using the
 * /odds?date=YYYY-MM-DD endpoint — 1-2 requests per date instead of one
 * request per fixture. Only odds for fixtures already in our database are
 * persisted; the rest are skipped (no phantom fixtures created).
 */
async function syncOddsByDate(input: { client: BulkOddsClient; now: Date }): Promise<SyncSummary> {
  const daysAhead = oddsSyncDaysAhead();
  const dates: string[] = [];
  for (let offset = 0; offset < daysAhead; offset += 1) {
    dates.push(dateOnly(addDays(input.now, offset)));
  }

  // Preload our known upcoming fixtures (apiFixtureId -> internal id).
  const maximum = new Date(input.now.getTime() + getFixtureHoursAhead() * 3_600_000);
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: FixtureStatus.UPCOMING,
      kickoffAt: { gte: input.now, lte: maximum },
    },
    select: { id: true, apiFixtureId: true },
  });
  const knownById = new Map<number, number>(
    fixtures.map((fixture: { id: number; apiFixtureId: number }) => [
      fixture.apiFixtureId,
      fixture.id,
    ]),
  );

  let processed = 0;
  let inserted = 0;
  for (const date of dates) {
    let page = 1;
    let totalPages = 1;
    do {
      const result = await input.client.getOdds({
        date,
        timezone: apiFootballTimezone(),
        page,
      });
      await trackApiResult(`odds?date=${date}`, result);
      totalPages = Math.max(1, result.paging.total);
      for (const item of result.data) {
        const fixtureId = knownById.get(item.fixture.id);
        if (fixtureId == null) continue; // only persist odds for known fixtures
        const summary = await saveOddsResponse(fixtureId, item);
        processed += summary.processed;
        inserted += summary.inserted;
      }
      page += 1;
    } while (page <= totalPages);
  }

  return {
    processed,
    inserted,
    updated: 0,
    metadata: { mode: 'DATE_BULK', dates, knownFixtures: fixtures.length },
  };
}
