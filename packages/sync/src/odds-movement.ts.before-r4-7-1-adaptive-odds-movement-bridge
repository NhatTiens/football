import { clamp, median, removeVig, standardDeviation } from '@football-ai/engine';
import { prisma } from '@football-ai/database';

export const MATCH_WINNER_SELECTIONS = ['HOME', 'DRAW', 'AWAY'] as const;

export type MatchWinnerSelection = (typeof MATCH_WINNER_SELECTIONS)[number];

export type MatchWinnerProbabilities = Record<MatchWinnerSelection, number>;

export interface OddsMovementRow {
  id: number;
  bookmakerId: number;
  bookmakerName: string;
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
}

export interface OddsMovementAuditObservation {
  key: string;
  availableAt: Date;
  metadata: {
    bookmakerId: number;
    bookmakerName: string;
    selectionCode: string;
    role: 'OPENING' | 'RECENT' | 'CURRENT';
  };
}

export interface MatchWinnerOddsMovementAnalysis {
  available: boolean;
  movementAvailable: boolean;
  fixtureId: number;
  predictionAsOf: Date;
  horizonMinutes: number;
  bookmakerCount: number;
  matchedBookmakerCount: number;
  openingConsensus: MatchWinnerProbabilities | null;
  currentConsensus: MatchWinnerProbabilities | null;
  movement: MatchWinnerProbabilities;
  recentMovement: MatchWinnerProbabilities;
  probabilityStddev: MatchWinnerProbabilities;
  averageDispersion: number;
  bookmakerAgreement: number;
  steamMoveDetected: boolean;
  steamDirection: MatchWinnerSelection | 'NONE';
  steamStrength: number;
  lateMove: boolean;
  qualityScore: number;
  observedFrom: Date | null;
  observedTo: Date | null;
  featureNames: readonly string[];
  featureVector: number[];
  auditObservations: OddsMovementAuditObservation[];
  reasons: string[];
}

interface Options {
  minimumBookmakers: number;
  maximumQuoteSpreadMinutes: number;
  steamWindowMinutes: number;
  steamProbabilityThreshold: number;
  steamAgreementThreshold: number;
  maximumDispersion: number;
  lateWindowMinutes: number;
}

interface CompleteMarket {
  bookmakerId: number;
  bookmakerName: string;
  probabilities: MatchWinnerProbabilities;
  quotes: Record<MatchWinnerSelection, OddsMovementRow>;
}

interface DatabaseOddsRow {
  id: number;
  bookmakerId: number;
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
  bookmaker: {
    name: string;
  };
}

const ZERO: MatchWinnerProbabilities = {
  HOME: 0,
  DRAW: 0,
  AWAY: 0,
};

export const ODDS_MOVEMENT_FEATURE_NAMES = [
  'market_open_home',
  'market_open_draw',
  'market_open_away',
  'market_current_home',
  'market_current_draw',
  'market_current_away',
  'market_move_home',
  'market_move_draw',
  'market_move_away',
  'market_recent_move_home',
  'market_recent_move_draw',
  'market_recent_move_away',
  'market_dispersion_home',
  'market_dispersion_draw',
  'market_dispersion_away',
  'market_bookmaker_agreement',
  'market_steam_strength',
  'market_quality',
] as const;

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaults(): Options {
  return {
    minimumBookmakers: Math.max(1, Math.floor(envNumber('ODDS_MOVEMENT_MIN_BOOKMAKERS', 3))),
    maximumQuoteSpreadMinutes: Math.max(0, envNumber('ODDS_MOVEMENT_MAX_QUOTE_SPREAD_MINUTES', 15)),
    steamWindowMinutes: Math.max(1, envNumber('ODDS_MOVEMENT_STEAM_WINDOW_MINUTES', 60)),
    steamProbabilityThreshold: clamp(
      envNumber('ODDS_MOVEMENT_STEAM_PROBABILITY_THRESHOLD', 0.025),
      0.001,
      0.25,
    ),
    steamAgreementThreshold: clamp(
      envNumber('ODDS_MOVEMENT_STEAM_AGREEMENT_THRESHOLD', 0.7),
      0.5,
      1,
    ),
    maximumDispersion: clamp(envNumber('ODDS_MOVEMENT_MAX_DISPERSION', 0.06), 0.005, 0.25),
    lateWindowMinutes: Math.max(1, envNumber('ODDS_MOVEMENT_LATE_WINDOW_MINUTES', 90)),
  };
}

function assertDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
}

function isSelection(value: string): value is MatchWinnerSelection {
  return MATCH_WINNER_SELECTIONS.includes(value as MatchWinnerSelection);
}

function selectQuote(
  rows: readonly OddsMovementRow[],
  selection: MatchWinnerSelection,
  cutoff: Date,
  mode: 'EARLIEST' | 'LATEST',
): OddsMovementRow | null {
  const eligible = rows.filter(
    (row) =>
      row.selectionCode === selection &&
      row.capturedAt.getTime() <= cutoff.getTime() &&
      Number.isFinite(row.decimalOdds) &&
      row.decimalOdds > 1,
  );

  eligible.sort((left, right) => {
    const byTime = left.capturedAt.getTime() - right.capturedAt.getTime();
    const byId = left.id - right.id;
    return mode === 'EARLIEST' ? byTime || byId : -(byTime || byId);
  });

  return eligible[0] ?? null;
}

function completeMarkets(input: {
  rows: readonly OddsMovementRow[];
  cutoff: Date;
  mode: 'EARLIEST' | 'LATEST';
  maximumQuoteSpreadMinutes: number;
}): CompleteMarket[] {
  const grouped = new Map<number, OddsMovementRow[]>();

  for (const row of input.rows) {
    assertDate(row.capturedAt, 'capturedAt');

    if (row.capturedAt.getTime() > input.cutoff.getTime() || !isSelection(row.selectionCode)) {
      continue;
    }

    grouped.set(row.bookmakerId, [...(grouped.get(row.bookmakerId) ?? []), row]);
  }

  const result: CompleteMarket[] = [];

  for (const [bookmakerId, rows] of grouped) {
    const quotes = {} as Record<MatchWinnerSelection, OddsMovementRow>;
    let complete = true;

    for (const selection of MATCH_WINNER_SELECTIONS) {
      const quote = selectQuote(rows, selection, input.cutoff, input.mode);

      if (!quote) {
        complete = false;
        break;
      }

      quotes[selection] = quote;
    }

    if (!complete) continue;

    const timestamps = MATCH_WINNER_SELECTIONS.map((selection) =>
      quotes[selection].capturedAt.getTime(),
    );
    const spreadMinutes = (Math.max(...timestamps) - Math.min(...timestamps)) / 60_000;

    if (spreadMinutes > input.maximumQuoteSpreadMinutes) continue;

    const fair = removeVig(
      MATCH_WINNER_SELECTIONS.map((selection) => ({
        code: selection,
        odds: quotes[selection].decimalOdds,
      })),
    );
    const probabilities = {} as MatchWinnerProbabilities;

    for (const row of fair) {
      if (isSelection(row.code)) {
        probabilities[row.code] = row.fairProbability;
      }
    }

    if (MATCH_WINNER_SELECTIONS.some((selection) => !Number.isFinite(probabilities[selection]))) {
      continue;
    }

    result.push({
      bookmakerId,
      bookmakerName: quotes.HOME.bookmakerName,
      probabilities,
      quotes,
    });
  }

  return result.sort((left, right) => left.bookmakerId - right.bookmakerId);
}

