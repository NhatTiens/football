-- v7.0-beta.1B: API-Football real provider + append-only paper bet ledger.
-- No production routing change and no automatic promotion.

CREATE TABLE `ApiFootballProviderRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerVersion` VARCHAR(160) NOT NULL,
  `command` VARCHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `requestCount` INTEGER NOT NULL DEFAULT 0,
  `insertedFixtures` INTEGER NOT NULL DEFAULT 0,
  `insertedOdds` INTEGER NOT NULL DEFAULT 0,
  `insertedDataSnapshots` INTEGER NOT NULL DEFAULT 0,
  `quotaBefore` JSON NULL,
  `quotaAfter` JSON NULL,
  `metadata` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,

  UNIQUE INDEX `ApiFootballProviderRun_payloadHash_key` (`payloadHash`),
  INDEX `ApiFootballProviderRun_command_started_idx` (`command`, `startedAt`),
  INDEX `ApiFootballProviderRun_status_started_idx` (`status`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiFootballFixtureSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerFixtureId` INTEGER NOT NULL,
  `providerLeagueId` INTEGER NOT NULL,
  `season` INTEGER NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `statusShort` VARCHAR(24) NOT NULL,
  `homeProviderTeamId` INTEGER NOT NULL,
  `awayProviderTeamId` INTEGER NOT NULL,
  `homeTeamName` VARCHAR(160) NOT NULL,
  `awayTeamName` VARCHAR(160) NOT NULL,
  `homeGoals` INTEGER NULL,
  `awayGoals` INTEGER NULL,
  `fulltimeHomeGoals` INTEGER NULL,
  `fulltimeAwayGoals` INTEGER NULL,
  `observedAt` DATETIME(3) NOT NULL,
  `rawPayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ApiFootballFixtureSnapshot_payloadHash_key` (`payloadHash`),
  INDEX `ApiFootballFixtureSnapshot_fixture_observed_idx` (`providerFixtureId`, `observedAt`),
  INDEX `ApiFootballFixtureSnapshot_league_kickoff_idx` (`providerLeagueId`, `kickoffAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiFootballOddsSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerFixtureId` INTEGER NOT NULL,
  `providerLeagueId` INTEGER NOT NULL,
  `season` INTEGER NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `sourceUpdatedAt` DATETIME(3) NULL,
  `observedAt` DATETIME(3) NOT NULL,
  `bookmakerId` INTEGER NOT NULL,
  `bookmakerName` VARCHAR(160) NOT NULL,
  `betId` INTEGER NOT NULL,
  `betName` VARCHAR(160) NOT NULL,
  `marketType` VARCHAR(32) NOT NULL,
  `selection` VARCHAR(24) NOT NULL,
  `lineValue` DOUBLE NULL,
  `decimalOdds` DOUBLE NOT NULL,
  `pitUsable` BOOLEAN NOT NULL DEFAULT false,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ApiFootballOddsSnapshot_payloadHash_key` (`payloadHash`),
  INDEX `ApiFootballOddsSnapshot_fixture_market_observed_idx` (`providerFixtureId`, `marketType`, `observedAt`),
  INDEX `ApiFootballOddsSnapshot_fixture_bookmaker_bet_source_idx` (`providerFixtureId`, `bookmakerId`, `betId`, `sourceUpdatedAt`),
  INDEX `ApiFootballOddsSnapshot_market_selection_line_idx` (`marketType`, `selection`, `lineValue`),
  INDEX `ApiFootballOddsSnapshot_pit_observed_idx` (`pitUsable`, `observedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiFootballDataSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(48) NOT NULL,
  `providerFixtureId` INTEGER NULL,
  `providerLeagueId` INTEGER NULL,
  `providerTeamId` INTEGER NULL,
  `sourceAsOf` DATETIME(3) NULL,
  `observedAt` DATETIME(3) NOT NULL,
  `queryPayload` JSON NOT NULL,
  `rawPayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ApiFootballDataSnapshot_payloadHash_key` (`payloadHash`),
  INDEX `ApiFootballDataSnapshot_kind_observed_idx` (`kind`, `observedAt`),
  INDEX `ApiFootballDataSnapshot_fixture_kind_observed_idx` (`providerFixtureId`, `kind`, `observedAt`),
  INDEX `ApiFootballDataSnapshot_team_kind_observed_idx` (`providerTeamId`, `kind`, `observedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificPaperBetDecision` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerFixtureId` INTEGER NOT NULL,
  `localFixtureId` INTEGER NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `decisionAsOf` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `decisionType` VARCHAR(16) NOT NULL,
  `selectedMarket` VARCHAR(32) NULL,
  `selectedSelection` VARCHAR(24) NULL,
  `lineValue` DOUBLE NULL,
  `decimalOdds` DOUBLE NULL,
  `bookmakerId` INTEGER NULL,
  `bookmakerName` VARCHAR(160) NULL,
  `modelProbability` DOUBLE NULL,
  `fairMarketProbability` DOUBLE NULL,
  `impliedProbability` DOUBLE NULL,
  `edge` DOUBLE NULL,
  `expectedValue` DOUBLE NULL,
  `modelVersion` VARCHAR(192) NOT NULL,
  `policyVersion` VARCHAR(192) NOT NULL,
  `reliabilityStatus` VARCHAR(64) NULL,
  `sourceOddsSnapshotId` INTEGER NULL,
  `sourceOddsUpdatedAt` DATETIME(3) NULL,
  `sourceOddsObservedAt` DATETIME(3) NULL,
  `candidateCount` INTEGER NOT NULL,
  `rejectedCandidateCount` INTEGER NOT NULL,
  `decisionPayload` JSON NOT NULL,
  `decisionHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificPaperBetDecision_decisionHash_key` (`decisionHash`),
  INDEX `ScientificPaperBetDecision_fixture_horizon_asof_idx` (`providerFixtureId`, `horizonMinutes`, `decisionAsOf`),
  INDEX `ScientificPaperBetDecision_type_asof_idx` (`decisionType`, `decisionAsOf`),
  INDEX `ScientificPaperBetDecision_market_selection_idx` (`selectedMarket`, `selectedSelection`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificPaperBetCandidate` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `decisionId` INTEGER NOT NULL,
  `providerFixtureId` INTEGER NOT NULL,
  `marketType` VARCHAR(32) NOT NULL,
  `selection` VARCHAR(24) NOT NULL,
  `lineValue` DOUBLE NULL,
  `decimalOdds` DOUBLE NOT NULL,
  `bookmakerId` INTEGER NOT NULL,
  `bookmakerName` VARCHAR(160) NOT NULL,
  `modelProbability` DOUBLE NOT NULL,
  `fairMarketProbability` DOUBLE NOT NULL,
  `impliedProbability` DOUBLE NOT NULL,
  `edge` DOUBLE NOT NULL,
  `expectedValue` DOUBLE NOT NULL,
  `reliabilityStatus` VARCHAR(64) NOT NULL,
  `eligible` BOOLEAN NOT NULL,
  `rejectionReasons` JSON NOT NULL,
  `sourceOddsSnapshotId` INTEGER NULL,
  `candidatePayload` JSON NOT NULL,
  `candidateHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificPaperBetCandidate_candidateHash_key` (`candidateHash`),
  INDEX `ScientificPaperBetCandidate_decision_eligible_idx` (`decisionId`, `eligible`),
  INDEX `ScientificPaperBetCandidate_fixture_market_selection_idx` (`providerFixtureId`, `marketType`, `selection`),
  CONSTRAINT `ScientificPaperBetCandidate_decisionId_fkey`
    FOREIGN KEY (`decisionId`) REFERENCES `ScientificPaperBetDecision`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificPaperBetSettlement` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `decisionId` INTEGER NOT NULL,
  `providerFixtureId` INTEGER NOT NULL,
  `settledAt` DATETIME(3) NOT NULL,
  `sourceFixtureObservedAt` DATETIME(3) NOT NULL,
  `statusShort` VARCHAR(24) NOT NULL,
  `fulltimeHomeGoals` INTEGER NOT NULL,
  `fulltimeAwayGoals` INTEGER NOT NULL,
  `result` VARCHAR(16) NOT NULL,
  `stakeUnits` DOUBLE NOT NULL,
  `profitUnits` DOUBLE NOT NULL,
  `closingDecimalOdds` DOUBLE NULL,
  `closingFairProbability` DOUBLE NULL,
  `clv` DOUBLE NULL,
  `settlementPayload` JSON NOT NULL,
  `settlementHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificPaperBetSettlement_decisionId_key` (`decisionId`),
  UNIQUE INDEX `ScientificPaperBetSettlement_settlementHash_key` (`settlementHash`),
  INDEX `ScientificPaperBetSettlement_fixture_settled_idx` (`providerFixtureId`, `settledAt`),
  INDEX `ScientificPaperBetSettlement_result_settled_idx` (`result`, `settledAt`),
  CONSTRAINT `ScientificPaperBetSettlement_decisionId_fkey`
    FOREIGN KEY (`decisionId`) REFERENCES `ScientificPaperBetDecision`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
