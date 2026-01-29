/**
 * Rate Limit Manager - Orchestrates rate limiting strategy
 */

import type { RateLimitConfig, RateLimitStatus, UsageMetrics, TokenUsage } from '../types';
import { TokenBucket } from './token-bucket';
import { ExponentialBackoff, sleep } from './backoff';
import { getLogger } from '../utils/logger';

export class RateLimitManager {
  private config: RateLimitConfig;
  private rpmBucket: TokenBucket;
  private itpmBucket: TokenBucket;
  private otpmBucket: TokenBucket;
  private backoff: ExponentialBackoff;
  private windowStart: Date;
  private requestCount: number;
  private tokenUsage: TokenUsage;

  constructor(config: RateLimitConfig) {
    this.config = config;

    // Initialize token buckets
    this.rpmBucket = new TokenBucket(config.rpm, config.rpm);
    this.itpmBucket = new TokenBucket(config.itpm, config.itpm);
    this.otpmBucket = new TokenBucket(config.otpm, config.otpm);

    // Initialize backoff strategy
    this.backoff = new ExponentialBackoff({
      baseDelayMs: config.backoffBase * 1000,
      maxDelayMs: config.backoffMax * 1000,
      maxRetries: config.maxRetries,
    });

    // Initialize tracking
    this.windowStart = new Date();
    this.requestCount = 0;
    this.tokenUsage = { input: 0, output: 0, total: 0 };
  }

  /**
   * Acquire permission to make a request
   * @param estimatedInputTokens Estimated input tokens for the request
   * @param estimatedOutputTokens Estimated output tokens for the request
   * @returns Promise that resolves when permission is granted
   */
  async acquirePermit(
    estimatedInputTokens: number,
    estimatedOutputTokens: number = 0
  ): Promise<void> {
    const logger = getLogger();

    // Use while loop instead of recursion to prevent stack overflow
    while (true) {
      // Check RPM limit
      if (!this.rpmBucket.tryConsume(1)) {
        const waitTime = this.rpmBucket.getWaitTime(1);
        logger.rateLimit('waiting', { reason: 'rpm', waitTimeMs: waitTime });
        await sleep(waitTime);
        continue;
      }

      // Check ITPM limit
      if (!this.itpmBucket.tryConsume(estimatedInputTokens)) {
        // Restore RPM token since we couldn't proceed
        this.rpmBucket.setTokens(this.rpmBucket.getAvailable() + 1);
        const waitTime = this.itpmBucket.getWaitTime(estimatedInputTokens);
        logger.rateLimit('waiting', { reason: 'itpm', waitTimeMs: waitTime });
        await sleep(waitTime);
        continue;
      }

      // Check OTPM limit (if estimate provided)
      if (estimatedOutputTokens > 0 && !this.otpmBucket.tryConsume(estimatedOutputTokens)) {
        // Restore RPM and ITPM tokens since we couldn't proceed
        this.rpmBucket.setTokens(this.rpmBucket.getAvailable() + 1);
        this.itpmBucket.setTokens(this.itpmBucket.getAvailable() + estimatedInputTokens);
        const waitTime = this.otpmBucket.getWaitTime(estimatedOutputTokens);
        logger.rateLimit('waiting', { reason: 'otpm', waitTimeMs: waitTime });
        await sleep(waitTime);
        continue;
      }

      // All limits passed
      this.requestCount++;
      return;
    }
  }

  /**
   * Handle a 429 rate limit error
   * @param retryAfterSeconds Optional retry-after value from response headers
   * @returns Wait time in milliseconds
   */
  async handle429Error(retryAfterSeconds?: number): Promise<number> {
    const logger = getLogger();
    logger.rateLimit('hit', { retryAfterSeconds });

    let waitTimeMs: number;

    if (retryAfterSeconds) {
      // Use server-provided retry-after
      waitTimeMs = retryAfterSeconds * 1000;
    } else {
      // Use exponential backoff
      waitTimeMs = this.backoff.nextDelay();
    }

    logger.rateLimit('waiting', { waitTimeMs });
    await sleep(waitTimeMs);
    logger.rateLimit('resumed', {});

    return waitTimeMs;
  }

