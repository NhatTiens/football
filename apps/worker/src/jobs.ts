import {
  backfillFundamentals,
  backfillMlFeatures,
  getMlMarketCoverage,
  scoreMlValidation,
  trainMlMarketModels,
  freezeScientificBaseline,
  getScientificEvaluationCoverage,
  getScientificPromotionReport,
  runScientificEvaluation,
  getScientificDevelopmentReport,
  getScientificDiagnosticCoverage,
  runScientificDiagnosticImprovement,
  captureScientificShadowPredictions,
  evaluateScientificShadow,
  freezeScientificShadowCandidate,
  getScientificShadowCoverage,
  getScientificShadowReport,
  getProviderReplayCoverage,
  getProviderReplayReport,
  getHistoricalDataAuditCoverage,
  getHistoricalDataAuditReport,
  runHistoricalDataAudit,
  runBeta1AReplayPipeline,
  runProviderHealthCheck,
  getFundamentalsCoverage,
  collectRepeatedOdds,
  getRepeatedOddsCoverage,
  generateRecommendations,
  rebuildScientificElo,
  runBacktest,
  runScientificBacktest,
  runScientificWalkForward,
  settleRecommendations,
  syncFixtures,
  syncLineups,
  syncOdds,
  syncPredictions,
  syncScientificInjuries,
  syncScientificStatistics,
  trainScientificModel,
} from '@football-ai/sync';

export type WorkerCommand =
  | 'sync-fixtures'
  | 'sync-odds'
  | 'sync-odds-repeated'
  | 'odds-coverage'
  | 'fundamentals-backfill'
  | 'fundamentals-coverage'
  | 'ml-feature-backfill'
  | 'ml-train'
  | 'ml-score-validation'
  | 'ml-coverage'
  | 'scientific-baseline-freeze'
  | 'scientific-evaluate'
  | 'scientific-evaluation-coverage'
  | 'scientific-promotion-report'
  | 'scientific-diagnostic-run'
  | 'scientific-diagnostic-coverage'
  | 'scientific-development-report'
  | 'scientific-shadow-freeze'
  | 'scientific-shadow-capture'
  | 'scientific-shadow-evaluate'
  | 'scientific-shadow-coverage'
  | 'scientific-shadow-report'
  | 'provider-health'
  | 'provider-replay-run'
  | 'provider-replay-coverage'
  | 'provider-replay-report'
  | 'historical-data-audit-run'
  | 'historical-data-audit-coverage'
  | 'historical-data-audit-report'
  | 'sync-lineups'
  | 'sync-lineups-history'
  | 'sync-predictions'
  | 'sync-scientific-stats'
  | 'sync-scientific-injuries'
  | 'rebuild-elo'
  | 'train-scientific'
  | 'generate'
  | 'settle'
  | 'backtest'
  | 'scientific-backtest'
  | 'scientific-walk-forward'
  | 'scientific-full'
  | 'full';

let running = false;

