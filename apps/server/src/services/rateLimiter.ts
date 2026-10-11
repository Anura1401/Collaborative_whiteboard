export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillRatePerSec: number;
  private lastRefillMs: number;

  constructor(ratePerSec: number, burstMultiplier = 2) {
    this.capacity = ratePerSec * burstMultiplier;
    this.tokens = this.capacity;
    this.refillRatePerSec = ratePerSec;
    this.lastRefillMs = Date.now();
  }

  public tryConsume(tokens = 1): boolean {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRatePerSec);
    this.lastRefillMs = now;

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }
}

export class RateLimiterTracker {
  public readonly opBucket: TokenBucket;
  public readonly ephemeralBucket: TokenBucket;
  private violationTimestamps: number[] = [];

  constructor(opRate: number, ephemeralRate: number) {
    this.opBucket = new TokenBucket(opRate, 2);
    this.ephemeralBucket = new TokenBucket(ephemeralRate, 2);
  }

  public recordViolation(): boolean {
    const now = Date.now();
    this.violationTimestamps.push(now);
    // Prune violations older than 10 seconds
    this.violationTimestamps = this.violationTimestamps.filter((t) => now - t <= 10000);
    return this.violationTimestamps.length > 100;
  }
}
