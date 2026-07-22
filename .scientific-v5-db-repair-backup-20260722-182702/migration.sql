-- Scientific ensemble feature storage.

CREATE TABLE `FixtureTeamMetric` (
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
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `rawPayload` JSON NULL,
  UNIQUE INDEX `ftm_fixture_team_uq`(`fixtureId`, `teamId`),
  INDEX `ftm_team_fixture_idx`(`teamId`, `fixtureId`),
  INDEX `ftm_captured_idx`(`capturedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureInjury` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `teamId` INTEGER NOT NULL,
  `apiPlayerId` INTEGER NOT NULL,
  `playerName` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `injuryType` VARCHAR(191) NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `rawPayload` JSON NULL,
  UNIQUE INDEX `fi_fixture_team_player_uq`(`fixtureId`, `teamId`, `apiPlayerId`),
  INDEX `fi_team_fixture_idx`(`teamId`, `fixtureId`),
  INDEX `fi_captured_idx`(`capturedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TeamElo` (
  `teamId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `rating` DOUBLE NOT NULL DEFAULT 1500,
  `matches` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `te_league_rating_idx`(`leagueId`, `rating`),
  PRIMARY KEY (`teamId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FixtureScientificCoverage` (
  `fixtureId` INTEGER NOT NULL,
  `statisticsFetchedAt` DATETIME(3) NULL,
  `injuriesFetchedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `fsc_statistics_idx`(`statisticsFetchedAt`),
  INDEX `fsc_injuries_idx`(`injuriesFetchedAt`),
  PRIMARY KEY (`fixtureId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
