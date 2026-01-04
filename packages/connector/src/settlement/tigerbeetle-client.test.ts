/**
 * Unit tests for TigerBeetleClient
 *
 * Tests client initialization, account creation, transfer creation, balance queries,
 * error handling, and timeout behavior using mocked TigerBeetle responses.
 */

import { TigerBeetleClient } from './tigerbeetle-client';
import {
  TigerBeetleConnectionError,
  TigerBeetleAccountError,
  TigerBeetleTransferError,
  TigerBeetleTimeoutError,
} from './tigerbeetle-errors';
import {
  Client,
  Account,
  CreateAccountError,
  CreateTransferError,
  AccountFlags,
} from 'tigerbeetle-node';
import { Logger } from 'pino';

// Mock tigerbeetle-node module
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('tigerbeetle-node', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const actualModule = jest.requireActual('tigerbeetle-node');
  return {
    ...actualModule,
    createClient: jest.fn(),
  };
});

describe('TigerBeetleClient', () => {
  let mockClient: jest.Mocked<Client>;
  let mockLogger: jest.Mocked<Logger>;
  let client: TigerBeetleClient;

  beforeEach(() => {
    // Create mock TigerBeetle client
    mockClient = {
      createAccounts: jest.fn(),
      createTransfers: jest.fn(),
      lookupAccounts: jest.fn(),
      lookupTransfers: jest.fn(),
    } as unknown as jest.Mocked<Client>;

    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Mock createClient to return mock client
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('tigerbeetle-node');
    createClient.mockReturnValue(mockClient);

    // Create TigerBeetleClient instance
    client = new TigerBeetleClient(
      {
        clusterId: 0,
        replicaAddresses: ['tigerbeetle:3000'],
        operationTimeout: 100, // Short timeout for tests
      },
      mockLogger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize client with cluster ID and replica addresses', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createClient } = require('tigerbeetle-node');

      await client.initialize();

      expect(createClient).toHaveBeenCalledWith({
        cluster_id: BigInt(0),
        replica_addresses: ['tigerbeetle:3000'],
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: 0,
          replicaAddresses: ['tigerbeetle:3000'],
        }),
        'Initializing TigerBeetle client'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ clusterId: 0 }),
        'TigerBeetle client initialized successfully'
      );
    });

    it('should throw TigerBeetleConnectionError on initialization failure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createClient } = require('tigerbeetle-node');
      const initError = new Error('Connection refused');
      createClient.mockImplementation(() => {
        throw initError;
      });

      await expect(client.initialize()).rejects.toThrow(TigerBeetleConnectionError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: initError }),
        'Failed to initialize TigerBeetle client'
      );
    });

    it('should throw error when calling operations before initialization', async () => {
      await expect(client.createAccount(123n, 1, 100)).rejects.toThrow(TigerBeetleConnectionError);
      await expect(client.createTransfer(456n, 123n, 789n, 1000n, 1, 100)).rejects.toThrow(
        TigerBeetleConnectionError
      );
      await expect(client.getAccountBalance(123n)).rejects.toThrow(TigerBeetleConnectionError);
    });
  });

  describe('Account Creation', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should create account with valid parameters', async () => {
      mockClient.createAccounts.mockResolvedValue([]);

      await client.createAccount(123n, 1, 100);

      expect(mockClient.createAccounts).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 123n,
          ledger: 1,
          code: 100,
          flags: AccountFlags.none,
          debits_pending: 0n,
          debits_posted: 0n,
          credits_pending: 0n,
          credits_posted: 0n,
        }),
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 123n }),
        'Account created successfully'
      );
    });

    it('should create account with custom flags', async () => {
      mockClient.createAccounts.mockResolvedValue([]);

      await client.createAccount(123n, 1, 100, AccountFlags.debits_must_not_exceed_credits);

      expect(mockClient.createAccounts).toHaveBeenCalledWith([
        expect.objectContaining({
          flags: AccountFlags.debits_must_not_exceed_credits,
        }),
      ]);
    });

    it('should validate account ID is non-zero', async () => {
      await expect(client.createAccount(0n, 1, 100)).rejects.toThrow(TigerBeetleAccountError);
      expect(mockClient.createAccounts).not.toHaveBeenCalled();
    });

    it('should handle duplicate account error', async () => {
      mockClient.createAccounts.mockResolvedValue([
        {
          index: 0,
          result: CreateAccountError.exists,
        },
      ]);

      await expect(client.createAccount(123n, 1, 100)).rejects.toThrow(TigerBeetleAccountError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 123n,
          errorCode: 'exists',
        }),
        expect.stringContaining('Account creation failed')
      );
    });

    it('should create multiple accounts in batch', async () => {
      mockClient.createAccounts.mockResolvedValue([]);

      await client.createAccountsBatch([
        { id: 123n, ledger: 1, code: 100 },
        { id: 456n, ledger: 1, code: 200 },
      ]);

      expect(mockClient.createAccounts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 123n, ledger: 1, code: 100 }),
          expect.objectContaining({ id: 456n, ledger: 1, code: 200 }),
        ])
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ accountCount: 2 }),
        'Account batch created successfully'
      );
    });

    it('should handle batch creation errors', async () => {
      mockClient.createAccounts.mockResolvedValue([
        {
          index: 0,
          result: CreateAccountError.exists,
        },
        {
          index: 1,
          result: CreateAccountError.ledger_must_not_be_zero,
        },
      ]);

      await expect(
        client.createAccountsBatch([
          { id: 123n, ledger: 1, code: 100 },
          { id: 456n, ledger: 0, code: 200 },
        ])
      ).rejects.toThrow(TigerBeetleAccountError);
    });
  });

  describe('Transfer Creation', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should create transfer between two accounts', async () => {
      mockClient.createTransfers.mockResolvedValue([]);

      await client.createTransfer(456n, 123n, 789n, 1000n, 1, 100);

      expect(mockClient.createTransfers).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 456n,
          debit_account_id: 123n,
          credit_account_id: 789n,
          amount: 1000n,
          ledger: 1,
          code: 100,
        }),
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: 456n,
          debitAccountId: 123n,
          creditAccountId: 789n,
          amount: 1000n,
        }),
        'Transfer created successfully'
      );
    });

    it('should validate transfer ID is non-zero', async () => {
      await expect(client.createTransfer(0n, 123n, 789n, 1000n, 1, 100)).rejects.toThrow(
        TigerBeetleTransferError
      );
      expect(mockClient.createTransfers).not.toHaveBeenCalled();
    });

    it('should validate transfer amount is positive', async () => {
      await expect(client.createTransfer(456n, 123n, 789n, 0n, 1, 100)).rejects.toThrow(
        TigerBeetleTransferError
      );
      await expect(client.createTransfer(456n, 123n, 789n, -100n, 1, 100)).rejects.toThrow(
        TigerBeetleTransferError
      );
      expect(mockClient.createTransfers).not.toHaveBeenCalled();
    });

    it('should handle insufficient balance error', async () => {
      mockClient.createTransfers.mockResolvedValue([
        {
          index: 0,
          result: CreateTransferError.exceeds_credits,
        },
      ]);

      await expect(client.createTransfer(456n, 123n, 789n, 1000n, 1, 100)).rejects.toThrow(
        TigerBeetleTransferError
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: 456n,
          errorCode: 'exceeds_credits',
        }),
        expect.stringContaining('Transfer creation failed')
      );
    });

    it('should handle account not found error', async () => {
      mockClient.createTransfers.mockResolvedValue([
        {
          index: 0,
          result: CreateTransferError.debit_account_not_found,
        },
      ]);

      await expect(client.createTransfer(456n, 123n, 789n, 1000n, 1, 100)).rejects.toThrow(
        TigerBeetleTransferError
      );
    });
  });

  describe('Balance Queries', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should return account balance', async () => {
      const mockAccount: Account = {
        id: 123n,
        debits_pending: 0n,
        debits_posted: 500n,
        credits_pending: 0n,
        credits_posted: 1500n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        reserved: 0,
        ledger: 1,
        code: 100,
        flags: 0,
        timestamp: 0n,
      };

      mockClient.lookupAccounts.mockResolvedValue([mockAccount]);

      const balance = await client.getAccountBalance(123n);

      expect(mockClient.lookupAccounts).toHaveBeenCalledWith([123n]);
      expect(balance).toEqual({
        debits: 500n,
        credits: 1500n,
        balance: 1000n, // credits - debits
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 123n, balance: 1000n }),
        'Account balance retrieved'
      );
    });

    it('should handle negative balance', async () => {
      const mockAccount: Account = {
        id: 123n,
        debits_pending: 0n,
        debits_posted: 2000n,
        credits_pending: 0n,
        credits_posted: 500n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        reserved: 0,
        ledger: 1,
        code: 100,
        flags: 0,
        timestamp: 0n,
      };

      mockClient.lookupAccounts.mockResolvedValue([mockAccount]);

      const balance = await client.getAccountBalance(123n);

      expect(balance.balance).toBe(-1500n); // credits - debits
    });

    it('should handle account not found', async () => {
      mockClient.lookupAccounts.mockResolvedValue([]);

      await expect(client.getAccountBalance(999n)).rejects.toThrow(TigerBeetleAccountError);
      await expect(client.getAccountBalance(999n)).rejects.toThrow('Account not found');
    });

    it('should query multiple accounts in batch', async () => {
      const mockAccounts: Account[] = [
        {
          id: 123n,
          debits_pending: 0n,
          debits_posted: 500n,
          credits_pending: 0n,
          credits_posted: 1500n,
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: 0,
          reserved: 0,
          ledger: 1,
          code: 100,
          flags: 0,
          timestamp: 0n,
        },
        {
          id: 456n,
          debits_pending: 0n,
          debits_posted: 1000n,
          credits_pending: 0n,
          credits_posted: 2000n,
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: 0,
          reserved: 0,
          ledger: 1,
          code: 200,
          flags: 0,
          timestamp: 0n,
        },
      ];

      mockClient.lookupAccounts.mockResolvedValue(mockAccounts);

      const balances = await client.getAccountsBatch([123n, 456n]);

      expect(mockClient.lookupAccounts).toHaveBeenCalledWith([123n, 456n]);
      expect(balances.size).toBe(2);
      expect(balances.get(123n)).toEqual({
        debits: 500n,
        credits: 1500n,
        balance: 1000n,
      });
      expect(balances.get(456n)).toEqual({
        debits: 1000n,
        credits: 2000n,
        balance: 1000n,
      });
    });

    it('should handle missing accounts in batch query', async () => {
      const mockAccounts: Account[] = [
        {
          id: 123n,
          debits_pending: 0n,
          debits_posted: 500n,
          credits_pending: 0n,
          credits_posted: 1500n,
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: 0,
          reserved: 0,
          ledger: 1,
          code: 100,
          flags: 0,
          timestamp: 0n,
        },
      ];

      mockClient.lookupAccounts.mockResolvedValue(mockAccounts);

      const balances = await client.getAccountsBatch([123n, 999n]);

      expect(balances.size).toBe(1);
      expect(balances.has(123n)).toBe(true);
      expect(balances.has(999n)).toBe(false);
    });
  });

  describe('Timeout Handling', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should timeout operation after configured timeout', async () => {
      // Create promise that never resolves
      mockClient.createTransfers.mockImplementation(
        () =>
          new Promise(() => {
            // Never resolves
          })
      );

      await expect(client.createTransfer(456n, 123n, 789n, 1000n, 1, 100)).rejects.toThrow(
        TigerBeetleTimeoutError
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'createTransfer',
          timeoutMs: 100,
        }),
        'TigerBeetle operation timed out'
      );
    });

    it('should complete operation before timeout', async () => {
      mockClient.createAccounts.mockResolvedValue([]);

      // Should complete successfully without timeout
      await expect(client.createAccount(123n, 1, 100)).resolves.not.toThrow();
    });
  });

  describe('Error Logging', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should log all successful operations', async () => {
      mockClient.createAccounts.mockResolvedValue([]);
      mockClient.createTransfers.mockResolvedValue([]);
      mockClient.lookupAccounts.mockResolvedValue([
        {
          id: 123n,
          debits_pending: 0n,
          debits_posted: 0n,
          credits_pending: 0n,
          credits_posted: 0n,
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: 0,
          reserved: 0,
          ledger: 1,
          code: 100,
          flags: 0,
          timestamp: 0n,
        },
      ]);

      await client.createAccount(123n, 1, 100);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Account created successfully'
      );

      await client.createTransfer(456n, 123n, 789n, 1000n, 1, 100);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Transfer created successfully'
      );

      await client.getAccountBalance(123n);
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.anything(), 'Account balance retrieved');
    });

    it('should log errors with context', async () => {
      mockClient.createAccounts.mockResolvedValue([
        {
          index: 0,
          result: CreateAccountError.exists,
        },
      ]);

      await expect(client.createAccount(123n, 1, 100)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 123n,
          errorCode: 'exists',
        }),
        expect.stringContaining('Account creation failed')
      );
    });
  });

  describe('Client Lifecycle', () => {
    it('should close client connection', async () => {
      await client.initialize();
      await client.close();

      // Should not be able to use client after closing
      await expect(client.createAccount(123n, 1, 100)).rejects.toThrow(TigerBeetleConnectionError);

      expect(mockLogger.info).toHaveBeenCalledWith('Closing TigerBeetle client connection');
      expect(mockLogger.info).toHaveBeenCalledWith('TigerBeetle client connection closed');
    });

    it('should handle close when not initialized', async () => {
      await client.close();
      // Should not throw error
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });
});
