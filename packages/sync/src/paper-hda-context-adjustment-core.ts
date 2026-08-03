export const PAPER_HDA_CONTEXT_ADJUSTMENT_VERSION =
  'paper-hda-context-v1-lineup-h2h-pit-capped';

export type PaperHdaSelection = 'HOME' | 'DRAW' | 'AWAY';

export type PaperHdaPositionGroup =
  | 'GOALKEEPER'
  | 'DEFENDER'
  | 'MIDFIELDER'
  | 'ATTACKER'
  | 'UNKNOWN';

export interface PaperHdaMissingRegular {
  playerName?: string;
  positionGroup: PaperHdaPositionGroup;
  startRate: number;
}

export interface PaperHdaTeamLineupEvidence {
  confirmed: boolean;
  rotationCount: number | null;
  missingRegulars: readonly PaperHdaMissingRegular[];
}

export interface PaperHdaHeadToHeadObservation {
  /**
   * Goals are expressed from the current fixture's HOME/AWAY-team perspective,
   * even when the historical venue was reversed.
   */
  homeGoals: number;
  awayGoals: number;
  ageDays: number;
}

export interface PaperHdaContextAdjustmentInput {
  baseline: Record<PaperHdaSelection, number>;
  homeLineup: PaperHdaTeamLineupEvidence;
  awayLineup: PaperHdaTeamLineupEvidence;
  homeSuspensions: number;
  awaySuspensions: number;
  headToHead: readonly PaperHdaHeadToHeadObservation[];
  minimumHeadToHeadMatches?: number;
  headToHeadHalfLifeDays?: number;
  maximumHeadToHeadShift?: number;
  maximumLineupShift?: number;
  maximumProbabilityShift?: number;
}

export interface PaperHdaContextAdjustment {
  version: typeof PAPER_HDA_CONTEXT_ADJUSTMENT_VERSION;
  applied: boolean;
  probabilities: Record<PaperHdaSelection, number>;
  lineupShift: number;
  headToHeadShift: number;
  combinedDirectionalShift: number;
  maximumAbsoluteProbabilityShift: number;
  evidence: {
    homeLineupConfirmed: boolean;
    awayLineupConfirmed: boolean;
    homeMissingRegulars: number;
    awayMissingRegulars: number;
    homeRotationCount: number | null;
    awayRotationCount: number | null;
    homeSuspensions: number;
    awaySuspensions: number;
    eligibleHeadToHeadMatches: number;
    headToHeadEffectiveWeight: number;
  };
  reasonCodes: string[];
}

