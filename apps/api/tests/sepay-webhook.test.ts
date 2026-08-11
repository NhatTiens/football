import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.PRO_PLAN_DAYS = '30';
process.env.PRO_PLAN_PRICE_VND = '199000';
process.env.PAYMENT_ORDER_EXPIRE_MINUTES = '15';
process.env.PAYMENT_ACCOUNT_NO = '0923398332';
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
    expect(
      sepay.verifySepayApiKey('Apikey test-sepay-api-key', 'test-sepay-api-key'),
    ).toBe(true);
    expect(
      sepay.verifySepayApiKey('Bearer test-sepay-api-key', 'test-sepay-api-key'),
    ).toBe(false);
    expect(
      sepay.verifySepayApiKey('Apikey wrong', 'test-sepay-api-key'),
    ).toBe(false);
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
});
