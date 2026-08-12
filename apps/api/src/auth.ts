import crypto from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { prisma } from '@football-ai/database';

import { env } from './env.js';

export type AuthRole = 'USER' | 'ANALYST' | 'ADMIN';
export type AuthPlan = 'FREE' | 'PRO';
export type AuthUserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';
export type AuthCodePurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface AuthUserDto {
  id: number;
  email: string;
  name: string;
  role: AuthRole;
  status: AuthUserStatus;
  plan: AuthPlan;
  emailVerifiedAt: string | null;
  proExpiresAt: string | null;
  forcePasswordChange: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastLoginUserAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionDto {
  id: number;
  expiresAt: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AuthPermissionsDto {
  chat: boolean;
  advancedChat: boolean;
  roleManagement: boolean;
}

export interface AuthContextDto {
  authenticated: boolean;
  user: AuthUserDto | null;
  session: AuthSessionDto | null;
  permissions: AuthPermissionsDto;
}

const PASSWORD_HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const ROLE_ORDER: Record<AuthRole, number> = {
  USER: 0,
  ANALYST: 1,
  ADMIN: 2,
};

const BASIC_CHAT_INTENTS = new Set(['PREDICTION', 'DISCOVERY']);

function cookieName(): string {
  return env.AUTH_SESSION_COOKIE_NAME;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires != null) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.path != null) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite != null) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeRole(value: string): AuthRole | null {
  const role = value.toUpperCase();
  return role === 'USER' || role === 'ANALYST' || role === 'ADMIN' ? role : null;
}

export function normalizePlan(value: string): AuthPlan | null {
  const plan = value.toUpperCase();
  return plan === 'FREE' || plan === 'PRO' ? plan : null;
}

export function normalizeUserStatus(value: string): AuthUserStatus | null {
  const status = value.toUpperCase();
  return status === 'PENDING_VERIFICATION' || status === 'ACTIVE' || status === 'DISABLED'
    ? status
    : null;
}

export function isPlanActive(plan: AuthPlan, proExpiresAt: Date | null): boolean {
  return plan === 'PRO' && (proExpiresAt == null || proExpiresAt.getTime() > Date.now());
}

export function effectivePlan(role: AuthRole, storedPlan: AuthPlan): AuthPlan {
  return role === 'ADMIN' ? 'PRO' : storedPlan;
}

export function effectiveProExpiresAt(
  role: AuthRole,
  storedProExpiresAt: Date | null,
): Date | null {
  return role === 'ADMIN' ? null : storedProExpiresAt;
}

export function canUseAdvancedChat(user: { role: AuthRole; plan: AuthPlan; proExpiresAt: Date | null }): boolean {
  return user.role === 'ADMIN' || isPlanActive(user.plan, user.proExpiresAt);
}

export function roleCanAccessIntent(
  role: AuthRole,
  intent: string,
  plan: AuthPlan = 'FREE',
  proExpiresAt: Date | null = null,
): boolean {
  if (role === 'ADMIN') return true;
  if (BASIC_CHAT_INTENTS.has(intent)) return true;
  return canUseAdvancedChat({ role, plan, proExpiresAt });
}

export function roleCanManageRoles(role: AuthRole): boolean {
  return role === 'ADMIN';
}

export function buildAuthPermissions(input: {
  role: AuthRole;
  plan: AuthPlan;
  proExpiresAt: Date | null;
}): AuthPermissionsDto {
  return {
    chat: true,
    advancedChat: canUseAdvancedChat(input),
    roleManagement: input.role === 'ADMIN',
  };
}

export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, PASSWORD_HASH_OPTIONS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2Verify(hash, password, PASSWORD_HASH_OPTIONS);
}

