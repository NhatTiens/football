-- CreateTable
CREATE TABLE `AuthUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ANALYST', 'ADMIN') NOT NULL DEFAULT 'USER',
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(64) NULL,
    `lastLoginUserAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuthUser_email_key`(`email`),
    INDEX `AuthUser_role_idx`(`role`),
    INDEX `AuthUser_lockedUntil_idx`(`lockedUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuthSession_tokenHash_key`(`tokenHash`),
    INDEX `AuthSession_userId_expiresAt_idx`(`userId`, `expiresAt`),
    INDEX `AuthSession_expiresAt_revokedAt_idx`(`expiresAt`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AuthUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FixtureContextCollectionCheckpoint` ADD CONSTRAINT `FixtureContextCollectionCheckpoint_fixtureId_fkey` FOREIGN KEY (`fixtureId`) REFERENCES `Fixture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `fixturecontextcollectioncheckpoint` RENAME INDEX `FixtureContextCheckpoint_fixture_completed_idx` TO `FixtureContextCollectionCheckpoint_fixtureId_completedAt_idx`;

-- RenameIndex
ALTER TABLE `fixturecontextcollectioncheckpoint` RENAME INDEX `FixtureContextCheckpoint_fixture_horizon_key` TO `FixtureContextCollectionCheckpoint_fixtureId_horizonMinutes_key`;

-- RenameIndex
ALTER TABLE `fixturecontextcollectioncheckpoint` RENAME INDEX `FixtureContextCheckpoint_status_due_idx` TO `FixtureContextCollectionCheckpoint_status_dueAt_idx`;

-- RenameIndex
ALTER TABLE `fixtureinjury` RENAME INDEX `fi_captured_idx` TO `FixtureInjury_capturedAt_idx`;

-- RenameIndex
ALTER TABLE `fixtureinjury` RENAME INDEX `fi_fixture_team_player_uq` TO `FixtureInjury_fixtureId_teamId_apiPlayerId_key`;

-- RenameIndex
ALTER TABLE `fixtureinjury` RENAME INDEX `fi_team_fixture_idx` TO `FixtureInjury_teamId_fixtureId_idx`;

-- RenameIndex
ALTER TABLE `fixturescientificcoverage` RENAME INDEX `fsc_injuries_idx` TO `FixtureScientificCoverage_injuriesFetchedAt_idx`;

-- RenameIndex
ALTER TABLE `fixturescientificcoverage` RENAME INDEX `fsc_statistics_idx` TO `FixtureScientificCoverage_statisticsFetchedAt_idx`;

-- RenameIndex
ALTER TABLE `fixtureteammetric` RENAME INDEX `ftm_captured_idx` TO `FixtureTeamMetric_capturedAt_idx`;

-- RenameIndex
ALTER TABLE `fixtureteammetric` RENAME INDEX `ftm_fixture_team_uq` TO `FixtureTeamMetric_fixtureId_teamId_key`;

-- RenameIndex
ALTER TABLE `fixtureteammetric` RENAME INDEX `ftm_team_fixture_idx` TO `FixtureTeamMetric_teamId_fixtureId_idx`;

-- RenameIndex
ALTER TABLE `oddssnapshot` RENAME INDEX `OddsSnapshot_fixture_bookmaker_market_selection_captured_idx` TO `OddsSnapshot_fixtureId_bookmakerId_marketId_selectionCode_ca_idx`;

-- RenameIndex
ALTER TABLE `scientificshadowevaluationrun` RENAME INDEX `ScientificShadowEvaluation_payloadHash_key` TO `ScientificShadowEvaluationRun_payloadHash_key`;

-- RenameIndex
ALTER TABLE `teamelo` RENAME INDEX `te_league_rating_idx` TO `TeamElo_leagueId_rating_idx`;
