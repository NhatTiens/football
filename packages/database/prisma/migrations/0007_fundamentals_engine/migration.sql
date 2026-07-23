-- v7.0-alpha.5: point-in-time fundamentals and Dynamic Dixon-Coles.
-- Storage only. No API request is made by this migration.

CREATE TABLE `TeamFundamentalSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `teamId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `venueRole` VARCHAR(8) NOT NULL,
  `sampleSize` INTEGER NOT NULL,
  `venueSampleSize` INTEGER NOT NULL,
  `matches5` INTEGER NOT NULL,
  `matches10` INTEGER NOT NULL,
  `matches20` INTEGER NOT NULL,
  `pointsPerGame5` DOUBLE NOT NULL,
  `pointsPerGame10` DOUBLE NOT NULL,
  `pointsPerGame20` DOUBLE NOT NULL,
  `goalsFor5` DOUBLE NOT NULL,
  `goalsFor10` DOUBLE NOT NULL,
  `goalsFor20` DOUBLE NOT NULL,
  `goalsAgainst5` DOUBLE NOT NULL,
  `goalsAgainst10` DOUBLE NOT NULL,
  `goalsAgainst20` DOUBLE NOT NULL,
  `expectedGoalsFor10` DOUBLE NOT NULL,
  `expectedGoalsAgainst10` DOUBLE NOT NULL,
  `shots10` DOUBLE NOT NULL,
  `shotsOnGoal10` DOUBLE NOT NULL,
  `possession10` DOUBLE NOT NULL,
  `corners10` DOUBLE NOT NULL,
  `winRate10` DOUBLE NOT NULL,
  `drawRate10` DOUBLE NOT NULL,
  `lossRate10` DOUBLE NOT NULL,
  `cleanSheetRate10` DOUBLE NOT NULL,
  `bttsRate10` DOUBLE NOT NULL,
  `over25Rate10` DOUBLE NOT NULL,
  `metricCoverage10` DOUBLE NOT NULL,
  `venuePointsPerGame10` DOUBLE NOT NULL,
  `venueGoalsFor10` DOUBLE NOT NULL,
  `venueGoalsAgainst10` DOUBLE NOT NULL,
  `restDays` DOUBLE NOT NULL,
  `dataQualityScore` DOUBLE NOT NULL,
  `latestSourceFixtureId` INTEGER NULL,
  `latestSourceKickoffAt` DATETIME(3) NULL,
  `latestSourceAvailableAt` DATETIME(3) NULL,
  `rawPayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `TeamFundamental_fixture_team_horizon_hash_key`
    (`fixtureId`, `teamId`, `horizonMinutes`, `payloadHash`),
  INDEX `TeamFundamental_fixture_horizon_asof_idx`
    (`fixtureId`, `horizonMinutes`, `predictionAsOf`),
  INDEX `TeamFundamental_team_asof_idx`
    (`teamId`, `predictionAsOf`),
  INDEX `TeamFundamental_league_asof_idx`
    (`leagueId`, `predictionAsOf`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DixonColesPredictionSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `trainedFrom` DATETIME(3) NOT NULL,
  `trainedThrough` DATETIME(3) NOT NULL,
  `sampleSize` INTEGER NOT NULL,
  `teamCount` INTEGER NOT NULL,
  `halfLifeDays` DOUBLE NOT NULL,
  `rho` DOUBLE NOT NULL,
  `intercept` DOUBLE NOT NULL,
  `homeAdvantage` DOUBLE NOT NULL,
  `homeExpectedGoals` DOUBLE NOT NULL,
  `awayExpectedGoals` DOUBLE NOT NULL,
  `homeProbability` DOUBLE NOT NULL,
  `drawProbability` DOUBLE NOT NULL,
  `awayProbability` DOUBLE NOT NULL,
  `over25Probability` DOUBLE NOT NULL,
  `bttsProbability` DOUBLE NOT NULL,
  `dataQualityScore` DOUBLE NOT NULL,
  `modelPayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DixonColes_fixture_horizon_hash_key`
    (`fixtureId`, `horizonMinutes`, `payloadHash`),
  INDEX `DixonColes_fixture_horizon_asof_idx`
    (`fixtureId`, `horizonMinutes`, `predictionAsOf`),
  INDEX `DixonColes_league_trained_through_idx`
    (`leagueId`, `trainedThrough`),
  INDEX `DixonColes_asof_trained_through_idx`
    (`predictionAsOf`, `trainedThrough`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
