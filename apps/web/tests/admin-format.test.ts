import { describe, expect, it } from 'vitest';

import {
  adminMetadataText,
  adminPaymentLabel,
  adminSubscriptionLabel,
  adminUserStatusLabel,
  formatAdminMoney,
} from '../lib/admin-format';

describe('ADMIN-UI formatting helpers', () => {
  it('formats VND and commercial statuses', () => {
    expect(formatAdminMoney(199000)).toContain('199');
    expect(adminPaymentLabel('PAID')).toBe('Đã thanh toán');
    expect(adminSubscriptionLabel('REVOKED')).toBe('Đã thu hồi');
    expect(adminUserStatusLabel('DISABLED')).toBe('Đã khóa');
  });

  it('serializes audit metadata without exposing implementation details', () => {
    expect(adminMetadataText({ days: 30 })).toContain('"days":30');
    expect(adminMetadataText(null)).toBe('—');
  });
});
