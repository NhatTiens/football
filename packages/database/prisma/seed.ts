import { FixtureStatus, PrismaClient } from '../src/index.js';

const prisma = new PrismaClient();

const teams = [
  { apiTeamId: 50, name: 'Manchester City', code: 'MCI', attack: 1.28, defense: 1.18 },
  { apiTeamId: 40, name: 'Liverpool', code: 'LIV', attack: 1.24, defense: 1.13 },
  { apiTeamId: 42, name: 'Arsenal', code: 'ARS', attack: 1.2, defense: 1.16 },
  { apiTeamId: 49, name: 'Chelsea', code: 'CHE', attack: 1.08, defense: 1.02 },
  { apiTeamId: 47, name: 'Tottenham', code: 'TOT', attack: 1.12, defense: 0.96 },
  { apiTeamId: 33, name: 'Manchester United', code: 'MUN', attack: 1.04, defense: 0.98 },
  { apiTeamId: 34, name: 'Newcastle', code: 'NEW', attack: 1.09, defense: 1.01 },
  { apiTeamId: 66, name: 'Aston Villa', code: 'AVL', attack: 1.1, defense: 1.0 },
];

function seeded(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function samplePoisson(lambda: number, index: number, salt: number): number {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  while (product > limit && count < 9) {
    count += 1;
    product *= Math.max(0.0001, seeded(index + count, salt));
  }
  return Math.max(0, count - 1);
}

function normalize(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function matchProbabilities(homeStrength: number, awayStrength: number): [number, number, number] {
  const difference = homeStrength + 0.12 - awayStrength;
  const home = 1 / (1 + Math.exp(-difference * 2.1));
  const draw = Math.max(0.18, 0.27 - Math.abs(difference) * 0.06);
  const away = 1 - home;
  return normalize([home * (1 - draw), draw, away * (1 - draw)]) as [number, number, number];
}

function decimalOdds(probability: number, margin = 1.06, boost = 1): number {
  return Number(Math.max(1.05, (1 / (probability * margin)) * boost).toFixed(2));
}

function historicalDate(index: number, total: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (total - index) * 3 - 20);
  date.setUTCHours(15 + (index % 5), 0, 0, 0);
  return date;
}

function futureDate(days: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function createOdds(input: {
  fixtureId: number;
  kickoffAt: Date;
  fixtureIndex: number;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  overProbability: number;
  bttsProbability: number;
  bookmakers: Array<{ id: number }>;
  marketIds: { winner: number; total: number; btts: number };
}): Promise<void> {
  for (let bookmakerIndex = 0; bookmakerIndex < input.bookmakers.length; bookmakerIndex += 1) {
    const bookmaker = input.bookmakers[bookmakerIndex]!;
    const capturedAt = new Date(
      input.kickoffAt.getTime() - (90 - bookmakerIndex * 15) * 60_000,
    );
    const featuredSelection = (input.fixtureIndex + bookmakerIndex) % 7;
    const boost = (selectionIndex: number) => (featuredSelection === selectionIndex ? 1.1 : 1);
    const noise = 0.98 + seeded(input.fixtureIndex, bookmakerIndex + 31) * 0.04;

    const rows = [
      [input.marketIds.winner, 'HOME', 'Home', null, decimalOdds(input.homeProbability, 1.06, boost(0) * noise)],
      [input.marketIds.winner, 'DRAW', 'Draw', null, decimalOdds(input.drawProbability, 1.06, boost(1) * noise)],
      [input.marketIds.winner, 'AWAY', 'Away', null, decimalOdds(input.awayProbability, 1.06, boost(2) * noise)],
      [input.marketIds.total, 'OVER', 'Over 2.5', 2.5, decimalOdds(input.overProbability, 1.055, boost(3) * noise)],
      [input.marketIds.total, 'UNDER', 'Under 2.5', 2.5, decimalOdds(1 - input.overProbability, 1.055, boost(4) * noise)],
      [input.marketIds.btts, 'YES', 'Yes', null, decimalOdds(input.bttsProbability, 1.055, boost(5) * noise)],
      [input.marketIds.btts, 'NO', 'No', null, decimalOdds(1 - input.bttsProbability, 1.055, boost(6) * noise)],
    ] as const;

    for (const [marketId, selectionCode, selectionName, lineValue, odds] of rows) {
      await prisma.oddsSnapshot.create({
        data: {
          fixtureId: input.fixtureId,
          bookmakerId: bookmaker.id,
          marketId,
          selectionCode,
          selectionName,
          lineValue,
          decimalOdds: odds,
          capturedAt,
          apiUpdatedAt: capturedAt,
        },
      });
    }
  }
}


function demoPlayerPosition(index: number): string {
  if (index === 0 || index === 13) return 'G';
  if ([1, 2, 3, 4, 12, 14].includes(index)) return 'D';
  if ([5, 6, 7, 15, 16].includes(index)) return 'M';
  return 'F';
}

function demoGrid(position: string, order: number): string | null {
  if (position === 'G') return '1:1';
  if (position === 'D') return `2:${Math.max(1, Math.min(4, order))}`;
  if (position === 'M') return `3:${Math.max(1, Math.min(3, order))}`;
  if (position === 'F') return `4:${Math.max(1, Math.min(3, order))}`;
  return null;
}

async function createDemoLineup(input: {
  fixtureId: number;
  teamId: number;
  kickoffAt: Date;
  fixtureIndex: number;
  players: Array<{ id: number; name: string; defaultPosition: string | null }>;
  sideSalt: number;
}): Promise<void> {
  const starterIndexes = Array.from({ length: 11 }, (_, index) => index);
  if ((input.fixtureIndex + input.sideSalt) % 4 === 0) starterIndexes[10] = 11;
  if ((input.fixtureIndex + input.sideSalt) % 5 === 0) starterIndexes[4] = 12;
  if ((input.fixtureIndex + input.sideSalt) % 9 === 0) starterIndexes[0] = 13;

  const starterSet = new Set(starterIndexes);
  const substituteIndexes = input.players
    .map((_, index) => index)
    .filter((index) => !starterSet.has(index))
    .slice(0, 7);
  const capturedAt = new Date(input.kickoffAt.getTime() - 70 * 60_000);

  await prisma.fixtureLineupSnapshot.create({
    data: {
      fixtureId: input.fixtureId,
      teamId: input.teamId,
      formation: '4-3-3',
      coachName: 'Demo Coach',
      isConfirmed: true,
      starterCount: 11,
      substituteCount: substituteIndexes.length,
      contentHash: `demo-${input.fixtureId}-${input.teamId}-${starterIndexes.join('-')}`,
      capturedAt,
      rawPayload: { demo: true },
      players: {
        create: [
          ...starterIndexes.map((playerIndex, order) => {
            const player = input.players[playerIndex]!;
            const position = player.defaultPosition ?? demoPlayerPosition(playerIndex);
            const positionOrder =
              starterIndexes
                .slice(0, order + 1)
                .map((index) => input.players[index]!.defaultPosition ?? demoPlayerPosition(index))
                .filter((value) => value === position).length;
            return {
              playerId: player.id,
              isStarter: true,
              shirtNumber: playerIndex + 1,
              position,
              grid: demoGrid(position, positionOrder),
              lineupOrder: order + 1,
            };
          }),
          ...substituteIndexes.map((playerIndex, order) => {
            const player = input.players[playerIndex]!;
            return {
              playerId: player.id,
              isStarter: false,
              shirtNumber: playerIndex + 1,
              position: player.defaultPosition ?? demoPlayerPosition(playerIndex),
              grid: null,
              lineupOrder: order + 1,
            };
          }),
        ],
      },
    },
  });
}

async function main(): Promise<void> {
  await prisma.backtestBet.deleteMany();
  await prisma.backtestRun.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.oddsSnapshot.deleteMany();
  await prisma.externalPrediction.deleteMany();
  await prisma.fixtureLineupPlayer.deleteMany();
  await prisma.fixtureLineupSnapshot.deleteMany();
  await prisma.player.deleteMany();
  await prisma.fixture.deleteMany();
  await prisma.bettingMarket.deleteMany();
  await prisma.bookmaker.deleteMany();
  await prisma.team.deleteMany();
  await prisma.league.deleteMany();

  const league = await prisma.league.create({
    data: {
      apiLeagueId: 39,
      season: 2025,
      name: 'Premier League Demo',
      country: 'England',
      enabled: true,
      coverage: { fixtures: true, odds: true, predictions: true, injuries: true },
    },
  });

  const createdTeams = [];
  for (const team of teams) {
    createdTeams.push(
      await prisma.team.create({
        data: {
          apiTeamId: team.apiTeamId,
          name: team.name,
          code: team.code,
          country: 'England',
          venueName: `${team.name} Stadium`,
        },
      }),
    );
  }

  const teamPlayers = new Map<number, Array<{ id: number; name: string; defaultPosition: string | null }>>();
  for (let teamIndex = 0; teamIndex < createdTeams.length; teamIndex += 1) {
    const team = createdTeams[teamIndex]!;
    const profile = teams[teamIndex]!;
    const players = [];
    for (let playerIndex = 0; playerIndex < 18; playerIndex += 1) {
      const position = demoPlayerPosition(playerIndex);
      players.push(
        await prisma.player.create({
          data: {
            apiPlayerId: profile.apiTeamId * 1000 + playerIndex + 1,
            name: `${profile.code} Player ${playerIndex + 1}`,
            defaultPosition: position,
          },
        }),
      );
    }
    teamPlayers.set(team.id, players);
  }

  const bookmakers = [];
  for (const bookmaker of [
    { apiBookmakerId: 1, name: 'DemoBook A' },
    { apiBookmakerId: 2, name: 'DemoBook B' },
    { apiBookmakerId: 3, name: 'DemoBook C' },
  ]) {
    bookmakers.push(await prisma.bookmaker.create({ data: bookmaker }));
  }

  const matchWinner = await prisma.bettingMarket.create({
    data: { apiBetId: 1, marketCode: 'MATCH_WINNER', name: '1X2', marketGroup: 'POPULAR' },
  });
  const totalGoals = await prisma.bettingMarket.create({
    data: { apiBetId: 5, marketCode: 'TOTAL_GOALS_2_5', name: 'Total Goals 2.5', marketGroup: 'TOTAL', lineValue: 2.5 },
  });
  const btts = await prisma.bettingMarket.create({
    data: { apiBetId: 8, marketCode: 'BTTS', name: 'Both Teams To Score', marketGroup: 'GOALS' },
  });
  const marketIds = { winner: matchWinner.id, total: totalGoals.id, btts: btts.id };

  let apiFixtureId = 9_000_000;
  const historicalCount = 120;
  for (let index = 0; index < historicalCount; index += 1) {
    const homeIndex = index % createdTeams.length;
    let awayIndex = (index * 5 + 3) % createdTeams.length;
    if (awayIndex === homeIndex) awayIndex = (awayIndex + 1) % createdTeams.length;
    const homeProfile = teams[homeIndex]!;
    const awayProfile = teams[awayIndex]!;
    const kickoffAt = historicalDate(index, historicalCount);
    const lambdaHome = 1.42 * homeProfile.attack / awayProfile.defense;
    const lambdaAway = 1.12 * awayProfile.attack / homeProfile.defense;
    const homeGoals = samplePoisson(lambdaHome, index, 101);
    const awayGoals = samplePoisson(lambdaAway, index, 211);
    const fixture = await prisma.fixture.create({
      data: {
        apiFixtureId: apiFixtureId++,
        leagueId: league.id,
        homeTeamId: createdTeams[homeIndex]!.id,
        awayTeamId: createdTeams[awayIndex]!.id,
        kickoffAt,
        round: `Demo Round ${index + 1}`,
        venueName: `${homeProfile.name} Stadium`,
        status: FixtureStatus.FINISHED,
        apiStatusShort: 'FT',
        homeGoals,
        awayGoals,
      },
    });
    const [homeProbability, drawProbability, awayProbability] = matchProbabilities(
      homeProfile.attack * homeProfile.defense,
      awayProfile.attack * awayProfile.defense,
    );
    const expectedTotal = lambdaHome + lambdaAway;
    const overProbability = Math.min(0.78, Math.max(0.3, 0.42 + (expectedTotal - 2.35) * 0.18));
    const bttsProbability = Math.min(0.75, Math.max(0.32, 0.46 + (expectedTotal - 2.35) * 0.12));

    await createOdds({
      fixtureId: fixture.id,
      kickoffAt,
      fixtureIndex: index,
      homeProbability,
      drawProbability,
      awayProbability,
      overProbability,
      bttsProbability,
      bookmakers,
      marketIds,
    });
    await prisma.externalPrediction.create({
      data: {
        fixtureId: fixture.id,
        homeProbability: Math.min(0.9, Math.max(0.05, homeProbability + (seeded(index, 41) - 0.5) * 0.06)),
        drawProbability,
        awayProbability: Math.min(0.9, Math.max(0.05, awayProbability + (seeded(index, 43) - 0.5) * 0.06)),
        advice: 'Dữ liệu dự đoán mô phỏng dùng để kiểm thử point-in-time backtest.',
        predictedWinner: homeProbability >= awayProbability ? 'Home' : 'Away',
        capturedAt: new Date(kickoffAt.getTime() - 10 * 3_600_000),
      },
    });
    await createDemoLineup({
      fixtureId: fixture.id,
      teamId: fixture.homeTeamId,
      kickoffAt,
      fixtureIndex: index,
      players: teamPlayers.get(fixture.homeTeamId)!,
      sideSalt: 1,
    });
    await createDemoLineup({
      fixtureId: fixture.id,
      teamId: fixture.awayTeamId,
      kickoffAt,
      fixtureIndex: index,
      players: teamPlayers.get(fixture.awayTeamId)!,
      sideSalt: 3,
    });
  }

  const upcomingPairs = [[0, 1], [2, 3], [4, 5], [6, 7]] as const;
  for (let index = 0; index < upcomingPairs.length; index += 1) {
    const [homeIndex, awayIndex] = upcomingPairs[index]!;
    const homeProfile = teams[homeIndex]!;
    const awayProfile = teams[awayIndex]!;
    const kickoffAt = futureDate(index + 1, 18 + index);
    const fixture = await prisma.fixture.create({
      data: {
        apiFixtureId: apiFixtureId++,
        leagueId: league.id,
        homeTeamId: createdTeams[homeIndex]!.id,
        awayTeamId: createdTeams[awayIndex]!.id,
        kickoffAt,
        round: `Demo Upcoming ${index + 1}`,
        venueName: `${homeProfile.name} Stadium`,
        status: FixtureStatus.UPCOMING,
        apiStatusShort: 'NS',
      },
    });
    const [homeProbability, drawProbability, awayProbability] = matchProbabilities(
      homeProfile.attack * homeProfile.defense,
      awayProfile.attack * awayProfile.defense,
    );
    const expectedTotal = 1.42 * homeProfile.attack / awayProfile.defense + 1.12 * awayProfile.attack / homeProfile.defense;
    await createOdds({
      fixtureId: fixture.id,
      kickoffAt,
      fixtureIndex: historicalCount + index,
      homeProbability,
      drawProbability,
      awayProbability,
      overProbability: Math.min(0.78, Math.max(0.3, 0.42 + (expectedTotal - 2.35) * 0.18)),
      bttsProbability: Math.min(0.75, Math.max(0.32, 0.46 + (expectedTotal - 2.35) * 0.12)),
      bookmakers,
      marketIds,
    });
    await prisma.externalPrediction.create({
      data: {
        fixtureId: fixture.id,
        homeProbability,
        drawProbability,
        awayProbability,
        advice: 'Dự đoán mô phỏng cho giao diện demo.',
        predictedWinner: homeProbability >= awayProbability ? 'Home' : 'Away',
        capturedAt: new Date(kickoffAt.getTime() - 10 * 3_600_000),
      },
    });
    await createDemoLineup({
      fixtureId: fixture.id,
      teamId: fixture.homeTeamId,
      kickoffAt,
      fixtureIndex: historicalCount + index,
      players: teamPlayers.get(fixture.homeTeamId)!,
      sideSalt: 1,
    });
    await createDemoLineup({
      fixtureId: fixture.id,
      teamId: fixture.awayTeamId,
      kickoffAt,
      fixtureIndex: historicalCount + index,
      players: teamPlayers.get(fixture.awayTeamId)!,
      sideSalt: 3,
    });
  }

  await prisma.appSetting.upsert({
    where: { key: 'demo_mode' },
    update: { value: true },
    create: { key: 'demo_mode', value: true },
  });

  console.log(`Seeded ${historicalCount} completed fixtures, odds, confirmed lineups, and ${upcomingPairs.length} upcoming fixtures.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
