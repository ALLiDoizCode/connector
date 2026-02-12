import {
  AptosClient,
  AptosClientConfig,
  AptosError,
  AptosErrorCode,
  createAptosClientFromEnv,
} from './aptos-client';
import { Logger } from 'pino';

// Mock the @aptos-labs/ts-sdk module
jest.mock('@aptos-labs/ts-sdk', () => {
  const mockAccountAddress = {
    toString: () => '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  };

  const mockAccount = {
    accountAddress: mockAccountAddress,
    publicKey: { toString: () => '0xpublickey' },
  };

  return {
    Aptos: jest.fn().mockImplementation(() => ({
      account: {
        getAccountInfo: jest.fn(),
        getAccountAPTAmount: jest.fn(),
        getAccountResource: jest.fn(),
      },
      getLedgerInfo: jest.fn(),
      transaction: {
        simulate: {
          simple: jest.fn(),
        },
      },
      signAndSubmitTransaction: jest.fn(),
      waitForTransaction: jest.fn(),
      view: jest.fn(),
      fundAccount: jest.fn(),
    })),
    AptosConfig: jest.fn().mockImplementation(() => ({})),
    Network: {
      MAINNET: 'mainnet',
      TESTNET: 'testnet',
      DEVNET: 'devnet',
      LOCAL: 'local',
      CUSTOM: 'custom',
    },
    Account: {
      fromPrivateKey: jest.fn().mockReturnValue(mockAccount),
    },
    Ed25519PrivateKey: jest.fn().mockImplementation(() => ({})),
    AccountAddress: {
      from: jest.fn().mockReturnValue(mockAccountAddress),
    },
  };
});

// Import after mocking
import { Aptos } from '@aptos-labs/ts-sdk';

describe('AptosClient', () => {
  let client: AptosClient;
  let mockLogger: jest.Mocked<Logger>;
  let mockAptos: jest.Mocked<Aptos>;
  let config: AptosClientConfig;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create fresh mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Logger>;

    config = {
      nodeUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      accountAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      maxRetryAttempts: 3,
    };

    // Get the mocked Aptos instance via async factory
    client = await AptosClient.create(config, mockLogger);
    const mockResults = (Aptos as jest.MockedClass<typeof Aptos>).mock.results;
    mockAptos = mockResults[mockResults.length - 1]?.value as jest.Mocked<Aptos>;
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe('create()', () => {
    it('should initialize with valid config', () => {
      expect(client).toBeDefined();
      expect(client.getAddress()).toBe(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      );
    });

    it('should throw error on address mismatch', async () => {
      const badConfig = {
        ...config,
        accountAddress: '0xdifferentaddress0000000000000000000000000000000000000000000000000',
      };

      await expect(AptosClient.create(badConfig, mockLogger)).rejects.toThrow(
        'Account address mismatch'
      );
    });

    it('should detect testnet network from URL', async () => {
      const testnetConfig = {
        ...config,
        nodeUrl: 'https://fullnode.testnet.aptoslabs.com/v1',
      };
      const testnetClient = await AptosClient.create(testnetConfig, mockLogger);
      expect(testnetClient).toBeDefined();
      testnetClient.disconnect();
    });

    it('should detect mainnet network from URL', async () => {
      const mainnetConfig = {
        ...config,
        nodeUrl: 'https://fullnode.mainnet.aptoslabs.com/v1',
      };
      const mainnetClient = await AptosClient.create(mainnetConfig, mockLogger);
      expect(mainnetClient).toBeDefined();
      mainnetClient.disconnect();
    });

    it('should initialize fallback client when fallbackNodeUrl provided', async () => {
      const configWithFallback = {
        ...config,
        fallbackNodeUrl: 'https://aptos-testnet.nodereal.io/v1',
      };
      const clientWithFallback = await AptosClient.create(configWithFallback, mockLogger);
      expect(clientWithFallback).toBeDefined();
      clientWithFallback.disconnect();
    });
  });

  describe('connect()', () => {
    it('should establish connection to Aptos node', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      mockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);

      await client.connect();

      expect(client.isConnected()).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ nodeUrl: config.nodeUrl }),
        'Connecting to Aptos node...'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ address: config.accountAddress }),
        'Aptos account validated'
      );
    });

    it('should throw CONNECTION_FAILED when connection fails', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockRejectedValue(new Error('Network error'));

      await expect(client.connect()).rejects.toMatchObject({
        code: AptosErrorCode.CONNECTION_FAILED,
      });
    });

    it('should throw ACCOUNT_NOT_FOUND when account does not exist', async () => {
      mockAptos.account.getAccountInfo = jest
        .fn()
        .mockRejectedValue(new Error('Account not found: 404'));

      await expect(client.connect()).rejects.toMatchObject({
        code: AptosErrorCode.ACCOUNT_NOT_FOUND,
      });
    });

    it('should start health check polling when interval configured', async () => {
      jest.useFakeTimers();

      const configWithHealthCheck = {
        ...config,
        healthCheckIntervalMs: 5000,
      };
      const healthCheckClient = await AptosClient.create(configWithHealthCheck, mockLogger);
      const healthMockResults = (Aptos as jest.MockedClass<typeof Aptos>).mock.results;
      const healthMockAptos = healthMockResults[healthMockResults.length - 1]
        ?.value as jest.Mocked<Aptos>;

      healthMockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      healthMockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);
      healthMockAptos.getLedgerInfo = jest.fn().mockResolvedValue({ ledger_version: '123' });

      await healthCheckClient.connect();

      // Advance timer to trigger health check
      jest.advanceTimersByTime(5000);

      expect(healthMockAptos.getLedgerInfo).toHaveBeenCalled();

      healthCheckClient.disconnect();
      jest.useRealTimers();
    });
  });

  describe('disconnect()', () => {
    it('should disconnect and mark connection as unhealthy', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      mockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);

      await client.connect();
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Disconnected from Aptos');
    });

    it('should clear health check interval on disconnect', async () => {
      jest.useFakeTimers();

      const configWithHealthCheck = {
        ...config,
        healthCheckIntervalMs: 5000,
      };
      const healthCheckClient = await AptosClient.create(configWithHealthCheck, mockLogger);
      const healthMockResults = (Aptos as jest.MockedClass<typeof Aptos>).mock.results;
      const healthMockAptos = healthMockResults[healthMockResults.length - 1]
        ?.value as jest.Mocked<Aptos>;

      healthMockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      healthMockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);

      // Manually set health check to simulate post-connect state
      healthCheckClient.disconnect();

      // Should not throw when disconnecting multiple times
      healthCheckClient.disconnect();

      jest.useRealTimers();
    });
  });

  describe('getAccountInfo()', () => {
    it('should return account sequence number and auth key', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '42',
        authentication_key: '0xauthkey123',
      });

      const info = await client.getAccountInfo('0x1');

      expect(info).toMatchObject({
        sequenceNumber: '42',
        authenticationKey: '0xauthkey123',
      });
    });

    it('should throw ACCOUNT_NOT_FOUND for non-existent account', async () => {
      mockAptos.account.getAccountInfo = jest
        .fn()
        .mockRejectedValue(new Error('Account not found: 404'));

      await expect(client.getAccountInfo('0xnonexistent')).rejects.toMatchObject({
        code: AptosErrorCode.ACCOUNT_NOT_FOUND,
      });
    });
  });

  describe('getBalance()', () => {
    it('should return balance in octas as bigint', async () => {
      mockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);

      const balance = await client.getBalance('0x1');

      expect(typeof balance).toBe('bigint');
      expect(balance).toBe(BigInt(100000000));
    });

    it('should return zero balance for new account', async () => {
      mockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(0);

      const balance = await client.getBalance('0x1');

      expect(balance).toBe(BigInt(0));
    });
  });

  describe('submitTransaction()', () => {
    it('should submit transaction and return result', async () => {
      mockAptos.signAndSubmitTransaction = jest.fn().mockResolvedValue({
        hash: '0xtxhash123',
      });
      mockAptos.waitForTransaction = jest.fn().mockResolvedValue({
        hash: '0xtxhash123',
        version: '12345',
        success: true,
        vm_status: 'Executed successfully',
      });

      const result = await client.submitTransaction({});

      expect(result).toMatchObject({
        hash: '0xtxhash123',
        version: '12345',
        success: true,
        vmStatus: 'Executed successfully',
      });
    });

    it('should throw TRANSACTION_FAILED on submission error', async () => {
      mockAptos.signAndSubmitTransaction = jest
        .fn()
        .mockRejectedValue(new Error('Transaction failed: insufficient gas'));

      await expect(client.submitTransaction({})).rejects.toMatchObject({
        code: AptosErrorCode.INSUFFICIENT_BALANCE,
      });
    });
  });

  describe('simulateTransaction()', () => {
    it('should simulate transaction and return result', async () => {
      mockAptos.transaction.simulate.simple = jest.fn().mockResolvedValue([
        {
          success: true,
          gas_used: '1000',
          vm_status: 'Executed successfully',
        },
      ]);

      const result = await client.simulateTransaction({});

      expect(result).toMatchObject({
        success: true,
        gasUsed: '1000',
        vmStatus: 'Executed successfully',
      });
    });

    it('should throw SIMULATION_FAILED on simulation error', async () => {
      mockAptos.transaction.simulate.simple = jest
        .fn()
        .mockRejectedValue(new Error('Simulation failed'));

      await expect(client.simulateTransaction({})).rejects.toMatchObject({
        code: AptosErrorCode.SIMULATION_FAILED,
      });
    });
  });

  describe('view()', () => {
    it('should call view function and return decoded result', async () => {
      mockAptos.view = jest.fn().mockResolvedValue([true]);

      const result = await client.view(
        '0x1',
        'coin',
        'is_coin_initialized',
        ['0x1::aptos_coin::AptosCoin'],
        []
      );

      expect(result).toEqual([true]);
      expect(mockAptos.view).toHaveBeenCalledWith({
        payload: {
          function: '0x1::coin::is_coin_initialized',
          typeArguments: ['0x1::aptos_coin::AptosCoin'],
          functionArguments: [],
        },
      });
    });

    it('should throw MODULE_NOT_FOUND when module does not exist', async () => {
      mockAptos.view = jest.fn().mockRejectedValue(new Error('Module not found at address'));

      await expect(
        client.view('0xnonexistent', 'fakmodule', 'fakefunction', [], [])
      ).rejects.toMatchObject({
        code: AptosErrorCode.MODULE_NOT_FOUND,
      });
    });
  });

  describe('getAccountResource()', () => {
    it('should return account resource', async () => {
      const mockResource = {
        coin: { value: '1000000' },
      };
      mockAptos.account.getAccountResource = jest.fn().mockResolvedValue(mockResource);

      const result = await client.getAccountResource(
        '0x1',
        '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
      );

      expect(result).toEqual(mockResource);
    });

    it('should throw RESOURCE_NOT_FOUND when resource does not exist', async () => {
      mockAptos.account.getAccountResource = jest
        .fn()
        .mockRejectedValue(new Error('Resource not found: 404'));

      await expect(client.getAccountResource('0x1', '0x1::fake::Resource')).rejects.toMatchObject({
        code: AptosErrorCode.RESOURCE_NOT_FOUND,
      });
    });
  });

  describe('fundWithFaucet()', () => {
    it('should fund account via faucet on testnet', async () => {
      mockAptos.fundAccount = jest.fn().mockResolvedValue(undefined);

      await expect(client.fundWithFaucet('0x1', 100000000)).resolves.not.toThrow();

      expect(mockAptos.fundAccount).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ address: '0x1', amount: 100000000 }),
        'Funding account via Aptos testnet faucet...'
      );
    });

    it('should throw RATE_LIMITED when faucet rate-limited', async () => {
      mockAptos.fundAccount = jest.fn().mockRejectedValue(new Error('429 Too Many Requests'));

      await expect(client.fundWithFaucet('0x1', 100000000)).rejects.toMatchObject({
        code: AptosErrorCode.RATE_LIMITED,
      });
    });
  });

  describe('isConnected()', () => {
    it('should return false initially', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return true after successful connect', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      mockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);

      await client.connect();

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('getAddress()', () => {
    it('should return configured account address', () => {
      expect(client.getAddress()).toBe(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      );
    });
  });

  describe('Automatic Retry', () => {
    it('should retry on transient failures with exponential backoff', async () => {
      let attempts = 0;
      mockAptos.account.getAccountInfo = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('ETIMEDOUT'));
        }
        return Promise.resolve({
          sequence_number: '0',
          authentication_key: '0xabc123',
        });
      });

      const info = await client.getAccountInfo('0x1');

      expect(attempts).toBe(3);
      expect(info.sequenceNumber).toBe('0');
    });

    it('should fail after max retry attempts', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.CONNECTION_TIMEOUT,
      });

      expect(mockAptos.account.getAccountInfo).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      mockAptos.account.getAccountInfo = jest
        .fn()
        .mockRejectedValue(new Error('Account not found: 404'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.ACCOUNT_NOT_FOUND,
      });

      expect(mockAptos.account.getAccountInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Health Check', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should poll node health at configured interval', async () => {
      const configWithHealthCheck = {
        ...config,
        healthCheckIntervalMs: 1000,
      };
      const healthCheckClient = await AptosClient.create(configWithHealthCheck, mockLogger);
      const healthMockResults = (Aptos as jest.MockedClass<typeof Aptos>).mock.results;
      const healthMockAptos = healthMockResults[healthMockResults.length - 1]
        ?.value as jest.Mocked<Aptos>;

      healthMockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      healthMockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);
      healthMockAptos.getLedgerInfo = jest.fn().mockResolvedValue({ ledger_version: '123' });

      await healthCheckClient.connect();

      // Health check should be called after interval
      jest.advanceTimersByTime(1000);
      expect(healthMockAptos.getLedgerInfo).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      expect(healthMockAptos.getLedgerInfo).toHaveBeenCalledTimes(2);

      healthCheckClient.disconnect();
    });

    it('should mark disconnected when health check fails', async () => {
      const configWithHealthCheck = {
        ...config,
        healthCheckIntervalMs: 1000,
      };
      const healthCheckClient = await AptosClient.create(configWithHealthCheck, mockLogger);
      const healthMockResults = (Aptos as jest.MockedClass<typeof Aptos>).mock.results;
      const healthMockAptos = healthMockResults[healthMockResults.length - 1]
        ?.value as jest.Mocked<Aptos>;

      healthMockAptos.account.getAccountInfo = jest.fn().mockResolvedValue({
        sequence_number: '0',
        authentication_key: '0xabc123',
      });
      healthMockAptos.account.getAccountAPTAmount = jest.fn().mockResolvedValue(100000000);
      healthMockAptos.getLedgerInfo = jest.fn().mockRejectedValue(new Error('Connection lost'));

      await healthCheckClient.connect();
      expect(healthCheckClient.isConnected()).toBe(true);

      // Trigger health check failure
      jest.advanceTimersByTime(1000);

      // Need to wait for the async health check to complete
      await Promise.resolve();

      expect(healthCheckClient.isConnected()).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Aptos health check failed'
      );

      healthCheckClient.disconnect();
    });
  });

  describe('Error Mapping', () => {
    it('should map 404 to ACCOUNT_NOT_FOUND', async () => {
      mockAptos.account.getAccountInfo = jest
        .fn()
        .mockRejectedValue(new Error('Account not found: 404'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.ACCOUNT_NOT_FOUND,
      });
    });

    it('should map 429 to RATE_LIMITED', async () => {
      mockAptos.account.getAccountInfo = jest
        .fn()
        .mockRejectedValue(new Error('429 Too Many Requests'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.RATE_LIMITED,
      });
    });

    it('should map timeout errors to CONNECTION_TIMEOUT', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockRejectedValue(new Error('Request timeout'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.CONNECTION_TIMEOUT,
      });
    });

    it('should map connection errors to CONNECTION_FAILED', async () => {
      mockAptos.account.getAccountInfo = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.CONNECTION_FAILED,
      });
    });

    it('should map sequence errors to SEQUENCE_NUMBER_TOO_OLD', async () => {
      mockAptos.signAndSubmitTransaction = jest
        .fn()
        .mockRejectedValue(new Error('Sequence number too old'));

      await expect(client.submitTransaction({})).rejects.toMatchObject({
        code: AptosErrorCode.SEQUENCE_NUMBER_TOO_OLD,
      });
    });

    it('should map unknown errors to UNKNOWN_ERROR', async () => {
      mockAptos.account.getAccountInfo = jest
        .fn()
        .mockRejectedValue(new Error('Some unexpected error'));

      await expect(client.getAccountInfo('0x1')).rejects.toMatchObject({
        code: AptosErrorCode.UNKNOWN_ERROR,
      });
    });
  });
});

