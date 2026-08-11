-- BILLING-1 — Commercial billing database foundation
-- Creates only the three billing tables that already exist in Prisma schema
-- but are absent from the applied migration history / current MySQL database.
--
-- Idempotency constraints:
-- 1) PaymentOrder.orderCode is unique.
-- 2) (PaymentOrder.provider, providerTransactionId) is unique when transaction id is present.
-- 3) Subscription.sourcePaymentOrderId is unique when present.
-- 4) (PaymentWebhookEvent.provider, externalId) is unique.

CREATE TABLE `PaymentOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `orderCode` VARCHAR(64) NOT NULL,
    `planCode` VARCHAR(32) NOT NULL,
    `amountVnd` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(32) NOT NULL,
    `transferContent` VARCHAR(128) NOT NULL,
    `qrUrl` TEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `providerTransactionId` VARCHAR(128) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentOrder_orderCode_key`(`orderCode`),
    UNIQUE INDEX `PaymentOrder_provider_providerTransactionId_key`(`provider`, `providerTransactionId`),
    INDEX `PaymentOrder_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `PaymentOrder_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Subscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `planCode` VARCHAR(32) NOT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `startsAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `sourcePaymentOrderId` INTEGER NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Subscription_sourcePaymentOrderId_key`(`sourcePaymentOrderId`),
    INDEX `Subscription_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Subscription_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PaymentWebhookEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(32) NOT NULL,
    `externalId` VARCHAR(128) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processingStatus` VARCHAR(32) NOT NULL,
    `orderId` INTEGER NULL,
    `errorReason` TEXT NULL,
    `rawPayload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentWebhookEvent_provider_externalId_key`(`provider`, `externalId`),
    INDEX `PaymentWebhookEvent_processingStatus_receivedAt_idx`(`processingStatus`, `receivedAt`),
    INDEX `PaymentWebhookEvent_orderId_receivedAt_idx`(`orderId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PaymentOrder`
    ADD CONSTRAINT `PaymentOrder_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Subscription`
    ADD CONSTRAINT `Subscription_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Subscription`
    ADD CONSTRAINT `Subscription_sourcePaymentOrderId_fkey`
    FOREIGN KEY (`sourcePaymentOrderId`) REFERENCES `PaymentOrder`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PaymentWebhookEvent`
    ADD CONSTRAINT `PaymentWebhookEvent_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `PaymentOrder`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