function consensus(markets: readonly CompleteMarket[]): {
  probabilities: MatchWinnerProbabilities;
  dispersion: MatchWinnerProbabilities;
} | null {
  if (markets.length === 0) return null;

  const probabilities = {} as MatchWinnerProbabilities;
  const dispersion = {} as MatchWinnerProbabilities;

  for (const selection of MATCH_WINNER_SELECTIONS) {
    const values = markets.map((market) => market.probabilities[selection]);
    probabilities[selection] = median(values);
    dispersion[selection] = standardDeviation(values);
  }

  const total = MATCH_WINNER_SELECTIONS.reduce(
    (sum, selection) => sum + probabilities[selection],
    0,
  );

  if (!Number.isFinite(total) || total <= 0) return null;

  for (const selection of MATCH_WINNER_SELECTIONS) {
    probabilities[selection] /= total;
  }

  return { probabilities, dispersion };
}

function intersect(
  first: readonly CompleteMarket[],
  second: readonly CompleteMarket[],
): { first: CompleteMarket[]; second: CompleteMarket[] } {
  const secondIds = new Set(second.map((market) => market.bookmakerId));
  const matchedFirst = first.filter((market) => secondIds.has(market.bookmakerId));
  const firstIds = new Set(matchedFirst.map((market) => market.bookmakerId));

  return {
    first: matchedFirst,
    second: second.filter((market) => firstIds.has(market.bookmakerId)),
  };
}

function subtract(
  current: MatchWinnerProbabilities,
  previous: MatchWinnerProbabilities,
): MatchWinnerProbabilities {
  return {
    HOME: current.HOME - previous.HOME,
    DRAW: current.DRAW - previous.DRAW,
    AWAY: current.AWAY - previous.AWAY,
  };
}

function strongest(movement: MatchWinnerProbabilities): {
  direction: MatchWinnerSelection;
  magnitude: number;
} {
  let direction: MatchWinnerSelection = 'HOME';
  let magnitude = Math.abs(movement.HOME);

  for (const selection of MATCH_WINNER_SELECTIONS.slice(1)) {
    const value = Math.abs(movement[selection]);
    if (value > magnitude) {
      direction = selection;
      magnitude = value;
    }
  }

  return { direction, magnitude };
}

function agreement(input: {
  previous: readonly CompleteMarket[];
  current: readonly CompleteMarket[];
  direction: MatchWinnerSelection;
  consensusDelta: number;
}): number {
  if (Math.abs(input.consensusDelta) < 0.0005) return 0;

  const previousById = new Map(input.previous.map((market) => [market.bookmakerId, market]));
  const expectedSign = Math.sign(input.consensusDelta);
  let total = 0;
  let aligned = 0;

  for (const current of input.current) {
    const previous = previousById.get(current.bookmakerId);
    if (!previous) continue;

    const delta = current.probabilities[input.direction] - previous.probabilities[input.direction];

    total += 1;
    if (Math.abs(delta) >= 0.0005 && Math.sign(delta) === expectedSign) {
      aligned += 1;
    }
  }

  return total === 0 ? 0 : aligned / total;
}

function observations(
  groups: Array<{
    role: 'OPENING' | 'RECENT' | 'CURRENT';
    markets: readonly CompleteMarket[];
  }>,
): OddsMovementAuditObservation[] {
  const unique = new Map<string, OddsMovementAuditObservation>();

  for (const group of groups) {
    for (const market of group.markets) {
      for (const selection of MATCH_WINNER_SELECTIONS) {
        const quote = market.quotes[selection];
        unique.set(`${group.role}:${quote.id}`, {
          key: `odds:${quote.id}`,
          availableAt: new Date(quote.capturedAt),
          metadata: {
            bookmakerId: quote.bookmakerId,
            bookmakerName: quote.bookmakerName,
            selectionCode: selection,
            role: group.role,
          },
        });
      }
    }
  }

  return [...unique.values()].sort(
    (left, right) => left.availableAt.getTime() - right.availableAt.getTime(),
  );
}

