-- v7.0-beta.1A: provider adapter and historical replay pipeline.
-- Historical replay evidence is explicitly NON-PROMOTIONAL and must never
-- populate alpha.8 fresh shadow evidence.

CREATE TABLE `ProviderReplayRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerKey` VARCHAR(96) NOT NULL,
  `providerMode` VARCHAR(24) NOT NULL,
  `providerVersion` VARCHAR(160) NOT NULL,
  `policyVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `dateFrom` DATETIME(3) NOT NULL,
  `dateTo` DATETIME(3) NOT NULL,
  `fixturesPlanned` INTEGER NOT NULL,
  `fixturesProcessed` INTEGER NOT NULL,
  `schedulerEvents` INTEGER NOT NULL,
  `t90EligibleFixtures` INTEGER NOT NULL,
  `predictions` INTEGER NOT NULL,
  `settledPredictions` INTEGER NOT NULL,
  `missingFeatureRows` INTEGER NOT NULL,
  `missingBaselineRows` INTEGER NOT NULL,
  `pitViolations` INTEGER NOT NULL DEFAULT 0,
  `freshShadowRowsWritten` INTEGER NOT NULL DEFAULT 0,
  `apiCalled` BOOLEAN NOT NULL DEFAULT false,
  `metrics` JSON NOT NULL,
  `coverage` JSON NOT NULL,
  `configuration` JSON NOT NULL,
  `artifactDirectory` VARCHAR(512) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,

  UNIQUE INDEX `ProviderReplayRun_payloadHash_key` (`payloadHash`),
  INDEX `ProviderReplayRun_status_started_idx` (`status`, `startedAt`),
  INDEX `ProviderReplayRun_provider_started_idx` (`providerKey`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProviderReplayPrediction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `fixtureId` INTEGER NOT NULL,
  `leagueId` INTEGER NOT NULL,
  `predictionAsOf` DATETIME(3) NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `resultAvailableAt` DATETIME(3) NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `marketAvailable` BOOLEAN NOT NULL,
  `teamMetricSnapshotCount` INTEGER NOT NULL,
  `oddsSnapshotCount` INTEGER NOT NULL,
  `latestTeamMetricCapturedAt` DATETIME(3) NULL,
  `latestOddsCapturedAt` DATETIME(3) NULL,
  `sourceFeaturePayloadHash` VARCHAR(64) NOT NULL,
  `sourceBaselinePayloadHash` VARCHAR(64) NOT NULL,
  `baselineHomeProbability` DOUBLE NOT NULL,
  `baselineDrawProbability` DOUBLE NOT NULL,
  `baselineAwayProbability` DOUBLE NOT NULL,
  `candidateHomeProbability` DOUBLE NOT NULL,
  `candidateDrawProbability` DOUBLE NOT NULL,
  `candidateAwayProbability` DOUBLE NOT NULL,
  `actualClass` VARCHAR(12) NOT NULL,
  `baselineBrier` DOUBLE NOT NULL,
  `candidateBrier` DOUBLE NOT NULL,
  `baselineLogLoss` DOUBLE NOT NULL,
  `candidateLogLoss` DOUBLE NOT NULL,
  `pitSafe` BOOLEAN NOT NULL,
  `evidenceClass` VARCHAR(64) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ProviderReplayPrediction_run_fixture_hash_key`
    (`runId`, `fixtureId`, `payloadHash`),
  INDEX `ProviderReplayPrediction_fixture_asof_idx`
    (`fixtureId`, `predictionAsOf`),
  INDEX `ProviderReplayPrediction_evidence_created_idx`
    (`evidenceClass`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProviderHealthObservation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `providerKey` VARCHAR(96) NOT NULL,
  `providerMode` VARCHAR(24) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `capabilities` JSON NOT NULL,
  `details` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ProviderHealth_provider_observed_idx` (`providerKey`, `observedAt`),
  INDEX `ProviderHealth_status_observed_idx` (`status`, `observedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
