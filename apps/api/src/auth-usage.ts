import { prisma } from '@football-ai/database';

import { env } from './env.js';
import type { AuthPlan } from './auth.js';

export type AuthUsageFeature = 'CHAT_BASIC' | 'CHAT_ADVANCED';

type UsageDb = {
  authUsageDaily: {
    findUnique: (args: any) => Promise<{ used: number } | null>;
    create: (args: any) => Promise<unknown>;
    updateMany: (args: any) => Promise<{ count: number }>;
    upsert: (args: any) => Promise<unknown>;
  };
};

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: unknown }).code ?? '') === 'P2002',
  );
}

function startOfUtcDay(value = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function quotaLimit(plan: AuthPlan, feature: AuthUsageFeature): number | null {
  if (plan === 'PRO') {
    return env.AUTH_PRO_CHAT_DAILY_LIMIT;
  }
  return feature === 'CHAT_BASIC' ? env.AUTH_FREE_CHAT_DAILY_LIMIT : 0;
}

export async function readUsage(input: {
  userId: number;
  plan: AuthPlan;
  feature: AuthUsageFeature;
  now?: Date;
  db?: UsageDb;
}): Promise<{
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
}> {
  const now = input.now ?? new Date();
  const usageDate = startOfUtcDay(now);
  const db = input.db ?? (prisma as unknown as UsageDb);
  const row = await db.authUsageDaily.findUnique({
    where: {
      userId_featureKey_usageDate: {
        userId: input.userId,
        featureKey: input.feature,
        usageDate,
      },
    },
    select: { used: true },
  });
  const limit = quotaLimit(input.plan, input.feature);
  const used = row?.used ?? 0;
  return {
    used,
    limit,
    remaining: limit == null ? null : Math.max(0, limit - used),
    resetAt: new Date(usageDate.getTime() + 86_400_000).toISOString(),
  };
}

export async function consumeUsage(input: {
  userId: number;
  plan: AuthPlan;
  feature: AuthUsageFeature;
  now?: Date;
  db?: UsageDb;
}): Promise<{ allowed: boolean; usage: Awaited<ReturnType<typeof readUsage>> }> {
  const now = input.now ?? new Date();
  const db = input.db ?? (prisma as unknown as UsageDb);
  const usageDate = startOfUtcDay(now);
  const limit = quotaLimit(input.plan, input.feature);
  const key = {
    userId: input.userId,
    featureKey: input.feature,
    usageDate,
  };

  if (limit === 0) {
    return {
      allowed: false,
      usage: await readUsage({ ...input, now, db }),
    };
  }

  if (limit == null) {
    await db.authUsageDaily.upsert({
      where: { userId_featureKey_usageDate: key },
      update: { used: { increment: 1 } },
      create: { ...key, used: 1 },
    });
    return {
      allowed: true,
      usage: await readUsage({ ...input, now, db }),
    };
  }

  let claimed = false;

  try {
    await db.authUsageDaily.create({ data: { ...key, used: 1 } });
    claimed = true;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  if (!claimed) {
    const result = await db.authUsageDaily.updateMany({
      where: {
        ...key,
        used: { lt: limit },
      },
      data: { used: { increment: 1 } },
    });
    claimed = Number(result.count ?? 0) === 1;
  }

  return {
    allowed: claimed,
    usage: await readUsage({ ...input, now, db }),
  };
}

export async function refundUsage(input: {
  userId: number;
  feature: AuthUsageFeature;
  now?: Date;
  db?: UsageDb;
}): Promise<void> {
  const now = input.now ?? new Date();
  const db = input.db ?? (prisma as unknown as UsageDb);
  await db.authUsageDaily.updateMany({
    where: {
      userId: input.userId,
      featureKey: input.feature,
      usageDate: startOfUtcDay(now),
      used: { gt: 0 },
    },
    data: { used: { decrement: 1 } },
  });
}

export function getFeatureForChatIntent(intent: string): AuthUsageFeature {
  return intent === 'BEST_BET' || intent === 'EXPLANATION' || intent === 'HISTORY' || intent === 'RELIABILITY'
    ? 'CHAT_ADVANCED'
    : 'CHAT_BASIC';
}
