import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { BacktestStatus, FixtureStatus, prisma, RecommendationStatus, SettlementResult } from '@football-ai/database';
import {
  generateRecommendations,
  getFixtureLineupAnalysis,
  getLineupAnalysisRules,
  getLineupHistoryLookback,
  runBacktest,
  settleRecommendations,
  syncFixtures,
  syncOdds,
  syncLineups,
  syncPredictions,
} from '@football-ai/sync';
import { env } from './env.js';
import { openApiDocument } from './openapi.js';
import { fixtureSummary, recommendationDto } from './serializers.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()) }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp());
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }),
);

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  const token = request.header('x-admin-token');
  if (token !== env.ADMIN_API_TOKEN) {
    response.status(401).json({ error: 'Invalid admin token.' });
    return;
  }
  next();
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get(
  '/api/stats',
  asyncRoute(async (_request, response) => {
    const now = new Date();
    const [upcomingFixtures, activeRecommendations, settled, apiUsage, lastSyncRuns] = await Promise.all([
      prisma.fixture.count({ where: { status: FixtureStatus.UPCOMING, kickoffAt: { gte: now } } }),
      prisma.recommendation.count({ where: { status: RecommendationStatus.ACTIVE, expiresAt: { gt: now } } }),
      prisma.recommendation.findMany({
        where: { status: RecommendationStatus.SETTLED },
        select: { settlementResult: true, simulatedProfitUnits: true },
      }),
      prisma.apiUsage.findFirst({ orderBy: { requestDate: 'desc' } }),
      prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
    ]);
    const settledRows = settled as Array<{ settlementResult: string; simulatedProfitUnits: number | null }>;
    const wins = settledRows.filter((row) => row.settlementResult === SettlementResult.WIN).length;
    const losses = settledRows.filter((row) => row.settlementResult === SettlementResult.LOSS).length;
    const profitUnits = settledRows.reduce((sum: number, row) => sum + (row.simulatedProfitUnits ?? 0), 0);
    const settledBets = wins + losses;

    response.json({
      upcomingFixtures,
      activeRecommendations,
      settledRecommendations: settledRows.length,
      wins,
      losses,
      hitRate: settledBets > 0 ? wins / settledBets : null,
      simulatedProfitUnits: profitUnits,
      yield: settledBets > 0 ? profitUnits / settledBets : null,
      latestApiQuota: apiUsage
        ? {
            dailyRemaining: apiUsage.dailyRemaining,
            dailyLimit: apiUsage.dailyLimit,
            minuteRemaining: apiUsage.minuteRemaining,
            minuteLimit: apiUsage.minuteLimit,
          }
        : null,
      lastSyncRuns,
    });
  }),
);

app.get(
  '/api/fixtures',
  asyncRoute(async (request, response) => {
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    const status = request.query.status ? String(request.query.status) : undefined;
    const leagueId = request.query.leagueId ? Number(request.query.leagueId) : undefined;
    const date = request.query.date ? String(request.query.date) : undefined;
    const start = date ? new Date(`${date}T00:00:00.000Z`) : undefined;
    const end = start ? new Date(start.getTime() + 86_400_000) : undefined;

    const fixtures = await prisma.fixture.findMany({
      where: {
        ...(status && Object.values(FixtureStatus).includes(status as FixtureStatus)
          ? { status: status as FixtureStatus }
          : {}),
        ...(leagueId ? { leagueId } : {}),
        ...(start && end ? { kickoffAt: { gte: start, lt: end } } : {}),
      },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true,
        _count: { select: { recommendations: { where: { status: RecommendationStatus.ACTIVE } } } },
      },
      orderBy: { kickoffAt: 'asc' },
      take: limit,
    });

    response.json({ data: fixtures.map(fixtureSummary) });
  }),
);