export function buildSessionCookie(token: string, expiresAt: Date): string {
  return serializeCookie(cookieName(), token, {
    expires: expiresAt,
    httpOnly: true,
    sameSite: 'Lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  });
}

export function buildClearedSessionCookie(): string {
  return serializeCookie(cookieName(), '', {
    expires: new Date(0),
    httpOnly: true,
    sameSite: 'Lax',
    secure: cookieSecure(),
    path: '/',
  });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      const rawValue = rest.join('=');
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
  }
  return null;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function userDto(user: {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  plan: string;
  emailVerifiedAt: Date | null;
  proExpiresAt: Date | null;
  forcePasswordChange: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  lastLoginUserAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AuthUserDto {
  const role = normalizeRole(user.role);
  if (!role) {
    throw new Error(`Unsupported auth role: ${user.role}`);
  }
  const status = normalizeUserStatus(user.status);
  if (!status) {
    throw new Error(`Unsupported auth status: ${user.status}`);
  }
  const storedPlan = normalizePlan(user.plan);
  if (!storedPlan) {
    throw new Error(`Unsupported auth plan: ${user.plan}`);
  }
  const plan = effectivePlan(role, storedPlan);
  const proExpiresAt = effectiveProExpiresAt(role, user.proExpiresAt);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    status,
    plan,
    emailVerifiedAt: toIso(user.emailVerifiedAt),
    proExpiresAt: toIso(proExpiresAt),
    forcePasswordChange: user.forcePasswordChange,
    failedLoginCount: user.failedLoginCount,
    lockedUntil: toIso(user.lockedUntil),
    lastLoginAt: toIso(user.lastLoginAt),
    lastLoginIp: user.lastLoginIp,
    lastLoginUserAgent: user.lastLoginUserAgent,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function sessionDto(session: {
  id: number;
  expiresAt: Date;
  lastSeenAt: Date | null;
  createdAt: Date;
}): AuthSessionDto {
  return {
    id: session.id,
    expiresAt: session.expiresAt.toISOString(),
    lastSeenAt: toIso(session.lastSeenAt),
    createdAt: session.createdAt.toISOString(),
  };
}

export function serializeAuthContext(input: {
  user: AuthUserDto;
  session: AuthSessionDto;
}): AuthContextDto {
  return {
    authenticated: true,
    user: input.user,
    session: input.session,
    permissions: buildAuthPermissions({
      role: input.user.role,
      plan: input.user.plan,
      proExpiresAt: input.user.proExpiresAt ? new Date(input.user.proExpiresAt) : null,
    }),
  };
}

export async function resolveAuthContext(request: Request): Promise<AuthContextDto> {
  const token = readCookie(request, cookieName());
  if (!token) {
    return {
      authenticated: false,
      user: null,
      session: null,
      permissions: { chat: false, advancedChat: false, roleManagement: false },
    };
  }

  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const session = await prisma.authSession.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: { user: true },
  });

  if (!session) {
    return {
      authenticated: false,
      user: null,
      session: null,
      permissions: { chat: false, advancedChat: false, roleManagement: false },
    };
  }

  await prisma.authSession
    .update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    })
    .catch(() => undefined);

  const user = userDto(session.user);
  if (user.status === 'DISABLED') {
    return {
      authenticated: false,
      user: null,
      session: null,
      permissions: { chat: false, advancedChat: false, roleManagement: false },
    };
  }
  return serializeAuthContext({
    user,
    session: sessionDto({
      id: session.id,
      expiresAt: session.expiresAt,
      lastSeenAt: now,
      createdAt: session.createdAt,
    }),
  });
}

export async function createAuthSession(input: {
  userId: number;
  request: Request;
}): Promise<{ token: string; expiresAt: Date; sessionId: number }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_TTL_DAYS * 86_400_000);
  const created = await prisma.authSession.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ipAddress: input.request.ip || null,
      userAgent: input.request.header('user-agent')?.slice(0, 255) ?? null,
    },
    select: { id: true },
  });

  return { token, expiresAt, sessionId: created.id };
}

export async function revokeCurrentSession(request: Request): Promise<void> {
  const token = readCookie(request, cookieName());
  if (!token) return;
  const tokenHash = hashSessionToken(token);
  await prisma.authSession
    .updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
}

export async function markFailedLogin(userId: number): Promise<void> {
  const user = await prisma.authUser.findUnique({
    where: { id: userId },
    select: { failedLoginCount: true },
  });
  if (!user) return;

  const failedLoginCount = user.failedLoginCount + 1;
  const shouldLock = failedLoginCount >= env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS;
  await prisma.authUser.update({
    where: { id: userId },
    data: {
      failedLoginCount,
      lockedUntil: shouldLock ? new Date(Date.now() + env.AUTH_LOCK_MINUTES * 60_000) : null,
    },
  });
}

export async function resetFailedLogin(userId: number): Promise<void> {
  await prisma.authUser.update({
    where: { id: userId },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });
}

export async function updateLastLogin(input: {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  await prisma.authUser.update({
    where: { id: input.userId },
    data: {
      lastLoginIp: input.ipAddress,
      lastLoginUserAgent: input.userAgent,
      lastLoginAt: new Date(),
    },
  });
}

export async function loadAuthUserByEmail(email: string): Promise<{
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  plan: string;
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
} | null> {
  return prisma.authUser.findUnique({
    where: { email: normalizeEmail(email) },
  });
}

export function parseRole(value: unknown): AuthRole | null {
  return typeof value === 'string' ? normalizeRole(value) : null;
}

export function serializeUser(user: {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  plan: string;
  emailVerifiedAt: Date | null;
  proExpiresAt: Date | null;
  forcePasswordChange: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  lastLoginUserAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AuthUserDto {
  return userDto(user);
}

export function serializeSession(session: {
  id: number;
  expiresAt: Date;
  lastSeenAt: Date | null;
  createdAt: Date;
}): AuthSessionDto {
  return sessionDto(session);
}

export function isUserActive(user: { status: AuthUserStatus }): boolean {
  return user.status === 'ACTIVE';
}

export function isUserVerified(user: { emailVerifiedAt: string | null }): boolean {
  return user.emailVerifiedAt != null;
}

export function isUserAllowedToLogin(user: { status: AuthUserStatus; emailVerifiedAt: Date | null }): boolean {
  return user.status === 'ACTIVE' && user.emailVerifiedAt != null;
}

export function withAuthContext(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void> | void,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
