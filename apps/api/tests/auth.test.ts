import { describe, expect, it } from 'vitest';

process.env.ADMIN_API_TOKEN ??= 'test-admin-token';

const auth = await import('../src/auth.ts');

describe('auth helpers', () => {
  it('hashes passwords with Argon2id', async () => {
    const hash = await auth.hashPassword('secret123');
    expect(hash).toContain('argon2id');
    await expect(auth.verifyPassword(hash, 'secret123')).resolves.toBe(true);
  });

  it('builds a secure session cookie', () => {
    const cookie = auth.buildSessionCookie('session-token', new Date(Date.now() + 60_000));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('restricts analyst intents to elevated roles', () => {
    expect(auth.roleCanAccessIntent('USER', 'PREDICTION')).toBe(true);
    expect(auth.roleCanAccessIntent('USER', 'EXPLANATION')).toBe(false);
    expect(auth.roleCanAccessIntent('ANALYST', 'HISTORY', 'PRO', new Date(Date.now() + 60_000))).toBe(true);
    expect(auth.roleCanManageRoles('ADMIN')).toBe(true);
  });

  it('always serializes ADMIN as permanent PRO', () => {
    const user = auth.serializeUser({
      id: 1,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      plan: 'FREE',
      emailVerifiedAt: new Date('2026-08-13T00:00:00.000Z'),
      proExpiresAt: new Date('2026-08-12T00:00:00.000Z'),
      forcePasswordChange: false,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      lastLoginIp: null,
      lastLoginUserAgent: null,
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
      updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(user.plan).toBe('PRO');
    expect(user.proExpiresAt).toBeNull();
  });
});
