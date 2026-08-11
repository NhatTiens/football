import { prisma } from '@football-ai/database';

function startOfWindow(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

async function revenueSince(db: any, since: Date): Promise<number> {
  const result = await db.paymentOrder.aggregate({
    where: {
      status: 'PAID',
      paidAt: { gte: since },
    },
    _sum: { amountVnd: true },
  });

  return Number(result._sum?.amountVnd ?? 0);
}

export async function loadAdminDashboard(
  db: any = prisma,
  now: Date = new Date(),
) {
  const since1d = startOfWindow(now, 1);
  const since7d = startOfWindow(now, 7);
  const since30d = startOfWindow(now, 30);

  const [
    totalUsers,
    verifiedUsers,
    freeUsers,
    proUsers,
    activeProUsers,
    newUsersToday,
    newUsers7d,
    revenueToday,
    revenue7d,
    revenue30d,
    paidOrders,
    pendingOrders,
    expiredOrders,
    failedWebhookCount,
    recentPayments,
    recentUsers,
  ] = await Promise.all([
    db.authUser.count(),
    db.authUser.count({ where: { emailVerifiedAt: { not: null } } }),
    db.authUser.count({ where: { plan: 'FREE' } }),
    db.authUser.count({ where: { plan: 'PRO' } }),
    db.authUser.count({
      where: { plan: 'PRO', proExpiresAt: { gt: now } },
    }),
    db.authUser.count({ where: { createdAt: { gte: since1d } } }),
    db.authUser.count({ where: { createdAt: { gte: since7d } } }),
    revenueSince(db, since1d),
    revenueSince(db, since7d),
    revenueSince(db, since30d),
    db.paymentOrder.count({ where: { status: 'PAID' } }),
    db.paymentOrder.count({ where: { status: 'PENDING' } }),
    db.paymentOrder.count({ where: { status: 'EXPIRED' } }),
    db.paymentWebhookEvent.count({
      where: {
        OR: [
          { processingStatus: { startsWith: 'REJECTED_' } },
          { processingStatus: 'FAILED' },
        ],
      },
    }),
    db.paymentOrder.findMany({
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 8,
      select: {
        id: true,
        orderCode: true,
        planCode: true,
        amountVnd: true,
        status: true,
        provider: true,
        providerTransactionId: true,
        paidAt: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    }),
    db.authUser.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        plan: true,
        status: true,
        proExpiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    totalUsers,
    verifiedUsers,
    freeUsers,
    proUsers,
    activeProUsers,
    newUsersToday,
    newUsers7d,
    revenueToday,
    revenue7d,
    revenue30d,
    paidOrders,
    pendingOrders,
    expiredOrders,
    failedWebhookCount,
    recentPayments,
    recentUsers,
    systemHealth: { api: 'ok', db: 'ok' },
  };
}

export async function listAdminPayments(
  input: { status?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'; limit?: number },
  db: any = prisma,
) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));

  return db.paymentOrder.findMany({
    where: input.status ? { status: input.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: {
        select: { id: true, email: true, name: true, plan: true },
      },
    },
  });
}

export async function listAdminSubscriptions(
  input: { status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED'; limit?: number },
  db: any = prisma,
) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));

  return db.subscription.findMany({
    where: input.status ? { status: input.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: {
        select: { id: true, email: true, name: true, plan: true, proExpiresAt: true },
      },
      sourcePaymentOrder: {
        select: { id: true, orderCode: true, amountVnd: true, status: true },
      },
    },
  });
}

export async function listAdminWebhooks(
  input: { processingStatus?: string; limit?: number },
  db: any = prisma,
) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));

  return db.paymentWebhookEvent.findMany({
    where: input.processingStatus
      ? { processingStatus: input.processingStatus }
      : undefined,
    orderBy: { receivedAt: 'desc' },
    take: limit,
    include: {
      order: {
        select: {
          id: true,
          orderCode: true,
          status: true,
          amountVnd: true,
          userId: true,
        },
      },
    },
  });
}
