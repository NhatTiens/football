const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(
  /\/$/,
  '',
);

export type BillingOrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type BillingDurationUnit = 'DAY' | 'MONTH';

export interface PricingPromotion {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FIXED_PRICE';
  discountValue: number | null;
  fixedPriceVnd: number | null;
  automatic: boolean;
  startAt: string;
  endAt: string | null;
  priority: number;
}

export interface BillingPlan {
  id: number;
  code: string;
  name: string;
  description: string | null;
  durationCount: number;
  durationUnit: BillingDurationUnit;
  basePriceVnd: number;
  currency: string;
  purchasable: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  promotion: PricingPromotion | null;
  promotionId: number | null;
  promotionCode: string | null;
  promotionExpiresAt: string | null;
}

export interface BillingPlansResponse {
  engineVersion: string;
  serverTime: string;
  timezone: string;
  currency: 'VND';
  viewerAuthenticated: boolean;
  billingAvailable: boolean;
  billingUnavailableReason: string | null;
  trial: { code: 'FREE_TRIAL'; days: number; price: number; oneTimeOnly: boolean };
  plans: BillingPlan[];
}

export interface PricingQuote {
  plan: BillingPlan;
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  currency: string;
  promotion: PricingPromotion | null;
  promotionId: number | null;
  promotionCode: string | null;
  expiresAt: string | null;
  requestedCoupon: { code: string; valid: boolean; reason: string | null } | null;
}

export interface BillingOrder {
  id: number;
  orderCode: string;
  planCode: string;
  planId: number | null;
  amountVnd: number;
  originalPriceVnd: number;
  discountAmountVnd: number;
  finalPriceVnd: number;
  currency: string;
  promotionId: number | null;
  promotionCode: string | null;
  durationCount: number | null;
  durationUnit: BillingDurationUnit | null;
  status: BillingOrderStatus;
  provider: string;
  transferContent: string;
  qrUrl: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  providerTransactionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PaymentInstructions {
  bankId: string;
  bankBin: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  qrTemplate: string;
  amountVnd: number;
  transferContent: string;
  qrUrl: string;
}

export interface BillingOrderResponse {
  order: BillingOrder;
  paymentInstructions: PaymentInstructions;
  reused?: boolean;
}

export interface AccountPaymentsResponse {
  payments: BillingOrder[];
  billingAvailable: boolean;
}

async function billingFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body != null && !headers.has('content-type'))
    headers.set('content-type', 'application/json');

  const response = await fetch(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    credentials: 'include',
    headers,
    cache: 'no-store',
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

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫';
}

export async function getBillingPlans(): Promise<BillingPlansResponse> {
  return billingFetch<BillingPlansResponse>('/billing/plans');
}

export async function calculatePricing(input: {
  planId: number;
  promotionCode?: string | null;
}): Promise<PricingQuote> {
  return billingFetch<PricingQuote>('/pricing/calculate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function validateCoupon(input: {
  planId: number;
  promotionCode: string;
}): Promise<{ valid: boolean; coupon: PricingQuote['requestedCoupon']; quote: PricingQuote }> {
  return billingFetch('/pricing/validate-coupon', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createProPaymentOrder(
  input: {
    planId?: number;
    planCode?: string;
    promotionCode?: string | null;
  } = { planCode: 'PRO' },
): Promise<BillingOrderResponse> {
  return billingFetch<BillingOrderResponse>('/billing/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getBillingOrder(orderCode: string): Promise<BillingOrderResponse> {
  return billingFetch<BillingOrderResponse>(`/billing/orders/${encodeURIComponent(orderCode)}`);
}

export async function getAccountPayments(limit = 50): Promise<AccountPaymentsResponse> {
  return billingFetch<AccountPaymentsResponse>(
    `/account/payments?limit=${encodeURIComponent(String(limit))}`,
  );
}
