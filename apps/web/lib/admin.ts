const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(
  /\/$/,
  '',
);

export type AdminPaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type AdminSubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type AdminUserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';
export type AdminUserRole = 'USER' | 'ANALYST' | 'ADMIN';
export type AdminPlan = 'FREE' | 'PRO';

export interface AdminUserSummary {
  id: number;
  email: string;
  name: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  plan: AdminPlan;
  emailVerifiedAt: string | null;
  proExpiresAt: string | null;
  forcePasswordChange: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessionCount?: number;
}

export interface AdminPayment {
  id: number;
  userId?: number;
  orderCode: string;
  planCode: string;
  amountVnd: number;
  status: AdminPaymentStatus;
  provider: string;
  providerTransactionId: string | null;
  transferContent?: string;
  expiresAt?: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: {
    id: number;
    email: string;
    name: string;
    plan?: AdminPlan;
  };
}

export interface AdminSubscription {
  id: number;
  userId: number;
  planCode: string;
  status: AdminSubscriptionStatus;
  startsAt: string;
  expiresAt: string;
  sourcePaymentOrderId: number | null;
  createdAt: string;
  user?: {
    id: number;
    email: string;
    name: string;
    plan: AdminPlan;
    proExpiresAt: string | null;
  };
  sourcePaymentOrder?: {
    id: number;
    orderCode: string;
    amountVnd: number;
    status: AdminPaymentStatus;
  } | null;
}

export interface AdminWebhook {
  id: number;
  provider: string;
  externalId: string;
  payloadHash: string;
  receivedAt: string;
  processingStatus: string;
  orderId: number | null;
  errorReason: string | null;
  createdAt: string;
  order?: {
    id: number;
    orderCode: string;
    status: AdminPaymentStatus;
    amountVnd: number;
    userId: number;
  } | null;
}

export interface AdminAuditRow {
  id: number;
  adminUserId: number;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AdminDashboard {
  totalUsers: number;
  verifiedUsers: number;
  freeUsers: number;
  proUsers: number;
  activeProUsers: number;
  newUsersToday: number;
  newUsers7d: number;
  revenueToday: number;
  revenue7d: number;
  revenue30d: number;
  paidOrders: number;
  pendingOrders: number;
  expiredOrders: number;
  failedWebhookCount: number;
  recentPayments: AdminPayment[];
  recentUsers: AdminUserSummary[];
  systemHealth: {
    api: string;
    db: string;
  };
}

export type AdminPromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FIXED_PRICE';
export type AdminPromotionStatus = 'ACTIVE' | 'INACTIVE';
export type AdminPromotionEffectiveStatus = AdminPromotionStatus | 'SCHEDULED' | 'EXPIRED';

export interface AdminPromotion {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  type: AdminPromotionType;
  discountValue: number | null;
  fixedPriceVnd: number | null;
  automatic: boolean;
  startAt: string;
  endAt: string | null;
  maxUses: number | null;
  claimedCount: number;
  usedCount: number;
  maxUsesPerUser: number | null;
  priority: number;
  status: AdminPromotionStatus;
  effectiveStatus: AdminPromotionEffectiveStatus;
  newUsersOnly: boolean;
  firstPurchaseOnly: boolean;
  minimumDurationDays: number | null;
  planIds: number[];
  plans: Array<{ id: number; code: string; name: string }>;
  createdAt: string;
  updatedAt: string;
  statistics: { revenue: number; discount: number; redemptions: number };
}

export interface AdminPromotionDashboard {
  generatedAt: string;
  timezone: string;
  activePromotions: number;
  scheduledPromotions: number;
  expiredPromotions: number;
  totalRedemptions: number;
  totalRevenue: number;
  totalDiscountGiven: number;
  promotions: AdminPromotion[];
}

export interface AdminPromotionInput {
  name: string;
  code: string | null;
  description: string | null;
  type: AdminPromotionType;
  discountValue: number | null;
  fixedPriceVnd: number | null;
  automatic: boolean;
  planIds: number[];
  startAt: string;
  endAt: string | null;
  priority: number;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  newUsersOnly: boolean;
  firstPurchaseOnly: boolean;
  minimumDurationDays: number | null;
  status: AdminPromotionStatus;
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');

  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;

