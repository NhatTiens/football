import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '@football-ai/database';

import { createAuthCode, codeExpiresAt, generateSixDigitCode, verifyAuthCode } from './auth-codes.js';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  canUseAdvancedChat,
  createAuthSession,
  hashPassword,
  isPlanActive,
  isUserAllowedToLogin,
  loadAuthUserByEmail,
  markFailedLogin,
  normalizeEmail,
  normalizeName,
  normalizePlan,
  normalizeUserStatus,
  resetFailedLogin,
  resolveAuthContext,
  roleCanManageRoles,
  serializeAuthContext,
  serializeSession,
  serializeUser,
  updateLastLogin,
  verifyPassword,
  revokeCurrentSession,
  type AuthPermissionsDto,
  type AuthPlan,
  type AuthRole,
  type AuthUserStatus,
} from './auth.js';
import { env } from './env.js';
import { sendAuthMail } from './auth-mail.js';
import { readUsage } from './auth-usage.js';
import {
  AdminUserManagementError,
  createAdminManagedUser,
  deleteAdminManagedUser,
} from './admin-user-management.js';
import {
  listAdminPayments,
  listAdminSubscriptions,
  listAdminWebhooks,
  loadAdminDashboard,
} from './admin-service.js';
import {
  grantManualProEntitlement,
  revokeProEntitlement,
} from './subscription.js';
import { getAccountPaymentsData, getAccountSubscriptionData } from './billing.js';

const router = express.Router();

const loginLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const registerLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const verificationLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const resetLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const codeSchema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().trim().min(6).max(6),
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

const loginSchema = registerSchema.pick({ email: true, password: true });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

const statusSchema = z.object({
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'DISABLED']),
});

const planSchema = z.object({
  plan: z.literal('PRO'),
  days: z.coerce.number().int().positive().optional(),
});
const adminCreateUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(255),
  temporaryPassword: z.string().min(12).max(128),
});


type SessionRecord = {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
};

type UserRecord = {
  id: number;
  email: string;
  name: string;
  role: AuthRole;
  status: AuthUserStatus;
  plan: AuthPlan;
  emailVerifiedAt: Date | null;
  proExpiresAt: Date | null;
  forcePasswordChange: boolean;
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  lastLoginUserAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserRecordWithCount = UserRecord & { _count: { sessions: number; verificationCodes: number } };

type AuthenticatedContext = {
  authenticated: true;
  user: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>['user']>;
  session: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>['session']>;
  permissions: AuthPermissionsDto;
  mustChangePassword?: boolean;
};

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
): express.RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

function allowedOrigins(): string[] {
  return env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
}

function allowWriteOrigin(request: express.Request, response: express.Response): boolean {
  const origin = request.header('origin');
  if (!origin) return true;
  if (allowedOrigins().includes(origin)) return true;
  response.status(403).json({ error: 'Invalid request origin.' });
  return false;
}