export async function executeJob(command: WorkerCommand): Promise<unknown> {
  if (running) {
    console.warn(`Skipping ${command}; another worker job is already running.`);
    return { skipped: true };
  }

  running = true;
  const startedAt = Date.now();

  try {
    console.log(`[worker] starting ${command}`);
    let result: unknown;

    if (command === 'sync-fixtures') result = await syncFixtures();
    else if (command === 'sync-odds') result = await syncOdds();
    else if (command === 'sync-odds-repeated') result = await collectRepeatedOdds();
    else if (command === 'odds-coverage') result = await getRepeatedOddsCoverage();
    else if (command === 'fundamentals-backfill') result = await backfillFundamentals();
    else if (command === 'fundamentals-coverage') result = await getFundamentalsCoverage();
    else if (command === 'ml-feature-backfill') result = await backfillMlFeatures();
    else if (command === 'ml-train') result = await trainMlMarketModels();
    else if (command === 'ml-score-validation') result = await scoreMlValidation();
    else if (command === 'ml-coverage') result = await getMlMarketCoverage();
    else if (command === 'scientific-baseline-freeze') result = await freezeScientificBaseline();
    else if (command === 'scientific-evaluate') result = await runScientificEvaluation();
    else if (command === 'scientific-evaluation-coverage')
      result = await getScientificEvaluationCoverage();
    else if (command === 'scientific-promotion-report')
      result = await getScientificPromotionReport();
    else if (command === 'scientific-diagnostic-run')
      result = await runScientificDiagnosticImprovement();
    else if (command === 'scientific-diagnostic-coverage')
      result = await getScientificDiagnosticCoverage();
    else if (command === 'scientific-development-report')
      result = await getScientificDevelopmentReport();
    else if (command === 'scientific-shadow-freeze')
      result = await freezeScientificShadowCandidate();
    else if (command === 'scientific-shadow-capture')
      result = await captureScientificShadowPredictions();
    else if (command === 'scientific-shadow-evaluate') result = await evaluateScientificShadow();
    else if (command === 'scientific-shadow-coverage') result = await getScientificShadowCoverage();
    else if (command === 'scientific-shadow-report') result = await getScientificShadowReport();
    else if (command === 'provider-health') result = await runProviderHealthCheck();
    else if (command === 'provider-replay-run') result = await runBeta1AReplayPipeline();
    else if (command === 'provider-replay-coverage') result = await getProviderReplayCoverage();
    else if (command === 'provider-replay-report') result = await getProviderReplayReport();
    else if (command === 'historical-data-audit-run') result = await runHistoricalDataAudit();
    else if (command === 'historical-data-audit-coverage')
      result = await getHistoricalDataAuditCoverage();
    else if (command === 'historical-data-audit-report')
      result = await getHistoricalDataAuditReport();
    else if (command === 'sync-lineups') result = await syncLineups();
    else if (command === 'sync-lineups-history') {
      result = await syncLineups({ includeHistory: true });
    } else if (command === 'sync-predictions') result = await syncPredictions();
    else if (command === 'sync-scientific-stats') {
      result = await syncScientificStatistics();
    } else if (command === 'sync-scientific-injuries') {
      result = await syncScientificInjuries();
    } else if (command === 'rebuild-elo') result = await rebuildScientificElo();
    else if (command === 'train-scientific') result = await trainScientificModel();
    else if (command === 'generate') result = await generateRecommendations();
    else if (command === 'settle') result = await settleRecommendations();
    else if (command === 'backtest') {
      result = await runBacktest({
        from: process.env.BACKTEST_FROM,
        to: process.env.BACKTEST_TO,
        leagueId: process.env.BACKTEST_LEAGUE_ID
          ? Number(process.env.BACKTEST_LEAGUE_ID)
          : undefined,
        fixtureLimit: process.env.BACKTEST_FIXTURE_LIMIT
          ? Number(process.env.BACKTEST_FIXTURE_LIMIT)
          : undefined,
        stakeUnits: process.env.BACKTEST_STAKE_UNITS
          ? Number(process.env.BACKTEST_STAKE_UNITS)
          : undefined,
      });
    } else if (command === 'scientific-backtest') {
      result = await runScientificBacktest({
        from: process.env.BACKTEST_FROM,
        to: process.env.BACKTEST_TO,
        leagueId: process.env.BACKTEST_LEAGUE_ID
          ? Number(process.env.BACKTEST_LEAGUE_ID)
          : undefined,
        fixtureLimit: process.env.BACKTEST_FIXTURE_LIMIT
          ? Number(process.env.BACKTEST_FIXTURE_LIMIT)
          : undefined,
        stakeUnits: process.env.BACKTEST_STAKE_UNITS
          ? Number(process.env.BACKTEST_STAKE_UNITS)
          : undefined,
      });
    } else if (command === 'scientific-walk-forward') {
      result = await runScientificWalkForward({
        minimumTrainingFixtures: process.env.SCIENTIFIC_WF_MIN_TRAIN
          ? Number(process.env.SCIENTIFIC_WF_MIN_TRAIN)
          : undefined,
        testFixturesPerFold: process.env.SCIENTIFIC_WF_TEST_SIZE
          ? Number(process.env.SCIENTIFIC_WF_TEST_SIZE)
          : undefined,
        maximumFolds: process.env.SCIENTIFIC_WF_MAX_FOLDS
          ? Number(process.env.SCIENTIFIC_WF_MAX_FOLDS)
          : undefined,
        horizonMinutes: process.env.SCIENTIFIC_WF_HORIZON_MINUTES
          ? Number(process.env.SCIENTIFIC_WF_HORIZON_MINUTES)
          : undefined,
        leagueId: process.env.BACKTEST_LEAGUE_ID
          ? Number(process.env.BACKTEST_LEAGUE_ID)
          : undefined,
        stakeUnits: process.env.BACKTEST_STAKE_UNITS
          ? Number(process.env.BACKTEST_STAKE_UNITS)
          : undefined,
      });
    } else if (command === 'scientific-full') {
      result = {
        statistics: await syncScientificStatistics(),
        injuries: await syncScientificInjuries(),
        elo: await rebuildScientificElo(),
        training: await trainScientificModel(),
        recommendations: await generateRecommendations(),
      };
    } else {
      result = {
        fixtures: await syncFixtures(),
        odds: await syncOdds(),
        lineups: await syncLineups(),
        predictions: await syncPredictions(),
        recommendations: await generateRecommendations(),
        settlement: await settleRecommendations(),
      };
    }

    console.log(`[worker] completed ${command} in ${Date.now() - startedAt}ms`, result);
    return result;
  } catch (error) {
    console.error(`[worker] failed ${command}`, error);
    throw error;
  } finally {
    running = false;
  }
}
