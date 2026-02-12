/**
 * Unit tests for ClaimReceiver
 *
 * Tests claim reception, validation, blockchain-specific verification,
 * monotonicity checks, and database persistence.
 */

import { ClaimReceiver } from './claim-receiver';
import type { Database, Statement } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { BTPServer } from '../btp/btp-server';
import type { BTPProtocolData, BTPMessage, BTPData } from '../btp/btp-types';
import type { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import type { ClaimSigner as XRPClaimSigner } from './xrp-claim-signer';
import type { PaymentChannelSDK } from './payment-channel-sdk';
import type { AptosClaimSigner } from './aptos-claim-signer';
import type { XRPClaimMessage, EVMClaimMessage, AptosClaimMessage } from '../btp/btp-claim-types';

describe('ClaimReceiver', () => {
  let claimReceiver: ClaimReceiver;
  let mockDb: jest.Mocked<Database>;
  let mockLogger: jest.Mocked<Logger>;
  let mockTelemetryEmitter: jest.Mocked<TelemetryEmitter>;
  let mockBTPServer: jest.Mocked<BTPServer>;
  let mockXRPClaimSigner: jest.Mocked<XRPClaimSigner>;
  let mockPaymentChannelSDK: jest.Mocked<PaymentChannelSDK>;
  let mockAptosClaimSigner: jest.Mocked<AptosClaimSigner>;
  let mockStatement: jest.Mocked<Statement>;
  let btpMessageHandler: ((peerId: string, message: BTPMessage) => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    btpMessageHandler = null;

    // Mock Database
    mockStatement = {
      run: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<Statement>;

    mockDb = {
      prepare: jest.fn().mockReturnValue(mockStatement),
      exec: jest.fn(),
    } as unknown as jest.Mocked<Database>;

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

    // Mock BTPServer
    mockBTPServer = {
      onMessage: jest.fn((handler) => {
        btpMessageHandler = handler;
      }),
    } as unknown as jest.Mocked<BTPServer>;

    // Mock XRPClaimSigner
    mockXRPClaimSigner = {
      verifyClaim: jest.fn(),
    } as unknown as jest.Mocked<XRPClaimSigner>;

    // Mock PaymentChannelSDK
    mockPaymentChannelSDK = {
      verifyBalanceProof: jest.fn(),
    } as unknown as jest.Mocked<PaymentChannelSDK>;

    // Mock AptosClaimSigner (synchronous verifyClaim)
    mockAptosClaimSigner = {
      verifyClaim: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<AptosClaimSigner>;

    // Create ClaimReceiver instance
    claimReceiver = new ClaimReceiver(
      mockDb,
      mockXRPClaimSigner,
      mockPaymentChannelSDK,
      mockAptosClaimSigner,
      mockLogger,
      mockTelemetryEmitter,
      'test-node'
    );
  });

  describe('registerWithBTPServer', () => {
    it('should register message handler with BTP server', () => {
      claimReceiver.registerWithBTPServer(mockBTPServer);

      expect(mockBTPServer.onMessage).toHaveBeenCalledTimes(1);
      expect(mockBTPServer.onMessage).toHaveBeenCalledWith(expect.any(Function));
      expect(mockLogger.info).toHaveBeenCalledWith('ClaimReceiver registered with BTP server');
    });
  });

  describe('handleClaimMessage - XRP Claims', () => {
    let validXRPClaim: XRPClaimMessage;
    let protocolData: BTPProtocolData;
    let btpMessage: BTPMessage;

    beforeEach(() => {
      validXRPClaim = {
        version: '1.0',
        blockchain: 'xrp',
        messageId: 'xrp-a1b2c3d4-n/a-1706889600000',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelId: 'a'.repeat(64),
        amount: '1000000',
        signature: 'b'.repeat(128),
        publicKey: 'ED' + 'c'.repeat(64),
      };

      protocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from(JSON.stringify(validXRPClaim), 'utf8'),
      };

      btpMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };
    });

    it('should verify valid XRP claim and store with verified=true', async () => {
      mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);
      mockStatement.get.mockReturnValue(undefined); // No previous claim

      claimReceiver.registerWithBTPServer(mockBTPServer);
      expect(btpMessageHandler).not.toBeNull();

      await btpMessageHandler!('peer-bob', btpMessage);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify signature check was called
      expect(mockXRPClaimSigner.verifyClaim).toHaveBeenCalledWith(
        validXRPClaim.channelId,
        validXRPClaim.amount,
        validXRPClaim.signature,
        validXRPClaim.publicKey
      );

      // Verify database insert with verified=true
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO received_claims')
      );
      expect(mockStatement.run).toHaveBeenCalledWith(
        validXRPClaim.messageId,
        'peer-bob',
        'xrp',
        validXRPClaim.channelId,
        JSON.stringify(validXRPClaim),
        1, // verified=true
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_RECEIVED',
        nodeId: 'test-node',
        peerId: 'peer-bob',
        blockchain: 'xrp',
        messageId: validXRPClaim.messageId,
        channelId: validXRPClaim.channelId,
        amount: validXRPClaim.amount,
        verified: true,
        timestamp: expect.any(String),
      });

      // Verify success log
      expect(mockLogger.info).toHaveBeenCalledWith(
        { messageId: validXRPClaim.messageId },
        'Claim verified and stored'
      );
    });

    it('should reject XRP claim with invalid signature', async () => {
      mockXRPClaimSigner.verifyClaim.mockResolvedValue(false);

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify database insert with verified=false
      expect(mockStatement.run).toHaveBeenCalledWith(
        validXRPClaim.messageId,
        'peer-bob',
        'xrp',
        validXRPClaim.channelId,
        JSON.stringify(validXRPClaim),
        0, // verified=false
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission with verified=false
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_RECEIVED',
        nodeId: 'test-node',
        peerId: 'peer-bob',
        blockchain: 'xrp',
        messageId: validXRPClaim.messageId,
        channelId: validXRPClaim.channelId,
        amount: validXRPClaim.amount,
        verified: false,
        error: 'Invalid signature',
        timestamp: expect.any(String),
      });

      // Verify warning log
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { messageId: validXRPClaim.messageId, error: 'Invalid signature' },
        'Claim verification failed'
      );
    });

    it('should reject XRP claim with non-increasing amount (monotonicity check)', async () => {
      mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);

      // Mock previous claim with higher amount
      const previousClaim: XRPClaimMessage = {
        ...validXRPClaim,
        amount: '2000000', // Higher than new claim
      };

      mockStatement.get.mockReturnValue({
        claim_data: JSON.stringify(previousClaim),
      });

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify database insert with verified=false
      expect(mockStatement.run).toHaveBeenCalledWith(
        validXRPClaim.messageId,
        'peer-bob',
        'xrp',
        validXRPClaim.channelId,
        JSON.stringify(validXRPClaim),
        0, // verified=false
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission with monotonicity error
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: false,
          error: 'Claim amount not monotonically increasing',
        })
      );
    });
  });

  describe('handleClaimMessage - EVM Claims', () => {
    let validEVMClaim: EVMClaimMessage;
    let protocolData: BTPProtocolData;
    let btpMessage: BTPMessage;

    beforeEach(() => {
      validEVMClaim = {
        version: '1.0',
        blockchain: 'evm',
        messageId: 'evm-0xabc123-5-1706889600000',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelId: '0x' + 'a'.repeat(64),
        nonce: 5,
        transferredAmount: '1000000000000000000',
        lockedAmount: '0',
        locksRoot: '0x' + '0'.repeat(64),
        signature: '0x' + 'b'.repeat(130),
        signerAddress: '0x' + 'c'.repeat(40),
      };

      protocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from(JSON.stringify(validEVMClaim), 'utf8'),
      };

      btpMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };
    });

    it('should verify valid EVM claim and store with verified=true', async () => {
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);
      mockStatement.get.mockReturnValue(undefined); // No previous claim

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify balance proof verification
      expect(mockPaymentChannelSDK.verifyBalanceProof).toHaveBeenCalledWith(
        {
          channelId: validEVMClaim.channelId,
          nonce: validEVMClaim.nonce,
          transferredAmount: BigInt(validEVMClaim.transferredAmount),
          lockedAmount: BigInt(validEVMClaim.lockedAmount),
          locksRoot: validEVMClaim.locksRoot,
        },
        validEVMClaim.signature,
        validEVMClaim.signerAddress
      );

      // Verify database insert with verified=true
      expect(mockStatement.run).toHaveBeenCalledWith(
        validEVMClaim.messageId,
        'peer-bob',
        'evm',
        validEVMClaim.channelId,
        JSON.stringify(validEVMClaim),
        1, // verified=true
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_RECEIVED',
        nodeId: 'test-node',
        peerId: 'peer-bob',
        blockchain: 'evm',
        messageId: validEVMClaim.messageId,
        channelId: validEVMClaim.channelId,
        amount: validEVMClaim.transferredAmount,
        verified: true,
        timestamp: expect.any(String),
      });
    });

    it('should reject EVM claim with invalid EIP-712 signature', async () => {
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(false);

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify database insert with verified=false
      expect(mockStatement.run).toHaveBeenCalledWith(
        validEVMClaim.messageId,
        'peer-bob',
        'evm',
        validEVMClaim.channelId,
        JSON.stringify(validEVMClaim),
        0, // verified=false
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission with error
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: false,
          error: 'Invalid EIP-712 signature',
        })
      );
    });

    it('should reject EVM claim with non-increasing nonce (monotonicity check)', async () => {
      mockPaymentChannelSDK.verifyBalanceProof.mockResolvedValue(true);

      // Mock previous claim with same nonce
      const previousClaim: EVMClaimMessage = {
        ...validEVMClaim,
        nonce: 5, // Same nonce
      };

      mockStatement.get.mockReturnValue({
        claim_data: JSON.stringify(previousClaim),
      });

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify database insert with verified=false
      expect(mockStatement.run).toHaveBeenCalledWith(
        validEVMClaim.messageId,
        'peer-bob',
        'evm',
        validEVMClaim.channelId,
        JSON.stringify(validEVMClaim),
        0, // verified=false
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission with monotonicity error
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: false,
          error: 'Nonce not monotonically increasing',
        })
      );
    });
  });

  describe('handleClaimMessage - Aptos Claims', () => {
    let validAptosClaim: AptosClaimMessage;
    let protocolData: BTPProtocolData;
    let btpMessage: BTPMessage;

    beforeEach(() => {
      validAptosClaim = {
        version: '1.0',
        blockchain: 'aptos',
        messageId: 'aptos-0xabc123-10-1706889600000',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelOwner: '0x' + 'a'.repeat(64),
        amount: '100000000',
        nonce: 10,
        signature: 'b'.repeat(128),
        publicKey: 'c'.repeat(64),
      };

      protocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from(JSON.stringify(validAptosClaim), 'utf8'),
      };

      btpMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };
    });

    it('should verify valid Aptos claim and store with verified=true', async () => {
      mockAptosClaimSigner.verifyClaim.mockResolvedValue(true);
      mockStatement.get.mockReturnValue(undefined); // No previous claim

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify signature check
      expect(mockAptosClaimSigner.verifyClaim).toHaveBeenCalledWith(
        validAptosClaim.channelOwner,
        BigInt(validAptosClaim.amount),
        validAptosClaim.nonce,
        validAptosClaim.signature,
        validAptosClaim.publicKey
      );

      // Verify database insert with verified=true
      expect(mockStatement.run).toHaveBeenCalledWith(
        validAptosClaim.messageId,
        'peer-bob',
        'aptos',
        validAptosClaim.channelOwner,
        JSON.stringify(validAptosClaim),
        1, // verified=true
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_RECEIVED',
        nodeId: 'test-node',
        peerId: 'peer-bob',
        blockchain: 'aptos',
        messageId: validAptosClaim.messageId,
        channelId: validAptosClaim.channelOwner,
        amount: validAptosClaim.amount,
        verified: true,
        timestamp: expect.any(String),
      });
    });

    it('should reject Aptos claim with invalid signature', async () => {
      mockAptosClaimSigner.verifyClaim.mockResolvedValue(false);

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify database insert with verified=false
      expect(mockStatement.run).toHaveBeenCalledWith(
        validAptosClaim.messageId,
        'peer-bob',
        'aptos',
        validAptosClaim.channelOwner,
        JSON.stringify(validAptosClaim),
        0, // verified=false
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission with error
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: false,
          error: 'Invalid signature',
        })
      );
    });

    it('should reject Aptos claim with non-increasing nonce (monotonicity check)', async () => {
      mockAptosClaimSigner.verifyClaim.mockResolvedValue(true);

      // Mock previous claim with higher nonce
      const previousClaim: AptosClaimMessage = {
        ...validAptosClaim,
        nonce: 15, // Higher nonce
      };

      mockStatement.get.mockReturnValue({
        claim_data: JSON.stringify(previousClaim),
      });

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify database insert with verified=false
      expect(mockStatement.run).toHaveBeenCalledWith(
        validAptosClaim.messageId,
        'peer-bob',
        'aptos',
        validAptosClaim.channelOwner,
        JSON.stringify(validAptosClaim),
        0, // verified=false
        expect.any(Number),
        null,
        null
      );

      // Verify telemetry emission with monotonicity error
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: false,
          error: 'Nonce not monotonically increasing',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON parsing gracefully', async () => {
      const protocolData: BTPProtocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from('invalid json', 'utf8'),
      };

      const btpMessage: BTPMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to parse claim message'
      );

      // Verify telemetry emitted with error
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_RECEIVED',
          verified: false,
          error: expect.any(String),
        })
      );

      // Verify no database insert
      expect(mockStatement.run).not.toHaveBeenCalled();
    });

    it('should handle database persistence failure gracefully', async () => {
      const validXRPClaim: XRPClaimMessage = {
        version: '1.0',
        blockchain: 'xrp',
        messageId: 'xrp-test-123',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelId: 'a'.repeat(64),
        amount: '1000000',
        signature: 'b'.repeat(128),
        publicKey: 'ED' + 'c'.repeat(64),
      };

      const protocolData: BTPProtocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from(JSON.stringify(validXRPClaim), 'utf8'),
      };

      const btpMessage: BTPMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };

      mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);
      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockImplementation(() => {
        throw new Error('Database error');
      });

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to persist claim to database'
      );

      // Verify telemetry still emitted (non-blocking)
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_RECEIVED',
          verified: true,
        })
      );
    });

    it('should handle telemetry emission failure gracefully', async () => {
      const validXRPClaim: XRPClaimMessage = {
        version: '1.0',
        blockchain: 'xrp',
        messageId: 'xrp-test-123',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelId: 'a'.repeat(64),
        amount: '1000000',
        signature: 'b'.repeat(128),
        publicKey: 'ED' + 'c'.repeat(64),
      };

      const protocolData: BTPProtocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from(JSON.stringify(validXRPClaim), 'utf8'),
      };

      const btpMessage: BTPMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };

      mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);
      mockStatement.get.mockReturnValue(undefined);
      mockTelemetryEmitter.emit.mockImplementation(() => {
        throw new Error('Telemetry error');
      });

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify telemetry error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to emit claim received telemetry'
      );

      // Verify database insert still succeeded (non-blocking)
      expect(mockStatement.run).toHaveBeenCalled();
    });

    it('should handle duplicate message IDs gracefully (idempotency)', async () => {
      const validXRPClaim: XRPClaimMessage = {
        version: '1.0',
        blockchain: 'xrp',
        messageId: 'xrp-test-123',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelId: 'a'.repeat(64),
        amount: '1000000',
        signature: 'b'.repeat(128),
        publicKey: 'ED' + 'c'.repeat(64),
      };

      const protocolData: BTPProtocolData = {
        protocolName: 'payment-channel-claim',
        contentType: 1,
        data: Buffer.from(JSON.stringify(validXRPClaim), 'utf8'),
      };

      const btpMessage: BTPMessage = {
        type: 6,
        requestId: 1,
        data: {
          protocolData: [protocolData],
          transfer: {
            amount: '0',
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          },
        } as BTPData,
      };

      mockXRPClaimSigner.verifyClaim.mockResolvedValue(true);
      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockImplementation(() => {
        const error = new Error('UNIQUE constraint failed: received_claims.message_id');
        throw error;
      });

      claimReceiver.registerWithBTPServer(mockBTPServer);
      await btpMessageHandler!('peer-bob', btpMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify warning logged for duplicate
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { messageId: validXRPClaim.messageId },
        'Duplicate claim message ignored (idempotency)'
      );
    });
  });

  describe('getLatestVerifiedClaim', () => {
    it('should return latest verified claim for peer and channel', async () => {
      const storedClaim: XRPClaimMessage = {
        version: '1.0',
        blockchain: 'xrp',
        messageId: 'xrp-test-123',
        timestamp: '2026-02-02T12:00:00.000Z',
        senderId: 'peer-bob',
        channelId: 'a'.repeat(64),
        amount: '1000000',
        signature: 'b'.repeat(128),
        publicKey: 'ED' + 'c'.repeat(64),
      };

      mockStatement.get.mockReturnValue({
        claim_data: JSON.stringify(storedClaim),
      });

      const result = await claimReceiver.getLatestVerifiedClaim('peer-bob', 'xrp', 'a'.repeat(64));

      expect(result).toEqual(storedClaim);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT claim_data'));
      expect(mockStatement.get).toHaveBeenCalledWith('peer-bob', 'xrp', 'a'.repeat(64));
    });

    it('should return null if no verified claim found', async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await claimReceiver.getLatestVerifiedClaim('peer-bob', 'xrp', 'a'.repeat(64));

      expect(result).toBeNull();
    });

    it('should return null and log error on database failure', async () => {
      mockStatement.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await claimReceiver.getLatestVerifiedClaim('peer-bob', 'xrp', 'a'.repeat(64));

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to query latest verified claim'
      );
    });
  });
});
