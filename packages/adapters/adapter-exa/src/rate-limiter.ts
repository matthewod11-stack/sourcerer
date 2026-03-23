// Simple delay-based rate limiter

export class RateLimiter {
  private minDelayMs: number;
  private lastRequestTime = 0;

  constructor(requestsPerSecond: number) {
    this.minDelayMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minDelayMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}
