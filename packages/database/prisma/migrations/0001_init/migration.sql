-- Football Value AI initial schema for MySQL 8.
-- Generated to mirror packages/database/prisma/schema.prisma.

CREATE TABLE `League` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `apiLeagueId` INTEGER NOT NULL,
  `season` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `country` VARCHAR(191) NULL,
  `logoUrl` TEXT NULL,
  `coverage` JSON NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `League_apiLeagueId_season_key` (`apiLeagueId`, `season`),
  INDEX `League_enabled_idx` (`enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Team` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `apiTeamId` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NULL,
  `country` VARCHAR(191) NULL,
  `logoUrl` TEXT NULL,
  `venueName` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Team_apiTeamId_key` (`apiTeamId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Fixture` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `apiFixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `homeTeamId` INTEGER NOT NULL,
  `awayTeamId` INTEGER NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `timezone` VARCHAR(191) NULL,
  `round` VARCHAR(191) NULL,
  `venueName` VARCHAR(191) NULL,
  `referee` VARCHAR(191) NULL,
  `status` ENUM('UPCOMING','LIVE','FINISHED','POSTPONED','CANCELLED') NOT NULL DEFAULT 'UPCOMING',
  `apiStatusShort` VARCHAR(191) NULL,
  `elapsedMinutes` INTEGER NULL,
  `homeGoals` INTEGER NULL,
  `awayGoals` INTEGER NULL,
  `halftimeHomeGoals` INTEGER NULL,
  `halftimeAwayGoals` INTEGER NULL,
  `rawPayload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Fixture_apiFixtureId_key` (`apiFixtureId`),
  INDEX `Fixture_kickoffAt_idx` (`kickoffAt`),
  INDEX `Fixture_leagueId_status_kickoffAt_idx` (`leagueId`, `status`, `kickoffAt`),
  INDEX `Fixture_homeTeamId_kickoffAt_idx` (`homeTeamId`, `kickoffAt`),
  INDEX `Fixture_awayTeamId_kickoffAt_idx` (`awayTeamId`, `kickoffAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Fixture_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Fixture_homeTeamId_fkey` FOREIGN KEY (`homeTeamId`) REFERENCES `Team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Fixture_awayTeamId_fkey` FOREIGN KEY (`awayTeamId`) REFERENCES `Team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Bookmaker` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `apiBookmakerId` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Bookmaker_apiBookmakerId_key` (`apiBookmakerId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BettingMarket` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `apiBetId` INTEGER NULL,
  `marketCode` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `marketGroup` VARCHAR(191) NOT NULL,
  `lineValue` DOUBLE NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BettingMarket_marketCode_key` (`marketCode`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OddsSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `bookmakerId` INTEGER NOT NULL,
  `marketId` INTEGER NOT NULL,
  `selectionCode` VARCHAR(191) NOT NULL,
  `selectionName` VARCHAR(191) NOT NULL,
  `lineValue` DOUBLE NULL,
  `decimalOdds` DOUBLE NOT NULL,
  `isLive` BOOLEAN NOT NULL DEFAULT false,
  `apiUpdatedAt` DATETIME(3) NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `rawPayload` JSON NULL,
  INDEX `OddsSnapshot_fixtureId_marketId_capturedAt_idx` (`fixtureId`, `marketId`, `capturedAt`),
  INDEX `OddsSnapshot_fixtureId_bookmakerId_marketId_selectionCode_capturedAt_idx` (`fixtureId`, `bookmakerId`, `marketId`, `selectionCode`, `capturedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `OddsSnapshot_fixtureId_fkey` FOREIGN KEY (`fixtureId`) REFERENCES `Fixture` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `OddsSnapshot_bookmakerId_fkey` FOREIGN KEY (`bookmakerId`) REFERENCES `Bookmaker` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OddsSnapshot_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `BettingMarket` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ExternalPrediction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `homeProbability` DOUBLE NULL,
  `drawProbability` DOUBLE NULL,
  `awayProbability` DOUBLE NULL,
  `advice` TEXT NULL,
  `predictedWinner` VARCHAR(191) NULL,
  `rawPayload` JSON NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ExternalPrediction_fixtureId_key` (`fixtureId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ExternalPrediction_fixtureId_fkey` FOREIGN KEY (`fixtureId`) REFERENCES `Fixture` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Recommendation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `bookmakerId` INTEGER NOT NULL,
  `oddsSnapshotId` INTEGER NOT NULL,
  `marketCode` VARCHAR(191) NOT NULL,
  `marketName` VARCHAR(191) NOT NULL,
  `marketGroup` VARCHAR(191) NOT NULL,
  `selectionCode` VARCHAR(191) NOT NULL,
  `selectionName` VARCHAR(191) NOT NULL,
  `lineValue` DOUBLE NULL,
  `decimalOdds` DOUBLE NOT NULL,
  `modelProbability` DOUBLE NOT NULL,
  `fairMarketProbability` DOUBLE NOT NULL,
  `impliedProbability` DOUBLE NOT NULL,
  `edge` DOUBLE NOT NULL,
  `expectedValue` DOUBLE NOT NULL,
  `confidenceScore` DOUBLE NOT NULL,
  `dataQualityScore` DOUBLE NOT NULL,
  `recommendationScore` DOUBLE NOT NULL,
  `rankNumber` INTEGER NULL,
  `modelVersion` VARCHAR(191) NOT NULL,
  `reasons` JSON NOT NULL,
  `status` ENUM('ACTIVE','EXPIRED','REVOKED','SETTLED') NOT NULL DEFAULT 'ACTIVE',
  `settlementResult` ENUM('PENDING','WIN','LOSS','PUSH','VOID') NOT NULL DEFAULT 'PENDING',
  `simulatedProfitUnits` DOUBLE NULL,
  `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `settledAt` DATETIME(3) NULL,
  INDEX `Recommendation_status_generatedAt_idx` (`status`, `generatedAt`),
  INDEX `Recommendation_fixtureId_status_idx` (`fixtureId`, `status`),
  INDEX `Recommendation_marketCode_settlementResult_idx` (`marketCode`, `settlementResult`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Recommendation_fixtureId_fkey` FOREIGN KEY (`fixtureId`) REFERENCES `Fixture` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Recommendation_bookmakerId_fkey` FOREIGN KEY (`bookmakerId`) REFERENCES `Bookmaker` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Recommendation_oddsSnapshotId_fkey` FOREIGN KEY (`oddsSnapshotId`) REFERENCES `OddsSnapshot` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SyncRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `jobName` VARCHAR(191) NOT NULL,
  `status` ENUM('RUNNING','SUCCESS','FAILED') NOT NULL DEFAULT 'RUNNING',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `processed` INTEGER NOT NULL DEFAULT 0,
  `inserted` INTEGER NOT NULL DEFAULT 0,
  `updated` INTEGER NOT NULL DEFAULT 0,
  `errorMessage` TEXT NULL,
  `metadata` JSON NULL,
  INDEX `SyncRun_jobName_startedAt_idx` (`jobName`, `startedAt`),
  INDEX `SyncRun_status_idx` (`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiUsage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `endpoint` VARCHAR(191) NOT NULL,
  `requestDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `responseStatus` INTEGER NOT NULL,
  `dailyLimit` INTEGER NULL,
  `dailyRemaining` INTEGER NULL,
  `minuteLimit` INTEGER NULL,
  `minuteRemaining` INTEGER NULL,
  `durationMs` INTEGER NULL,
  `errorMessage` TEXT NULL,
  INDEX `ApiUsage_requestDate_idx` (`requestDate`),
  INDEX `ApiUsage_endpoint_requestDate_idx` (`endpoint`, `requestDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppSetting` (
  `key` VARCHAR(191) NOT NULL,
  `value` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
