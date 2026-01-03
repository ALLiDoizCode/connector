/**
 * Unit tests for AccountManager
 *
 * @module settlement/account-manager.test
 */

import { AccountManager } from './account-manager';
import { TigerBeetleClient } from './tigerbeetle-client';
import { TigerBeetleAccountError } from './tigerbeetle-errors';
import { AccountLedgerCodes } from './types';
import { Logger } from 'pino';
import pino from 'pino';

// Mock TigerBeetleClient
jest.mock('./tigerbeetle-client');

describe('AccountManager', () => {
  let accountManager: AccountManager;
  let mockTigerBeetleClient: jest.Mocked<TigerBeetleClient>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create mock logger with jest mock functions
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
      child: jest.fn().mockReturnThis(),
      level: 'silent',
      silent: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create mock TigerBeetleClient
    mockTigerBeetleClient = new TigerBeetleClient(
      { clusterId: 0, replicaAddresses: ['localhost:3000'] },
      pino({ level: 'silent' })
    ) as jest.Mocked<TigerBeetleClient>;

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with valid config', () => {
      accountManager = new AccountManager(
        { nodeId: 'test-node' },
        mockTigerBeetleClient,
        mockLogger
      );

      expect(accountManager).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'test-node',
          defaultLedger: AccountLedgerCodes.DEFAULT_LEDGER,
          creditLimitsEnabled: false,
        }),
        'AccountManager initialized (credit limits disabled - unlimited exposure)'
      );
    });

    it('should initialize cache as empty', () => {
      accountManager = new AccountManager(
        { nodeId: 'test-node' },
        mockTigerBeetleClient,
        mockLogger
      );

      const stats = accountManager.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should use custom default ledger if provided', () => {
      accountManager = new AccountManager(
        { nodeId: 'test-node', defaultLedger: 99 },
        mockTigerBeetleClient,
        mockLogger
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'test-node',
          defaultLedger: 99,
          creditLimitsEnabled: false,
        }),
        'AccountManager initialized (credit limits disabled - unlimited exposure)'
      );
    });
  });

  describe('Peer Account Creation', () => {
    beforeEach(() => {
      accountManager = new AccountManager(
        { nodeId: 'test-node' },
        mockTigerBeetleClient,
        mockLogger
      );

      // Mock successful account creation
      mockTigerBeetleClient.createAccountsBatch = jest.fn().mockResolvedValue(undefined);
    });

    it('should create debit and credit accounts for peer', async () => {
      const accountPair = await accountManager.createPeerAccounts('peer-a', 'USD');

      // Verify createAccountsBatch called with 2 accounts
      expect(mockTigerBeetleClient.createAccountsBatch).toHaveBeenCalledTimes(1);
      expect(mockTigerBeetleClient.createAccountsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            ledger: AccountLedgerCodes.DEFAULT_LEDGER,
            code: AccountLedgerCodes.ACCOUNT_CODE_PEER_DEBIT,
          }),
          expect.objectContaining({
            ledger: AccountLedgerCodes.DEFAULT_LEDGER,
            code: AccountLedgerCodes.ACCOUNT_CODE_PEER_CREDIT,
          }),
        ])
      );

      // Verify returned account pair
      expect(accountPair).toMatchObject({
        peerId: 'peer-a',
        tokenId: 'USD',
      });
      expect(typeof accountPair.debitAccountId).toBe('bigint');
      expect(typeof accountPair.creditAccountId).toBe('bigint');
      expect(accountPair.debitAccountId).not.toBe(0n);
      expect(accountPair.creditAccountId).not.toBe(0n);
    });

    it('should generate deterministic account IDs', async () => {
      const accountPair1 = await accountManager.createPeerAccounts('peer-b', 'ETH');
      const accountPair2 = await accountManager.createPeerAccounts('peer-b', 'ETH');

      // Same peer and token should generate same IDs
      expect(accountPair1.debitAccountId).toBe(accountPair2.debitAccountId);
      expect(accountPair1.creditAccountId).toBe(accountPair2.creditAccountId);
    });

    it('should create accounts with correct ledger and codes', async () => {
      await accountManager.createPeerAccounts('peer-c', 'BTC');

      const callArgs = mockTigerBeetleClient.createAccountsBatch.mock.calls[0]![0];

      // Verify debit account
      const debitAccount = callArgs.find(
        (acc) => acc.code === AccountLedgerCodes.ACCOUNT_CODE_PEER_DEBIT
      );
      expect(debitAccount).toBeDefined();
      expect(debitAccount!.ledger).toBe(AccountLedgerCodes.DEFAULT_LEDGER);

      // Verify credit account
      const creditAccount = callArgs.find(
        (acc) => acc.code === AccountLedgerCodes.ACCOUNT_CODE_PEER_CREDIT
      );
      expect(creditAccount).toBeDefined();
      expect(creditAccount!.ledger).toBe(AccountLedgerCodes.DEFAULT_LEDGER);
    });

    it('should handle duplicate account creation gracefully', async () => {
      // Mock error for duplicate account
      mockTigerBeetleClient.createAccountsBatch = jest
        .fn()
        .mockRejectedValue(new TigerBeetleAccountError('Account creation failed: exists', 123n));

      // Should NOT throw error (idempotent)
      const accountPair = await accountManager.createPeerAccounts('peer-d', 'USD');

      // Should return account IDs
      expect(accountPair).toBeDefined();
      expect(accountPair.peerId).toBe('peer-d');
      expect(accountPair.tokenId).toBe('USD');

      // Should log at INFO level (not error)
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId: 'peer-d',
          tokenId: 'USD',
        }),
        'Accounts already exist for peer (idempotent operation)'
      );
    });

    it('should add created accounts to cache', async () => {
      await accountManager.createPeerAccounts('peer-e', 'USD');

      const stats = accountManager.getCacheStats();
      expect(stats.size).toBe(1);

      // Should retrieve from cache on second call
      const accountPair = accountManager.getPeerAccountPair('peer-e', 'USD');
      expect(accountPair).toBeDefined();
    });

    it('should throw error for non-duplicate account failures', async () => {
      // Mock error for validation failure (not duplicate)
      mockTigerBeetleClient.createAccountsBatch = jest
        .fn()
        .mockRejectedValue(
          new TigerBeetleAccountError('Account creation failed: invalid_flags', 123n)
        );

      // Should throw error
      await expect(accountManager.createPeerAccounts('peer-f', 'USD')).rejects.toThrow(
        TigerBeetleAccountError
      );
    });

    it('should include metadata in account objects', async () => {
      await accountManager.createPeerAccounts('peer-g', 'USD');

      const callArgs = mockTigerBeetleClient.createAccountsBatch.mock.calls[0]![0] as Array<{
        id: bigint;
        ledger: number;
        code: number;
        flags?: number;
        user_data_128: bigint;
        user_data_64: bigint;
        user_data_32: number;
      }>;

      // Verify both accounts have user_data fields populated
      callArgs.forEach((account) => {
        expect(account.user_data_128).toBeDefined();
        expect(account.user_data_64).toBeDefined();
        expect(account.user_data_32).toBeDefined();
        expect(typeof account.user_data_128).toBe('bigint');
        expect(typeof account.user_data_64).toBe('bigint');
        expect(typeof account.user_data_32).toBe('number');
      });
    });
  });

  describe('Balance Queries', () => {
    beforeEach(() => {
      accountManager = new AccountManager(
        { nodeId: 'test-node' },
        mockTigerBeetleClient,
        mockLogger
      );
    });

    it('should query balances for peer', async () => {
      // Mock balance response
      mockTigerBeetleClient.getAccountsBatch = jest.fn().mockResolvedValue(
        new Map([
          [123n, { debits: 1000n, credits: 500n, balance: -500n }],
          [456n, { debits: 200n, credits: 800n, balance: 600n }],
        ])
      );

      // Set up account IDs in cache
      const debitAccountId = 123n;
      const creditAccountId = 456n;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (accountManager as any)._accountCache.set('peer-h:USD', {
        debitAccountId,
        creditAccountId,
        peerId: 'peer-h',
        tokenId: 'USD',
      });

      const balance = await accountManager.getAccountBalance('peer-h', 'USD');

      // Verify balance calculation
      // debitBalance = balance from debit account = -500n
      // creditBalance = balance from credit account = 600n
      // netBalance = creditBalance - debitBalance = 600n - (-500n) = 1100n
      expect(balance.debitBalance).toBe(-500n);
      expect(balance.creditBalance).toBe(600n);
      expect(balance.netBalance).toBe(1100n);
    });

    it('should use cached account IDs for balance queries', async () => {
      // Pre-populate cache
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (accountManager as any)._accountCache.set('peer-i:ETH', {
        debitAccountId: 111n,
        creditAccountId: 222n,
        peerId: 'peer-i',
        tokenId: 'ETH',
      });

      mockTigerBeetleClient.getAccountsBatch = jest.fn().mockResolvedValue(
        new Map([
          [111n, { debits: 0n, credits: 0n, balance: 0n }],
          [222n, { debits: 0n, credits: 0n, balance: 0n }],
        ])
      );

      await accountManager.getAccountBalance('peer-i', 'ETH');

      // Should query with cached account IDs
      expect(mockTigerBeetleClient.getAccountsBatch).toHaveBeenCalledWith([111n, 222n]);
    });

    it('should handle account not found in TigerBeetle', async () => {
      // Mock empty response (accounts not found)
      mockTigerBeetleClient.getAccountsBatch = jest.fn().mockResolvedValue(new Map());

      const balance = await accountManager.getAccountBalance('peer-j', 'BTC');

      // Should return zero balances
      expect(balance.debitBalance).toBe(0n);
      expect(balance.creditBalance).toBe(0n);
      expect(balance.netBalance).toBe(0n);
    });

    it('should generate account IDs if not cached', async () => {
      mockTigerBeetleClient.getAccountsBatch = jest.fn().mockResolvedValue(new Map());

      await accountManager.getAccountBalance('peer-k', 'USD');

      // Should have called getAccountsBatch with deterministically generated IDs
      expect(mockTigerBeetleClient.getAccountsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(BigInt), expect.any(BigInt)])
      );

      // Should have added to cache
      const stats = accountManager.getCacheStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('Cache Management', () => {
    beforeEach(() => {
      accountManager = new AccountManager(
        { nodeId: 'test-node' },
        mockTigerBeetleClient,
        mockLogger
      );

      mockTigerBeetleClient.createAccountsBatch = jest.fn().mockResolvedValue(undefined);
    });

    it('should clear cache on clearCache()', async () => {
      // Populate cache
      await accountManager.createPeerAccounts('peer-l', 'USD');
      await accountManager.createPeerAccounts('peer-m', 'ETH');

      expect(accountManager.getCacheStats().size).toBe(2);

      // Clear cache
      accountManager.clearCache();

      expect(accountManager.getCacheStats().size).toBe(0);
    });

    it('should regenerate account IDs after cache clear', async () => {
      // Create accounts (populates cache)
      const originalPair = await accountManager.createPeerAccounts('peer-n', 'BTC');

      // Clear cache
      accountManager.clearCache();

      // Get account pair (should regenerate)
      const regeneratedPair = accountManager.getPeerAccountPair('peer-n', 'BTC');

      // Should be same IDs (deterministic)
      expect(regeneratedPair.debitAccountId).toBe(originalPair.debitAccountId);
      expect(regeneratedPair.creditAccountId).toBe(originalPair.creditAccountId);
    });

    it('should return correct cache statistics', async () => {
      expect(accountManager.getCacheStats().size).toBe(0);

      await accountManager.createPeerAccounts('peer-o', 'USD');
      expect(accountManager.getCacheStats().size).toBe(1);

      await accountManager.createPeerAccounts('peer-p', 'ETH');
      expect(accountManager.getCacheStats().size).toBe(2);

      await accountManager.createPeerAccounts('peer-o', 'BTC');
      expect(accountManager.getCacheStats().size).toBe(3);
    });

    it('should cache account pairs from getPeerAccountPair', () => {
      const accountPair = accountManager.getPeerAccountPair('peer-q', 'USD');

      expect(accountPair).toBeDefined();
      expect(accountManager.getCacheStats().size).toBe(1);

      // Second call should return same object from cache
      const cachedPair = accountManager.getPeerAccountPair('peer-q', 'USD');
      expect(cachedPair).toBe(accountPair);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      accountManager = new AccountManager(
        { nodeId: 'test-node' },
        mockTigerBeetleClient,
        mockLogger
      );
    });

    it('should propagate connection errors', async () => {
      mockTigerBeetleClient.createAccountsBatch = jest
        .fn()
        .mockRejectedValue(new Error('Connection timeout'));

      await expect(accountManager.createPeerAccounts('peer-r', 'USD')).rejects.toThrow(
        'Connection timeout'
      );
    });

    it('should propagate balance query errors', async () => {
      mockTigerBeetleClient.getAccountsBatch = jest
        .fn()
        .mockRejectedValue(new Error('Query failed'));

      await expect(accountManager.getAccountBalance('peer-s', 'USD')).rejects.toThrow(
        'Query failed'
      );
    });
  });
});
