// GitHub REST API client — bare fetch wrapper

import { parseApiContractPayload, warnApiContractUnknownFields } from '@sourcerer/core';
import { z } from 'zod';

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

const NullableStringSchema = z.string().nullable();

const GitHubUserSchema = z
  .object({
    login: z.string(),
    name: NullableStringSchema,
    bio: NullableStringSchema,
    company: NullableStringSchema,
    location: NullableStringSchema,
    email: NullableStringSchema,
    public_repos: z.number(),
    followers: z.number(),
    created_at: z.string(),
    html_url: z.string(),
  })
  .passthrough();

const GitHubRepoSchema = z
  .object({
    name: z.string(),
    full_name: z.string(),
    language: NullableStringSchema,
    stargazers_count: z.number(),
    forks_count: z.number(),
    topics: z.array(z.string()).default([]),
    updated_at: z.string(),
    created_at: z.string().optional(),
    pushed_at: z.string().optional(),
    html_url: z.string(),
    fork: z.boolean(),
  })
  .passthrough();

const GitHubCommitSchema = z
  .object({
    sha: z.string(),
    commit: z
      .object({
        author: z
          .object({
            name: z.string(),
            email: z.string(),
            date: z.string(),
          })
          .passthrough(),
        message: z.string(),
      })
      .passthrough(),
    html_url: z.string(),
  })
  .passthrough();

const GitHubEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    created_at: z.string(),
    repo: z.object({ name: z.string() }).passthrough(),
    payload: z
      .object({
        commits: z.array(z.object({ sha: z.string(), message: z.string() }).passthrough()).optional(),
        size: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const GitHubRateLimitSchema = z
  .object({
    rate: z
      .object({
        remaining: z.number(),
        reset: z.number(),
      })
      .passthrough(),
  })
  .passthrough();

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
    const path = `/users/${encodeURIComponent(username)}`;
    const { data } = await this.get(path, GitHubUserSchema);
    return data;
  }

  async fetchRepos(username: string, perPage = 20): Promise<GitHubRepo[]> {
    const path = `/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=${perPage}`;
    const { data } = await this.get(path, z.array(GitHubRepoSchema));
    return data;
  }

  async fetchCommits(owner: string, repo: string, perPage = 30): Promise<GitHubCommit[]> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}`;
    const { data } = await this.get(path, z.array(GitHubCommitSchema));
    return data;
  }

  async fetchUserEvents(username: string): Promise<GitHubEvent[]> {
    const path = `/users/${encodeURIComponent(username)}/events?per_page=100`;
    const { data } = await this.get(path, z.array(GitHubEventSchema));
    return data;
  }

  async checkRateLimit(): Promise<RateLimitInfo> {
    const { data } = await this.get('/rate_limit', GitHubRateLimitSchema);
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

  private async get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<ApiResponse<T>> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: this.headers,
    });

    const rateLimit = this.parseRateLimitHeaders(response);

    if (!response.ok) {
      const status = response.status;
      // Differentiate 403 (rate limit) from 404 (not found)
      if (status === 403) {
        throw new GitHubApiError(403, `GitHub API rate limit exceeded: ${path}`, rateLimit);
      }
      if (status === 429) {
        throw new GitHubApiError(429, `GitHub API rate limited (429): ${path}`, rateLimit);
      }
      if (status === 404) {
        throw new GitHubApiError(404, `GitHub API not found: ${path}`, rateLimit);
      }
      throw new GitHubApiError(status, `GitHub API ${status}: ${path}`, rateLimit);
    }

    const payload = await response.json();
    const data = parseApiContractPayload(payload, schema, {
      adapter: 'github',
      endpoint: path,
      warn: warnApiContractUnknownFields,
    });
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
