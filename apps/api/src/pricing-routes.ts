import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { resolveAuthContext, roleCanManageRoles } from './auth.js';
import { env } from './env.js';
import {
  calculatePrice,
  createPromotion,
  getPricingCatalog,
  getPromotion,
  getPromotionDashboard,
  getPromotionStatistics,
  setPromotionStatus,
  softDeletePromotion,
  updatePromotion,
  type PromotionMutationInput,
} from './pricing-service.js';

type AuthenticatedContext = {
  authenticated: true;
  user: NonNullable<Awaited<ReturnType<typeof resolveAuthContext>>['user']>;
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
  if (!origin || allowedOrigins().includes(origin)) return true;
  response.status(403).json({ error: 'Invalid request origin.' });
  return false;
}

async function optionalUserId(request: express.Request): Promise<number | null> {
  const auth = await resolveAuthContext(request);
  return auth.authenticated && auth.user?.status === 'ACTIVE' ? auth.user.id : null;
}

async function requireAuth(
  request: express.Request,
  response: express.Response,
): Promise<AuthenticatedContext | null> {
  const auth = await resolveAuthContext(request);
  if (!auth.authenticated || !auth.user) {
    response.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  if (auth.user.status !== 'ACTIVE') {
    response.status(403).json({ error: 'Active account required.' });
    return null;
  }
  return auth as AuthenticatedContext;
}

async function requireAdmin(
  request: express.Request,
  response: express.Response,
): Promise<AuthenticatedContext | null> {
  const auth = await requireAuth(request, response);
  if (!auth) return null;
  if (!roleCanManageRoles(auth.user.role)) {
    response.status(403).json({ error: 'Admin role required.' });
    return null;
  }
  return auth;
}

const calculateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export const pricingQuoteRequestSchema = z
  .object({
    planId: z.number().int().positive().optional(),
    planCode: z.string().trim().min(1).max(32).optional(),
    promotionCode: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((value) => value.planId != null || value.planCode != null, {
    message: 'planId or planCode is required.',
  });

const couponSchema = z
  .object({
    planId: z.number().int().positive(),
    promotionCode: z.string().trim().min(1).max(64),
  })
  .strict();

const promotionSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    code: z.string().trim().min(2).max(64).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FIXED_PRICE']),
    discountValue: z.number().positive().nullable().optional(),
    fixedPriceVnd: z.number().int().nonnegative().nullable().optional(),
    automatic: z.boolean().default(false),
    planIds: z.array(z.number().int().positive()).min(1).max(50),
    startAt: z.string().min(1).max(64),
    endAt: z.string().min(1).max(64).nullable().optional(),
    priority: z.number().int().min(-10000).max(10000).default(0),
    maxUses: z.number().int().positive().nullable().optional(),
    maxUsesPerUser: z.number().int().positive().nullable().optional(),
    newUsersOnly: z.boolean().default(false),
    firstPurchaseOnly: z.boolean().default(false),
    minimumDurationDays: z.number().int().positive().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  })
  .strict();

function parsedDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field}_INVALID`);
  return date;
}

function mutationInput(value: z.infer<typeof promotionSchema>): PromotionMutationInput {
  return {
    ...value,
    code: value.code ?? null,
    description: value.description ?? null,
    discountValue: value.discountValue ?? null,
    fixedPriceVnd: value.fixedPriceVnd ?? null,
    startAt: parsedDate(value.startAt, 'START_AT'),
    endAt: value.endAt ? parsedDate(value.endAt, 'END_AT') : null,
    maxUses: value.maxUses ?? null,
    maxUsesPerUser: value.maxUsesPerUser ?? null,
    minimumDurationDays: value.minimumDurationDays ?? null,
  };
}

function promotionId(request: express.Request): number | null {
  const id = Number(request.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function pricingError(response: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('NOT_FOUND')) {
    response.status(404).json({ error: message });
    return;
  }
  if (
    message.includes('MAX_USES') ||
    message.includes('NOT_ACTIVE') ||
    message.includes('FIRST_PURCHASE') ||
    message.includes('NEW_USER')
  ) {
    response.status(409).json({ error: message });
    return;
  }
  response.status(400).json({ error: message });
}

export const pricingRouter = express.Router();
export const adminPromotionRouter = express.Router();

pricingRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    response.json(await getPricingCatalog(await optionalUserId(request)));
  }),
);

pricingRouter.get(
  '/plans',
  asyncRoute(async (request, response) => {
    response.json(await getPricingCatalog(await optionalUserId(request)));
  }),
);

pricingRouter.post(
  '/calculate',
  calculateLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const parsed = pricingQuoteRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid pricing payload.' });
      return;
    }
    const quote = await calculatePrice({
      userId: auth.user.id,
      ...parsed.data,
    });
    response.json(quote);
  }),
);

pricingRouter.post(
  '/validate-coupon',
  calculateLimit,
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAuth(request, response);
    if (!auth) return;
    const parsed = couponSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid coupon payload.' });
      return;
    }
    const quote = await calculatePrice({ userId: auth.user.id, ...parsed.data });
    response.json({
      valid: quote.requestedCoupon?.valid === true,
      coupon: quote.requestedCoupon,
      quote,
    });
  }),
);

adminPromotionRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    response.json(await getPromotionDashboard());
  }),
);

adminPromotionRouter.get(
  '/dashboard',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    response.json(await getPromotionDashboard());
  }),
);

adminPromotionRouter.post(
  '/',
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const parsed = promotionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid promotion payload.' });
      return;
    }
    try {
      const created = await createPromotion(mutationInput(parsed.data), auth.user.id);
      response.status(201).json({ promotion: created });
    } catch (error) {
      pricingError(response, error);
    }
  }),
);

adminPromotionRouter.get(
  '/:id',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const id = promotionId(request);
    if (!id) {
      response.status(400).json({ error: 'Invalid promotion id.' });
      return;
    }
    const promotion = await getPromotion(id);
    if (!promotion) {
      response.status(404).json({ error: 'PROMOTION_NOT_FOUND' });
      return;
    }
    response.json({ promotion });
  }),
);

adminPromotionRouter.patch(
  '/:id',
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const id = promotionId(request);
    if (!id) {
      response.status(400).json({ error: 'Invalid promotion id.' });
      return;
    }
    const current = await getPromotion(id);
    if (!current) {
      response.status(404).json({ error: 'PROMOTION_NOT_FOUND' });
      return;
    }
    const parsed = promotionSchema
      .partial()
      .strict()
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid promotion payload.' });
      return;
    }
    const merged = promotionSchema.safeParse({
      name: parsed.data.name ?? current.name,
      code: parsed.data.code === undefined ? current.code : parsed.data.code,
      description:
        parsed.data.description === undefined ? current.description : parsed.data.description,
      type: parsed.data.type ?? current.type,
      discountValue:
        parsed.data.discountValue === undefined ? current.discountValue : parsed.data.discountValue,
      fixedPriceVnd:
        parsed.data.fixedPriceVnd === undefined ? current.fixedPriceVnd : parsed.data.fixedPriceVnd,
      automatic: parsed.data.automatic ?? current.automatic,
      planIds: parsed.data.planIds ?? current.planIds,
      startAt: parsed.data.startAt ?? current.startAt,
      endAt: parsed.data.endAt === undefined ? current.endAt : parsed.data.endAt,
      priority: parsed.data.priority ?? current.priority,
      maxUses: parsed.data.maxUses === undefined ? current.maxUses : parsed.data.maxUses,
      maxUsesPerUser:
        parsed.data.maxUsesPerUser === undefined
          ? current.maxUsesPerUser
          : parsed.data.maxUsesPerUser,
      newUsersOnly: parsed.data.newUsersOnly ?? current.newUsersOnly,
      firstPurchaseOnly: parsed.data.firstPurchaseOnly ?? current.firstPurchaseOnly,
      minimumDurationDays:
        parsed.data.minimumDurationDays === undefined
          ? current.minimumDurationDays
          : parsed.data.minimumDurationDays,
      status: parsed.data.status ?? (current.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'),
    });
    if (!merged.success) {
      response.status(400).json({ error: 'Invalid merged promotion payload.' });
      return;
    }
    try {
      const updated = await updatePromotion(id, mutationInput(merged.data), auth.user.id);
      response.json({ promotion: updated });
    } catch (error) {
      pricingError(response, error);
    }
  }),
);

adminPromotionRouter.delete(
  '/:id',
  asyncRoute(async (request, response) => {
    if (!allowWriteOrigin(request, response)) return;
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const id = promotionId(request);
    if (!id) {
      response.status(400).json({ error: 'Invalid promotion id.' });
      return;
    }
    try {
      await softDeletePromotion(id, auth.user.id);
      response.json({ ok: true, mode: 'SOFT_DELETE' });
    } catch (error) {
      pricingError(response, error);
    }
  }),
);

for (const [path, status] of [
  ['/:id/enable', 'ACTIVE'],
  ['/:id/disable', 'INACTIVE'],
] as const) {
  adminPromotionRouter.post(
    path,
    asyncRoute(async (request, response) => {
      if (!allowWriteOrigin(request, response)) return;
      const auth = await requireAdmin(request, response);
      if (!auth) return;
      const id = promotionId(request);
      if (!id) {
        response.status(400).json({ error: 'Invalid promotion id.' });
        return;
      }
      try {
        const promotion = await setPromotionStatus(id, status, auth.user.id);
        response.json({ promotion });
      } catch (error) {
        pricingError(response, error);
      }
    }),
  );
}

adminPromotionRouter.get(
  '/:id/statistics',
  asyncRoute(async (request, response) => {
    const auth = await requireAdmin(request, response);
    if (!auth) return;
    const id = promotionId(request);
    if (!id) {
      response.status(400).json({ error: 'Invalid promotion id.' });
      return;
    }
    const statistics = await getPromotionStatistics(id);
    if (!statistics) {
      response.status(404).json({ error: 'PROMOTION_NOT_FOUND' });
      return;
    }
    response.json({ statistics });
  }),
);
