-- AlterTable
ALTER TABLE `authuser` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `forcePasswordChange` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `plan` ENUM('FREE', 'PRO') NOT NULL DEFAULT 'FREE',
    ADD COLUMN `proExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('PENDING_VERIFICATION', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'PENDING_VERIFICATION';

-- CreateTable
CREATE TABLE `AuthVerificationCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `purpose` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET') NOT NULL,
    `codeHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `supersededAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthVerificationCode_userId_purpose_expiresAt_idx`(`userId`, `purpose`, `expiresAt`),
    INDEX `AuthVerificationCode_purpose_expiresAt_idx`(`purpose`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthUsageDaily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `featureKey` VARCHAR(64) NOT NULL,
    `usageDate` DATE NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuthUsageDaily_featureKey_usageDate_idx`(`featureKey`, `usageDate`),
    UNIQUE INDEX `AuthUsageDaily_userId_featureKey_usageDate_key`(`userId`, `featureKey`, `usageDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adminUserId` INTEGER NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `targetType` VARCHAR(64) NOT NULL,
    `targetId` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_adminUserId_createdAt_idx`(`adminUserId`, `createdAt`),
    INDEX `AdminAuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `AuthUser_status_idx` ON `AuthUser`(`status`);

-- CreateIndex
CREATE INDEX `AuthUser_plan_idx` ON `AuthUser`(`plan`);

-- AddForeignKey
ALTER TABLE `AuthVerificationCode` ADD CONSTRAINT `AuthVerificationCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthUsageDaily` ADD CONSTRAINT `AuthUsageDaily_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