const POSITION_WEAKNESS: Record<PaperHdaPositionGroup, number> = {
  GOALKEEPER: 0.018,
  DEFENDER: 0.01,
  MIDFIELDER: 0.008,
  ATTACKER: 0.014,
  UNKNOWN: 0.006,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalize(
  probabilities: Record<PaperHdaSelection, number>,
): Record<PaperHdaSelection, number> {
  const home = Math.max(0.005, finiteNonNegative(probabilities.HOME));
  const draw = Math.max(0.005, finiteNonNegative(probabilities.DRAW));
  const away = Math.max(0.005, finiteNonNegative(probabilities.AWAY));
  const total = home + draw + away;

  return {
    HOME: home / total,
    DRAW: draw / total,
    AWAY: away / total,
  };
}

function teamLineupWeakness(evidence: PaperHdaTeamLineupEvidence): number {
  if (!evidence.confirmed) return 0;

  const missingPlayerWeakness = evidence.missingRegulars.reduce((sum, player) => {
    const reliability = clamp(player.startRate, 0, 1);
    return sum + POSITION_WEAKNESS[player.positionGroup] * reliability;
  }, 0);
  const rotationBeyondNormal = Math.max(0, finiteNonNegative(evidence.rotationCount ?? 0) - 4);
  const rotationWeakness = Math.min(0.012, rotationBeyondNormal * 0.003);

  return Math.min(0.04, missingPlayerWeakness + rotationWeakness);
}

function headToHeadAdjustment(input: {
  observations: readonly PaperHdaHeadToHeadObservation[];
  minimumMatches: number;
  halfLifeDays: number;
  maximumShift: number;
}): {
  shift: number;
  eligibleMatches: number;
  effectiveWeight: number;
} {
  const eligible = input.observations.filter(
    (row) =>
      Number.isFinite(row.homeGoals) &&
      Number.isFinite(row.awayGoals) &&
      Number.isFinite(row.ageDays) &&
      row.ageDays >= 0,
  );

  if (eligible.length < input.minimumMatches) {
    return {
      shift: 0,
      eligibleMatches: eligible.length,
      effectiveWeight: 0,
    };
  }

  let weightedScore = 0;
  let totalWeight = 0;

  for (const row of eligible) {
    const weight = Math.exp((-Math.log(2) * row.ageDays) / input.halfLifeDays);
    const score = row.homeGoals > row.awayGoals ? 1 : row.homeGoals === row.awayGoals ? 0.5 : 0;
    weightedScore += score * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return {
      shift: 0,
      eligibleMatches: eligible.length,
      effectiveWeight: 0,
    };
  }

  const directionalSignal = clamp(((weightedScore / totalWeight) - 0.5) * 2, -1, 1);
  const sampleReliability = clamp(eligible.length / 5, 0, 1);
  const recencyReliability = clamp(totalWeight / Math.max(eligible.length, 1), 0.2, 1);

  return {
    shift:
      directionalSignal *
      input.maximumShift *
      sampleReliability *
      recencyReliability,
    eligibleMatches: eligible.length,
    effectiveWeight: totalWeight,
  };
}

export function buildPaperHdaContextAdjustment(
  input: PaperHdaContextAdjustmentInput,
): PaperHdaContextAdjustment {
  const baseline = normalize(input.baseline);
  const maximumLineupShift = clamp(input.maximumLineupShift ?? 0.03, 0, 0.04);
  const maximumHeadToHeadShift = clamp(input.maximumHeadToHeadShift ?? 0.015, 0, 0.02);
  const maximumProbabilityShift = clamp(input.maximumProbabilityShift ?? 0.04, 0, 0.05);
  const minimumHeadToHeadMatches = Math.max(
    2,
    Math.floor(input.minimumHeadToHeadMatches ?? 3),
  );
  const headToHeadHalfLifeDays = Math.max(90, input.headToHeadHalfLifeDays ?? 365);

  const homeWeakness = teamLineupWeakness(input.homeLineup);
  const awayWeakness = teamLineupWeakness(input.awayLineup);
  const lineupShift = clamp(
    awayWeakness - homeWeakness,
    -maximumLineupShift,
    maximumLineupShift,
  );
  const headToHead = headToHeadAdjustment({
    observations: input.headToHead,
    minimumMatches: minimumHeadToHeadMatches,
    halfLifeDays: headToHeadHalfLifeDays,
    maximumShift: maximumHeadToHeadShift,
  });
  const combinedDirectionalShift = clamp(
    lineupShift + headToHead.shift,
    -maximumProbabilityShift,
    maximumProbabilityShift,
  );

  const preliminary = normalize({
    HOME: baseline.HOME + combinedDirectionalShift,
    DRAW: baseline.DRAW,
    AWAY: baseline.AWAY - combinedDirectionalShift,
  });
  const preliminaryMaximumShift = Math.max(
    Math.abs(preliminary.HOME - baseline.HOME),
    Math.abs(preliminary.DRAW - baseline.DRAW),
    Math.abs(preliminary.AWAY - baseline.AWAY),
  );
  const scale =
    preliminaryMaximumShift > maximumProbabilityShift && preliminaryMaximumShift > 0
      ? maximumProbabilityShift / preliminaryMaximumShift
      : 1;
  const probabilities = normalize({
    HOME: baseline.HOME + (preliminary.HOME - baseline.HOME) * scale,
    DRAW: baseline.DRAW + (preliminary.DRAW - baseline.DRAW) * scale,
    AWAY: baseline.AWAY + (preliminary.AWAY - baseline.AWAY) * scale,
  });
  const maximumAbsoluteProbabilityShift = Math.max(
    Math.abs(probabilities.HOME - baseline.HOME),
    Math.abs(probabilities.DRAW - baseline.DRAW),
    Math.abs(probabilities.AWAY - baseline.AWAY),
  );

  const reasonCodes: string[] = [];
  if (!input.homeLineup.confirmed) reasonCodes.push('HOME_LINEUP_UNCONFIRMED_NO_PLAYER_SHIFT');
  if (!input.awayLineup.confirmed) reasonCodes.push('AWAY_LINEUP_UNCONFIRMED_NO_PLAYER_SHIFT');
  if (Math.abs(lineupShift) > 1e-9) reasonCodes.push('CONFIRMED_LINEUP_PLAYER_IMPACT_APPLIED');
  if (Math.abs(headToHead.shift) > 1e-9) reasonCodes.push('RECENCY_WEIGHTED_H2H_APPLIED');
  if (headToHead.eligibleMatches < minimumHeadToHeadMatches) {
    reasonCodes.push('H2H_SAMPLE_TOO_SMALL_NO_SHIFT');
  }
  if (input.homeSuspensions > 0 || input.awaySuspensions > 0) {
    reasonCodes.push('SUSPENSION_EVIDENCE_PRESENT_BASELINE_INJURY_ADJUSTMENT');
  }
  if (maximumAbsoluteProbabilityShift >= maximumProbabilityShift - 1e-9) {
    reasonCodes.push('CONTEXT_SHIFT_CAPPED');
  }
  if (Math.abs(combinedDirectionalShift) <= 1e-9) {
    reasonCodes.push('NO_DIRECTIONAL_CONTEXT_EDGE');
  }

  return {
    version: PAPER_HDA_CONTEXT_ADJUSTMENT_VERSION,
    applied: maximumAbsoluteProbabilityShift > 1e-9,
    probabilities,
    lineupShift,
    headToHeadShift: headToHead.shift,
    combinedDirectionalShift,
    maximumAbsoluteProbabilityShift,
    evidence: {
      homeLineupConfirmed: input.homeLineup.confirmed,
      awayLineupConfirmed: input.awayLineup.confirmed,
      homeMissingRegulars: input.homeLineup.missingRegulars.length,
      awayMissingRegulars: input.awayLineup.missingRegulars.length,
      homeRotationCount: input.homeLineup.rotationCount,
      awayRotationCount: input.awayLineup.rotationCount,
      homeSuspensions: Math.floor(finiteNonNegative(input.homeSuspensions)),
      awaySuspensions: Math.floor(finiteNonNegative(input.awaySuspensions)),
      eligibleHeadToHeadMatches: headToHead.eligibleMatches,
      headToHeadEffectiveWeight: headToHead.effectiveWeight,
    },
    reasonCodes,
  };
}
