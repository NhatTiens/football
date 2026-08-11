import { describe, expect, it } from 'vitest';

import {
  billingStatusLabel,
  quotaPercent,
  quotaValue,
  remainingEntitlementText,
  subscriptionStatusLabel,
} from '../lib/commercial-account';

describe('USER-UI FINAL display helpers', () => {
  it('calculates bounded quota percentages', () => {
    expect(quotaPercent(5, 10)).toBe(50);
    expect(quotaPercent(20, 10)).toBe(100);
    expect(quotaPercent(0, 0)).toBe(0);
    expect(quotaPercent(5, null)).toBeNull();
  });

  it('formats nullable quotas', () => {
    expect(quotaValue(null)).toBe('Không giới hạn');
    expect(quotaValue(0)).toBe('0');
  });

  it('reports active and expired entitlement time', () => {
    const now = Date.parse('2026-08-11T06:00:00.000Z');
    expect(
      remainingEntitlementText('2026-08-12T06:00:00.000Z', now),
    ).toBe('Còn 1 ngày');
    expect(
      remainingEntitlementText('2026-08-10T06:00:00.000Z', now),
    ).toBe('Đã hết hạn');
  });

  it('uses human-readable billing and subscription statuses', () => {
    expect(billingStatusLabel('PAID')).toBe('Đã thanh toán');
    expect(billingStatusLabel('PENDING')).toBe('Chờ thanh toán');
    expect(subscriptionStatusLabel('ACTIVE')).toBe('Đang hoạt động');
    expect(subscriptionStatusLabel('REVOKED')).toBe('Đã thu hồi');
  });
});
