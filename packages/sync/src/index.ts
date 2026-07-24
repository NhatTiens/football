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
