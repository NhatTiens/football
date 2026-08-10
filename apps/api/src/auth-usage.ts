import { prisma } from '@football-ai/database';

import { env } from './env.js';
import type { AuthPlan } from './auth.js';

export type AuthUsageFeature = 'CHAT_BASIC' | 'CHAT_ADVANCED';

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
}): Promise<{
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
}> {
  const now = input.now ?? new Date();
  const usageDate = startOfUtcDay(now);
  const row = await prisma.authUsageDaily.findUnique({
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
}): Promise<{ allowed: boolean; usage: Awaited<ReturnType<typeof readUsage>> }> {
  const now = input.now ?? new Date();
  const usage = await readUsage({ userId: input.userId, plan: input.plan, feature: input.feature, now });
  if (usage.limit != null && usage.used >= usage.limit) {
    return { allowed: false, usage };
  }

  const usageDate = startOfUtcDay(now);
  await prisma.authUsageDaily.upsert({
    where: {
      userId_featureKey_usageDate: {
        userId: input.userId,
        featureKey: input.feature,
        usageDate,
      },
    },
    update: { used: { increment: 1 } },
    create: {
      userId: input.userId,
      featureKey: input.feature,
      usageDate,
      used: 1,
    },
  });

  return {
    allowed: true,
    usage: await readUsage({ userId: input.userId, plan: input.plan, feature: input.feature, now }),
  };
}

export function getFeatureForChatIntent(intent: string): AuthUsageFeature {
  return intent === 'BEST_BET' || intent === 'EXPLANATION' || intent === 'HISTORY' || intent === 'RELIABILITY'
    ? 'CHAT_ADVANCED'
    : 'CHAT_BASIC';
}