async function requireAuth(request: express.Request, response: express.Response): Promise<AuthenticatedContext | null> {
  const auth = await resolveAuthContext(request);
  if (!auth.authenticated || !auth.user || !auth.session) {
    response.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return auth as AuthenticatedContext;
}

async function requireAdmin(request: express.Request, response: express.Response): Promise<AuthenticatedContext | null> {
  const auth = await requireAuth(request, response);
  if (!auth) return null;
  if (!roleCanManageRoles(auth.user.role)) {
    response.status(403).json({ error: 'Admin role required.' });
    return null;
  }
  return auth;
}

async function loadUserById(userId: number): Promise<UserRecord | null> {
  return prisma.authUser.findUnique({ where: { id: userId } });
}

async function ensurePlanFresh(user: UserRecord): Promise<UserRecord> {
  if (user.role === 'ADMIN') {
    if (user.plan !== 'PRO' || user.proExpiresAt != null) {
      return prisma.authUser.update({
        where: { id: user.id },
        data: { plan: 'PRO', proExpiresAt: null },
      }) as Promise<UserRecord>;
    }
    return user;
  }

  if (user.plan === 'PRO' && user.proExpiresAt && user.proExpiresAt <= new Date()) {
    const updated = await prisma.authUser.update({
      where: { id: user.id },
      data: { plan: 'FREE', proExpiresAt: null },
    });
    return updated as UserRecord;
  }
  return user;
}

async function touchLogin(userId: number, request: express.Request): Promise<void> {
  await updateLastLogin({
    userId,
    ipAddress: request.ip || null,
    userAgent: request.header('user-agent')?.slice(0, 255) ?? null,
  });
}

async function createVerificationAndMail(user: UserRecord, purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'): Promise<{ previewCode: string | null }> {
  const code = generateSixDigitCode();
  const expiresAt = codeExpiresAt(
    purpose === 'EMAIL_VERIFICATION'
      ? env.AUTH_EMAIL_CODE_EXPIRE_MINUTES
      : env.AUTH_PASSWORD_RESET_CODE_EXPIRE_MINUTES,
  );
  await createAuthCode({
    userId: user.id,
    purpose,
    code,
    expiresAt,
  });
  const preview = await sendAuthMail({
    to: user.email,
    name: user.name,
    purpose,
    code,
  });
  return { previewCode: preview.debugCode };
}

function sessionPayload(session: SessionRecord, currentSessionId?: number) {
  return {
    id: session.id,
    expiresAt: session.expiresAt.toISOString(),
    lastSeenAt: session.lastSeenAt ? session.lastSeenAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
    revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    current: currentSessionId === session.id,
  };
}

router.get(
  '/me',
  asyncRoute(async (request, response) => {
    response.json(await resolveAuthContext(request));
  }),
);

router.post(
  '/register',
  registerLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = registerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid register payload.' });
      return;
    }

    const name = normalizeName(parsed.data.name);
    const email = normalizeEmail(parsed.data.email);
    const existing = await prisma.authUser.findUnique({ where: { email } });
    if (existing) {
      response.status(409).json({ error: 'Email already exists.' });
      return;
    }

    const user = (await prisma.authUser.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(parsed.data.password),
        role: 'USER',
        status: 'PENDING_VERIFICATION',
        plan: 'FREE',
        emailVerifiedAt: null,
        proExpiresAt: null,
        forcePasswordChange: false,
      },
    })) as UserRecord;

    const preview = await createVerificationAndMail(user, 'EMAIL_VERIFICATION');
    response.status(201).json({
      ok: true,
      email: user.email,
      verificationRequired: true,
      debugCode: preview.previewCode,
    });
  }),
);

router.post(
  '/email/send-verification',
  verificationLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = codeSchema.pick({ email: true }).safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const user = (await prisma.authUser.findUnique({ where: { email } })) as UserRecord | null;
    if (!user) {
      response.json({ ok: true });
      return;
    }

    const preview = await createVerificationAndMail(user, 'EMAIL_VERIFICATION');
    response.json({
      ok: true,
      email: user.email,
      debugCode: preview.previewCode,
      sent: true,
    });
  }),
);

router.post(
  '/email/resend-verification',
  verificationLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = codeSchema.pick({ email: true }).safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const user = (await prisma.authUser.findUnique({ where: { email } })) as UserRecord | null;
    if (!user) {
      response.json({ ok: true });
      return;
    }

    const preview = await createVerificationAndMail(user, 'EMAIL_VERIFICATION');
    response.json({
      ok: true,
      email: user.email,
      debugCode: preview.previewCode,
      sent: true,
    });
  }),
);

router.post(
  '/email/verify',
  verificationLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = codeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const user = (await prisma.authUser.findUnique({ where: { email } })) as UserRecord | null;
    if (!user) {
      response.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    const result = await verifyAuthCode({
      userId: user.id,
      purpose: 'EMAIL_VERIFICATION',
      code: parsed.data.code,
    });
    if (!result.ok) {
      response.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    const updated = (await prisma.authUser.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        lockedUntil: null,
      },
    })) as UserRecord;

    response.json({
      ok: true,
      email: updated.email,
      verified: true,
    });
  }),
);

router.post(
  '/login',
  loginLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid login payload.' });
      return;
    }

    const user = (await loadAuthUserByEmail(parsed.data.email)) as UserRecord | null;
    if (!user) {
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const freshUser = await ensurePlanFresh(user);
    if (freshUser.status === 'DISABLED') {
      response.status(403).json({ error: 'Account disabled.' });
      return;
    }
    if (!isUserAllowedToLogin(freshUser)) {
      response.status(403).json({
        error: 'Email verification required.',
        requiresVerification: true,
      });
      return;
    }
    if (freshUser.lockedUntil && freshUser.lockedUntil > new Date()) {
      response.status(423).json({
        error: 'Account temporarily locked.',
        lockedUntil: freshUser.lockedUntil.toISOString(),
      });
      return;
    }

    const valid = await verifyPassword(freshUser.passwordHash, parsed.data.password);
    if (!valid) {
      await markFailedLogin(freshUser.id);
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    await resetFailedLogin(freshUser.id);
    await touchLogin(freshUser.id, request);

    const session = await createAuthSession({ userId: freshUser.id, request });
    const current = (await loadUserById(freshUser.id)) ?? freshUser;
    const sessionRow = (await prisma.authSession.findUnique({
      where: { id: session.sessionId },
    })) as SessionRecord | null;

    response.setHeader('Set-Cookie', buildSessionCookie(session.token, session.expiresAt));
    response.json({
      ...serializeAuthContext({
        user: serializeUser(current),
        session: serializeSession({
          id: session.sessionId,
          expiresAt: session.expiresAt,
          lastSeenAt: sessionRow?.lastSeenAt ?? null,
          createdAt: sessionRow?.createdAt ?? new Date(),
        }),
      }),
      mustChangePassword: current.forcePasswordChange,
    });
  }),
);

