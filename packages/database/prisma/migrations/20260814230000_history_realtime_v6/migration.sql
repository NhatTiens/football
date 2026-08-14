-- Durable result jobs, hard daily API quota, and reliable realtime outbox.
CREATE TABLE `ResultUpdateJob` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerFixtureId` INTEGER NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `maxAttempts` INTEGER NOT NULL DEFAULT 12,
  `nextCheckAt` DATETIME(3) NOT NULL,
  `lastCheckedAt` DATETIME(3) NULL,
  `lockedAt` DATETIME(3) NULL,
  `lockToken` VARCHAR(64) NULL,
  `completedAt` DATETIME(3) NULL,
  `lastProviderStatus` VARCHAR(24) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ResultUpdateJob_providerFixtureId_key`(`providerFixtureId`),
  INDEX `ResultUpdateJob_status_next_idx`(`status`, `nextCheckAt`),
  INDEX `ResultUpdateJob_locked_idx`(`lockedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiQuotaDaily` (
  `quotaDate` VARCHAR(10) NOT NULL,
  `dailyLimit` INTEGER NOT NULL DEFAULT 7500,
  `used` INTEGER NOT NULL DEFAULT 0,
  `remaining` INTEGER NOT NULL DEFAULT 7500,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`quotaDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RealtimeOutbox` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `eventType` VARCHAR(64) NOT NULL,
  `aggregateId` VARCHAR(128) NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `publishedAt` DATETIME(3) NULL,
  `lockedAt` DATETIME(3) NULL,
  `lockToken` VARCHAR(64) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  INDEX `RealtimeOutbox_published_created_idx`(`publishedAt`, `createdAt`),
  INDEX `RealtimeOutbox_locked_idx`(`lockedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
