import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import {
  BacktestStatus,
  FixtureStatus,
  prisma,
  RecommendationStatus,
  SettlementResult,
} from '@football-ai/database';
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
import {
  answerAdvancedPredictionChat,
  detectAdvancedPredictionChatIntent,
  predictionChatCapabilities,
  getPersonalUpcomingAnalysis,
  refreshPersonalUpcomingAnalysis,
} from '@football-ai/sync';
import { env } from './env.js';
import { constantTimeSecretEquals, sensitiveNoStore } from './security.js';
import {
  globalMarketScopeMiddleware,
  isExplicitMatchWinnerQuestion,
  isMatchWinnerMarket,
  sanitizeGlobalMarketPayload,
} from './global-market-scope.js';
import { authRouter } from './auth-routes.js';
import { accountBillingRouter, billingRouter } from './billing-routes.js';
import { resolveAuthContext, roleCanAccessIntent } from './auth.js';
import { consumeUsage, getFeatureForChatIntent } from './auth-usage.js';
import { openApiDocument } from './openapi.js'; import { getScientificDashboard } from './scientific-dashboard.js';
import { scientificRouter } from './scientific-routes.js';
import { fixtureSummary, recommendationDto } from './serializers.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
const allowedOrigins = env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);
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
  if (!constantTimeSecretEquals(token, env.ADMIN_API_TOKEN)) {
    response.status(401).json({ error: 'Invalid admin token.' });
    return;
  }
  next();
}

async function requireBacktestResearchAccess(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const auth = await resolveAuthContext(request);

  if (!auth.authenticated || !auth.user) {
    response.status(401).json({ error: 'Please sign in to access Backtest.' });
    return;
  }

  if (auth.user.status !== 'ACTIVE') {
    response.status(403).json({ error: 'Active verified account required.' });
    return;
  }

  if (auth.user.role !== 'ANALYST' && auth.user.role !== 'ADMIN') {
    response.status(403).json({
      error: 'Backtest is restricted to internal research roles.',
      requiredRole: 'ANALYST_OR_ADMIN',
      role: auth.user.role,
      plan: auth.user.plan,
    });
    return;
  }

  next();
}

// GLOBAL_MATCH_WINNER_HIDDEN_V2
app.use('/api', globalMarketScopeMiddleware);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(['/api/auth', '/api/account', '/api/admin', '/api/billing'], sensitiveNoStore);
app.use('/api/auth', authRouter);
app.use('/api/billing', billingRouter);
app.use('/api/account', accountBillingRouter);
// Keep billing-specific /api/account routes first; authRouter supplies
// /api/account/usage, profile/sessions and /api/admin/* compatibility paths.
app.use('/api', authRouter);

// BACKTEST_INTERNAL_ACCESS_V1
// PRO is a commercial plan; it never grants research Backtest access.
app.use('/api/backtests', sensitiveNoStore, asyncRoute(requireBacktestResearchAccess));
app.use('/api/backtest', sensitiveNoStore, asyncRoute(requireBacktestResearchAccess));

