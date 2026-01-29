/**
 * Token Bucket Algorithm Implementation
 * Used for rate limiting API requests
 */

export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillRate: number; // tokens per millisecond
  private lastRefill: number;

  /**
   * Create a new token bucket
   * @param capacity Maximum number of tokens
   * @param refillRatePerMinute Rate at which tokens are refilled per minute
   */
  constructor(capacity: number, refillRatePerMinute: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRatePerMinute / 60000; // Convert to per millisecond
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Try to consume tokens from the bucket
   * @param count Number of tokens to consume
   * @returns true if tokens were consumed, false if not enough tokens
   */
  tryConsume(count: number): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /**
   * Get time until enough tokens are available
   * @param count Number of tokens needed
   * @returns Time in milliseconds until tokens are available
   */
  getWaitTime(count: number): number {
    this.refill();

    if (this.tokens >= count) {
      return 0;
    }

    const deficit = count - this.tokens;
    return Math.ceil(deficit / this.refillRate);
  }

  /**
   * Get current token count
   */
  getAvailable(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get fill percentage
   */
  getFillPercentage(): number {
    this.refill();
    return (this.tokens / this.capacity) * 100;
  }

  /**
   * Force set token count (for recovery/testing)
   */
  setTokens(count: number): void {
    this.tokens = Math.min(this.capacity, Math.max(0, count));
    this.lastRefill = Date.now();
  }

  /**
   * Reset bucket to full capacity
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}