router.post(
  '/logout',
  asyncRoute(async (request, response) => {
    await revokeCurrentSession(request);
    response.setHeader('Set-Cookie', buildClearedSessionCookie());
    response.json({ ok: true });
  }),
);

router.post(
  '/logout-all',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    await prisma.authSession.updateMany({
      where: { userId: auth.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    response.setHeader('Set-Cookie', buildClearedSessionCookie());
    response.json({ ok: true });
  }),
);

router.post(
  '/password/forgot',
  resetLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = codeSchema.pick({ email: true }).safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const user = (await prisma.authUser.findUnique({ where: { email } })) as UserRecord | null;
    if (!user) {
      response.json({ ok: true });
      return;
    }

    const preview = await createVerificationAndMail(user, 'PASSWORD_RESET');
    response.json({
      ok: true,
      email: user.email,
      debugCode: preview.previewCode,
    });
  }),
);

router.post(
  '/password/reset',
  resetLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const parsed = z
      .object({
        email: z.string().trim().email().max(255),
        code: z.string().trim().min(6).max(6),
        password: z.string().min(8).max(128),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const user = (await prisma.authUser.findUnique({ where: { email } })) as UserRecord | null;
    if (!user) {
      response.status(400).json({ error: 'Invalid reset code.' });
      return;
    }

    const result = await verifyAuthCode({
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      code: parsed.data.code,
    });
    if (!result.ok) {
      response.status(400).json({ error: 'Invalid reset code.' });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.authUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        forcePasswordChange: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    response.json({ ok: true });
  }),
);

router.post(
  '/password/change',
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const parsed = changePasswordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    const user = (await loadUserById(auth.user.id)) as UserRecord | null;
    if (!user) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    const valid = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
    if (!valid) {
      response.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.authUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        forcePasswordChange: false,
      },
    });
    await prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: auth.session.id } },
      data: { revokedAt: new Date() },
    });
    response.json({ ok: true });
  }),
);

router.get(
  '/account',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const user = (await loadUserById(auth.user.id)) as UserRecord | null;
    if (!user) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    const fresh = await ensurePlanFresh(user);
    response.json({
      user: serializeUser(fresh),
      permissions: {
        chat: true,
        advancedChat: canUseAdvancedChat({
          role: fresh.role,
          plan: fresh.plan,
          proExpiresAt: fresh.proExpiresAt,
        }),
        roleManagement: roleCanManageRoles(fresh.role),
      },
    });
  }),
);

router.patch(
  '/account/profile',
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const parsed = profileSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid payload.' });
      return;
    }
    const updated = (await prisma.authUser.update({
      where: { id: auth.user.id },
      data: { name: normalizeName(parsed.data.name) },
    })) as UserRecord;
    response.json({ user: serializeUser(updated) });
  }),
);

router.get(
  '/account/sessions',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const sessions = (await prisma.authSession.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    })) as SessionRecord[];
    response.json({
      sessions: sessions.map((session) => sessionPayload(session, auth.session.id)),
    });
  }),
);

router.delete(
  '/account/sessions/:id',
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const sessionId = Number(request.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      response.status(400).json({ error: 'Invalid session id.' });
      return;
    }

    const session = (await prisma.authSession.findFirst({
      where: { id: sessionId, userId: auth.user.id },
    })) as SessionRecord | null;
    if (!session) {
      response.status(404).json({ error: 'Session not found.' });
      return;
    }

    await prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    if (session.id === auth.session.id) {
      response.setHeader('Set-Cookie', buildClearedSessionCookie());
    }
    response.json({ ok: true });
  }),
);

