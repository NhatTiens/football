import { prisma } from '@football-ai/database';

import {
  FREE_TRIAL_DAYS,
  PRICING_ENGINE_VERSION,
  PRICING_TIMEZONE,
  assertPromotionPricingShape,
  calculatePriceCore,
  effectivePromotionStatus,
  type PricingPlanRecord,
  type PricingPromotionRecord,
  type PricingQuote,
  type PricingUserContext,
  type PromotionType,
  type StoredPromotionStatus,
} from './pricing-core.js';

type PricingDb = any;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? '';
  return code.length > 0 ? code : null;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function planRecord(row: any): PricingPlanRecord {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    durationCount: Number(row.durationCount),
    durationUnit: row.durationUnit,
    basePriceVnd: Number(row.basePriceVnd),
    currency: String(row.currency),
    purchasable: Boolean(row.purchasable),
    status: row.status,
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

function promotionRecord(row: any): PricingPromotionRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    code: normalizeCode(row.code),
    description: row.description == null ? null : String(row.description),
    type: row.type,
    discountValue: row.discountValue == null ? null : Number(row.discountValue),
    fixedPriceVnd: row.fixedPriceVnd == null ? null : Number(row.fixedPriceVnd),
    automatic: Boolean(row.automatic),
    startAt: asDate(row.startAt),
    endAt: row.endAt == null ? null : asDate(row.endAt),
    maxUses: row.maxUses == null ? null : Number(row.maxUses),
    claimedCount: Number(row.claimedCount ?? 0),
    usedCount: Number(row.usedCount ?? 0),
    maxUsesPerUser: row.maxUsesPerUser == null ? null : Number(row.maxUsesPerUser),
    priority: Number(row.priority ?? 0),
    status: row.status,
    newUsersOnly: Boolean(row.newUsersOnly),
    firstPurchaseOnly: Boolean(row.firstPurchaseOnly),
    minimumDurationDays: row.minimumDurationDays == null ? null : Number(row.minimumDurationDays),
  };
}

async function loadUserContext(
  userId: number | null,
  db: PricingDb,
  previewAnonymous = false,
  now: Date = new Date(),
): Promise<PricingUserContext> {
  if (userId == null) {
    return {
      userId: previewAnonymous ? -1 : null,
      registeredAt: previewAnonymous ? now : null,
      paidProPurchaseCount: 0,
      claimedByPromotion: {},
    };
  }

  const [account, paidProPurchaseCount, counters] = await Promise.all([
    db.authUser.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    db.paymentOrder.count({
      where: {
        userId,
        status: 'PAID',
        planCode: { not: 'FREE_TRIAL' },
      },
    }),
    db.promotionUserCounter.findMany({
      where: { userId },
      select: { promotionId: true, claimedCount: true },
    }),
  ]);

  return {
    userId,
    registeredAt: account?.createdAt ? asDate(account.createdAt) : null,
    paidProPurchaseCount: Number(paidProPurchaseCount ?? 0),
    claimedByPromotion: Object.fromEntries(
      counters.map((row: any) => [Number(row.promotionId), Number(row.claimedCount ?? 0)]),
    ),
  };
}

async function loadPlanWithPromotions(
  input: { planId?: number; planCode?: string },
  db: PricingDb,
): Promise<{ plan: PricingPlanRecord; promotions: PricingPromotionRecord[] }> {
  const code = input.planCode?.trim().toUpperCase();
  const resolvedCode = code === 'PRO' ? 'PRO_MONTHLY' : code;
  const row = await db.billingPlan.findFirst({
    where: input.planId ? { id: input.planId } : { code: resolvedCode },
    include: {
      promotionLinks: {
        include: { promotion: true },
      },
    },
  });

  if (!row) throw new Error('PLAN_NOT_FOUND');
  if (row.status !== 'ACTIVE') throw new Error('PLAN_INACTIVE');

  return {
    plan: planRecord(row),
    promotions: (row.promotionLinks ?? []).map((link: any) => promotionRecord(link.promotion)),
  };
}

