import type { NextFunction, Request, Response } from 'express';

const OMIT = Symbol('GLOBAL_MATCH_WINNER_OMIT');

type JsonRecord = Record<string, any>;

const MARKET_KEYS = [
  'market',
  'marketType',
  'marketCode',
  'selectedMarket',
  'scientificMarketType',
  'providerMarketType',
  'code',
] as const;

export const GLOBAL_VISIBLE_MARKETS = [
  'BTTS',
  'TOTAL_GOALS_1_5',
  'TOTAL_GOALS_2_5',
  'TOTAL_GOALS_3_5',
] as const;

export function normalizeMarketAlias(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
    : '';
}

export function isMatchWinnerMarket(value: unknown): boolean {
  const normalized = normalizeMarketAlias(value);
  return (
    normalized === 'MATCHWINNER' ||
    normalized === 'HDA' ||
    normalized === '1X2' ||
    normalized === 'HDA1X2' ||
    normalized === 'MATCHRESULT'
  );
}

export function isExplicitMatchWinnerQuestion(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

  return (
    /\bmatch[\s_-]*winner\b/i.test(value) ||
    /\bhda\b/i.test(value) ||
    /\b1\s*[x×]\s*2\b/i.test(value) ||
    /(?:^|\s)(?:ai|doi\s+nao|team\s+nao)\s+(?:se\s+)?thang(?:\s|$)/.test(
      normalized,
    ) ||
    /\b(home|away)\s+win\b/i.test(value) ||
    /\bwhich\s+(?:team|side)\s+(?:will\s+)?win\b/i.test(value)
  );
}

export function stripMatchWinnerText(value: string): string {
  return value
    .replace(/\bMATCH[\s_-]*WINNER\b/gi, '')
    .replace(/\bHDA\s*\/?\s*1X2\b/gi, '')
    .replace(/\bHDA\b/gi, '')
    .replace(/\b1\s*[x×]\s*2\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,;:])\s*([,;:])/g, '$1')
    .trim();
}

function objectRepresentsMatchWinner(row: JsonRecord): boolean {
  for (const key of MARKET_KEYS) {
    if (key in row && isMatchWinnerMarket(row[key])) return true;
  }

  if (isMatchWinnerMarket(row.marketName)) return true;
  if (isMatchWinnerMarket(row.label)) return true;

  return false;
}

function sanitizeRecommendation(row: unknown): unknown {
  if (row == null || typeof row !== 'object') return row;
  const record = row as JsonRecord;

  if (objectRepresentsMatchWinner(record)) {
    return {
      status: 'NONE',
      marketType: null,
      selection: null,
      lineValue: null,
      decimalOdds: null,
      bookmakerName: null,
      modelProbability: null,
      edge: null,
      expectedValue: null,
      officialBestBet: false,
      paperOnly: true,
      reason: 'No visible BTTS/O-U recommendation.',
    };
  }

  return sanitizeNode(record);
}

function sanitizePaperShadow(row: unknown): unknown {
  if (row == null || typeof row !== 'object') return row;
  const record = row as JsonRecord;

  if (
    record.selected != null &&
    typeof record.selected === 'object' &&
    objectRepresentsMatchWinner(record.selected)
  ) {
    return {
      ...record,
      status: 'NO_CANDIDATE',
      consideredCandidates: 0,
      validCandidates: 0,
      rawValueCandidates: 0,
      hierarchicalValueCandidates: 0,
      boundedValueCandidates: 0,
      selected: null,
    };
  }

  return sanitizeNode(record);
}

