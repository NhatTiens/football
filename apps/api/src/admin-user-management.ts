import crypto from 'node:crypto';

import { prisma } from '@football-ai/database';

import {
  hashPassword,
  normalizeEmail,
  normalizeName,
  type AuthPlan,
  type AuthRole,
  type AuthUserStatus,
} from './auth.js';
import { revokeProEntitlement } from './subscription.js';

type DbClient = any;

export class AdminUserManagementError extends Error {
  constructor(
    public readonly code:
      | 'EMAIL_EXISTS'
      | 'USER_NOT_FOUND'
      | 'SELF_DELETE_FORBIDDEN'
      | 'ADMIN_DELETE_FORBIDDEN'
      | 'ALREADY_DELETED',
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminUserManagementError';
  }
}

export function deletedManagedEmail(userId: number, now: Date): string {
  return `deleted+${userId}+${now.getTime()}@deleted.invalid`;
}

export function isDeletedManagedEmail(email: string): boolean {
  return normalizeEmail(email).endsWith('@deleted.invalid');
}

export async function createAdminManagedUser(
  input: {
    adminUserId: number;
    name: string;
    email: string;
    temporaryPassword: string;
    now?: Date;
  },
  db: DbClient = prisma,
): Promise<any> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);

  const existing = await db.authUser.findUnique({ where: { email } });
  if (existing) {
    throw new AdminUserManagementError(
      'EMAIL_EXISTS',
      409,
      'Email already exists.',
    );
  }

  const passwordHash = await hashPassword(input.temporaryPassword);

  return db.$transaction(async (tx: any) => {
    const user = await tx.authUser.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        plan: 'FREE',
        emailVerifiedAt: now,
        proExpiresAt: null,
        forcePasswordChange: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: 'CREATE_USER',
        targetType: 'AuthUser',
        targetId: String(user.id),
        metadata: {
          source: 'ADMIN_USER_MANAGEMENT',
          role: 'USER',
          plan: 'FREE',
          forcePasswordChange: true,
        },
      },
    });

    return user;
  });
}

export async function deleteAdminManagedUser(
  input: {
    adminUserId: number;
    userId: number;
    now?: Date;
  },
  db: DbClient = prisma,
): Promise<{
  userId: number;
  mode: 'ANONYMIZED';
  revokedSubscriptions: number;
}> {
  const now = input.now ?? new Date();

  if (input.userId === input.adminUserId) {
    throw new AdminUserManagementError(
      'SELF_DELETE_FORBIDDEN',
      409,
      'Admin cannot delete the current admin account.',
    );
  }

  const target = await db.authUser.findUnique({
    where: { id: input.userId },
  });

  if (!target) {
    throw new AdminUserManagementError(
      'USER_NOT_FOUND',
      404,
      'User not found.',
    );
  }

  if ((target.role as AuthRole) === 'ADMIN') {
    throw new AdminUserManagementError(
      'ADMIN_DELETE_FORBIDDEN',
      409,
      'ADMIN accounts cannot be deleted from user management.',
    );
  }

  if (isDeletedManagedEmail(target.email)) {
    throw new AdminUserManagementError(
      'ALREADY_DELETED',
      409,
      'User has already been deleted.',
    );
  }

  const replacementPasswordHash = await hashPassword(
    crypto.randomBytes(32).toString('base64url'),
  );
  const deletedEmail = deletedManagedEmail(input.userId, now);

  return db.$transaction(async (tx: any) => {
    const revoked = await revokeProEntitlement(
      {
        userId: input.userId,
        reason: 'ADMIN_DELETE_USER',
        revokedBy: String(input.adminUserId),
        now,
      },
      tx as any,
    );

    await tx.authSession.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    await tx.authUser.update({
      where: { id: input.userId },
      data: {
        email: deletedEmail,
        name: `Deleted User #${input.userId}`,
        passwordHash: replacementPasswordHash,
        role: target.role as AuthRole,
        status: 'DISABLED' as AuthUserStatus,
        plan: 'FREE' as AuthPlan,
        emailVerifiedAt: null,
        proExpiresAt: null,
        forcePasswordChange: true,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        lastLoginIp: null,
        lastLoginUserAgent: null,
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: 'DELETE_USER',
        targetType: 'AuthUser',
        targetId: String(input.userId),
        metadata: {
          source: 'ADMIN_USER_MANAGEMENT',
          mode: 'ANONYMIZED',
          previousRole: target.role,
          previousStatus: target.status,
          previousPlan: target.plan,
          revokedSubscriptions: revoked.revokedSubscriptions,
        },
      },
    });

    return {
      userId: input.userId,
      mode: 'ANONYMIZED' as const,
      revokedSubscriptions: revoked.revokedSubscriptions,
    };
  });
}
