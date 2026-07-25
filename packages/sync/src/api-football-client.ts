import {
  API_FOOTBALL_BASE_URL,
  parseApiFootballQuotaHeaders,
  type ApiFootballQuotaSnapshot,
  type ApiFootballResponseEnvelope,
} from './api-football-contract.js';

export interface ApiFootballRequestResult<T = unknown> {
  status: number;
  path: string;
  query: Record<string, string>;
  observedAt: Date;
  durationMs: number;
  quota: ApiFootballQuotaSnapshot;
  payload: ApiFootballResponseEnvelope<T>;
}

const MINIMUM_REQUEST_INTERVAL_MS = 225;

let lastRequestAtMs = 0;

function requiredApiKey(): string {
  const value =
    process.env.API_FOOTBALL_KEY ??
    process.env.API_FOOTBALL_API_KEY ??
    process.env.APISPORTS_KEY ??
    process.env.API_SPORTS_KEY;

  if (value == null || value.trim() === '') {
    throw new Error(
      'Missing API-Football key. Set API_FOOTBALL_KEY in your local .env. Never commit or share the key.',
    );
  }

  return value.trim();
}

function baseUrl(): string {
  return (process.env.API_FOOTBALL_BASE_URL ?? API_FOOTBALL_BASE_URL).replace(/\/+$/, '');
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAtMs + MINIMUM_REQUEST_INTERVAL_MS - now);

  if (wait > 0) {
    await sleep(wait);
  }

  lastRequestAtMs = Date.now();
}

function queryString(query: Record<string, string | number | boolean | undefined>): {
  serialized: string;
  normalized: Record<string, string>;
} {
  const params = new URLSearchParams();
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }

    const serialized = String(value);

    params.set(key, serialized);
    normalized[key] = serialized;
  }

  const suffix = params.toString();

  return {
    serialized: suffix === '' ? '' : `?${suffix}`,
    normalized,
  };
}

function apiErrors(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${key}: ${String(item)}`,
    );
  }

  return [String(value)];
}

export async function apiFootballGet<T = unknown>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  options: {
    maxAttempts?: number;
  } = {},
): Promise<ApiFootballRequestResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 4));
  const queryData = queryString(query);
  const url = `${baseUrl()}${path}${queryData.serialized}`;
  const key = requiredApiKey();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await throttle();

    const startedAt = Date.now();
    const observedAt = new Date();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-apisports-key': key,
        },
      });
      const durationMs = Date.now() - startedAt;
      const quota = parseApiFootballQuotaHeaders(response.headers);

      if (response.status === 429) {
        lastError = new Error(`API-Football rate limited request ${path} on attempt ${attempt}.`);

        if (attempt < maxAttempts) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
      }

      if (!response.ok) {
        const body = await response.text();

        throw new Error(
          `API-Football ${path} returned HTTP ${response.status}: ${body.slice(0, 500)}`,
        );
      }

      const payload = (await response.json()) as ApiFootballResponseEnvelope<T>;
      const errors = apiErrors(payload.errors);

      if (errors.length > 0) {
        throw new Error(`API-Football ${path} returned API errors: ${errors.join('; ')}`);
      }

      return {
        status: response.status,
        path,
        query: queryData.normalized,
        observedAt,
        durationMs,
        quota,
        payload,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError ?? new Error(`API-Football request failed: ${path}`);
}

export async function apiFootballStatus(): Promise<ApiFootballRequestResult<unknown>> {
  return apiFootballGet('/status', {});
}
