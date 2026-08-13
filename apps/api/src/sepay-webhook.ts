import crypto from 'node:crypto';

import { prisma } from '@football-ai/database';
import { z } from 'zod';

import { env } from './env.js';
import {
  finalizePromotionUsageForPaidOrder,
  releasePromotionClaimForOrder,
} from './pricing-service.js';
import { applyPaidProEntitlement } from './subscription.js';

export const sepayWebhookSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1).max(128)]),
  gateway: z.string().min(1).max(128),
  transactionDate: z.string().min(1).max(64),
  accountNumber: z.string().min(1).max(64),
  subAccount: z.string().max(128).optional().default(''),
  code: z.string().max(128).nullable().optional().default(null),
  content: z.string().min(1).max(2048),
  transferType: z.enum(['in', 'out']),
  description: z.string().max(4096).optional().default(''),
  transferAmount: z.coerce.number().int().positive(),
  accumulated: z.coerce.number().int().nonnegative().optional().default(0),
  referenceCode: z.string().max(256).optional().default(''),
});

export type SepayWebhookPayload = z.infer<typeof sepayWebhookSchema>;

export type SepayProcessingResult =
  | { kind: 'processed'; orderId: number; userId: number; newProExpiresAt: Date }
  | { kind: 'duplicate'; orderId: number | null }
  | {
      kind: 'rejected';
      reason:
        | 'DIRECTION'
        | 'ACCOUNT'
        | 'ORDER_CODE'
        | 'ORDER_NOT_FOUND'
        | 'AMOUNT'
        | 'EXPIRED'
        | 'ORDER_STATE';
      orderId: number | null;
    };

function normalizedDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function safeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifySepayApiKey(
  authorizationHeader: string | undefined,
  expectedApiKey = env.SEPAY_WEBHOOK_API_KEY,
): boolean {
  const expected = expectedApiKey?.trim() ?? '';
  const header = authorizationHeader?.trim() ?? '';

  if (!expected || expected === 'ROTATION_REQUIRED') return false;
  if (!header.startsWith('Apikey ')) return false;

  const received = header.slice('Apikey '.length).trim();
  if (!received) return false;

  return safeEqualString(received, expected);
}

const ORDER_CODE_EXACT = /^FA\d{6}[A-Z0-9]{8,24}$/i;
const ORDER_CODE_IN_TEXT = /FA\d{6}[A-Z0-9]{8,24}/i;

export function extractSepayOrderCode(
  payload: Pick<SepayWebhookPayload, 'code' | 'content'>,
): string | null {
  const explicit = payload.code?.trim().toUpperCase() ?? '';
  if (ORDER_CODE_EXACT.test(explicit)) return explicit;

  const match = payload.content.toUpperCase().match(ORDER_CODE_IN_TEXT);
  return match?.[0] ?? null;
}

export function hashSepayPayload(payload: SepayWebhookPayload): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isPrismaUniqueError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code?: unknown }).code ?? '') === 'P2002',
  );
}

async function recordRejected(
  tx: any,
  webhookEventId: number,
  reason: string,
  orderId: number | null = null,
): Promise<void> {
  await tx.paymentWebhookEvent.update({
    where: { id: webhookEventId },
    data: {
      processingStatus: `REJECTED_${reason}`,
      orderId,
      errorReason: reason,
    },
  });
}

