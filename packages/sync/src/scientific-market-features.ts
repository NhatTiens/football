// PREDICTION_AI_V7_MARKET_FEATURES
// ----------------------------------------------------------------------------
// Point-in-time market features for the scientific model.
//
// The market is the strongest single source of predictive information in
// football. v6 used odds only AFTER model probabilities were computed (edge
// against market). v7 feeds the market consensus, its movement and freshness
// INTO the model as first-class features, plus the stacking meta-learner gets
// the market as one of its component models.
//
// Everything here is append-only and PIT-safe: only odds snapshots captured
// at or before `predictionAsOf` are eligible, live odds are excluded, and each
// bookmaker contributes its latest quote per selection.
import { clamp, median, removeVig } from '@football-ai/engine';

export const MARKET_FEATURE_1X2_SELECTIONS = ['HOME', 'DRAW', 'AWAY'] as const;
export const MARKET_FEATURE_BINARY_SELECTIONS = ['YES', 'NO'] as const;

export interface MarketOddsRow {
  bookmakerId: number;
  marketCode: string;
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
}

export interface MarketFeatureSet {
  available: boolean;
  /** Median no-vig 1X2 consensus from complete bookmaker markets. */
  homeConsensus: number | null;
  drawConsensus: number | null;
  awayConsensus: number | null;
  /** Median no-vig OVER 2.5 consensus. */
  over25Consensus: number | null;
  /** Median no-vig BTTS YES consensus. */
  bttsYesConsensus: number | null;
  /** 1X2 movement: current consensus minus opening consensus (per selection). */
  homeMovement: number | null;
  drawMovement: number | null;
  awayMovement: number | null;
  /** O/U movement: current OVER consensus minus opening OVER consensus. */
  over25Movement: number | null;
  /** Age of the newest snapshot used, in hours. */
  oddsAgeHours: number | null;
  /** Number of bookmakers that contributed a complete market. */
  bookmakerCount: number | null;
  /** Quality of the market signal on [0,1]. */
  qualityScore: number;
}

const EMPTY: MarketFeatureSet = {
  available: false,
  homeConsensus: null,
  drawConsensus: null,
  awayConsensus: null,
  over25Consensus: null,
  bttsYesConsensus: null,
  homeMovement: null,
  drawMovement: null,
  awayMovement: null,
  over25Movement: null,
  oddsAgeHours: null,
  bookmakerCount: null,
  qualityScore: 0,
};

export function emptyMarketFeatureSet(): MarketFeatureSet {
  return { ...EMPTY };
}

interface CompleteMarket {
  bookmakerId: number;
  fairProbabilities: Record<string, number>;
  ageHours: number;
}

function requiredSelections(marketCode: string): readonly string[] {
  if (marketCode === 'MATCH_WINNER') return MARKET_FEATURE_1X2_SELECTIONS;
  if (marketCode === 'TOTAL_GOALS_2_5') return ['OVER', 'UNDER'] as const;
  return MARKET_FEATURE_BINARY_SELECTIONS; // BTTS
}

function completeMarkets(
  rows: MarketOddsRow[],
  marketCode: string,
  asOf: Date,
  maximumAgeHours: number,
): CompleteMarket[] {
  const required = requiredSelections(marketCode);
  const byBookmaker = new Map<number, MarketOddsRow[]>();
  for (const row of rows) {
    if (row.marketCode !== marketCode) continue;
    if (!required.includes(row.selectionCode as never)) continue;
    if (!Number.isFinite(row.decimalOdds) || row.decimalOdds <= 1) continue;
    if (row.capturedAt.getTime() > asOf.getTime()) continue;
    const existing = byBookmaker.get(row.bookmakerId) ?? [];
    byBookmaker.set(row.bookmakerId, [...existing, row]);
  }

  const result: CompleteMarket[] = [];
  for (const quotes of byBookmaker.values()) {
    const latest = new Map<string, MarketOddsRow>();
    for (const selection of required) {
      let best: MarketOddsRow | null = null;
      for (const row of quotes) {
        if (row.selectionCode !== selection) continue;
        if (best == null || row.capturedAt.getTime() > best.capturedAt.getTime()) {
          best = row;
        }
      }
      if (best) latest.set(selection, best);
    }
    if (latest.size !== required.length) continue;
    const ageHours = Math.max(
      0,
      (asOf.getTime() - Math.max(...[...latest.values()].map((row) => row.capturedAt.getTime()))) /
        3_600_000,
    );
    if (ageHours > maximumAgeHours) continue;
    const fair = removeVig(
      [...latest.entries()].map(([selection, row]) => ({
        code: selection,
        odds: row.decimalOdds,
      })),
    );
    result.push({
      bookmakerId: quotes[0]!.bookmakerId,
      fairProbabilities: Object.fromEntries(
        fair.map((selection) => [selection.code, selection.fairProbability]),
      ),
      ageHours,
    });
  }
  return result;
}

function consensus(markets: CompleteMarket[], selection: string): number | null {
  const values = markets
    .map((market) => market.fairProbabilities[selection])
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return null;
  return median(values);
}

