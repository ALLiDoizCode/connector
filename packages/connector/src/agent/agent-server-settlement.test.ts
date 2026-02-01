/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit Tests for AgentServer Settlement Execution (Story 30.6)
 *
 * Tests automatic settlement execution using stored claims for all three chains:
 * - EVM cooperative settlement via PaymentChannelSDK
 * - XRP PaymentChannelClaim submission via xrplClient
 * - Aptos claim submission via AptosChannelSDK
 *
 * All dependencies (ClaimStore, SDKs, telemetry) are mocked to isolate settlement logic.
 */

import { AgentServer } from './agent-server';
import { ClaimStore } from './claim-store';
import { PaymentChannelSDK } from '../settlement/payment-channel-sdk';
import { Client as XrplClient } from 'xrpl';
import { AptosChannelSDK } from '../settlement/aptos-channel-sdk';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { ethers } from 'ethers';
import type { EVMSignedClaim, XRPSignedClaim, AptosSignedClaim } from '@m2m/shared';

// Mock all external dependencies
jest.mock('./claim-store');
jest.mock('../settlement/payment-channel-sdk');
jest.mock('../settlement/aptos-channel-sdk');
jest.mock('../telemetry/telemetry-emitter');

describe('AgentServer Settlement Execution (Story 30.6)', () => {
  let agentServer: AgentServer;
  let mockClaimStore: jest.Mocked<ClaimStore>;
  let mockPaymentChannelSDK: jest.Mocked<PaymentChannelSDK>;
  let mockXrplClient: jest.Mocked<XrplClient>;
  let mockAptosChannelSDK: jest.Mocked<AptosChannelSDK>;
  let mockTelemetryEmitter: jest.Mocked<TelemetryEmitter>;

  beforeEach(() => {
    // Fresh mock instances for each test (no state leakage)
    jest.clearAllMocks();

    // Create AgentServer instance with minimal config
    agentServer = new AgentServer({
      agentId: 'test-agent',
      httpPort: 0, // Disable HTTP server
      btpPort: 0, // Disable BTP server
      explorerPort: 0, // Disable Explorer server
      databasePath: ':memory:',
      claimExchangeEnabled: true,
      settlementThreshold: 1000n,
    });

    // Access private members for testing (TypeScript hack)
    const privateServer = agentServer as any;

    // Mock ClaimStore
    mockClaimStore = new ClaimStore(':memory:', {} as any) as jest.Mocked<ClaimStore>;
    privateServer.claimStore = mockClaimStore;

    // Mock PaymentChannelSDK
    mockPaymentChannelSDK = new PaymentChannelSDK(
      {} as any,
      {} as any,
      'test',
      '0x0',
      {} as any
    ) as jest.Mocked<PaymentChannelSDK>;
    privateServer.paymentChannelSDK = mockPaymentChannelSDK;

    // Mock xrplClient
    mockXrplClient = {
      submitAndWait: jest.fn(),
    } as any;
    privateServer.xrplClient = mockXrplClient;

    // Mock AptosChannelSDK
    mockAptosChannelSDK = {
      submitClaim: jest.fn(),
    } as any;
    privateServer.aptosChannelSDK = mockAptosChannelSDK;

    // Mock TelemetryEmitter
    mockTelemetryEmitter = {
      emit: jest.fn(),
    } as any;
    privateServer.telemetryEmitter = mockTelemetryEmitter;

    // Mock config
    privateServer.config = {
      agentId: 'test-agent',
      evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      xrpAccountAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3WnFBrJT',
      settlementThreshold: 1000n,
    };
  });

  describe('EVM Settlement', () => {
    test('Success: Stored claim retrieved, cooperativeSettle called, telemetry emitted', async () => {
      // Arrange
      const channelId = '0xabc123';
      const peerId = 'peer-pubkey';
      const amount = 5000n;

      const storedClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId,
        nonce: 10,
        transferredAmount: 5000n,
        signature: '0xsignature',
        signer: '0xpeerAddress',
        locksRoot: ethers.ZeroHash,
        lockedAmount: 0n,
      };

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([storedClaim]);
      mockPaymentChannelSDK.signBalanceProof = jest.fn().mockResolvedValue('0xourSignature');
      mockPaymentChannelSDK.cooperativeSettle = jest.fn().mockResolvedValue(undefined); // cooperativeSettle returns void

      // Add channel to agent server
      const privateServer = agentServer as any;
      privateServer.paymentChannels.set(channelId, {
        channelId,
        peerAddress: '0xpeerAddress',
        deposit: 10000n,
        status: 'opened',
        nonce: 5,
        transferredAmount: 0n,
      });

      // Act
      await privateServer.performSettlement('evm', channelId, peerId, amount);

      // Assert
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, 'evm');
      expect(mockPaymentChannelSDK.signBalanceProof).toHaveBeenCalled();
      expect(mockPaymentChannelSDK.cooperativeSettle).toHaveBeenCalled();

      // Verify telemetry events emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_INITIATED',
          chain: 'evm',
          channelId,
          peerId,
        })
      );

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_SUCCESS',
          chain: 'evm',
          channelId,
          txHash: `evm-settlement-${channelId}`, // Placeholder since cooperativeSettle returns void
        })
      );
    });

    test('Missing claim: Warning logged, CLAIM_SETTLEMENT_FAILED emitted, no crash', async () => {
      // Arrange
      const channelId = '0xabc123';
      const peerId = 'peer-pubkey';
      const amount = 5000n;

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([]);

      // Add channel to agent server
      const privateServer = agentServer as any;
      privateServer.paymentChannels.set(channelId, {
        channelId,
        peerAddress: '0xpeerAddress',
        deposit: 10000n,
        status: 'opened',
        nonce: 5,
        transferredAmount: 0n,
      });

      // Act
      await privateServer.performSettlement('evm', channelId, peerId, amount);

      // Assert
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, 'evm');
      expect(mockPaymentChannelSDK.cooperativeSettle).not.toHaveBeenCalled();

      // Verify CLAIM_SETTLEMENT_FAILED emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_FAILED',
          chain: 'evm',
          channelId,
          error: 'No stored claim available',
        })
      );
    });

    test('cooperativeSettle failure: Error logged, CLAIM_SETTLEMENT_FAILED emitted', async () => {
      // Arrange
      const channelId = '0xabc123';
      const peerId = 'peer-pubkey';
      const amount = 5000n;

      const storedClaim: EVMSignedClaim = {
        chain: 'evm',
        channelId,
        nonce: 10,
        transferredAmount: 5000n,
        signature: '0xsignature',
        signer: '0xpeerAddress',
        locksRoot: ethers.ZeroHash,
        lockedAmount: 0n,
      };

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([storedClaim]);
      mockPaymentChannelSDK.signBalanceProof = jest.fn().mockResolvedValue('0xourSignature');
      mockPaymentChannelSDK.cooperativeSettle = jest
        .fn()
        .mockRejectedValue(new Error('Transaction reverted'));

      // Add channel to agent server
      const privateServer = agentServer as any;
      privateServer.paymentChannels.set(channelId, {
        channelId,
        peerAddress: '0xpeerAddress',
        deposit: 10000n,
        status: 'opened',
        nonce: 5,
        transferredAmount: 0n,
      });

      // Act
      await privateServer.performSettlement('evm', channelId, peerId, amount);

      // Assert
      expect(mockPaymentChannelSDK.cooperativeSettle).toHaveBeenCalled();

      // Verify CLAIM_SETTLEMENT_FAILED emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_FAILED',
          chain: 'evm',
          channelId,
          error: 'Transaction reverted',
        })
      );
    });
  });

  describe('XRP Settlement', () => {
    test('Success: Stored claim retrieved, PaymentChannelClaim submitted, telemetry emitted', async () => {
      // Arrange
      const channelId = 'A1B2C3D4E5F6789012345678901234567890123456789012345678901234';
      const peerId = 'peer-pubkey';
      const amount = 5000000000n; // 5000 XRP in drops

      const storedClaim: XRPSignedClaim = {
        chain: 'xrp',
        channelId,
        amount: 5000000000n,
        signature: '0'.repeat(128), // 128 hex chars
        signer: 'ED' + '0'.repeat(64), // 66 hex chars (ED prefix)
      };

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([storedClaim]);
      mockXrplClient.submitAndWait = jest.fn().mockResolvedValue({
        result: {
          hash: 'ABC123',
          validated: true,
        },
      });

      // Add XRP channel to agent server
      const privateServer = agentServer as any;
      privateServer.xrpChannels.set(channelId, {
        channelId,
        destination: 'rDestination',
        amount: '10000000000',
        balance: '0',
        status: 'open',
        settleDelay: 86400,
        publicKey: 'ED' + '0'.repeat(64),
      });

      // Act
      await privateServer.performSettlement('xrp', channelId, peerId, amount);

      // Assert
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, 'xrp');
      expect(mockXrplClient.submitAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactionType: 'PaymentChannelClaim',
          Channel: channelId,
          Balance: '5000000000',
        }),
        expect.any(Object)
      );

      // Verify telemetry events emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_INITIATED',
          chain: 'xrp',
          channelId,
        })
      );

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_SUCCESS',
          chain: 'xrp',
          channelId,
          txHash: 'ABC123',
        })
      );
    });

    test('Missing claim: Warning logged, CLAIM_SETTLEMENT_FAILED emitted, no crash', async () => {
      // Arrange
      const channelId = 'A1B2C3D4E5F6789012345678901234567890123456789012345678901234';
      const peerId = 'peer-pubkey';
      const amount = 5000000000n;

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([]);

      // Add XRP channel
      const privateServer = agentServer as any;
      privateServer.xrpChannels.set(channelId, {
        channelId,
        destination: 'rDestination',
        amount: '10000000000',
        balance: '0',
        status: 'open',
        settleDelay: 86400,
        publicKey: 'ED' + '0'.repeat(64),
      });

      // Act
      await privateServer.performSettlement('xrp', channelId, peerId, amount);

      // Assert
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, 'xrp');
      expect(mockXrplClient.submitAndWait).not.toHaveBeenCalled();

      // Verify CLAIM_SETTLEMENT_FAILED emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_FAILED',
          chain: 'xrp',
          error: 'No stored claim available',
        })
      );
    });

    test('submitAndWait failure: Error logged, CLAIM_SETTLEMENT_FAILED emitted', async () => {
      // Arrange
      const channelId = 'A1B2C3D4E5F6789012345678901234567890123456789012345678901234';
      const peerId = 'peer-pubkey';
      const amount = 5000000000n;

      const storedClaim: XRPSignedClaim = {
        chain: 'xrp',
        channelId,
        amount: 5000000000n,
        signature: '0'.repeat(128),
        signer: 'ED' + '0'.repeat(64),
      };

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([storedClaim]);
      mockXrplClient.submitAndWait = jest.fn().mockRejectedValue(new Error('tecNO_ENTRY'));

      // Add XRP channel
      const privateServer = agentServer as any;
      privateServer.xrpChannels.set(channelId, {
        channelId,
        destination: 'rDestination',
        amount: '10000000000',
        balance: '0',
        status: 'open',
        settleDelay: 86400,
        publicKey: 'ED' + '0'.repeat(64),
      });

      // Act
      await privateServer.performSettlement('xrp', channelId, peerId, amount);

      // Assert
      expect(mockXrplClient.submitAndWait).toHaveBeenCalled();

      // Verify CLAIM_SETTLEMENT_FAILED emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_FAILED',
          chain: 'xrp',
          error: 'tecNO_ENTRY',
        })
      );
    });
  });

  describe('Aptos Settlement', () => {
    test('Success: Stored claim retrieved, submitClaim called, telemetry emitted', async () => {
      // Arrange
      const channelId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
      const peerId = 'peer-pubkey';
      const amount = 5000000000n; // 50 APT in octas

      const storedClaim: AptosSignedClaim = {
        chain: 'aptos',
        channelOwner: channelId,
        nonce: 10,
        amount: 5000000000n,
        signature: '0'.repeat(128),
        signer: '0x' + '0'.repeat(64),
      };

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([storedClaim]);
      mockAptosChannelSDK.submitClaim = jest.fn().mockResolvedValue({
        txHash: '0xaptosHash',
        success: true,
      });

      // Add Aptos channel
      const privateServer = agentServer as any;
      privateServer.aptosChannels.set(channelId, {
        channelOwner: channelId,
        destination: '0xdestination',
        destinationPubkey: '0xdestPubkey',
        deposited: '10000000000',
        claimed: '0',
        status: 'open',
        settleDelay: 86400,
        nonce: 5,
      });

      // Act
      await privateServer.performSettlement('aptos', channelId, peerId, amount);

      // Assert
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, 'aptos');
      expect(mockAptosChannelSDK.submitClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          channelOwner: channelId,
          amount: 5000000000n,
          nonce: 10,
          signature: '0'.repeat(128),
        })
      );

      // Verify telemetry events emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_INITIATED',
          chain: 'aptos',
          channelId,
        })
      );

      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_SUCCESS',
          chain: 'aptos',
          channelId,
          txHash: 'aptos-tx-hash', // Placeholder since we don't have real tx hash yet
        })
      );
    });

    test('Missing claim: Warning logged, CLAIM_SETTLEMENT_FAILED emitted, no crash', async () => {
      // Arrange
      const channelId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
      const peerId = 'peer-pubkey';
      const amount = 5000000000n;

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([]);

      // Add Aptos channel
      const privateServer = agentServer as any;
      privateServer.aptosChannels.set(channelId, {
        channelOwner: channelId,
        destination: '0xdestination',
        destinationPubkey: '0xdestPubkey',
        deposited: '10000000000',
        claimed: '0',
        status: 'open',
        settleDelay: 86400,
        nonce: 5,
      });

      // Act
      await privateServer.performSettlement('aptos', channelId, peerId, amount);

      // Assert
      expect(mockClaimStore.getClaimsForSettlement).toHaveBeenCalledWith(peerId, 'aptos');
      expect(mockAptosChannelSDK.submitClaim).not.toHaveBeenCalled();

      // Verify CLAIM_SETTLEMENT_FAILED emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_FAILED',
          chain: 'aptos',
          error: 'No stored claim available',
        })
      );
    });

    test('submitClaim failure: Error logged, CLAIM_SETTLEMENT_FAILED emitted', async () => {
      // Arrange
      const channelId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
      const peerId = 'peer-pubkey';
      const amount = 5000000000n;

      const storedClaim: AptosSignedClaim = {
        chain: 'aptos',
        channelOwner: channelId,
        nonce: 10,
        amount: 5000000000n,
        signature: '0'.repeat(128),
        signer: '0x' + '0'.repeat(64),
      };

      mockClaimStore.getClaimsForSettlement = jest.fn().mockResolvedValue([storedClaim]);
      mockAptosChannelSDK.submitClaim = jest.fn().mockRejectedValue(new Error('EINVALID_NONCE'));

      // Add Aptos channel
      const privateServer = agentServer as any;
      privateServer.aptosChannels.set(channelId, {
        channelOwner: channelId,
        destination: '0xdestination',
        destinationPubkey: '0xdestPubkey',
        deposited: '10000000000',
        claimed: '0',
        status: 'open',
        settleDelay: 86400,
        nonce: 5,
      });

      // Act
      await privateServer.performSettlement('aptos', channelId, peerId, amount);

      // Assert
      expect(mockAptosChannelSDK.submitClaim).toHaveBeenCalled();

      // Verify CLAIM_SETTLEMENT_FAILED emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_SETTLEMENT_FAILED',
          chain: 'aptos',
          error: 'EINVALID_NONCE',
        })
      );
    });
  });
});
