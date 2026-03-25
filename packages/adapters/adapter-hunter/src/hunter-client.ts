// Hunter.io REST API client — bare fetch wrapper with quota tracking

const HUNTER_API = 'https://api.hunter.io/v2';

// --- Response Types ---

export interface HunterSource {
  domain: string;
  uri: string;
  extracted_on: string;
}

export interface HunterEmailResult {
  email: string;
  score: number;
  domain: string;
  position?: string;
  first_name: string;
  last_name: string;
  type: 'personal' | 'generic';
  confidence: number;
  sources: HunterSource[];
}

export interface HunterVerification {
  email: string;
  result: 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
  score: number;
  smtp_server?: string;
  smtp_check?: boolean;
}

export interface HunterDomainSearchResult {
  domain: string;
  disposable: boolean;
  webmail: boolean;
  accept_all: boolean;
  pattern: string | null;
  organization: string | null;
  emails: HunterEmailResult[];
}

export interface HunterAccountInfo {
  email: string;
  plan_name: string;
  plan_level: number;
  requests: {
    searches: {
      used: number;
      available: number;
    };
  };
}

// --- Error ---

export class HunterApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HunterApiError';
  }
}

// --- Client ---

export class HunterClient {
  private apiKey: string;
  private remainingSearches: number | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Find email address for a person at a given domain.
   * GET /email-finder?domain=...&first_name=...&last_name=...&api_key=...
   */
  async findEmail(
    domain: string,
    firstName: string,
    lastName: string,
  ): Promise<HunterEmailResult | null> {
    const params = new URLSearchParams({
      domain,
      first_name: firstName,
      last_name: lastName,
      api_key: this.apiKey,
    });

    const result = await this.get<{ data: HunterEmailResult }>(`/email-finder?${params}`);
    this.decrementQuota();

    // Hunter returns the data object even when no email found, but email will be empty
    if (!result.data.email) {
      return null;
    }
    return result.data;
  }

  /**
   * Verify deliverability of an email address.
   * GET /email-verifier?email=...&api_key=...
   */
  async verifyEmail(email: string): Promise<HunterVerification> {
    const params = new URLSearchParams({
      email,
      api_key: this.apiKey,
    });

    const result = await this.get<{ data: HunterVerification }>(`/email-verifier?${params}`);
    return result.data;
  }

  /**
   * Search for all emails at a given domain.
   * GET /domain-search?domain=...&api_key=...
   */
  async domainSearch(domain: string): Promise<HunterDomainSearchResult> {
    const params = new URLSearchParams({
      domain,
      api_key: this.apiKey,
    });

    const result = await this.get<{ data: HunterDomainSearchResult }>(`/domain-search?${params}`);
    this.decrementQuota();
    return result.data;
  }

  /**
   * Get account info including quota usage.
   * GET /account?api_key=...
   */
  async getAccountInfo(): Promise<HunterAccountInfo> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
    });

    const result = await this.get<{ data: HunterAccountInfo }>(`/account?${params}`);

    // Update remaining searches from the authoritative source
    this.remainingSearches =
      result.data.requests.searches.available - result.data.requests.searches.used;

    return result.data;
  }

  /**
   * Get remaining search quota. Returns null if not yet known (call getAccountInfo first).
   */
  getRemainingQuota(): number | null {
    return this.remainingSearches;
  }

  /**
   * Manually set quota from account info (e.g., after initial health check).
   */
  setQuota(remaining: number): void {
    this.remainingSearches = remaining;
  }

  // --- Private ---

  private decrementQuota(): void {
    if (this.remainingSearches !== null && this.remainingSearches > 0) {
      this.remainingSearches--;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${HUNTER_API}${path}`);

    if (!response.ok) {
      const status = response.status;
      let errorMessage = `Hunter.io API error ${status}: ${path.split('?')[0]}`;
      let errorCode: string | undefined;

      try {
        const body = (await response.json()) as { errors?: { details?: string; code?: string }[] };
        if (body.errors?.[0]) {
          errorMessage = body.errors[0].details ?? errorMessage;
          errorCode = body.errors[0].code;
        }
      } catch {
        // Ignore JSON parse errors on error responses
      }

      if (status === 401) {
        throw new HunterApiError(401, 'Invalid Hunter.io API key', errorCode);
      }
      if (status === 429) {
        throw new HunterApiError(429, 'Hunter.io rate limit exceeded', errorCode);
      }
      throw new HunterApiError(status, errorMessage, errorCode);
    }

    return (await response.json()) as T;
  }
}
