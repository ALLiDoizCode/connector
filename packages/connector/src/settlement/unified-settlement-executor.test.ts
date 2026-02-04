/**
 * Unit Tests for UnifiedSettlementExecutor
 *
 * Tests tri-chain settlement routing logic for EVM, XRP, and Aptos payment channels.
 * Verifies settlement method selection based on peer configuration and token type.
 *
 * Source: Epic 9 Story 9.5 - Dual-Settlement Support (EVM + XRP)
 * Extended: Epic 27 Story 27.5 - Tri-Chain Settlement Integration (EVM + XRP + Aptos)
 * Extended: Epic 17 Story 17.4 - ClaimSender Integration for Off-Chain Claim Exchange
 *
 * @module settlement/unified-settlement-executor.test
 */

import { UnifiedSettlementExecutor, SettlementDisabledError } from './unified-settlement-executor';
import type { PaymentChannelSDK } from './payment-channel-sdk';
import type { PaymentChannelManager } from './xrp-channel-manager';
import type { ClaimSigner } from './xrp-claim-signer';
import type { SettlementMonitor } from './settlement-monitor';
import type { AccountManager } from './account-manager';
import type { IAptosChannelSDK } from './aptos-channel-sdk';
import type { AptosClaim } from './aptos-claim-signer';
import type { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import type { Logger } from 'pino';
import type { UnifiedSettlementExecutorConfig, SettlementRequiredEvent } from './types';
import type { ClaimSender, ClaimSendResult } from './claim-sender';
import type { BTPClientManager } from '../btp/btp-client-manager';
import type { BTPClient } from '../btp/btp-client';

describe('UnifiedSettlementExecutor', () => {
  let executor: UnifiedSettlementExecutor;
  let mockEVMChannelSDK: jest.Mocked<PaymentChannelSDK>;
  let mockXRPChannelManager: jest.Mocked<PaymentChannelManager>;
  let mockXRPClaimSigner: jest.Mocked<ClaimSigner>;
  let mockAptosChannelSDK: jest.Mocked<IAptosChannelSDK>;
  let mockClaimSender: jest.Mocked<ClaimSender>;
  let mockBTPClientManager: jest.Mocked<BTPClientManager>;
  let mockBTPClient: jest.Mocked<BTPClient>;
  let mockSettlementMonitor: jest.Mocked<SettlementMonitor>;
  let mockAccountManager: jest.Mocked<AccountManager>;
  let mockTelemetryEmitter: jest.Mocked<TelemetryEmitter>;
  let mockLogger: jest.Mocked<Logger>;

  // Mock Aptos claim for testing
  const mockAptosClaim: AptosClaim = {
    channelOwner: '0x' + '1'.repeat(64),
    amount: BigInt('1000000000'),
    nonce: 1,
    signature: '0x' + 'a'.repeat(128),
    publicKey: '0x' + 'b'.repeat(64),
    createdAt: Date.now(),
  };

  beforeEach(() => {
    // Clear environment variables
    delete process.env.APTOS_SETTLEMENT_ENABLED;

    // Create fresh mock instances (Anti-Pattern 3 solution)
    mockEVMChannelSDK = {
      openChannel: jest.fn().mockResolvedValue({ channelId: '0xabc123', txHash: '0xMockTxHash' }),
      signBalanceProof: jest.fn().mockResolvedValue('0xsignature'),
      getSignerAddress: jest.fn().mockResolvedValue('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'),
      getChannelState: jest.fn(),
      closeChannel: jest.fn(),
      cooperativeSettle: jest.fn(),
      deposit: jest.fn(),
      getMyChannels: jest.fn(),
      settleChannel: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<PaymentChannelSDK>;

    mockXRPChannelManager = {
      createChannel: jest.fn().mockResolvedValue('A'.repeat(64)),
      submitClaim: jest.fn().mockResolvedValue({}),
      closeChannel: jest.fn(),
      getChannelState: jest.fn(),
    } as unknown as jest.Mocked<PaymentChannelManager>;

    mockXRPClaimSigner = {
      signClaim: jest.fn().mockResolvedValue('B'.repeat(128)),
      getPublicKey: jest.fn().mockReturnValue('ED' + 'C'.repeat(64)),
      verifyClaim: jest.fn(),
    } as unknown as jest.Mocked<ClaimSigner>;

    mockAptosChannelSDK = {
      openChannel: jest.fn().mockResolvedValue('0x' + '1'.repeat(64)),
      deposit: jest.fn().mockResolvedValue(undefined),
      signClaim: jest.fn().mockReturnValue(mockAptosClaim),
      verifyClaim: jest.fn().mockReturnValue(true),
      submitClaim: jest.fn().mockResolvedValue(undefined),
      requestClose: jest.fn().mockResolvedValue(undefined),
      finalizeClose: jest.fn().mockResolvedValue(undefined),
      getChannelState: jest.fn().mockResolvedValue(null),
      getMyChannels: jest.fn().mockReturnValue([]),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    } as unknown as jest.Mocked<IAptosChannelSDK>;

    mockSettlementMonitor = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      listenerCount: jest.fn().mockReturnValue(0),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<SettlementMonitor>;

    mockAccountManager = {
      recordSettlement: jest.fn().mockResolvedValue(undefined),
      getAccountBalance: jest.fn(),
      getPeerAccountPair: jest.fn(),
      recordPacketForward: jest.fn(),
      recordPacketReceive: jest.fn(),
    } as unknown as jest.Mocked<AccountManager>;

    mockTelemetryEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<TelemetryEmitter>;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
      fatal: jest.fn(),
      trace: jest.fn(),
      level: 'info',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock BTPClient (Epic 17)
    mockBTPClient = {
      sendProtocolData: jest.fn().mockResolvedValue(undefined),
      isConnected: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock BTPClientManager (Epic 17)
    mockBTPClientManager = {
      getClientForPeer: jest.fn().mockReturnValue(mockBTPClient),
      isConnected: jest.fn().mockReturnValue(true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Mock ClaimSender (Epic 17)
    const successResult: ClaimSendResult = {
      success: true,
      messageId: 'xrp-test-msg-123',
      timestamp: new Date().toISOString(),
    };

    mockClaimSender = {
      sendXRPClaim: jest.fn().mockResolvedValue(successResult),
      sendEVMClaim: jest.fn().mockResolvedValue({
        ...successResult,
        messageId: 'evm-test-msg-456',
      }),
      sendAptosClaim: jest.fn().mockResolvedValue({
        ...successResult,
        messageId: 'aptos-test-msg-789',
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const config: UnifiedSettlementExecutorConfig = {
      peers: new Map([
        [
          'peer-alice',
          {
            peerId: 'peer-alice',
            address: 'g.alice',
            settlementPreference: 'evm',
            settlementTokens: ['USDC', 'DAI'],
            evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
          },
        ],
        [
          'peer-bob',
          {
            peerId: 'peer-bob',
            address: 'g.bob',
            settlementPreference: 'xrp',
            settlementTokens: ['XRP'],
            xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
          },
        ],
        [
          'peer-charlie',
          {
            peerId: 'peer-charlie',
            address: 'g.charlie',
            settlementPreference: 'both',
            settlementTokens: ['USDC', 'XRP'],
            evmAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            xrpAddress: 'rLHzPsX6oXkzU9rFkRaYT8yBqJcQwPgHWN',
          },
        ],
        [
          'peer-aptos',
          {
            peerId: 'peer-aptos',
            address: 'g.aptos',
            settlementPreference: 'aptos',
            settlementTokens: ['APT'],
            aptosAddress: '0x' + '2'.repeat(64),
            aptosPubkey: '3'.repeat(64),
          },
        ],
        [
          'peer-trichain',
          {
            peerId: 'peer-trichain',
            address: 'g.trichain',
            settlementPreference: 'any',
            settlementTokens: ['USDC', 'XRP', 'APT'],
            evmAddress: '0x9cA1f109551bD432803012645Ac136ddd64DBA73',
            xrpAddress: 'rMHzPsX6oXkzU9rFkRaYT8yBqJcQwPgHWO',
            aptosAddress: '0x' + '4'.repeat(64),
            aptosPubkey: '5'.repeat(64),
          },
        ],
      ]),
      defaultPreference: 'any',
      enabled: true,
    };

    executor = new UnifiedSettlementExecutor(
      config,
      mockEVMChannelSDK,
      mockXRPChannelManager,
      mockXRPClaimSigner,
      mockAptosChannelSDK,
      mockClaimSender,
      mockBTPClientManager,
      mockSettlementMonitor,
      mockAccountManager,
      mockTelemetryEmitter,
      mockLogger
    );
  });

  afterEach(() => {
    // Ensure cleanup on test failure (Anti-Pattern 5 solution)
    executor.stop();
    // Reset environment
    delete process.env.APTOS_SETTLEMENT_ENABLED;
  });

  describe('Event Listener Cleanup', () => {
    it('should register listener on start', () => {
      executor.start();
      expect(mockSettlementMonitor.on).toHaveBeenCalledWith(
        'SETTLEMENT_REQUIRED',
        expect.any(Function)
      );
    });

    it('should unregister listener on stop', () => {
      executor.start();
      executor.stop();
      expect(mockSettlementMonitor.off).toHaveBeenCalledWith(
        'SETTLEMENT_REQUIRED',
        expect.any(Function)
      );
    });

    it('should log startup and shutdown messages', () => {
      executor.start();
      expect(mockLogger.info).toHaveBeenCalledWith('Starting UnifiedSettlementExecutor...');
      expect(mockLogger.info).toHaveBeenCalledWith('UnifiedSettlementExecutor started');

      executor.stop();
      expect(mockLogger.info).toHaveBeenCalledWith('Stopping UnifiedSettlementExecutor...');
      expect(mockLogger.info).toHaveBeenCalledWith('UnifiedSettlementExecutor stopped');
    });
  });

  describe('EVM Settlement Routing', () => {
    it('should route USDC settlement to EVM for peer with evm preference', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice',
        balance: '1000000000', // 1000 USDC
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      // Manually invoke handler to simulate event emission
      // Note: We don't use mockSettlementMonitor.emit since we're testing the handler directly

      // Manually invoke handler to simulate event emission
      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockEVMChannelSDK.openChannel).toHaveBeenCalledWith(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        '0xUSDCAddress',
        86400,
        BigInt('1000000000')
      );
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-alice',
        '0xUSDCAddress',
        BigInt('1000000000')
      );
    });

    it('should route USDC settlement to EVM for peer with both preference', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-charlie',
        balance: '5000000000', // 5000 USDC
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockEVMChannelSDK.openChannel).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-charlie',
        '0xUSDCAddress',
        BigInt('5000000000')
      );
    });

    it('should route USDC settlement to EVM for peer with any preference', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-trichain',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockEVMChannelSDK.openChannel).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-trichain',
        '0xUSDCAddress',
        BigInt('1000000000')
      );
    });
  });

  describe('XRP Settlement Routing', () => {
    it('should route XRP settlement to XRP for peer with xrp preference', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-bob',
        balance: '10000000000', // 10,000 XRP drops
        tokenId: 'XRP',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockXRPChannelManager.createChannel).toHaveBeenCalledWith(
        'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
        '10000000000',
        86400
      );
      expect(mockXRPClaimSigner.signClaim).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-bob',
        'XRP',
        BigInt('10000000000')
      );
    });

    it('should route XRP settlement to XRP for peer with both preference', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-charlie',
        balance: '5000000000', // 5,000 XRP drops
        tokenId: 'XRP',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockXRPChannelManager.createChannel).toHaveBeenCalled();
      expect(mockXRPClaimSigner.signClaim).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-charlie',
        'XRP',
        BigInt('5000000000')
      );
    });

    it('should route XRP settlement to XRP for peer with any preference', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-trichain',
        balance: '5000000000',
        tokenId: 'XRP',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockXRPChannelManager.createChannel).toHaveBeenCalled();
      expect(mockXRPClaimSigner.signClaim).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-trichain',
        'XRP',
        BigInt('5000000000')
      );
    });
  });

  describe('Aptos Settlement Routing', () => {
    it('should route APT token to Aptos when preference is aptos', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000', // 10 APT in octas
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAptosChannelSDK.openChannel).toHaveBeenCalledWith(
        '0x' + '2'.repeat(64),
        '3'.repeat(64),
        BigInt('1000000000'),
        86400
      );
      expect(mockAptosChannelSDK.signClaim).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-aptos',
        'APT',
        BigInt('1000000000')
      );
    });

    it('should route APT token to Aptos when preference is any', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-trichain',
        balance: '2000000000', // 20 APT in octas
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAptosChannelSDK.openChannel).toHaveBeenCalled();
      expect(mockAptosChannelSDK.signClaim).toHaveBeenCalled();
      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-trichain',
        'APT',
        BigInt('2000000000')
      );
    });

    it('should reuse existing channel if one exists', async () => {
      // Configure mock to return existing channel
      mockAptosChannelSDK.getMyChannels.mockReturnValue(['0x' + '9'.repeat(64)]);

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      // Should NOT open new channel
      expect(mockAptosChannelSDK.openChannel).not.toHaveBeenCalled();
      // Should still sign claim using existing channel
      expect(mockAptosChannelSDK.signClaim).toHaveBeenCalledWith(
        '0x' + '9'.repeat(64),
        BigInt('1000000000')
      );
    });

    it('should create new channel if none exists', async () => {
      // Configure mock to return no existing channels
      mockAptosChannelSDK.getMyChannels.mockReturnValue([]);

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      // Should open new channel
      expect(mockAptosChannelSDK.openChannel).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error for APT token when preference is evm', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice', // evm preference
        balance: '1000000000',
        tokenId: 'APT', // APT token
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('No compatible settlement method');

      // Expect error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId: 'peer-alice',
          tokenId: 'APT',
        }),
        'Settlement failed'
      );
    });

    it('should throw error for APT token when preference is xrp', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-bob', // xrp preference
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('No compatible settlement method');
    });

    it('should throw error for XRP token when preference is evm', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice', // evm preference
        balance: '1000000000',
        tokenId: 'XRP', // XRP token
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('No compatible settlement method');
    });

    it('should throw error for USDC token when preference is aptos', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos', // aptos preference
        balance: '1000000000',
        tokenId: '0xUSDCAddress', // ERC20 token
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('No compatible settlement method');
    });

    it('should throw error for missing peer configuration', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'unknown-peer',
        balance: '1000000000',
        tokenId: 'USDC',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('Peer configuration not found');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'unknown-peer' }),
        'Peer configuration not found'
      );
    });

    it('should throw error for missing evmAddress on EVM settlement', async () => {
      // Create config with peer missing evmAddress
      const configWithMissingAddress: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-incomplete',
            {
              peerId: 'peer-incomplete',
              address: 'g.incomplete',
              settlementPreference: 'evm',
              settlementTokens: ['USDC'],
              // evmAddress missing
            },
          ],
        ]),
        defaultPreference: 'any',
        enabled: true,
      };

      const executorIncomplete = new UnifiedSettlementExecutor(
        configWithMissingAddress,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        mockAptosChannelSDK,
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        mockTelemetryEmitter,
        mockLogger
      );

      executorIncomplete.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-incomplete',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('missing evmAddress');

      executorIncomplete.stop();
    });

    it('should throw error for missing xrpAddress on XRP settlement', async () => {
      // Create config with peer missing xrpAddress
      const configWithMissingAddress: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-incomplete',
            {
              peerId: 'peer-incomplete',
              address: 'g.incomplete',
              settlementPreference: 'xrp',
              settlementTokens: ['XRP'],
              // xrpAddress missing
            },
          ],
        ]),
        defaultPreference: 'any',
        enabled: true,
      };

      const executorIncomplete = new UnifiedSettlementExecutor(
        configWithMissingAddress,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        mockAptosChannelSDK,
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        mockTelemetryEmitter,
        mockLogger
      );

      executorIncomplete.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-incomplete',
        balance: '1000000000',
        tokenId: 'XRP',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('missing xrpAddress');

      executorIncomplete.stop();
    });

    it('should throw error for missing aptosAddress on Aptos settlement', async () => {
      const configWithMissingAddress: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-incomplete',
            {
              peerId: 'peer-incomplete',
              address: 'g.incomplete',
              settlementPreference: 'aptos',
              settlementTokens: ['APT'],
              // aptosAddress missing
            },
          ],
        ]),
        defaultPreference: 'any',
        enabled: true,
      };

      const executorIncomplete = new UnifiedSettlementExecutor(
        configWithMissingAddress,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        mockAptosChannelSDK,
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        mockTelemetryEmitter,
        mockLogger
      );

      executorIncomplete.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-incomplete',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('missing aptosAddress');

      executorIncomplete.stop();
    });

    it('should throw error for missing aptosPubkey on Aptos settlement', async () => {
      const configWithMissingPubkey: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-incomplete',
            {
              peerId: 'peer-incomplete',
              address: 'g.incomplete',
              settlementPreference: 'aptos',
              settlementTokens: ['APT'],
              aptosAddress: '0x' + '1'.repeat(64),
              // aptosPubkey missing
            },
          ],
        ]),
        defaultPreference: 'any',
        enabled: true,
      };

      const executorIncomplete = new UnifiedSettlementExecutor(
        configWithMissingPubkey,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        mockAptosChannelSDK,
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        mockTelemetryEmitter,
        mockLogger
      );

      executorIncomplete.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-incomplete',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('missing aptosPubkey');

      executorIncomplete.stop();
    });
  });

  describe('Backward Compatibility', () => {
    it('should treat both preference as any for backward compatibility', async () => {
      executor.start();

      // peer-charlie has 'both' preference
      const event: SettlementRequiredEvent = {
        peerId: 'peer-charlie',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      // Should route to EVM successfully (both treated as any)
      expect(mockEVMChannelSDK.openChannel).toHaveBeenCalled();
    });

    it('should work without Aptos SDK (null) for EVM/XRP settlements', async () => {
      const config: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-alice',
            {
              peerId: 'peer-alice',
              address: 'g.alice',
              settlementPreference: 'evm',
              settlementTokens: ['USDC'],
              evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
            },
          ],
        ]),
        defaultPreference: 'evm',
        enabled: true,
      };

      const executorNoAptos = new UnifiedSettlementExecutor(
        config,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        null, // No Aptos SDK
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        null, // No telemetry
        mockLogger
      );

      executorNoAptos.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      // EVM settlement should still work
      expect(mockEVMChannelSDK.openChannel).toHaveBeenCalled();

      executorNoAptos.stop();
    });

    it('should throw error when Aptos SDK is null but APT token requested', async () => {
      const config: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-aptos',
            {
              peerId: 'peer-aptos',
              address: 'g.aptos',
              settlementPreference: 'aptos',
              settlementTokens: ['APT'],
              aptosAddress: '0x' + '2'.repeat(64),
              aptosPubkey: '3'.repeat(64),
            },
          ],
        ]),
        defaultPreference: 'any',
        enabled: true,
      };

      const executorNoAptos = new UnifiedSettlementExecutor(
        config,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        null, // No Aptos SDK
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        null,
        mockLogger
      );

      executorNoAptos.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await expect(handler(event)).rejects.toThrow('AptosChannelSDK not configured');

      executorNoAptos.stop();
    });
  });

  describe('Feature Flag', () => {
    it('should throw SettlementDisabledError when feature flag is false', async () => {
      process.env.APTOS_SETTLEMENT_ENABLED = 'false';

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await expect(handler(event)).rejects.toThrow(SettlementDisabledError);
      await expect(handler(event)).rejects.toThrow('Aptos settlement is currently disabled');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-aptos', tokenId: 'APT' }),
        'Aptos settlement disabled, skipping'
      );
    });

    it('should allow Aptos settlement when feature flag is not set (default enabled)', async () => {
      // Feature flag not set - should default to enabled
      delete process.env.APTOS_SETTLEMENT_ENABLED;

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAptosChannelSDK.signClaim).toHaveBeenCalled();
    });

    it('should allow Aptos settlement when feature flag is explicitly true', async () => {
      process.env.APTOS_SETTLEMENT_ENABLED = 'true';

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAptosChannelSDK.signClaim).toHaveBeenCalled();
    });
  });

  describe('TigerBeetle Integration', () => {
    it('should update TigerBeetle accounts after successful EVM settlement', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-alice',
        '0xUSDCAddress',
        BigInt('1000000000')
      );
    });

    it('should update TigerBeetle accounts after successful XRP settlement', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-bob',
        balance: '5000000000',
        tokenId: 'XRP',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-bob',
        'XRP',
        BigInt('5000000000')
      );
    });

    it('should update TigerBeetle after Aptos settlement', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockAccountManager.recordSettlement).toHaveBeenCalledWith(
        'peer-aptos',
        'APT',
        BigInt('1000000000')
      );
    });

    it('should not update TigerBeetle accounts if settlement fails', async () => {
      // Mock EVM channel SDK to fail
      mockEVMChannelSDK.openChannel.mockRejectedValueOnce(new Error('Blockchain error'));

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      await expect(handler(event)).rejects.toThrow('Blockchain error');

      // recordSettlement should NOT be called
      expect(mockAccountManager.recordSettlement).not.toHaveBeenCalled();
    });
  });

  describe('Telemetry Emission', () => {
    it('should emit APTOS_SETTLEMENT_COMPLETED telemetry on success', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'APTOS_SETTLEMENT_COMPLETED',
          peerId: 'peer-aptos',
          amount: '1000000000',
        })
      );
    });

    it('should emit APTOS_CLAIM_SIGNED telemetry on claim creation', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'APTOS_CLAIM_SIGNED',
          amount: '1000000000',
          nonce: 1,
        })
      );
    });

    it('should emit APTOS_CHANNEL_OPENED telemetry on new channel', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'APTOS_CHANNEL_OPENED',
          destination: '0x' + '2'.repeat(64),
          settleDelay: 86400,
        })
      );
    });

    it('should emit APTOS_SETTLEMENT_FAILED telemetry on error', async () => {
      mockAptosChannelSDK.openChannel.mockRejectedValueOnce(new Error('Network error'));

      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await expect(handler(event)).rejects.toThrow('Network error');

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'APTOS_SETTLEMENT_FAILED',
          peerId: 'peer-aptos',
          error: 'Network error',
        })
      );
    });

    it('should not fail if telemetry emitter is null', async () => {
      const config: UnifiedSettlementExecutorConfig = {
        peers: new Map([
          [
            'peer-aptos',
            {
              peerId: 'peer-aptos',
              address: 'g.aptos',
              settlementPreference: 'aptos',
              settlementTokens: ['APT'],
              aptosAddress: '0x' + '2'.repeat(64),
              aptosPubkey: '3'.repeat(64),
            },
          ],
        ]),
        defaultPreference: 'any',
        enabled: true,
      };

      const executorNoTelemetry = new UnifiedSettlementExecutor(
        config,
        mockEVMChannelSDK,
        mockXRPChannelManager,
        mockXRPClaimSigner,
        mockAptosChannelSDK,
        mockClaimSender,
        mockBTPClientManager,
        mockSettlementMonitor,
        mockAccountManager,
        null, // No telemetry
        mockLogger
      );

      executorNoTelemetry.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

      // Should not throw
      await expect(handler(event)).resolves.not.toThrow();

      executorNoTelemetry.stop();
    });
  });

  describe('Tri-Channel Peer', () => {
    it('should handle tri-channel peer with all three settlement methods', async () => {
      executor.start();

      // Test USDC (EVM)
      const evmEvent: SettlementRequiredEvent = {
        peerId: 'peer-trichain',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(evmEvent);
      expect(mockEVMChannelSDK.openChannel).toHaveBeenCalled();

      // Reset mocks
      jest.clearAllMocks();

      // Test XRP
      const xrpEvent: SettlementRequiredEvent = {
        peerId: 'peer-trichain',
        balance: '2000000000',
        tokenId: 'XRP',
        timestamp: Date.now(),
      };

      await handler(xrpEvent);
      expect(mockXRPChannelManager.createChannel).toHaveBeenCalled();

      // Reset mocks
      jest.clearAllMocks();

      // Test APT (Aptos)
      const aptEvent: SettlementRequiredEvent = {
        peerId: 'peer-trichain',
        balance: '3000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      await handler(aptEvent);
      expect(mockAptosChannelSDK.openChannel).toHaveBeenCalled();
    });
  });

  describe('Logging', () => {
    it('should log settlement request details', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId: 'peer-alice', balance: '1000000000', tokenId: '0xUSDCAddress' },
        'Handling settlement request...'
      );
    });

    it('should log settlement completion', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-alice',
        balance: '1000000000',
        tokenId: '0xUSDCAddress',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId: 'peer-alice', balance: '1000000000', tokenId: '0xUSDCAddress' },
        'Settlement completed successfully'
      );
    });

    it('should log Aptos settlement details', async () => {
      executor.start();

      const event: SettlementRequiredEvent = {
        peerId: 'peer-aptos',
        balance: '1000000000',
        tokenId: 'APT',
        timestamp: Date.now(),
      };

      const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
      await handler(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-aptos', amount: '1000000000' }),
        'Settling via Aptos payment channel...'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-aptos' }),
        'Aptos settlement completed'
      );
    });
  });

  describe('Epic 17: Claim Sender Integration', () => {
    describe('XRP Claim Sending', () => {
      it('should send XRP claim via ClaimSender when settling via XRP', async () => {
        executor.start();

        const event: SettlementRequiredEvent = {
          peerId: 'peer-bob',
          balance: '1000000', // XRP drops
          tokenId: 'XRP',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
        await handler(event);

        // Verify BTPClient retrieved
        expect(mockBTPClientManager.getClientForPeer).toHaveBeenCalledWith('peer-bob');
        expect(mockBTPClientManager.isConnected).toHaveBeenCalledWith('peer-bob');

        // Verify ClaimSender.sendXRPClaim called with correct parameters
        expect(mockClaimSender.sendXRPClaim).toHaveBeenCalledWith(
          'peer-bob',
          mockBTPClient,
          'A'.repeat(64), // channelId from mockXRPChannelManager
          '1000000', // amount
          'B'.repeat(128), // signature from mockXRPClaimSigner
          'ED' + 'C'.repeat(64) // publicKey from mockXRPClaimSigner
        );

        // Verify success logged
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            peerId: 'peer-bob',
            messageId: 'xrp-test-msg-123',
          }),
          'XRP claim sent to peer successfully'
        );
      });

      it('should throw error when XRP claim send fails', async () => {
        executor.start();

        // Mock claim send failure
        mockClaimSender.sendXRPClaim.mockResolvedValue({
          success: false,
          messageId: 'xrp-fail-123',
          timestamp: new Date().toISOString(),
          error: 'Network error',
        });

        const event: SettlementRequiredEvent = {
          peerId: 'peer-bob',
          balance: '1000000',
          tokenId: 'XRP',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

        await expect(handler(event)).rejects.toThrow(
          'Failed to send XRP claim to peer: Network error'
        );

        // Verify error logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ peerId: 'peer-bob' }),
          'Failed to send XRP claim'
        );
      });

      it('should throw error when peer not connected for XRP settlement', async () => {
        executor.start();

        // Mock peer not connected
        mockBTPClientManager.getClientForPeer.mockReturnValue(undefined);

        const event: SettlementRequiredEvent = {
          peerId: 'peer-bob',
          balance: '1000000',
          tokenId: 'XRP',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

        await expect(handler(event)).rejects.toThrow('No BTP connection to peer peer-bob');
      });
    });

    describe('EVM Claim Sending', () => {
      it('should send EVM claim via ClaimSender when settling via EVM', async () => {
        executor.start();

        const event: SettlementRequiredEvent = {
          peerId: 'peer-alice',
          balance: '1000000000',
          tokenId: '0xUSDCAddress',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
        await handler(event);

        // Verify BTPClient retrieved
        expect(mockBTPClientManager.getClientForPeer).toHaveBeenCalledWith('peer-alice');
        expect(mockBTPClientManager.isConnected).toHaveBeenCalledWith('peer-alice');

        // Verify ClaimSender.sendEVMClaim called with correct parameters
        expect(mockClaimSender.sendEVMClaim).toHaveBeenCalledWith(
          'peer-alice',
          mockBTPClient,
          '0xabc123', // channelId from mockEVMChannelSDK
          1, // nonce
          '1000000000', // transferredAmount
          '0', // lockedAmount
          '0x0000000000000000000000000000000000000000000000000000000000000000', // locksRoot
          '0xsignature', // signature from mockEVMChannelSDK
          '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' // signerAddress
        );

        // Verify success logged
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            peerId: 'peer-alice',
            messageId: 'evm-test-msg-456',
          }),
          'EVM claim sent to peer successfully'
        );
      });

      it('should throw error when EVM claim send fails', async () => {
        executor.start();

        // Mock claim send failure
        mockClaimSender.sendEVMClaim.mockResolvedValue({
          success: false,
          messageId: 'evm-fail-456',
          timestamp: new Date().toISOString(),
          error: 'Timeout',
        });

        const event: SettlementRequiredEvent = {
          peerId: 'peer-alice',
          balance: '1000000000',
          tokenId: '0xUSDCAddress',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

        await expect(handler(event)).rejects.toThrow('Failed to send EVM claim to peer: Timeout');
      });
    });

    describe('Aptos Claim Sending', () => {
      it('should send Aptos claim via ClaimSender when settling via Aptos', async () => {
        executor.start();

        const event: SettlementRequiredEvent = {
          peerId: 'peer-aptos',
          balance: '1000000000',
          tokenId: 'APT',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];
        await handler(event);

        // Verify BTPClient retrieved
        expect(mockBTPClientManager.getClientForPeer).toHaveBeenCalledWith('peer-aptos');
        expect(mockBTPClientManager.isConnected).toHaveBeenCalledWith('peer-aptos');

        // Verify ClaimSender.sendAptosClaim called with correct parameters
        expect(mockClaimSender.sendAptosClaim).toHaveBeenCalledWith(
          'peer-aptos',
          mockBTPClient,
          '0x' + '1'.repeat(64), // channelOwner from mockAptosChannelSDK
          '1000000000', // amount
          1, // nonce from mockAptosClaim
          '0x' + 'a'.repeat(128), // signature from mockAptosClaim
          '0x' + 'b'.repeat(64) // publicKey from mockAptosClaim
        );

        // Verify success logged
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            peerId: 'peer-aptos',
            messageId: 'aptos-test-msg-789',
          }),
          'Aptos claim sent to peer successfully'
        );
      });

      it('should throw error when Aptos claim send fails', async () => {
        executor.start();

        // Mock claim send failure
        mockClaimSender.sendAptosClaim.mockResolvedValue({
          success: false,
          messageId: 'aptos-fail-789',
          timestamp: new Date().toISOString(),
          error: 'Connection lost',
        });

        const event: SettlementRequiredEvent = {
          peerId: 'peer-aptos',
          balance: '1000000000',
          tokenId: 'APT',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

        await expect(handler(event)).rejects.toThrow(
          'Failed to send Aptos claim to peer: Connection lost'
        );
      });
    });

    describe('BTP Connection State Validation', () => {
      it('should throw error when BTP connection is not active', async () => {
        executor.start();

        // Mock connection inactive
        mockBTPClientManager.isConnected.mockReturnValue(false);

        const event: SettlementRequiredEvent = {
          peerId: 'peer-bob',
          balance: '1000000',
          tokenId: 'XRP',
          timestamp: Date.now(),
        };

        const handler = (mockSettlementMonitor.on as jest.Mock).mock.calls[0][1];

        await expect(handler(event)).rejects.toThrow(
          'BTP connection to peer peer-bob is not active'
        );

        // Verify error logged
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ peerId: 'peer-bob' }),
          'BTP connection to peer peer-bob is not active'
        );
      });
    });
  });
});
