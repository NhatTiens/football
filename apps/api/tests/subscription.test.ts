import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.PRO_PLAN_DAYS = '30';

const lifecycle = await import('../src/subscription.ts');

describe('SUBSCRIPTION-1 lifecycle', () => {
  it('adds calendar months without shortening a six-month subscription', () => {
    expect(
      lifecycle.addBillingDuration(new Date('2026-08-31T12:00:00.000Z'), 6, 'MONTH').toISOString(),
    ).toBe('2027-02-28T12:00:00.000Z');
    expect(
      lifecycle.addBillingDuration(new Date('2027-01-31T12:00:00.000Z'), 1, 'MONTH').toISOString(),
    ).toBe('2027-02-28T12:00:00.000Z');
  });

  it('preserves paid price and full duration in the subscription snapshot', async () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    let user = { id: 9, role: 'USER', plan: 'FREE', proExpiresAt: null as Date | null };
    let createdData: any = null;
    const db = {
      subscription: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => {
          createdData = data;
          return { id: 99, ...data };
        },
      },
      authUser: {
        findUnique: async () => user,
        update: async ({ data }: any) => {
          user = { ...user, ...data };
          return user;
        },
      },
    };

    const result = await lifecycle.applyPaidProEntitlement(
      {
        userId: 9,
        sourcePaymentOrderId: 123,
        provider: 'SEPAY',
        externalTransactionId: 'txn-1',
        billingPlanId: 2,
        planCode: 'PRO_6_MONTH',
        durationCount: 6,
        durationUnit: 'MONTH',
        pricePaidVnd: 120_000,
        currency: 'VND',
        promotionId: 20,
        now,
      },
      db as any,
    );

    expect(result.expiresAt.toISOString()).toBe('2027-02-13T12:00:00.000Z');
    expect(createdData).toMatchObject({
      planCode: 'PRO_6_MONTH',
      billingPlanId: 2,
      autoRenew: false,
      pricePaidVnd: 120_000,
      currency: 'VND',
    });
  });

  it('keeps an active promoted entitlement unchanged and starts renewal after its expiry', async () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    const promotedExpiry = new Date('2027-02-13T12:00:00.000Z');
    let user = {
      id: 10,
      role: 'USER',
      plan: 'PRO',
      proExpiresAt: promotedExpiry,
    };
    let createdData: any = null;
    const db = {
      subscription: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => {
          createdData = data;
          return { id: 100, ...data };
        },
      },
      authUser: {
        findUnique: async () => user,
        update: async ({ data }: any) => {
          user = { ...user, ...data };
          return user;
        },
      },
    };

    const renewal = await lifecycle.applyPaidProEntitlement(
      {
        userId: 10,
        sourcePaymentOrderId: 124,
        provider: 'SEPAY',
        externalTransactionId: 'txn-renewal',
        billingPlanId: 1,
        planCode: 'PRO_MONTHLY',
        durationCount: 1,
        durationUnit: 'MONTH',
        pricePaidVnd: 35_000,
        now,
      },
      db as any,
    );

    expect(createdData.startsAt).toEqual(promotedExpiry);
    expect(renewal.expiresAt.toISOString()).toBe('2027-03-13T12:00:00.000Z');
    expect(user.proExpiresAt).toEqual(renewal.expiresAt);
  });

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

    const result = await lifecycle.reconcileSubscriptionLifecycle(1, db as any, now);

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

    const result = await lifecycle.reconcileSubscriptionLifecycle(2, db as any, now);

    expect(result?.plan).toBe('FREE');
    expect(result?.proExpiresAt).toBeNull();
  });

  it('repairs ADMIN to permanent PRO without creating a subscription row', async () => {
    const now = new Date('2026-08-13T06:00:00.000Z');
    let user = {
      id: 3,
      role: 'ADMIN',
      plan: 'FREE',
      proExpiresAt: new Date('2026-08-12T06:00:00.000Z'),
    };
    const update = async ({ data }: any) => {
      user = { ...user, ...data };
      return user;
    };
    const db = {
      subscription: { updateMany: async () => ({ count: 0 }) },
      authUser: { findUnique: async () => user, update },
    };

    const result = await lifecycle.reconcileSubscriptionLifecycle(3, db as any, now);

    expect(result).toMatchObject({ plan: 'PRO', proExpiresAt: null });
    expect(user).toMatchObject({ plan: 'PRO', proExpiresAt: null });
  });
});
