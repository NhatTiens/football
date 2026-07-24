-- v7.0-alpha.8: frozen candidate registry and fresh shadow evaluation.
-- No automatic promotion, scheduler enablement, threshold change or API call.

CREATE TABLE `ScientificCandidateRegistry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registryKey` VARCHAR(160) NOT NULL,
  `experimentId` VARCHAR(64) NOT NULL,
  `sourceDiagnosticRunId` INTEGER NOT NULL,
  `sourceDevelopmentCandidateId` INTEGER NOT NULL,
  `candidateVersion` VARCHAR(180) NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `featureContractHash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(40) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `marketBranch` VARCHAR(32) NOT NULL,
  `method` VARCHAR(64) NOT NULL,
  `formulaVersion` VARCHAR(96) NOT NULL,
  `sources` JSON NOT NULL,
  `weights` JSON NOT NULL,
  `temperature` DOUBLE NOT NULL,
  `maximumProbabilityShift` DOUBLE NOT NULL,
  `minimumFreshFixtures` INTEGER NOT NULL DEFAULT 150,
  `minimumFreshBets` INTEGER NOT NULL DEFAULT 30,
  `frozenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sourcePayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificCandidateRegistry_registryKey_key` (`registryKey`),
  UNIQUE INDEX `ScientificCandidateRegistry_candidateVersion_key` (`candidateVersion`),
  UNIQUE INDEX `ScientificCandidateRegistry_payloadHash_key` (`payloadHash`),
  INDEX `ScientificCandidateRegistry_status_frozen_idx` (`status`, `frozenAt`),
  INDEX `ScientificCandidateRegistry_route_idx` (`horizonMinutes`, `marketBranch`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificShadowPrediction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registryId` INTEGER NOT NULL,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `labelAvailableAt` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `marketAvailable` BOOLEAN NOT NULL DEFAULT false,
  `sourceFeatureCreatedAt` DATETIME(3) NOT NULL,
  `sourceBaselineCreatedAt` DATETIME(3) NOT NULL,
  `baselineHomeProbability` DOUBLE NOT NULL,
  `baselineDrawProbability` DOUBLE NOT NULL,
  `baselineAwayProbability` DOUBLE NOT NULL,
  `dixonHomeProbability` DOUBLE NOT NULL,
  `dixonDrawProbability` DOUBLE NOT NULL,
  `dixonAwayProbability` DOUBLE NOT NULL,
  `candidateHomeProbability` DOUBLE NOT NULL,
  `candidateDrawProbability` DOUBLE NOT NULL,
  `candidateAwayProbability` DOUBLE NOT NULL,
  `sourceFeaturePayloadHash` VARCHAR(64) NOT NULL,
  `sourceBaselinePayloadHash` VARCHAR(64) NOT NULL,
  `freshnessStatus` VARCHAR(40) NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sourcePayload` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,

  UNIQUE INDEX `ScientificShadowPrediction_registry_feature_key`
    (`registryId`, `sourceFeaturePayloadHash`),
  UNIQUE INDEX `ScientificShadowPrediction_registry_payload_key`
    (`registryId`, `payloadHash`),
  INDEX `ScientificShadowPrediction_registry_kickoff_idx`
    (`registryId`, `kickoffAt`),
  INDEX `ScientificShadowPrediction_fixture_asof_idx`
    (`fixtureId`, `predictionAsOf`),
  INDEX `ScientificShadowPrediction_freshness_captured_idx`
    (`freshnessStatus`, `capturedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificShadowEvaluationRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registryId` INTEGER NOT NULL,
  `candidateVersion` VARCHAR(180) NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `decisionStatus` VARCHAR(48) NOT NULL,
  `policyVersion` VARCHAR(96) NOT NULL,
  `dateFrom` DATETIME(3) NULL,
  `dateTo` DATETIME(3) NULL,
  `freshFixtures` INTEGER NOT NULL,
  `predictionRows` INTEGER NOT NULL,
  `candidateBets` INTEGER NOT NULL,
  `leakageViolations` INTEGER NOT NULL DEFAULT 0,
  `freshnessViolations` INTEGER NOT NULL DEFAULT 0,
  `predictionMetrics` JSON NOT NULL,
  `bettingMetrics` JSON NOT NULL,
  `decision` JSON NOT NULL,
  `configuration` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,

  UNIQUE INDEX `ScientificShadowEvaluation_payloadHash_key` (`payloadHash`),
  INDEX `ScientificShadowEvaluation_registry_started_idx` (`registryId`, `startedAt`),
  INDEX `ScientificShadowEvaluation_decision_started_idx` (`decisionStatus`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificShadowBet` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `registryId` INTEGER NOT NULL,
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

  UNIQUE INDEX `ScientificShadowBet_run_source_fixture_hash_key`
    (`runId`, `source`, `fixtureId`, `payloadHash`),
  INDEX `ScientificShadowBet_registry_kickoff_idx` (`registryId`, `kickoffAt`),
  INDEX `ScientificShadowBet_run_source_idx` (`runId`, `source`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificShadowDecision` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `registryId` INTEGER NOT NULL,
  `candidateVersion` VARCHAR(180) NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(48) NOT NULL,
  `passed` BOOLEAN NOT NULL,
  `gates` JSON NOT NULL,
  `reasons` JSON NOT NULL,
  `deltas` JSON NOT NULL,
  `freshFixtures` INTEGER NOT NULL,
  `candidateBets` INTEGER NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificShadowDecision_runId_key` (`runId`),
  UNIQUE INDEX `ScientificShadowDecision_payloadHash_key` (`payloadHash`),
  INDEX `ScientificShadowDecision_registry_created_idx` (`registryId`, `createdAt`),
  INDEX `ScientificShadowDecision_status_created_idx` (`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
