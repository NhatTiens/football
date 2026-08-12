import { prisma } from '@football-ai/database';
import { z } from 'zod';

import { hashPassword, normalizeEmail, normalizeName } from './auth.js';

const BOOTSTRAP_LOCK_KEY = 'commercial.admin.bootstrap.lock';

const configSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(2).max(80),
});

export type AdminBootstrapResult =
  | {
      kind: 'CREATED';
      userId: number;
      email: string;
      forcePasswordChange: boolean;
    }
  | {
      kind: 'ALREADY_ADMIN';
      userId: number;
      email: string;
      forcePasswordChange: boolean;
    }
  | {
      kind: 'REFUSED_TARGET_EXISTS';
      userId: number;
      email: string;
      currentRole: string;
    }
  | {
      kind: 'REFUSED_ADMIN_EXISTS';
      adminCount: number;
    };

export function readAdminBootstrapConfig(
  source: NodeJS.ProcessEnv = process.env,
): z.infer<typeof configSchema> {
  return configSchema.parse({
    email: source.ADMIN_BOOTSTRAP_EMAIL,
    password: source.ADMIN_BOOTSTRAP_PASSWORD,
    name: source.ADMIN_BOOTSTRAP_NAME?.trim() || 'Football AI Admin',
  });
}

function isUniqueError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: unknown }).code ?? '') === 'P2002',
  );
}

async function lockBootstrap(tx: any): Promise<void> {
  if (!tx.appSetting?.upsert || !tx.$queryRawUnsafe) return;

  await tx.appSetting.upsert({
    where: { key: BOOTSTRAP_LOCK_KEY },
    create: {
      key: BOOTSTRAP_LOCK_KEY,
      value: { version: 1, purpose: 'serialize first-admin bootstrap' },
    },
    update: {
      value: { version: 1, purpose: 'serialize first-admin bootstrap' },
    },
  });

  await tx.$queryRawUnsafe(
    'SELECT `key` FROM `AppSetting` WHERE `key` = ? FOR UPDATE',
    BOOTSTRAP_LOCK_KEY,
  );
}

export async function bootstrapAdmin(options: {
  source?: NodeJS.ProcessEnv;
  db?: any;
  passwordHasher?: (password: string) => Promise<string>;
  now?: Date;
} = {}): Promise<AdminBootstrapResult> {
  const config = readAdminBootstrapConfig(options.source ?? process.env);
  const db = options.db ?? prisma;
  const passwordHasher = options.passwordHasher ?? hashPassword;
  const now = options.now ?? new Date();
  const email = normalizeEmail(config.email);
  const name = normalizeName(config.name);

  try {
    return await db.$transaction(async (tx: any) => {
      await lockBootstrap(tx);

      const target = await tx.authUser.findUnique({
        where: { email },
      });

      if (target) {
        if (target.role === 'ADMIN') {
          return {
            kind: 'ALREADY_ADMIN' as const,
            userId: target.id,
            email: target.email,
            forcePasswordChange: Boolean(target.forcePasswordChange),
          };
        }

        return {
          kind: 'REFUSED_TARGET_EXISTS' as const,
          userId: target.id,
          email: target.email,
          currentRole: target.role,
        };
      }

      const adminCount = await tx.authUser.count({
        where: { role: 'ADMIN' },
      });

      if (adminCount > 0) {
        return {
          kind: 'REFUSED_ADMIN_EXISTS' as const,
          adminCount,
        };
      }

      const passwordHash = await passwordHasher(config.password);

      const created = await tx.authUser.create({
        data: {
          email,
          name,
          passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
          plan: 'PRO',
          emailVerifiedAt: now,
          proExpiresAt: null,
          forcePasswordChange: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId: created.id,
          action: 'BOOTSTRAP_ADMIN',
          targetType: 'AuthUser',
          targetId: String(created.id),
          metadata: {
            source: 'ENV_BOOTSTRAP',
            forcePasswordChange: true,
            permanentProEntitlement: true,
          },
        },
      });

      return {
        kind: 'CREATED' as const,
        userId: created.id,
        email: created.email,
        forcePasswordChange: true,
      };
    });
  } catch (error) {
    if (isUniqueError(error)) {
      const target = await db.authUser.findUnique({ where: { email } });
      if (target?.role === 'ADMIN') {
        return {
          kind: 'ALREADY_ADMIN',
          userId: target.id,
          email: target.email,
          forcePasswordChange: Boolean(target.forcePasswordChange),
        };
      }
    }
    throw error;
  }
}
