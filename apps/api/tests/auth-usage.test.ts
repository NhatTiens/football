import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_TOKEN ??= 'test-admin-token';
process.env.AUTH_FREE_CHAT_DAILY_LIMIT = '2';
process.env.AUTH_PRO_CHAT_DAILY_LIMIT = '3';

const { consumeUsage } = await import('../src/auth-usage.ts');

function atomicUsageDb() {
  let used: number | null = null;
  return {
    value: () => used,
    authUsageDaily: {
      findUnique: async () => (used == null ? null : { used }),
      create: async ({ data }: any) => {
        await Promise.resolve();
        if (used != null) {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }
        used = data.used;
        return { used };
      },
      updateMany: async ({ where, data }: any) => {
        await Promise.resolve();
        if (used == null) return { count: 0 };
        if (where.used?.lt != null && used >= where.used.lt) return { count: 0 };
        if (where.used?.gt != null && used <= where.used.gt) return { count: 0 };
        used += data.used.increment ?? -(data.used.decrement ?? 0);
        return { count: 1 };
      },
      upsert: async () => {
        used = (used ?? 0) + 1;
        return { used };
      },
    },
  };
}

describe('atomic chatbot quota claim', () => {
  it('never exceeds the daily limit under concurrent claims', async () => {
    const db = atomicUsageDb();
    const claims = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeUsage({
          userId: 7,
          plan: 'FREE',
          feature: 'CHAT_BASIC',
          now: new Date('2026-08-12T08:00:00.000Z'),
          db: db as any,
        }),
      ),
    );

    expect(claims.filter((claim) => claim.allowed)).toHaveLength(2);
    expect(db.value()).toBe(2);
  });

  it('rejects FREE advanced chat without writing usage', async () => {
    const db = atomicUsageDb();
    const result = await consumeUsage({
      userId: 7,
      plan: 'FREE',
      feature: 'CHAT_ADVANCED',
      db: db as any,
    });

    expect(result.allowed).toBe(false);
    expect(db.value()).toBeNull();
  });
});