function empty(input: {
  fixtureId: number;
  kickoffAt: Date;
  predictionAsOf: Date;
  reasons: string[];
  bookmakerCount?: number;
  auditObservations?: OddsMovementAuditObservation[];
}): MatchWinnerOddsMovementAnalysis {
  const horizonMinutes = Math.max(
    0,
    Math.round((input.kickoffAt.getTime() - input.predictionAsOf.getTime()) / 60_000),
  );

  return {
    available: false,
    movementAvailable: false,
    fixtureId: input.fixtureId,
    predictionAsOf: new Date(input.predictionAsOf),
    horizonMinutes,
    bookmakerCount: input.bookmakerCount ?? 0,
    matchedBookmakerCount: 0,
    openingConsensus: null,
    currentConsensus: null,
    movement: { ...ZERO },
    recentMovement: { ...ZERO },
    probabilityStddev: { ...ZERO },
    averageDispersion: 0,
    bookmakerAgreement: 0,
    steamMoveDetected: false,
    steamDirection: 'NONE',
    steamStrength: 0,
    lateMove: false,
    qualityScore: 0,
    observedFrom: null,
    observedTo: null,
    featureNames: ODDS_MOVEMENT_FEATURE_NAMES,
    featureVector: new Array(ODDS_MOVEMENT_FEATURE_NAMES.length).fill(0),
    auditObservations: input.auditObservations ?? [],
    reasons: input.reasons,
  };
}

