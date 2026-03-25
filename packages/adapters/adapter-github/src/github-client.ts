// GitHub REST API client — bare fetch wrapper

const GITHUB_API = 'https://api.github.com';

export interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  public_repos: number;
  followers: number;
  created_at: string;
  html_url: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  updated_at: string;
  created_at?: string;
  pushed_at?: string;
  html_url: string;
  fork: boolean;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  html_url: string;
}

export interface GitHubEvent {
  id: string;
  type: string;
  created_at: string;
  repo: {
    name: string;
  };
  payload?: {
    commits?: Array<{ sha: string; message: string }>;
    size?: number;
  };
}

export interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

export interface RateLimitHeaders {
  remaining: number | null;
  resetAt: Date | null;
}

export interface ApiResponse<T> {
  data: T;
  rateLimit: RateLimitHeaders;
}

export class GitHubClient {
  private headers: Record<string, string>;
  readonly authenticated: boolean;

  constructor(token?: string) {
    this.headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'sourcerer-cli',
    };
    this.authenticated = !!token;
    if (token) {
      this.headers['Authorization'] = `token ${token}`;
    }
  }

  async fetchUser(username: string): Promise<GitHubUser> {
    const { data } = await this.get<GitHubUser>(`/users/${encodeURIComponent(username)}`);
    return data;
  }

  async fetchRepos(username: string, perPage = 20): Promise<GitHubRepo[]> {
    const { data } = await this.get<GitHubRepo[]>(
      `/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=${perPage}`,
    );
    return data;
  }

  async fetchCommits(owner: string, repo: string, perPage = 30): Promise<GitHubCommit[]> {
    const { data } = await this.get<GitHubCommit[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}`,
    );
    return data;
  }

  async fetchUserEvents(username: string): Promise<GitHubEvent[]> {
    const { data } = await this.get<GitHubEvent[]>(
      `/users/${encodeURIComponent(username)}/events?per_page=100`,
    );
    return data;
  }

  async checkRateLimit(): Promise<RateLimitInfo> {
    const { data } = await this.get<{ rate: { remaining: number; reset: number } }>('/rate_limit');
    return {
      remaining: data.rate.remaining,
      resetAt: new Date(data.rate.reset * 1000),
    };
  }

  private parseRateLimitHeaders(response: Response): RateLimitHeaders {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    return {
      remaining: remaining !== null ? parseInt(remaining, 10) : null,
      resetAt: reset !== null ? new Date(parseInt(reset, 10) * 1000) : null,
    };
  }

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: this.headers,
    });

    const rateLimit = this.parseRateLimitHeaders(response);

    if (!response.ok) {
      const status = response.status;
      // Differentiate 403 (rate limit) from 404 (not found)
      if (status === 403) {
        throw new GitHubApiError(
          403,
          `GitHub API rate limit exceeded: ${path}`,
          rateLimit,
        );
      }
      if (status === 429) {
        throw new GitHubApiError(
          429,
          `GitHub API rate limited (429): ${path}`,
          rateLimit,
        );
      }
      if (status === 404) {
        throw new GitHubApiError(404, `GitHub API not found: ${path}`, rateLimit);
      }
      throw new GitHubApiError(status, `GitHub API ${status}: ${path}`, rateLimit);
    }

    const data = (await response.json()) as T;
    return { data, rateLimit };
  }
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly rateLimit?: RateLimitHeaders,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }

  get isRateLimit(): boolean {
    return this.status === 429 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}
