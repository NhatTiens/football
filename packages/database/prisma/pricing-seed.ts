import { PrismaClient } from '../src/index.js';

const prisma = new PrismaClient();

const PROMOTION_END_UTC = new Date('2027-01-01T17:00:00.000Z');

async function upsertPlan(input: {
  code: string;
  name: string;
  description: string;
  durationCount: number;
  durationUnit: 'DAY' | 'MONTH';
  basePriceVnd: number;
  purchasable: boolean;
  sortOrder: number;
}) {
  return prisma.billingPlan.upsert({
    where: { code: input.code },
    create: { ...input, currency: 'VND', status: 'ACTIVE' },
    update: { ...input, currency: 'VND', status: 'ACTIVE' },
  });
}

async function ensurePromotion(input: {
  code: string;
  planId: number;
  create: Record<string, unknown>;
}) {
  let promotion = await prisma.promotion.findUnique({ where: { code: input.code } });
  if (!promotion) {
    promotion = await prisma.promotion.create({
      data: {
        ...input.create,
        code: input.code,
        planLinks: { create: [{ billingPlanId: input.planId }] },
      },
    });
  } else {
    await prisma.billingPlanPromotion.upsert({
      where: {
        billingPlanId_promotionId: {
          billingPlanId: input.planId,
          promotionId: promotion.id,
        },
      },
      create: { billingPlanId: input.planId, promotionId: promotion.id },
      update: {},
    });
  }
  return promotion;
}

async function main(): Promise<void> {
  const trial = await upsertPlan({
    code: 'FREE_TRIAL',
    name: 'Free Trial',
    description: 'Dùng thử miễn phí một lần cho tài khoản mới.',
    durationCount: 7,
    durationUnit: 'DAY',
    basePriceVnd: 0,
    purchasable: false,
    sortOrder: 0,
  });
  const monthly = await upsertPlan({
    code: 'PRO_MONTHLY',
    name: 'Pro Monthly',
    description: 'Gói Pro tiêu chuẩn theo tháng.',
    durationCount: 1,
    durationUnit: 'MONTH',
    basePriceVnd: 35_000,
    purchasable: true,
    sortOrder: 10,
  });
  const sixMonths = await upsertPlan({
    code: 'PRO_6_MONTH',
    name: 'Pro 6 Months',
    description: 'Gói Pro có hiệu lực đủ 6 tháng kể từ thời điểm thanh toán.',
    durationCount: 6,
    durationUnit: 'MONTH',
    basePriceVnd: 210_000,
    purchasable: true,
    sortOrder: 20,
  });

  const now = new Date();
  const firstPurchase = await ensurePromotion({
    code: 'PRO_FIRST_PURCHASE',
    planId: monthly.id,
    create: {
      name: 'First Pro Purchase',
      description: 'Giá 25.000đ cho lần mua Pro đầu tiên.',
      type: 'FIXED_PRICE',
      fixedPriceVnd: 25_000,
      automatic: true,
      startAt: now,
      endAt: null,
      maxUsesPerUser: 1,
      priority: 100,
      status: 'ACTIVE',
      newUsersOnly: false,
      firstPurchaseOnly: true,
      minimumDurationDays: null,
    },
  });
  const sixMonthPromotion = await ensurePromotion({
    code: 'PRO_6_MONTH_PROMO',
    planId: sixMonths.id,
    create: {
      name: 'Pro 6 Months - 20K/month',
      description: '6 tháng Pro với giá 120.000đ (20.000đ/tháng).',
      type: 'FIXED_PRICE',
      fixedPriceVnd: 120_000,
      automatic: true,
      startAt: now,
      endAt: PROMOTION_END_UTC,
      maxUsesPerUser: null,
      priority: 80,
      status: 'ACTIVE',
      newUsersOnly: false,
      firstPurchaseOnly: false,
      minimumDurationDays: 180,
    },
  });

  console.info({
    seed: 'pricing-promotion-v1',
    plans: [trial.code, monthly.code, sixMonths.code],
    promotions: [firstPurchase.code, sixMonthPromotion.code],
    timezone: 'Asia/Ho_Chi_Minh',
    promotionEndExclusiveUtc: PROMOTION_END_UTC.toISOString(),
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
