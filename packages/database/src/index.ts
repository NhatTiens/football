import * as PrismaClientModule from '@prisma/client';

export const FixtureStatus = {
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  FINISHED: 'FINISHED',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
} as const;
export type FixtureStatus = (typeof FixtureStatus)[keyof typeof FixtureStatus];

export const RecommendationStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  SETTLED: 'SETTLED',
} as const;
export type RecommendationStatus =
  (typeof RecommendationStatus)[keyof typeof RecommendationStatus];

export const SettlementResult = {
  PENDING: 'PENDING',
  WIN: 'WIN',
  LOSS: 'LOSS',
  PUSH: 'PUSH',
  VOID: 'VOID',
} as const;
export type SettlementResult = (typeof SettlementResult)[keyof typeof SettlementResult];

export const SyncStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const BacktestStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type BacktestStatus = (typeof BacktestStatus)[keyof typeof BacktestStatus];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type InputJsonValue =
  | JsonPrimitive
  | readonly InputJsonValue[]
  | { readonly [key: string]: InputJsonValue | undefined };

/**
 * Prisma generates its concrete client after `npm run db:generate`.
 * The structural cast keeps source-only typechecking possible in offline environments,
 * while runtime still uses the real generated PrismaClient.
 */
type PrismaClientLike = {
  [key: string]: any;
  $disconnect(): Promise<void>;
};

type PrismaClientConstructor = new (options?: Record<string, unknown>) => PrismaClientLike;
const PrismaClient = (PrismaClientModule as unknown as { PrismaClient: PrismaClientConstructor })
  .PrismaClient;

if (!PrismaClient) {
  throw new Error('Prisma Client has not been generated. Run: npm run db:generate');
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientLike };

export const prisma: PrismaClientLike =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
