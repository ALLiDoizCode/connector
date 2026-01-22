/**
 * Rate Limiter for Wallet Operations
 * Story 11.9: Security Hardening for Agent Wallets
 *
 * Implements sliding window rate limiting to prevent abuse of wallet operations.
 * Default: 100 wallet creations/hour per identifier.
 */

import type { Logger } from 'pino';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  walletCreation: number; // Max wallet creations/hour (default: 100)
  fundingRequests: number; // Max funding requests/hour (default: 50)
}

/**
 * Custom error for rate limit exceeded
 */
export class RateLimitExceededError extends Error {
  constructor(operation: string, limit: number) {
    super(`Rate limit exceeded for ${operation}: ${limit}/hour`);
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Rate Limiter
 * Tracks operation counts per identifier using sliding window algorithm
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private logger: Logger;
  private operationTimestamps: Map<string, number[]>; // Map<key, timestamps[]>
  private cleanupInterval?: NodeJS.Timeout;

  // Sliding window duration (1 hour in milliseconds)
  private static readonly WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour

  // Cleanup interval (every 10 minutes)
  private static readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(config: RateLimitConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.operationTimestamps = new Map();

    // Start periodic cleanup of expired timestamps
    this.startPeriodicCleanup();
  }

  /**
   * Check if operation is within rate limit
   * @param operation - Operation type (e.g., 'wallet_creation', 'funding_request')
   * @param identifier - Unique identifier (e.g., agent ID, IP address, API key)
   * @returns True if within limit, false if exceeded
   * @remarks
   * Uses sliding window algorithm: counts operations in last 1 hour
   */
  async checkRateLimit(operation: string, identifier: string): Promise<boolean> {
    const key = `${operation}:${identifier}`;
    const now = Date.now();
    const windowStart = now - RateLimiter.WINDOW_DURATION_MS;

    // Get or initialize timestamps for this key
    let timestamps = this.operationTimestamps.get(key) || [];

    // Remove timestamps outside sliding window
    timestamps = timestamps.filter((timestamp) => timestamp > windowStart);

    // Get limit for this operation
    const limit = this.getLimit(operation);

    // Check if limit exceeded
    if (timestamps.length >= limit) {
      this.logger.warn(
        {
          operation,
          identifier,
          count: timestamps.length,
          limit,
        },
        'Rate limit exceeded'
      );
      return false;
    }

    // Add current timestamp
    timestamps.push(now);
    this.operationTimestamps.set(key, timestamps);

    this.logger.debug(
      {
        operation,
        identifier,
        count: timestamps.length,
        limit,
      },
      'Rate limit check passed'
    );

    return true;
  }

  /**
   * Record operation (increments counter)
   * @param operation - Operation type
   * @param identifier - Unique identifier
   * @remarks
   * This is called automatically by checkRateLimit, but can be called separately
   * if rate limit check and operation recording need to be separated
   */
  recordOperation(operation: string, identifier: string): void {
    const key = `${operation}:${identifier}`;
    const now = Date.now();
    const windowStart = now - RateLimiter.WINDOW_DURATION_MS;

    // Get or initialize timestamps for this key
    let timestamps = this.operationTimestamps.get(key) || [];

    // Remove timestamps outside sliding window
    timestamps = timestamps.filter((timestamp) => timestamp > windowStart);

    // Add current timestamp
    timestamps.push(now);
    this.operationTimestamps.set(key, timestamps);
  }

  /**
   * Get current operation count for identifier
   * @param operation - Operation type
   * @param identifier - Unique identifier
   * @returns Number of operations in current window
   */
  getOperationCount(operation: string, identifier: string): number {
    const key = `${operation}:${identifier}`;
    const now = Date.now();
    const windowStart = now - RateLimiter.WINDOW_DURATION_MS;

    const timestamps = this.operationTimestamps.get(key) || [];
    return timestamps.filter((timestamp) => timestamp > windowStart).length;
  }

  /**
   * Get rate limit for operation
   * @param operation - Operation type
   * @returns Rate limit (operations per hour)
   */
  private getLimit(operation: string): number {
    switch (operation) {
      case 'wallet_creation':
        return this.config.walletCreation;
      case 'funding_request':
        return this.config.fundingRequests;
      default:
        this.logger.warn({ operation }, 'Unknown operation type for rate limiting');
        return 100; // Default limit
    }
  }

  /**
   * Start periodic cleanup of expired timestamps
   * @remarks
   * Runs every 10 minutes to remove old timestamps and free memory
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTimestamps();
    }, RateLimiter.CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Clean up expired timestamps to free memory
   * @remarks
   * Removes all timestamps outside the sliding window (>1 hour old)
   */
  cleanupExpiredTimestamps(): void {
    const now = Date.now();
    const windowStart = now - RateLimiter.WINDOW_DURATION_MS;
    let removedCount = 0;

    for (const [key, timestamps] of this.operationTimestamps.entries()) {
      const activeTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);

      if (activeTimestamps.length === 0) {
        // Remove key entirely if no active timestamps
        this.operationTimestamps.delete(key);
        removedCount++;
      } else if (activeTimestamps.length < timestamps.length) {
        // Update with filtered timestamps
        this.operationTimestamps.set(key, activeTimestamps);
      }
    }

    if (removedCount > 0) {
      this.logger.debug({ removedCount }, 'Cleaned up expired rate limit entries');
    }
  }

  /**
   * Clear all rate limit data
   * @remarks
   * Used for testing or manual reset
   */
  clear(): void {
    this.operationTimestamps.clear();
    this.logger.info('Rate limit data cleared');
  }

  /**
   * Stop periodic cleanup
   * @remarks
   * Call when shutting down to prevent memory leaks
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.logger.info('Rate limiter closed');
  }
}
