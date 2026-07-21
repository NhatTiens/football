import type { OddsResponse } from '@football-ai/api-football';
import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import { getApiFootballClient } from './client.js';
import { getFixtureHoursAhead } from './config.js';
import { runTrackedSync, trackApiResult, type SyncSummary } from './tracking.js';

interface NormalizedMarket {
  marketCode: 'MATCH_WINNER' | 'TOTAL_GOALS_2_5' | 'BTTS';
  marketName: string;
  marketGroup: string;
  selectionCode: string;
  selectionName: string;
  lineValue: number | null;
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
    if (!match || Number(match[2]) !== 2.5) return null;
    return {
      marketCode: 'TOTAL_GOALS_2_5',
      marketName: 'Goals Over/Under 2.5',
      marketGroup: 'TOTALS',
      selectionCode: match[1]!.toUpperCase(),
      selectionName: value,
      lineValue: 2.5,
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
    const fixtures = await prisma.fixture.findMany({
      where: options.fixtureIds
        ? { id: { in: options.fixtureIds }, status: FixtureStatus.UPCOMING }
        : { status: FixtureStatus.UPCOMING, kickoffAt: { gte: now, lte: maximum } },
      orderBy: { kickoffAt: 'asc' },
    });

    const client = getApiFootballClient();
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
