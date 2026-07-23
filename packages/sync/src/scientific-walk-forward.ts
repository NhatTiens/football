import {
  FixtureStatus,
  prisma,
  type InputJsonValue,
} from '@football-ai/database';
import { runScientificBacktest } from './scientific-backtest.js';
import {
  SCIENTIFIC_MODEL_KEY,
  type ScientificModelArtifact,
} from './scientific-model.js';
import { saveScientificModelArtifact } from './scientific-model-registry.js';
import {
  parseScientificBankrollSnapshot,
  type ScientificBankrollSnapshot,
} from './scientific-bankroll.js';
import { trainScientificModel } from './scientific-sync.js';

export const SCIENTIFIC_WALK_FORWARD_REPORT_KEY =
  'SCIENTIFIC_WALK_FORWARD_LATEST_V62';
export const SCIENTIFIC_WALK_FORWARD_LOCK_KEY =
  'SCIENTIFIC_WALK_FORWARD_LOCK_V62';

export interface ScientificWalkForwardOptions {
  minimumTrainingFixtures?: number;
  testFixturesPerFold?: number;
  maximumFolds?: number;
  horizonMinutes?: number;
  leagueId?: number;
  stakeUnits?: number;
  initialBankrollUnits?: number;
}

export interface ScientificWalkForwardFoldResult {
  foldIndex: number;
  trainingFixtures: number;
  testingFixturesRequested: number;
  trainThrough: string;
  testFrom: string;
  testTo: string;
  artifactId: string;
  runId: number;
  totalFixtures: number;
  eligibleFixtures: number;
  totalBets: number;
  wins: number;
  losses: number;
  profitUnits: number;
  roi: number | null;
  maximumDrawdown: number;
  brierScore: number | null;
  totalStakeUnits: number;
  endingBankrollUnits: number | null;
  bankrollReturn: number | null;
  maximumDrawdownFraction: number | null;
  rules: unknown;
}

export interface ScientificWalkForwardReport {
  version: 'scientific-walk-forward-v6.2-bankroll';
  createdAt: string;
  horizonMinutes: number;
  minimumTrainingFixtures: number;
  testFixturesPerFold: number;
  maximumFolds: number;
  leagueId: number | null;
  folds: ScientificWalkForwardFoldResult[];
  summary: {
    foldCount: number;
    totalFixtures: number;
    eligibleFixtures: number;
    totalBets: number;
    wins: number;
    losses: number;
    profitUnits: number;
    roi: number | null;
    weightedBrierScore: number | null;
    profitableFolds: number;
    totalStakeUnits: number;
    averageBankrollReturn: number | null;
    maximumDrawdownFraction: number | null;
  };
}

function integerEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function numberEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function plusOneMillisecond(value: Date): Date {
  return new Date(value.getTime() + 1);
}

function bankrollFromRules(value: unknown): ScientificBankrollSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return parseScientificBankrollSnapshot(record.stakingMetrics);
}