function recomputeVisibleBacktest(row: JsonRecord): JsonRecord {
  if (!Array.isArray(row.bets)) return row;

  const bets = row.bets as JsonRecord[];
  const wins = bets.filter((bet) => bet.settlementResult === 'WIN').length;
  const losses = bets.filter((bet) => bet.settlementResult === 'LOSS').length;
  const pushes = bets.filter((bet) => bet.settlementResult === 'PUSH').length;
  const voids = bets.filter((bet) => bet.settlementResult === 'VOID').length;
  const stakeUnits = bets.reduce(
    (sum, bet) => sum + (Number(bet.stakeUnits) || 0),
    0,
  );
  const profitUnits = bets.reduce(
    (sum, bet) => sum + (Number(bet.profitUnits) || 0),
    0,
  );
  const totalStakeAmount = bets.some((bet) => bet.stakeAmount != null)
    ? bets.reduce((sum, bet) => sum + (Number(bet.stakeAmount) || 0), 0)
    : null;
  const profitAmount = bets.some((bet) => bet.profitAmount != null)
    ? bets.reduce((sum, bet) => sum + (Number(bet.profitAmount) || 0), 0)
    : null;
  const decimalOdds = bets
    .map((bet) => Number(bet.decimalOdds))
    .filter((value) => Number.isFinite(value) && value > 0);

  let equity = 0;
  const equityCurve = bets.map((bet, index) => {
    equity += Number(bet.profitUnits) || 0;
    return {
      index: index + 1,
      kickoffAt: bet.kickoffAt,
      equity,
    };
  });

  return {
    ...row,
    totalBets: bets.length,
    wins,
    losses,
    pushes,
    voids,
    hitRate: wins + losses > 0 ? wins / (wins + losses) : null,
    profitUnits,
    totalStakeUnits: stakeUnits,
    totalStakeAmount,
    profitAmount,
    roi: stakeUnits > 0 ? profitUnits / stakeUnits : null,
    yieldRate: stakeUnits > 0 ? profitUnits / stakeUnits : null,
    averageOdds:
      decimalOdds.length > 0
        ? decimalOdds.reduce((sum, value) => sum + value, 0) / decimalOdds.length
        : null,
    equityCurve,
  };
}

function sanitizeNode(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value;

  if (typeof value === 'string') {
    if (isMatchWinnerMarket(value)) return OMIT;
    return stripMatchWinnerText(value);
  }

  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const sanitized = sanitizeNode(item);
      if (sanitized !== OMIT) result.push(sanitized);
    }
    return result;
  }

  const row = value as JsonRecord;

  if (objectRepresentsMatchWinner(row)) {
    return OMIT;
  }

  const result: JsonRecord = {};

  for (const [key, raw] of Object.entries(row)) {
    if (key === 'scientificHda' || key === 'hda') {
      result[key] = {
        available: false,
        source: 'NONE',
        homeProbability: null,
        drawProbability: null,
        awayProbability: null,
        predictedSelection: null,
        horizonMinutes: null,
        decisionAsOf: null,
        modelVersion: null,
      };
      continue;
    }

    if (key === 'providerHda' || key === 'externalPrediction') {
      result[key] = {
        available: false,
        source: 'NONE',
        homeProbability: null,
        drawProbability: null,
        awayProbability: null,
        predictedSelection: null,
        advice: null,
        predictedWinner: null,
        capturedAt: null,
      };
      continue;
    }

    if (key === 'marketMovement') {
      result[key] = null;
      continue;
    }

    if (
      key === 'scientificHdaReady' ||
      key === 'providerHdaAvailable' ||
      key === 'fixturesWithMarketMovement'
    ) {
      result[key] = 0;
      continue;
    }

    if (key === 'prediction' && raw != null && typeof raw === 'object') {
      const prediction = raw as JsonRecord;
      if (
        'homeProbability' in prediction ||
        'drawProbability' in prediction ||
        'awayProbability' in prediction ||
        'predictedSelection' in prediction
      ) {
        result[key] = {
          source: 'NONE',
          homeProbability: null,
          drawProbability: null,
          awayProbability: null,
          predictedSelection: null,
          providerAdvice: null,
          providerPredictedWinner: null,
          providerCapturedAt: null,
        };
        continue;
      }
    }

    if (
      key === 'recommendation' ||
      key === 'currentRecommendation'
    ) {
      result[key] = sanitizeRecommendation(raw);
      continue;
    }

    if (key === 'paperShadowRecommendation') {
      result[key] = sanitizePaperShadow(raw);
      continue;
    }

    if (
      key === 'decision' &&
      raw != null &&
      typeof raw === 'object' &&
      objectRepresentsMatchWinner(raw as JsonRecord)
    ) {
      result[key] = null;
      continue;
    }

    const sanitized = sanitizeNode(raw);
    if (sanitized !== OMIT) result[key] = sanitized;
  }

  if (
    result.integrity != null &&
    typeof result.integrity === 'object' &&
    !Array.isArray(result.integrity)
  ) {
    result.integrity = {
      ...result.integrity,
      marketScope: 'BTTS_OU_ONLY',
      matchWinnerVisible: false,
    };
  }

  return recomputeVisibleBacktest(result);
}

export function sanitizeGlobalMarketPayload<T>(value: T): T {
  const sanitized = sanitizeNode(value);
  return (sanitized === OMIT ? null : sanitized) as T;
}

export function globalMarketScopeMiddleware(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  const originalJson = response.json.bind(response);

  response.json = ((body: unknown) =>
    originalJson(sanitizeGlobalMarketPayload(body))) as Response['json'];

  next();
}
