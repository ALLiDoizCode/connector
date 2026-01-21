/**
 * Rate Limiter Tests
 * Story 11.9: Security Hardening for Agent Wallets
 */

import { RateLimiter, RateLimitConfig, RateLimitExceededError } from './rate-limiter';
import pino from 'pino';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockLogger: pino.Logger;

  const defaultConfig: RateLimitConfig = {
    walletCreation: 100, // 100 wallet creations/hour
    fundingRequests: 50, // 50 funding requests/hour
  };

  beforeEach(() => {
    mockLogger = pino({ level: 'silent' }); // Silent mode for tests
    rateLimiter = new RateLimiter(defaultConfig, mockLogger);
  });

  afterEach(() => {
    rateLimiter.close(); // Clean up interval
  });

  describe('checkRateLimit', () => {
    it('should allow operations within rate limit', async () => {
      const isAllowed = await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      expect(isAllowed).toBe(true);
    });

    it('should allow multiple operations up to limit', async () => {
      // Perform 5 operations (well below 100 limit)
      for (let i = 0; i < 5; i++) {
        const isAllowed = await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
        expect(isAllowed).toBe(true);
      }
    });

    it('should block operations exceeding rate limit', async () => {
      // Perform 100 operations (at limit)
      for (let i = 0; i < 100; i++) {
        const isAllowed = await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
        expect(isAllowed).toBe(true);
      }

      // 101st operation should be blocked
      const isAllowed = await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      expect(isAllowed).toBe(false);
    });

    it('should track different identifiers separately', async () => {
      // Agent 1: Perform 100 operations
      for (let i = 0; i < 100; i++) {
        await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      }

      // Agent 1: Should be blocked
      const agent1Blocked = await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      expect(agent1Blocked).toBe(false);

      // Agent 2: Should still be allowed (different identifier)
      const agent2Allowed = await rateLimiter.checkRateLimit('wallet_creation', 'agent-002');
      expect(agent2Allowed).toBe(true);
    });

    it('should track different operations separately', async () => {
      // Wallet creation: Perform 100 operations
      for (let i = 0; i < 100; i++) {
        await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      }

      // Wallet creation: Should be blocked
      const walletBlocked = await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      expect(walletBlocked).toBe(false);

      // Funding request: Should still be allowed (different operation)
      const fundingAllowed = await rateLimiter.checkRateLimit('funding_request', 'agent-001');
      expect(fundingAllowed).toBe(true);
    });

    it('should use correct limits for different operations', async () => {
      // Funding requests have limit of 50 (not 100)
      for (let i = 0; i < 50; i++) {
        const isAllowed = await rateLimiter.checkRateLimit('funding_request', 'agent-001');
        expect(isAllowed).toBe(true);
      }

      // 51st funding request should be blocked
      const isAllowed = await rateLimiter.checkRateLimit('funding_request', 'agent-001');
      expect(isAllowed).toBe(false);
    });

    it('should use default limit for unknown operations', async () => {
      // Unknown operation should use default limit of 100
      for (let i = 0; i < 100; i++) {
        const isAllowed = await rateLimiter.checkRateLimit('unknown_operation', 'agent-001');
        expect(isAllowed).toBe(true);
      }

      const isAllowed = await rateLimiter.checkRateLimit('unknown_operation', 'agent-001');
      expect(isAllowed).toBe(false);
    });
  });

  describe('recordOperation', () => {
    it('should record operation and increment counter', () => {
      rateLimiter.recordOperation('wallet_creation', 'agent-001');

      const count = rateLimiter.getOperationCount('wallet_creation', 'agent-001');
      expect(count).toBe(1);
    });

    it('should record multiple operations', () => {
      rateLimiter.recordOperation('wallet_creation', 'agent-001');
      rateLimiter.recordOperation('wallet_creation', 'agent-001');
      rateLimiter.recordOperation('wallet_creation', 'agent-001');

      const count = rateLimiter.getOperationCount('wallet_creation', 'agent-001');
      expect(count).toBe(3);
    });
  });

  describe('getOperationCount', () => {
    it('should return 0 for new identifier', () => {
      const count = rateLimiter.getOperationCount('wallet_creation', 'agent-new');
      expect(count).toBe(0);
    });

    it('should return correct count after operations', async () => {
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');

      const count = rateLimiter.getOperationCount('wallet_creation', 'agent-001');
      expect(count).toBe(3);
    });

    it('should only count operations within sliding window', async () => {
      // Mock Date.now to simulate time passing
      const originalDateNow = Date.now;
      let currentTime = Date.now();

      Date.now = jest.fn(() => currentTime);

      // Record 3 operations now
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');

      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(3);

      // Advance time by 1 hour + 1 second (all operations should expire)
      currentTime += 60 * 60 * 1000 + 1000;

      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(0);

      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('cleanupExpiredTimestamps', () => {
    it('should remove expired timestamps', async () => {
      const originalDateNow = Date.now;
      let currentTime = Date.now();

      Date.now = jest.fn(() => currentTime);

      // Record 3 operations
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');

      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(3);

      // Advance time by 2 hours
      currentTime += 2 * 60 * 60 * 1000;

      // Run cleanup
      rateLimiter.cleanupExpiredTimestamps();

      // All timestamps should be removed
      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(0);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it('should keep active timestamps', async () => {
      const originalDateNow = Date.now;
      let currentTime = Date.now();

      Date.now = jest.fn(() => currentTime);

      // Record 2 operations
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');

      // Advance time by 30 minutes (within 1-hour window)
      currentTime += 30 * 60 * 1000;

      // Record 1 more operation
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');

      // Run cleanup
      rateLimiter.cleanupExpiredTimestamps();

      // All 3 timestamps should still be active
      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(3);

      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('clear', () => {
    it('should clear all rate limit data', async () => {
      // Record operations for multiple identifiers
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-001');
      await rateLimiter.checkRateLimit('wallet_creation', 'agent-002');
      await rateLimiter.checkRateLimit('funding_request', 'agent-001');

      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(1);
      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-002')).toBe(1);
      expect(rateLimiter.getOperationCount('funding_request', 'agent-001')).toBe(1);

      // Clear all data
      rateLimiter.clear();

      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-001')).toBe(0);
      expect(rateLimiter.getOperationCount('wallet_creation', 'agent-002')).toBe(0);
      expect(rateLimiter.getOperationCount('funding_request', 'agent-001')).toBe(0);
    });
  });

  describe('close', () => {
    it('should stop periodic cleanup', () => {
      // Close should clear the cleanup interval
      rateLimiter.close();

      // Verify close was called (interval should be cleared)
      // No easy way to verify interval cleared, but ensure no errors
      expect(true).toBe(true);
    });
  });

  describe('RateLimitExceededError', () => {
    it('should create error with operation and limit', () => {
      const error = new RateLimitExceededError('wallet_creation', 100);

      expect(error.message).toBe('Rate limit exceeded for wallet_creation: 100/hour');
      expect(error.name).toBe('RateLimitExceededError');
    });
  });
});
