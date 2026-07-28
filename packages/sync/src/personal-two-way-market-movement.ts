import { prisma } from '@football-ai/database';

export type PersonalTwoWayMovementCode =
  | 'BTTS'
  | 'OVER_UNDER_1_5'
  | 'OVER_UNDER_2_5'
  | 'OVER_UNDER_3_5';

export type PersonalTwoWayMovementSelection =
  | 'YES'
  | 'NO'
  | 'OVER'
  | 'UNDER';

export interface PersonalTwoWayMovementSelectionSummary {
  code: PersonalTwoWayMovementSelection;
  openingProbability: number | null;
  currentProbability: number | null;
  movement: number | null;
  recentMovement: number | null;
}

export interface PersonalTwoWayMarketMovementSummary {
  source: 'API_FOOTBALL_PIT_SNAPSHOT';
  code: PersonalTwoWayMovementCode;
  label: string;
  providerMarketType: 'BTTS' | 'TOTAL_GOALS';
  lineValue: number | null;
  available: boolean;
  movementAvailable: boolean;
  bookmakerCount: number;
  matchedBookmakerCount: number;
  recentMatchedBookmakerCount: number;
  selections: PersonalTwoWayMovementSelectionSummary[];
  steamMoveDetected: boolean;
  steamDirection: PersonalTwoWayMovementSelection | 'NONE';
  steamStrength: number;
  bookmakerAgreement: number;
  lateMove: boolean;
  qualityScore: number;
  observedFrom: string | null;
  observedTo: string | null;
  reasons: string[];
}

interface FixtureInput {
  providerFixtureId: number;
  kickoffAt: Date;
}

interface ApiOddsRow {
  id: number;
  providerFixtureId: number;
  bookmakerId: number;
  bookmakerName: string;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  observedAt: Date;
  sourceUpdatedAt: Date | null;
}

interface MovementDefinition {
  code: PersonalTwoWayMovementCode;
  label: string;
  providerMarketType: 'BTTS' | 'TOTAL_GOALS';
  lineValue: number | null;
  firstSelection: PersonalTwoWayMovementSelection;
  secondSelection: PersonalTwoWayMovementSelection;
}

interface CompleteState {
  bookmakerId: number;
  bookmakerName: string;
  capturedAt: Date;
  firstOdds: number;
  secondOdds: number;
}

interface FairState {
  bookmakerId: number;
  bookmakerName: string;
  capturedAt: Date;
  firstProbability: number;
  secondProbability: number;
}

const DEFINITIONS: MovementDefinition[] = [
  {
    code: 'BTTS',
    label: 'BTTS',
    providerMarketType: 'BTTS',
    lineValue: null,
    firstSelection: 'YES',
    secondSelection: 'NO',
  },
  {
    code: 'OVER_UNDER_1_5',
    label: 'Over / Under 1.5',
    providerMarketType: 'TOTAL_GOALS',
    lineValue: 1.5,
    firstSelection: 'OVER',
    secondSelection: 'UNDER',
  },
  {
    code: 'OVER_UNDER_2_5',
    label: 'Over / Under 2.5',
    providerMarketType: 'TOTAL_GOALS',
    lineValue: 2.5,
    firstSelection: 'OVER',
    secondSelection: 'UNDER',
  },
  {
    code: 'OVER_UNDER_3_5',
    label: 'Over / Under 3.5',
    providerMarketType: 'TOTAL_GOALS',
    lineValue: 3.5,
    firstSelection: 'OVER',
    secondSelection: 'UNDER',
  },
];

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function numberEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function sameLine(
  left: number | null,
  right: number | null,
): boolean {
  if (left == null || right == null) {
    return left == null && right == null;
  }

  return Math.abs(left - right) < 0.000_001;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return (
    values.reduce(
      (sum: number, value: number): number => sum + value,
      0,
    ) / values.length
  );
}

