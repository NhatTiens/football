export const PRICING_ENGINE_VERSION = 'pricing-promotion-v1';
export const PRICING_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const FREE_TRIAL_DAYS = 7;

export type BillingDurationUnit = 'DAY' | 'MONTH';
export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FIXED_PRICE';
export type StoredPromotionStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';
export type EffectivePromotionStatus = 'ACTIVE' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DELETED';

export interface PricingPlanRecord {
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
  sortOrder?: number;
}

export interface PricingPromotionRecord {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  type: PromotionType;
  discountValue: number | null;
  fixedPriceVnd: number | null;
  automatic: boolean;
  startAt: Date;
  endAt: Date | null;
  maxUses: number | null;
  claimedCount: number;
  usedCount: number;
  maxUsesPerUser: number | null;
  priority: number;
  status: StoredPromotionStatus;
  newUsersOnly: boolean;
  firstPurchaseOnly: boolean;
  minimumDurationDays: number | null;
}

export interface PricingUserContext {
  userId: number | null;
  registeredAt: Date | null;
  paidProPurchaseCount: number;
  claimedByPromotion: Record<number, number>;
}

export type PromotionIneligibilityReason =
  | 'PROMOTION_INACTIVE'
  | 'PROMOTION_NOT_STARTED'
  | 'PROMOTION_EXPIRED'
  | 'PROMOTION_DELETED'
  | 'AUTHENTICATION_REQUIRED'
  | 'NOT_NEW_USER'
  | 'NOT_FIRST_PURCHASE'
  | 'MAX_USES_REACHED'
  | 'MAX_USES_PER_USER_REACHED'
  | 'MINIMUM_DURATION_NOT_MET'
  | 'COUPON_REQUIRED';

export interface PromotionEligibilityResult {
  promotionId: number;
  promotionCode: string | null;
  eligible: boolean;
  reason: PromotionIneligibilityReason | null;
  effectiveStatus: EffectivePromotionStatus;
  priority: number;
  finalPriceVnd: number | null;
}

export interface PricingQuote {
  engineVersion: typeof PRICING_ENGINE_VERSION;
  calculatedAt: string;
  timezone: typeof PRICING_TIMEZONE;
  plan: PricingPlanRecord;
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  currency: string;
  promotion: PricingPromotionRecord | null;
  promotionId: number | null;
  promotionCode: string | null;
  expiresAt: string | null;
  eligibility: PromotionEligibilityResult[];
  requestedCoupon: {
    code: string;
    valid: boolean;
    reason: 'NOT_FOUND' | PromotionIneligibilityReason | null;
  } | null;
}

function normalizedCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function planDurationDays(
  plan: Pick<PricingPlanRecord, 'durationCount' | 'durationUnit'>,
): number {
  return plan.durationUnit === 'MONTH' ? plan.durationCount * 30 : plan.durationCount;
}