export async function calculatePrice(
  input: {
    userId: number | null;
    planId?: number;
    planCode?: string;
    promotionCode?: string | null;
    now?: Date;
    previewAnonymous?: boolean;
  },
  db: PricingDb = prisma,
): Promise<PricingQuote> {
  const now = input.now ?? new Date();
  const [{ plan, promotions }, user] = await Promise.all([
    loadPlanWithPromotions(input, db),
    loadUserContext(input.userId, db, input.previewAnonymous, now),
  ]);

  const quote = calculatePriceCore({
    plan,
    promotions,
    user,
    promotionCode: input.promotionCode,
    now,
  });

  if (input.promotionCode && quote.requestedCoupon?.valid !== true) {
    return quote;
  }

  return quote;
}

export function buildPaymentOrderPricingSnapshot(quote: PricingQuote) {
  return {
    billingPlanId: quote.plan.id,
    planCode: quote.plan.code,
    originalPriceVnd: quote.basePrice,
    discountAmountVnd: quote.discountAmount,
    finalPriceVnd: quote.finalPrice,
    amountVnd: quote.finalPrice,
    currency: quote.currency,
    promotionId: quote.promotionId,
    promotionCode: quote.promotionCode,
    durationCount: quote.plan.durationCount,
    durationUnit: quote.plan.durationUnit,
    pricingSnapshot: JSON.parse(JSON.stringify(quote)),
  };
}

export async function getPricingCatalog(
  userId: number | null,
  db: PricingDb = prisma,
  now: Date = new Date(),
) {
  const plans = await db.billingPlan.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      promotionLinks: { include: { promotion: true } },
    },
  });
  const user = await loadUserContext(userId, db, userId == null, now);
  const quotes = plans.map((row: any) =>
    calculatePriceCore({
      plan: planRecord(row),
      promotions: (row.promotionLinks ?? []).map((link: any) => promotionRecord(link.promotion)),
      user,
      now,
    }),
  );

  return {
    engineVersion: PRICING_ENGINE_VERSION,
    serverTime: now.toISOString(),
    timezone: PRICING_TIMEZONE,
    currency: 'VND' as const,
    viewerAuthenticated: userId != null,
    trial: {
      code: 'FREE_TRIAL',
      days: FREE_TRIAL_DAYS,
      price: 0,
      oneTimeOnly: true,
    },
    plans: quotes.map((quote: PricingQuote) => ({
      ...quote.plan,
      basePrice: quote.basePrice,
      discountAmount: quote.discountAmount,
      finalPrice: quote.finalPrice,
      promotion: quote.promotion,
      promotionId: quote.promotionId,
      promotionCode: quote.promotionCode,
      promotionExpiresAt: quote.expiresAt,
      purchasable: quote.plan.purchasable && quote.plan.status === 'ACTIVE',
    })),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code?: unknown }).code ?? '') === 'P2002',
  );
}