function fairState(state: CompleteState): FairState | null {
  if (
    !Number.isFinite(state.firstOdds) ||
    !Number.isFinite(state.secondOdds) ||
    state.firstOdds <= 1 ||
    state.secondOdds <= 1
  ) {
    return null;
  }

  const firstInverse = 1 / state.firstOdds;
  const secondInverse = 1 / state.secondOdds;
  const denominator = firstInverse + secondInverse;

  if (
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return {
    bookmakerId: state.bookmakerId,
    bookmakerName: state.bookmakerName,
    capturedAt: state.capturedAt,
    firstProbability: firstInverse / denominator,
    secondProbability: secondInverse / denominator,
  };
}

function consensus(
  states: FairState[],
): {
  firstProbability: number;
  secondProbability: number;
} | null {
  const firstProbability = average(
    states.map(
      (state: FairState): number =>
        state.firstProbability,
    ),
  );
  const secondProbability = average(
    states.map(
      (state: FairState): number =>
        state.secondProbability,
    ),
  );

  if (
    firstProbability == null ||
    secondProbability == null
  ) {
    return null;
  }

  return {
    firstProbability,
    secondProbability,
  };
}

function rowsForDefinition(
  rows: ApiOddsRow[],
  definition: MovementDefinition,
): ApiOddsRow[] {
  return rows.filter(
    (row: ApiOddsRow): boolean =>
      row.marketType === definition.providerMarketType &&
      sameLine(row.lineValue, definition.lineValue) &&
      (
        row.selection === definition.firstSelection ||
        row.selection === definition.secondSelection
      ),
  );
}

function buildCompleteStates(
  rows: ApiOddsRow[],
  definition: MovementDefinition,
): Map<number, CompleteState[]> {
  interface StateBuilder {
    bookmakerId: number;
    bookmakerName: string;
    capturedAt: Date;
    firstOdds: number | null;
    secondOdds: number | null;
  }

  const builders = new Map<string, StateBuilder>();

  for (const row of rows) {
    const capturedAt =
      row.sourceUpdatedAt ?? row.observedAt;

    const key = [
      row.bookmakerId,
      capturedAt.toISOString(),
    ].join('|');

    const builder: StateBuilder =
      builders.get(key) ?? {
        bookmakerId: row.bookmakerId,
        bookmakerName: row.bookmakerName,
        capturedAt,
        firstOdds: null,
        secondOdds: null,
      };

    if (row.selection === definition.firstSelection) {
      builder.firstOdds = row.decimalOdds;
    }

    if (row.selection === definition.secondSelection) {
      builder.secondOdds = row.decimalOdds;
    }

    builders.set(key, builder);
  }

  const byBookmaker = new Map<number, CompleteState[]>();

  for (const builder of builders.values()) {
    if (
      builder.firstOdds == null ||
      builder.secondOdds == null
    ) {
      continue;
    }

    const state: CompleteState = {
      bookmakerId: builder.bookmakerId,
      bookmakerName: builder.bookmakerName,
      capturedAt: builder.capturedAt,
      firstOdds: builder.firstOdds,
      secondOdds: builder.secondOdds,
    };

    byBookmaker.set(
      state.bookmakerId,
      [
        ...(byBookmaker.get(state.bookmakerId) ?? []),
        state,
      ],
    );
  }

  for (const [bookmakerId, states] of byBookmaker) {
    const ordered = states
      .slice()
      .sort(
        (
          left: CompleteState,
          right: CompleteState,
        ): number =>
          left.capturedAt.getTime() -
          right.capturedAt.getTime(),
      );

    // Same provider version can be observed more than once.
    // Keep one complete state per provider-version timestamp.
    const deduped: CompleteState[] = [];
    let previousTimestamp: number | null = null;

    for (const state of ordered) {
      const timestamp = state.capturedAt.getTime();

      if (timestamp === previousTimestamp) {
        deduped[deduped.length - 1] = state;
      } else {
        deduped.push(state);
        previousTimestamp = timestamp;
      }
    }

    byBookmaker.set(bookmakerId, deduped);
  }

  return byBookmaker;
}

function analyzeDefinition(input: {
  rows: ApiOddsRow[];
  definition: MovementDefinition;
  kickoffAt: Date;
  predictionAsOf: Date;
  minimumBookmakers: number;
  steamThreshold: number;
  steamAgreement: number;
  recentMinutes: number;
}): PersonalTwoWayMarketMovementSummary {
  const marketRows = rowsForDefinition(
    input.rows,
    input.definition,
  );

  const statesByBookmaker = buildCompleteStates(
    marketRows,
    input.definition,
  );

  const latestStates: FairState[] = [];
  const movementPairs: Array<{
    opening: FairState;
    current: FairState;
  }> = [];

  for (const states of statesByBookmaker.values()) {
    const fairStates = states
      .map(fairState)
      .filter(
        (state: FairState | null): state is FairState =>
          state != null,
      );

    if (fairStates.length === 0) {
      continue;
    }

    const current = fairStates[fairStates.length - 1];

    if (current == null) {
      continue;
    }

    latestStates.push(current);

    const opening = fairStates[0];

    if (
      opening != null &&
      opening.capturedAt.getTime() <
        current.capturedAt.getTime()
    ) {
      movementPairs.push({
        opening,
        current,
      });
    }
  }

  const currentConsensus = consensus(latestStates);
  const available =
    currentConsensus != null &&
    latestStates.length >= input.minimumBookmakers;

  const movementOpeningStates = movementPairs.map(
    (pair): FairState => pair.opening,
  );
  const movementCurrentStates = movementPairs.map(
    (pair): FairState => pair.current,
  );

  const openingConsensus = consensus(
    movementOpeningStates,
  );
  const matchedCurrentConsensus = consensus(
    movementCurrentStates,
  );

  const movementAvailable =
    openingConsensus != null &&
    matchedCurrentConsensus != null &&
    movementPairs.length >= input.minimumBookmakers;

  const firstMovement =
    movementAvailable
      ? matchedCurrentConsensus.firstProbability -
        openingConsensus.firstProbability
      : null;

  const secondMovement =
    movementAvailable
      ? matchedCurrentConsensus.secondProbability -
        openingConsensus.secondProbability
      : null;

  const latestTimestamp =
    latestStates.length === 0
      ? null
      : Math.max(
          ...latestStates.map(
            (state: FairState): number =>
              state.capturedAt.getTime(),
          ),
        );

  const recentCutoff =
    latestTimestamp == null
      ? null
      : latestTimestamp -
        input.recentMinutes * 60_000;

  const recentOpeningStates: FairState[] = [];
  const recentCurrentStates: FairState[] = [];

  if (recentCutoff != null) {
    for (const states of statesByBookmaker.values()) {
      const fairStates = states
        .map(fairState)
        .filter(
          (state: FairState | null): state is FairState =>
            state != null,
        );

      const current = fairStates[fairStates.length - 1];

      if (current == null) {
        continue;
      }

      const previous = fairStates
        .filter(
          (state: FairState): boolean =>
            state.capturedAt.getTime() <= recentCutoff,
        )
        .slice(-1)[0];

      if (previous == null) {
        continue;
      }

      recentOpeningStates.push(previous);
      recentCurrentStates.push(current);
    }
  }

  const recentOpeningConsensus =
    recentOpeningStates.length >= input.minimumBookmakers
      ? consensus(recentOpeningStates)
      : null;

  const recentCurrentConsensus =
    recentCurrentStates.length >= input.minimumBookmakers
      ? consensus(recentCurrentStates)
      : null;

  const recentFirstMovement =
    recentOpeningConsensus != null &&
    recentCurrentConsensus != null
      ? recentCurrentConsensus.firstProbability -
        recentOpeningConsensus.firstProbability
      : null;

  const recentSecondMovement =
    recentOpeningConsensus != null &&
    recentCurrentConsensus != null
      ? recentCurrentConsensus.secondProbability -
        recentOpeningConsensus.secondProbability
      : null;

  let steamDirection:
    | PersonalTwoWayMovementSelection
    | 'NONE' = 'NONE';

  let consensusSteamMovement = 0;

  if (
    firstMovement != null &&
    secondMovement != null
  ) {
    if (
      Math.abs(firstMovement) >=
      Math.abs(secondMovement)
    ) {
      steamDirection =
        firstMovement > 0
          ? input.definition.firstSelection
          : input.definition.secondSelection;
      consensusSteamMovement = Math.abs(firstMovement);
    } else {
      steamDirection =
        secondMovement > 0
          ? input.definition.secondSelection
          : input.definition.firstSelection;
      consensusSteamMovement = Math.abs(secondMovement);
    }
  }

  const bookmakerDirections =
    movementPairs.map((pair): number => {
      const firstDelta =
        pair.current.firstProbability -
        pair.opening.firstProbability;

      if (
        steamDirection === input.definition.firstSelection
      ) {
        return firstDelta;
      }

      if (
        steamDirection === input.definition.secondSelection
      ) {
        return -firstDelta;
      }

      return 0;
    });

  const agreeingBookmakers =
    bookmakerDirections.filter(
      (movement: number): boolean =>
        movement >= 0.005,
    ).length;

  const bookmakerAgreement =
    bookmakerDirections.length === 0
      ? 0
      : agreeingBookmakers /
        bookmakerDirections.length;

  const steamMoveDetected =
    movementAvailable &&
    steamDirection !== 'NONE' &&
    consensusSteamMovement >=
      input.steamThreshold &&
    bookmakerAgreement >=
      input.steamAgreement;

  const steamStrength = steamMoveDetected
    ? clamp01(
        (
          Math.min(
            1,
            consensusSteamMovement /
              Math.max(
                input.steamThreshold * 2,
                0.001,
              ),
          ) *
            0.65
        ) +
          bookmakerAgreement * 0.35,
      )
    : 0;

  const minutesToKickoff =
    (
      input.kickoffAt.getTime() -
      input.predictionAsOf.getTime()
    ) /
    60_000;

  const recentMagnitude = Math.max(
    Math.abs(recentFirstMovement ?? 0),
    Math.abs(recentSecondMovement ?? 0),
  );

  const lateMove =
    minutesToKickoff >= 0 &&
    minutesToKickoff <= 90 &&
    recentMagnitude >= 0.015;

  const bookmakerCoverageScore = clamp01(
    latestStates.length /
      Math.max(input.minimumBookmakers * 2, 1),
  );

  const repeatedCoverageScore = clamp01(
    movementPairs.length /
      Math.max(input.minimumBookmakers * 2, 1),
  );

  const recencyHours =
    latestTimestamp == null
      ? Number.POSITIVE_INFINITY
      : Math.max(
          0,
          (
            input.predictionAsOf.getTime() -
            latestTimestamp
          ) /
            3_600_000,
        );

  const recencyScore = Number.isFinite(recencyHours)
    ? clamp01(1 - recencyHours / 12)
    : 0;

  const qualityScore = clamp01(
    bookmakerCoverageScore * 0.45 +
      repeatedCoverageScore * 0.35 +
      recencyScore * 0.2,
  );

  const observedFrom =
    movementOpeningStates.length > 0
      ? new Date(
          Math.min(
            ...movementOpeningStates.map(
              (state: FairState): number =>
                state.capturedAt.getTime(),
            ),
          ),
        ).toISOString()
      : latestStates.length > 0
        ? new Date(
            Math.min(
              ...latestStates.map(
                (state: FairState): number =>
                  state.capturedAt.getTime(),
              ),
            ),
          ).toISOString()
        : null;

  const observedTo =
    latestTimestamp == null
      ? null
      : new Date(latestTimestamp).toISOString();

  const reasons: string[] = [];

  if (!available) {
    reasons.push(
      `Chưa đủ ${input.minimumBookmakers} nhà cái có market 2 cửa hoàn chỉnh.`,
    );
  }

  if (
    available &&
    !movementAvailable
  ) {
    reasons.push(
      'Đã có current consensus nhưng chưa đủ bookmaker có ít nhất 2 provider-version để tính Opening → Current.',
    );
  }

  if (movementAvailable) {
    reasons.push(
      `Opening → Current dùng cùng ${movementPairs.length} bookmaker để tránh composition bias.`,
    );
  }

  if (
    recentFirstMovement == null ||
    recentSecondMovement == null
  ) {
    reasons.push(
      `Chưa đủ snapshot để tính movement ${input.recentMinutes} phút.`,
    );
  }

  if (steamMoveDetected) {
    reasons.push(
      `Steam ${steamDirection}: consensus move ${(consensusSteamMovement * 100).toFixed(2)}đ%, bookmaker agreement ${(bookmakerAgreement * 100).toFixed(1)}%.`,
    );
  }

  return {
    source: 'API_FOOTBALL_PIT_SNAPSHOT',
    code: input.definition.code,
    label: input.definition.label,
    providerMarketType:
      input.definition.providerMarketType,
    lineValue: input.definition.lineValue,
    available,
    movementAvailable,
    bookmakerCount: latestStates.length,
    matchedBookmakerCount: movementPairs.length,
    recentMatchedBookmakerCount:
      recentOpeningStates.length,
    selections: [
      {
        code: input.definition.firstSelection,
        openingProbability:
          movementAvailable
            ? openingConsensus.firstProbability
            : null,
        currentProbability:
          available
            ? currentConsensus.firstProbability
            : null,
        movement: firstMovement,
        recentMovement: recentFirstMovement,
      },
      {
        code: input.definition.secondSelection,
        openingProbability:
          movementAvailable
            ? openingConsensus.secondProbability
            : null,
        currentProbability:
          available
            ? currentConsensus.secondProbability
            : null,
        movement: secondMovement,
        recentMovement: recentSecondMovement,
      },
    ],
    steamMoveDetected,
    steamDirection:
      steamMoveDetected ? steamDirection : 'NONE',
    steamStrength,
    bookmakerAgreement,
    lateMove,
    qualityScore,
    observedFrom,
    observedTo,
    reasons,
  };
}

export async function getPersonalTwoWayMarketMovements(input: {
  fixtures: FixtureInput[];
  predictionAsOf: Date;
}): Promise<
  Map<number, PersonalTwoWayMarketMovementSummary[]>
> {
  const result = new Map<
    number,
    PersonalTwoWayMarketMovementSummary[]
  >();

  if (input.fixtures.length === 0) {
    return result;
  }

  const minimumBookmakers = integerEnv(
    'MULTIMARKET_MOVEMENT_MIN_BOOKMAKERS',
    3,
    1,
    20,
  );

  const steamThreshold = numberEnv(
    'MULTIMARKET_MOVEMENT_STEAM_THRESHOLD',
    0.025,
    0.001,
    0.25,
  );

  const steamAgreement = numberEnv(
    'MULTIMARKET_MOVEMENT_STEAM_AGREEMENT',
    0.65,
    0.5,
    1,
  );

  const recentMinutes = integerEnv(
    'MULTIMARKET_MOVEMENT_RECENT_MINUTES',
    60,
    15,
    360,
  );

  const providerFixtureIds =
    input.fixtures.map(
      (fixture: FixtureInput): number =>
        fixture.providerFixtureId,
    );

  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: {
      providerFixtureId: {
        in: providerFixtureIds,
      },
      marketType: {
        in: ['BTTS', 'TOTAL_GOALS'],
      },
      selection: {
        in: ['YES', 'NO', 'OVER', 'UNDER'],
      },
      pitUsable: true,
      observedAt: {
        lte: input.predictionAsOf,
      },
      OR: [
        { sourceUpdatedAt: null },
        {
          sourceUpdatedAt: {
            lte: input.predictionAsOf,
          },
        },
      ],
    },
    select: {
      id: true,
      providerFixtureId: true,
      bookmakerId: true,
      bookmakerName: true,
      marketType: true,
      selection: true,
      lineValue: true,
      decimalOdds: true,
      observedAt: true,
      sourceUpdatedAt: true,
    },
    orderBy: [
      { providerFixtureId: 'asc' },
      { observedAt: 'asc' },
      { id: 'asc' },
    ],
    take: 50_000,
  })) as ApiOddsRow[];

  const rowsByFixture =
    new Map<number, ApiOddsRow[]>();

  for (const row of rows) {
    rowsByFixture.set(
      row.providerFixtureId,
      [
        ...(rowsByFixture.get(
          row.providerFixtureId,
        ) ?? []),
        row,
      ],
    );
  }

  for (const fixture of input.fixtures) {
    const fixtureRows =
      rowsByFixture.get(
        fixture.providerFixtureId,
      ) ?? [];

    const summaries =
      DEFINITIONS.map(
        (
          definition: MovementDefinition,
        ): PersonalTwoWayMarketMovementSummary =>
          analyzeDefinition({
            rows: fixtureRows,
            definition,
            kickoffAt: fixture.kickoffAt,
            predictionAsOf: input.predictionAsOf,
            minimumBookmakers,
            steamThreshold,
            steamAgreement,
            recentMinutes,
          }),
      );

    result.set(
      fixture.providerFixtureId,
      summaries,
    );
  }

  return result;
}
