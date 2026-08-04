import {
  calculateExpectedValue,
  calculateImpliedProbability,
  selectScientificBestBet,
  type ScientificBetCandidate,
  type ScientificBestBetDecision,
} from './scientific-best-bet-policy-contract.js';
import type { PaperOuOppositeLineStrategyAudit } from './paper-ou-opposite-line-core.js';

export const SCIENTIFIC_PAPER_BET_LEDGER_VERSION = 'v7.0-beta.1B-paper-bet-ledger-v1';

export type PaperBetSettlementResult = 'WIN' | 'LOSS';

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
  ouOppositeLineStrategy?: PaperOuOppositeLineStrategyAudit | null;
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
  const lineValue =
    input.marketType === 'TOTAL_GOALS_1_5'
      ? 1.5
      : input.marketType === 'TOTAL_GOALS_2_5'
        ? 2.5
        : input.marketType === 'TOTAL_GOALS_3_5'
          ? 3.5
          : input.lineValue;

  const impliedProbability = calculateImpliedProbability(input.decimalOdds);
  const edge = input.modelProbability - input.fairMarketProbability;
  const expectedValue = calculateExpectedValue(input.modelProbability, input.decimalOdds);

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

  let won = false;

  if (input.marketType === 'MATCH_WINNER') {
    const actual =
      input.homeGoals > input.awayGoals
        ? 'HOME'
        : input.homeGoals < input.awayGoals
          ? 'AWAY'
          : 'DRAW';

    won = actual === input.selection;
  } else if (input.marketType.startsWith('TOTAL_GOALS')) {
    if (input.lineValue == null) {
      throw new Error('Total-goals settlement requires lineValue.');
    }

    const over = input.homeGoals + input.awayGoals > input.lineValue;

    won = (input.selection === 'OVER' && over) || (input.selection === 'UNDER' && !over);
  } else if (input.marketType === 'BTTS') {
    const yes = input.homeGoals > 0 && input.awayGoals > 0;

    won = (input.selection === 'YES' && yes) || (input.selection === 'NO' && !yes);
  } else {
    throw new Error(`Unsupported market settlement: ${input.marketType}`);
  }

  return {
    result: won ? 'WIN' : 'LOSS',
    stakeUnits,
    profitUnits: won ? stakeUnits * (input.decimalOdds - 1) : -stakeUnits,
  };
}
