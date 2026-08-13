-- PRICING_PROMOTION_V1
-- Additive migration only: existing commercial rows remain valid and use legacy fallbacks.

ALTER TABLE `AuthUser`
  ADD COLUMN `trialStartedAt` DATETIME(3) NULL,
  ADD COLUMN `trialEndsAt` DATETIME(3) NULL,
  ADD COLUMN `trialUsed` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `TrialClaim` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `emailHash` VARCHAR(64) NOT NULL,
  `userId` INTEGER NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `endsAt` DATETIME(3) NOT NULL,
  `used` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TrialClaim_emailHash_key`(`emailHash`),
  UNIQUE INDEX `TrialClaim_userId_key`(`userId`),
  INDEX `TrialClaim_endsAt_idx`(`endsAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingPlan` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `durationCount` INTEGER NOT NULL,
  `durationUnit` ENUM('DAY', 'MONTH') NOT NULL,
  `basePriceVnd` INTEGER NOT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'VND',
  `purchasable` BOOLEAN NOT NULL DEFAULT true,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BillingPlan_code_key`(`code`),
  INDEX `BillingPlan_status_sortOrder_idx`(`status`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Promotion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `code` VARCHAR(64) NULL,
  `description` TEXT NULL,
  `type` ENUM('PERCENTAGE', 'FIXED_AMOUNT', 'FIXED_PRICE') NOT NULL,
  `discountValue` DOUBLE NULL,
  `fixedPriceVnd` INTEGER NULL,
  `automatic` BOOLEAN NOT NULL DEFAULT false,
  `startAt` DATETIME(3) NOT NULL,
  `endAt` DATETIME(3) NULL,
  `maxUses` INTEGER NULL,
  `claimedCount` INTEGER NOT NULL DEFAULT 0,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `maxUsesPerUser` INTEGER NULL,
  `priority` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE', 'INACTIVE', 'DELETED') NOT NULL DEFAULT 'INACTIVE',
  `newUsersOnly` BOOLEAN NOT NULL DEFAULT false,
  `firstPurchaseOnly` BOOLEAN NOT NULL DEFAULT false,
  `minimumDurationDays` INTEGER NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Promotion_code_key`(`code`),
  INDEX `Promotion_status_startAt_endAt_idx`(`status`, `startAt`, `endAt`),
  INDEX `Promotion_priority_status_idx`(`priority`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingPlanPromotion` (
  `billingPlanId` INTEGER NOT NULL,
  `promotionId` INTEGER NOT NULL,
  INDEX `BillingPlanPromotion_promotionId_idx`(`promotionId`),
  PRIMARY KEY (`billingPlanId`, `promotionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PaymentOrder`
  ADD COLUMN `billingPlanId` INTEGER NULL,
  ADD COLUMN `originalPriceVnd` INTEGER NULL,
  ADD COLUMN `discountAmountVnd` INTEGER NULL,
  ADD COLUMN `finalPriceVnd` INTEGER NULL,
  ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'VND',
  ADD COLUMN `promotionId` INTEGER NULL,
  ADD COLUMN `promotionCode` VARCHAR(64) NULL,
  ADD COLUMN `promotionClaimed` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `durationCount` INTEGER NULL,
  ADD COLUMN `durationUnit` ENUM('DAY', 'MONTH') NULL,
  ADD COLUMN `pricingSnapshot` JSON NULL,
  ADD INDEX `PaymentOrder_billingPlanId_status_createdAt_idx`(`billingPlanId`, `status`, `createdAt`),
  ADD INDEX `PaymentOrder_promotionId_status_createdAt_idx`(`promotionId`, `status`, `createdAt`);

ALTER TABLE `Subscription`
  ADD COLUMN `billingPlanId` INTEGER NULL,
  ADD COLUMN `autoRenew` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `pricePaidVnd` INTEGER NULL,
  ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'VND',
  ADD INDEX `Subscription_billingPlanId_status_expiresAt_idx`(`billingPlanId`, `status`, `expiresAt`);

CREATE TABLE `PromotionUsage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `promotionId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `orderId` INTEGER NOT NULL,
  `usedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PromotionUsage_orderId_key`(`orderId`),
  UNIQUE INDEX `PromotionUsage_promotionId_userId_orderId_key`(`promotionId`, `userId`, `orderId`),
  INDEX `PromotionUsage_promotionId_usedAt_idx`(`promotionId`, `usedAt`),
  INDEX `PromotionUsage_userId_usedAt_idx`(`userId`, `usedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PromotionUserCounter` (
  `promotionId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `claimedCount` INTEGER NOT NULL DEFAULT 0,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `PromotionUserCounter_userId_idx`(`userId`),
  PRIMARY KEY (`promotionId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TrialClaim`
  ADD CONSTRAINT `TrialClaim_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `BillingPlanPromotion`
  ADD CONSTRAINT `BillingPlanPromotion_billingPlanId_fkey`
  FOREIGN KEY (`billingPlanId`) REFERENCES `BillingPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `BillingPlanPromotion_promotionId_fkey`
  FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PaymentOrder`
  ADD CONSTRAINT `PaymentOrder_billingPlanId_fkey`
  FOREIGN KEY (`billingPlanId`) REFERENCES `BillingPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `PaymentOrder_promotionId_fkey`
  FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Subscription`
  ADD CONSTRAINT `Subscription_billingPlanId_fkey`
  FOREIGN KEY (`billingPlanId`) REFERENCES `BillingPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PromotionUsage`
  ADD CONSTRAINT `PromotionUsage_promotionId_fkey`
  FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PromotionUsage_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `PromotionUsage_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `PaymentOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PromotionUserCounter`
  ADD CONSTRAINT `PromotionUserCounter_promotionId_fkey`
  FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PromotionUserCounter_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
