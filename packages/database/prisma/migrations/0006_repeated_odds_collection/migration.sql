CREATE TABLE `OddsCollectionCheckpoint` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `dueAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `attemptedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `nextRetryAt` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `processed` INTEGER NOT NULL DEFAULT 0,
  `inserted` INTEGER NOT NULL DEFAULT 0,
  `lockToken` VARCHAR(64) NULL,
  `errorMessage` TEXT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OddsCollectionCheckpoint_fixtureId_horizonMinutes_key`(`fixtureId`, `horizonMinutes`),
  INDEX `OddsCollectionCheckpoint_status_dueAt_idx`(`status`, `dueAt`),
  INDEX `OddsCollectionCheckpoint_fixtureId_completedAt_idx`(`fixtureId`, `completedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OddsCollectionCheckpoint`
  ADD CONSTRAINT `OddsCollectionCheckpoint_fixtureId_fkey`
  FOREIGN KEY (`fixtureId`) REFERENCES `Fixture`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