  /**
   * Update limits from response headers
   */
  updateFromHeaders(headers: Record<string, string | string[] | undefined>): void {
    const getHeader = (name: string): string | undefined => {
      const value = headers[name];
      return Array.isArray(value) ? value[0] : value;
    };

    // Parse rate limit headers (Anthropic format)
    const requestsRemaining = parseInt(
      getHeader('anthropic-ratelimit-requests-remaining') || '',
      10
    );
    const tokensRemaining = parseInt(getHeader('anthropic-ratelimit-tokens-remaining') || '', 10);

    if (!isNaN(requestsRemaining)) {
      this.rpmBucket.setTokens(requestsRemaining);
    }

    if (!isNaN(tokensRemaining)) {
      // Distribute across input/output buckets proportionally
      const currentInputRatio =
        this.itpmBucket.getAvailable() /
        (this.itpmBucket.getAvailable() + this.otpmBucket.getAvailable() || 1);
      this.itpmBucket.setTokens(tokensRemaining * currentInputRatio);
      this.otpmBucket.setTokens(tokensRemaining * (1 - currentInputRatio));
    }
  }

  /**
   * Record actual token usage after a request
   */
  recordUsage(usage: TokenUsage): void {
    this.tokenUsage.input += usage.input;
    this.tokenUsage.output += usage.output;
    this.tokenUsage.total += usage.total;

    // Reset backoff on successful request
    this.backoff.reset();
  }

  /**
   * Get current rate limit status
   */
  getStatus(): RateLimitStatus {
    const rpmWait = this.rpmBucket.getWaitTime(1);
    const itpmWait = this.itpmBucket.getWaitTime(1000); // Check for 1000 tokens
    const otpmWait = this.otpmBucket.getWaitTime(500);

    let isLimited = false;
    let waitTimeMs = 0;
    let reason: 'rpm' | 'itpm' | 'otpm' | undefined;

    if (rpmWait > 0) {
      isLimited = true;
      waitTimeMs = rpmWait;
      reason = 'rpm';
    } else if (itpmWait > 0) {
      isLimited = true;
      waitTimeMs = itpmWait;
      reason = 'itpm';
    } else if (otpmWait > 0) {
      isLimited = true;
      waitTimeMs = otpmWait;
      reason = 'otpm';
    }

    return {
      isLimited,
      waitTimeMs,
      reason,
      usage: this.getUsageMetrics(),
    };
  }

  /**
   * Get current usage metrics
   */
  getUsageMetrics(): UsageMetrics {
    const now = new Date();
    const windowDurationMs = now.getTime() - this.windowStart.getTime();
    const minutesPassed = windowDurationMs / 60000 || 1;

    return {
      currentRpm: this.requestCount / minutesPassed,
      currentItpm: this.tokenUsage.input / minutesPassed,
      currentOtpm: this.tokenUsage.output / minutesPassed,
      windowStart: this.windowStart,
      requestsInWindow: this.requestCount,
      tokensInWindow: { ...this.tokenUsage },
      nextResetTime: new Date(this.windowStart.getTime() + 60000),
    };
  }

  /**
   * Check if we can make a request without waiting
   */
  canRequestImmediately(estimatedTokens: number): boolean {
    return (
      this.rpmBucket.getAvailable() >= 1 &&
      this.itpmBucket.getAvailable() >= estimatedTokens &&
      this.otpmBucket.getAvailable() >= this.config.otpm * 0.1 // At least 10% output capacity
    );
  }

  /**
   * Reset all rate limit state
   */
  reset(): void {
    this.rpmBucket.reset();
    this.itpmBucket.reset();
    this.otpmBucket.reset();
    this.backoff.reset();
    this.windowStart = new Date();
    this.requestCount = 0;
    this.tokenUsage = { input: 0, output: 0, total: 0 };
  }
}