router.get(
  '/account/subscription',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const data = await getAccountSubscriptionData(auth.user.id);
    if (!data) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    response.json(data);
  }),
);

router.get(
  '/account/usage',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const user = (await loadUserById(auth.user.id)) as UserRecord | null;
    if (!user) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    const fresh = await ensurePlanFresh(user);
    const [basic, advanced] = await Promise.all([
      readUsage({
        userId: fresh.id,
        plan: fresh.plan,
        feature: 'CHAT_BASIC',
      }),
      readUsage({
        userId: fresh.id,
        plan: fresh.plan,
        feature: 'CHAT_ADVANCED',
      }),
    ]);
    response.json({
      quotaUsed: basic.used + advanced.used,
      quotaLimit: basic.limit == null ? null : basic.limit + (advanced.limit ?? 0),
      quotaRemaining:
        basic.remaining == null || advanced.remaining == null
          ? null
          : basic.remaining + advanced.remaining,
      resetAt: basic.resetAt,
      features: { basic, advanced },
    });
  }),
);

router.get(
  '/account/payments',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
      : 50;
    response.json(await getAccountPaymentsData(auth.user.id, limit));
  }),
);

router.get(
  '/admin/users',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    const users = (await prisma.authUser.findMany({
      where: {
        NOT: { email: { endsWith: '@deleted.invalid' } },
        ...(query
          ? {
              OR: [{ email: { contains: query } }, { name: { contains: query } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      include: { _count: { select: { sessions: true, verificationCodes: true } } },
    })) as UserRecordWithCount[];
    response.json({
      users: users.map((user) => ({ ...serializeUser(user), sessionCount: user._count.sessions })),
    });
  }),
);

router.post(
  '/admin/users',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    if (!allowWriteOrigin(request, response)) return;

    const parsed = adminCreateUserSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid admin create-user payload.' });
      return;
    }

    try {
      const created = (await createAdminManagedUser({
        adminUserId: auth.user.id,
        name: parsed.data.name,
        email: parsed.data.email,
        temporaryPassword: parsed.data.temporaryPassword,
      })) as UserRecord;

      response.status(201).json({
        user: serializeUser(created),
      });
    } catch (error) {
      if (error instanceof AdminUserManagementError) {
        response.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      throw error;
    }
  }),
);

router.delete(
  '/admin/users/:id',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    if (!allowWriteOrigin(request, response)) return;

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    try {
      const deleted = await deleteAdminManagedUser({
        adminUserId: auth.user.id,
        userId: id,
      });

      response.json({
        ok: true,
        deletedUserId: deleted.userId,
        mode: deleted.mode,
        revokedSubscriptions: deleted.revokedSubscriptions,
      });
    } catch (error) {
      if (error instanceof AdminUserManagementError) {
        response.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      throw error;
    }
  }),
);

router.get(
  '/admin/users/:id',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }
    const user = (await prisma.authUser.findUnique({
      where: { id },
      include: { _count: { select: { sessions: true, verificationCodes: true } } },
    })) as UserRecordWithCount | null;
    if (!user) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    const sessions = (await prisma.authSession.findMany({
      where: { userId: user.id },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    })) as SessionRecord[];
    response.json({
      user: { ...serializeUser(user), sessionCount: user._count.sessions, verificationCodeCount: user._count.verificationCodes },
      sessions: sessions.map((session) => sessionPayload(session)),
    });
  }),
);

router.patch(
  '/admin/users/:id/status',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    if (!allowWriteOrigin(request, response)) return;
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }
    const parsed = statusSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status payload.' });
      return;
    }
    if (id === auth.user.id && parsed.data.status === 'DISABLED') {
      response.status(409).json({ error: 'Admin cannot disable the current admin session account.' });
      return;
    }

    const before = (await loadUserById(id)) as UserRecord | null;
    if (!before) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }

    if (before.role === 'ADMIN' && id !== auth.user.id) {
      response.status(409).json({ error: 'ADMIN account status cannot be changed from user management.' });
      return;
    }

    const updated = (await prisma.$transaction(async (tx: any) => {
      const changed = (await tx.authUser.update({
        where: { id },
        data: { status: parsed.data.status },
      })) as UserRecord;

      if (parsed.data.status === 'DISABLED') {
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          adminUserId: auth.user.id,
          action: 'SET_USER_STATUS',
          targetType: 'AuthUser',
          targetId: String(id),
          metadata: {
            before: before.status,
            after: parsed.data.status,
          },
        },
      });

      return changed;
    })) as UserRecord;

    response.json({ user: serializeUser(updated) });
  }),
);

