import type { WorkerCommand } from './jobs.js';

export type WorkerSchedule = readonly [expression: string, command: WorkerCommand];

export interface WorkerScheduleConfiguration {
  schedules: WorkerSchedule[];
  scienceOwnsProviderSync: boolean;
  scientificCurrentRefreshEnabled: boolean;
}

function booleanEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = environment[name];
  if (raw == null || raw.trim() === '') return fallback;

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  throw new Error(`${name} must be true or false.`);
}

export function buildWorkerScheduleConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerScheduleConfiguration {
  // PREDICTION_AI_V7_QUOTA: sync-odds is now bulk-by-date (one call per date
  // covers every fixture), so the per-fixture repeated-odds job is OFF by
  // default — the bulk run already accumulates the snapshots needed for odds
  // movement analysis. Re-enable with ODDS_REPEATED_ENABLED=true only if you
  // need per-fixture intra-hour precision.
  const repeatedOddsEnabled = booleanEnvironment(environment, 'ODDS_REPEATED_ENABLED', false);
  const oddsCommand: WorkerCommand = repeatedOddsEnabled ? 'sync-odds-repeated' : 'sync-odds';
  // PREDICTION_AI_V7_QUOTA: default cadences were aggressively fast (odds every
  // 5 min, predictions hourly, lineups every 10 min) and could exhaust a Pro
  // 7.5k/day plan within hours. Defaults are now conservative; override via env.
  const oddsCron = repeatedOddsEnabled
    ? (environment.ODDS_REPEATED_CRON ?? '*/30 * * * *')
    : (environment.ODDS_SYNC_CRON ?? '*/30 * * * *');
  const scienceOwnsProviderSync = booleanEnvironment(
    environment,
    'DEV_SCIENCE_OWNS_PROVIDER_SYNC',
    false,
  );
  const scientificCurrentRefreshEnabled = booleanEnvironment(
    environment,
    'SCIENTIFIC_CURRENT_REFRESH_ENABLED',
    true,
  );
  const v8PaperRuntimeEnabled = booleanEnvironment(environment, 'V8_PAPER_RUNTIME_ENABLED', false);

  const sharedSchedules: WorkerSchedule[] = [
    [environment.RECOMMENDATION_CRON ?? '*/15 * * * *', 'generate'],
    [environment.PAPER_BET_SETTLEMENT_CRON ?? '*/10 * * * *', 'paper-bet-ledger-settle'],
    [environment.SETTLEMENT_CRON ?? '3,13,23,33,43,53 * * * *', 'settle'],
  ];

  const schedules: WorkerSchedule[] = scienceOwnsProviderSync
    ? [...sharedSchedules]
    : [
        [environment.FIXTURE_SYNC_CRON ?? '0 */6 * * *', 'sync-fixtures'],
        [oddsCron, oddsCommand],
        [
          environment.SCIENTIFIC_LIVE_CYCLE_CRON ??
            environment.PAPER_BET_OPERATIONS_CRON ??
            '*/5 * * * *',
          'scientific-live-cycle',
        ],
        ...(scientificCurrentRefreshEnabled
          ? ([
              [
                environment.SCIENTIFIC_CURRENT_REFRESH_CRON ?? '30 7 */2 * * *',
                'scientific-current-refresh',
              ],
            ] as WorkerSchedule[])
          : []),
        [environment.LINEUP_SYNC_CRON ?? '*/30 * * * *', 'sync-lineups'],
        // PREDICTION_AI_V7_QUOTA: API-Football predictions only feed an 8%
        // blend weight, so refreshing them once a day is enough.
        [environment.PREDICTION_SYNC_CRON ?? '30 4 * * *', 'sync-predictions'],
        ...sharedSchedules,
      ];

  if (v8PaperRuntimeEnabled) {
    schedules.push([environment.V8_PAPER_RUNTIME_CRON ?? '* * * * *', 'v8-paper-runtime-cycle']);
  }

  return {
    schedules,
    scienceOwnsProviderSync,
    scientificCurrentRefreshEnabled,
  };
}
