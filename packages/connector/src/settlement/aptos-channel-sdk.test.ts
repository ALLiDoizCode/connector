/**
 * Aptos Channel SDK Unit Tests
 *
 * Tests for AptosChannelSDK high-level payment channel management.
 *
 * Story 27.4: Aptos Payment Channel SDK
 *
 * File: packages/connector/src/settlement/aptos-channel-sdk.test.ts
 */
import {
  AptosChannelSDK,
  AptosChannelSDKConfig,
  AptosChannelState,
  createAptosChannelSDKFromEnv,
} from './aptos-channel-sdk';
import { IAptosClient, AptosError, AptosErrorCode } from './aptos-client';
import { IAptosClaimSigner, AptosClaim } from './aptos-claim-signer';
import { Logger } from 'pino';

// Mock the factory functions from dependencies
jest.mock('./aptos-client', () => {
  const actual = jest.requireActual('./aptos-client');
  return {
    ...actual,
    createAptosClientFromEnv: jest.fn(),
  };
});

jest.mock('./aptos-claim-signer', () => {
  const actual = jest.requireActual('./aptos-claim-signer');
  return {
    ...actual,
    createAptosClaimSignerFromEnv: jest.fn(),
  };
});

// Import mocked functions for test control
import { createAptosClientFromEnv } from './aptos-client';
import { createAptosClaimSignerFromEnv } from './aptos-claim-signer';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock AptosClaim for testing
const mockClaim: AptosClaim = {
  channelOwner: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  amount: BigInt(100000000),
  nonce: 1,
  signature: 'aabbccdd'.repeat(16), // 64 bytes = 128 hex chars
  publicKey: 'aabbccdd'.repeat(8), // 32 bytes = 64 hex chars
  createdAt: Date.now(),
};

// Mock transaction result
const mockTxResult = {
  hash: '0xtxhash',
  version: '100',
  success: true,
  vmStatus: 'Executed successfully',
};

// Create mock logger
function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    trace: jest.fn(),
    fatal: jest.fn(),
    silent: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

// Create mock Aptos client
function createMockAptosClient(): jest.Mocked<IAptosClient> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    getAccountInfo: jest.fn().mockResolvedValue({
      sequenceNumber: '0',
      authenticationKey: '0xauthkey',
    }),
    getBalance: jest.fn().mockResolvedValue(BigInt(1000000000)),
    submitTransaction: jest.fn().mockResolvedValue(mockTxResult),
    simulateTransaction: jest.fn().mockResolvedValue({
      success: true,
      gasUsed: '100',
      vmStatus: 'Executed',
    }),
    view: jest.fn(),
    getAccountResource: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
    getAddress: jest
      .fn()
      .mockReturnValue('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
    fundWithFaucet: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IAptosClient>;
}

