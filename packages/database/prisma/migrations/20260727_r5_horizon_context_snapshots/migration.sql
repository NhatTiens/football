CREATE TABLE `FixtureInjurySnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL,
  `contentHash` VARCHAR(64) NOT NULL,
  `playerCount` INTEGER NOT NULL DEFAULT 0,
  `rawPayload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `FixtureInjurySnapshot_fixture_captured_key`(`fixtureId`, `capturedAt`),
  INDEX `FixtureInjurySnapshot_fixture_captured_idx`(`fixtureId`, `capturedAt`),
  INDEX `FixtureInjurySnapshot_hash_idx`(`contentHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureInjurySnapshotPlayer` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `snapshotId` INTEGER NOT NULL,
  `teamId` INTEGER NOT NULL,
  `apiPlayerId` INTEGER NOT NULL,
  `playerName` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `injuryType` VARCHAR(191) NULL,
  `rawPayload` JSON NULL,

  UNIQUE INDEX `FixtureInjurySnapshotPlayer_snapshot_team_player_key`(`snapshotId`, `teamId`, `apiPlayerId`),
  INDEX `FixtureInjurySnapshotPlayer_team_player_idx`(`teamId`, `apiPlayerId`),
  PRIMARY KEY (`id`),

  CONSTRAINT `FixtureInjurySnapshotPlayer_snapshotId_fkey`
    FOREIGN KEY (`snapshotId`)
    REFERENCES `FixtureInjurySnapshot`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureContextCoverageSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `dataType` VARCHAR(24) NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL,
  `responseCount` INTEGER NOT NULL DEFAULT 0,
  `contentHash` VARCHAR(64) NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `FixtureContextCoverage_fixture_type_captured_idx`(`fixtureId`, `dataType`, `capturedAt`),
  INDEX `FixtureContextCoverage_type_captured_idx`(`dataType`, `capturedAt`),
  INDEX `FixtureContextCoverage_hash_idx`(`contentHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureContextCollectionCheckpoint` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `dueAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `attemptedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `lineupProcessed` INTEGER NOT NULL DEFAULT 0,
  `injuryProcessed` INTEGER NOT NULL DEFAULT 0,
  `lockToken` VARCHAR(64) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `FixtureContextCheckpoint_fixture_horizon_key`(`fixtureId`, `horizonMinutes`),
  INDEX `FixtureContextCheckpoint_status_due_idx`(`status`, `dueAt`),
  INDEX `FixtureContextCheckpoint_fixture_completed_idx`(`fixtureId`, `completedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
