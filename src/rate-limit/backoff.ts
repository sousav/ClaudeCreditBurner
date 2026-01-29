/**
 * Exponential Backoff with Jitter
 */

export interface BackoffConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  jitterFactor: number; // 0-1, amount of randomness to add
}

const DEFAULT_CONFIG: BackoffConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  maxRetries: 10,
  jitterFactor: 0.1,
};

export class ExponentialBackoff {
  private config: BackoffConfig;
  private attempt: number;

  constructor(config: Partial<BackoffConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.attempt = 0;
  }

  /**
   * Calculate delay for current attempt
   */
  getDelay(): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, this.attempt);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter
    const jitter = cappedDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, cappedDelay + jitter);
  }

  /**
   * Record an attempt and return the delay
   */
  nextDelay(): number {
    const delay = this.getDelay();
    this.attempt++;
    return delay;
  }

  /**
   * Check if we can retry
   */
  canRetry(): boolean {
    return this.attempt < this.config.maxRetries;
  }

  /**
   * Get current attempt number
   */
  getAttempt(): number {
    return this.attempt;
  }

  /**
   * Get remaining retries
   */
  getRemainingRetries(): number {
    return Math.max(0, this.config.maxRetries - this.attempt);
  }

  /**
   * Reset the backoff state
   */
  reset(): void {
    this.attempt = 0;
  }

  /**
   * Execute a function with automatic retry and backoff
   */
  async execute<T>(fn: () => Promise<T>, shouldRetry: (error: unknown) => boolean): Promise<T> {
    while (true) {
      try {
        const result = await fn();
        this.reset(); // Reset on success
        return result;
      } catch (error) {
        if (!shouldRetry(error) || !this.canRetry()) {
          throw error;
        }

        const delay = this.nextDelay();
        await sleep(delay);
      }
    }
  }
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a decorrelated jitter backoff (AWS-style)
 * More aggressive spreading than standard exponential backoff
 */
export class DecorrelatedJitterBackoff {
  private config: BackoffConfig;
  private attempt: number;
  private lastDelay: number;

  constructor(config: Partial<BackoffConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.attempt = 0;
    this.lastDelay = this.config.baseDelayMs;
  }

  /**
   * Calculate next delay using decorrelated jitter
   */
  nextDelay(): number {
    if (this.attempt === 0) {
      this.attempt++;
      return this.config.baseDelayMs;
    }

    const delay = Math.min(
      this.config.maxDelayMs,
      Math.random() * (this.lastDelay * 3 - this.config.baseDelayMs) + this.config.baseDelayMs
    );

    this.lastDelay = delay;
    this.attempt++;
    return delay;
  }

  /**
   * Check if we can retry
   */
  canRetry(): boolean {
    return this.attempt < this.config.maxRetries;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.attempt = 0;
    this.lastDelay = this.config.baseDelayMs;
  }
}