app.get(
  '/api/fixtures/:id',
  asyncRoute(async (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      response.status(400).json({ error: 'Invalid fixture id.' });
      return;
    }
    const fixture = await prisma.fixture.findUnique({
      where: { id },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true,
        externalPrediction: true,
        oddsSnapshots: {
          include: { bookmaker: true, market: true },
          orderBy: { capturedAt: 'desc' },
          take: 200,
        },
        lineupSnapshots: {
          include: {
            team: true,
            players: {
              include: { player: true },
              orderBy: [{ isStarter: 'desc' }, { lineupOrder: 'asc' }],
            },
          },
          orderBy: { capturedAt: 'desc' },
          take: 20,
        },
        recommendations: {
          include: { bookmaker: true },
          orderBy: [{ status: 'asc' }, { rankNumber: 'asc' }],
        },
      },
    });
    if (!fixture) {
      response.status(404).json({ error: 'Fixture not found.' });
      return;
    }

    const latestOdds = new Map<string, (typeof fixture.oddsSnapshots)[number]>();
    for (const row of fixture.oddsSnapshots) {
      const key = `${row.bookmakerId}:${row.marketId}:${row.selectionCode}:${row.lineValue ?? ''}`;
      if (!latestOdds.has(key)) latestOdds.set(key, row);
    }

    const latestLineups = new Map<number, (typeof fixture.lineupSnapshots)[number]>();
    for (const row of fixture.lineupSnapshots) {
      if (!latestLineups.has(row.teamId)) latestLineups.set(row.teamId, row);
    }
    const lineupAnalysis = await getFixtureLineupAnalysis({
      fixtureId: fixture.id,
      homeTeamId: fixture.homeTeamId,
      homeTeamName: fixture.homeTeam.name,
      awayTeamId: fixture.awayTeamId,
      awayTeamName: fixture.awayTeam.name,
      kickoffAt: fixture.kickoffAt,
      asOf: new Date(),
      historyLookback: getLineupHistoryLookback(),
      rules: getLineupAnalysisRules(),
    });

    response.json({
      ...fixtureSummary(fixture),
      referee: fixture.referee,
      externalPrediction: fixture.externalPrediction,
      latestOdds: [...latestOdds.values()].map((row) => ({
        id: row.id,
        bookmaker: row.bookmaker.name,
        marketCode: row.market.marketCode,
        marketName: row.market.name,
        selectionCode: row.selectionCode,
        selectionName: row.selectionName,
        lineValue: row.lineValue,
        odds: row.decimalOdds,
        capturedAt: row.capturedAt,
      })),
      lineups: [...latestLineups.values()].map((lineup: any) => ({
        id: lineup.id,
        team: { id: lineup.team.id, name: lineup.team.name },
        formation: lineup.formation,
        coachName: lineup.coachName,
        isConfirmed: lineup.isConfirmed,
        starterCount: lineup.starterCount,
        substituteCount: lineup.substituteCount,
        capturedAt: lineup.capturedAt,
        starters: lineup.players
          .filter((entry: any) => entry.isStarter)
          .map((entry: any) => ({
            id: entry.player.id,
            apiPlayerId: entry.player.apiPlayerId,
            name: entry.player.name,
            shirtNumber: entry.shirtNumber,
            position: entry.position,
            grid: entry.grid,
          })),
        substitutes: lineup.players
          .filter((entry: any) => !entry.isStarter)
          .map((entry: any) => ({
            id: entry.player.id,
            apiPlayerId: entry.player.apiPlayerId,
            name: entry.player.name,
            shirtNumber: entry.shirtNumber,
            position: entry.position,
            grid: entry.grid,
          })),
      })),
      lineupAnalysis,
      recommendations: fixture.recommendations.map(recommendationDto),
    });
  }),
);

app.get(
  '/api/recommendations',
  asyncRoute(async (request, response) => {
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    const requestedStatus = String(request.query.status ?? 'ACTIVE');
    const status = Object.values(RecommendationStatus).includes(
      requestedStatus as RecommendationStatus,
    )
      ? (requestedStatus as RecommendationStatus)
      : RecommendationStatus.ACTIVE;
    const recommendations = await prisma.recommendation.findMany({
      where: {
        status,
        ...(status === RecommendationStatus.ACTIVE ? { expiresAt: { gt: new Date() } } : {}),
      },
      include: {
        bookmaker: true,
        fixture: { include: { league: true, homeTeam: true, awayTeam: true } },
      },
      orderBy: [{ recommendationScore: 'desc' }, { generatedAt: 'desc' }],
      take: limit,
    });
    response.json({ data: recommendations.map(recommendationDto) });
  }),
);