export async function claimPromotionForOrder(
  input: { promotionId: number; userId: number; now: Date },
  tx: PricingDb,
): Promise<void> {
  const staleClaims = await tx.paymentOrder.findMany({
    where: {
      promotionId: input.promotionId,
      promotionClaimed: true,
      status: 'PENDING',
      expiresAt: { lte: input.now },
    },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });
  for (const staleOrder of staleClaims) {
    await releasePromotionClaimForOrder(staleOrder, tx);
  }

  const promotion = await tx.promotion.findUnique({ where: { id: input.promotionId } });
  if (!promotion) throw new Error('PROMOTION_NOT_FOUND');
  const normalized = promotionRecord(promotion);
  if (effectivePromotionStatus(normalized, input.now) !== 'ACTIVE') {
    throw new Error('PROMOTION_NOT_ACTIVE');
  }

  if (normalized.newUsersOnly) {
    const account = await tx.authUser.findUnique({
      where: { id: input.userId },
      select: { createdAt: true },
    });
    if (!account || asDate(account.createdAt).getTime() < normalized.startAt.getTime()) {
      throw new Error('PROMOTION_NEW_USER_REQUIRED');
    }
  }

  if (normalized.firstPurchaseOnly) {
    const paid = await tx.paymentOrder.count({
      where: {
        userId: input.userId,
        status: 'PAID',
        planCode: { not: 'FREE_TRIAL' },
      },
    });
    if (Number(paid) > 0) throw new Error('PROMOTION_FIRST_PURCHASE_REQUIRED');
  }

  const globalClaim = await tx.promotion.updateMany({
    where: {
      id: normalized.id,
      status: 'ACTIVE',
      startAt: { lte: input.now },
      OR: [{ endAt: null }, { endAt: { gt: input.now } }],
      ...(normalized.maxUses == null ? {} : { claimedCount: { lt: normalized.maxUses } }),
    },
    data: { claimedCount: { increment: 1 } },
  });
  if (Number(globalClaim.count ?? 0) !== 1) throw new Error('PROMOTION_MAX_USES_REACHED');

  const key = {
    promotionId_userId: {
      promotionId: normalized.id,
      userId: input.userId,
    },
  };
  const existing = await tx.promotionUserCounter.findUnique({ where: key });

  if (existing) {
    const userClaim = await tx.promotionUserCounter.updateMany({
      where: {
        promotionId: normalized.id,
        userId: input.userId,
        ...(normalized.maxUsesPerUser == null
          ? {}
          : { claimedCount: { lt: normalized.maxUsesPerUser } }),
      },
      data: { claimedCount: { increment: 1 } },
    });
    if (Number(userClaim.count ?? 0) !== 1) {
      throw new Error('PROMOTION_MAX_USES_PER_USER_REACHED');
    }
    return;
  }

  if (normalized.maxUsesPerUser != null && normalized.maxUsesPerUser < 1) {
    throw new Error('PROMOTION_MAX_USES_PER_USER_REACHED');
  }

  try {
    await tx.promotionUserCounter.create({
      data: {
        promotionId: normalized.id,
        userId: input.userId,
        claimedCount: 1,
        usedCount: 0,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const userClaim = await tx.promotionUserCounter.updateMany({
      where: {
        promotionId: normalized.id,
        userId: input.userId,
        ...(normalized.maxUsesPerUser == null
          ? {}
          : { claimedCount: { lt: normalized.maxUsesPerUser } }),
      },
      data: { claimedCount: { increment: 1 } },
    });
    if (Number(userClaim.count ?? 0) !== 1) {
      throw new Error('PROMOTION_MAX_USES_PER_USER_REACHED');
    }
  }
}

export async function releasePromotionClaimForOrder(order: any, tx: PricingDb): Promise<void> {
  const released = await tx.paymentOrder.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: {
      promotionClaimed: false,
      status: 'EXPIRED',
      activeKey: null,
    },
  });
  if (Number(released.count ?? 0) !== 1) return;
  if (!order.promotionId || !order.promotionClaimed) return;

  await Promise.all([
    tx.promotion.updateMany({
      where: { id: order.promotionId, claimedCount: { gt: 0 } },
      data: { claimedCount: { decrement: 1 } },
    }),
    tx.promotionUserCounter.updateMany({
      where: {
        promotionId: order.promotionId,
        userId: order.userId,
        claimedCount: { gt: 0 },
      },
      data: { claimedCount: { decrement: 1 } },
    }),
  ]);
}

export async function finalizePromotionUsageForPaidOrder(
  order: any,
  tx: PricingDb,
  usedAt: Date,
): Promise<void> {
  if (!order.promotionId || !order.promotionClaimed) return;

  const existing = await tx.promotionUsage.findUnique({ where: { orderId: order.id } });
  if (existing) return;

  await tx.promotionUsage.create({
    data: {
      promotionId: order.promotionId,
      userId: order.userId,
      orderId: order.id,
      usedAt,
    },
  });
  await Promise.all([
    tx.promotion.update({
      where: { id: order.promotionId },
      data: { usedCount: { increment: 1 } },
    }),
    tx.promotionUserCounter.update({
      where: {
        promotionId_userId: {
          promotionId: order.promotionId,
          userId: order.userId,
        },
      },
      data: { usedCount: { increment: 1 } },
    }),
  ]);
}

export interface PromotionMutationInput {
  name: string;
  code?: string | null;
  description?: string | null;
  type: PromotionType;
  discountValue?: number | null;
  fixedPriceVnd?: number | null;
  automatic: boolean;
  planIds: number[];
  startAt: Date;
  endAt?: Date | null;
  priority: number;
  maxUses?: number | null;
  maxUsesPerUser?: number | null;
  newUsersOnly: boolean;
  firstPurchaseOnly: boolean;
  minimumDurationDays?: number | null;
  status: Exclude<StoredPromotionStatus, 'DELETED'>;
}

function validatePromotionMutation(input: PromotionMutationInput): void {
  assertPromotionPricingShape(input);
  if (!input.automatic && normalizeCode(input.code) == null) {
    throw new Error('PROMOTION_CODE_REQUIRED_FOR_COUPON');
  }
  if (input.endAt != null && input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error('PROMOTION_END_MUST_BE_AFTER_START');
  }
  if (input.planIds.length === 0) throw new Error('PROMOTION_PLAN_REQUIRED');
  if (new Set(input.planIds).size !== input.planIds.length) {
    throw new Error('PROMOTION_PLAN_DUPLICATE');
  }
}

function mutationData(input: PromotionMutationInput) {
  return {
    name: input.name.trim(),
    code: normalizeCode(input.code),
    description: input.description?.trim() || null,
    type: input.type,
    discountValue: input.type === 'FIXED_PRICE' ? null : (input.discountValue ?? null),
    fixedPriceVnd: input.type === 'FIXED_PRICE' ? (input.fixedPriceVnd ?? null) : null,
    automatic: input.automatic,
    startAt: input.startAt,
    endAt: input.endAt ?? null,
    priority: input.priority,
    maxUses: input.maxUses ?? null,
    maxUsesPerUser: input.maxUsesPerUser ?? null,
    newUsersOnly: input.newUsersOnly,
    firstPurchaseOnly: input.firstPurchaseOnly,
    minimumDurationDays: input.minimumDurationDays ?? null,
    status: input.status,
  };
}

async function ensurePlanIds(planIds: number[], tx: PricingDb): Promise<void> {
  const count = await tx.billingPlan.count({ where: { id: { in: planIds } } });
  if (Number(count) !== planIds.length) throw new Error('PROMOTION_PLAN_NOT_FOUND');
}

export async function createPromotion(
  input: PromotionMutationInput,
  adminUserId: number,
  db: PricingDb = prisma,
) {
  validatePromotionMutation(input);
  return db.$transaction(async (tx: PricingDb) => {
    await ensurePlanIds(input.planIds, tx);
    const created = await tx.promotion.create({
      data: {
        ...mutationData(input),
        planLinks: {
          create: input.planIds.map((billingPlanId) => ({ billingPlanId })),
        },
      },
      include: { planLinks: { include: { billingPlan: true } } },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'CREATE',
        targetType: 'Promotion',
        targetId: String(created.id),
        metadata: jsonSafe({ after: mutationData(input), planIds: input.planIds }),
      },
    });
    return created;
  });
}

