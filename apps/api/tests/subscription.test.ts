import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.PRO_PLAN_DAYS = '30';

const lifecycle = await import('../src/subscription.ts');

describe('SUBSCRIPTION-1 lifecycle', () => {
  it('expires stale subscription rows and downgrades expired PRO to FREE', async () => {
    const now = new Date('2026-08-11T06:00:00.000Z');
    let user = {
      id: 1,
      plan: 'PRO',
      proExpiresAt: new Date('2026-08-10T06:00:00.000Z'),
    };

    const db = {
      subscription: {
        updateMany: async () => ({ count: 2 }),
      },
      authUser: {
        findUnique: async () => user,
        update: async ({ data }: any) => {
          user = { ...user, ...data };
          return user;
        },
      },
    };

    const result = await lifecycle.reconcileSubscriptionLifecycle(
      1,
      db as any,
      now,
    );

    expect(result).toMatchObject({
      userId: 1,
      plan: 'FREE',
      proExpiresAt: null,
      expiredSubscriptions: 2,
    });
  });

  it('clears stale proExpiresAt when plan is not PRO', async () => {
    const now = new Date('2026-08-11T06:00:00.000Z');
    let user = {
      id: 2,
      plan: 'FREE',
      proExpiresAt: new Date('2026-09-01T06:00:00.000Z'),
    };

    const db = {
      subscription: {
        updateMany: async () => ({ count: 0 }),
      },
      authUser: {
        findUnique: async () => user,
        update: async ({ data }: any) => {
          user = { ...user, ...data };
          return user;
        },
      },
    };

    const result = await lifecycle.reconcileSubscriptionLifecycle(
      2,
      db as any,
      now,
    );

    expect(result?.plan).toBe('FREE');
    expect(result?.proExpiresAt).toBeNull();
  });
});
