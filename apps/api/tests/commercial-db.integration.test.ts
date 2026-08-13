import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.AUTH_PRO_CHAT_DAILY_LIMIT = '3';
process.env.PRO_PLAN_DAYS = '30';
process.env.PRO_PLAN_PRICE_VND = '199000';
process.env.PAYMENT_ORDER_EXPIRE_MINUTES = '15';
process.env.PAYMENT_BANK_ID = '970422';
process.env.PAYMENT_BANK_BIN = '970422';
process.env.PAYMENT_ACCOUNT_NO = '123456789';
process.env.PAYMENT_ACCOUNT_NAME = 'TEST ACCOUNT';
process.env.PAYMENT_QR_TEMPLATE = 'compact2';
process.env.REQUIRES_PRODUCTION_PRICE_CONFIRMATION = 'false';

const enabled = process.env.RUN_DB_INTEGRATION === 'true';
const suite = enabled ? describe : describe.skip;
const { prisma } = await import('@football-ai/database');
const { consumeUsage } = await import('../src/auth-usage.ts');
const { createPaymentOrderForUser } = await import('../src/billing.ts');

suite('commercial invariants with MySQL', () => {
  let userId = 0;

  beforeAll(async () => {
    const user = await prisma.authUser.create({
      data: {
        email: `integration-${Date.now()}@example.invalid`,
        name: 'Integration User',
        passwordHash: 'not-used-by-this-test',
        status: 'ACTIVE',
        plan: 'PRO',
        emailVerifiedAt: new Date(),
        proExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (userId) await prisma.authUser.delete({ where: { id: userId } });
  });

  it('atomically caps concurrent quota claims', async () => {
    const claims = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeUsage({
          userId,
          plan: 'PRO',
          feature: 'CHAT_BASIC',
        }),
      ),
    );
    expect(claims.filter((claim) => claim.allowed)).toHaveLength(3);
    expect(
      await prisma.authUsageDaily.findFirst({
        where: { userId, featureKey: 'CHAT_BASIC' },
      }),
    ).toMatchObject({ used: 3 });
  });

  it('returns one active payment order for concurrent checkout retries', async () => {
    const plan = await prisma.billingPlan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    expect(plan).not.toBeNull();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => createPaymentOrderForUser(userId, { planId: plan!.id })),
    );
    expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
    expect(results[0]?.order).toMatchObject({
      billingPlanId: plan!.id,
      originalPriceVnd: 35_000,
      discountAmountVnd: 10_000,
      finalPriceVnd: 25_000,
      amountVnd: 25_000,
    });
    expect(
      await prisma.paymentOrder.count({
        where: { userId, status: 'PENDING' },
      }),
    ).toBe(1);
  });
});