export async function processSepayWebhook(
  rawPayload: unknown,
  db: any = prisma,
  now: Date = new Date(),
): Promise<SepayProcessingResult> {
  const payload = sepayWebhookSchema.parse(rawPayload);
  const externalId = String(payload.id);
  const payloadHash = hashSepayPayload(payload);

  try {
    return await db.$transaction(async (tx: any) => {
      let event: any;
      try {
        event = await tx.paymentWebhookEvent.create({
          data: {
            provider: 'SEPAY',
            externalId,
            payloadHash,
            processingStatus: 'RECEIVED',
            rawPayload: payload,
          },
        });
      } catch (error) {
        if (isPrismaUniqueError(error)) {
          const existing = await tx.paymentWebhookEvent.findUnique({
            where: {
              provider_externalId: {
                provider: 'SEPAY',
                externalId,
              },
            },
          });

          return {
            kind: 'duplicate' as const,
            orderId: existing?.orderId ?? null,
          };
        }
        throw error;
      }

      if (payload.transferType !== 'in') {
        await recordRejected(tx, event.id, 'DIRECTION');
        return { kind: 'rejected' as const, reason: 'DIRECTION' as const, orderId: null };
      }

      if (normalizedDigits(payload.accountNumber) !== normalizedDigits(env.PAYMENT_ACCOUNT_NO)) {
        await recordRejected(tx, event.id, 'ACCOUNT');
        return { kind: 'rejected' as const, reason: 'ACCOUNT' as const, orderId: null };
      }

      const orderCode = extractSepayOrderCode(payload);
      if (!orderCode) {
        await recordRejected(tx, event.id, 'ORDER_CODE');
        return { kind: 'rejected' as const, reason: 'ORDER_CODE' as const, orderId: null };
      }

      const order = await tx.paymentOrder.findUnique({
        where: { orderCode },
      });

      if (!order) {
        await recordRejected(tx, event.id, 'ORDER_NOT_FOUND');
        return {
          kind: 'rejected' as const,
          reason: 'ORDER_NOT_FOUND' as const,
          orderId: null,
        };
      }

      if (order.provider !== 'SEPAY') {
        await recordRejected(tx, event.id, 'ORDER_STATE', order.id);
        return {
          kind: 'rejected' as const,
          reason: 'ORDER_STATE' as const,
          orderId: order.id,
        };
      }

      if (order.status === 'PAID') {
        await tx.paymentWebhookEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: 'DUPLICATE_ORDER_PAID',
            orderId: order.id,
            errorReason: null,
          },
        });
        return { kind: 'duplicate' as const, orderId: order.id };
      }

      if (order.status !== 'PENDING') {
        await recordRejected(tx, event.id, 'ORDER_STATE', order.id);
        return {
          kind: 'rejected' as const,
          reason: 'ORDER_STATE' as const,
          orderId: order.id,
        };
      }

      if (order.expiresAt.getTime() <= now.getTime()) {
        await releasePromotionClaimForOrder(order, tx);
        await recordRejected(tx, event.id, 'EXPIRED', order.id);
        return {
          kind: 'rejected' as const,
          reason: 'EXPIRED' as const,
          orderId: order.id,
        };
      }

      if (Number(order.amountVnd) !== Number(payload.transferAmount)) {
        await recordRejected(tx, event.id, 'AMOUNT', order.id);
        return {
          kind: 'rejected' as const,
          reason: 'AMOUNT' as const,
          orderId: order.id,
        };
      }

      const user = await tx.authUser.findUnique({
        where: { id: order.userId },
      });
      if (!user) {
        throw new Error(`Payment order ${order.id} references a missing user.`);
      }

      const claimed = await tx.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: 'PENDING',
          providerTransactionId: null,
        },
        data: {
          status: 'PAID',
          activeKey: null,
          paidAt: now,
          providerTransactionId: externalId,
        },
      });

      if (Number(claimed.count ?? 0) !== 1) {
        await tx.paymentWebhookEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: 'DUPLICATE_ORDER_CLAIMED',
            orderId: order.id,
            errorReason: null,
          },
        });
        return { kind: 'duplicate' as const, orderId: order.id };
      }

      const entitlement = await applyPaidProEntitlement(
        {
          userId: user.id,
          sourcePaymentOrderId: order.id,
          provider: 'SEPAY',
          externalTransactionId: externalId,
          billingPlanId: order.billingPlanId ?? null,
          planCode: order.planCode,
          durationCount: order.durationCount ?? env.PRO_PLAN_DAYS,
          durationUnit: order.durationUnit ?? 'DAY',
          pricePaidVnd: order.finalPriceVnd ?? order.amountVnd,
          currency: order.currency ?? 'VND',
          promotionId: order.promotionId ?? null,
          now,
        },
        tx,
      );

      const newProExpiresAt = entitlement.expiresAt;

      await finalizePromotionUsageForPaidOrder(order, tx, now);

      await tx.paymentWebhookEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: 'PROCESSED',
          orderId: order.id,
          errorReason: null,
        },
      });

      return {
        kind: 'processed' as const,
        orderId: order.id,
        userId: user.id,
        newProExpiresAt,
      };
    });
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      return { kind: 'duplicate', orderId: null };
    }
    throw error;
  }
}
