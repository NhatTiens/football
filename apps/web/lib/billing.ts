const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

export type BillingOrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface BillingPlan {
  code: 'FREE' | 'PRO';
  name: string;
  priceVnd: number;
  durationDays: number | null;
  purchasable: boolean;
  unavailableReason: string | null;
}

export interface BillingPlansResponse {
  currency: 'VND';
  plans: BillingPlan[];
}

export interface BillingOrder {
  id: number;
  orderCode: string;
  planCode: string;
  amountVnd: number;
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
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    credentials: 'include',
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
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

export async function createProPaymentOrder(): Promise<BillingOrderResponse> {
  return billingFetch<BillingOrderResponse>('/billing/orders', {
    method: 'POST',
    body: JSON.stringify({ planCode: 'PRO' }),
  });
}

export async function getBillingOrder(orderCode: string): Promise<BillingOrderResponse> {
  return billingFetch<BillingOrderResponse>(
    `/billing/orders/${encodeURIComponent(orderCode)}`,
  );
}

export async function getAccountPayments(limit = 50): Promise<AccountPaymentsResponse> {
  return billingFetch<AccountPaymentsResponse>(
    `/account/payments?limit=${encodeURIComponent(String(limit))}`,
  );
}
