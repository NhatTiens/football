import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.PRO_PLAN_DAYS = '30';
process.env.PRO_PLAN_PRICE_VND = '199000';
process.env.PAYMENT_ORDER_EXPIRE_MINUTES = '15';
process.env.PAYMENT_ACCOUNT_NO = '0923398332';
process.env.REQUIRES_PRODUCTION_PRICE_CONFIRMATION = 'false';
process.env.SEPAY_WEBHOOK_API_KEY = 'test-sepay-api-key';

const sepay = await import('../src/sepay-webhook.ts');

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 92704,
    gateway: 'MBBank',
    transactionDate: '2026-08-11 13:00:00',
    accountNumber: '0923398332',
    subAccount: '',
    code: 'FA260811ABCDEF123456',
    content: 'FA260811ABCDEF123456 chuyen tien',
    transferType: 'in',
    description: 'test',
    transferAmount: 199000,
    accumulated: 1000000,
    referenceCode: 'FT260811001',
    ...overrides,
  };
}

describe('PAYMENT-1 SePay webhook', () => {
  it('accepts only the configured Apikey header', () => {
    expect(sepay.verifySepayApiKey('Apikey test-sepay-api-key', 'test-sepay-api-key')).toBe(true);
    expect(sepay.verifySepayApiKey('Bearer test-sepay-api-key', 'test-sepay-api-key')).toBe(false);
    expect(sepay.verifySepayApiKey('Apikey wrong', 'test-sepay-api-key')).toBe(false);
  });

  it('extracts order code from code or transfer content', () => {
    expect(sepay.extractSepayOrderCode(payload())).toBe('FA260811ABCDEF123456');
    expect(
      sepay.extractSepayOrderCode(
        payload({
          code: null,
          content: 'THANH TOAN FA260811ABCDEF123456 CAM ON',
        }),
      ),
    ).toBe('FA260811ABCDEF123456');
  });

  it('validates official transaction fields', () => {
    const parsed = sepay.sepayWebhookSchema.parse(payload());
    expect(parsed.transferType).toBe('in');
    expect(parsed.transferAmount).toBe(199000);
    expect(String(parsed.id)).toBe('92704');
  });

  it('hashes identical payloads deterministically', () => {
    const parsed = sepay.sepayWebhookSchema.parse(payload());
    expect(sepay.hashSepayPayload(parsed)).toBe(sepay.hashSepayPayload(parsed));
    expect(sepay.hashSepayPayload(parsed)).toHaveLength(64);
  });

  it('does not create a second subscription when the same payment webhook is retried', async () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    const webhookPayload = payload({
      id: 99001,
      transactionDate: '2026-08-13 19:00:00',
      transferAmount: 120_000,
    });
    let order: any = {
      id: 501,
      userId: 77,
      orderCode: 'FA260811ABCDEF123456',
      planCode: 'PRO_6_MONTH',
      billingPlanId: 2,
      amountVnd: 120_000,
      finalPriceVnd: 120_000,
      currency: 'VND',
      promotionId: null,
      promotionClaimed: false,
      durationCount: 6,
      durationUnit: 'MONTH',
      provider: 'SEPAY',
      status: 'PENDING',
      expiresAt: new Date('2026-08-13T12:15:00.000Z'),
      providerTransactionId: null,
    };
    let user: any = {
      id: 77,
      role: 'USER',
      plan: 'FREE',
      proExpiresAt: null,
    };
    const events = new Map<string, any>();
    const subscriptions: any[] = [];
    let eventSequence = 1;
    const tx: any = {
      paymentWebhookEvent: {
        create: async ({ data }: any) => {
          const key = `${data.provider}:${data.externalId}`;
          if (events.has(key)) {
            throw Object.assign(new Error('duplicate webhook event'), { code: 'P2002' });
          }
          const event = { id: eventSequence++, orderId: null, ...data };
          events.set(key, event);
          return event;
        },
        findUnique: async ({ where }: any) =>
          events.get(
            `${where.provider_externalId.provider}:${where.provider_externalId.externalId}`,
          ),
        update: async ({ where, data }: any) => {
          const event = [...events.values()].find((candidate) => candidate.id === where.id);
          Object.assign(event, data);
          return event;
        },
      },
      paymentOrder: {
        findUnique: async () => order,
        updateMany: async ({ where, data }: any) => {
          if (order.id !== where.id || order.status !== where.status) return { count: 0 };
          order = { ...order, ...data };
          return { count: 1 };
        },
      },
      authUser: {
        findUnique: async () => user,
        update: async ({ data }: any) => {
          user = { ...user, ...data };
          return user;
        },
      },
      subscription: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => {
          const created = { id: subscriptions.length + 1, ...data };
          subscriptions.push(created);
          return created;
        },
      },
    };
    const db = {
      $transaction: async (operation: (transaction: any) => Promise<any>) => operation(tx),
    };

    const first = await sepay.processSepayWebhook(webhookPayload, db as any, now);
    const retry = await sepay.processSepayWebhook(webhookPayload, db as any, now);

    expect(first.kind).toBe('processed');
    expect(retry).toEqual({ kind: 'duplicate', orderId: 501 });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      sourcePaymentOrderId: 501,
      billingPlanId: 2,
      pricePaidVnd: 120_000,
      autoRenew: false,
    });
  });
});