    throw new Error(payload?.error ?? payload?.message ?? `Admin API ${response.status}`);
  }

  return (await response.json()) as T;
}

function queryString(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }

  const text = params.toString();
  return text ? `?${text}` : '';
}

export function getAdminDashboard(): Promise<AdminDashboard> {
  return adminFetch<AdminDashboard>('/admin/dashboard');
}

export function getAdminPromotions(): Promise<AdminPromotionDashboard> {
  return adminFetch('/admin/promotions');
}

export function createAdminPromotion(
  input: AdminPromotionInput,
): Promise<{ promotion: AdminPromotion }> {
  return adminFetch('/admin/promotions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAdminPromotion(
  promotionId: number,
  input: AdminPromotionInput,
): Promise<{ promotion: AdminPromotion }> {
  return adminFetch(`/admin/promotions/${promotionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function setAdminPromotionEnabled(
  promotionId: number,
  enabled: boolean,
): Promise<{ promotion: AdminPromotion }> {
  return adminFetch(`/admin/promotions/${promotionId}/${enabled ? 'enable' : 'disable'}`, {
    method: 'POST',
  });
}

export function deleteAdminPromotion(
  promotionId: number,
): Promise<{ ok: true; mode: 'SOFT_DELETE' }> {
  return adminFetch(`/admin/promotions/${promotionId}`, { method: 'DELETE' });
}

export function listAdminUsers(query = '', limit = 100): Promise<{ users: AdminUserSummary[] }> {
  return adminFetch<{ users: AdminUserSummary[] }>(
    `/admin/users${queryString({ q: query.trim() || undefined, limit })}`,
  );
}

export interface AdminCreateUserInput {
  name: string;
  email: string;
  temporaryPassword: string;
}

export function createAdminUser(input: AdminCreateUserInput): Promise<{ user: AdminUserSummary }> {
  return adminFetch('/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteAdminUser(userId: number): Promise<{
  ok: true;
  deletedUserId: number;
  mode: 'ANONYMIZED';
  revokedSubscriptions: number;
}> {
  return adminFetch(`/admin/users/${userId}`, {
    method: 'DELETE',
  });
}

export function setAdminUserStatus(
  userId: number,
  status: AdminUserStatus,
): Promise<{ user: AdminUserSummary }> {
  return adminFetch<{ user: AdminUserSummary }>(`/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function grantAdminPro(
  userId: number,
  days: number,
): Promise<{
  user: AdminUserSummary;
  entitlement?: {
    subscriptionId: number;
    startsAt: string;
    expiresAt: string;
  };
}> {
  return adminFetch(`/admin/users/${userId}/grant-pro`, {
    method: 'POST',
    body: JSON.stringify({ plan: 'PRO', days }),
  });
}

export function revokeAdminPro(
  userId: number,
): Promise<{ user: AdminUserSummary; revokedSubscriptions?: number }> {
  return adminFetch(`/admin/users/${userId}/revoke-pro`, {
    method: 'POST',
  });
}

export function revokeAdminSessions(userId: number): Promise<{ ok: true }> {
  return adminFetch(`/admin/users/${userId}/revoke-sessions`, {
    method: 'POST',
  });
}

export function getAdminPayments(
  status?: AdminPaymentStatus,
  limit = 100,
): Promise<{ payments: AdminPayment[] }> {
  return adminFetch(`/admin/payments${queryString({ status, limit })}`);
}

export function getAdminSubscriptions(
  status?: AdminSubscriptionStatus,
  limit = 100,
): Promise<{ subscriptions: AdminSubscription[] }> {
  return adminFetch(`/admin/subscriptions${queryString({ status, limit })}`);
}

export function getAdminWebhooks(
  processingStatus?: string,
  limit = 100,
): Promise<{ webhooks: AdminWebhook[] }> {
  return adminFetch(
    `/admin/webhooks${queryString({
      processingStatus: processingStatus?.trim() || undefined,
      limit,
    })}`,
  );
}

export function getAdminAudit(limit = 100): Promise<{ rows: AdminAuditRow[] }> {
  return adminFetch(`/admin/audit${queryString({ limit })}`);
}
