-- Football AI v7.0-beta.1B.2a
-- Provider-neutral, append-only historical odds snapshots.
-- This table deliberately does not overload ApiFootballOddsSnapshot with another provider's data.
CREATE TABLE `HistoricalExternalOddsSnapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `sourceProvider` VARCHAR(64) NOT NULL,
  `sourceSportKey` VARCHAR(160) NOT NULL,
  `sourceEventId` VARCHAR(160) NOT NULL,
  `sourceSnapshotAt` DATETIME(3) NOT NULL,
  `sourceUpdatedAt` DATETIME(3) NULL,
  `observedAt` DATETIME(3) NOT NULL,
  `localFixtureId` INTEGER NOT NULL,
  `providerFixtureId` INTEGER NOT NULL,
  `providerLeagueId` INTEGER NOT NULL,
  `season` INTEGER NOT NULL,
  `kickoffAt` DATETIME(3) NOT NULL,
  `bookmakerNamespaceId` INTEGER NOT NULL,
  `bookmakerKey` VARCHAR(120) NOT NULL,
  `bookmakerName` VARCHAR(160) NOT NULL,
  `marketType` VARCHAR(32) NOT NULL,
  `selection` VARCHAR(24) NOT NULL,
  `lineValue` DOUBLE NULL,
  `decimalOdds` DOUBLE NOT NULL,
  `pitUsable` BOOLEAN NOT NULL DEFAULT false,
  `rawPayloadHash` VARCHAR(64) NOT NULL,
  `payloadHash` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `HistoricalExternalOddsSnapshot_payloadHash_key`(`payloadHash`),
  INDEX `HistoricalExternalOdds_local_market_snapshot_idx`(`localFixtureId`, `marketType`, `sourceSnapshotAt`),
  INDEX `HistoricalExternalOdds_provider_market_snapshot_idx`(`providerFixtureId`, `marketType`, `sourceSnapshotAt`),
  INDEX `HistoricalExternalOdds_source_sport_snapshot_idx`(`sourceProvider`, `sourceSportKey`, `sourceSnapshotAt`),
  INDEX `HistoricalExternalOdds_bookmaker_market_snapshot_idx`(`bookmakerNamespaceId`, `marketType`, `sourceSnapshotAt`),
  INDEX `HistoricalExternalOdds_pit_snapshot_idx`(`pitUsable`, `sourceSnapshotAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
