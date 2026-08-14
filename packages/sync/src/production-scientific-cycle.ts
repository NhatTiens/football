import { captureDueCurrentSignalSnapshots } from './current-signal-snapshot-engine.js';
import { collectFreshOddsDue } from './fresh-odds-collector-engine.js';
import { runLiveScientificPaperBetDecisions } from './real-odds-paper-bet-engine.js';
import { syncRepeatedFixtureContext } from './repeated-context.js';

export const PRODUCTION_SCIENTIFIC_LIVE_CYCLE_VERSION = 'v7.0-production-scientific-live-cycle-v1';

export interface ProductionScientificLiveCycleOperations {
  syncContext: typeof syncRepeatedFixtureContext;
  collectFreshOdds: typeof collectFreshOddsDue;
  captureSnapshots: typeof captureDueCurrentSignalSnapshots;
  createPaperDecisions: typeof runLiveScientificPaperBetDecisions;
}

const defaultOperations: ProductionScientificLiveCycleOperations = {
  syncContext: syncRepeatedFixtureContext,
  collectFreshOdds: collectFreshOddsDue,
  captureSnapshots: captureDueCurrentSignalSnapshots,
  createPaperDecisions: runLiveScientificPaperBetDecisions,
};

/**
 * Runs the time-sensitive production path in the same order as the scientific
 * development autopilot. Keeping it as one worker job prevents a snapshot from
 * being evaluated before its due context and odds have been collected.
 */
export async function runProductionScientificLiveCycle(
  input: {
    now?: Date;
    operations?: ProductionScientificLiveCycleOperations;
  } = {},
): Promise<Record<string, unknown>> {
  const now = input.now ?? new Date();
  const operations = input.operations ?? defaultOperations;

  const context = await operations.syncContext({ now });
  const freshOdds = await operations.collectFreshOdds(now);
  const snapshots = await operations.captureSnapshots({ now });
  const decisions = await operations.createPaperDecisions({ now });

  return {
    event: 'PRODUCTION_SCIENTIFIC_LIVE_CYCLE',
    version: PRODUCTION_SCIENTIFIC_LIVE_CYCLE_VERSION,
    executedAt: now.toISOString(),
    context,
    freshOdds,
    snapshots,
    decisions,
    safety: {
      paperOnly: true,
      externalApiMayBeCalled: true,
      automaticPromotion: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    },
  };
}