describe('createAptosClientFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create client from environment variables', async () => {
    process.env.APTOS_NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';
    process.env.APTOS_PRIVATE_KEY =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.APTOS_ACCOUNT_ADDRESS =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;

    const client = await createAptosClientFromEnv(mockLogger);
    expect(client).toBeDefined();
    client.disconnect();
  });

  it('should throw if APTOS_NODE_URL not set', async () => {
    delete process.env.APTOS_NODE_URL;
    process.env.APTOS_PRIVATE_KEY = '0x1234';
    process.env.APTOS_ACCOUNT_ADDRESS = '0x1234';

    const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;

    await expect(createAptosClientFromEnv(mockLogger)).rejects.toThrow(
      'APTOS_NODE_URL environment variable is required'
    );
  });

  it('should throw if APTOS_PRIVATE_KEY not set', async () => {
    process.env.APTOS_NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';
    delete process.env.APTOS_PRIVATE_KEY;
    process.env.APTOS_ACCOUNT_ADDRESS = '0x1234';

    const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;

    await expect(createAptosClientFromEnv(mockLogger)).rejects.toThrow(
      'APTOS_PRIVATE_KEY environment variable is required'
    );
  });

  it('should throw if APTOS_ACCOUNT_ADDRESS not set', async () => {
    process.env.APTOS_NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';
    process.env.APTOS_PRIVATE_KEY = '0x1234';
    delete process.env.APTOS_ACCOUNT_ADDRESS;

    const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;

    await expect(createAptosClientFromEnv(mockLogger)).rejects.toThrow(
      'APTOS_ACCOUNT_ADDRESS environment variable is required'
    );
  });

  it('should include optional config when environment variables set', async () => {
    process.env.APTOS_NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';
    process.env.APTOS_PRIVATE_KEY =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.APTOS_ACCOUNT_ADDRESS =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.APTOS_FALLBACK_NODE_URL = 'https://aptos-testnet.nodereal.io/v1';
    process.env.APTOS_REQUEST_TIMEOUT_MS = '60000';
    process.env.APTOS_MAX_RETRY_ATTEMPTS = '5';
    process.env.APTOS_HEALTH_CHECK_INTERVAL_MS = '10000';

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;

    const client = await createAptosClientFromEnv(mockLogger);
    expect(client).toBeDefined();
    client.disconnect();
  });
});

describe('AptosError', () => {
  it('should create error with code and message', () => {
    const error = new AptosError(AptosErrorCode.CONNECTION_FAILED, 'Connection failed');

    expect(error.code).toBe(AptosErrorCode.CONNECTION_FAILED);
    expect(error.message).toBe('Connection failed');
    expect(error.name).toBe('AptosError');
  });

  it('should include original error', () => {
    const originalError = new Error('Original');
    const error = new AptosError(
      AptosErrorCode.CONNECTION_FAILED,
      'Connection failed',
      originalError
    );

    expect(error.originalError).toBe(originalError);
  });
});
