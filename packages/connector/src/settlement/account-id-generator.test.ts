/**
 * Unit tests for deterministic account ID generation
 *
 * @module settlement/account-id-generator.test
 */

import { generateAccountId, isValidAccountId } from './account-id-generator';
import { AccountType } from './types';

describe('Account ID Generator', () => {
  describe('generateAccountId', () => {
    it('should generate a non-zero bigint account ID', () => {
      const accountId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      expect(typeof accountId).toBe('bigint');
      expect(accountId).not.toBe(0n);
      expect(accountId).toBeGreaterThan(0n);
    });

    it('should generate same account ID for same inputs (determinism)', () => {
      const accountId1 = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      const accountId2 = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      expect(accountId1).toBe(accountId2);
    });

    it('should generate different IDs for different account types', () => {
      const debitId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      const creditId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.CREDIT);

      expect(debitId).not.toBe(creditId);
    });

    it('should generate different IDs for different peer IDs', () => {
      const peerAId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      const peerBId = generateAccountId('connector-a', 'connector-c', 'USD', AccountType.DEBIT);

      expect(peerAId).not.toBe(peerBId);
    });

    it('should generate different IDs for different token IDs', () => {
      const usdId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      const ethId = generateAccountId('connector-a', 'connector-b', 'ETH', AccountType.DEBIT);

      expect(usdId).not.toBe(ethId);
    });

    it('should generate different IDs for different node IDs', () => {
      const nodeAId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      const nodeBId = generateAccountId('connector-b', 'connector-b', 'USD', AccountType.DEBIT);

      expect(nodeAId).not.toBe(nodeBId);
    });

    it('should generate unique IDs for multiple peer-token combinations', () => {
      // Generate IDs for 10 different combinations
      const ids = new Set<bigint>();

      for (let i = 0; i < 10; i++) {
        const debitId = generateAccountId('connector-a', `peer-${i}`, 'USD', AccountType.DEBIT);
        const creditId = generateAccountId('connector-a', `peer-${i}`, 'USD', AccountType.CREDIT);

        ids.add(debitId);
        ids.add(creditId);
      }

      // Verify all 20 IDs are unique
      expect(ids.size).toBe(20);
    });

    it('should handle special characters in peer/token IDs', () => {
      const id1 = generateAccountId('connector-a', 'peer-with-dashes', 'USD', AccountType.DEBIT);

      const id2 = generateAccountId('connector-a', 'peer.with.dots', 'USD', AccountType.DEBIT);

      expect(id1).not.toBe(id2);
      expect(id1).toBeGreaterThan(0n);
      expect(id2).toBeGreaterThan(0n);
    });

    it('should generate consistent IDs across multiple calls', () => {
      // Generate same ID 100 times
      const expectedId = generateAccountId('test-node', 'test-peer', 'BTC', AccountType.DEBIT);

      for (let i = 0; i < 100; i++) {
        const id = generateAccountId('test-node', 'test-peer', 'BTC', AccountType.DEBIT);
        expect(id).toBe(expectedId);
      }
    });
  });

  describe('isValidAccountId', () => {
    it('should return true for valid non-zero bigint', () => {
      const validId = 123456789012345678901234567890n;
      expect(isValidAccountId(validId)).toBe(true);
    });

    it('should return false for zero', () => {
      expect(isValidAccountId(0n)).toBe(false);
    });

    it('should return false for negative bigint', () => {
      expect(isValidAccountId(-123n)).toBe(false);
    });

    it('should return false for non-bigint types', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidAccountId(123 as any)).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidAccountId('123' as any)).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidAccountId(null as any)).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidAccountId(undefined as any)).toBe(false);
    });

    it('should validate generated account IDs', () => {
      const accountId = generateAccountId('connector-a', 'connector-b', 'USD', AccountType.DEBIT);

      expect(isValidAccountId(accountId)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings gracefully', () => {
      // Empty strings are technically valid inputs (though not recommended)
      const id = generateAccountId('', '', '', AccountType.DEBIT);
      expect(typeof id).toBe('bigint');
      expect(id).toBeGreaterThan(0n);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const id = generateAccountId(longString, longString, longString, AccountType.DEBIT);
      expect(typeof id).toBe('bigint');
      expect(id).toBeGreaterThan(0n);
    });

    it('should handle unicode characters', () => {
      const id = generateAccountId('connector-日本', 'peer-🚀', 'ETH-€', AccountType.CREDIT);
      expect(typeof id).toBe('bigint');
      expect(id).toBeGreaterThan(0n);
    });
  });
});
