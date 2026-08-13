import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { resolveAuthContext } from './auth.js';
import {
  createPaymentOrderForUser,
  findPaymentOrderForUser,
  getAccountPaymentsData,
  getAccountSubscriptionData,
  getBillingPricingCatalog,
  getBillingAvailability,
  paymentInstructions,
  serializePaymentOrder,
} from './billing.js';
import { env } from './env.js';
import { processSepayWebhook, sepayWebhookSchema, verifySepayApiKey } from './sepay-webhook.js';

type AuthenticatedContext = {
  authenticated: true;
  user: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>['user']>;
  session: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>['session']>;
};

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
): express.RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

function allowedOrigins(): string[] {
  return env.CORS_ORIGIN.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function allowWriteOrigin(request: express.Request, response: express.Response): boolean {
  const origin = request.header('origin');
  if (!origin) return true;
  if (allowedOrigins().includes(origin)) return true;
  response.status(403).json({ error: 'Invalid request origin.' });
  return false;
}

async function requireAuth(
  request: express.Request,
  response: express.Response,
): Promise<AuthenticatedContext | null> {
  const auth = await resolveAuthContext(request);
  if (!auth.authenticated || !auth.user || !auth.session) {
    response.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  if (auth.user.status !== 'ACTIVE') {
    response.status(403).json({ error: 'Active account required.' });
    return null;
  }
  return auth as AuthenticatedContext;
}

const createOrderLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export const billingOrderRequestSchema = z
  .object({
    planId: z.number().int().positive().optional(),
    planCode: z.string().trim().min(1).max(32).optional(),
    promotionCode: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((value) => value.planId != null || value.planCode != null, {
    message: 'planId or planCode is required.',
  });

function positiveLimit(value: unknown): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

export const billingRouter = express.Router();
export const accountBillingRouter = express.Router();

billingRouter.post(
  '/webhooks/sepay',
  asyncRoute(async (request, response) => {
    const configuredKey = env.SEPAY_WEBHOOK_API_KEY?.trim() ?? '';
    if (!configuredKey || configuredKey === 'ROTATION_REQUIRED') {
      response.status(503).json({ success: false });
      return;
    }

    if (!verifySepayApiKey(request.header('authorization'))) {
      response.status(401).json({ success: false });
      return;
    }

    const parsed = sepayWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ success: false });
      return;
    }

    try {
      await processSepayWebhook(parsed.data);
      response.status(200).json({ success: true });
    } catch (error) {
      console.error('SePay webhook processing failed', error);
      response.status(500).json({ success: false });
    }
  }),
);

billingRouter.get(
  '/plans',
  asyncRoute(async (request, response) => {
    const auth = await resolveAuthContext(request);
    const userId = auth.authenticated && auth.user?.status === 'ACTIVE' ? auth.user.id : null;
    response.json(await getBillingPricingCatalog(userId));
  }),
);

billingRouter.post(
  '/orders',
  createOrderLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAuth(request, response);
    if (!auth) return;

    if (auth.user.role === 'ADMIN') {
      response.status(409).json({
        error: 'ADMIN accounts already have permanent PRO entitlement.',
      });
      return;
    }

    const parsed = billingOrderRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({
        error: 'Invalid payment order payload.',
        acceptedFields: ['planId', 'planCode', 'promotionCode'],
      });
      return;
    }

    const availability = getBillingAvailability();
    if (!availability.available) {
      response.status(503).json({
        error: 'Billing is not available until production pricing is confirmed.',
        reason: availability.reason,
      });
      return;
    }

    let result;
    try {
      result = await createPaymentOrderForUser(auth.user.id, parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('COUPON_INVALID:')) {
        response.status(409).json({ error: message, reason: message.split(':')[1] });
        return;
      }
      if (message.includes('PLAN_')) {
        response.status(400).json({ error: message });
        return;
      }
      throw error;
    }
    const order = serializePaymentOrder(result.order);

    response.status(result.reused ? 200 : 201).json({
      order,
      reused: result.reused,
      paymentInstructions: paymentInstructions({
        amountVnd: result.order.amountVnd,
        transferContent: result.order.transferContent,
      }),
    });
  }),
);

billingRouter.get(
  '/orders',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    response.json(await getAccountPaymentsData(auth.user.id, positiveLimit(request.query.limit)));
  }),
);

billingRouter.get(
  '/orders/:orderCode',
  asyncRoute(async (request, response) => {
    const availability = getBillingAvailability();
    if (!availability.available) {
      response.status(503).json({
        error: 'Billing is not available until production pricing is confirmed.',
        reason: availability.reason,
      });
      return;
    }

    const auth = await requireAuth(request, response);
    if (!auth) return;

    const orderCode = String(request.params.orderCode ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9-]{6,64}$/.test(orderCode)) {
      response.status(400).json({ error: 'Invalid order code.' });
      return;
    }

    const order = await findPaymentOrderForUser(auth.user.id, orderCode);
    if (!order) {
      response.status(404).json({ error: 'Payment order not found.' });
      return;
    }

    response.json({
      order: serializePaymentOrder(order),
      paymentInstructions: paymentInstructions({
        amountVnd: order.amountVnd,
        transferContent: order.transferContent,
      }),
    });
  }),
);

accountBillingRouter.get(
  '/payments',
  asyncRoute(async (request, response) => {
    const auth = await requireAuth(request, response);
    if (!auth) return;
    response.json(await getAccountPaymentsData(auth.user.id, positiveLimit(request.query.limit)));
  }),
);

accountBillingRouter.get(
  '/subscription',
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
