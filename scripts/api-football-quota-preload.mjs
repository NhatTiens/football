const INSTALL_KEY = Symbol.for('football-ai.api-football-quota-preload.v6');

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  let prismaPromise = null;

  function getPrisma() {
    prismaPromise ??= import('@football-ai/database').then((module) => module.prisma);
    return prismaPromise;
  }

  function integerEnv(name, fallback, minimum, maximum) {
    const parsed = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function quotaDateUtc(now = new Date()) {
    return now.toISOString().slice(0, 10);
  }

  function startOfUtcDay(now = new Date()) {
    return new Date(`${quotaDateUtc(now)}T00:00:00.000Z`);
  }

  function requestUrl(input) {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    return null;
  }

  function providerBaseUrl() {
    return new URL(process.env.API_FOOTBALL_BASE_URL ?? 'https://v3.football.api-sports.io');
  }

  function isApiFootballRequest(url) {
    if (!url) return false;
    const base = providerBaseUrl();
    return url.protocol === base.protocol && url.host === base.host;
  }

  function priorityFor(url) {
    if ((process.env.HISTORY_RESULT_WORKER_OWNER ?? '').toLowerCase() === 'true') {
      return 'CRITICAL';
    }
    if (url.pathname.endsWith('/fixtures') && url.searchParams.has('id')) return 'HIGH';
    if (url.pathname.includes('/predictions')) return 'HIGH';
    if (url.pathname.includes('/odds')) return 'NORMAL';
    return 'NORMAL';
  }

  function priorityFloor(priority) {
    if (priority === 'CRITICAL') return 0;
    if (priority === 'HIGH') return 100;
    if (priority === 'LOW') return 750;
    return 250;
  }

  async function ensureDailyQuotaRow(prisma, quotaDate, dailyLimit) {
    const existing = await prisma.apiQuotaDaily.findUnique({ where: { quotaDate } });
    if (existing) {
      if (existing.dailyLimit !== dailyLimit) {
        const used = Math.min(existing.used, dailyLimit);
        return prisma.apiQuotaDaily.update({
          where: { quotaDate },
          data: { dailyLimit, used, remaining: Math.max(0, dailyLimit - used) },
        });
      }
      return existing;
    }

    // Seed from the existing request audit when possible so enabling the manager
    // mid-day does not incorrectly assume that zero calls were already consumed.
    let alreadyObserved = 0;
    try {
      alreadyObserved = await prisma.apiUsage.count({
        where: { requestDate: { gte: startOfUtcDay() } },
      });
    } catch {
      // ApiUsage is best-effort historical evidence. The hard counter below is
      // still authoritative after the first ApiQuotaDaily row is created.
    }

    const used = Math.min(alreadyObserved, dailyLimit);
    try {
      return await prisma.apiQuotaDaily.create({
        data: {
          quotaDate,
          dailyLimit,
          used,
          remaining: Math.max(0, dailyLimit - used),
        },
      });
    } catch (error) {
      // Another process may have won the create race.
      const raced = await prisma.apiQuotaDaily.findUnique({ where: { quotaDate } });
      if (raced) return raced;
      throw error;
    }
  }

  async function handOffLegacyResultPolling(prisma, url) {
    if ((process.env.HISTORY_RESULT_WORKER_OWNER ?? '').toLowerCase() === 'true') return;
    const exclusiveMode =
      (process.env.HISTORY_RESULT_EXCLUSIVE_MODE ?? 'true').toLowerCase() === 'true';
    if (!exclusiveMode || !url.pathname.endsWith('/fixtures')) return;
    // In the safe launcher, the durable result worker exclusively owns
    // /fixtures?id= result checks for fixtures with an open stored BEST_BET.
    // Other endpoints (odds, lineups, predictions, date/league fixture sync)
    // are unaffected.

    const fixtureIdText = url.searchParams.get('id');
    if (!fixtureIdText || !/^\d+$/.test(fixtureIdText)) return;

    const providerFixtureId = Number(fixtureIdText);
    const openDecision = await prisma.scientificPaperBetDecision.findFirst({
      where: { providerFixtureId, decisionType: 'BEST_BET', settlement: null },
      select: { kickoffAt: true },
      orderBy: { kickoffAt: 'asc' },
    });
    if (!openDecision) return;

    const firstCheckMinutes = integerEnv(
      'PAPER_BET_RESULT_MINUTES_AFTER_KICKOFF',
      105,
      100,
      110,
    );
    const maxAttempts = integerEnv('PAPER_BET_RESULT_MAX_ATTEMPTS', 12, 1, 48);
    const dueAt = new Date(openDecision.kickoffAt.getTime() + firstCheckMinutes * 60_000);

    await prisma.resultUpdateJob.upsert({
      where: { providerFixtureId },
      create: {
        providerFixtureId,
        kickoffAt: openDecision.kickoffAt,
        status: 'PENDING',
        attempts: 0,
        maxAttempts,
        nextCheckAt: dueAt,
      },
      update: {},
    });

    throw new Error(
      `[history-result-owned] Fixture ${providerFixtureId} result polling is owned by the durable history result worker.`,
    );
  }

  async function reserveQuota(prisma, url) {
    const quotaDate = quotaDateUtc();
    const dailyLimit = integerEnv('API_FOOTBALL_DAILY_LIMIT', 7500, 1, 7500);
    const priority = priorityFor(url);
    const floor = priorityFloor(priority);

    await ensureDailyQuotaRow(prisma, quotaDate, dailyLimit);

    const reservation = await prisma.apiQuotaDaily.updateMany({
      where: {
        quotaDate,
        dailyLimit,
        used: { lt: dailyLimit },
        remaining: { gt: floor },
      },
      data: {
        used: { increment: 1 },
        remaining: { decrement: 1 },
      },
    });

    const snapshot = await prisma.apiQuotaDaily.findUnique({ where: { quotaDate } });
    if (reservation.count !== 1 || !snapshot) {
      const remaining = snapshot?.remaining ?? 0;
      throw new Error(
        `[api-football-quota] BLOCKED priority=${priority} used=${snapshot?.used ?? dailyLimit} remaining=${remaining} limit=${dailyLimit} endpoint=${url.pathname}`,
      );
    }

    console.info(
      `[api-football-quota] date=${quotaDate} used=${snapshot.used} remaining=${snapshot.remaining} limit=${snapshot.dailyLimit} priority=${priority} endpoint=${url.pathname}`,
    );
  }

  globalThis.fetch = async function quotaManagedFetch(input, init) {
    const url = requestUrl(input);
    if (!isApiFootballRequest(url)) {
      return originalFetch(input, init);
    }

    const prisma = await getPrisma();
    await handOffLegacyResultPolling(prisma, url);
    await reserveQuota(prisma, url);
    return originalFetch(input, init);
  };
}