export function effectivePromotionStatus(
  promotion: Pick<PricingPromotionRecord, 'status' | 'startAt' | 'endAt'>,
  now: Date,
): EffectivePromotionStatus {
  if (promotion.status === 'DELETED') return 'DELETED';
  if (promotion.status === 'INACTIVE') return 'INACTIVE';
  if (promotion.startAt.getTime() > now.getTime()) return 'SCHEDULED';
  if (promotion.endAt != null && promotion.endAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export function promotionDiscountVnd(
  basePriceVnd: number,
  promotion: Pick<PricingPromotionRecord, 'type' | 'discountValue' | 'fixedPriceVnd'>,
): number {
  if (!Number.isInteger(basePriceVnd) || basePriceVnd < 0) {
    throw new RangeError('Base price must be a non-negative integer.');
  }

  let discount: number;
  if (promotion.type === 'PERCENTAGE') {
    const percentage = promotion.discountValue ?? 0;
    discount = Math.round(basePriceVnd * (percentage / 100));
  } else if (promotion.type === 'FIXED_AMOUNT') {
    discount = Math.round(promotion.discountValue ?? 0);
  } else {
    discount = basePriceVnd - Math.round(promotion.fixedPriceVnd ?? basePriceVnd);
  }

  return Math.max(0, Math.min(basePriceVnd, discount));
}

export function assertPromotionPricingShape(input: {
  type: PromotionType;
  discountValue?: number | null;
  fixedPriceVnd?: number | null;
}): void {
  if (input.type === 'PERCENTAGE') {
    if (
      input.discountValue == null ||
      !Number.isFinite(input.discountValue) ||
      input.discountValue <= 0 ||
      input.discountValue > 100
    ) {
      throw new Error('PERCENTAGE promotion requires discountValue between 0 and 100.');
    }
    return;
  }

  if (input.type === 'FIXED_AMOUNT') {
    if (
      input.discountValue == null ||
      !Number.isInteger(input.discountValue) ||
      input.discountValue <= 0
    ) {
      throw new Error('FIXED_AMOUNT promotion requires a positive integer discountValue.');
    }
    return;
  }

  if (
    input.fixedPriceVnd == null ||
    !Number.isInteger(input.fixedPriceVnd) ||
    input.fixedPriceVnd < 0
  ) {
    throw new Error('FIXED_PRICE promotion requires a non-negative integer fixedPriceVnd.');
  }
}

function eligibilityForPromotion(input: {
  plan: PricingPlanRecord;
  promotion: PricingPromotionRecord;
  user: PricingUserContext;
  requestedCode: string | null;
  now: Date;
}): PromotionEligibilityResult {
  const { plan, promotion, user, requestedCode, now } = input;
  const effectiveStatus = effectivePromotionStatus(promotion, now);
  let reason: PromotionIneligibilityReason | null = null;

  if (effectiveStatus === 'DELETED') reason = 'PROMOTION_DELETED';
  else if (effectiveStatus === 'INACTIVE') reason = 'PROMOTION_INACTIVE';
  else if (effectiveStatus === 'SCHEDULED') reason = 'PROMOTION_NOT_STARTED';
  else if (effectiveStatus === 'EXPIRED') reason = 'PROMOTION_EXPIRED';
  else if (!promotion.automatic && normalizedCode(promotion.code) !== requestedCode) {
    reason = 'COUPON_REQUIRED';
  } else if ((promotion.newUsersOnly || promotion.firstPurchaseOnly) && user.userId == null) {
    reason = 'AUTHENTICATION_REQUIRED';
  } else if (
    promotion.newUsersOnly &&
    (user.registeredAt == null || user.registeredAt.getTime() < promotion.startAt.getTime())
  ) {
    reason = 'NOT_NEW_USER';
  } else if (promotion.firstPurchaseOnly && user.paidProPurchaseCount > 0) {
    reason = 'NOT_FIRST_PURCHASE';
  } else if (promotion.maxUses != null && promotion.claimedCount >= promotion.maxUses) {
    reason = 'MAX_USES_REACHED';
  } else if (
    promotion.maxUsesPerUser != null &&
    (user.claimedByPromotion[promotion.id] ?? 0) >= promotion.maxUsesPerUser
  ) {
    reason = 'MAX_USES_PER_USER_REACHED';
  } else if (
    promotion.minimumDurationDays != null &&
    planDurationDays(plan) < promotion.minimumDurationDays
  ) {
    reason = 'MINIMUM_DURATION_NOT_MET';
  }

  const discount = reason == null ? promotionDiscountVnd(plan.basePriceVnd, promotion) : null;
  return {
    promotionId: promotion.id,
    promotionCode: normalizedCode(promotion.code),
    eligible: reason == null,
    reason,
    effectiveStatus,
    priority: promotion.priority,
    finalPriceVnd: discount == null ? null : plan.basePriceVnd - discount,
  };
}

export function calculatePriceCore(input: {
  plan: PricingPlanRecord;
  promotions: PricingPromotionRecord[];
  user: PricingUserContext;
  promotionCode?: string | null;
  now?: Date;
}): PricingQuote {
  const now = input.now ?? new Date();
  const requestedCode = normalizedCode(input.promotionCode);
  const visiblePromotions = input.promotions.filter(
    (promotion) => promotion.automatic || normalizedCode(promotion.code) === requestedCode,
  );
  const eligibility = visiblePromotions.map((promotion) =>
    eligibilityForPromotion({
      plan: input.plan,
      promotion,
      user: input.user,
      requestedCode,
      now,
    }),
  );

  const eligible = eligibility
    .filter((row) => row.eligible && row.finalPriceVnd != null)
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        (left.finalPriceVnd ?? input.plan.basePriceVnd) -
          (right.finalPriceVnd ?? input.plan.basePriceVnd) ||
        left.promotionId - right.promotionId,
    );
  const selectedEligibility = eligible[0] ?? null;
  const selectedPromotion =
    selectedEligibility == null
      ? null
      : (visiblePromotions.find((promotion) => promotion.id === selectedEligibility.promotionId) ??
        null);
  const discountAmount =
    selectedPromotion == null
      ? 0
      : promotionDiscountVnd(input.plan.basePriceVnd, selectedPromotion);

  const couponPromotion =
    requestedCode == null
      ? null
      : (input.promotions.find((promotion) => normalizedCode(promotion.code) === requestedCode) ??
        null);
  const couponEligibility =
    couponPromotion == null
      ? null
      : (eligibility.find((row) => row.promotionId === couponPromotion.id) ?? null);

  return {
    engineVersion: PRICING_ENGINE_VERSION,
    calculatedAt: now.toISOString(),
    timezone: PRICING_TIMEZONE,
    plan: input.plan,
    basePrice: input.plan.basePriceVnd,
    discountAmount,
    finalPrice: input.plan.basePriceVnd - discountAmount,
    currency: input.plan.currency,
    promotion: selectedPromotion,
    promotionId: selectedPromotion?.id ?? null,
    promotionCode: normalizedCode(selectedPromotion?.code),
    expiresAt: selectedPromotion?.endAt?.toISOString() ?? null,
    eligibility,
    requestedCoupon:
      requestedCode == null
        ? null
        : {
            code: requestedCode,
            valid: couponEligibility?.eligible === true,
            reason: couponPromotion == null ? 'NOT_FOUND' : (couponEligibility?.reason ?? null),
          },
  };
}
