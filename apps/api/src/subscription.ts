import { prisma } from '@football-ai/database';

import { env } from './env.js';

type SubscriptionDb = {
  authUser: any;
  subscription: any;
};

export type ProLifecycleState = {
  userId: number;
  plan: string;
  proExpiresAt: Date | null;
  expiredSubscriptions: number;
};

export type AppliedProEntitlement = {
  userId: number;
  startsAt: Date;
  expiresAt: Date;
  subscriptionId: number;
  previousPlan: string;
  previousProExpiresAt: Date | null;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export async function reconcileSubscriptionLifecycle(
  userId: number,
  db: SubscriptionDb = prisma as unknown as SubscriptionDb,
  now: Date = new Date(),
): Promise<ProLifecycleState | null> {
  const expired = await db.subscription.updateMany({
    where: {
      userId,
      status: 'ACTIVE',
      expiresAt: { lte: now },
    },
    data: {
      status: 'EXPIRED',
    },
  });

  let user = await db.authUser.findUnique({
    where: { id: userId },
  });

  if (!user) return null;

  const expiry =
    user.proExpiresAt instanceof Date
      ? user.proExpiresAt
      : user.proExpiresAt
        ? new Date(user.proExpiresAt)
        : null;

  if (
    user.plan === 'PRO' &&
    (!expiry || expiry.getTime() <= now.getTime())
  ) {
    user = await db.authUser.update({
      where: { id: userId },
      data: {
        plan: 'FREE',
        proExpiresAt: null,
      },
    });
  } else if (user.plan !== 'PRO' && expiry) {
    // A FREE/non-PRO account must never retain a stale entitlement timestamp.
    user = await db.authUser.update({
      where: { id: userId },
      data: {
        proExpiresAt: null,
      },
    });
  }

  return {
    userId,
    plan: user.plan,
    proExpiresAt: user.proExpiresAt ?? null,
    expiredSubscriptions: Number(expired.count ?? 0),
  };
}

export async function applyPaidProEntitlement(
  input: {
    userId: number;
    sourcePaymentOrderId: number;
    provider: string;
    externalTransactionId: string;
    now?: Date;
  },
  db: SubscriptionDb = prisma as unknown as SubscriptionDb,
): Promise<AppliedProEntitlement> {
  const now = input.now ?? new Date();

  await reconcileSubscriptionLifecycle(input.userId, db, now);

  const user = await db.authUser.findUnique({
    where: { id: input.userId },
  });

  if (!user) {
    throw new Error(`Cannot apply PRO entitlement: user ${input.userId} not found.`);
  }

  const currentExpiry =
    user.proExpiresAt instanceof Date
      ? user.proExpiresAt
      : user.proExpiresAt
        ? new Date(user.proExpiresAt)
        : null;

  const activeExpiry =
    user.plan === 'PRO' &&
    currentExpiry &&
    currentExpiry.getTime() > now.getTime()
      ? currentExpiry
      : null;

  const startsAt = activeExpiry ?? now;
  const expiresAt = addDays(startsAt, env.PRO_PLAN_DAYS);

  const subscription = await db.subscription.create({
    data: {
      userId: user.id,
      planCode: 'PRO',
      status: 'ACTIVE',
      startsAt,
      expiresAt,
      sourcePaymentOrderId: input.sourcePaymentOrderId,
      metadata: {
        provider: input.provider,
        externalTransactionId: input.externalTransactionId,
        proPlanDays: env.PRO_PLAN_DAYS,
      },
    },
  });

  await db.authUser.update({
    where: { id: user.id },
    data: {
      plan: 'PRO',
      proExpiresAt: expiresAt,
    },
  });

  return {
    userId: user.id,
    startsAt,
    expiresAt,
    subscriptionId: subscription.id,
    previousPlan: user.plan,
    previousProExpiresAt: currentExpiry,
  };
}

export async function revokeProEntitlement(
  input: {
    userId: number;
    reason: string;
    revokedBy?: string | null;
    now?: Date;
  },
  db: SubscriptionDb = prisma as unknown as SubscriptionDb,
): Promise<{
  userId: number;
  revokedSubscriptions: number;
  plan: 'FREE';
  proExpiresAt: null;
}> {
  const now = input.now ?? new Date();

  const user = await db.authUser.findUnique({
    where: { id: input.userId },
  });

  if (!user) {
    throw new Error(`Cannot revoke PRO entitlement: user ${input.userId} not found.`);
  }

  const result = await db.subscription.updateMany({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      expiresAt: { gt: now },
    },
    data: {
      status: 'REVOKED',
      metadata: {
        revokedAt: now.toISOString(),
        reason: input.reason,
        revokedBy: input.revokedBy ?? null,
      },
    },
  });

  await db.authUser.update({
    where: { id: input.userId },
    data: {
      plan: 'FREE',
      proExpiresAt: null,
    },
  });

  return {
    userId: input.userId,
    revokedSubscriptions: Number(result.count ?? 0),
    plan: 'FREE',
    proExpiresAt: null,
  };
}