app.get(
  '/api/stats',
  asyncRoute(async (_request, response) => {
    const now = new Date();
    const [upcomingFixtures, activeRecommendations, settled, apiUsage, lastSyncRuns] =
      await Promise.all([
        prisma.fixture.count({
          where: { status: FixtureStatus.UPCOMING, kickoffAt: { gte: now } },
        }),
        prisma.recommendation.count({
          where: {
            status: RecommendationStatus.ACTIVE,
            expiresAt: { gt: now },
            marketCode: { notIn: ['MATCH_WINNER', 'HDA', '1X2'] },
          },
        }),
        prisma.recommendation.findMany({
          where: { status: RecommendationStatus.SETTLED },
          select: { settlementResult: true, simulatedProfitUnits: true },
        }),
        prisma.apiUsage.findFirst({ orderBy: { requestDate: 'desc' } }),
        prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
      ]);
    const settledRows = settled as Array<{
      settlementResult: string;
      simulatedProfitUnits: number | null;
    }>;
    const wins = settledRows.filter((row) => row.settlementResult === SettlementResult.WIN).length;
    const losses = settledRows.filter(
      (row) => row.settlementResult === SettlementResult.LOSS,
    ).length;
    const profitUnits = settledRows.reduce(
      (sum: number, row) => sum + (row.simulatedProfitUnits ?? 0),
      0,
    );
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


app.post(
  '/api/backtests/run',
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    const requestedLeagueIds = Array.isArray(body.leagueIds)
      ? [
          ...new Set(
            body.leagueIds
              .map((value: unknown) => Number(value))
              .filter((value: number) => Number.isInteger(value) && value > 0),
          ),
        ]
      : [];

    if (requestedLeagueIds.length > 16) {
      response.status(400).json({ error: 'Maximum 16 leagues per personal backtest request.' });
      return;
    }

    const targetLeagueIds = requestedLeagueIds.length > 0 ? requestedLeagueIds : [null];
    const runs: Array<{
      id: number;
      name: string;
      leagueId: number | null;
      leagueName: string | null;
    }> = [];

    for (const targetLeagueId of targetLeagueIds) {
      const league =
        typeof targetLeagueId === 'number'
          ? await prisma.league.findUnique({
              where: { id: targetLeagueId },
              select: { id: true, name: true },
            })
          : null;

      if (typeof targetLeagueId === 'number' && !league) {
        response.status(400).json({ error: 'Unknown league id: ' + targetLeagueId });
        return;
      }

      const run = await runBacktest({
        name:
          typeof body.name === 'string'
            ? body.name
            : 'Personal Backtest' +
              (league?.name ? ' · ' + league.name : ' · All leagues') +
              ' · ' +
              String(body.from ?? '') +
              ' → ' +
              String(body.to ?? ''),
        leagueId: typeof targetLeagueId === 'number' ? targetLeagueId : undefined,
        from: body.from,
        to: body.to,
        fixtureLimit: body.fixtureLimit ? Number(body.fixtureLimit) : undefined,
        stakeUnits: body.stakeUnits ? Number(body.stakeUnits) : undefined,
        rules: body.rules && typeof body.rules === 'object' ? body.rules : undefined,
      });

      runs.push({
        id: run.id,
        name: run.name,
        leagueId: typeof targetLeagueId === 'number' ? targetLeagueId : null,
        leagueName: league?.name ?? null,
      });
    }

    response.status(201).json({
      mode: 'PERSONAL',
      adminTokenRequired: false,
      runs,
      safety: {
        realMoneyExecution: false,
        automaticBetPlacement: false,
      },
    });
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
      typeof stakingConfig.bankrollCurrency === 'string' ? stakingConfig.bankrollCurrency : null;

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
    const bets: BacktestMoneyBet[] = run.bets.map((bet: any): BacktestMoneyBet => ({
      ...bet,
      stakeAmount: unitAmount == null ? null : bet.stakeUnits * unitAmount,
      profitAmount: unitAmount == null ? null : bet.profitUnits * unitAmount,
      stakeCurrency,
    }));

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
      hitRate: group.wins + group.losses > 0 ? group.wins / (group.wins + group.losses) : null,
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
        : bets.reduce((sum: number, bet: BacktestMoneyBet) => sum + (bet.stakeAmount ?? 0), 0);
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

app.use('/api/scientific', scientificRouter);

app.get( '/api/scientific/dashboard', asyncRoute(async (_request, response) => { response.json(await getScientificDashboard(prisma as any)); }), ); 

app.get(
  '/api/backtest/leagues',
  asyncRoute(async (_request, response) => {
    type PersonalLeagueCoverageBase = {
      id: number;
      apiLeagueId: number;
      name: string;
      country: string | null;
      season: number;
      logoUrl: string | null;
    };
    type PersonalLeagueCount = {
      leagueId: number;
      _count: { _all: number };
    };
    type PersonalLeagueCoverage = PersonalLeagueCoverageBase & {
      finishedFixtures: number;
      upcomingFixtures: number;
    };

    const leagues = (await prisma.league.findMany({
      where: { enabled: true },
      orderBy: [{ country: 'asc' }, { name: 'asc' }, { season: 'desc' }],
      select: {
        id: true,
        apiLeagueId: true,
        name: true,
        country: true,
        season: true,
        logoUrl: true,
      },
    })) as PersonalLeagueCoverageBase[];

    const finished = (await prisma.fixture.groupBy({
      by: ['leagueId'],
      where: { status: FixtureStatus.FINISHED },
      _count: { _all: true },
    })) as PersonalLeagueCount[];

    const upcoming = (await prisma.fixture.groupBy({
      by: ['leagueId'],
      where: {
        status: FixtureStatus.UPCOMING,
        kickoffAt: { gt: new Date() },
      },
      _count: { _all: true },
    })) as PersonalLeagueCount[];

    const finishedMap = new Map<number, number>(
      finished.map(
        (row: PersonalLeagueCount): [number, number] => [row.leagueId, row._count._all],
      ),
    );
    const upcomingMap = new Map<number, number>(
      upcoming.map(
        (row: PersonalLeagueCount): [number, number] => [row.leagueId, row._count._all],
      ),
    );

    const data: PersonalLeagueCoverage[] = leagues
      .map(
        (league: PersonalLeagueCoverageBase): PersonalLeagueCoverage => ({
          ...league,
          finishedFixtures: finishedMap.get(league.id) ?? 0,
          upcomingFixtures: upcomingMap.get(league.id) ?? 0,
        }),
      )
      .sort(
        (left: PersonalLeagueCoverage, right: PersonalLeagueCoverage): number =>
          right.finishedFixtures - left.finishedFixtures ||
          right.upcomingFixtures - left.upcomingFixtures ||
          left.name.localeCompare(right.name),
      );

    response.json({ data });
  }),
);


app.get(
  '/api/backtest/leagues',
  asyncRoute(async (_request, response) => {
    type PersonalLeagueCoverageBase = {
      id: number;
      apiLeagueId: number;
      name: string;
      country: string | null;
      season: number;
      logoUrl: string | null;
    };
    type PersonalLeagueCount = {
      leagueId: number;
      _count: { _all: number };
    };
    type PersonalLeagueCoverage = PersonalLeagueCoverageBase & {
      finishedFixtures: number;
      upcomingFixtures: number;
    };

    const leagues = (await prisma.league.findMany({
      where: { enabled: true },
      orderBy: [{ country: 'asc' }, { name: 'asc' }, { season: 'desc' }],
      select: {
        id: true,
        apiLeagueId: true,
        name: true,
        country: true,
        season: true,
        logoUrl: true,
      },
    })) as PersonalLeagueCoverageBase[];

    const finished = (await prisma.fixture.groupBy({
      by: ['leagueId'],
      where: { status: FixtureStatus.FINISHED },
      _count: { _all: true },
    })) as PersonalLeagueCount[];

    const upcoming = (await prisma.fixture.groupBy({
      by: ['leagueId'],
      where: {
        status: FixtureStatus.UPCOMING,
        kickoffAt: { gt: new Date() },
      },
      _count: { _all: true },
    })) as PersonalLeagueCount[];

    const finishedMap = new Map<number, number>(
      finished.map(
        (row: PersonalLeagueCount): [number, number] => [row.leagueId, row._count._all],
      ),
    );
    const upcomingMap = new Map<number, number>(
      upcoming.map(
        (row: PersonalLeagueCount): [number, number] => [row.leagueId, row._count._all],
      ),
    );

    const data: PersonalLeagueCoverage[] = leagues
      .map(
        (league: PersonalLeagueCoverageBase): PersonalLeagueCoverage => ({
          ...league,
          finishedFixtures: finishedMap.get(league.id) ?? 0,
          upcomingFixtures: upcomingMap.get(league.id) ?? 0,
        }),
      )
      .sort(
        (left: PersonalLeagueCoverage, right: PersonalLeagueCoverage): number =>
          right.finishedFixtures - left.finishedFixtures ||
          right.upcomingFixtures - left.upcomingFixtures ||
          left.name.localeCompare(right.name),
      );

    response.json({ data });
  }),
);

app.get(
  '/api/personal/upcoming-analysis',
  asyncRoute(async (request, response) => {
    const leagueIds =
      typeof request.query.leagueIds === 'string'
        ? request.query.leagueIds
            .split(',')
            .map((value: string) => Number(value))
            .filter((value: number) => Number.isInteger(value) && value > 0)
        : undefined;

    response.json(
      await getPersonalUpcomingAnalysis({
        days: request.query.days ? Number(request.query.days) : undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        leagueIds,
      }),
    );
  }),
);

app.post(
  '/api/personal/upcoming/refresh',
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    const allowedGroups = new Set([
      'ASEAN',
      'WAFCON',
      'UCL',
      'UEFA_EUROPA',
      'SEA',
      'ASIA',
      'EPL',
      'LALIGA',
    ]);

    const groups = Array.isArray(body.groups)
      ? body.groups
          .map((value: unknown) => String(value).toUpperCase())
          .filter((value: string) => allowedGroups.has(value))
      : [
          'WAFCON',
          'UCL',
          'UEFA_EUROPA',
          'ASEAN',
          'SEA',
          'ASIA',
          'EPL',
          'LALIGA',
        ];

    response.json(
      await refreshPersonalUpcomingAnalysis({
        days: body.days ? Number(body.days) : undefined,
        groups: groups as Array<
          | 'ASEAN'
          | 'WAFCON'
          | 'UCL'
          | 'UEFA_EUROPA'
          | 'SEA'
          | 'ASIA'
          | 'EPL'
          | 'LALIGA'
        >,
      }),
    );
  }),
);

app.get('/api/personal/prediction-chat/capabilities', (_request, response) => {
  response.json(predictionChatCapabilities);
});

app.post(
  '/api/personal/prediction-chat',
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Quá nhiều câu hỏi chatbot. Vui lòng thử lại sau một phút.' },
  }),
  asyncRoute(async (request, response) => {
    const auth = await resolveAuthContext(request);
    if (!auth.authenticated || !auth.user) {
      response.status(401).json({ error: 'Please sign in to use the chatbot.' });
      return;
    }
    if (auth.user.status !== 'ACTIVE') {
      response.status(403).json({ error: 'Email verification required.' });
      return;
    }

    const message =
      typeof request.body?.message === 'string' ? request.body.message.trim() : '';

    if (message.length === 0) {
      response.status(400).json({ error: 'Vui lòng nhập tên trận hoặc câu hỏi dự đoán.' });
      return;
    }
    if (message.length > 240) {
      response.status(400).json({ error: 'Câu hỏi tối đa 240 ký tự.' });
      return;
    }

    // GLOBAL_MARKET_SCOPE_CHAT_BLOCK_V2
    if (isExplicitMatchWinnerQuestion(message)) {
      response.status(422).json({
        error: 'Tính năng này đang tạm ẩn. Hệ thống hiện chỉ hiển thị BTTS và Over/Under.',
        visibleMarkets: ['BTTS', 'O/U 1.5', 'O/U 2.5', 'O/U 3.5'],
      });
      return;
    }

    const intent = detectAdvancedPredictionChatIntent(message);
    if (!roleCanAccessIntent(auth.user.role, intent, auth.user.plan, auth.user.proExpiresAt ? new Date(auth.user.proExpiresAt) : null)) {
      response.status(403).json({
        error: 'This question requires a PRO account.',
        requiredRole: 'PRO',
        role: auth.user.role,
        intent,
      });
      return;
    }

    const result = await answerAdvancedPredictionChat({
      message,
      context: request.body?.context,
      days: 14,
      limit: 300,
    });

    const hiddenRecommendation =
      result?.answer?.recommendation?.marketType != null &&
      isMatchWinnerMarket(result.answer.recommendation.marketType);
    const globallyScopedResult = sanitizeGlobalMarketPayload(result) as typeof result;

    const usage = await consumeUsage({
      userId: auth.user.id,
      plan: auth.user.plan,
      feature: getFeatureForChatIntent(intent),
    });

    response.json({
      ...globallyScopedResult,
      message:
        intent === 'PREDICTION' || hiddenRecommendation
          ? 'Hệ thống hiện chỉ hiển thị phân tích BTTS và Over/Under cho trận này.'
          : globallyScopedResult.message,
      quota: usage.usage,
    });
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
    message:
      process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
  });
});
