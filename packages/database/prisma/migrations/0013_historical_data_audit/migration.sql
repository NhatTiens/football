-- v7.0-beta.1A.1: historical coverage and timestamp lineage audit.
-- Audit only: no historical timestamp mutation, no backfill, no live API call,
-- no fresh-shadow write and no production model change.

CREATE TABLE `HistoricalDataAuditRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `auditVersion` VARCHAR(160) NOT NULL,
  `policyVersion` VARCHAR(160) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `dateFrom` DATETIME(3) NOT NULL,
  `dateTo` DATETIME(3) NOT NULL,
  `replayFixtures` INTEGER NOT NULL,
  `replayPredictions` INTEGER NOT NULL,
  `oddsSnapshots` INTEGER NOT NULL,
  `fixturesWithAnyOdds` INTEGER NOT NULL,
  `fixturesWithT90Odds` INTEGER NOT NULL,
  `rawMetricSnapshots` INTEGER NOT NULL,
  `fundamentalSnapshots` INTEGER NOT NULL,
  `featureSnapshots` INTEGER NOT NULL,
  `featureRowsWithLineage` INTEGER NOT NULL,
  `featureRowsWithMarketLineage` INTEGER NOT NULL,
  `pitViolations` INTEGER NOT NULL DEFAULT 0,
  `recommendationStatus` VARCHAR(64) NOT NULL,
  `summary` JSON NOT NULL,
  `recommendation` JSON NOT NULL,
  `artifactDirectory` VARCHAR(512) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,

  UNIQUE INDEX `HistoricalDataAuditRun_payloadHash_key` (`payloadHash`),
  INDEX `HistoricalDataAuditRun_status_started_idx` (`status`, `startedAt`),
  INDEX `HistoricalDataAuditRun_recommendation_started_idx`
    (`recommendationStatus`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HistoricalDataAuditFinding` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `category` VARCHAR(48) NOT NULL,
  `severity` VARCHAR(16) NOT NULL,
  `code` VARCHAR(96) NOT NULL,
  `message` TEXT NOT NULL,
  `evidence` JSON NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `HistoricalDataAuditFinding_run_code_hash_key`
    (`runId`, `code`, `payloadHash`),
  INDEX `HistoricalDataAuditFinding_run_severity_idx`
    (`runId`, `severity`),
  INDEX `HistoricalDataAuditFinding_category_severity_idx`
    (`category`, `severity`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