export function analyzeMatchWinnerOddsMovement(input: {
  fixtureId: number;
  kickoffAt: Date;
  predictionAsOf: Date;
  rows: readonly OddsMovementRow[];
  options?: Partial<Options>;
}): MatchWinnerOddsMovementAnalysis {
  assertDate(input.kickoffAt, 'kickoffAt');
  assertDate(input.predictionAsOf, 'predictionAsOf');

  if (input.predictionAsOf.getTime() > input.kickoffAt.getTime()) {
    throw new RangeError('predictionAsOf cannot be after kickoffAt.');
  }

  const options: Options = {
    ...defaults(),
    ...input.options,
  };
  const eligible = input.rows.filter(
    (row) =>
      row.capturedAt.getTime() <= input.predictionAsOf.getTime() &&
      isSelection(row.selectionCode) &&
      Number.isFinite(row.decimalOdds) &&
      row.decimalOdds > 1,
  );

  if (eligible.length === 0) {
    return empty({
      fixtureId: input.fixtureId,
      kickoffAt: input.kickoffAt,
      predictionAsOf: input.predictionAsOf,
      reasons: ['Chưa có odds 1X2 point-in-time trước thời điểm dự đoán.'],
    });
  }

  const openingMarkets = completeMarkets({
    rows: eligible,
    cutoff: input.predictionAsOf,
    mode: 'EARLIEST',
    maximumQuoteSpreadMinutes: options.maximumQuoteSpreadMinutes,
  });
  const currentMarkets = completeMarkets({
    rows: eligible,
    cutoff: input.predictionAsOf,
    mode: 'LATEST',
    maximumQuoteSpreadMinutes: options.maximumQuoteSpreadMinutes,
  });
  const recentCutoff = new Date(
    input.predictionAsOf.getTime() - options.steamWindowMinutes * 60_000,
  );
  const recentMarkets = completeMarkets({
    rows: eligible,
    cutoff: recentCutoff,
    mode: 'LATEST',
    maximumQuoteSpreadMinutes: options.maximumQuoteSpreadMinutes,
  });
  const current = consensus(currentMarkets);

  if (!current || currentMarkets.length < options.minimumBookmakers) {
    return empty({
      fixtureId: input.fixtureId,
      kickoffAt: input.kickoffAt,
      predictionAsOf: input.predictionAsOf,
      bookmakerCount: currentMarkets.length,
      auditObservations: observations([{ role: 'CURRENT', markets: currentMarkets }]),
      reasons: [
        `Odds 1X2 chỉ có ${currentMarkets.length} nhà cái đầy đủ; cần tối thiểu ${options.minimumBookmakers}.`,
      ],
    });
  }

  const openingCurrent = intersect(openingMarkets, currentMarkets);
  const openingMatched = consensus(openingCurrent.first);
  const currentOpeningMatched = consensus(openingCurrent.second);
  const movementAvailable =
    openingCurrent.first.length >= options.minimumBookmakers &&
    openingMatched != null &&
    currentOpeningMatched != null;
  const movement = movementAvailable
    ? subtract(currentOpeningMatched.probabilities, openingMatched.probabilities)
    : { ...ZERO };

  const recentCurrent = intersect(recentMarkets, currentMarkets);
  const recentMatched = consensus(recentCurrent.first);
  const currentRecentMatched = consensus(recentCurrent.second);
  const recentMovement =
    recentMatched && currentRecentMatched
      ? subtract(currentRecentMatched.probabilities, recentMatched.probabilities)
      : { ...ZERO };

  const steamCandidate = strongest(recentMovement);
  const bookmakerAgreement =
    recentMatched && currentRecentMatched
      ? agreement({
          previous: recentCurrent.first,
          current: recentCurrent.second,
          direction: steamCandidate.direction,
          consensusDelta: recentMovement[steamCandidate.direction],
        })
      : 0;
  const steamMoveDetected =
    recentCurrent.first.length >= options.minimumBookmakers &&
    steamCandidate.magnitude >= options.steamProbabilityThreshold &&
    bookmakerAgreement >= options.steamAgreementThreshold;
  const averageDispersion =
    MATCH_WINNER_SELECTIONS.reduce((sum, selection) => sum + current.dispersion[selection], 0) /
    MATCH_WINNER_SELECTIONS.length;
  const coverageScore = clamp(currentMarkets.length / 8, 0, 1);
  const dispersionScore = clamp(
    1 - averageDispersion / Math.max(options.maximumDispersion, 0.001),
    0,
    1,
  );
  const matchedScore = clamp(
    openingCurrent.first.length / Math.max(currentMarkets.length, options.minimumBookmakers),
    0,
    1,
  );
  const currentTimes = currentMarkets.flatMap((market) =>
    MATCH_WINNER_SELECTIONS.map((selection) => market.quotes[selection].capturedAt.getTime()),
  );
  const observedFrom = new Date(Math.min(...eligible.map((row) => row.capturedAt.getTime())));
  const observedTo = new Date(Math.max(...currentTimes));
  const freshnessMinutes = Math.max(
    0,
    (input.predictionAsOf.getTime() - observedTo.getTime()) / 60_000,
  );
  const freshnessScore = clamp(
    1 - freshnessMinutes / Math.max(options.steamWindowMinutes * 2, 30),
    0,
    1,
  );
  const qualityScore = clamp(
    coverageScore * 0.35 + dispersionScore * 0.3 + matchedScore * 0.2 + freshnessScore * 0.15,
    0,
    1,
  );
  const steamStrength = steamMoveDetected
    ? clamp(
        (steamCandidate.magnitude / options.steamProbabilityThreshold) * 0.45 +
          bookmakerAgreement * 0.35 +
          coverageScore * 0.2,
        0,
        1,
      )
    : clamp(
        (steamCandidate.magnitude / options.steamProbabilityThreshold) * 0.15 +
          bookmakerAgreement * 0.1,
        0,
        0.45,
      );
  const horizonMinutes = Math.max(
    0,
    Math.round((input.kickoffAt.getTime() - input.predictionAsOf.getTime()) / 60_000),
  );
  const lateMove =
    horizonMinutes <= options.lateWindowMinutes &&
    steamCandidate.magnitude >= options.steamProbabilityThreshold;
  const openingConsensus =
    openingMatched?.probabilities ?? consensus(openingMarkets)?.probabilities ?? null;
  const currentConsensus = current.probabilities;
  const featureVector = [
    openingConsensus?.HOME ?? 0,
    openingConsensus?.DRAW ?? 0,
    openingConsensus?.AWAY ?? 0,
    currentConsensus.HOME,
    currentConsensus.DRAW,
    currentConsensus.AWAY,
    movement.HOME,
    movement.DRAW,
    movement.AWAY,
    recentMovement.HOME,
    recentMovement.DRAW,
    recentMovement.AWAY,
    current.dispersion.HOME,
    current.dispersion.DRAW,
    current.dispersion.AWAY,
    bookmakerAgreement,
    steamStrength,
    qualityScore,
  ];

  return {
    available: true,
    movementAvailable,
    fixtureId: input.fixtureId,
    predictionAsOf: new Date(input.predictionAsOf),
    horizonMinutes,
    bookmakerCount: currentMarkets.length,
    matchedBookmakerCount: openingCurrent.first.length,
    openingConsensus,
    currentConsensus,
    movement,
    recentMovement,
    probabilityStddev: current.dispersion,
    averageDispersion,
    bookmakerAgreement,
    steamMoveDetected,
    steamDirection: steamMoveDetected ? steamCandidate.direction : 'NONE',
    steamStrength,
    lateMove,
    qualityScore,
    observedFrom,
    observedTo,
    featureNames: ODDS_MOVEMENT_FEATURE_NAMES,
    featureVector,
    auditObservations: observations([
      { role: 'OPENING', markets: openingCurrent.first },
      { role: 'RECENT', markets: recentCurrent.first },
      { role: 'CURRENT', markets: currentMarkets },
    ]),
    reasons: [
      `Consensus 1X2 từ ${currentMarkets.length} nhà cái: HOME ${(currentConsensus.HOME * 100).toFixed(1)}%, DRAW ${(currentConsensus.DRAW * 100).toFixed(1)}%, AWAY ${(currentConsensus.AWAY * 100).toFixed(1)}%.`,
      movementAvailable
        ? `Biến động từ opening: HOME ${(movement.HOME * 100).toFixed(1)} điểm %, DRAW ${(movement.DRAW * 100).toFixed(1)} điểm %, AWAY ${(movement.AWAY * 100).toFixed(1)} điểm %.`
        : 'Chưa đủ opening/current trùng nhà cái để tính movement đáng tin cậy.',
      `Độ phân tán trung bình ${(averageDispersion * 100).toFixed(2)} điểm %, đồng thuận hướng ${(bookmakerAgreement * 100).toFixed(0)}%.`,
      steamMoveDetected
        ? `Phát hiện steam move hướng ${steamCandidate.direction}, strength ${steamStrength.toFixed(2)}.`
        : 'Không phát hiện steam move đạt ngưỡng.',
    ],
  };
}