export async function updatePromotion(
  promotionId: number,
  input: PromotionMutationInput,
  adminUserId: number,
  db: PricingDb = prisma,
) {
  validatePromotionMutation(input);
  return db.$transaction(async (tx: PricingDb) => {
    const before = await tx.promotion.findUnique({
      where: { id: promotionId },
      include: { planLinks: true },
    });
    if (!before || before.status === 'DELETED') throw new Error('PROMOTION_NOT_FOUND');
    await ensurePlanIds(input.planIds, tx);
    await tx.billingPlanPromotion.deleteMany({ where: { promotionId } });
    await tx.billingPlanPromotion.createMany({
      data: input.planIds.map((billingPlanId) => ({ billingPlanId, promotionId })),
      skipDuplicates: true,
    });
    const updated = await tx.promotion.update({
      where: { id: promotionId },
      data: mutationData(input),
      include: { planLinks: { include: { billingPlan: true } } },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'UPDATE',
        targetType: 'Promotion',
        targetId: String(promotionId),
        metadata: jsonSafe({
          before: {
            ...promotionRecord(before),
            planIds: before.planLinks.map((row: any) => row.billingPlanId),
          },
          after: { ...mutationData(input), planIds: input.planIds },
        }),
      },
    });
    return updated;
  });
}

export async function setPromotionStatus(
  promotionId: number,
  status: 'ACTIVE' | 'INACTIVE',
  adminUserId: number,
  db: PricingDb = prisma,
) {
  return db.$transaction(async (tx: PricingDb) => {
    const before = await tx.promotion.findUnique({ where: { id: promotionId } });
    if (!before || before.status === 'DELETED') throw new Error('PROMOTION_NOT_FOUND');
    const updated = await tx.promotion.update({
      where: { id: promotionId },
      data: { status },
      include: { planLinks: { include: { billingPlan: true } } },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId,
        action: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE',
        targetType: 'Promotion',
        targetId: String(promotionId),
        metadata: { before: before.status, after: status },
      },
    });
    return updated;
  });
}

