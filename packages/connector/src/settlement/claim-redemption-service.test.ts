/**
 * Unit tests for ClaimRedemptionService
 *
 * Tests automatic on-chain claim redemption functionality including:
 * - Service lifecycle (start/stop)
 * - Claim polling and processing
 * - Profitability checks
 * - XRP/EVM/Aptos redemption success
 * - Retry logic with exponential backoff
 * - Gas estimation
 * - Database updates
 * - Telemetry emission
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ClaimRedemptionService } from './claim-redemption-service';
import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ethers } from 'ethers';
import type { XRPChannelSDK } from './xrp-channel-sdk';
import type { PaymentChannelSDK } from './payment-channel-sdk';
import type { AptosChannelSDK } from './aptos-channel-sdk';
import type { TelemetryEmitter } from '../telemetry/telemetry-emitter';

describe('ClaimRedemptionService', () => {
  let service: ClaimRedemptionService;
  let mockDb: jest.Mocked<Database>;
  let mockXRPChannelSDK: jest.Mocked<XRPChannelSDK>;
  let mockEVMChannelSDK: jest.Mocked<PaymentChannelSDK>;
  let mockAptosChannelSDK: jest.Mocked<AptosChannelSDK>;
  let mockEvmProvider: jest.Mocked<ethers.Provider>;
  let mockLogger: jest.Mocked<Logger>;
  let mockTelemetryEmitter: jest.Mocked<TelemetryEmitter>;

  beforeEach(() => {
    // Mock Database
    mockDb = {
      prepare: jest.fn(),
    } as unknown as jest.Mocked<Database>;

    // Mock XRPChannelSDK
    mockXRPChannelSDK = {
      submitClaim: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<XRPChannelSDK>;

    // Mock PaymentChannelSDK
    mockEVMChannelSDK = {
      closeChannel: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentChannelSDK>;

    // Mock AptosChannelSDK
    mockAptosChannelSDK = {
      submitClaim: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AptosChannelSDK>;

    // Mock ethers.Provider
    mockEvmProvider = {
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: 1000000000n, // 1 gwei
      }),
    } as unknown as jest.Mocked<ethers.Provider>;

    // Mock Logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Logger>;

    // Mock TelemetryEmitter
    mockTelemetryEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<TelemetryEmitter>;

    // Create service instance
    service = new ClaimRedemptionService(
      mockDb,
      mockXRPChannelSDK,
      mockEVMChannelSDK,
      mockAptosChannelSDK,
      mockEvmProvider,
      {
        minProfitThreshold: 1000n,
        pollingInterval: 60000,
        maxConcurrentRedemptions: 5,
        evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      },
      mockLogger,
      mockTelemetryEmitter,
      'test-node'
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    service.stop();
  });

  describe('start()', () => {
    it('should start polling and set isRunning to true', () => {
      jest.useFakeTimers();

      service.start();

      expect(service.isRunning).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          pollingInterval: 60000,
          minProfitThreshold: '1000',
        }),
        'Starting claim redemption service'
      );

      jest.useRealTimers();
    });

    it('should warn if already running', () => {
      jest.useFakeTimers();

      service.start();
      service.start(); // Second start

      expect(mockLogger.warn).toHaveBeenCalledWith('Claim redemption service already running');

      jest.useRealTimers();
    });

    it('should call processRedemptions immediately on start', async () => {
      // Mock empty database result
      const mockStmt = {
        all: jest.fn().mockReturnValue([]),
      };
      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      // Wait for async processRedemptions to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT message_id'));
      expect(mockStmt.all).toHaveBeenCalledWith(5);

      service.stop();
    });
  });

  describe('stop()', () => {
    it('should stop polling and set isRunning to false', () => {
      jest.useFakeTimers();

      service.start();
      expect(service.isRunning).toBe(true);

      service.stop();

      expect(service.isRunning).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Claim redemption service stopped');

      jest.useRealTimers();
    });
  });

  describe('processRedemptions() - no claims', () => {
    it('should return early when no claims are found', async () => {
      const mockStmt = {
        all: jest.fn().mockReturnValue([]),
      };
      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStmt.all).toHaveBeenCalledWith(5);
      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();
      expect(mockEVMChannelSDK.closeChannel).not.toHaveBeenCalled();
      expect(mockAptosChannelSDK.submitClaim).not.toHaveBeenCalled();

      service.stop();
    });
  });

  describe('XRP claim redemption', () => {
    it('should successfully redeem XRP claim', async () => {
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_xrp_123',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_xrp_123',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any) // SELECT
        .mockReturnValueOnce(mockUpdateStmt as any); // UPDATE

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalledWith({
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      });

      expect(mockUpdateStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        'msg_xrp_123',
        'msg_xrp_123'
      );

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          messageId: 'msg_xrp_123',
          blockchain: 'xrp',
          success: true,
        })
      );

      service.stop();
    });

    it('should retry XRP claim redemption on failure', async () => {
      jest.useFakeTimers();

      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_xrp_retry',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_xrp_retry',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare.mockReturnValueOnce(mockStmt as any).mockReturnValue(mockUpdateStmt as any);

      // Fail twice, succeed on third attempt
      mockXRPChannelSDK.submitClaim
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('RPC unavailable'))
        .mockResolvedValueOnce(undefined);

      service.start();

      // Fast-forward through retries
      await jest.advanceTimersByTimeAsync(100); // Initial call
      await jest.advanceTimersByTimeAsync(1000); // First retry (1s delay)
      await jest.advanceTimersByTimeAsync(2000); // Second retry (2s delay)

      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalledTimes(3);
      expect(mockUpdateStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        'msg_xrp_retry',
        'msg_xrp_retry'
      );

      service.stop();
      jest.useRealTimers();
    });

    it('should fail after 3 retry attempts', async () => {
      jest.useFakeTimers();

      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_xrp_fail',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_xrp_fail',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      // All attempts fail
      mockXRPChannelSDK.submitClaim.mockRejectedValue(new Error('Permanent failure'));

      service.start();

      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalledTimes(3);

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          messageId: 'msg_xrp_fail',
          success: false,
          error: 'Permanent failure',
        })
      );

      service.stop();
      jest.useRealTimers();
    });
  });

  describe('EVM claim redemption', () => {
    it('should successfully redeem EVM claim', async () => {
      const evmClaim = {
        blockchain: 'evm',
        messageId: 'msg_evm_123',
        senderId: 'peer-bob',
        channelId: '0xDEF456',
        nonce: 5,
        transferredAmount: '8000000000000000000', // 8 ETH in wei (enough for profitability)
        lockedAmount: '0',
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: 'sig_evm',
        signerAddress: '0xABCD...',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_evm_123',
            peer_id: 'peer-bob',
            blockchain: 'evm',
            channel_id: '0xDEF456',
            claim_data: JSON.stringify(evmClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockEVMChannelSDK.closeChannel).toHaveBeenCalledWith(
        '0xDEF456',
        '0x1234567890abcdef1234567890abcdef12345678',
        {
          channelId: '0xDEF456',
          nonce: 5,
          transferredAmount: 8000000000000000000n,
          lockedAmount: 0n,
          locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        },
        'sig_evm'
      );

      expect(mockUpdateStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        'msg_evm_123',
        'msg_evm_123'
      );

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          messageId: 'msg_evm_123',
          blockchain: 'evm',
          success: true,
        })
      );

      service.stop();
    });
  });

  describe('Aptos claim redemption', () => {
    it('should successfully redeem Aptos claim', async () => {
      const aptosClaim = {
        blockchain: 'aptos',
        messageId: 'msg_aptos_123',
        senderId: 'peer-charlie',
        channelOwner: '0x789GHI',
        amount: '6000000',
        nonce: 3,
        signature: 'sig_aptos',
        publicKey: 'pubkey_aptos',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_aptos_123',
            peer_id: 'peer-charlie',
            blockchain: 'aptos',
            channel_id: '0x789GHI',
            claim_data: JSON.stringify(aptosClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAptosChannelSDK.submitClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          channelOwner: '0x789GHI',
          amount: 6000000n,
          nonce: 3,
          signature: 'sig_aptos',
          publicKey: 'pubkey_aptos',
          createdAt: expect.any(Number),
        })
      );

      expect(mockUpdateStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        'msg_aptos_123',
        'msg_aptos_123'
      );

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          messageId: 'msg_aptos_123',
          blockchain: 'aptos',
          success: true,
          channelId: '0x789GHI', // Aptos uses channelOwner as channelId
        })
      );

      service.stop();
    });
  });

  describe('Profitability check', () => {
    it('should redeem profitable claims', async () => {
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_profitable',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '10000', // 10000 - 10 (gas) = 9990, profit > 1000 threshold
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_profitable',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalled();

      service.stop();
    });

    it('should skip unprofitable claims', async () => {
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_unprofitable',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '500', // 500 - 10 (gas) = 490, profit < 1000 threshold
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_unprofitable',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg_unprofitable',
          claimAmount: '500',
          gasCost: '10',
        }),
        'Skipping unprofitable claim'
      );

      service.stop();
    });

    it('should skip high-gas EVM claims', async () => {
      // Mock high gas price
      mockEvmProvider.getFeeData.mockResolvedValue({
        gasPrice: 100000000000n, // 100 gwei (very high)
      } as any);

      const evmClaim = {
        blockchain: 'evm',
        messageId: 'msg_high_gas',
        senderId: 'peer-bob',
        channelId: '0xDEF456',
        nonce: 5,
        transferredAmount: '1000000', // Low amount
        lockedAmount: '0',
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: 'sig_evm',
        signerAddress: '0xABCD...',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_high_gas',
            peer_id: 'peer-bob',
            blockchain: 'evm',
            channel_id: '0xDEF456',
            claim_data: JSON.stringify(evmClaim),
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockEVMChannelSDK.closeChannel).not.toHaveBeenCalled();

      service.stop();
    });
  });

  describe('Gas estimation', () => {
    it('should estimate XRP gas as 10 drops', async () => {
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_xrp_gas',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '100000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_xrp_gas',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          gasCost: '10',
        })
      );

      service.stop();
    });

    it('should estimate EVM gas using provider.getFeeData()', async () => {
      const evmClaim = {
        blockchain: 'evm',
        messageId: 'msg_evm_gas',
        senderId: 'peer-bob',
        channelId: '0xDEF456',
        nonce: 5,
        transferredAmount: '10000000000000000000', // 10 ETH in wei (enough for profitability)
        lockedAmount: '0',
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: 'sig_evm',
        signerAddress: '0xABCD...',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_evm_gas',
            peer_id: 'peer-bob',
            blockchain: 'evm',
            channel_id: '0xDEF456',
            claim_data: JSON.stringify(evmClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockEvmProvider.getFeeData).toHaveBeenCalled();

      // Gas cost = 1 gwei * 150000 = 150000 gwei
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          gasCost: '150000000000000',
        })
      );

      service.stop();
    });

    it('should estimate Aptos gas as 10000 octas', async () => {
      const aptosClaim = {
        blockchain: 'aptos',
        messageId: 'msg_aptos_gas',
        senderId: 'peer-charlie',
        channelOwner: '0x789GHI',
        amount: '100000',
        nonce: 3,
        signature: 'sig_aptos',
        publicKey: 'pubkey_aptos',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_aptos_gas',
            peer_id: 'peer-charlie',
            blockchain: 'aptos',
            channel_id: '0x789GHI',
            claim_data: JSON.stringify(aptosClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          gasCost: '10000',
        })
      );

      service.stop();
    });
  });

  describe('Telemetry emission', () => {
    it('should emit CLAIM_REDEEMED on success', async () => {
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_telemetry_success',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_telemetry_success',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_REDEEMED',
        nodeId: 'test-node',
        peerId: 'peer-alice',
        blockchain: 'xrp',
        messageId: 'msg_telemetry_success',
        channelId: 'ABC123',
        amount: '5000000',
        txHash: 'msg_telemetry_success',
        gasCost: '10',
        success: true,
        error: undefined,
        timestamp: expect.any(String),
      });

      service.stop();
    });

    it('should emit CLAIM_REDEEMED on failure', async () => {
      jest.useFakeTimers();

      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_telemetry_fail',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_telemetry_fail',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      mockXRPChannelSDK.submitClaim.mockRejectedValue(new Error('Claim submission failed'));

      service.start();

      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_REDEEMED',
        nodeId: 'test-node',
        peerId: 'peer-alice',
        blockchain: 'xrp',
        messageId: 'msg_telemetry_fail',
        channelId: 'ABC123',
        amount: '5000000',
        txHash: '', // Empty string when redemption fails
        gasCost: '10',
        success: false,
        error: 'Claim submission failed',
        timestamp: expect.any(String),
      });

      service.stop();
      jest.useRealTimers();
    });

    it('should not crash if telemetry emission fails', async () => {
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg_telemetry_error',
        senderId: 'peer-alice',
        channelId: 'ABC123',
        amount: '5000000',
        signature: 'sig_xrp',
        publicKey: 'pubkey_xrp',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_telemetry_error',
            peer_id: 'peer-alice',
            blockchain: 'xrp',
            channel_id: 'ABC123',
            claim_data: JSON.stringify(xrpClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      mockTelemetryEmitter.emit.mockImplementation(() => {
        throw new Error('Telemetry server down');
      });

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Redemption should still succeed despite telemetry failure
      expect(mockUpdateStmt.run).toHaveBeenCalledWith(
        expect.any(Number),
        'msg_telemetry_error',
        'msg_telemetry_error'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
        'Error emitting CLAIM_REDEEMED telemetry'
      );

      service.stop();
    });
  });

  describe('Unknown blockchain type', () => {
    it('should handle unknown blockchain type gracefully', async () => {
      const unknownClaim = {
        blockchain: 'unknown_chain',
        messageId: 'msg_unknown',
        senderId: 'peer-unknown',
        channelId: 'UNKNOWN123',
        amount: '5000000',
        signature: 'sig_unknown',
        publicKey: 'pubkey_unknown',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_unknown',
            peer_id: 'peer-unknown',
            blockchain: 'unknown_chain',
            channel_id: 'UNKNOWN123',
            claim_data: JSON.stringify(unknownClaim),
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify no SDK calls were made
      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();
      expect(mockEVMChannelSDK.closeChannel).not.toHaveBeenCalled();
      expect(mockAptosChannelSDK.submitClaim).not.toHaveBeenCalled();

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          blockchain: 'unknown_chain',
        }),
        'Unknown blockchain type for claim'
      );

      service.stop();
    });
  });

  describe('Gas estimation edge cases', () => {
    it('should return 0 when EVM gas estimation fails', async () => {
      // Mock provider to throw
      mockEvmProvider.getFeeData.mockRejectedValue(new Error('RPC connection failed'));

      const evmClaim = {
        blockchain: 'evm',
        messageId: 'msg_evm_gas_fail',
        senderId: 'peer-evm-gas',
        channelId: '0xGASFAIL',
        nonce: 1,
        transferredAmount: '5000000000000000000', // Large amount to ensure profitability
        lockedAmount: '0',
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: 'sig_gas_fail',
        signerAddress: '0xABCD',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_evm_gas_fail',
            peer_id: 'peer-evm-gas',
            blockchain: 'evm',
            channel_id: '0xGASFAIL',
            claim_data: JSON.stringify(evmClaim),
          },
        ]),
      };

      const mockUpdateStmt = {
        run: jest.fn(),
      };

      mockDb.prepare
        .mockReturnValueOnce(mockStmt as any)
        .mockReturnValueOnce(mockUpdateStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still proceed with redemption (gas cost = 0 when estimation fails)
      expect(mockEVMChannelSDK.closeChannel).toHaveBeenCalled();

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          blockchain: 'evm',
        }),
        'Error estimating redemption cost'
      );

      service.stop();
    });

    it('should log warning for unknown blockchain in gas estimation', async () => {
      const unknownClaim = {
        blockchain: 'cosmos', // Unknown chain
        messageId: 'msg_gas_unknown',
        senderId: 'peer-cosmos',
        channelId: 'COSMOS123',
        amount: '5000000',
        signature: 'sig_cosmos',
        publicKey: 'pubkey_cosmos',
      };

      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_gas_unknown',
            peer_id: 'peer-cosmos',
            blockchain: 'cosmos',
            channel_id: 'COSMOS123',
            claim_data: JSON.stringify(unknownClaim),
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify warning was logged for unknown blockchain gas estimation
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          blockchain: 'cosmos',
        }),
        'Unknown blockchain type for gas estimation'
      );

      service.stop();
    });
  });

  describe('processRedemptions error handling', () => {
    it('should log error when database query fails', async () => {
      // Mock database to throw on prepare
      mockDb.prepare.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
        'Error in processRedemptions'
      );

      service.stop();
    });

    it('should handle malformed claim data gracefully', async () => {
      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            message_id: 'msg_malformed',
            peer_id: 'peer-malformed',
            blockchain: 'xrp',
            channel_id: 'MALFORMED123',
            claim_data: 'not valid json{{{', // Malformed JSON
          },
        ]),
      };

      mockDb.prepare.mockReturnValue(mockStmt as any);

      service.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify no SDK calls were made
      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();

      // Verify error was logged for processing failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          messageId: 'msg_malformed',
        }),
        'Error processing claim redemption'
      );

      service.stop();
    });
  });
});
