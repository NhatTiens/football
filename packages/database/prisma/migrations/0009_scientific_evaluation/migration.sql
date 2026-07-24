-- v7.0-alpha.7: OOF stacking, calibration, walk-forward evaluation
-- and manual-only champion/challenger promotion decisions.
-- This migration does not call any API and does not promote a model.

CREATE TABLE `ScientificBaselineSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `homeProbability` DOUBLE NOT NULL,
  `drawProbability` DOUBLE NOT NULL,
  `awayProbability` DOUBLE NOT NULL,
  `over25Probability` DOUBLE NOT NULL,
  `bttsProbability` DOUBLE NOT NULL,
  `dataQualityScore` DOUBLE NULL,
  `sourcePayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificBaseline_fixture_horizon_version_hash_key`
    (`fixtureId`, `horizonMinutes`, `baselineVersion`, `payloadHash`),
  INDEX `ScientificBaseline_version_kickoff_idx`
    (`baselineVersion`, `kickoffAt`),
  INDEX `ScientificBaseline_fixture_asof_idx`
    (`fixtureId`, `predictionAsOf`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificEvaluationRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `evaluationVersion` VARCHAR(160) NOT NULL,
  `candidateVersion` VARCHAR(160) NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `promotionStatus` VARCHAR(48) NOT NULL,
  `featureContractHash` VARCHAR(64) NOT NULL,
  `policyVersion` VARCHAR(96) NOT NULL,
  `dateFrom` DATETIME(3) NOT NULL,
  `dateTo` DATETIME(3) NOT NULL,
  `foldCount` INTEGER NOT NULL,
  `oofRows` INTEGER NOT NULL,
  `evaluationRows` INTEGER NOT NULL,
  `leakageViolations` INTEGER NOT NULL DEFAULT 0,
  `artifactDirectory` VARCHAR(512) NOT NULL,
  `artifactSha256` JSON NOT NULL,
  `configuration` JSON NOT NULL,
  `predictionMetrics` JSON NOT NULL,
  `bettingMetrics` JSON NOT NULL,
  `promotionDecision` JSON NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,

  INDEX `ScientificEvaluationRun_status_started_idx`
    (`status`, `startedAt`),
  INDEX `ScientificEvaluationRun_promotion_started_idx`
    (`promotionStatus`, `startedAt`),
  INDEX `ScientificEvaluationRun_versions_idx`
    (`candidateVersion`, `baselineVersion`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificOofPrediction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `foldNumber` INTEGER NOT NULL,
  `splitRole` VARCHAR(24) NOT NULL,
  `trainedThrough` DATETIME(3) NOT NULL,
  `labelMatchWinner` INTEGER NOT NULL,
  `marketAvailable` BOOLEAN NOT NULL DEFAULT false,
  `baselineHomeProbability` DOUBLE NOT NULL,
  `baselineDrawProbability` DOUBLE NOT NULL,
  `baselineAwayProbability` DOUBLE NOT NULL,
  `dixonHomeProbability` DOUBLE NOT NULL,
  `dixonDrawProbability` DOUBLE NOT NULL,
  `dixonAwayProbability` DOUBLE NOT NULL,
  `marketHomeProbability` DOUBLE NULL,
  `marketDrawProbability` DOUBLE NULL,
  `marketAwayProbability` DOUBLE NULL,
  `catBoostHomeProbability` DOUBLE NOT NULL,
  `catBoostDrawProbability` DOUBLE NOT NULL,
  `catBoostAwayProbability` DOUBLE NOT NULL,
  `residualHomeProbability` DOUBLE NULL,
  `residualDrawProbability` DOUBLE NULL,
  `residualAwayProbability` DOUBLE NULL,
  `stackedHomeProbability` DOUBLE NOT NULL,
  `stackedDrawProbability` DOUBLE NOT NULL,
  `stackedAwayProbability` DOUBLE NOT NULL,
  `calibratedHomeProbability` DOUBLE NOT NULL,
  `calibratedDrawProbability` DOUBLE NOT NULL,
  `calibratedAwayProbability` DOUBLE NOT NULL,
  `decisionOdds` JSON NULL,
  `closingOdds` JSON NULL,
  `sourceFeaturePayloadHash` VARCHAR(64) NOT NULL,
  `evaluationPayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificOof_run_fixture_horizon_hash_key`
    (`runId`, `fixtureId`, `horizonMinutes`, `payloadHash`),
  INDEX `ScientificOof_run_role_kickoff_idx`
    (`runId`, `splitRole`, `kickoffAt`),
  INDEX `ScientificOof_fixture_horizon_asof_idx`
    (`fixtureId`, `horizonMinutes`, `predictionAsOf`),
  INDEX `ScientificOof_leakage_guard_idx`
    (`trainedThrough`, `predictionAsOf`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificEvaluationBet` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `fixtureId` INTEGER NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `source` VARCHAR(24) NOT NULL,
  `predictedAt` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `selectionCode` VARCHAR(16) NOT NULL,
  `decimalOdds` DOUBLE NOT NULL,
  `closingOdds` DOUBLE NULL,
  `modelProbability` DOUBLE NOT NULL,
  `fairProbability` DOUBLE NULL,
  `edge` DOUBLE NOT NULL,
  `expectedValue` DOUBLE NOT NULL,
  `stakeUnits` DOUBLE NOT NULL,
  `result` VARCHAR(16) NOT NULL,
  `profitUnits` DOUBLE NOT NULL,
  `clv` DOUBLE NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificBet_run_fixture_horizon_source_hash_key`
    (`runId`, `fixtureId`, `horizonMinutes`, `source`, `payloadHash`),
  INDEX `ScientificBet_run_source_kickoff_idx`
    (`runId`, `source`, `kickoffAt`),
  INDEX `ScientificBet_fixture_predicted_idx`
    (`fixtureId`, `predictedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificPromotionDecision` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `candidateVersion` VARCHAR(160) NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(48) NOT NULL,
  `passed` BOOLEAN NOT NULL DEFAULT false,
  `gates` JSON NOT NULL,
  `reasons` JSON NOT NULL,
  `deltas` JSON NOT NULL,
  `candidateMetrics` JSON NOT NULL,
  `baselineMetrics` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificPromotion_run_hash_key`
    (`runId`, `payloadHash`),
  INDEX `ScientificPromotion_status_created_idx`
    (`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
