import { ApiFootballClient } from '@football-ai/api-football';

let client: ApiFootballClient | undefined;

export function getApiFootballClient(): ApiFootballClient {
  if (!client) {
    client = new ApiFootballClient({
      apiKey: process.env.API_FOOTBALL_KEY ?? '',
      baseUrl: process.env.API_FOOTBALL_BASE_URL,
      timeoutMs: 20_000,
      maximumRetries: 3,
    });
  }
  return client;
}