export async function runScientificWalkForward(
  options: ScientificWalkForwardOptions = {},
): Promise<ScientificWalkForwardReport> {
  const minimumTrainingFixtures = Math.max(
    100,
    options.minimumTrainingFixtures ??
      integerEnvironment('SCIENTIFIC_WF_MIN_TRAIN', 200),
  );
  const testFixturesPerFold = Math.max(
    20,
    options.testFixturesPerFold ??
      integerEnvironment('SCIENTIFIC_WF_TEST_SIZE', 50),
  );
  const maximumFolds = Math.max(
    1,
    options.maximumFolds ?? integerEnvironment('SCIENTIFIC_WF_MAX_FOLDS', 5),
  );
  const horizonMinutes = Math.max(
    5,
    options.horizonMinutes ??
      integerEnvironment('SCIENTIFIC_WF_HORIZON_MINUTES', 30),
  );
  const stakeUnits = Math.max(
    0.01,
    options.stakeUnits ?? numberEnvironment('BACKTEST_STAKE_UNITS', 1),
  );
  const initialBankrollUnits = Math.max(
    1,
    options.initialBankrollUnits ??
      numberEnvironment('SCIENTIFIC_BANKROLL_UNITS', 100),
  );

  const existingLock = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_WALK_FORWARD_LOCK_KEY },
  });
  if (existingLock) {
    throw new Error(
      'Scientific walk-forward is already locked. Remove SCIENTIFIC_WALK_FORWARD_LOCK_V62 only after confirming no run is active.',
    );
  }

  const productionSetting = await prisma.appSetting.findUnique({
    where: { key: SCIENTIFIC_MODEL_KEY },
  });
  const previousTrainingLimit = process.env.SCIENTIFIC_TRAINING_LIMIT;
  const previousPurpose = process.env.SCIENTIFIC_TRAINING_PURPOSE;
  const previousNoPromote = process.env.SCIENTIFIC_TRAINING_NO_PROMOTE;

  await prisma.appSetting.create({
    data: {
      key: SCIENTIFIC_WALK_FORWARD_LOCK_KEY,
      value: {
        startedAt: new Date().toISOString(),
        processId: process.pid,
      } as InputJsonValue,
    },
  });

  try {
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        homeGoals: { not: null },
        awayGoals: { not: null },
        ...(options.leagueId ? { leagueId: options.leagueId } : {}),
      },
      select: { id: true, kickoffAt: true },
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
    });

    if (fixtures.length < minimumTrainingFixtures + testFixturesPerFold) {
      throw new Error(
        `Not enough fixtures for walk-forward: ${fixtures.length}; need at least ${minimumTrainingFixtures + testFixturesPerFold}.`,
      );
    }

    const folds: ScientificWalkForwardFoldResult[] = [];
    let trainingCount = minimumTrainingFixtures;

    for (
      let foldIndex = 1;
      foldIndex <= maximumFolds && trainingCount < fixtures.length;
      foldIndex += 1
    ) {
      const trainThrough = fixtures[trainingCount - 1]?.kickoffAt;
      if (!trainThrough) break;

      let testStartIndex = trainingCount;
      // A test prediction at T-horizon must still occur after training completed.
      while (
        testStartIndex < fixtures.length &&
        fixtures[testStartIndex]!.kickoffAt.getTime() - horizonMinutes * 60_000 <=
          trainThrough.getTime()
      ) {
        testStartIndex += 1;
      }
      if (testStartIndex >= fixtures.length) break;

      const testEndExclusive = Math.min(
        fixtures.length,
        testStartIndex + testFixturesPerFold,
      );
      const testFrom = fixtures[testStartIndex]!.kickoffAt;
      const testTo = fixtures[testEndExclusive - 1]!.kickoffAt;

      process.env.SCIENTIFIC_TRAINING_LIMIT = String(trainingCount);
      process.env.SCIENTIFIC_TRAINING_PURPOSE = `walk-forward-fold-${foldIndex}`;
      process.env.SCIENTIFIC_TRAINING_NO_PROMOTE = 'true';
      await trainScientificModel();

      const artifactSetting = await prisma.appSetting.findUnique({
        where: { key: SCIENTIFIC_MODEL_KEY },
      });
      if (!artifactSetting?.value || typeof artifactSetting.value !== 'object') {
        throw new Error(`Fold ${foldIndex} did not produce a model artifact.`);
      }
      const artifact = artifactSetting.value as unknown as ScientificModelArtifact;
      const metadata = await saveScientificModelArtifact({
        artifact,
        purpose: `walk-forward-fold-${foldIndex}`,
        foldIndex,
        trainingLimit: trainingCount,
        aliases: [`walk-forward-fold-${foldIndex}`, 'walk-forward-latest'],
      });

      const backtest = await runScientificBacktest({
        name: `Scientific v6.2 bankroll walk-forward fold ${foldIndex}`,
        from: testFrom,
        to: plusOneMillisecond(testTo),
        fixtureLimit: Math.max(testFixturesPerFold * 2, 100),
        stakeUnits,
        initialBankrollUnits,
        horizonMinutes,
        ...(options.leagueId ? { leagueId: options.leagueId } : {}),
      });

      const bankroll = bankrollFromRules(backtest.rules);
      folds.push({
        foldIndex,
        trainingFixtures: trainingCount,
        testingFixturesRequested: testEndExclusive - testStartIndex,
        trainThrough: trainThrough.toISOString(),
        testFrom: testFrom.toISOString(),
        testTo: testTo.toISOString(),
        artifactId: metadata.artifactId,
        runId: backtest.id,
        totalFixtures: backtest.totalFixtures,
        eligibleFixtures: backtest.eligibleFixtures,
        totalBets: backtest.totalBets,
        wins: backtest.wins,
        losses: backtest.losses,
        profitUnits: backtest.profitUnits,
        roi: backtest.roi,
        maximumDrawdown: backtest.maximumDrawdown,
        brierScore: backtest.brierScore,
        totalStakeUnits: bankroll?.totalStakeUnits ?? backtest.totalBets * stakeUnits,
        endingBankrollUnits: bankroll?.endingBankrollUnits ?? null,
        bankrollReturn: bankroll?.bankrollReturn ?? null,
        maximumDrawdownFraction: bankroll?.maximumDrawdownFraction ?? null,
        rules: backtest.rules,
      });

      trainingCount = testEndExclusive;
    }

    const totalBets = folds.reduce((sum, fold) => sum + fold.totalBets, 0);
    const totalStake = folds.reduce(
      (sum, fold) => sum + fold.totalStakeUnits,
      0,
    );
    const brierWeight = folds.reduce(
      (sum, fold) => sum + (fold.brierScore == null ? 0 : fold.totalFixtures),
      0,
    );
    const report: ScientificWalkForwardReport = {
      version: 'scientific-walk-forward-v6.2-bankroll',
      createdAt: new Date().toISOString(),
      horizonMinutes,
      minimumTrainingFixtures,
      testFixturesPerFold,
      maximumFolds,
      leagueId: options.leagueId ?? null,
      folds,
      summary: {
        foldCount: folds.length,
        totalFixtures: folds.reduce((sum, fold) => sum + fold.totalFixtures, 0),
        eligibleFixtures: folds.reduce(
          (sum, fold) => sum + fold.eligibleFixtures,
          0,
        ),
        totalBets,
        wins: folds.reduce((sum, fold) => sum + fold.wins, 0),
        losses: folds.reduce((sum, fold) => sum + fold.losses, 0),
        profitUnits: folds.reduce((sum, fold) => sum + fold.profitUnits, 0),
        roi:
          totalStake > 0
            ? folds.reduce((sum, fold) => sum + fold.profitUnits, 0) /
              totalStake
            : null,
        weightedBrierScore:
          brierWeight > 0
            ? folds.reduce(
                (sum, fold) =>
                  sum + (fold.brierScore ?? 0) * fold.totalFixtures,
                0,
              ) / brierWeight
            : null,
        profitableFolds: folds.filter((fold) => fold.profitUnits > 0).length,
        totalStakeUnits: totalStake,
        averageBankrollReturn:
          folds.some((fold) => fold.bankrollReturn != null)
            ? folds.reduce((sum, fold) => sum + (fold.bankrollReturn ?? 0), 0) /
              folds.filter((fold) => fold.bankrollReturn != null).length
            : null,
        maximumDrawdownFraction:
          folds.some((fold) => fold.maximumDrawdownFraction != null)
            ? Math.max(
                ...folds.map((fold) => fold.maximumDrawdownFraction ?? 0),
              )
            : null,
      },
    };

    await prisma.appSetting.upsert({
      where: { key: SCIENTIFIC_WALK_FORWARD_REPORT_KEY },
      update: { value: report as unknown as InputJsonValue },
      create: {
        key: SCIENTIFIC_WALK_FORWARD_REPORT_KEY,
        value: report as unknown as InputJsonValue,
      },
    });
    return report;
  } finally {
    restoreEnvironment('SCIENTIFIC_TRAINING_LIMIT', previousTrainingLimit);
    restoreEnvironment('SCIENTIFIC_TRAINING_PURPOSE', previousPurpose);
    restoreEnvironment('SCIENTIFIC_TRAINING_NO_PROMOTE', previousNoPromote);

    if (productionSetting) {
      await prisma.appSetting.upsert({
        where: { key: SCIENTIFIC_MODEL_KEY },
        update: { value: productionSetting.value as InputJsonValue },
        create: {
          key: SCIENTIFIC_MODEL_KEY,
          value: productionSetting.value as InputJsonValue,
        },
      });
    } else {
      await prisma.appSetting.deleteMany({ where: { key: SCIENTIFIC_MODEL_KEY } });
    }
    await prisma.appSetting.deleteMany({
      where: { key: SCIENTIFIC_WALK_FORWARD_LOCK_KEY },
    });
  }
}
