export * from './config.js';
export * from './fixtures.js';
export * from './odds.js';
export * from './repeated-odds-core.js';
export * from './repeated-odds.js';
export * from './predictions.js';
export * from './recommendations.js';
export * from './settlement.js';
export * from './backtest.js';
export * from './lineups.js';
export * from './lineup-analysis.js';
export * from './scientific-model.js';
export * from './three-market-core.js';
export * from './three-market-evaluation-engine.js';
export * from './scientific-features.js';
export * from './scientific-sync.js';
export * from './scientific-recommendations.js';
export * from './scientific-backtest.js';
export * from './scientific-v61.js';
export * from './scientific-model-registry.js';
export * from './scientific-walk-forward.js';
export * from './scientific-bankroll.js';

export * from './fundamentals-core.js';
export * from './fundamentals-engine.js';
export * from './ml-market-contract.js';
export * from './ml-market-engine.js';
export {
  SCIENTIFIC_EVALUATION_VERSION,
  SCIENTIFIC_POLICY_VERSION,
  clamp as clampScientificEvaluation,
  normalizeProbabilities as normalizeScientificEvaluationProbabilities,
  probabilityForClass,
  predictedClass,
  multiclassBrier,
  multiclassLogLoss,
  mean,
  maximumDrawdown,
  fairProbabilitiesFromOdds,
  settleMatchWinner,
  closingLineValue,
  deterministicHash as scientificEvaluationDeterministicHash,
  decidePromotion,
} from './scientific-evaluation-contract.js';

export type {
  MatchWinnerClass,
  MatchWinnerOdds,
  EvaluationMetricSet,
  BettingMetricSet,
  PromotionInput,
  PromotionDecision,
  MatchWinnerProbabilities as ScientificEvaluationMatchWinnerProbabilities,
} from './scientific-evaluation-contract.js';
export * from './scientific-evaluation-engine.js';
export * from './scientific-diagnostic-contract.js';
export * from './scientific-diagnostic-engine.js';
export * from './scientific-shadow-contract.js';
export * from './scientific-shadow-engine.js';
export {
  BETA1A_PROVIDER_VERSION,
  BETA1A_REPLAY_EVIDENCE_CLASS,
  BETA1A_REPLAY_POLICY_VERSION,
  assertReplaySchedulerPlan,
  buildReplaySchedulerPlan,
  classifyMatchWinner,
  parseFootballProviderMode,
  pointInTimeSafe,
  replayBrierScore,
  replayEvidenceCanPromote,
  replayLogLoss,
  resultAvailableAt,
} from './provider-contract.js';
export type {
  FootballDataProvider,
  FootballProviderMode,
  NormalizedProviderFixture,
  ProviderCapabilities,
  ProviderCapabilityName,
  ProviderPrematchSnapshot,
  ProviderResultSnapshot,
  ReplaySchedulerEvent,
  ReplaySchedulerEventType,
} from './provider-contract.js';
export * from './provider-replay-engine.js';
export * from './historical-data-audit-contract.js';
export * from './historical-data-audit-engine.js';
export * from './scientific-multi-market-port.js';
export * from './scientific-multi-market-replay-engine.js';
export * from './scientific-best-bet-reliability-engine.js';
export * from './paper-bet-ledger-engine.js';
export * from './paper-bet-ledger-core.js';
export * from './api-football-provider-engine.js';
export * from './api-football-client.js';
export * from './api-football-contract.js';
export * from './scientific-best-bet-policy-contract.js';
export * from './scientific-multi-market-replay-contract.js';
export * from './real-odds-paper-bet-core.js';
export * from './real-odds-paper-bet-engine.js';
export * from './paper-bet-operations-core.js';
export * from './paper-bet-operations-engine.js';
export * from './paper-shadow-recommendation-core.js';
export * from './paper-ou-opposite-line-core.js';
export * from './prediction-chatbot-core.js';
export * from './prediction-chatbot-engine.js';
export * from './prediction-chatbot-conversation-core.js';
export * from './prediction-chatbot-research-engine.js';
export * from './prediction-chatbot-advanced-engine.js';
export * from './history-read-model.js';
export * from './paper-hda-context-adjustment-core.js';
export * from './paper-hda-context-adjustment-engine.js';
export * from './shadow-settlement-core.js';
export { buildShadowSettlementRuntimeReport } from './shadow-settlement-report-cli.js';
export * from './daily-outcome-report-core.js';
export {
  getPersonalUpcomingAnalysis,
  refreshPersonalUpcomingAnalysis,
} from './personal-console-engine.js';
export { discoverCurrentPriorityCompetitions } from './current-competition-discovery.js';

export * from './predictive-signal-audit.js';

export * from './context-snapshots.js';

export * from './repeated-context-core.js';

export * from './repeated-context.js';
export * from './hybrid-data-foundation-contract.js';
export * from './hybrid-data-foundation-engine.js';
export * from './bayesian-team-strength-contract.js';
export * from './bayesian-team-strength-engine.js';
export * from './bayesian-predictive-markets-contract.js';
export * from './bayesian-predictive-markets-engine.js';
export * from './hybrid-model-contract.js';
export * from './hybrid-model-engine.js';
export * from './calibration-uncertainty-contract.js';
export * from './calibration-uncertainty-engine.js';
export * from './multi-horizon-decision-contract.js';
export * from './multi-horizon-decision-engine.js';
export * from './champion-challenger-backtest-contract.js';
export * from './champion-challenger-backtest-engine.js';
export * from './v8-paper-runtime-engine.js';
export * from './v8-monitoring-engine.js';
export * from './v8-live-data-readiness.js';
export * from './v8-shadow-release-gate-contract.js';
export * from './v8-shadow-release-gate.js';
