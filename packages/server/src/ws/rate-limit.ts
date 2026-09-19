export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;

  constructor(
    private maxTokens: number = 60,
    private refillRatePerSec: number = 60
  ) {
    this.tokens = maxTokens;
    this.lastRefillTime = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTime) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSeconds * this.refillRatePerSec);
    this.lastRefillTime = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
