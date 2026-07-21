import type {
  ApiFootballEnvelope,
  ApiFootballResult,
  FixtureResponse,
  LeagueResponse,
  LineupResponse,
  OddsResponse,
  PredictionResponse,
  RateLimitInfo,
} from './types.js';

export class ApiFootballError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'ApiFootballError';
  }
}

export interface ApiFootballClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maximumRetries?: number;
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRateLimit(headers: Headers): RateLimitInfo {
  return {
    dailyLimit: numberHeader(headers, 'x-ratelimit-requests-limit'),
    dailyRemaining: numberHeader(headers, 'x-ratelimit-requests-remaining'),
    minuteLimit: numberHeader(headers, 'x-ratelimit-limit'),
    minuteRemaining: numberHeader(headers, 'x-ratelimit-remaining'),
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ApiFootballClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maximumRetries: number;

  constructor(private readonly options: ApiFootballClientOptions) {
    if (!options.apiKey) throw new Error('API_FOOTBALL_KEY is required.');
    this.baseUrl = (options.baseUrl ?? 'https://v3.football.api-sports.io').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maximumRetries = options.maximumRetries ?? 3;
  }

  async request<T>(endpoint: string, parameters: Record<string, string | number | undefined>): Promise<ApiFootballResult<T>> {
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maximumRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          headers: {
            'x-apisports-key': this.options.apiKey,
            accept: 'application/json',
          },
          signal: controller.signal,
        });
        const durationMs = Date.now() - startedAt;
        const rateLimit = parseRateLimit(response.headers);
        const payload = (await response.json()) as ApiFootballEnvelope<T>;

        if (!response.ok) {
          const message = `API-Football returned HTTP ${response.status}.`;
          if ((response.status === 429 || response.status >= 500) && attempt < this.maximumRetries) {
            await wait(Math.min(8_000, 500 * 2 ** attempt));
            continue;
          }
          throw new ApiFootballError(message, response.status, endpoint);
        }

        const errors = Array.isArray(payload.errors)
          ? payload.errors
          : Object.values(payload.errors ?? {});
        if (errors.length > 0) {
          throw new ApiFootballError(errors.join('; '), response.status, endpoint);
        }

        return {
          data: payload.response ?? [],
          paging: payload.paging ?? { current: 1, total: 1 },
          rateLimit,
          status: response.status,
          durationMs,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ApiFootballError && error.status < 500 && error.status !== 429) throw error;
        if (attempt >= this.maximumRetries) break;
        await wait(Math.min(8_000, 500 * 2 ** attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new ApiFootballError('Unknown API-Football request failure.', 500, endpoint);
  }

  getLeagues(params: { id?: number; season?: number; current?: boolean } = {}) {
    return this.request<LeagueResponse>('leagues', {
      id: params.id,
      season: params.season,
      current: params.current === undefined ? undefined : String(params.current),
    });
  }

  getFixtures(params: {
    league?: number;
    season?: number;
    from?: string;
    to?: string;
    date?: string;
    fixture?: number;
    timezone?: string;
  }) {
    return this.request<FixtureResponse>('fixtures', {
      league: params.league,
      season: params.season,
      from: params.from,
      to: params.to,
      date: params.date,
      id: params.fixture,
      timezone: params.timezone,
    });
  }

  getOdds(params: { fixture?: number; league?: number; season?: number; page?: number }) {
    return this.request<OddsResponse>('odds', params);
  }

  getPredictions(fixture: number) {
    return this.request<PredictionResponse>('predictions', { fixture });
  }

  getFixtureLineups(fixture: number) {
    return this.request<LineupResponse>('fixtures/lineups', { fixture });
  }
}
