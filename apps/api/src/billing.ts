import crypto from 'node:crypto';

import { prisma } from '@football-ai/database';

import { canUseAdvancedChat } from './auth.js';
import { env } from './env.js';
import { reconcileSubscriptionLifecycle } from './subscription.js';

export const BILLING_PROVIDER = 'SEPAY';
export const PRO_PLAN_CODE = 'PRO';

type BillingDb = {
  authUser: any;
  paymentOrder: any;
  subscription: any;
};

export interface BillingPlanDto {
  code: 'FREE' | 'PRO';
  name: string;
  priceVnd: number;
  durationDays: number | null;
  purchasable: boolean;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function getBillingPlans(): {
  currency: 'VND';
  plans: BillingPlanDto[];
} {
  return {
    currency: 'VND',
    plans: [
      {
        code: 'FREE',
        name: 'FREE',
        priceVnd: 0,
        durationDays: null,
        purchasable: false,
      },
      {
        code: 'PRO',
        name: 'PRO',
        priceVnd: env.PRO_PLAN_PRICE_VND,
        durationDays: env.PRO_PLAN_DAYS,
        purchasable: true,
      },
    ],
  };
}

export function formatOrderCode(date: Date, entropy: string): string {
  const y = String(date.getUTCFullYear()).slice(-2);
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const safeEntropy = entropy.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
  if (!safeEntropy) {
    throw new Error('Order code entropy is required.');
  }
  return `FA${y}${m}${d}${safeEntropy}`;
}

export function generateOrderCode(now: Date = new Date()): string {
  return formatOrderCode(now, crypto.randomBytes(6).toString('hex'));
}

export function buildVietQrUrl(input: {
  amountVnd: number;
  transferContent: string;
}): string {
  const bankId = encodeURIComponent(env.PAYMENT_BANK_BIN || env.PAYMENT_BANK_ID);
  const accountNo = encodeURIComponent(env.PAYMENT_ACCOUNT_NO);
  const template = encodeURIComponent(env.PAYMENT_QR_TEMPLATE);
  const params = new URLSearchParams({
    amount: String(input.amountVnd),
    addInfo: input.transferContent,
    accountName: env.PAYMENT_ACCOUNT_NAME,
  });

  return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?${params.toString()}`;
}

export function paymentInstructions(input: {
  amountVnd: number;
  transferContent: string;
}) {
  return {
    bankId: env.PAYMENT_BANK_ID,
    bankBin: env.PAYMENT_BANK_BIN,
    bankName: env.PAYMENT_BANK_BIN === '970422' ? 'MB Bank' : env.PAYMENT_BANK_ID,
    accountNo: env.PAYMENT_ACCOUNT_NO,
    accountName: env.PAYMENT_ACCOUNT_NAME,
    qrTemplate: env.PAYMENT_QR_TEMPLATE,
    amountVnd: input.amountVnd,
    transferContent: input.transferContent,
    qrUrl: buildVietQrUrl(input),
  };
}

export function serializePaymentOrder(order: any) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    planCode: order.planCode,
    amountVnd: order.amountVnd,
    status: order.status,
    provider: order.provider,
    transferContent: order.transferContent,
    qrUrl:
      order.qrUrl ??
      buildVietQrUrl({
        amountVnd: order.amountVnd,
        transferContent: order.transferContent,
      }),
    expiresAt: toIso(order.expiresAt),
    paidAt: toIso(order.paidAt),
    providerTransactionId: order.providerTransactionId ?? null,
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt),
  };
}

export function serializeSubscription(subscription: any) {
  return {
    id: subscription.id,
    planCode: subscription.planCode,
    status: subscription.status,
    startsAt: toIso(subscription.startsAt),
    expiresAt: toIso(subscription.expiresAt),
    sourcePaymentOrderId: subscription.sourcePaymentOrderId ?? null,
    createdAt: toIso(subscription.createdAt),
  };
}

export async function expireStalePaymentOrders(
  userId?: number,
  db: BillingDb = prisma as unknown as BillingDb,
  now: Date = new Date(),
): Promise<number> {
  const result = await db.paymentOrder.updateMany({
    where: {
      status: 'PENDING',
      expiresAt: { lte: now },
      ...(userId ? { userId } : {}),
    },
    data: { status: 'EXPIRED' },
  });
  return Number(result.count ?? 0);
}

export async function createPaymentOrderForUser(
  userId: number,
  planCode: string,
  db: BillingDb = prisma as unknown as BillingDb,
  now: Date = new Date(),
): Promise<{ order: any; reused: boolean }> {
  if (planCode !== PRO_PLAN_CODE) {
    throw new Error('UNSUPPORTED_PLAN');
  }

  await expireStalePaymentOrders(userId, db, now);

  const existing = await db.paymentOrder.findFirst({
    where: {
      userId,
      planCode: PRO_PLAN_CODE,
      amountVnd: env.PRO_PLAN_PRICE_VND,
      provider: BILLING_PROVIDER,
      status: 'PENDING',
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return { order: existing, reused: true };
  }

  const expiresAt = new Date(now.getTime() + env.PAYMENT_ORDER_EXPIRE_MINUTES * 60_000);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderCode = generateOrderCode(now);
    try {
      const order = await db.paymentOrder.create({
        data: {
          userId,
          orderCode,
          planCode: PRO_PLAN_CODE,
          amountVnd: env.PRO_PLAN_PRICE_VND,
          status: 'PENDING',
          provider: BILLING_PROVIDER,
          transferContent: orderCode,
          qrUrl: null,
          expiresAt,
          paidAt: null,
          providerTransactionId: null,
          metadata: {
            pricingSource: 'SERVER_ENV',
            proPlanDays: env.PRO_PLAN_DAYS,
            createdBy: 'BILLING_2',
          },
        },
      });
      return { order, reused: false };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      if (code === 'P2002') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('ORDER_CODE_COLLISION');
}

export async function listPaymentOrdersForUser(
  userId: number,
  limit = 50,
  db: BillingDb = prisma as unknown as BillingDb,
) {
  await expireStalePaymentOrders(userId, db);
  return db.paymentOrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  });
}

export async function findPaymentOrderForUser(
  userId: number,
  orderCode: string,
  db: BillingDb = prisma as unknown as BillingDb,
) {
  await expireStalePaymentOrders(userId, db);
  return db.paymentOrder.findFirst({
    where: {
      userId,
      orderCode,
    },
  });
}



export async function getAccountSubscriptionData(
  userId: number,
  db: BillingDb = prisma as unknown as BillingDb,
) {
  const user = await db.authUser.findUnique({ where: { id: userId } });
  if (!user) return null;

  await reconcileSubscriptionLifecycle(userId, db);
  const fresh = await db.authUser.findUnique({ where: { id: userId } });
  if (!fresh) return null;

  const subscriptions = await db.subscription.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });

  return {
    role: fresh.role,
    status: fresh.status,
    plan: fresh.plan,
    emailVerifiedAt: toIso(fresh.emailVerifiedAt),
    proExpiresAt: toIso(fresh.proExpiresAt),
    forcePasswordChange: Boolean(fresh.forcePasswordChange),
    canAccessAdvancedChat: canUseAdvancedChat({
      role: fresh.role,
      plan: fresh.plan,
      proExpiresAt: fresh.proExpiresAt,
    }),
    subscriptions: subscriptions.map(serializeSubscription),
  };
}

export async function getAccountPaymentsData(
  userId: number,
  limit = 50,
  db: BillingDb = prisma as unknown as BillingDb,
) {
  const orders = await listPaymentOrdersForUser(userId, limit, db);
  return {
    payments: orders.map(serializePaymentOrder),
    billingAvailable: true,
  };
}
