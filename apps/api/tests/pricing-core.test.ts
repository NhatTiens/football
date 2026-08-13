import { describe, expect, it } from 'vitest';
import type { PricingPlanRecord, PricingPromotionRecord } from '../src/pricing-core.ts';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.REQUIRES_PRODUCTION_PRICE_CONFIRMATION = 'false';
process.env.PAYMENT_BANK_ID = '970422';
process.env.PAYMENT_BANK_BIN = '970422';
process.env.PAYMENT_ACCOUNT_NO = '123456789';
process.env.PAYMENT_ACCOUNT_NAME = 'TEST ACCOUNT';

const pricing = await import('../src/pricing-core.ts');
const service = await import('../src/pricing-service.ts');
const pricingRoutes = await import('../src/pricing-routes.ts');
const billingRoutes = await import('../src/billing-routes.ts');
const billing = await import('../src/billing.ts');

const monthly: PricingPlanRecord = {
  id: 1,
  code: 'PRO_MONTHLY',
  name: 'Pro Monthly',
  description: null,
  durationCount: 1,
  durationUnit: 'MONTH',
  basePriceVnd: 35_000,
  currency: 'VND',
  purchasable: true,
  status: 'ACTIVE',
};

const sixMonths: PricingPlanRecord = {
  ...monthly,
  id: 2,
  code: 'PRO_6_MONTH',
  name: 'Pro 6 Months',
  durationCount: 6,
  basePriceVnd: 210_000,
};

function promotion(overrides: Partial<PricingPromotionRecord> = {}): PricingPromotionRecord {
  return {
    id: 10,
    name: 'First Pro Purchase',
    code: 'PRO_FIRST_PURCHASE',
    description: null,
    type: 'FIXED_PRICE',
    discountValue: null,
    fixedPriceVnd: 25_000,
    automatic: true,
    startAt: new Date('2026-08-13T00:00:00.000Z'),
    endAt: null,
    maxUses: null,
    claimedCount: 0,
    usedCount: 0,
    maxUsesPerUser: 1,
    priority: 100,
    status: 'ACTIVE',
    newUsersOnly: false,
    firstPurchaseOnly: true,
    minimumDurationDays: null,
    ...overrides,
  };
}

function user(paidProPurchaseCount = 0, claimedByPromotion: Record<number, number> = {}) {
  return {
    userId: 7,
    registeredAt: new Date('2026-08-13T00:00:00.000Z'),
    paidProPurchaseCount,
    claimedByPromotion,
  };
}

