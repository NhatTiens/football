const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(
  /\/$/,
  '',
);

export type AuthRole = 'USER' | 'ANALYST' | 'ADMIN';
export type AuthPlan = 'FREE' | 'PRO';
export type AuthUserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';

export interface PublicAuthUser {
  id: number;
  email: string;
  name: string;
  role: AuthRole;
  status: AuthUserStatus;
  plan: AuthPlan;
  emailVerifiedAt: string | null;
  proExpiresAt: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  forcePasswordChange: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionInfo {
  id: number;
  expiresAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  current?: boolean;
}

export interface AuthPermissions {
  chat: boolean;
  advancedChat: boolean;
  roleManagement: boolean;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: PublicAuthUser | null;
  session: AuthSessionInfo | null;
  permissions: AuthPermissions;
  mustChangePassword?: boolean;
}

export interface RegisterResponse {
  ok: true;
  email: string;
  verificationRequired: boolean;
  debugCode: string | null;
}

export interface VerificationResponse {
  ok: true;
  email: string;
  verified: boolean;
  debugCode?: string | null;
}

export interface PasswordFlowResponse {
  ok: true;
  email?: string;
  debugCode?: string | null;
}

export interface AccountSessionsResponse {
  sessions: AuthSessionInfo[];
}

export interface AccountUsageFeature {
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
}

export interface AccountUsageResponse {
  quotaUsed: number;
  quotaLimit: number | null;
  quotaRemaining: number | null;
  resetAt: string;
  features: {
    basic: AccountUsageFeature;
    advanced: AccountUsageFeature;
  };
}

export type AccountSubscriptionHistoryStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface AccountSubscriptionHistoryItem {
  id: number;
  planCode: string;
  status: AccountSubscriptionHistoryStatus;
  startsAt: string | null;
  expiresAt: string | null;
  sourcePaymentOrderId: number | null;
  createdAt: string | null;
}

export interface AccountSubscriptionResponse {
  role: AuthRole;
  status: AuthUserStatus;
  plan: AuthPlan;
  emailVerifiedAt: string | null;
  proExpiresAt: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  forcePasswordChange: boolean;
  canAccessAdvancedChat: boolean;
  subscriptions: AccountSubscriptionHistoryItem[];
}

export interface AdminAuthUser extends PublicAuthUser {
  sessionCount: number;
  verificationCodeCount?: number;
}

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(payload?.error ?? payload?.message ?? `API ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getAuthMe(): Promise<AuthMeResponse> {
  return authFetch<AuthMeResponse>('/auth/me');
}

export async function loginAuth(input: {
  email: string;
  password: string;
}): Promise<AuthMeResponse> {
  return authFetch<AuthMeResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function registerAuth(input: {
  name: string;
  email: string;
  password: string;
}): Promise<RegisterResponse> {
  return authFetch<RegisterResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function sendVerificationAuth(input: {
  email: string;
}): Promise<VerificationResponse> {
  return authFetch<VerificationResponse>('/auth/email/send-verification', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function resendVerificationAuth(input: {
  email: string;
}): Promise<VerificationResponse> {
  return authFetch<VerificationResponse>('/auth/email/resend-verification', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyEmailAuth(input: {
  email: string;
  code: string;
}): Promise<VerificationResponse> {
  return authFetch<VerificationResponse>('/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function forgotPasswordAuth(input: { email: string }): Promise<PasswordFlowResponse> {
  return authFetch<PasswordFlowResponse>('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function resetPasswordAuth(input: {
  email: string;
  code: string;
  password: string;
}): Promise<PasswordFlowResponse> {
  return authFetch<PasswordFlowResponse>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function changePasswordAuth(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true }> {
  return authFetch<{ ok: true }>('/auth/password/change', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logoutAuth(): Promise<void> {
  await authFetch<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export async function logoutAllAuth(): Promise<void> {
  await authFetch<{ ok: true }>('/auth/logout-all', { method: 'POST' });
}

export async function getAccountAuth(): Promise<{
  user: PublicAuthUser;
  permissions: AuthPermissions;
}> {
  return authFetch<{ user: PublicAuthUser; permissions: AuthPermissions }>('/account');
}

export async function updateAccountProfileAuth(input: {
  name: string;
}): Promise<{ user: PublicAuthUser }> {
  return authFetch<{ user: PublicAuthUser }>('/account/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listAuthSessions(): Promise<AccountSessionsResponse> {
  return authFetch<AccountSessionsResponse>('/account/sessions');
}

export async function deleteAuthSession(sessionId: number): Promise<{ ok: true }> {
  return authFetch<{ ok: true }>(`/account/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function getAccountSubscription(): Promise<AccountSubscriptionResponse> {
  return authFetch<AccountSubscriptionResponse>('/account/subscription');
}

export async function getAccountUsage(): Promise<AccountUsageResponse> {
  return authFetch<AccountUsageResponse>('/account/usage');
}

export async function listAuthUsers(): Promise<{ users: AdminAuthUser[] }> {
  return authFetch<{ users: AdminAuthUser[] }>('/admin/users');
}

export async function getAuthUserDetail(userId: number): Promise<{
  user: AdminAuthUser;
  sessions: AuthSessionInfo[];
}> {
  return authFetch<{ user: AdminAuthUser; sessions: AuthSessionInfo[] }>(`/admin/users/${userId}`);
}

export async function updateAuthUserRole(input: {
  userId: number;
  role: AuthRole;
}): Promise<{ user: AdminAuthUser }> {
  return authFetch<{ user: AdminAuthUser }>(`/admin/users/${input.userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role: input.role }),
  });
}

export async function updateAuthUserStatus(input: {
  userId: number;
  status: AuthUserStatus;
}): Promise<{ user: PublicAuthUser }> {
  return authFetch<{ user: PublicAuthUser }>(`/admin/users/${input.userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: input.status }),
  });
}

export async function grantProAuth(input: {
  userId: number;
  days?: number;
}): Promise<{ user: PublicAuthUser }> {
  return authFetch<{ user: PublicAuthUser }>(`/admin/users/${input.userId}/grant-pro`, {
    method: 'POST',
    body: JSON.stringify({ plan: 'PRO', days: input.days }),
  });
}

export async function revokeProAuth(userId: number): Promise<{ user: PublicAuthUser }> {
  return authFetch<{ user: PublicAuthUser }>(`/admin/users/${userId}/revoke-pro`, {
    method: 'POST',
  });
}

export async function revokeUserSessionsAuth(userId: number): Promise<{ ok: true }> {
  return authFetch<{ ok: true }>(`/admin/users/${userId}/revoke-sessions`, {
    method: 'POST',
  });
}

export async function listAdminAudit(): Promise<{ rows: Array<Record<string, unknown>> }> {
  return authFetch<{ rows: Array<Record<string, unknown>> }>('/admin/audit');
}

export async function getAdminDashboard(): Promise<Record<string, unknown>> {
  return authFetch<Record<string, unknown>>('/admin/dashboard');
}

export const ADVANCED_CHAT_ROLES: ReadonlySet<AuthRole> = new Set(['ADMIN']);
