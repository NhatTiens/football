import { describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';

const { bootstrapAdmin } = await import('../src/admin-bootstrap.js');

function source(overrides: Record<string, string> = {}) {
  return {
    ADMIN_BOOTSTRAP_EMAIL: 'owner@example.com',
    ADMIN_BOOTSTRAP_PASSWORD: 'Very-Strong-Temporary-Password-2026',
    ADMIN_BOOTSTRAP_NAME: 'Platform Owner',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function txDb(input: {
  target?: any;
  adminCount?: number;
  created?: any;
}) {
  const auditCreate = vi.fn(async () => ({ id: 1 }));
  const userCreate = vi.fn(async () =>
    input.created ?? {
      id: 10,
      email: 'owner@example.com',
      forcePasswordChange: true,
    },
  );

  const tx = {
    appSetting: {
      upsert: vi.fn(async () => ({ key: 'commercial.admin.bootstrap.lock' })),
    },
    $queryRawUnsafe: vi.fn(async () => []),
    authUser: {
      findUnique: vi.fn(async () => input.target ?? null),
      count: vi.fn(async () => input.adminCount ?? 0),
      create: userCreate,
    },
    adminAuditLog: { create: auditCreate },
  };

  return {
    db: {
      $transaction: async (handler: any) => handler(tx),
      authUser: {
        findUnique: vi.fn(async () => input.target ?? null),
      },
    },
    tx,
    auditCreate,
    userCreate,
  };
}

describe('ADMIN-1 safe bootstrap', () => {
  it('creates only the first admin, permanent PRO, verified and forced password change', async () => {
    const fixture = txDb({});
    const hasher = vi.fn(async () => 'argon2id-hash');

    const result = await bootstrapAdmin({
      source: source(),
      db: fixture.db,
      passwordHasher: hasher,
      now: new Date('2026-08-11T07:00:00.000Z'),
    });

    expect(result.kind).toBe('CREATED');
    expect(hasher).toHaveBeenCalledTimes(1);
    expect(fixture.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'ADMIN',
        status: 'ACTIVE',
        plan: 'PRO',
        passwordHash: 'argon2id-hash',
        forcePasswordChange: true,
        proExpiresAt: null,
      }),
    });
    expect(fixture.auditCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('Very-Strong-Temporary-Password');
    expect(JSON.stringify(result)).not.toContain('argon2id-hash');
  });

  it('does not overwrite an existing admin password or account state', async () => {
    const fixture = txDb({
      target: {
        id: 7,
        email: 'owner@example.com',
        role: 'ADMIN',
        forcePasswordChange: false,
      },
    });
    const hasher = vi.fn(async () => 'must-not-be-used');

    const result = await bootstrapAdmin({
      source: source(),
      db: fixture.db,
      passwordHasher: hasher,
    });

    expect(result).toMatchObject({
      kind: 'ALREADY_ADMIN',
      userId: 7,
      email: 'owner@example.com',
    });
    expect(hasher).not.toHaveBeenCalled();
    expect(fixture.userCreate).not.toHaveBeenCalled();
  });

  it('refuses to silently promote an existing non-admin account', async () => {
    const fixture = txDb({
      target: {
        id: 8,
        email: 'owner@example.com',
        role: 'USER',
        forcePasswordChange: false,
      },
    });
    const hasher = vi.fn(async () => 'must-not-be-used');

    const result = await bootstrapAdmin({
      source: source(),
      db: fixture.db,
      passwordHasher: hasher,
    });

    expect(result).toMatchObject({
      kind: 'REFUSED_TARGET_EXISTS',
      currentRole: 'USER',
    });
    expect(hasher).not.toHaveBeenCalled();
    expect(fixture.userCreate).not.toHaveBeenCalled();
  });

  it('refuses to create an additional admin when another admin already exists', async () => {
    const fixture = txDb({ adminCount: 1 });
    const hasher = vi.fn(async () => 'must-not-be-used');

    const result = await bootstrapAdmin({
      source: source({ ADMIN_BOOTSTRAP_EMAIL: 'second@example.com' }),
      db: fixture.db,
      passwordHasher: hasher,
    });

    expect(result).toEqual({ kind: 'REFUSED_ADMIN_EXISTS', adminCount: 1 });
    expect(hasher).not.toHaveBeenCalled();
    expect(fixture.userCreate).not.toHaveBeenCalled();
  });
});
