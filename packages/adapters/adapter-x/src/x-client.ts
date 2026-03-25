// X/Twitter REST API client — bare fetch wrapper

const X_API_BASE = 'https://api.twitter.com/2';

// --- Types ---

export interface XUser {
  id: string;
  username: string;
  name: string;
  description: string;
  location?: string;
  public_metrics: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
  created_at: string;
  protected: boolean;
  url?: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count?: number;
  };
}

export type XTier = 'basic' | 'pro' | 'enterprise';

interface RateLimitInfo {
  remaining: number | null;
  resetAt: Date | null;
}

interface ApiResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
}

// Tier-based rate limits (requests per minute)
const TIER_RATE_LIMITS: Record<XTier, number> = {
  basic: 5,
  pro: 60,
  enterprise: 300,
};

// --- Error ---

export class XApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'XApiError';
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

// --- Client ---

export class XClient {
  private headers: Record<string, string>;
  readonly tier: XTier;
  readonly requestsPerMinute: number;

  constructor(apiKey: string, tier: XTier = 'basic') {
    this.tier = tier;
    this.requestsPerMinute = TIER_RATE_LIMITS[tier];
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'sourcerer-cli',
    };
  }

  async fetchUser(handle: string): Promise<XUser> {
    const fields = 'description,public_metrics,location,created_at,protected,url';
    const { data } = await this.get<{ data: XUser }>(
      `/users/by/username/${encodeURIComponent(handle)}?user.fields=${fields}`,
    );
    return data.data;
  }

  async fetchRecentTweets(userId: string, maxResults = 50): Promise<XTweet[]> {
    const fields = 'created_at,public_metrics,text';
    const clamped = Math.min(Math.max(maxResults, 5), 100);
    const { data } = await this.get<{ data?: XTweet[] }>(
      `/users/${encodeURIComponent(userId)}/tweets?tweet.fields=${fields}&max_results=${clamped}`,
    );
    return data.data ?? [];
  }

  async checkRateLimit(): Promise<{ remaining: number | null; resetAt: Date | null }> {
    // X API doesn't have a dedicated rate limit endpoint like GitHub.
    // We make a lightweight user lookup to inspect headers.
    // For healthCheck we use the known account 'X' (formerly Twitter).
    const response = await fetch(`${X_API_BASE}/users/by/username/X?user.fields=id`, {
      headers: this.headers,
    });
    const remaining = response.headers.get('x-rate-limit-remaining');
    const reset = response.headers.get('x-rate-limit-reset');
    return {
      remaining: remaining !== null ? parseInt(remaining, 10) : null,
      resetAt: reset !== null ? new Date(parseInt(reset, 10) * 1000) : null,
    };
  }

  private parseRateLimitHeaders(response: Response): RateLimitInfo {
    const remaining = response.headers.get('x-rate-limit-remaining');
    const reset = response.headers.get('x-rate-limit-reset');
    return {
      remaining: remaining !== null ? parseInt(remaining, 10) : null,
      resetAt: reset !== null ? new Date(parseInt(reset, 10) * 1000) : null,
    };
  }

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${X_API_BASE}${path}`, {
      headers: this.headers,
    });

    const rateLimit = this.parseRateLimitHeaders(response);

    if (!response.ok) {
      const status = response.status;
      let code: string | undefined;
      let retryAfterMs: number | undefined;

      try {
        const body = (await response.json()) as { errors?: Array<{ code?: string }> };
        code = body.errors?.[0]?.code;
      } catch {
        // Ignore parse errors
      }

      if (status === 429) {
        const retryAfter = response.headers.get('retry-after');
        retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
        throw new XApiError(429, `X API rate limited (429): ${path}`, code, retryAfterMs);
      }
      if (status === 404) {
        throw new XApiError(404, `X API not found: ${path}`, code);
      }
      if (status === 401) {
        throw new XApiError(401, `X API unauthorized: ${path}`, code);
      }

      throw new XApiError(status, `X API ${status}: ${path}`, code);
    }

    const data = (await response.json()) as T;
    return { data, rateLimit };
  }
}
