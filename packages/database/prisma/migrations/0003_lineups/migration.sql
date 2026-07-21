CREATE TABLE `Player` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `apiPlayerId` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `photoUrl` TEXT NULL,
  `defaultPosition` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Player_apiPlayerId_key`(`apiPlayerId`),
  INDEX `Player_name_idx`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureLineupSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `teamId` INTEGER NOT NULL,
  `formation` VARCHAR(191) NULL,
  `coachApiId` INTEGER NULL,
  `coachName` VARCHAR(191) NULL,
  `isConfirmed` BOOLEAN NOT NULL DEFAULT false,
  `starterCount` INTEGER NOT NULL DEFAULT 0,
  `substituteCount` INTEGER NOT NULL DEFAULT 0,
  `contentHash` VARCHAR(191) NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `rawPayload` JSON NULL,
  UNIQUE INDEX `FixtureLineupSnapshot_fixtureId_teamId_contentHash_key`(`fixtureId`, `teamId`, `contentHash`),
  INDEX `FixtureLineupSnapshot_fixtureId_teamId_capturedAt_idx`(`fixtureId`, `teamId`, `capturedAt`),
  INDEX `FixtureLineupSnapshot_teamId_capturedAt_idx`(`teamId`, `capturedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureLineupPlayer` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `lineupSnapshotId` INTEGER NOT NULL,
  `playerId` INTEGER NOT NULL,
  `isStarter` BOOLEAN NOT NULL,
  `shirtNumber` INTEGER NULL,
  `position` VARCHAR(191) NULL,
  `grid` VARCHAR(191) NULL,
  `lineupOrder` INTEGER NULL,
  UNIQUE INDEX `FixtureLineupPlayer_lineupSnapshotId_playerId_key`(`lineupSnapshotId`, `playerId`),
  INDEX `FixtureLineupPlayer_playerId_isStarter_idx`(`playerId`, `isStarter`),
  INDEX `FixtureLineupPlayer_lineupSnapshotId_isStarter_idx`(`lineupSnapshotId`, `isStarter`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FixtureLineupSnapshot`
  ADD CONSTRAINT `FixtureLineupSnapshot_fixtureId_fkey`
  FOREIGN KEY (`fixtureId`) REFERENCES `Fixture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `FixtureLineupSnapshot_teamId_fkey`
  FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `FixtureLineupPlayer`
  ADD CONSTRAINT `FixtureLineupPlayer_lineupSnapshotId_fkey`
  FOREIGN KEY (`lineupSnapshotId`) REFERENCES `FixtureLineupSnapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `FixtureLineupPlayer_playerId_fkey`
  FOREIGN KEY (`playerId`) REFERENCES `Player`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
