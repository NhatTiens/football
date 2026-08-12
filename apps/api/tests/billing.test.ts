import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.PRO_PLAN_DAYS = '30';
process.env.PRO_PLAN_PRICE_VND = '199000';
process.env.PAYMENT_ORDER_EXPIRE_MINUTES = '15';
process.env.PAYMENT_BANK_ID = '970422';
process.env.PAYMENT_BANK_BIN = '970422';
process.env.PAYMENT_ACCOUNT_NO = '0923398332';
process.env.PAYMENT_ACCOUNT_NAME = 'BUI NGUYEN NHAT TIEN';
process.env.PAYMENT_QR_TEMPLATE = 'compact2';
process.env.REQUIRES_PRODUCTION_PRICE_CONFIRMATION = 'false';

const billing = await import('../src/billing.ts');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 10,
    orderCode: 'FA260811ABCDEF',
    planCode: 'PRO',
    amountVnd: 199000,
    status: 'PENDING',
    provider: 'SEPAY',
    activeKey: '10:PRO:SEPAY',
    transferContent: 'FA260811ABCDEF',
    qrUrl: null,
    expiresAt: new Date('2026-08-11T06:00:00.000Z'),
    paidAt: null,
    providerTransactionId: null,
    createdAt: new Date('2026-08-11T05:45:00.000Z'),
    updatedAt: new Date('2026-08-11T05:45:00.000Z'),
    ...overrides,
  };
}

describe('BILLING-2 plan and order core', () => {
  it('keeps pricing server-side', () => {
    const result = billing.getBillingPlans();
    expect(result.currency).toBe('VND');
    expect(result.plans.find((plan) => plan.code === 'PRO')).toMatchObject({
      priceVnd: 199000,
      durationDays: 30,
      purchasable: true,
    });
  });

  it('formats a safe transfer/order code', () => {
    expect(
      billing.formatOrderCode(new Date('2026-08-11T00:00:00.000Z'), 'ab-cd_12!34'),
    ).toBe('FA260811ABCD1234');
  });

  it('returns bank instructions without any secret', () => {
    expect(
      billing.paymentInstructions({
        amountVnd: 199000,
        transferContent: 'FA260811ABCDEF',
      }),
    ).toMatchObject({
      bankId: '970422',
      bankBin: '970422',
      bankName: 'MB Bank',
      accountNo: '0923398332',
      accountName: 'BUI NGUYEN NHAT TIEN',
      qrTemplate: 'compact2',
      amountVnd: 199000,
      transferContent: 'FA260811ABCDEF',
    });

    expect(
      billing.paymentInstructions({
        amountVnd: 199000,
        transferContent: 'FA260811ABCDEF',
      }).qrUrl,
    ).toContain(
      'https://img.vietqr.io/image/970422-0923398332-compact2.png',
    );
  });

  it('reuses a live pending PRO order instead of trusting client amount', async () => {
    const existing = row();
    const calls: string[] = [];
    const db = {
      authUser: {},
      subscription: {},
      paymentOrder: {
        updateMany: async () => {
          calls.push('expire');
          return { count: 0 };
        },
        findFirst: async () => {
          calls.push('find');
          return existing;
        },
        create: async () => {
          calls.push('create');
          throw new Error('should not create');
        },
      },
    };

    const result = await billing.createPaymentOrderForUser(
      10,
      'PRO',
      db as any,
      new Date('2026-08-11T05:50:00.000Z'),
    );

    expect(result).toEqual({ order: existing, reused: true });
    expect(calls).toEqual(['expire', 'find']);
  });

  it('creates only one active order under concurrent checkout requests', async () => {
    let active: ReturnType<typeof row> | null = null;
    let nextId = 1;
    const db = {
      authUser: {},
      subscription: {},
      paymentOrder: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => null,
        findUnique: async ({ where }: any) =>
          where.activeKey === active?.activeKey ? active : null,
        create: async ({ data }: any) => {
          await Promise.resolve();
          if (active) {
            throw Object.assign(new Error('duplicate active order'), {
              code: 'P2002',
            });
          }
          active = row({ id: nextId++, ...data });
          return active;
        },
      },
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        billing.createPaymentOrderForUser(
          10,
          'PRO',
          db as any,
          new Date('2026-08-11T05:50:00.000Z'),
        ),
      ),
    );

    expect(new Set(results.map((result) => result.order.id))).toEqual(
      new Set([1]),
    );
    expect(results.filter((result) => !result.reused)).toHaveLength(1);
  });

  it('rejects unsupported plan codes before DB writes', async () => {
    const db = {
      authUser: {},
      subscription: {},
      paymentOrder: {
        updateMany: async () => {
          throw new Error('must not be called');
        },
      },
    };

    await expect(
      billing.createPaymentOrderForUser(10, 'FREE', db as any),
    ).rejects.toThrow('UNSUPPORTED_PLAN');
  });

  it('lists only orders for the authenticated user', async () => {
    let whereSeen: unknown = null;
    const db = {
      authUser: {},
      subscription: {},
      paymentOrder: {
        updateMany: async () => ({ count: 0 }),
        findMany: async (args: any) => {
          whereSeen = args.where;
          return [row()];
        },
      },
    };

    const result = await billing.getAccountPaymentsData(10, 50, db as any);
    expect(whereSeen).toEqual({ userId: 10 });
    expect(result.billingAvailable).toBe(true);
    expect(result.payments).toHaveLength(1);
  });

  it('builds a VietQR Quick Link with server-owned amount and transfer content', () => {
    const url = new URL(
      billing.buildVietQrUrl({
        amountVnd: 199000,
        transferContent: 'FA260811ABCDEF',
      }),
    );

    expect(url.origin).toBe('https://img.vietqr.io');
    expect(url.pathname).toBe('/image/970422-0923398332-compact2.png');
    expect(url.searchParams.get('amount')).toBe('199000');
    expect(url.searchParams.get('addInfo')).toBe('FA260811ABCDEF');
    expect(url.searchParams.get('accountName')).toBe('BUI NGUYEN NHAT TIEN');
  });

  it('includes VietQR URL and bank display name in payment instructions', () => {
    const instructions = billing.paymentInstructions({
      amountVnd: 199000,
      transferContent: 'FA260811ABCDEF',
    });

    expect(instructions.bankName).toBe('MB Bank');
    expect(instructions.qrUrl).toContain('https://img.vietqr.io/image/');
    expect(instructions.qrUrl).toContain('amount=199000');
  });
});
