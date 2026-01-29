/**
 * Tests for Rate Limiting
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TokenBucket } from '../src/rate-limit/token-bucket';
import { ExponentialBackoff } from '../src/rate-limit/backoff';

describe('TokenBucket', () => {
  describe('constructor', () => {
    test('should initialize with full capacity', () => {
      const bucket = new TokenBucket(100, 100);
      expect(bucket.getAvailable()).toBe(100);
      expect(bucket.getCapacity()).toBe(100);
    });
  });

  describe('tryConsume', () => {
    test('should consume tokens when available', () => {
      const bucket = new TokenBucket(100, 100);

      expect(bucket.tryConsume(50)).toBe(true);
      expect(bucket.getAvailable()).toBe(50);
    });

    test('should reject when insufficient tokens', () => {
      const bucket = new TokenBucket(100, 100);

      expect(bucket.tryConsume(150)).toBe(false);
      expect(bucket.getAvailable()).toBe(100);
    });
  });

  describe('getWaitTime', () => {
    test('should return 0 when tokens available', () => {
      const bucket = new TokenBucket(100, 100);
      expect(bucket.getWaitTime(50)).toBe(0);
    });

    test('should return wait time when tokens insufficient', () => {
      const bucket = new TokenBucket(100, 100);
      bucket.tryConsume(100);

      const waitTime = bucket.getWaitTime(50);
      expect(waitTime).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    test('should reset to full capacity', () => {
      const bucket = new TokenBucket(100, 100);
      bucket.tryConsume(100);

      expect(bucket.getAvailable()).toBe(0);

      bucket.reset();
      expect(bucket.getAvailable()).toBe(100);
    });
  });
});

describe('ExponentialBackoff', () => {
  describe('getDelay', () => {
    test('should return base delay on first attempt', () => {
      const backoff = new ExponentialBackoff({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        maxRetries: 10,
        jitterFactor: 0,
      });

      expect(backoff.getDelay()).toBe(1000);
    });

    test('should increase delay exponentially', () => {
      const backoff = new ExponentialBackoff({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        maxRetries: 10,
        jitterFactor: 0,
      });

      backoff.nextDelay(); // First delay
      expect(backoff.getDelay()).toBe(2000);

      backoff.nextDelay(); // Second delay
      expect(backoff.getDelay()).toBe(4000);
    });

    test('should cap at max delay', () => {
      const backoff = new ExponentialBackoff({
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        maxRetries: 10,
        jitterFactor: 0,
      });

      // Advance several times
      for (let i = 0; i < 10; i++) {
        backoff.nextDelay();
      }

      expect(backoff.getDelay()).toBe(5000);
    });
  });

  describe('canRetry', () => {
    test('should allow retries within limit', () => {
      const backoff = new ExponentialBackoff({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        maxRetries: 3,
        jitterFactor: 0,
      });

      expect(backoff.canRetry()).toBe(true);
      backoff.nextDelay();
      expect(backoff.canRetry()).toBe(true);
      backoff.nextDelay();
      expect(backoff.canRetry()).toBe(true);
      backoff.nextDelay();
      expect(backoff.canRetry()).toBe(false);
    });
  });

  describe('reset', () => {
    test('should reset attempt count', () => {
      const backoff = new ExponentialBackoff({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        maxRetries: 3,
        jitterFactor: 0,
      });

      backoff.nextDelay();
      backoff.nextDelay();
      backoff.nextDelay();
      expect(backoff.canRetry()).toBe(false);

      backoff.reset();
      expect(backoff.canRetry()).toBe(true);
      expect(backoff.getAttempt()).toBe(0);
    });
  });
});
