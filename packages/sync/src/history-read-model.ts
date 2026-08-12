export type HistorySource = 'PAPER_LEDGER' | 'PAPER_SHADOW';

export interface CanonicalHistoryCandidate<T> {
  row: T;
  providerFixtureId: number;
  source: HistorySource;
  market: string | null;
  lineValue: number | null;
  decisionAsOf: string;
  settled: boolean;
}

export interface HistoryFixtureIndexCandidate {
  providerFixtureId: number;
  kickoffAt: Date | string;
}

export interface HistoryFixturePage {
  page: number;
  pageSize: number;
  totalFixtures: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
  providerFixtureIds: number[];
}

export const USER_HISTORY_VISIBLE_FROM_VN = '2026-08-01T00:00:00+07:00';

export function normalizeHistoryMarket(value: string | null): string {
  const market = (value ?? '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');

  if (market === 'BTTS' || market === 'BOTH_TEAMS_TO_SCORE' || market === 'BOTH_TEAM_TO_SCORE') {
    return 'BTTS';
  }

  if (market === 'OU' || market.includes('OVER_UNDER') || market.startsWith('TOTAL_GOALS')) {
    return 'TOTAL_GOALS';
  }

  if (
    market === 'MATCH_WINNER' ||
    market === 'MATCHWINNER' ||
    market === 'HDA' ||
    market === '1X2' ||
    market === 'HDA1X2' ||
    market === 'MATCH_RESULT' ||
    market === 'MATCHRESULT'
  ) {
    return 'MATCH_WINNER';
  }

  return market || 'UNKNOWN';
}

export function historySummaryKey(input: {
  providerFixtureId: number;
  market: string | null;
  lineValue: number | null;
}): string {
  const line = input.lineValue == null ? 'NONE' : input.lineValue.toFixed(2);
  return `${input.providerFixtureId}|${normalizeHistoryMarket(input.market)}|${line}`;
}

export function isUserHistoryMarketVisible(market: string | null): boolean {
  const normalized = normalizeHistoryMarket(market);
  return normalized === 'TOTAL_GOALS' || normalized === 'BTTS';
}

export function isUserHistoryKickoffVisible(kickoffAt: Date | string, reportAsOf: Date): boolean {
  const kickoffTime = new Date(kickoffAt).getTime();
  const cutoffTime = new Date(USER_HISTORY_VISIBLE_FROM_VN).getTime();
  const reportTime = reportAsOf.getTime();

  return (
    Number.isFinite(kickoffTime) &&
    Number.isFinite(reportTime) &&
    kickoffTime >= cutoffTime &&
    kickoffTime <= reportTime
  );
}

/**
 * Paginates the same displayable fixture index used to build History cards.
 * Callers must not pass raw snapshots that failed their source read-model.
 */
export function paginateHistoryFixtures(
  candidates: ReadonlyArray<HistoryFixtureIndexCandidate>,
  requestedPage: number,
  requestedPageSize: number,
): HistoryFixturePage {
  const pageSize =
    Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 20;
  const latestKickoffByFixture = new Map<number, number>();

  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.providerFixtureId) || candidate.providerFixtureId <= 0) {
      continue;
    }

    const kickoffAt = new Date(candidate.kickoffAt).getTime();
    if (!Number.isFinite(kickoffAt)) continue;

    const current = latestKickoffByFixture.get(candidate.providerFixtureId);
    if (current == null || kickoffAt > current) {
      latestKickoffByFixture.set(candidate.providerFixtureId, kickoffAt);
    }
  }

  const fixtureIds = [...latestKickoffByFixture.entries()]
    .sort(
      ([leftId, leftKickoff], [rightId, rightKickoff]) =>
        rightKickoff - leftKickoff || rightId - leftId,
    )
    .map(([providerFixtureId]) => providerFixtureId);
  const totalFixtures = fixtureIds.length;
  const totalPages = Math.max(1, Math.ceil(totalFixtures / pageSize));
  const safeRequestedPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const page = Math.min(safeRequestedPage, totalPages);
  const start = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    totalFixtures,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
    providerFixtureIds: fixtureIds.slice(start, start + pageSize),
  };
}

function candidateScore<T>(candidate: CanonicalHistoryCandidate<T>): [number, number, number] {
  return [
    candidate.settled ? 1 : 0,
    candidate.source === 'PAPER_LEDGER' ? 1 : 0,
    new Date(candidate.decisionAsOf).getTime(),
  ];
}

function preferCandidate<T>(
  current: CanonicalHistoryCandidate<T>,
  candidate: CanonicalHistoryCandidate<T>,
): CanonicalHistoryCandidate<T> {
  const currentScore = candidateScore(current);
  const candidateScoreValue = candidateScore(candidate);

  for (let index = 0; index < currentScore.length; index += 1) {
    const currentValue = currentScore[index] ?? 0;
    const candidateValue = candidateScoreValue[index] ?? 0;
    if (candidateValue !== currentValue) {
      return candidateValue > currentValue ? candidate : current;
    }
  }

  return current;
}

/**
 * Creates the USER-facing summary without changing append-only source rows.
 * The audit view must continue to use the unmodified source collection.
 */
export function selectCanonicalHistoryRows<T>(
  candidates: ReadonlyArray<CanonicalHistoryCandidate<T>>,
): T[] {
  const representatives = new Map<string, CanonicalHistoryCandidate<T>>();

  for (const candidate of candidates) {
    if (!isUserHistoryMarketVisible(candidate.market)) continue;

    const key = historySummaryKey(candidate);
    const current = representatives.get(key);
    representatives.set(key, current ? preferCandidate(current, candidate) : candidate);
  }

  return [...representatives.values()]
    .sort(
      (left, right) =>
        new Date(right.decisionAsOf).getTime() - new Date(left.decisionAsOf).getTime() ||
        historySummaryKey(right).localeCompare(historySummaryKey(left)),
    )
    .map((candidate) => candidate.row);
}
