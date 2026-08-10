import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '@football-ai/database';

import {
  AuthRole,
  type AuthContextDto,
  type AuthSessionDto,
  type AuthUserDto,
  buildClearedSessionCookie,
  buildSessionCookie,
  createAuthSession,
  hashPassword,
  loadAuthUserByEmail,
  normalizeEmail,
  normalizeName,
  revokeCurrentSession,
  resetFailedLogin,
  resolveAuthContext,
  roleCanManageRoles,
  serializeAuthContext,
  serializeSession,
  serializeUser,
  markFailedLogin,
  verifyPassword,
} from './auth.js';

const router = express.Router();

const loginLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

const loginSchema = registerSchema.pick({ email: true, password: true });

const roleSchema = z.object({
  role: z.enum(['USER', 'ANALYST', 'ADMIN']),
});

type AuthenticatedContext = AuthContextDto & {
  authenticated: true;
  user: AuthUserDto;
  session: AuthSessionDto;
};

type AdminUserRecord = {
  id: number;
  email: string;
  name: string;
  role: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  lastLoginUserAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { sessions: number };
};

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
): express.RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

async function requireAuth(request: express.Request, response: express.Response): Promise<
  AuthenticatedContext | null
> {
  const auth = await resolveAuthContext(request);
  if (!auth.authenticated || !auth.user || !auth.session) {
    response.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return auth as AuthenticatedContext;
}

router.get(
  '/me',
  asyncRoute(async (request, response) => {
    const auth = await resolveAuthContext(request);
    response.json(auth);
  }),
);

router.post(
  '/register',
  loginLimit,
  asyncRoute(async (request, response) => {
    const parsed = registerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid register payload.' });
      return;
    }

    const name = normalizeName(parsed.data.name);
    const email = normalizeEmail(parsed.data.email);
    const password = parsed.data.password;

    const existing = await prisma.authUser.findUnique({ where: { email } });
    if (existing) {
      response.status(409).json({ error: 'Email already exists.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    let user = await prisma.authUser.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'USER',
      },
    });

    const session = await createAuthSession({ userId: user.id, request });
    await prisma.authUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: request.ip || null,
        lastLoginUserAgent: request.header('user-agent')?.slice(0, 255) ?? null,
      },
    });
    user = (await prisma.authUser.findUnique({ where: { id: user.id } })) ?? user;
    response.setHeader('Set-Cookie', buildSessionCookie(session.token, session.expiresAt));
    response.status(201).json(
      serializeAuthContext({
        user: serializeUser(user),
        session: serializeSession({
          id: session.sessionId,
          expiresAt: session.expiresAt,
          lastSeenAt: null,
          createdAt: new Date(),
        }),
      }),
    );
  }),
);

router.post(
  '/login',
  loginLimit,
  asyncRoute(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid login payload.' });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const user = await loadAuthUserByEmail(email);
    if (!user) {
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      response.status(423).json({
        error: 'Account temporarily locked.',
        lockedUntil: user.lockedUntil.toISOString(),
      });
      return;
    }

    const isValid = await verifyPassword(user.passwordHash, parsed.data.password);
    if (!isValid) {
      await markFailedLogin(user.id);
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    await resetFailedLogin(user.id);
    const session = await createAuthSession({ userId: user.id, request });
    await prisma.authUser.update({
      where: { id: user.id },
      data: {
        lastLoginIp: request.ip || null,
        lastLoginUserAgent: request.header('user-agent')?.slice(0, 255) ?? null,
      },
    });
    const refreshedUser = (await prisma.authUser.findUnique({ where: { id: user.id } })) ?? user;

    response.setHeader('Set-Cookie', buildSessionCookie(session.token, session.expiresAt));
    response.json(
      serializeAuthContext({
        user: serializeUser(refreshedUser),
        session: serializeSession({
          id: session.sessionId,
          expiresAt: session.expiresAt,
          lastSeenAt: null,
          createdAt: new Date(),
        }),
      }),
    );
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

router.get(
  '/admin/users',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const currentUser = auth.user;
    if (!roleCanManageRoles(currentUser.role)) {
      response.status(403).json({ error: 'Admin role required.' });
      return;
    }

    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50)));
    const users = (await prisma.authUser.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query } },
              { name: { contains: query } },
            ],
          }
        : undefined,
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
      take: limit,
      include: { _count: { select: { sessions: true } } },
    })) as AdminUserRecord[];

    response.json({
      users: users.map((user) => ({
        ...serializeUser(user),
        sessionCount: user._count.sessions,
      })),
    });
  }),
);

router.patch(
  '/admin/users/:id/role',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const currentUser = auth.user;
    if (!roleCanManageRoles(currentUser.role)) {
      response.status(403).json({ error: 'Admin role required.' });
      return;
    }

    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid user id.' });
      return;
    }

    const parsed = roleSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid role payload.' });
      return;
    }

    const updatedUser = (await prisma.authUser.update({
      where: { id },
      data: { role: parsed.data.role as AuthRole },
      include: { _count: { select: { sessions: true } } },
    })) as AdminUserRecord;

    response.json({
      user: {
        ...serializeUser(updatedUser),
        sessionCount: updatedUser._count.sessions,
      },
    });
  }),
);

export { router as authRouter };
