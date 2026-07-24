-- v7.0-alpha.7.1: diagnostic reports and development-only safe challengers.
-- This migration does not promote a model, change production thresholds,
-- enable the scheduler or call an external API.

CREATE TABLE `ScientificDiagnosticRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `sourceEvaluationRunId` INTEGER NOT NULL,
  `diagnosticVersion` VARCHAR(160) NOT NULL,
  `developmentPolicyVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `sourceCandidateVersion` VARCHAR(160) NOT NULL,
  `baselineVersion` VARCHAR(160) NOT NULL,
  `featureContractHash` VARCHAR(64) NOT NULL,
  `artifactDirectory` VARCHAR(512) NOT NULL,
  `artifactSha256` JSON NOT NULL,
  `rows` INTEGER NOT NULL,
  `fixtures` INTEGER NOT NULL,
  `developmentRows` INTEGER NOT NULL,
  `evaluationRows` INTEGER NOT NULL,
  `leakageViolations` INTEGER NOT NULL DEFAULT 0,
  `developmentCandidateCount` INTEGER NOT NULL DEFAULT 0,
  `diagnosticSummary` JSON NOT NULL,
  `configuration` JSON NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,

  INDEX `ScientificDiagnostic_status_started_idx`
    (`status`, `startedAt`),
  INDEX `ScientificDiagnostic_source_run_idx`
    (`sourceEvaluationRunId`, `startedAt`),
  INDEX `ScientificDiagnostic_version_started_idx`
    (`diagnosticVersion`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScientificDevelopmentCandidate` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `diagnosticRunId` INTEGER NOT NULL,
  `horizonMinutes` INTEGER NOT NULL,
  `marketBranch` VARCHAR(32) NOT NULL,
  `status` VARCHAR(48) NOT NULL,
  `method` VARCHAR(64) NOT NULL,
  `experimentId` VARCHAR(64) NULL,
  `sources` JSON NOT NULL,
  `weights` JSON NOT NULL,
  `temperature` DOUBLE NULL,
  `maximumProbabilityShift` DOUBLE NULL,
  `fitFixtures` INTEGER NOT NULL DEFAULT 0,
  `calibrationFixtures` INTEGER NOT NULL DEFAULT 0,
  `validationFixtures` INTEGER NOT NULL DEFAULT 0,
  `fitMetrics` JSON NOT NULL,
  `calibrationMetrics` JSON NOT NULL,
  `validationMetrics` JSON NOT NULL,
  `baselineValidationMetrics` JSON NOT NULL,
  `gates` JSON NOT NULL,
  `deltas` JSON NOT NULL,
  `evaluationHoldoutUsed` BOOLEAN NOT NULL DEFAULT false,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ScientificDevelopmentCandidate_run_horizon_branch_hash_key`
    (`diagnosticRunId`, `horizonMinutes`, `marketBranch`, `payloadHash`),
  INDEX `ScientificDevelopmentCandidate_status_created_idx`
    (`status`, `createdAt`),
  INDEX `ScientificDevelopmentCandidate_run_horizon_idx`
    (`diagnosticRunId`, `horizonMinutes`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
