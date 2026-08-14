import '../../../scripts/api-football-quota-preload.mjs';

// The durable history result worker is the exclusive owner of BEST_BET result
// polling. Keep the old periodic settlement command dormant in this process.
process.env.HISTORY_RESULT_EXCLUSIVE_MODE = 'true';
process.env.PAPER_BET_SETTLEMENT_CRON = '0 0 1 1 *';

await import('./index.js');
