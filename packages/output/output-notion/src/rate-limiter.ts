/**
 * Token bucket rate limiter for Notion API calls.
 * 3 tokens max, refills at 3 per second.
 * Supports exponential backoff on 429 responses.
 */

const MAX_TOKENS = 3;
const REFILL_RATE_MS = 1000 / 3; // one token every ~333ms
const MAX_BACKOFF_MS = 30_000;

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private backoffMs: number;

  constructor() {
    this.tokens = MAX_TOKENS;
    this.lastRefill = Date.now();
    this.backoffMs = 0;
  }

  /**
   * Acquire a token. Waits if no tokens are available or if
   * an exponential backoff is active after a 429 response.
   */
  async acquire(): Promise<void> {
    if (this.backoffMs > 0) {
      await this.sleep(this.backoffMs);
      this.backoffMs = 0;
    }

    this.refill();

    if (this.tokens < 1) {
      const waitMs = REFILL_RATE_MS - (Date.now() - this.lastRefill);
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
      this.refill();
    }

    this.tokens = Math.max(0, this.tokens - 1);
  }

  /**
   * Notify the limiter of a 429 response so it can apply
   * exponential backoff on the next acquire().
   */
  notifyRateLimit(): void {
    this.backoffMs =
      this.backoffMs === 0
        ? 1000
        : Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  /** Reset backoff state (call after a successful request). */
  notifySuccess(): void {
    this.backoffMs = 0;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed / REFILL_RATE_MS;
    this.tokens = Math.min(MAX_TOKENS, this.tokens + newTokens);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
