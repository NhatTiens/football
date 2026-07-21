export interface ApiFootballEnvelope<T> {
  get: string;
  parameters: Record<string, string>;
  errors: Record<string, string> | string[];
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

export interface RateLimitInfo {
  dailyLimit?: number;
  dailyRemaining?: number;
  minuteLimit?: number;
  minuteRemaining?: number;
}

export interface ApiFootballResult<T> {
  data: T[];
  paging: { current: number; total: number };
  rateLimit: RateLimitInfo;
  status: number;
  durationMs: number;
}

export interface LeagueResponse {
  league: { id: number; name: string; type?: string; logo?: string };
  country?: { name?: string; code?: string; flag?: string };
  seasons?: Array<{
    year: number;
    start?: string;
    end?: string;
    current?: boolean;
    coverage?: Record<string, unknown>;
  }>;
}

export interface FixtureResponse {
  fixture: {
    id: number;
    referee?: string | null;
    timezone?: string;
    date: string;
    timestamp?: number;
    venue?: { id?: number | null; name?: string | null; city?: string | null };
    status: { long?: string; short?: string; elapsed?: number | null };
  };
  league: {
    id: number;
    name: string;
    country?: string;
    logo?: string;
    season: number;
    round?: string;
  };
  teams: {
    home: { id: number; name: string; logo?: string; winner?: boolean | null };
    away: { id: number; name: string; logo?: string; winner?: boolean | null };
  };
  goals: { home?: number | null; away?: number | null };
  score?: {
    halftime?: { home?: number | null; away?: number | null };
    fulltime?: { home?: number | null; away?: number | null };
  };
}

export interface OddsResponse {
  league?: { id: number; name?: string; season?: number };
  fixture: { id: number; timezone?: string; date?: string; timestamp?: number };
  update?: string;
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string;
      values: Array<{ value: string; odd: string }>;
    }>;
  }>;
}

export interface PredictionResponse {
  predictions?: {
    winner?: { id?: number | null; name?: string | null; comment?: string | null };
    advice?: string;
    percent?: { home?: string; draw?: string; away?: string };
  };
}

export interface LineupPlayerResponse {
  player: {
    id: number;
    name: string;
    number?: number | null;
    pos?: string | null;
    grid?: string | null;
    photo?: string | null;
  };
}

export interface LineupResponse {
  team: {
    id: number;
    name: string;
    logo?: string | null;
    colors?: Record<string, unknown>;
  };
  formation?: string | null;
  coach?: {
    id?: number | null;
    name?: string | null;
    photo?: string | null;
  };
  startXI?: LineupPlayerResponse[];
  substitutes?: LineupPlayerResponse[];
}
