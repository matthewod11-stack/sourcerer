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

export interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

export class GitHubClient {
  private headers: Record<string, string>;

  constructor(token?: string) {
    this.headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'sourcerer-cli',
    };
    if (token) {
      this.headers['Authorization'] = `token ${token}`;
    }
  }

  async fetchUser(username: string): Promise<GitHubUser> {
    return this.get<GitHubUser>(`/users/${encodeURIComponent(username)}`);
  }

  async fetchRepos(username: string, perPage = 20): Promise<GitHubRepo[]> {
    return this.get<GitHubRepo[]>(
      `/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=${perPage}`,
    );
  }

  async fetchCommits(owner: string, repo: string, perPage = 30): Promise<GitHubCommit[]> {
    return this.get<GitHubCommit[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}`,
    );
  }

  async checkRateLimit(): Promise<RateLimitInfo> {
    const data = await this.get<{ rate: { remaining: number; reset: number } }>('/rate_limit');
    return {
      remaining: data.rate.remaining,
      resetAt: new Date(data.rate.reset * 1000),
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new GitHubApiError(response.status, `GitHub API ${response.status}: ${path}`);
    }

    return (await response.json()) as T;
  }
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}
