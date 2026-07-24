-- v7.0-alpha.6: offline CatBoost, market consensus and residual model.
-- This migration creates scientific ML storage only. It does not call any API.

CREATE TABLE `MlFeatureSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `labelAvailableAt` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `labelMatchWinner` INTEGER NOT NULL,
  `labelOver25` INTEGER NOT NULL,
  `labelBtts` INTEGER NOT NULL,
  `fundamentalsAvailable` BOOLEAN NOT NULL DEFAULT true,
  `marketAvailable` BOOLEAN NOT NULL DEFAULT false,
  `bookmakerCount` INTEGER NOT NULL DEFAULT 0,
  `marketHomeProbability` DOUBLE NULL,
  `marketDrawProbability` DOUBLE NULL,
  `marketAwayProbability` DOUBLE NULL,
  `featureNames` JSON NOT NULL,
  `featureVector` JSON NOT NULL,
  `featureContractHash` VARCHAR(64) NOT NULL,
  `sourcePayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `MlFeature_fixture_horizon_contract_hash_key`
    (`fixtureId`, `horizonMinutes`, `featureContractHash`, `payloadHash`),
  INDEX `MlFeature_kickoff_horizon_idx`
    (`kickoffAt`, `horizonMinutes`),
  INDEX `MlFeature_label_available_idx`
    (`labelAvailableAt`, `predictionAsOf`),
  INDEX `MlFeature_fixture_asof_idx`
    (`fixtureId`, `predictionAsOf`),
  INDEX `MlFeature_contract_kickoff_idx`
    (`featureContractHash`, `kickoffAt`),
  INDEX `MlFeature_market_kickoff_idx`
    (`marketAvailable`, `kickoffAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MlModelArtifact` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `modelKey` VARCHAR(96) NOT NULL,
  `version` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `trainedFrom` DATETIME(3) NOT NULL,
  `trainedThrough` DATETIME(3) NOT NULL,
  `validationFrom` DATETIME(3) NOT NULL,
  `validationThrough` DATETIME(3) NOT NULL,
  `featureContractHash` VARCHAR(64) NOT NULL,
  `featureNames` JSON NOT NULL,
  `trainingRows` INTEGER NOT NULL,
  `validationRows` INTEGER NOT NULL,
  `modelDirectory` VARCHAR(512) NOT NULL,
  `modelSha256` JSON NOT NULL,
  `metrics` JSON NOT NULL,
  `featureImportance` JSON NOT NULL,
  `parameters` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MlModelArtifact_model_key_version_key`
    (`modelKey`, `version`),
  INDEX `MlModelArtifact_key_status_created_idx`
    (`modelKey`, `status`, `createdAt`),
  INDEX `MlModelArtifact_temporal_idx`
    (`trainedThrough`, `validationFrom`),
  INDEX `MlModelArtifact_contract_created_idx`
    (`featureContractHash`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MlPredictionSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `modelArtifactId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `modelVersion` VARCHAR(160) NOT NULL,
  `trainedThrough` DATETIME(3) NOT NULL,
  `role` VARCHAR(24) NOT NULL,
  `marketAvailable` BOOLEAN NOT NULL DEFAULT false,
  `catBoostHomeProbability` DOUBLE NOT NULL,
  `catBoostDrawProbability` DOUBLE NOT NULL,
  `catBoostAwayProbability` DOUBLE NOT NULL,
  `residualHomeProbability` DOUBLE NULL,
  `residualDrawProbability` DOUBLE NULL,
  `residualAwayProbability` DOUBLE NULL,
  `finalHomeProbability` DOUBLE NOT NULL,
  `finalDrawProbability` DOUBLE NOT NULL,
  `finalAwayProbability` DOUBLE NOT NULL,
  `over25Probability` DOUBLE NOT NULL,
  `bttsProbability` DOUBLE NOT NULL,
  `featureContractHash` VARCHAR(64) NOT NULL,
  `sourceFeaturePayloadHash` VARCHAR(64) NOT NULL,
  `modelPayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `MlPrediction_fixture_horizon_model_hash_key`
    (`fixtureId`, `horizonMinutes`, `modelVersion`, `payloadHash`),
  INDEX `MlPrediction_fixture_horizon_asof_idx`
    (`fixtureId`, `horizonMinutes`, `predictionAsOf`),
  INDEX `MlPrediction_artifact_role_idx`
    (`modelArtifactId`, `role`),
  INDEX `MlPrediction_leakage_guard_idx`
    (`trainedThrough`, `predictionAsOf`),
  INDEX `MlPrediction_contract_created_idx`
    (`featureContractHash`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