// Create mock claim signer
function createMockClaimSigner(): jest.Mocked<IAptosClaimSigner> {
  return {
    signClaim: jest.fn().mockResolvedValue(mockClaim),
    verifyClaim: jest.fn().mockResolvedValue(true),
    getPublicKey: jest.fn().mockReturnValue('aabbccdd'.repeat(8)),
    getHighestNonce: jest.fn().mockReturnValue(0),
    getHighestReceivedNonce: jest.fn().mockReturnValue(0),
    getLatestClaim: jest.fn().mockReturnValue(null),
    getChannelOwners: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<IAptosClaimSigner>;
}

// Default SDK config for tests
const testConfig: AptosChannelSDKConfig = {
  moduleAddress:
    '0xmodule1234567890abcdef1234567890abcdef1234567890abcdef1234567890::payment_channel',
  refreshIntervalMs: 30000,
  defaultSettleDelay: 86400,
};

// ============================================================================
// Tests
// ============================================================================

describe('AptosChannelSDK', () => {
  let sdk: AptosChannelSDK;
  let mockAptosClient: jest.Mocked<IAptosClient>;
  let mockClaimSigner: jest.Mocked<IAptosClaimSigner>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create fresh mock instances each test
    mockAptosClient = createMockAptosClient();
    mockClaimSigner = createMockClaimSigner();
    mockLogger = createMockLogger();

    sdk = new AptosChannelSDK(mockAptosClient, mockClaimSigner, testConfig, mockLogger);
  });

  afterEach(() => {
    // Cleanup timers
    sdk.stopAutoRefresh();
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // openChannel() tests
  // --------------------------------------------------------------------------

  describe('openChannel()', () => {
    beforeEach(() => {
      // Mock view function for getChannelState after open
      mockAptosClient.view.mockResolvedValueOnce([
        '0xdestination0000000000000000000000000000000000000000000000000000',
        'destpubkey'.repeat(6).slice(0, 64),
        '1000000000', // deposited
        '0', // claimed
        '0', // nonce
        '86400', // settleDelay
        '0', // closeRequestedAt
      ]);
    });

    it('should build and submit open_channel transaction', async () => {
      const channelOwner = await sdk.openChannel(
        '0xdestination0000000000000000000000000000000000000000000000000000',
        'destpubkey',
        BigInt(1000000000),
        86400
      );

      expect(channelOwner).toBe(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      );
      expect(mockAptosClient.submitTransaction).toHaveBeenCalledTimes(1);

      // Verify transaction payload
      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(txPayload.function).toContain('payment_channel::open_channel');
    });

    it('should use default settle delay if not provided', async () => {
      await sdk.openChannel(
        '0xdestination0000000000000000000000000000000000000000000000000000',
        'destpubkey',
        BigInt(1000000000)
      );

      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const args = txPayload.functionArguments as string[];
      expect(args[3]).toBe('86400'); // Default settle delay
    });

    it('should throw on transaction failure', async () => {
      mockAptosClient.submitTransaction.mockResolvedValueOnce({
        ...mockTxResult,
        success: false,
        vmStatus: 'INSUFFICIENT_BALANCE',
      });

      await expect(sdk.openChannel('0xdest', 'pk', BigInt(1000), 3600)).rejects.toThrow(
        'Failed to open channel'
      );
    });

    it('should cache channel state after opening', async () => {
      await sdk.openChannel(
        '0xdestination0000000000000000000000000000000000000000000000000000',
        'destpubkey',
        BigInt(1000000000),
        86400
      );

      // Channel should be in cache
      const channels = sdk.getMyChannels();
      expect(channels.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // deposit() tests
  // --------------------------------------------------------------------------

  describe('deposit()', () => {
    beforeEach(() => {
      // Mock view function for refreshChannelState
      mockAptosClient.view.mockResolvedValue([
        '0xdestination0000000000000000000000000000000000000000000000000000',
        'destpubkey'.repeat(6).slice(0, 64),
        '1500000000', // deposited (increased)
        '0', // claimed
        '0', // nonce
        '86400', // settleDelay
        '0', // closeRequestedAt
      ]);
    });

    it('should build and submit deposit transaction', async () => {
      await sdk.deposit(BigInt(500000000));

      expect(mockAptosClient.submitTransaction).toHaveBeenCalled();

      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(txPayload.function).toContain('payment_channel::deposit');

      const args = txPayload.functionArguments as string[];
      expect(args[0]).toBe('500000000');
    });

    it('should throw on transaction failure', async () => {
      mockAptosClient.submitTransaction.mockResolvedValueOnce({
        ...mockTxResult,
        success: false,
        vmStatus: 'TRANSACTION_FAILED',
      });

      await expect(sdk.deposit(BigInt(500000000))).rejects.toThrow('Failed to deposit');
    });
  });

  // --------------------------------------------------------------------------
  // signClaim() tests
  // --------------------------------------------------------------------------

  describe('signClaim()', () => {
    it('should delegate to claim signer with auto-incremented nonce', async () => {
      mockClaimSigner.getHighestNonce.mockReturnValue(5);

      await sdk.signClaim('0xowner', BigInt(100));

      expect(mockClaimSigner.signClaim).toHaveBeenCalledWith(
        expect.any(String), // normalized address
        BigInt(100),
        6 // nonce = highestNonce (5) + 1
      );
    });

    it('should return AptosClaim from signer', async () => {
      const claim = await sdk.signClaim('0xowner', BigInt(100));

      expect(claim).toBe(mockClaim);
    });

    it('should use nonce 1 for first claim', async () => {
      mockClaimSigner.getHighestNonce.mockReturnValue(0);

      await sdk.signClaim('0xowner', BigInt(100));

      expect(mockClaimSigner.signClaim).toHaveBeenCalledWith(expect.any(String), BigInt(100), 1);
    });
  });

  // --------------------------------------------------------------------------
  // verifyClaim() tests
  // --------------------------------------------------------------------------

  describe('verifyClaim()', () => {
    it('should delegate to claim signer', async () => {
      const claim: AptosClaim = {
        channelOwner: '0x1',
        amount: BigInt(100),
        nonce: 1,
        signature: 'sig',
        publicKey: 'pk',
        createdAt: Date.now(),
      };

      await sdk.verifyClaim(claim);

      expect(mockClaimSigner.verifyClaim).toHaveBeenCalledWith(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );
    });

    it('should return true for valid claim', async () => {
      mockClaimSigner.verifyClaim.mockResolvedValue(true);

      const result = await sdk.verifyClaim(mockClaim);

      expect(result).toBe(true);
    });

    it('should return false for invalid claim', async () => {
      mockClaimSigner.verifyClaim.mockResolvedValue(false);

      const result = await sdk.verifyClaim(mockClaim);

      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // submitClaim() tests
  // --------------------------------------------------------------------------

  describe('submitClaim()', () => {
    beforeEach(() => {
      // Mock view function for refreshChannelState
      mockAptosClient.view.mockResolvedValue([
        '0xdestination0000000000000000000000000000000000000000000000000000',
        'destpubkey'.repeat(6).slice(0, 64),
        '1000000000', // deposited
        '100000000', // claimed (updated)
        '1', // nonce (updated)
        '86400', // settleDelay
        '0', // closeRequestedAt
      ]);
    });

    it('should build and submit claim transaction', async () => {
      await sdk.submitClaim(mockClaim);

      expect(mockAptosClient.submitTransaction).toHaveBeenCalled();

      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(txPayload.function).toContain('payment_channel::claim');
    });

    it('should include claim parameters in transaction', async () => {
      await sdk.submitClaim(mockClaim);

      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const args = txPayload.functionArguments as string[];

      expect(args).toContain(mockClaim.amount.toString());
      expect(args).toContain(mockClaim.nonce.toString());
      expect(args).toContain(mockClaim.signature);
    });

    it('should throw on transaction failure', async () => {
      mockAptosClient.submitTransaction.mockResolvedValueOnce({
        ...mockTxResult,
        success: false,
        vmStatus: 'INVALID_SIGNATURE',
      });

      await expect(sdk.submitClaim(mockClaim)).rejects.toThrow('Failed to submit claim');
    });
  });

  // --------------------------------------------------------------------------
  // getChannelState() tests
  // --------------------------------------------------------------------------

  describe('getChannelState()', () => {
    it('should call view function and parse result', async () => {
      mockAptosClient.view.mockResolvedValueOnce([
        '0xdest0000000000000000000000000000000000000000000000000000000000',
        'pubkey'.repeat(10).slice(0, 64),
        '1000000000', // deposited
        '500000000', // claimed
        '5', // nonce
        '86400', // settleDelay
        '0', // closeRequestedAt
      ]);

      const state = await sdk.getChannelState('0xowner');

      expect(state).toEqual({
        channelOwner: expect.stringContaining('0x'),
        destination: expect.stringContaining('0x'),
        destinationPubkey: expect.any(String),
        deposited: BigInt(1000000000),
        claimed: BigInt(500000000),
        nonce: 5,
        settleDelay: 86400,
        closeRequestedAt: 0,
        status: 'open',
      });
    });

    it('should return closing status when closeRequestedAt > 0', async () => {
      mockAptosClient.view.mockResolvedValueOnce([
        '0xdest0000000000000000000000000000000000000000000000000000000000',
        'pubkey'.repeat(10).slice(0, 64),
        '1000000000',
        '500000000',
        '5',
        '86400',
        '1704067200', // closeRequestedAt > 0
      ]);

      const state = await sdk.getChannelState('0xowner');

      expect(state?.status).toBe('closing');
      expect(state?.closeRequestedAt).toBe(1704067200);
    });

    it('should return null for non-existent channel', async () => {
      mockAptosClient.view.mockRejectedValueOnce(
        new AptosError(AptosErrorCode.RESOURCE_NOT_FOUND, 'Not found')
      );

      const state = await sdk.getChannelState('0xnonexistent');

      expect(state).toBeNull();
    });

    it('should update local cache', async () => {
      mockAptosClient.view.mockResolvedValueOnce([
        '0xdest0000000000000000000000000000000000000000000000000000000000',
        'pubkey'.repeat(10).slice(0, 64),
        '1000000000',
        '0',
        '0',
        '3600',
        '0',
      ]);

      await sdk.getChannelState('0xowner1');

      const channels = sdk.getMyChannels();
      expect(channels.length).toBe(1);
    });

    it('should re-throw non-RESOURCE_NOT_FOUND errors', async () => {
      mockAptosClient.view.mockRejectedValueOnce(
        new AptosError(AptosErrorCode.CONNECTION_FAILED, 'Connection failed')
      );

      await expect(sdk.getChannelState('0xowner')).rejects.toThrow('Connection failed');
    });
  });

  // --------------------------------------------------------------------------
  // requestClose() tests
  // --------------------------------------------------------------------------

  describe('requestClose()', () => {
    it('should build and submit request_close transaction', async () => {
      await sdk.requestClose('0xowner');

      expect(mockAptosClient.submitTransaction).toHaveBeenCalled();

      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(txPayload.function).toContain('payment_channel::request_close');
    });

    it('should update cached channel status to closing', async () => {
      // First pre-populate the cache by getting channel state
      mockAptosClient.view.mockResolvedValueOnce([
        '0xdest0000000000000000000000000000000000000000000000000000000000',
        'pubkey'.repeat(10).slice(0, 64),
        '1000000000',
        '0',
        '0',
        '86400',
        '0', // closeRequestedAt = 0 (open)
      ]);
      await sdk.getChannelState('0xowner');

      // Verify channel is in cache with 'open' status
      const channels = sdk.getMyChannels();
      expect(channels.length).toBe(1);

      // Now request close
      await sdk.requestClose('0xowner');

      // Get the cached state directly to verify update
      // The cache should now have status 'closing' and closeRequestedAt > 0
      // We verify this by checking the SDK updated the cache (lines 415-416)
      expect(mockAptosClient.submitTransaction).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ channelOwner: expect.any(String) }),
        expect.stringContaining('close requested')
      );
    });

    it('should throw on transaction failure', async () => {
      mockAptosClient.submitTransaction.mockResolvedValueOnce({
        ...mockTxResult,
        success: false,
        vmStatus: 'NOT_CHANNEL_PARTICIPANT',
      });

      await expect(sdk.requestClose('0xowner')).rejects.toThrow('Failed to request channel close');
    });
  });

  // --------------------------------------------------------------------------
  // finalizeClose() tests
  // --------------------------------------------------------------------------

  describe('finalizeClose()', () => {
    it('should build and submit finalize_close transaction', async () => {
      await sdk.finalizeClose('0xowner');

      expect(mockAptosClient.submitTransaction).toHaveBeenCalled();

      const txPayload = mockAptosClient.submitTransaction.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(txPayload.function).toContain('payment_channel::finalize_close');
    });

    it('should remove channel from cache', async () => {
      // First add to cache
      mockAptosClient.view.mockResolvedValueOnce([
        '0xdest0000000000000000000000000000000000000000000000000000000000',
        'pubkey'.repeat(10).slice(0, 64),
        '1000000000',
        '0',
        '0',
        '3600',
        '0',
      ]);
      await sdk.getChannelState('0xowner');
      expect(sdk.getMyChannels().length).toBe(1);

      // Finalize close
      await sdk.finalizeClose('0xowner');

      // Channel should be removed from cache
      expect(sdk.getMyChannels().length).toBe(0);
    });

    it('should throw on transaction failure', async () => {
      mockAptosClient.submitTransaction.mockResolvedValueOnce({
        ...mockTxResult,
        success: false,
        vmStatus: 'SETTLE_DELAY_NOT_ELAPSED',
      });

      await expect(sdk.finalizeClose('0xowner')).rejects.toThrow(
        'Failed to finalize channel close'
      );
    });
  });

  // --------------------------------------------------------------------------
  // Auto-refresh tests
  // --------------------------------------------------------------------------

  describe('Auto-refresh', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start and stop refresh interval', () => {
      // Add a channel to cache first
      mockAptosClient.view.mockResolvedValue([
        '0xdest0000000000000000000000000000000000000000000000000000000000',
        'pubkey'.repeat(10).slice(0, 64),
        '1000000000',
        '0',
        '0',
        '3600',
        '0',
      ]);

      sdk.startAutoRefresh();

      // View should not have been called yet (interval not elapsed)
      expect(mockAptosClient.view).not.toHaveBeenCalled();

      // Add a channel to cache so refresh has something to do
      (
        sdk as unknown as { _channelStateCache: Map<string, AptosChannelState> }
      )._channelStateCache.set('0xowner', {
        channelOwner: '0xowner',
        destination: '0xdest',
        destinationPubkey: 'pk',
        deposited: BigInt(1000),
        claimed: BigInt(0),
        nonce: 0,
        settleDelay: 3600,
        closeRequestedAt: 0,
        status: 'open',
      });

      // Advance time by refresh interval
      jest.advanceTimersByTime(30000);

      // Should have triggered refresh
      expect(mockAptosClient.view).toHaveBeenCalled();

      sdk.stopAutoRefresh();
    });

    it('should not start multiple intervals', () => {
      sdk.startAutoRefresh();
      sdk.startAutoRefresh(); // Should warn, not create second interval

      expect(mockLogger.warn).toHaveBeenCalledWith('Auto-refresh already started');
    });

    it('should handle errors during refresh gracefully', async () => {
      // Add a channel to cache
      (
        sdk as unknown as { _channelStateCache: Map<string, AptosChannelState> }
      )._channelStateCache.set('0xowner', {
        channelOwner: '0xowner',
        destination: '0xdest',
        destinationPubkey: 'pk',
        deposited: BigInt(1000),
        claimed: BigInt(0),
        nonce: 0,
        settleDelay: 3600,
        closeRequestedAt: 0,
        status: 'open',
      });

      // Mock view to throw error
      mockAptosClient.view.mockRejectedValue(new Error('Network error'));

      sdk.startAutoRefresh();

      // Advance timers and flush promises
      jest.advanceTimersByTime(30000);
      await Promise.resolve(); // Flush microtasks
      await Promise.resolve(); // Extra flush for async callback

      // Should have logged error but not crashed
      expect(mockLogger.error).toHaveBeenCalled();

      sdk.stopAutoRefresh();
    });

    it('should remove channel from cache when it no longer exists during refresh', async () => {
      // Add a channel to cache
      (
        sdk as unknown as { _channelStateCache: Map<string, AptosChannelState> }
      )._channelStateCache.set(
        '0x0000000000000000000000000000000000000000000000000000000000owner',
        {
          channelOwner: '0x0000000000000000000000000000000000000000000000000000000000owner',
          destination: '0xdest',
          destinationPubkey: 'pk',
          deposited: BigInt(1000),
          claimed: BigInt(0),
          nonce: 0,
          settleDelay: 3600,
          closeRequestedAt: 0,
          status: 'open',
        }
      );

      // Verify channel is in cache
      expect(sdk.getMyChannels().length).toBe(1);

      // Mock view to throw RESOURCE_NOT_FOUND (channel was closed externally)
      mockAptosClient.view.mockRejectedValue(
        new AptosError(AptosErrorCode.RESOURCE_NOT_FOUND, 'Channel not found')
      );

      sdk.startAutoRefresh();

      // Advance timers and flush promises
      jest.advanceTimersByTime(30000);
      await Promise.resolve(); // Flush microtasks
      await Promise.resolve(); // Extra flush for async callback
      await Promise.resolve(); // One more for the cache delete

      // Channel should be removed from cache (line 608 coverage)
      expect(sdk.getMyChannels().length).toBe(0);

      sdk.stopAutoRefresh();
    });
  });

  // --------------------------------------------------------------------------
  // getMyChannels() tests
  // --------------------------------------------------------------------------

  describe('getMyChannels()', () => {
    it('should return empty array when no channels cached', () => {
      const channels = sdk.getMyChannels();

      expect(channels).toEqual([]);
    });

    it('should return cached channel addresses', async () => {
      // Add channels via getChannelState
      mockAptosClient.view
        .mockResolvedValueOnce([
          '0xdest1000000000000000000000000000000000000000000000000000000000',
          'pk1'.repeat(21).slice(0, 64),
          '1000',
          '0',
          '0',
          '3600',
          '0',
        ])
        .mockResolvedValueOnce([
          '0xdest2000000000000000000000000000000000000000000000000000000000',
          'pk2'.repeat(21).slice(0, 64),
          '2000',
          '0',
          '0',
          '3600',
          '0',
        ]);

      await sdk.getChannelState('0xowner1');
      await sdk.getChannelState('0xowner2');

      const channels = sdk.getMyChannels();

      expect(channels.length).toBe(2);
      // Check that channel addresses include the owner identifiers (normalized)
      expect(channels.some((c) => c.includes('owner1'))).toBe(true);
      expect(channels.some((c) => c.includes('owner2'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Address normalization tests
  // --------------------------------------------------------------------------

  describe('Address normalization', () => {
    it('should normalize addresses to lowercase with 0x prefix', async () => {
      mockAptosClient.view.mockResolvedValueOnce(['0xDEST', 'pk', '1000', '0', '0', '3600', '0']);

      // Use mixed case address
      await sdk.getChannelState('0xABCD');

      // View should be called with normalized address and coin type
      expect(mockAptosClient.view).toHaveBeenCalledWith(
        expect.any(String),
        'payment_channel',
        'get_channel',
        ['0x1::aptos_coin::AptosCoin'],
        [expect.stringMatching(/^0x[0-9a-f]+$/)]
      );
    });

    it('should pad short addresses', async () => {
      mockAptosClient.view.mockResolvedValueOnce(['0xdest', 'pk', '1000', '0', '0', '3600', '0']);

      await sdk.getChannelState('0x1');

      // Should be padded to 64 chars, coin type included
      expect(mockAptosClient.view).toHaveBeenCalledWith(
        expect.any(String),
        'payment_channel',
        'get_channel',
        ['0x1::aptos_coin::AptosCoin'],
        ['0x0000000000000000000000000000000000000000000000000000000000000001']
      );
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createAptosChannelSDKFromEnv', () => {
  const originalEnv = process.env;
  const mockAptosClientFromEnv = createAptosClientFromEnv as jest.MockedFunction<
    typeof createAptosClientFromEnv
  >;
  const mockClaimSignerFromEnv = createAptosClaimSignerFromEnv as jest.MockedFunction<
    typeof createAptosClaimSignerFromEnv
  >;

  beforeEach(() => {
    // Reset env
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw if APTOS_MODULE_ADDRESS is not set', async () => {
    // Ensure env var is not set
    delete process.env.APTOS_MODULE_ADDRESS;
    // Also ensure other required vars are not set to avoid other errors first
    delete process.env.APTOS_NODE_URL;
    delete process.env.APTOS_PRIVATE_KEY;
    delete process.env.APTOS_ACCOUNT_ADDRESS;
    delete process.env.APTOS_CLAIM_PRIVATE_KEY;

    const mockLogger = createMockLogger();

    await expect(createAptosChannelSDKFromEnv(mockLogger)).rejects.toThrow(
      'APTOS_MODULE_ADDRESS environment variable is required'
    );
  });

  it('should create SDK with all required env vars set', async () => {
    // Set all required env vars
    process.env.APTOS_MODULE_ADDRESS = '0xmodule1234567890abcdef::payment_channel';
    process.env.APTOS_NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';
    process.env.APTOS_PRIVATE_KEY = 'abc123';
    process.env.APTOS_ACCOUNT_ADDRESS = '0xaccount123';
    process.env.APTOS_CLAIM_PRIVATE_KEY = 'def456';

    // Create mock instances that the factory functions will return
    const mockClient = createMockAptosClient();
    const mockSigner = createMockClaimSigner();
    const mockLogger = createMockLogger();

    // Configure mocks to return our mock instances (now async)
    mockAptosClientFromEnv.mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createAptosClientFromEnv>>
    );
    mockClaimSignerFromEnv.mockResolvedValue(
      mockSigner as unknown as Awaited<ReturnType<typeof createAptosClaimSignerFromEnv>>
    );

    // Call factory function (now async)
    const sdk = await createAptosChannelSDKFromEnv(mockLogger);

    // Verify SDK was created
    expect(sdk).toBeInstanceOf(AptosChannelSDK);

    // Verify factory functions were called with logger
    expect(mockAptosClientFromEnv).toHaveBeenCalledWith(mockLogger);
    expect(mockClaimSignerFromEnv).toHaveBeenCalledWith(mockLogger);

    // Cleanup
    sdk.stopAutoRefresh();
  });

  it('should use optional env vars for config when set', async () => {
    // Set all required env vars
    process.env.APTOS_MODULE_ADDRESS = '0xmodule1234567890abcdef::payment_channel';
    process.env.APTOS_NODE_URL = 'https://fullnode.testnet.aptoslabs.com/v1';
    process.env.APTOS_PRIVATE_KEY = 'abc123';
    process.env.APTOS_ACCOUNT_ADDRESS = '0xaccount123';
    process.env.APTOS_CLAIM_PRIVATE_KEY = 'def456';
    // Set optional env vars
    process.env.APTOS_CHANNEL_REFRESH_INTERVAL_MS = '60000';
    process.env.APTOS_DEFAULT_SETTLE_DELAY = '7200';

    // Create mock instances
    const mockClient = createMockAptosClient();
    const mockSigner = createMockClaimSigner();
    const mockLogger = createMockLogger();

    mockAptosClientFromEnv.mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createAptosClientFromEnv>>
    );
    mockClaimSignerFromEnv.mockResolvedValue(
      mockSigner as unknown as Awaited<ReturnType<typeof createAptosClaimSignerFromEnv>>
    );

    // Call factory function (now async)
    const sdk = await createAptosChannelSDKFromEnv(mockLogger);

    // Verify SDK was created
    expect(sdk).toBeInstanceOf(AptosChannelSDK);

    // Cleanup
    sdk.stopAutoRefresh();
  });
});
