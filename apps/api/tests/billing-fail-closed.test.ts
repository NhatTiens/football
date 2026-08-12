import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'production';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.PRO_PLAN_PRICE_VND = '199000';
process.env.PAYMENT_BANK_ID = '970422';
process.env.PAYMENT_BANK_BIN = '970422';
process.env.PAYMENT_ACCOUNT_NO = '123456789';
process.env.PAYMENT_ACCOUNT_NAME = 'TEST ACCOUNT';
process.env.REQUIRES_PRODUCTION_PRICE_CONFIRMATION = 'true';

const billing = await import('../src/billing.ts');

describe('production billing fail-closed gate', () => {
  it('does not publish a purchasable PRO plan before confirmation', () => {
    expect(billing.getBillingPlans().plans.find((plan) => plan.code === 'PRO')).toMatchObject({
      purchasable: false,
      unavailableReason: 'PRICE_CONFIRMATION_REQUIRED',
    });
  });

  it('rejects order creation before any database call', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('database must not be called');
        },
      },
    );

    await expect(
      billing.createPaymentOrderForUser(1, 'PRO', db as any),
    ).rejects.toThrow('BILLING_UNAVAILABLE:PRICE_CONFIRMATION_REQUIRED');
  });
});
