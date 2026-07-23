-- v7.0-alpha.2: append-only scientific feature snapshots.
-- This migration creates storage only. Backfill is performed by the
-- `snapshot:backfill` command so hashes are identical to runtime dual-write.

CREATE TABLE `ExternalPredictionSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `homeProbability` DOUBLE NULL,
  `drawProbability` DOUBLE NULL,
  `awayProbability` DOUBLE NULL,
  `advice` TEXT NULL,
  `predictedWinner` VARCHAR(191) NULL,
  `rawPayload` JSON NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ExternalPredictionSnapshot_fixtureId_payloadHash_key`
    (`fixtureId`, `payloadHash`),
  INDEX `ExternalPredictionSnapshot_fixtureId_capturedAt_idx`
    (`fixtureId`, `capturedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureTeamMetricSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `teamId` INTEGER NOT NULL,
  `expectedGoals` DOUBLE NULL,
  `expectedGoalsSource` VARCHAR(191) NULL,
  `shots` INTEGER NULL,
  `shotsOnGoal` INTEGER NULL,
  `possession` DOUBLE NULL,
  `corners` INTEGER NULL,
  `fouls` INTEGER NULL,
  `yellowCards` INTEGER NULL,
  `redCards` INTEGER NULL,
  `rawPayload` JSON NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `FixtureTeamMetricSnapshot_fixtureId_teamId_payloadHash_key`
    (`fixtureId`, `teamId`, `payloadHash`),
  INDEX `FixtureTeamMetricSnapshot_fixtureId_teamId_capturedAt_idx`
    (`fixtureId`, `teamId`, `capturedAt`),
  INDEX `FixtureTeamMetricSnapshot_teamId_capturedAt_idx`
    (`teamId`, `capturedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