function earliestMarkets(rows: MarketOddsRow[], marketCode: string): CompleteMarket[] {
  // Opening snapshot per bookmaker: the first complete market (earliest quotes).
  const byBookmaker = new Map<number, MarketOddsRow[]>();
  const required = requiredSelections(marketCode);
  for (const row of rows) {
    if (row.marketCode !== marketCode) continue;
    if (!required.includes(row.selectionCode as never)) continue;
    const existing = byBookmaker.get(row.bookmakerId) ?? [];
    byBookmaker.set(row.bookmakerId, [...existing, row]);
  }
  const result: CompleteMarket[] = [];
  for (const quotes of byBookmaker.values()) {
    const earliest = new Map<string, MarketOddsRow>();
    for (const selection of required) {
      let best: MarketOddsRow | null = null;
      for (const row of quotes) {
        if (row.selectionCode !== selection) continue;
        if (best == null || row.capturedAt.getTime() < best.capturedAt.getTime()) {
          best = row;
        }
      }
      if (best) earliest.set(selection, best);
    }
    if (earliest.size !== required.length) continue;
    const fair = removeVig(
      [...earliest.entries()].map(([selection, row]) => ({
        code: selection,
        odds: row.decimalOdds,
      })),
    );
    result.push({
      bookmakerId: quotes[0]!.bookmakerId,
      fairProbabilities: Object.fromEntries(
        fair.map((selection) => [selection.code, selection.fairProbability]),
      ),
      ageHours: 0,
    });
  }
  return result;
}

/**
 * Pure analysis over odds rows (testable without a database).
 * `rows` must already be filtered to `capturedAt <= asOf`.
 */
export function analyzeMarketFeatureSet(input: {
  rows: MarketOddsRow[];
  asOf: Date;
  minimumBookmakers?: number;
  maximumAgeHours?: number;
}): MarketFeatureSet {
  const minimumBookmakers = Math.max(1, Math.floor(input.minimumBookmakers ?? 2));
  const maximumAgeHours = Math.max(1, input.maximumAgeHours ?? 168);
  const eligible = input.rows.filter((row) => row.capturedAt.getTime() <= input.asOf.getTime());
  if (eligible.length === 0) return { ...EMPTY };

  const winnerMarkets = completeMarkets(eligible, 'MATCH_WINNER', input.asOf, maximumAgeHours);
  const totalMarkets = completeMarkets(eligible, 'TOTAL_GOALS_2_5', input.asOf, maximumAgeHours);
  const bttsMarkets = completeMarkets(eligible, 'BTTS', input.asOf, maximumAgeHours);

  const homeConsensus = consensus(winnerMarkets, 'HOME');
  const drawConsensus = consensus(winnerMarkets, 'DRAW');
  const awayConsensus = consensus(winnerMarkets, 'AWAY');
  const over25Consensus = consensus(totalMarkets, 'OVER');
  const bttsYesConsensus = consensus(bttsMarkets, 'YES');

  if (winnerMarkets.length === 0 && totalMarkets.length === 0 && bttsMarkets.length === 0) {
    return { ...EMPTY };
  }

  const openingWinner = earliestMarkets(eligible, 'MATCH_WINNER');
  const openingTotal = earliestMarkets(eligible, 'TOTAL_GOALS_2_5');
  const homeOpening = consensus(openingWinner, 'HOME');
  const drawOpening = consensus(openingWinner, 'DRAW');
  const awayOpening = consensus(openingWinner, 'AWAY');
  const over25Opening = consensus(openingTotal, 'OVER');

  const ageHours =
    winnerMarkets.length > 0
      ? Math.min(...winnerMarkets.map((market) => market.ageHours))
      : totalMarkets.length > 0
        ? Math.min(...totalMarkets.map((market) => market.ageHours))
        : Math.min(...bttsMarkets.map((market) => market.ageHours));

  const bookmakerCount = Math.max(winnerMarkets.length, totalMarkets.length, bttsMarkets.length);
  const winnerQuality = winnerMarkets.length >= minimumBookmakers && homeConsensus != null ? 1 : 0;
  const totalQuality = totalMarkets.length >= minimumBookmakers && over25Consensus != null ? 1 : 0;
  const bttsQuality = bttsMarkets.length >= minimumBookmakers && bttsYesConsensus != null ? 1 : 0;

  return {
    available: winnerQuality > 0 || totalQuality > 0 || bttsQuality > 0,
    homeConsensus,
    drawConsensus,
    awayConsensus,
    over25Consensus,
    bttsYesConsensus,
    homeMovement: homeConsensus != null && homeOpening != null ? homeConsensus - homeOpening : null,
    drawMovement: drawConsensus != null && drawOpening != null ? drawConsensus - drawOpening : null,
    awayMovement: awayConsensus != null && awayOpening != null ? awayConsensus - awayOpening : null,
    over25Movement:
      over25Consensus != null && over25Opening != null ? over25Consensus - over25Opening : null,
    oddsAgeHours: Number.isFinite(ageHours) ? ageHours : null,
    bookmakerCount: bookmakerCount > 0 ? bookmakerCount : null,
    qualityScore: clamp(winnerQuality * 0.5 + totalQuality * 0.3 + bttsQuality * 0.2, 0, 1),
  };
}

