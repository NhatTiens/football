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

export function normalizeHistoryMarket(value: string | null): string {
  const market = (value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');

  if (
    market === 'BTTS' ||
    market === 'BOTH_TEAMS_TO_SCORE' ||
    market === 'BOTH_TEAM_TO_SCORE'
  ) {
    return 'BTTS';
  }

  if (
    market === 'OU' ||
    market.includes('OVER_UNDER') ||
    market.startsWith('TOTAL_GOALS')
  ) {
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
        new Date(right.decisionAsOf).getTime() -
          new Date(left.decisionAsOf).getTime() ||
        historySummaryKey(right).localeCompare(historySummaryKey(left)),
    )
    .map((candidate) => candidate.row);
}