describe('Pricing/Promotion Engine', () => {
  it('applies 25.000đ only to the first Pro purchase', () => {
    const first = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [promotion()],
      user: user(),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    const returning = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [promotion()],
      user: user(1),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    expect(first.finalPrice).toBe(25_000);
    expect(first.promotionCode).toBe('PRO_FIRST_PURCHASE');
    expect(returning.finalPrice).toBe(35_000);
    expect(returning.eligibility[0]?.reason).toBe('NOT_FIRST_PURCHASE');
  });

  it('applies 120.000đ for six months through the last instant of 01/01/2027 Vietnam time', () => {
    const promo = promotion({
      id: 20,
      name: 'Pro 6 Months - 20K/month',
      code: 'PRO_6_MONTH_PROMO',
      fixedPriceVnd: 120_000,
      firstPurchaseOnly: false,
      maxUsesPerUser: null,
      priority: 80,
      endAt: new Date('2027-01-01T17:00:00.000Z'),
      minimumDurationDays: 180,
    });
    const beforeEnd = pricing.calculatePriceCore({
      plan: sixMonths,
      promotions: [promo],
      user: user(2),
      now: new Date('2027-01-01T16:59:59.999Z'),
    });
    const atEnd = pricing.calculatePriceCore({
      plan: sixMonths,
      promotions: [promo],
      user: user(2),
      now: new Date('2027-01-01T17:00:00.000Z'),
    });
    expect(beforeEnd.finalPrice).toBe(120_000);
    expect(atEnd.finalPrice).toBe(210_000);
    expect(atEnd.eligibility[0]?.reason).toBe('PROMOTION_EXPIRED');
  });

  it('prices a renewal after the six-month promotion at the normal monthly price', () => {
    const firstPurchase = promotion({
      endAt: null,
      firstPurchaseOnly: true,
    });
    const renewal = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [firstPurchase],
      user: user(1),
      now: new Date('2027-02-01T00:00:00.000Z'),
    });
    expect(renewal.finalPrice).toBe(monthly.basePriceVnd);
    expect(renewal.promotionId).toBeNull();
  });

  it.each([
    ['disabled', promotion({ status: 'INACTIVE' }), 'PROMOTION_INACTIVE'],
    [
      'not started',
      promotion({ startAt: new Date('2026-09-01T00:00:00Z') }),
      'PROMOTION_NOT_STARTED',
    ],
    ['max uses', promotion({ maxUses: 2, claimedCount: 2 }), 'MAX_USES_REACHED'],
    ['max uses per user', promotion({ maxUsesPerUser: 1 }), 'MAX_USES_PER_USER_REACHED'],
  ])('does not apply a promotion that is %s', (_label, promo, reason) => {
    const claimed = reason === 'MAX_USES_PER_USER_REACHED' ? { [promo.id]: 1 } : {};
    const quote = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [promo],
      user: user(0, claimed),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    expect(quote.finalPrice).toBe(35_000);
    expect(quote.eligibility[0]?.reason).toBe(reason);
  });

  it('enforces newUsersOnly from server-side account creation history', () => {
    const newOnly = promotion({
      id: 45,
      newUsersOnly: true,
      firstPurchaseOnly: false,
      maxUsesPerUser: null,
      startAt: new Date('2026-08-13T00:00:00.000Z'),
    });
    const quote = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [newOnly],
      user: {
        ...user(),
        registeredAt: new Date('2026-08-12T23:59:59.999Z'),
      },
      now: new Date('2026-08-13T12:00:00.000Z'),
    });
    expect(quote.finalPrice).toBe(monthly.basePriceVnd);
    expect(quote.eligibility[0]?.reason).toBe('NOT_NEW_USER');
  });

  it('selects one eligible promotion with the highest priority and never stacks', () => {
    const high = promotion({
      id: 31,
      code: 'HIGH',
      fixedPriceVnd: 30_000,
      priority: 100,
      firstPurchaseOnly: false,
      maxUsesPerUser: null,
    });
    const low = promotion({
      id: 32,
      code: 'LOW',
      fixedPriceVnd: 5_000,
      priority: 50,
      firstPurchaseOnly: false,
      maxUsesPerUser: null,
    });
    const quote = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [low, high],
      user: user(),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    expect(quote.promotionId).toBe(31);
    expect(quote.finalPrice).toBe(30_000);
    expect(quote.discountAmount).toBe(5_000);
  });

  it('validates an explicit coupon without trusting the browser', () => {
    const coupon = promotion({
      id: 40,
      code: 'GIAM20',
      type: 'PERCENTAGE',
      discountValue: 20,
      fixedPriceVnd: null,
      automatic: false,
      firstPurchaseOnly: false,
      maxUsesPerUser: 1,
      priority: 50,
    });
    const valid = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [coupon],
      promotionCode: 'giam20',
      user: user(),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    const missing = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [coupon],
      promotionCode: 'WRONG',
      user: user(),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    expect(valid.requestedCoupon).toMatchObject({ code: 'GIAM20', valid: true });
    expect(valid.finalPrice).toBe(28_000);
    expect(missing.requestedCoupon).toMatchObject({
      code: 'WRONG',
      valid: false,
      reason: 'NOT_FOUND',
    });
  });

  it('creates an immutable order price snapshot', () => {
    const selected = promotion();
    const quote = pricing.calculatePriceCore({
      plan: monthly,
      promotions: [selected],
      user: user(),
      now: new Date('2026-08-13T12:00:00Z'),
    });
    const snapshot = service.buildPaymentOrderPricingSnapshot(quote);
    selected.fixedPriceVnd = 1;
    expect(snapshot).toMatchObject({
      originalPriceVnd: 35_000,
      discountAmountVnd: 10_000,
      finalPriceVnd: 25_000,
      amountVnd: 25_000,
    });
    expect((snapshot.pricingSnapshot as any).promotion.fixedPriceVnd).toBe(25_000);
  });

  it('rejects frontend-controlled finalPrice, discount and promotionId fields', () => {
    expect(
      billingRoutes.billingOrderRequestSchema.safeParse({ planId: 1, finalPrice: 1 }).success,
    ).toBe(false);
    expect(
      pricingRoutes.pricingQuoteRequestSchema.safeParse({ planId: 1, discountAmount: 99 }).success,
    ).toBe(false);
    expect(
      billingRoutes.billingOrderRequestSchema.safeParse({ planId: 1, promotionId: 10 }).success,
    ).toBe(false);
    expect(
      billingRoutes.billingOrderRequestSchema.safeParse({ planId: 1, promotionCode: 'WELCOME' })
        .success,
    ).toBe(true);
  });

  it('reuses an engine-priced order without double-claiming promotion or subscription intent', async () => {
    const selected = promotion();
    const planRow = {
      ...monthly,
      promotionLinks: [{ promotion: selected }],
    };
    let activeOrder: any = null;
    let orderCreates = 0;
    let promotionClaims = 0;
    let counter: any = null;
    const db: any = {
      $transaction: async (operation: (tx: any) => Promise<any>) => operation(db),
      authUser: {
        findUnique: async () => ({ id: 7, createdAt: new Date('2026-08-13T00:00:00Z') }),
      },
      billingPlan: { findFirst: async () => planRow },
      paymentOrder: {
        findMany: async () => [],
        findUnique: async ({ where }: any) => (where.activeKey ? activeOrder : null),
        count: async () => 0,
        create: async ({ data }: any) => {
          orderCreates += 1;
          activeOrder = {
            id: 101,
            createdAt: new Date('2026-08-13T12:00:00Z'),
            updatedAt: new Date('2026-08-13T12:00:00Z'),
            ...data,
          };
          return activeOrder;
        },
      },
      promotion: {
        findUnique: async () => selected,
        updateMany: async () => {
          promotionClaims += 1;
          return { count: 1 };
        },
      },
      promotionUserCounter: {
        findMany: async () => (counter ? [counter] : []),
        findUnique: async () => counter,
        create: async ({ data }: any) => {
          counter = data;
          return counter;
        },
        updateMany: async () => ({ count: 1 }),
      },
    };

    const first = await billing.createPaymentOrderForUser(
      7,
      { planId: monthly.id },
      db,
      new Date('2026-08-13T12:00:00Z'),
    );
    const retry = await billing.createPaymentOrderForUser(
      7,
      { planId: monthly.id },
      db,
      new Date('2026-08-13T12:01:00Z'),
    );

    expect(first.reused).toBe(false);
    expect(retry.reused).toBe(true);
    expect(retry.order.id).toBe(first.order.id);
    expect(orderCreates).toBe(1);
    expect(promotionClaims).toBe(1);
  });
});