/** PREDICTION_AI_V7: single-fixture market features with a DB query. */
export async function getFixtureMarketFeatureSet(input: {
  fixtureId: number;
  predictionAsOf: Date;
  minimumBookmakers?: number;
  maximumAgeHours?: number;
}): Promise<MarketFeatureSet> {
  const rows = await prismaOddsSnapshotRows(input.fixtureId, input.predictionAsOf);
  return analyzeMarketFeatureSet({
    rows,
    asOf: input.predictionAsOf,
    minimumBookmakers: input.minimumBookmakers,
    maximumAgeHours: input.maximumAgeHours,
  });
}

interface PrismaOddsRow {
  bookmakerId: number;
  market: { marketCode: string };
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
}

function toMarketOddsRow(row: PrismaOddsRow): MarketOddsRow {
  return toMarketOddsRowPlain({
    bookmakerId: row.bookmakerId,
    marketCode: row.market.marketCode,
    selectionCode: row.selectionCode,
    decimalOdds: row.decimalOdds,
    capturedAt: row.capturedAt,
  });
}

function toMarketOddsRowPlain(row: {
  bookmakerId: number;
  marketCode: string;
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
}): MarketOddsRow {
  return {
    bookmakerId: row.bookmakerId,
    marketCode: row.marketCode,
    selectionCode: row.selectionCode,
    decimalOdds: row.decimalOdds,
    capturedAt: new Date(row.capturedAt),
  };
}

/**
 * PREDICTION_AI_V7: bulk market features for many fixtures (training path).
 * One query, in-memory consensus per fixture — keeps training fast.
 *
 * When `asOfByFixture` is provided, each fixture is analyzed at its own cutoff
 * (e.g. its kickoff time) so later snapshots never leak into earlier fixtures.
 */
export async function getFixturesMarketFeatureSets(input: {
  fixtureIds: number[];
  asOf: Date;
  asOfByFixture?: Map<number, Date>;
  minimumBookmakers?: number;
  maximumAgeHours?: number;
}): Promise<Map<number, MarketFeatureSet>> {
  const result = new Map<number, MarketFeatureSet>();
  if (input.fixtureIds.length === 0) return result;
  const effectiveAsOf = input.asOfByFixture
    ? new Date(Math.max(...[...input.asOfByFixture.values()].map((date) => date.getTime())))
    : input.asOf;
  const rows = await prismaOddsSnapshotRowsMany(input.fixtureIds, effectiveAsOf);
  const byFixture = new Map<number, MarketOddsRow[]>();
  for (const row of rows) {
    const existing = byFixture.get(row.fixtureId) ?? [];
    existing.push(row);
    byFixture.set(row.fixtureId, existing);
  }
  for (const fixtureId of input.fixtureIds) {
    const fixtureRows = byFixture.get(fixtureId) ?? [];
    const fixtureAsOf = input.asOfByFixture?.get(fixtureId) ?? input.asOf;
    result.set(
      fixtureId,
      analyzeMarketFeatureSet({
        rows: fixtureRows,
        asOf: fixtureAsOf,
        minimumBookmakers: input.minimumBookmakers,
        maximumAgeHours: input.maximumAgeHours,
      }),
    );
  }
  return result;
}

// Prisma is imported lazily so pure analysis stays unit-testable without a DB.
type OddsRowWithFixture = MarketOddsRow & { fixtureId: number };

async function prismaOddsSnapshotRows(fixtureId: number, asOf: Date): Promise<MarketOddsRow[]> {
  const { prisma } = await import('@football-ai/database');
  const rows = (await prisma.oddsSnapshot.findMany({
    where: {
      fixtureId,
      isLive: false,
      capturedAt: { lte: asOf },
      market: { enabled: true },
    },
    select: {
      bookmakerId: true,
      market: { select: { marketCode: true } },
      selectionCode: true,
      decimalOdds: true,
      capturedAt: true,
    },
  })) as unknown as PrismaOddsRow[];
  return rows.map((row) => toMarketOddsRow(row));
}

async function prismaOddsSnapshotRowsMany(
  fixtureIds: number[],
  asOf: Date,
): Promise<Array<OddsRowWithFixture>> {
  const { prisma } = await import('@football-ai/database');
  const rows = (await prisma.oddsSnapshot.findMany({
    where: {
      fixtureId: { in: fixtureIds },
      isLive: false,
      capturedAt: { lte: asOf },
      market: { enabled: true },
    },
    select: {
      fixtureId: true,
      bookmakerId: true,
      market: { select: { marketCode: true } },
      selectionCode: true,
      decimalOdds: true,
      capturedAt: true,
    },
  })) as unknown as Array<PrismaOddsRow & { fixtureId: number }>;
  return rows.map((row) => ({
    fixtureId: row.fixtureId,
    ...toMarketOddsRow(row),
  }));
}