export async function getMatchWinnerOddsMovement(input: {
  fixtureId: number;
  kickoffAt: Date;
  predictionAsOf: Date;
}): Promise<MatchWinnerOddsMovementAnalysis> {
  const market = await prisma.bettingMarket.findUnique({
    where: { marketCode: 'MATCH_WINNER' },
    select: { id: true },
  });

  if (!market) {
    return empty({
      ...input,
      reasons: ['Chưa có market MATCH_WINNER trong database.'],
    });
  }

  const rows = (await prisma.oddsSnapshot.findMany({
    where: {
      fixtureId: input.fixtureId,
      marketId: market.id,
      isLive: false,
      capturedAt: { lte: input.predictionAsOf },
    },
    select: {
      id: true,
      bookmakerId: true,
      selectionCode: true,
      decimalOdds: true,
      capturedAt: true,
      bookmaker: { select: { name: true } },
    },
    orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
  })) as DatabaseOddsRow[];

  return analyzeMatchWinnerOddsMovement({
    ...input,
    rows: rows.map((row: DatabaseOddsRow) => ({
      id: row.id,
      bookmakerId: row.bookmakerId,
      bookmakerName: row.bookmaker.name,
      selectionCode: row.selectionCode,
      decimalOdds: row.decimalOdds,
      capturedAt: row.capturedAt,
    })),
  });
}
