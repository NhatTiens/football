import {
  calculateExpectedValue,
  selectScientificBestBet,
  type ScientificBetCandidate,
  type ScientificBestBetDecision,
} from './scientific-best-bet-policy-contract.js';
import type { PaperOuModelSelectionStrategyAudit } from './paper-ou-model-selection-core.js';
export const SCIENTIFIC_PAPER_BET_LEDGER_VERSION = 'v7.0-beta.1B-paper-bet-ledger-v1';

export const PAPER_BET_FINAL_SCORE_STATUSES = ['FT', 'AET', 'PEN'] as const;
export const PAPER_BET_VOID_STATUSES = ['CANC', 'ABD', 'AWD', 'WO'] as const;

export type PaperBetSettlementResult = 'WIN' | 'LOSS' | 'VOID';

export function isCompletePaperBetOutcomeSnapshot(input: {
  statusShort: string;
  fulltimeHomeGoals: number | null;
  fulltimeAwayGoals: number | null;
}): boolean {
  const statusShort = input.statusShort.trim().toUpperCase();

  if ((PAPER_BET_VOID_STATUSES as readonly string[]).includes(statusShort)) {
    return true;
  }

  return (
    (PAPER_BET_FINAL_SCORE_STATUSES as readonly string[]).includes(statusShort) &&
    input.fulltimeHomeGoals != null &&
    input.fulltimeAwayGoals != null
  );
}

export function isCompletePaperBetScoreSnapshot(input: {
  statusShort: string;
  fulltimeHomeGoals: number | null;
  fulltimeAwayGoals: number | null;
}): boolean {
  return (
    (PAPER_BET_FINAL_SCORE_STATUSES as readonly string[]).includes(
      input.statusShort.trim().toUpperCase(),
    ) &&
    input.fulltimeHomeGoals != null &&
    input.fulltimeAwayGoals != null
  );
}

export interface PaperBetCandidateInput {
  providerFixtureId: number;
  marketType: 'MATCH_WINNER' | 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5' | 'BTTS';
  selection: 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';
  lineValue: number | null;
  decimalOdds: number;
  bookmakerId: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  reliabilityStatus: string;
  reliabilityEligible: boolean;
  sourceOddsSnapshotId: number | null;
  sourceOddsUpdatedAt: Date | null;
  sourceOddsObservedAt: Date | null;
  /** Legacy wire key; now contains the direct model-selection audit. */
  ouOppositeLineStrategy?: PaperOuModelSelectionStrategyAudit | null;
}

export interface PaperBetDecisionInput {
  providerFixtureId: number;
  localFixtureId?: number | null;
  horizonMinutes: number;
  decisionAsOf: Date;
  kickoffAt: Date;
  modelVersion: string;
  policyVersion: string;
  candidates: PaperBetCandidateInput[];
}

export interface NormalizedPaperBetCandidate {
  input: PaperBetCandidateInput;
  scientificCandidate: ScientificBetCandidate;
}

function syntheticReliability(
  input: PaperBetCandidateInput,
): ScientificBetCandidate['reliability'] {
  return {
    market:
      input.marketType === 'TOTAL_GOALS_1_5' ||
      input.marketType === 'TOTAL_GOALS_2_5' ||
      input.marketType === 'TOTAL_GOALS_3_5'
        ? input.marketType
        : input.marketType,
    status: input.reliabilityEligible ? 'DIAGNOSTIC_ELIGIBLE' : 'NO_PROVEN_SKILL',
    diagnosticEligible: input.reliabilityEligible,
    model: {
      rows: 0,
      classCount: input.marketType === 'MATCH_WINNER' ? 3 : 2,
      accuracy: null,
      brier: null,
      logLoss: null,
      ece: null,
    },
    climatology: {
      rows: 0,
      classCount: input.marketType === 'MATCH_WINNER' ? 3 : 2,
      accuracy: 0,
      brier: 0,
      logLoss: 0,
      classProbabilities: {},
    },
    relativeBrierSkillVsClimatology: null,
    logLossSkillVsClimatology: null,
    eceWithinLimit: input.reliabilityEligible,
    sufficientRows: input.reliabilityEligible,
    reasons: input.reliabilityEligible ? [] : [input.reliabilityStatus],
    evidenceClass: 'HISTORICAL_DIAGNOSTIC_NON_PROMOTIONAL',
    promotional: false,
  };
}

