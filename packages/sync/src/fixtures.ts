import type { FixtureResponse } from '@football-ai/api-football';
import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import { getApiFootballClient } from './client.js';
import { parseLeagueConfigurations } from './config.js';
import { runTrackedSync, trackApiResult, type SyncSummary } from './tracking.js';

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function mapFixtureStatus(shortStatus?: string): FixtureStatus {
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(shortStatus ?? '')) {
    return FixtureStatus.LIVE;
  }
  if (['FT', 'AET', 'PEN'].includes(shortStatus ?? '')) return FixtureStatus.FINISHED;
  if (['PST', 'TBD'].includes(shortStatus ?? '')) return FixtureStatus.POSTPONED;
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(shortStatus ?? '')) return FixtureStatus.CANCELLED;
  return FixtureStatus.UPCOMING;
}

async function upsertFixture(item: FixtureResponse): Promise<'inserted' | 'updated'> {
  const league = await prisma.league.upsert({
    where: {
      apiLeagueId_season: {
        apiLeagueId: item.league.id,
        season: item.league.season,
      },
    },
    update: {
      name: item.league.name,
      country: item.league.country,
      logoUrl: item.league.logo,
    },
    create: {
      apiLeagueId: item.league.id,
      season: item.league.season,
      name: item.league.name,
      country: item.league.country,
      logoUrl: item.league.logo,
    },
  });

  const [homeTeam, awayTeam] = await Promise.all([
    prisma.team.upsert({
      where: { apiTeamId: item.teams.home.id },
      update: { name: item.teams.home.name, logoUrl: item.teams.home.logo },
      create: {
        apiTeamId: item.teams.home.id,
        name: item.teams.home.name,
        logoUrl: item.teams.home.logo,
      },
    }),
    prisma.team.upsert({
      where: { apiTeamId: item.teams.away.id },
      update: { name: item.teams.away.name, logoUrl: item.teams.away.logo },
      create: {
        apiTeamId: item.teams.away.id,
        name: item.teams.away.name,
        logoUrl: item.teams.away.logo,
      },
    }),
  ]);

  const existing = await prisma.fixture.findUnique({ where: { apiFixtureId: item.fixture.id } });
  const data = {
    leagueId: league.id,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    kickoffAt: new Date(item.fixture.date),
    timezone: item.fixture.timezone,
    round: item.league.round,
    venueName: item.fixture.venue?.name,
    referee: item.fixture.referee,
    status: mapFixtureStatus(item.fixture.status.short),
    apiStatusShort: item.fixture.status.short,
    elapsedMinutes: item.fixture.status.elapsed,
    homeGoals: item.goals.home,
    awayGoals: item.goals.away,
    halftimeHomeGoals: item.score?.halftime?.home,
    halftimeAwayGoals: item.score?.halftime?.away,
    rawPayload: item as unknown as InputJsonValue,
  };

  await prisma.fixture.upsert({
    where: { apiFixtureId: item.fixture.id },
    update: data,
    create: { apiFixtureId: item.fixture.id, ...data },
  });
  return existing ? 'updated' : 'inserted';
}

export async function syncFixtures(options: {
  from?: string;
  to?: string;
  leagueConfigurations?: Array<{ leagueId: number; season: number }>;
} = {}): Promise<SyncSummary> {
  return runTrackedSync('sync-fixtures', async () => {
    const client = getApiFootballClient();
    const now = new Date();
    const from =
      options.from ?? process.env.API_FOOTBALL_FIXTURES_FROM ?? dateOnly(addDays(now, -7));
    const to =
      options.to ?? process.env.API_FOOTBALL_FIXTURES_TO ?? dateOnly(addDays(now, 10));
    const configurations = options.leagueConfigurations ?? parseLeagueConfigurations();
    if (configurations.length === 0) {
      throw new Error('Configure API_FOOTBALL_LEAGUES before running fixture sync.');
    }

    let processed = 0;
    let inserted = 0;
    let updated = 0;

    for (const configuration of configurations) {
      const leagueResult = await client.getLeagues({
        id: configuration.leagueId,
        season: configuration.season,
      });
      await trackApiResult('leagues', leagueResult);
      const leagueEntry = leagueResult.data[0];
      const seasonEntry = leagueEntry?.seasons?.find((season) => season.year === configuration.season);
      if (leagueEntry) {
        await prisma.league.upsert({
          where: {
            apiLeagueId_season: {
              apiLeagueId: configuration.leagueId,
              season: configuration.season,
            },
          },
          update: {
            name: leagueEntry.league.name,
            country: leagueEntry.country?.name,
            logoUrl: leagueEntry.league.logo,
            coverage: seasonEntry?.coverage as InputJsonValue | undefined,
          },
          create: {
            apiLeagueId: configuration.leagueId,
            season: configuration.season,
            name: leagueEntry.league.name,
            country: leagueEntry.country?.name,
            logoUrl: leagueEntry.league.logo,
            coverage: seasonEntry?.coverage as InputJsonValue | undefined,
          },
        });
      }

      const result = await client.getFixtures({
        league: configuration.leagueId,
        season: configuration.season,
        from,
        to,
        timezone: process.env.API_FOOTBALL_TIMEZONE ?? 'UTC',
      });
      await trackApiResult('fixtures', result);
      for (const item of result.data) {
        processed += 1;
        const action = await upsertFixture(item);
        if (action === 'inserted') inserted += 1;
        else updated += 1;
      }
    }

    return {
      processed,
      inserted,
      updated,
      metadata: { from, to, leagues: configurations.length },
    };
  });
}