router.post(
  '/admin/users/:id/grant-pro',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    if (!allowWriteOrigin(request, response)) return;

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    const parsed = planSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid plan payload.' });
      return;
    }

    const days = parsed.data.days ?? env.PRO_PLAN_DAYS;
    const current = (await loadUserById(id)) as UserRecord | null;
    if (!current) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    if (current.role === 'ADMIN') {
      response.status(409).json({ error: 'ADMIN accounts always have PRO entitlement.' });
      return;
    }

    const entitlement = await prisma.$transaction(async (tx: any) => {
      const granted = await grantManualProEntitlement(
        {
          userId: id,
          days,
          adminUserId: auth.user.id,
          reason: 'ADMIN_GRANT_PRO',
        },
        tx as any,
      );

      await tx.adminAuditLog.create({
        data: {
          adminUserId: auth.user.id,
          action: 'GRANT_PRO',
          targetType: 'AuthUser',
          targetId: String(id),
          metadata: {
            days,
            subscriptionId: granted.subscriptionId,
            startsAt: granted.startsAt.toISOString(),
            expiresAt: granted.expiresAt.toISOString(),
          },
        },
      });

      return granted;
    });

    const updated = (await loadUserById(id)) as UserRecord;
    response.json({
      user: serializeUser(updated),
      entitlement: {
        subscriptionId: entitlement.subscriptionId,
        startsAt: entitlement.startsAt.toISOString(),
        expiresAt: entitlement.expiresAt.toISOString(),
      },
    });
  }),
);
router.post(
  '/admin/users/:id/revoke-pro',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    if (!allowWriteOrigin(request, response)) return;

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    const current = (await loadUserById(id)) as UserRecord | null;
    if (!current) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }
    if (current.role === 'ADMIN') {
      response.status(409).json({ error: 'ADMIN PRO entitlement cannot be revoked.' });
      return;
    }

    const revoked = await prisma.$transaction(async (tx: any) => {
      const result = await revokeProEntitlement(
        {
          userId: id,
          reason: 'ADMIN_REVOKE_PRO',
          revokedBy: String(auth.user.id),
        },
        tx as any,
      );

      await tx.adminAuditLog.create({
        data: {
          adminUserId: auth.user.id,
          action: 'REVOKE_PRO',
          targetType: 'AuthUser',
          targetId: String(id),
          metadata: {
            revokedSubscriptions: result.revokedSubscriptions,
          },
        },
      });

      return result;
    });

    const updated = (await loadUserById(id)) as UserRecord;
    response.json({
      user: serializeUser(updated),
      revokedSubscriptions: revoked.revokedSubscriptions,
    });
  }),
);
router.post(
  '/admin/users/:id/revoke-sessions',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    if (!allowWriteOrigin(request, response)) return;
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }
    await prisma.authSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: auth.user.id,
        action: 'REVOKE_SESSIONS',
        targetType: 'AuthUser',
        targetId: String(id),
      },
    });
    response.json({ ok: true });
  }),
);

router.get(
  '/admin/payments',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;

    const status = z
      .enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'])
      .optional()
      .safeParse(typeof request.query.status === 'string' ? request.query.status : undefined);
    if (!status.success) {
      response.status(400).json({ error: 'Invalid payment status.' });
      return;
    }

    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    response.json({
      payments: await listAdminPayments({ status: status.data, limit }),
    });
  }),
);

router.get(
  '/admin/subscriptions',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;

    const status = z
      .enum(['ACTIVE', 'EXPIRED', 'REVOKED'])
      .optional()
      .safeParse(typeof request.query.status === 'string' ? request.query.status : undefined);
    if (!status.success) {
      response.status(400).json({ error: 'Invalid subscription status.' });
      return;
    }

    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    response.json({
      subscriptions: await listAdminSubscriptions({ status: status.data, limit }),
    });
  }),
);

router.get(
  '/admin/webhooks',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;

    const processingStatus =
      typeof request.query.processingStatus === 'string'
        ? request.query.processingStatus.trim().slice(0, 64)
        : undefined;
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));

    response.json({
      webhooks: await listAdminWebhooks({ processingStatus, limit }),
    });
  }),
);

router.get(
  '/admin/audit',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, Number(request.query.limit ?? 50))),
    });
    response.json({ rows });
  }),
);

router.get(
  '/admin/dashboard',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    response.json(await loadAdminDashboard());
  }),
);

export { router as authRouter };
