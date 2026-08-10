const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

export type AuthRole = 'USER' | 'ANALYST' | 'ADMIN';

export interface PublicAuthUser {
  id: number;
  email: string;
  name: string;
  role: AuthRole;
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
  createdAt: string;
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
}

export interface AdminAuthUser extends PublicAuthUser {
  sessionCount: number;
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
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
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
}): Promise<AuthMeResponse> {
  return authFetch<AuthMeResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logoutAuth(): Promise<void> {
  await authFetch<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export async function listAuthUsers(): Promise<{ users: AdminAuthUser[] }> {
  return authFetch<{ users: AdminAuthUser[] }>('/auth/admin/users');
}

export async function updateAuthUserRole(input: {
  userId: number;
  role: AuthRole;
}): Promise<{ user: AdminAuthUser }> {
  return authFetch<{ user: AdminAuthUser }>(`/auth/admin/users/${input.userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role: input.role }),
  });
}

export const ADVANCED_CHAT_ROLES: ReadonlySet<AuthRole> = new Set(['ANALYST', 'ADMIN']);