app.get(
  '/api/leagues',
  asyncRoute(async (_request, response) => {
    const leagues = await prisma.league.findMany({
      orderBy: [{ country: 'asc' }, { name: 'asc' }, { season: 'desc' }],
    });
    response.json({ data: leagues });
  }),
);

app.get(
  '/api/backtests',
  asyncRoute(async (request, response) => {
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 20)));
    const runs = await prisma.backtestRun.findMany({
      include: { league: true },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    response.json({ data: runs });
  }),
);

app.get(
  '/api/backtests/latest',
  asyncRoute(async (_request, response) => {
    const run = await prisma.backtestRun.findFirst({
      where: { status: BacktestStatus.SUCCESS },
      include: { league: true },
      orderBy: { finishedAt: 'desc' },
    });
    response.json(run);
  }),
);

app.get(
  '/api/backtests/:id',
  asyncRoute(async (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      response.status(400).json({ error: 'Invalid backtest id.' });
      return;
    }
    const run = await prisma.backtestRun.findUnique({
      where: { id },
      include: {
        league: true,
        bets: {
          include: {
            bookmaker: true,
            fixture: { include: { league: true, homeTeam: true, awayTeam: true } },
          },
          orderBy: [{ kickoffAt: 'asc' }, { rankNumber: 'asc' }],
        },
      },
    });
    if (!run) {
      response.status(404).json({ error: 'Backtest not found.' });
      return;
    }

    // PREDICTION_AI_V622_BACKTEST_MONEY_DTO
    const rulesRecord =
      run.rules && typeof run.rules === 'object' && !Array.isArray(run.rules)
        ? (run.rules as unknown as Record<string, unknown>)
        : {};
    const stakingConfigValue = rulesRecord.stakingConfig;
    const stakingConfig =
      stakingConfigValue &&
      typeof stakingConfigValue === 'object' &&
      !Array.isArray(stakingConfigValue)
        ? (stakingConfigValue as unknown as Record<string, unknown>)
        : {};
    const bankrollAmount = Number(stakingConfig.bankrollAmount);
    const bankrollUnits = Number(stakingConfig.bankrollUnits);
    const unitAmount =
      Number.isFinite(bankrollAmount) &&
      bankrollAmount > 0 &&
      Number.isFinite(bankrollUnits) &&
      bankrollUnits > 0
        ? bankrollAmount / bankrollUnits
        : null;
    const stakeCurrency =
      typeof stakingConfig.bankrollCurrency === 'string'
        ? stakingConfig.bankrollCurrency
        : null;

    // PREDICTION_AI_V623_API_STRICT_TYPES
    type BacktestMoneyBet = {
      marketCode: string;
      settlementResult: SettlementResult;
      profitUnits: number;
      stakeUnits: number;
      decimalOdds: number;
      kickoffAt: Date;
      stakeAmount: number | null;
      profitAmount: number | null;
      stakeCurrency: string | null;
      [key: string]: unknown;
    };
    type MarketAggregate = {
      marketCode: string;
      bets: number;
      wins: number;
      losses: number;
      pushes: number;
      profitUnits: number;
      stakeUnits: number;
      stakeAmount: number;
      profitAmount: number;
      odds: number[];
    };
    const bets: BacktestMoneyBet[] = run.bets.map(
      (bet: any): BacktestMoneyBet => ({
      ...bet,
      stakeAmount: unitAmount == null ? null : bet.stakeUnits * unitAmount,
      profitAmount: unitAmount == null ? null : bet.profitUnits * unitAmount,
      stakeCurrency,
      }),
    );

    const marketMap = new Map<string, MarketAggregate>();
    const equityCurve: Array<{ index: number; kickoffAt: Date; equity: number }> = [];
    let equity = 0;
    for (const bet of bets) {
      const group: MarketAggregate = marketMap.get(bet.marketCode) ?? {
        marketCode: bet.marketCode,
        bets: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        profitUnits: 0,
        stakeUnits: 0,
        stakeAmount: 0,
        profitAmount: 0,
        odds: [] as number[],
      };
      group.bets += 1;
      if (bet.settlementResult === SettlementResult.WIN) group.wins += 1;
      else if (bet.settlementResult === SettlementResult.LOSS) group.losses += 1;
      else if (bet.settlementResult === SettlementResult.PUSH) group.pushes += 1;
      group.profitUnits += bet.profitUnits;
      group.stakeUnits += bet.stakeUnits;
      group.stakeAmount += bet.stakeAmount ?? 0;
      group.profitAmount += bet.profitAmount ?? 0;
      group.odds.push(bet.decimalOdds);
      marketMap.set(bet.marketCode, group);
      equity += bet.profitUnits;
      equityCurve.push({ index: equityCurve.length + 1, kickoffAt: bet.kickoffAt, equity });
    }
    const byMarket = [...marketMap.values()].map((group) => ({
      marketCode: group.marketCode,
      bets: group.bets,
      wins: group.wins,
      losses: group.losses,
      pushes: group.pushes,
      hitRate:
        group.wins + group.losses > 0
          ? group.wins / (group.wins + group.losses)
          : null,
      profitUnits: group.profitUnits,
      stakeUnits: group.stakeUnits,
      stakeAmount: unitAmount == null ? null : group.stakeAmount,
      profitAmount: unitAmount == null ? null : group.profitAmount,
      stakeCurrency,
      roi: group.stakeUnits > 0 ? group.profitUnits / group.stakeUnits : null,
      averageOdds:
        group.odds.length > 0
          ? group.odds.reduce((sum, value) => sum + value, 0) / group.odds.length
          : null,
    }));
    const totalStakeUnits = bets.reduce(
      (sum: number, bet: BacktestMoneyBet) => sum + bet.stakeUnits,
      0,
    );
    const totalStakeAmount =
      unitAmount == null
        ? null
        : bets.reduce(
            (sum: number, bet: BacktestMoneyBet) => sum + (bet.stakeAmount ?? 0),
            0,
          );
    const profitAmount = unitAmount == null ? null : run.profitUnits * unitAmount;
    response.json({
      ...run,
      bets,
      byMarket,
      equityCurve,
      totalStakeUnits,
      totalStakeAmount,
      profitAmount,
      stakeCurrency,
    });
  }),
);

