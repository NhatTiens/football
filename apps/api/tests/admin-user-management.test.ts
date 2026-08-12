import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';

import {
  deletedManagedEmail,
  isDeletedManagedEmail,
} from '../src/admin-user-management';

describe('ADMIN user-management helpers', () => {
  it('builds a deterministic deleted identity namespace', () => {
    const value = deletedManagedEmail(42, new Date('2026-08-11T08:00:00.000Z'));
    expect(value).toBe('deleted+42+1786435200000@deleted.invalid');
    expect(isDeletedManagedEmail(value)).toBe(true);
  });

  it('does not classify normal users as deleted', () => {
    expect(isDeletedManagedEmail('user@example.com')).toBe(false);
  });
});