export function normalizePaperBetCandidate(
  input: PaperBetCandidateInput,
): NormalizedPaperBetCandidate {
  const inferredLineValue =
    input.marketType === 'TOTAL_GOALS_1_5'
      ? 1.5
      : input.marketType === 'TOTAL_GOALS_2_5'
        ? 2.5
        : input.marketType === 'TOTAL_GOALS_3_5'
          ? 3.5
          : null;
  const lineValue = input.lineValue ?? inferredLineValue;
  const edge = input.modelProbability - input.fairMarketProbability;
  const expectedValue = calculateExpectedValue(
    input.modelProbability,
    input.decimalOdds,
  );

  return {
    input,
    scientificCandidate: {
      fixtureId: input.providerFixtureId,
      market: input.marketType,
      selection: input.selection,
      lineValue,
      modelProbability: input.modelProbability,
      fairMarketProbability: input.fairMarketProbability,
      decimalOdds: input.decimalOdds,
      edge,
      expectedValue,
      reliability: syntheticReliability(input),
    },
  };
}

export function decidePaperBet(input: PaperBetDecisionInput): {
  normalizedCandidates: NormalizedPaperBetCandidate[];
  decision: ScientificBestBetDecision;
} {
  if (input.decisionAsOf.getTime() >= input.kickoffAt.getTime()) {
    throw new Error('Paper bet decision must be captured before kickoff.');
  }

  if (
    input.candidates.some((candidate) => candidate.providerFixtureId !== input.providerFixtureId)
  ) {
    throw new Error('Every candidate must belong to the same provider fixture.');
  }

  const normalizedCandidates = input.candidates.map(normalizePaperBetCandidate);

  return {
    normalizedCandidates,
    decision: selectScientificBestBet(
      normalizedCandidates.map((candidate) => candidate.scientificCandidate),
    ),
  };
}

export function settlePaperBetSelection(input: {
  marketType: string;
  selection: string;
  lineValue: number | null;
  homeGoals: number;
  awayGoals: number;
  decimalOdds: number;
  stakeUnits?: number;
}): {
  result: PaperBetSettlementResult;
  stakeUnits: number;
  profitUnits: number;
} {
  const stakeUnits = input.stakeUnits ?? 1;

  if (!Number.isFinite(stakeUnits) || stakeUnits <= 0) {
    throw new RangeError('stakeUnits must be positive.');
  }

  let result: PaperBetSettlementResult;

  if (input.marketType === 'MATCH_WINNER') {
    const actual =
      input.homeGoals > input.awayGoals
        ? 'HOME'
        : input.homeGoals < input.awayGoals
          ? 'AWAY'
          : 'DRAW';

    result = actual === input.selection ? 'WIN' : 'LOSS';
  } else if (input.marketType.startsWith('TOTAL_GOALS')) {
    if (input.lineValue == null) {
      throw new Error('Total-goals settlement requires lineValue.');
    }

    const totalGoals = input.homeGoals + input.awayGoals;

    if (Math.abs(totalGoals - input.lineValue) < 1e-12) {
      result = 'VOID';
    } else if (input.selection === 'OVER') {
      result = totalGoals > input.lineValue ? 'WIN' : 'LOSS';
    } else if (input.selection === 'UNDER') {
      result = totalGoals < input.lineValue ? 'WIN' : 'LOSS';
    } else {
      throw new Error(`Unsupported total-goals selection: ${input.selection}`);
    }
  } else if (input.marketType === 'BTTS') {
    const yes = input.homeGoals > 0 && input.awayGoals > 0;
    result =
      (input.selection === 'YES' && yes) ||
      (input.selection === 'NO' && !yes)
        ? 'WIN'
        : 'LOSS';
  } else {
    throw new Error(`Unsupported market settlement: ${input.marketType}`);
  }

  return {
    result,
    stakeUnits,
    profitUnits:
      result === 'WIN'
        ? stakeUnits * (input.decimalOdds - 1)
        : result === 'LOSS'
          ? -stakeUnits
          : 0,
  };
}
