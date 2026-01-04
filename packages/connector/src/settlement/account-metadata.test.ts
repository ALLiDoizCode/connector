/**
 * Unit tests for account metadata encoding
 *
 * @module settlement/account-metadata.test
 */

import {
  encodeAccountMetadata,
  decodeAccountType,
  isEncodingDeterministic,
} from './account-metadata';
import { AccountType, PeerAccountMetadata } from './types';
import { Account } from 'tigerbeetle-node';

describe('Account Metadata Encoding', () => {
  describe('encodeAccountMetadata', () => {
    it('should encode metadata with non-zero user_data fields', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const encoded = encodeAccountMetadata(metadata);

      expect(encoded.user_data_128).not.toBe(0n);
      expect(encoded.user_data_64).not.toBe(0n);
      expect(encoded.user_data_32).toBe(0); // DEBIT = 0
    });

    it('should encode DEBIT account type as 0', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: 'test-node',
        peerId: 'test-peer',
        tokenId: 'ETH',
        accountType: AccountType.DEBIT,
      };

      const encoded = encodeAccountMetadata(metadata);

      expect(encoded.user_data_32).toBe(0);
    });

    it('should encode CREDIT account type as 1', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: 'test-node',
        peerId: 'test-peer',
        tokenId: 'ETH',
        accountType: AccountType.CREDIT,
      };

      const encoded = encodeAccountMetadata(metadata);

      expect(encoded.user_data_32).toBe(1);
    });

    it('should produce deterministic output for same metadata', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'BTC',
        accountType: AccountType.DEBIT,
      };

      const encoded1 = encodeAccountMetadata(metadata);
      const encoded2 = encodeAccountMetadata(metadata);

      expect(encoded1.user_data_128).toBe(encoded2.user_data_128);
      expect(encoded1.user_data_64).toBe(encoded2.user_data_64);
      expect(encoded1.user_data_32).toBe(encoded2.user_data_32);
    });

    it('should produce different encodings for different nodeIds', () => {
      const metadata1: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const metadata2: PeerAccountMetadata = {
        nodeId: 'connector-x',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const encoded1 = encodeAccountMetadata(metadata1);
      const encoded2 = encodeAccountMetadata(metadata2);

      expect(encoded1.user_data_128).not.toBe(encoded2.user_data_128);
    });

    it('should produce different encodings for different peerIds', () => {
      const metadata1: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const metadata2: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-c',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const encoded1 = encodeAccountMetadata(metadata1);
      const encoded2 = encodeAccountMetadata(metadata2);

      expect(encoded1.user_data_128).not.toBe(encoded2.user_data_128);
    });

    it('should produce different encodings for different tokenIds', () => {
      const metadata1: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const metadata2: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'ETH',
        accountType: AccountType.DEBIT,
      };

      const encoded1 = encodeAccountMetadata(metadata1);
      const encoded2 = encodeAccountMetadata(metadata2);

      expect(encoded1.user_data_64).not.toBe(encoded2.user_data_64);
    });

    it('should produce different encodings for different account types', () => {
      const metadata1: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const metadata2: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.CREDIT,
      };

      const encoded1 = encodeAccountMetadata(metadata1);
      const encoded2 = encodeAccountMetadata(metadata2);

      expect(encoded1.user_data_32).toBe(0);
      expect(encoded2.user_data_32).toBe(1);
    });

    it('should handle empty strings gracefully', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: '',
        peerId: '',
        tokenId: '',
        accountType: AccountType.DEBIT,
      };

      const encoded = encodeAccountMetadata(metadata);

      expect(typeof encoded.user_data_128).toBe('bigint');
      expect(typeof encoded.user_data_64).toBe('bigint');
      expect(typeof encoded.user_data_32).toBe('number');
    });

    it('should handle unicode characters', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: 'connector-日本',
        peerId: 'peer-🚀',
        tokenId: 'ETH-€',
        accountType: AccountType.CREDIT,
      };

      const encoded = encodeAccountMetadata(metadata);

      expect(encoded.user_data_128).not.toBe(0n);
      expect(encoded.user_data_64).not.toBe(0n);
      expect(encoded.user_data_32).toBe(1);
    });
  });

  describe('decodeAccountType', () => {
    it('should decode DEBIT account type from user_data_32 = 0', () => {
      const account = {
        user_data_32: 0,
      } as Account;

      const accountType = decodeAccountType(account);

      expect(accountType).toBe(AccountType.DEBIT);
    });

    it('should decode CREDIT account type from user_data_32 = 1', () => {
      const account = {
        user_data_32: 1,
      } as Account;

      const accountType = decodeAccountType(account);

      expect(accountType).toBe(AccountType.CREDIT);
    });

    it('should return null for invalid user_data_32 value', () => {
      const account = {
        user_data_32: 999,
      } as Account;

      const accountType = decodeAccountType(account);

      expect(accountType).toBeNull();
    });

    it('should return null for unencoded account (user_data_32 = 0 not set)', () => {
      const account = {
        user_data_32: 2,
      } as Account;

      const accountType = decodeAccountType(account);

      expect(accountType).toBeNull();
    });
  });

  describe('isEncodingDeterministic', () => {
    it('should return true for same metadata encoded twice', () => {
      const metadata: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const encoded1 = encodeAccountMetadata(metadata);
      const encoded2 = encodeAccountMetadata(metadata);

      expect(isEncodingDeterministic(encoded1, encoded2)).toBe(true);
    });

    it('should return false for different encodings', () => {
      const metadata1: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const metadata2: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'ETH',
        accountType: AccountType.DEBIT,
      };

      const encoded1 = encodeAccountMetadata(metadata1);
      const encoded2 = encodeAccountMetadata(metadata2);

      expect(isEncodingDeterministic(encoded1, encoded2)).toBe(false);
    });
  });

  describe('Integration with AccountManager', () => {
    it('should encode and decode account type correctly', () => {
      const debitMetadata: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.DEBIT,
      };

      const creditMetadata: PeerAccountMetadata = {
        nodeId: 'connector-a',
        peerId: 'connector-b',
        tokenId: 'USD',
        accountType: AccountType.CREDIT,
      };

      const debitEncoded = encodeAccountMetadata(debitMetadata);
      const creditEncoded = encodeAccountMetadata(creditMetadata);

      // Create mock accounts
      const debitAccount = {
        user_data_32: debitEncoded.user_data_32,
      } as Account;

      const creditAccount = {
        user_data_32: creditEncoded.user_data_32,
      } as Account;

      // Decode and verify
      expect(decodeAccountType(debitAccount)).toBe(AccountType.DEBIT);
      expect(decodeAccountType(creditAccount)).toBe(AccountType.CREDIT);
    });
  });
});
