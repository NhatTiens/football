import {
  collectFreshOddsDue,
  planFreshOddsCheckpoints,
} from './fresh-odds-collector-engine.js';
import { runPaperBetOperationsCycle } from './paper-bet-operations-engine.js';

export const PREDICTION_CHAT_FRESHNESS_VERSION =
  'v7.0-chatbot-freshness-before-answer-v1';

export interface PredictionChatFreshnessReport {
  version: string;
  refreshed: boolean;
  cooldownHit: boolean;
  startedAt: string;
  finishedAt: string;
  plan: unknown;
  odds: unknown;
  operations: unknown;
}

let lastCompletedAtMs = 0;
let inFlight: Promise<PredictionChatFreshnessReport> | null = null;

export function predictionChatFreshnessCooldownMs(
  raw = process.env.PREDICTION_CHAT_FRESHNESS_COOLDOWN_SECONDS,
): number {
  const parsed = Number(raw ?? 60);
  const seconds = Number.isFinite(parsed)
    ? Math.max(30, Math.min(300, Math.trunc(parsed)))
    : 60;
  return seconds * 1000;
}

async function executeFreshnessCycle(now: Date): Promise<PredictionChatFreshnessReport> {
  const startedAt = new Date();

  // Planning is DB-only. The collector itself only requests checkpoints that are
  // actually due and applies its existing quota reserve policy.
  const plan = await planFreshOddsCheckpoints(now);
  const odds = await collectFreshOddsDue(now);

  // Recompute due PIT snapshots / paper decisions from the freshest data now
  // available before the chatbot reads PersonalUpcomingAnalysis.
  const operations = await runPaperBetOperationsCycle({
    now: new Date(),
  });

  lastCompletedAtMs = Date.now();

  return {
    version: PREDICTION_CHAT_FRESHNESS_VERSION,
    refreshed: true,
    cooldownHit: false,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    plan,
    odds,
    operations,
  };
}

export async function refreshPredictionChatDataIfDue(
  now = new Date(),
): Promise<PredictionChatFreshnessReport> {
  const cooldownMs = predictionChatFreshnessCooldownMs();

  if (inFlight != null) {
    return inFlight;
  }

  if (lastCompletedAtMs > 0 && Date.now() - lastCompletedAtMs < cooldownMs) {
    return {
      version: PREDICTION_CHAT_FRESHNESS_VERSION,
      refreshed: false,
      cooldownHit: true,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      plan: null,
      odds: null,
      operations: null,
    };
  }

  inFlight = executeFreshnessCycle(now);

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
