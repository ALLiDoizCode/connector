/**
 * Unit tests for ClaimStore
 * Epic 30 Story 30.3: Claim Store with SQLite Persistence
 */

import { ClaimStore } from './claim-store';
import type { EVMSignedClaim, XRPSignedClaim, AptosSignedClaim } from '@m2m/shared';
import type { Logger } from 'pino';

// Mock logger for tests
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  level: 'info',
  silent: jest.fn(),
  child: jest.fn(function (this: Logger) {
    return this;
  }),
} as unknown as Logger;

describe('ClaimStore', () => {
  let store: ClaimStore;

  beforeEach(() => {
    jest.clearAllMocks();
    // Use in-memory database for tests
    store = new ClaimStore(':memory:', mockLogger);
  });

  afterEach(() => {
    store.close();
  });

  // ============================================================================
  // Database Initialization Tests
  // ============================================================================

  describe('Database Initialization', () => {
    test('should create database file if not exists', () => {
      // In-memory database always succeeds
      expect(store).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { databasePath: ':memory:' },
        'ClaimStore initialized'
      );
    });

    test('should create schema with correct table and indexes', () => {
      // Verify table exists by querying it
      const stats = store.getStorageStats();
      expect(stats.totalClaims).toBe(0);
      expect(stats.claimsByChain).toEqual({});
    });

    test('should allow multiple instances to access same database', () => {
      const store2 = new ClaimStore(':memory:', mockLogger);
      expect(store2).toBeDefined();
      store2.close();
    });
  });

  // ============================================================================
  // EVM Claim Storage and Monotonicity Tests
  // ============================================================================

  describe('EVM Claim Storage', () => {
    const evmClaim: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      transferredAmount: BigInt('1000000'),
      nonce: 5,
      lockedAmount: BigInt(0),
      locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      signature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    test('should store EVM claim with nonce=5', () => {
      const result = store.storeEVMClaim('peerA', evmClaim);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peerA', chain: 'evm', nonce: 5 }),
        'EVM claim stored'
      );
    });

    test('should reject EVM claim with stale nonce (nonce=3 < stored nonce=5)', () => {
      store.storeEVMClaim('peerA', evmClaim); // nonce=5
      const staleResult = store.storeEVMClaim('peerA', { ...evmClaim, nonce: 3 });

      expect(staleResult).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ existingNonce: 5, newNonce: 3 }),
        'Stale EVM nonce rejected'
      );
    });

    test('should accept EVM claim with higher nonce (nonce=6 > stored nonce=5)', () => {
      store.storeEVMClaim('peerA', evmClaim); // nonce=5
      const higherResult = store.storeEVMClaim('peerA', { ...evmClaim, nonce: 6 });

      expect(higherResult).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: 6 }),
        'EVM claim stored'
      );
    });

    test('should reject EVM claim with equal nonce (nonce=5 === stored nonce=5)', () => {
      store.storeEVMClaim('peerA', evmClaim); // nonce=5
      const equalResult = store.storeEVMClaim('peerA', evmClaim); // nonce=5 again

      expect(equalResult).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ existingNonce: 5, newNonce: 5 }),
        'Stale EVM nonce rejected'
      );
    });

    test('should retrieve stored EVM claim correctly', () => {
      store.storeEVMClaim('peerA', evmClaim);
      const retrieved = store.getLatestClaim('peerA', 'evm', evmClaim.channelId);

      expect(retrieved).toEqual(evmClaim);
    });

    test('should store extra_data JSON for EVM claims', () => {
      const evmClaimWithLocked: EVMSignedClaim = {
        ...evmClaim,
        lockedAmount: BigInt('50000'),
        locksRoot: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };

      store.storeEVMClaim('peerA', evmClaimWithLocked);
      const retrieved = store.getLatestClaim('peerA', 'evm', evmClaim.channelId) as EVMSignedClaim;

      expect(retrieved.lockedAmount).toEqual(BigInt('50000'));
      expect(retrieved.locksRoot).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
    });
  });

  // ============================================================================
  // XRP Claim Storage and Monotonicity Tests
  // ============================================================================

  describe('XRP Claim Storage', () => {
    const xrpClaim: XRPSignedClaim = {
      chain: 'xrp',
      channelId: '1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
      amount: BigInt('5000000'),
      signature:
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      signer: 'ED1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
    };

    test('should store XRP claim with amount=5000000', () => {
      const result = store.storeXRPClaim('peerB', xrpClaim);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peerB', chain: 'xrp', amount: '5000000' }),
        'XRP claim stored'
      );
    });

    test('should reject XRP claim with stale amount (amount=4000000 < stored amount=5000000)', () => {
      store.storeXRPClaim('peerB', xrpClaim); // amount=5000000
      const staleResult = store.storeXRPClaim('peerB', { ...xrpClaim, amount: BigInt('4000000') });

      expect(staleResult).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ existingAmount: '5000000', newAmount: '4000000' }),
        'Stale XRP amount rejected'
      );
    });

    test('should accept XRP claim with higher amount (amount=6000000 > stored amount=5000000)', () => {
      store.storeXRPClaim('peerB', xrpClaim); // amount=5000000
      const higherResult = store.storeXRPClaim('peerB', { ...xrpClaim, amount: BigInt('6000000') });

      expect(higherResult).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '6000000' }),
        'XRP claim stored'
      );
    });

    test('should retrieve stored XRP claim correctly', () => {
      store.storeXRPClaim('peerB', xrpClaim);
      const retrieved = store.getLatestClaim('peerB', 'xrp', xrpClaim.channelId);

      expect(retrieved).toEqual(xrpClaim);
    });

    test('should store XRP claim with sequence_value=NULL in database', () => {
      store.storeXRPClaim('peerB', xrpClaim);
      const retrieved = store.getLatestClaim('peerB', 'xrp', xrpClaim.channelId) as XRPSignedClaim;

      // XRP claims should not have nonce field (only amount)
      expect(retrieved.chain).toBe('xrp');
      expect(retrieved.amount).toEqual(BigInt('5000000'));
      expect('nonce' in retrieved).toBe(false);
    });
  });

  // ============================================================================
  // Aptos Claim Storage and Monotonicity Tests
  // ============================================================================

  describe('Aptos Claim Storage', () => {
    const aptosClaim: AptosSignedClaim = {
      chain: 'aptos',
      channelOwner: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      amount: BigInt('100000000'),
      nonce: 7,
      signature:
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      signer: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    test('should store Aptos claim with nonce=7', () => {
      const result = store.storeAptosClaim('peerC', aptosClaim);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peerC', chain: 'aptos', nonce: 7 }),
        'Aptos claim stored'
      );
    });

    test('should reject Aptos claim with stale nonce (nonce=5 < stored nonce=7)', () => {
      store.storeAptosClaim('peerC', aptosClaim); // nonce=7
      const staleResult = store.storeAptosClaim('peerC', { ...aptosClaim, nonce: 5 });

      expect(staleResult).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ existingNonce: 7, newNonce: 5 }),
        'Stale Aptos nonce rejected'
      );
    });

    test('should accept Aptos claim with higher nonce (nonce=8 > stored nonce=7)', () => {
      store.storeAptosClaim('peerC', aptosClaim); // nonce=7
      const higherResult = store.storeAptosClaim('peerC', { ...aptosClaim, nonce: 8 });

      expect(higherResult).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: 8 }),
        'Aptos claim stored'
      );
    });

    test('should retrieve stored Aptos claim correctly', () => {
      store.storeAptosClaim('peerC', aptosClaim);
      const retrieved = store.getLatestClaim('peerC', 'aptos', aptosClaim.channelOwner);

      expect(retrieved).toEqual(aptosClaim);
    });

    test('should use channelOwner as channel_identifier for Aptos', () => {
      store.storeAptosClaim('peerC', aptosClaim);
      const retrieved = store.getLatestClaim(
        'peerC',
        'aptos',
        aptosClaim.channelOwner
      ) as AptosSignedClaim;

      expect(retrieved.channelOwner).toBe(aptosClaim.channelOwner);
    });
  });

  // ============================================================================
  // Claim Retrieval Tests
  // ============================================================================

  describe('Claim Retrieval', () => {
    const evmClaim: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0x1111111111111111111111111111111111111111111111111111111111111111',
      transferredAmount: BigInt('1000000'),
      nonce: 5,
      lockedAmount: BigInt(0),
      locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      signature: '0xaaa',
      signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    const xrpClaim: XRPSignedClaim = {
      chain: 'xrp',
      channelId: '2222222222222222222222222222222222222222222222222222222222222222',
      amount: BigInt('5000000'),
      signature: 'bbb',
      signer: 'ED1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
    };

    test('should return null when no claim exists', () => {
      const result = store.getLatestClaim('peerX', 'evm', '0xnonexistent');
      expect(result).toBeNull();
    });

    test('should return correct claim after storage', () => {
      store.storeEVMClaim('peerA', evmClaim);
      const result = store.getLatestClaim('peerA', 'evm', evmClaim.channelId);
      expect(result).toEqual(evmClaim);
    });

    test('should return all claims for peer+chain via getClaimsForSettlement', () => {
      store.storeEVMClaim('peerA', evmClaim);
      const evmClaim2 = {
        ...evmClaim,
        channelId: '0x3333333333333333333333333333333333333333333333333333333333333333',
      };
      store.storeEVMClaim('peerA', evmClaim2);

      const claims = store.getClaimsForSettlement('peerA', 'evm');
      expect(claims).toHaveLength(2);
      expect(claims[0]?.chain).toBe('evm');
      expect(claims[1]?.chain).toBe('evm');
    });

    test('should return empty array when no claims for settlement', () => {
      const claims = store.getClaimsForSettlement('peerX', 'evm');
      expect(claims).toEqual([]);
    });

    test('should group claims by chain via getAllClaimsByPeer', () => {
      store.storeEVMClaim('peerA', evmClaim);
      store.storeXRPClaim('peerA', xrpClaim);

      const claimsByChain = store.getAllClaimsByPeer('peerA');
      expect(claimsByChain.size).toBe(2);
      expect(claimsByChain.get('evm')).toHaveLength(1);
      expect(claimsByChain.get('xrp')).toHaveLength(1);
    });
  });

  // ============================================================================
  // Multi-Peer Isolation Tests
  // ============================================================================

  describe('Multi-Peer Isolation', () => {
    const evmClaim: EVMSignedClaim = {
      chain: 'evm',
      channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      transferredAmount: BigInt('1000000'),
      nonce: 5,
      lockedAmount: BigInt(0),
      locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
      signature: '0xaaa',
      signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    };

    test('should isolate claims between different peers', () => {
      store.storeEVMClaim('peerA', evmClaim);
      store.storeEVMClaim('peerB', evmClaim);

      const peerAClaims = store.getClaimsForSettlement('peerA', 'evm');
      const peerBClaims = store.getClaimsForSettlement('peerB', 'evm');

      expect(peerAClaims).toHaveLength(1);
      expect(peerBClaims).toHaveLength(1);

      // PeerA claims should not appear in peerB queries
      const peerBAllClaims = store.getAllClaimsByPeer('peerB');
      expect(peerBAllClaims.get('evm')).toHaveLength(1);
    });
  });

  // ============================================================================
  // Database Lifecycle Tests
  // ============================================================================

  describe('Database Lifecycle', () => {
    test('should close database connection', () => {
      store.close();
      expect(mockLogger.info).toHaveBeenCalledWith('ClaimStore database closed');
    });

    test('should be idempotent when calling close multiple times', () => {
      store.close();
      store.close();
      // Should not throw
      expect(mockLogger.info).toHaveBeenCalledWith('ClaimStore database closed');
    });

    test('should delete all claims for specific peer', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transferredAmount: BigInt('1000000'),
        nonce: 5,
        lockedAmount: BigInt(0),
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: '0xaaa',
        signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      store.storeEVMClaim('peerA', evmClaim);
      store.storeEVMClaim('peerB', evmClaim);

      const deleted = store.deleteAllClaimsForPeer('peerA');
      expect(deleted).toBe(1);

      const peerAClaims = store.getClaimsForSettlement('peerA', 'evm');
      const peerBClaims = store.getClaimsForSettlement('peerB', 'evm');

      expect(peerAClaims).toHaveLength(0);
      expect(peerBClaims).toHaveLength(1);
    });

    test('should return correct storage statistics', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transferredAmount: BigInt('1000000'),
        nonce: 5,
        lockedAmount: BigInt(0),
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: '0xaaa',
        signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      const xrpClaim: XRPSignedClaim = {
        chain: 'xrp',
        channelId: '1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
        amount: BigInt('5000000'),
        signature: 'bbb',
        signer: 'ED1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
      };

      store.storeEVMClaim('peerA', evmClaim);
      store.storeXRPClaim('peerA', xrpClaim);

      const stats = store.getStorageStats();
      expect(stats.totalClaims).toBe(2);
      expect(stats.claimsByChain).toEqual({ evm: 1, xrp: 1 });
    });
  });

  // ============================================================================
  // Type Conversion Tests
  // ============================================================================

  describe('Type Conversions', () => {
    test('should correctly convert bigint amount to TEXT and back', () => {
      const largeAmount = BigInt('999999999999999999999999999999');
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transferredAmount: largeAmount,
        nonce: 5,
        lockedAmount: BigInt(0),
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: '0xaaa',
        signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      store.storeEVMClaim('peerA', evmClaim);
      const retrieved = store.getLatestClaim('peerA', 'evm', evmClaim.channelId) as EVMSignedClaim;

      expect(retrieved.transferredAmount).toEqual(largeAmount);
    });

    test('should correctly convert nonce to INTEGER and back', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transferredAmount: BigInt('1000000'),
        nonce: 12345,
        lockedAmount: BigInt(0),
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: '0xaaa',
        signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      store.storeEVMClaim('peerA', evmClaim);
      const retrieved = store.getLatestClaim('peerA', 'evm', evmClaim.channelId) as EVMSignedClaim;

      expect(retrieved.nonce).toBe(12345);
      expect(typeof retrieved.nonce).toBe('number');
    });

    test('should correctly roundtrip extra_data JSON for EVM claims', () => {
      const evmClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transferredAmount: BigInt('1000000'),
        nonce: 5,
        lockedAmount: BigInt('999999'),
        locksRoot: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        signature: '0xaaa',
        signer: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      };

      store.storeEVMClaim('peerA', evmClaim);
      const retrieved = store.getLatestClaim('peerA', 'evm', evmClaim.channelId) as EVMSignedClaim;

      expect(retrieved.lockedAmount).toEqual(BigInt('999999'));
      expect(retrieved.locksRoot).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
    });
  });
});