export async function softDeletePromotion(
  promotionId: number,
  adminUserId: number,
  db: PricingDb = prisma,
  now: Date = new Date(),
) {
  return db.$transaction(async (tx: PricingDb) => {
    const before = await tx.promotion.findUnique({ where: { id: promotionId } });
    if (!before || before.status === 'DELETED') throw new Error('PROMOTION_NOT_FOUND');
    const updated = await tx.promotion.update({
      where: { id: promotionId },
      data: { status: 'DELETED', deletedAt: now },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'DELETE',
        targetType: 'Promotion',
        targetId: String(promotionId),
        metadata: { mode: 'SOFT_DELETE', priorStatus: before.status },
      },
    });
    return updated;
  });
}

export function serializeAdminPromotion(row: any, now: Date = new Date()) {
  const promotion = promotionRecord(row);
  return {
    ...promotion,
    startAt: promotion.startAt.toISOString(),
    endAt: promotion.endAt?.toISOString() ?? null,
    effectiveStatus: effectivePromotionStatus(promotion, now),
    planIds: (row.planLinks ?? []).map((link: any) => Number(link.billingPlanId)),
    plans: (row.planLinks ?? []).map((link: any) => ({
      id: Number(link.billingPlan?.id ?? link.billingPlanId),
      code: link.billingPlan?.code ?? null,
      name: link.billingPlan?.name ?? null,
    })),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

export async function listPromotions(db: PricingDb = prisma, now: Date = new Date()) {
  const rows = await db.promotion.findMany({
    where: { status: { not: 'DELETED' } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    include: { planLinks: { include: { billingPlan: true } } },
  });
  return rows.map((row: any) => serializeAdminPromotion(row, now));
}

export async function getPromotion(promotionId: number, db: PricingDb = prisma, now = new Date()) {
  const row = await db.promotion.findFirst({
    where: { id: promotionId, status: { not: 'DELETED' } },
    include: { planLinks: { include: { billingPlan: true } } },
  });
  return row ? serializeAdminPromotion(row, now) : null;
}

export async function getPromotionDashboard(db: PricingDb = prisma, now = new Date()) {
  const [promotions, paidOrders] = await Promise.all([
    listPromotions(db, now),
    db.paymentOrder.findMany({
      where: { status: 'PAID', promotionId: { not: null } },
      select: {
        promotionId: true,
        finalPriceVnd: true,
        amountVnd: true,
        discountAmountVnd: true,
      },
    }),
  ]);
  const aggregates = new Map<number, { revenue: number; discount: number; redemptions: number }>();
  for (const order of paidOrders) {
    const id = Number(order.promotionId);
    const current = aggregates.get(id) ?? { revenue: 0, discount: 0, redemptions: 0 };
    current.revenue += Number(order.finalPriceVnd ?? order.amountVnd ?? 0);
    current.discount += Number(order.discountAmountVnd ?? 0);
    current.redemptions += 1;
    aggregates.set(id, current);
  }
  const rows = promotions.map((promotion: any) => ({
    ...promotion,
    statistics: aggregates.get(promotion.id) ?? {
      revenue: 0,
      discount: 0,
      redemptions: 0,
    },
  }));
  return {
    generatedAt: now.toISOString(),
    timezone: PRICING_TIMEZONE,
    activePromotions: rows.filter((row: any) => row.effectiveStatus === 'ACTIVE').length,
    scheduledPromotions: rows.filter((row: any) => row.effectiveStatus === 'SCHEDULED').length,
    expiredPromotions: rows.filter((row: any) => row.effectiveStatus === 'EXPIRED').length,
    totalRedemptions: rows.reduce((sum: number, row: any) => sum + row.statistics.redemptions, 0),
    totalRevenue: rows.reduce((sum: number, row: any) => sum + row.statistics.revenue, 0),
    totalDiscountGiven: rows.reduce((sum: number, row: any) => sum + row.statistics.discount, 0),
    promotions: rows,
  };
}

export async function getPromotionStatistics(
  promotionId: number,
  db: PricingDb = prisma,
  now = new Date(),
) {
  const dashboard = await getPromotionDashboard(db, now);
  return dashboard.promotions.find((row: any) => row.id === promotionId) ?? null;
}
