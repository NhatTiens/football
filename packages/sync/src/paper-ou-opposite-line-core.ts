/**
 * Backward-compatible module for older imports. The runtime no longer applies
 * the opposite-selection +/-0.5 rule.
 */
export * from './paper-ou-model-selection-core.js';

export {
  PAPER_OU_MODEL_SELECTION_VERSION as PAPER_OU_OPPOSITE_LINE_VERSION,
  mapPaperOuPredictionToModelSelection as mapPaperOuPredictionToOppositeLine,
} from './paper-ou-model-selection-core.js';