app.post(
  '/api/admin/backtests/run',
  requireAdmin,
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    const result = await runBacktest({
      name: typeof body.name === 'string' ? body.name : undefined,
      leagueId: body.leagueId ? Number(body.leagueId) : undefined,
      from: body.from,
      to: body.to,
      fixtureLimit: body.fixtureLimit ? Number(body.fixtureLimit) : undefined,
      stakeUnits: body.stakeUnits ? Number(body.stakeUnits) : undefined,
      rules: body.rules && typeof body.rules === 'object' ? body.rules : undefined,
    });
    response.status(201).json(result);
  }),
);

app.post(
  '/api/admin/sync/fixtures',
  requireAdmin,
  asyncRoute(async (request, response) => {
    const result = await syncFixtures({ from: request.body?.from, to: request.body?.to });
    response.json(result);
  }),
);

app.post(
  '/api/admin/sync/odds',
  requireAdmin,
  asyncRoute(async (_request, response) => {
    response.json(await syncOdds());
  }),
);

app.post(
  '/api/admin/sync/lineups',
  requireAdmin,
  asyncRoute(async (request, response) => {
    response.json(
      await syncLineups({
        fixtureIds: Array.isArray(request.body?.fixtureIds)
          ? request.body.fixtureIds.map(Number).filter(Number.isInteger)
          : undefined,
        includeHistory: Boolean(request.body?.includeHistory),
      }),
    );
  }),
);

app.post(
  '/api/admin/sync/predictions',
  requireAdmin,
  asyncRoute(async (_request, response) => {
    response.json(await syncPredictions());
  }),
);

app.post(
  '/api/admin/recommendations/generate',
  requireAdmin,
  asyncRoute(async (_request, response) => {
    response.json(await generateRecommendations());
  }),
);

app.post(
  '/api/admin/recommendations/settle',
  requireAdmin,
  asyncRoute(async (_request, response) => {
    response.json(await settleRecommendations());
  }),
);

app.get('/api/openapi.json', (_request, response) => response.json(openApiDocument));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.use((_request, response) => {
  response.status(404).json({ error: 'Route not found.' });
});

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  request.log?.error(error);
  response.status(500).json({
    error: 'Internal server error.',
    message: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
  });
});
