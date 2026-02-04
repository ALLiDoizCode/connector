/**
 * Integration Tests for ClaimRedemptionService
 *
 * Tests claim redemption service with real SQLite database and mocked blockchain SDKs.
 * This integration test validates the complete claim processing flow including:
 * - Database schema initialization and queries
 * - Polling cycle execution
 * - Claim processing pipeline
 * - Database state updates
 * - Telemetry emission
 *
 * Uses mocked blockchain SDKs to avoid testnet dependencies while testing
 * the full service integration with real database operations.
 *
 * @see Story 17.5: Automatic Claim Redemption
 * @see Story 17.8: Claim Redemption Integration Testing
 */

import { ClaimRedemptionService } from '../../src/settlement/claim-redemption-service';
import Database from 'better-sqlite3';
import pino from 'pino';

// Mock SDK types (using any to avoid complex SDK constructor dependencies)
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('ClaimRedemptionService Integration Tests', () => {
  let db: Database.Database;
  let claimRedemptionService: ClaimRedemptionService;
  let mockXRPChannelSDK: any;
  let mockEVMChannelSDK: any;
  let mockAptosChannelSDK: any;
  let mockEvmProvider: any;
  let mockTelemetryEmitter: any;
  let logger: pino.Logger;

  beforeAll(() => {
    // Create logger with minimal output for tests
    logger = pino({ level: 'silent' });
  });

  beforeEach(() => {
    // Create in-memory SQLite database
    db = new Database(':memory:');

    // Initialize claim receiver database schema (from Story 17.3)
    db.exec(`
      CREATE TABLE IF NOT EXISTS received_claims (
        message_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        blockchain TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        claim_data TEXT NOT NULL,
        verified BOOLEAN NOT NULL,
        received_at INTEGER NOT NULL,
        redeemed_at INTEGER,
        redemption_tx_hash TEXT
      );
    `);

    // Create mock SDKs
    mockXRPChannelSDK = {
      submitClaim: jest.fn().mockResolvedValue(undefined),
    };

    mockEVMChannelSDK = {
      closeChannel: jest.fn().mockResolvedValue(undefined),
    };

    mockAptosChannelSDK = {
      submitClaim: jest.fn().mockResolvedValue(undefined),
    };

    mockEvmProvider = {
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: 1000000000n, // 1 gwei
      }),
    };

    mockTelemetryEmitter = {
      emit: jest.fn(),
    };

    // Create claim redemption service with mocked dependencies
    claimRedemptionService = new ClaimRedemptionService(
      db,
      mockXRPChannelSDK,
      mockEVMChannelSDK,
      mockAptosChannelSDK,
      mockEvmProvider,
      {
        minProfitThreshold: 1000n,
        pollingInterval: 100, // Fast polling for tests (100ms)
        maxConcurrentRedemptions: 5,
        evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      },
      logger,
      mockTelemetryEmitter,
      'test-node'
    );
  });

  afterEach(() => {
    // Stop service if running
    if (claimRedemptionService?.isRunning) {
      claimRedemptionService.stop();
    }

    // Close database
    if (db) {
      db.close();
    }

    jest.clearAllMocks();
  });

  describe('Database Integration', () => {
    it('should create and query received_claims table', () => {
      // Insert a test claim
      const insertStmt = db.prepare(`
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        'test-msg-1',
        'peer-alice',
        'xrp',
        'channel-123',
        JSON.stringify({ blockchain: 'xrp', messageId: 'test-msg-1' }),
        1,
        Date.now()
      );

      // Query the claim
      const selectStmt = db.prepare('SELECT * FROM received_claims WHERE message_id = ?');
      const row = selectStmt.get('test-msg-1') as any;

      expect(row).toBeDefined();
      expect(row.message_id).toBe('test-msg-1');
      expect(row.peer_id).toBe('peer-alice');
      expect(row.blockchain).toBe('xrp');
      expect(row.verified).toBe(1);
      expect(row.redeemed_at).toBeNull();
      expect(row.redemption_tx_hash).toBeNull();
    });

    it('should update claim redemption status', () => {
      // Insert a test claim
      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        'test-msg-2',
        'peer-bob',
        'evm',
        'channel-456',
        JSON.stringify({ blockchain: 'evm', messageId: 'test-msg-2' }),
        1,
        Date.now()
      );

      // Simulate redemption status update
      const now = Date.now();
      db.prepare(
        `
        UPDATE received_claims
        SET redeemed_at = ?, redemption_tx_hash = ?
        WHERE message_id = ?
      `
      ).run(now, 'test-msg-2', 'test-msg-2');

      // Verify update
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get('test-msg-2') as any;

      expect(row.redeemed_at).toBe(now);
      expect(row.redemption_tx_hash).toBe('test-msg-2');
    });
  });

  describe('XRP Claim Redemption', () => {
    it('should redeem verified XRP claim', async () => {
      // Insert verified XRP claim
      const xrpClaim = {
        blockchain: 'xrp',
        messageId: 'msg-xrp-001',
        senderId: 'peer-xrp-1',
        channelId: 'ABC123DEF456',
        amount: '100000', // 100,000 drops (0.1 XRP)
        signature: 'xrp-signature-123',
        publicKey: 'xrp-pubkey-123',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        xrpClaim.messageId,
        xrpClaim.senderId,
        xrpClaim.blockchain,
        xrpClaim.channelId,
        JSON.stringify(xrpClaim),
        1,
        Date.now()
      );

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle to process
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      claimRedemptionService.stop();

      // Verify XRP SDK was called with correct claim
      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalledWith({
        channelId: 'ABC123DEF456',
        amount: '100000',
        signature: 'xrp-signature-123',
        publicKey: 'xrp-pubkey-123',
      });

      // Verify database was updated
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(xrpClaim.messageId) as any;

      expect(row.redeemed_at).toBeTruthy();
      expect(row.redemption_tx_hash).toBe(xrpClaim.messageId);

      // Verify telemetry was emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          blockchain: 'xrp',
          messageId: xrpClaim.messageId,
          success: true,
        })
      );
    });

    it('should not redeem unverified XRP claims', async () => {
      // Insert unverified XRP claim
      const unverifiedClaim = {
        blockchain: 'xrp',
        messageId: 'msg-xrp-unverified',
        senderId: 'peer-xrp-bad',
        channelId: 'BADCHANNEL',
        amount: '50000',
        signature: 'invalid-sig',
        publicKey: 'invalid-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        unverifiedClaim.messageId,
        unverifiedClaim.senderId,
        unverifiedClaim.blockchain,
        unverifiedClaim.channelId,
        JSON.stringify(unverifiedClaim),
        0, // verified = false
        Date.now()
      );

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      claimRedemptionService.stop();

      // Verify SDK was NOT called
      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();

      // Verify claim still unredeemed
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(unverifiedClaim.messageId) as any;

      expect(row.redeemed_at).toBeNull();
    });
  });

  describe('EVM Claim Redemption', () => {
    it('should redeem verified EVM balance proof', async () => {
      // Insert verified EVM claim
      const evmClaim = {
        blockchain: 'evm',
        messageId: 'msg-evm-001',
        senderId: 'peer-evm-1',
        channelId: '0xDEF456ABC789',
        nonce: 5,
        transferredAmount: '5000000000000000000', // 5 tokens (18 decimals)
        lockedAmount: '0',
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: 'evm-sig-123',
        signerAddress: '0x1234567890abcdef',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        evmClaim.messageId,
        evmClaim.senderId,
        evmClaim.blockchain,
        evmClaim.channelId,
        JSON.stringify(evmClaim),
        1,
        Date.now()
      );

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      claimRedemptionService.stop();

      // Verify EVM SDK was called with correct parameters
      expect(mockEVMChannelSDK.closeChannel).toHaveBeenCalledWith(
        evmClaim.channelId,
        '0x1234567890abcdef1234567890abcdef12345678', // Token address from config
        {
          channelId: evmClaim.channelId,
          nonce: 5,
          transferredAmount: 5000000000000000000n,
          lockedAmount: 0n,
          locksRoot: evmClaim.locksRoot,
        },
        evmClaim.signature
      );

      // Verify database was updated
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(evmClaim.messageId) as any;

      expect(row.redeemed_at).toBeTruthy();
      expect(row.redemption_tx_hash).toBe(evmClaim.messageId);

      // Verify telemetry was emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          blockchain: 'evm',
          messageId: evmClaim.messageId,
          success: true,
        })
      );
    });
  });

  describe('Aptos Claim Redemption', () => {
    it('should redeem verified Aptos claim', async () => {
      // Insert verified Aptos claim
      const aptosClaim = {
        blockchain: 'aptos',
        messageId: 'msg-aptos-001',
        senderId: 'peer-aptos-1',
        channelOwner: '0x789GHI012JKL',
        amount: '2000000', // 2 APT in octas
        nonce: 3,
        signature: 'aptos-sig-123',
        publicKey: 'aptos-pubkey-123',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        aptosClaim.messageId,
        aptosClaim.senderId,
        aptosClaim.blockchain,
        aptosClaim.channelOwner, // Aptos uses channelOwner as channel_id
        JSON.stringify(aptosClaim),
        1,
        Date.now()
      );

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      claimRedemptionService.stop();

      // Verify Aptos SDK was called with correct claim
      expect(mockAptosChannelSDK.submitClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          channelOwner: aptosClaim.channelOwner,
          amount: 2000000n,
          nonce: 3,
          signature: aptosClaim.signature,
          publicKey: aptosClaim.publicKey,
          createdAt: expect.any(Number),
        })
      );

      // Verify database was updated
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(aptosClaim.messageId) as any;

      expect(row.redeemed_at).toBeTruthy();
      expect(row.redemption_tx_hash).toBe(aptosClaim.messageId);

      // Verify telemetry was emitted
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          blockchain: 'aptos',
          messageId: aptosClaim.messageId,
          channelId: aptosClaim.channelOwner, // Aptos uses channelOwner
          success: true,
        })
      );
    });
  });

  describe('Profitability Filter', () => {
    it('should skip unprofitable claims', async () => {
      // Insert low-value XRP claim (500 drops - 10 gas = 490, below 1000 threshold)
      const unprofitableClaim = {
        blockchain: 'xrp',
        messageId: 'msg-unprofitable',
        senderId: 'peer-xrp-cheap',
        channelId: 'CHEAPCHANNEL',
        amount: '500', // 500 drops, below profit threshold
        signature: 'cheap-sig',
        publicKey: 'cheap-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        unprofitableClaim.messageId,
        unprofitableClaim.senderId,
        unprofitableClaim.blockchain,
        unprofitableClaim.channelId,
        JSON.stringify(unprofitableClaim),
        1, // verified = true
        Date.now()
      );

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      claimRedemptionService.stop();

      // Verify SDK was NOT called (unprofitable)
      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();

      // Verify claim still unredeemed
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(unprofitableClaim.messageId) as any;

      expect(row.redeemed_at).toBeNull();
    });

    it('should redeem profitable claims', async () => {
      // Insert high-value XRP claim (10000 drops - 10 gas = 9990, above 1000 threshold)
      const profitableClaim = {
        blockchain: 'xrp',
        messageId: 'msg-profitable',
        senderId: 'peer-xrp-rich',
        channelId: 'RICHCHANNEL',
        amount: '10000', // 10000 drops, above profit threshold
        signature: 'rich-sig',
        publicKey: 'rich-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        profitableClaim.messageId,
        profitableClaim.senderId,
        profitableClaim.blockchain,
        profitableClaim.channelId,
        JSON.stringify(profitableClaim),
        1,
        Date.now()
      );

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      claimRedemptionService.stop();

      // Verify SDK was called (profitable)
      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalled();

      // Verify claim was redeemed
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(profitableClaim.messageId) as any;

      expect(row.redeemed_at).toBeTruthy();
    });
  });

  describe('Multiple Claims Processing', () => {
    it('should process multiple claims from different blockchains in parallel', async () => {
      const claims = [
        {
          blockchain: 'xrp',
          messageId: 'msg-multi-xrp',
          senderId: 'peer-xrp',
          channelId: 'XRPCHANNEL',
          amount: '50000',
          signature: 'xrp-sig',
          publicKey: 'xrp-key',
        },
        {
          blockchain: 'evm',
          messageId: 'msg-multi-evm',
          senderId: 'peer-evm',
          channelId: '0xEVMCHANNEL',
          nonce: 1,
          transferredAmount: '5000000000000000000',
          lockedAmount: '0',
          locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
          signature: 'evm-sig',
          signerAddress: '0xABC',
        },
        {
          blockchain: 'aptos',
          messageId: 'msg-multi-aptos',
          senderId: 'peer-aptos',
          channelOwner: '0xAPTOSOWNER',
          amount: '3000000',
          nonce: 2,
          signature: 'aptos-sig',
          publicKey: 'aptos-key',
        },
      ];

      // Insert all claims
      const insertStmt = db.prepare(`
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const claim of claims) {
        insertStmt.run(
          claim.messageId,
          claim.senderId,
          claim.blockchain,
          claim.blockchain === 'aptos' ? (claim as any).channelOwner : (claim as any).channelId,
          JSON.stringify(claim),
          1,
          Date.now()
        );
      }

      // Start service
      claimRedemptionService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Stop service
      claimRedemptionService.stop();

      // Verify all SDKs were called
      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalled();
      expect(mockEVMChannelSDK.closeChannel).toHaveBeenCalled();
      expect(mockAptosChannelSDK.submitClaim).toHaveBeenCalled();

      // Verify all claims were redeemed
      const redeemedCount = db
        .prepare('SELECT COUNT(*) as count FROM received_claims WHERE redeemed_at IS NOT NULL')
        .get() as any;

      expect(redeemedCount.count).toBe(3);

      // Verify telemetry emitted for all claims
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledTimes(3);
    });

    it('should respect maxConcurrentRedemptions limit', async () => {
      // Create a new service with slower polling to avoid multiple cycles
      const slowService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 10000, // 10 second polling to avoid multiple cycles
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      // Insert 10 claims
      const insertStmt = db.prepare(`
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < 10; i++) {
        const claim = {
          blockchain: 'xrp',
          messageId: `msg-bulk-${i}`,
          senderId: 'peer-bulk',
          channelId: `BULKCHANNEL${i}`,
          amount: '100000',
          signature: `sig-${i}`,
          publicKey: `key-${i}`,
        };

        insertStmt.run(
          claim.messageId,
          claim.senderId,
          claim.blockchain,
          claim.channelId,
          JSON.stringify(claim),
          1,
          Date.now() + i // Stagger received_at for ordering
        );
      }

      // Start service (runs one immediate poll on start)
      slowService.start();

      // Wait for immediate poll to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service before next poll cycle
      slowService.stop();

      // Verify only maxConcurrentRedemptions (5) claims were processed in first cycle
      const redeemedCount = db
        .prepare('SELECT COUNT(*) as count FROM received_claims WHERE redeemed_at IS NOT NULL')
        .get() as any;

      expect(redeemedCount.count).toBe(5);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed redemptions with exponential backoff', async () => {
      // Create a fresh service with long polling interval
      const retryService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 60000, // Long interval to prevent additional polls
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      // Mock SDK to fail twice then succeed
      let attemptCount = 0;
      mockXRPChannelSDK.submitClaim.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error(`Network failure attempt ${attemptCount}`);
        }
        // Success on 3rd attempt
      });

      // Insert claim
      const claim = {
        blockchain: 'xrp',
        messageId: 'msg-retry-success',
        senderId: 'peer-retry',
        channelId: 'RETRYCHANNEL',
        amount: '100000',
        signature: 'retry-sig',
        publicKey: 'retry-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        claim.messageId,
        claim.senderId,
        claim.blockchain,
        claim.channelId,
        JSON.stringify(claim),
        1,
        Date.now()
      );

      // Start service - triggers immediate poll
      retryService.start();

      // Wait for retries to complete (1s + 2s delays + some buffer)
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Stop service
      retryService.stop();

      // Verify 3 attempts were made
      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalledTimes(3);

      // Verify claim was eventually redeemed
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(claim.messageId) as any;

      expect(row.redeemed_at).toBeTruthy();
    });

    it('should give up after 3 failed attempts', async () => {
      // Create a fresh service with long polling interval
      const failService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 60000, // Long interval to prevent additional polls
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      // Mock SDK to always fail
      mockXRPChannelSDK.submitClaim.mockRejectedValue(new Error('Permanent failure'));

      // Insert claim
      const claim = {
        blockchain: 'xrp',
        messageId: 'msg-retry-fail',
        senderId: 'peer-fail',
        channelId: 'FAILCHANNEL',
        amount: '100000',
        signature: 'fail-sig',
        publicKey: 'fail-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        claim.messageId,
        claim.senderId,
        claim.blockchain,
        claim.channelId,
        JSON.stringify(claim),
        1,
        Date.now()
      );

      // Start service - triggers immediate poll
      failService.start();

      // Wait for all retries to complete (1s + 2s + 4s delays + buffer)
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Stop service
      failService.stop();

      // Verify exactly 3 attempts were made
      expect(mockXRPChannelSDK.submitClaim).toHaveBeenCalledTimes(3);

      // Verify claim was NOT redeemed
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(claim.messageId) as any;

      expect(row.redeemed_at).toBeNull();

      // Verify telemetry emitted failure
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CLAIM_REDEEMED',
          messageId: claim.messageId,
          success: false,
          error: 'Permanent failure',
        })
      );
    });
  });

  describe('Service Lifecycle', () => {
    it('should start and stop cleanly', () => {
      expect(claimRedemptionService.isRunning).toBe(false);

      claimRedemptionService.start();
      expect(claimRedemptionService.isRunning).toBe(true);

      claimRedemptionService.stop();
      expect(claimRedemptionService.isRunning).toBe(false);
    });

    it('should not double-start', () => {
      claimRedemptionService.start();
      claimRedemptionService.start(); // Second start should be ignored

      expect(claimRedemptionService.isRunning).toBe(true);

      claimRedemptionService.stop();
    });

    it('should skip already redeemed claims', async () => {
      // Create fresh service for this test
      const skipService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 10000,
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      // Insert already redeemed claim
      const redeemedClaim = {
        blockchain: 'xrp',
        messageId: 'msg-already-redeemed',
        senderId: 'peer-redeemed',
        channelId: 'REDEEMEDCHANNEL',
        amount: '100000',
        signature: 'redeemed-sig',
        publicKey: 'redeemed-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at, redeemed_at, redemption_tx_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        redeemedClaim.messageId,
        redeemedClaim.senderId,
        redeemedClaim.blockchain,
        redeemedClaim.channelId,
        JSON.stringify(redeemedClaim),
        1,
        Date.now() - 1000,
        Date.now(), // Already redeemed
        'tx-hash-123'
      );

      // Start service
      skipService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      skipService.stop();

      // Verify SDK was NOT called (already redeemed)
      expect(mockXRPChannelSDK.submitClaim).not.toHaveBeenCalled();
    });
  });

  describe('Gas Estimation', () => {
    it('should estimate gas cost correctly for EVM', async () => {
      // Create fresh service for this test
      const gasService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 10000,
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      // Mock high gas price
      mockEvmProvider.getFeeData.mockResolvedValue({
        gasPrice: 100000000000n, // 100 gwei (high)
      });

      // Insert low-value EVM claim that should be unprofitable with high gas
      const evmClaim = {
        blockchain: 'evm',
        messageId: 'msg-evm-highgas',
        senderId: 'peer-evm-highgas',
        channelId: '0xHIGHGAS',
        nonce: 1,
        transferredAmount: '1000000', // Very low amount (1e6 wei)
        lockedAmount: '0',
        locksRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature: 'highgas-sig',
        signerAddress: '0xABC',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        evmClaim.messageId,
        evmClaim.senderId,
        evmClaim.blockchain,
        evmClaim.channelId,
        JSON.stringify(evmClaim),
        1,
        Date.now()
      );

      // Start service
      gasService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      gasService.stop();

      // Verify EVM SDK was NOT called (unprofitable with high gas)
      expect(mockEVMChannelSDK.closeChannel).not.toHaveBeenCalled();
    });
  });

  describe('Telemetry Integration', () => {
    it('should emit telemetry with correct event structure', async () => {
      // Create fresh service for this test
      const telemetryService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 10000,
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      const claim = {
        blockchain: 'xrp',
        messageId: 'msg-telemetry',
        senderId: 'peer-telemetry',
        channelId: 'TELEMETRYCHANNEL',
        amount: '100000',
        signature: 'telemetry-sig',
        publicKey: 'telemetry-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        claim.messageId,
        claim.senderId,
        claim.blockchain,
        claim.channelId,
        JSON.stringify(claim),
        1,
        Date.now()
      );

      // Start service
      telemetryService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      telemetryService.stop();

      // Verify telemetry event structure
      expect(mockTelemetryEmitter.emit).toHaveBeenCalledWith({
        type: 'CLAIM_REDEEMED',
        nodeId: 'test-node',
        peerId: claim.senderId,
        blockchain: 'xrp',
        messageId: claim.messageId,
        channelId: claim.channelId,
        amount: claim.amount,
        txHash: claim.messageId,
        gasCost: '10', // XRP fixed gas
        success: true,
        error: undefined,
        timestamp: expect.any(String),
      });
    });

    it('should continue even if telemetry emission fails', async () => {
      // Create fresh service for this test
      const telemetryFailService = new ClaimRedemptionService(
        db,
        mockXRPChannelSDK,
        mockEVMChannelSDK,
        mockAptosChannelSDK,
        mockEvmProvider,
        {
          minProfitThreshold: 1000n,
          pollingInterval: 10000,
          maxConcurrentRedemptions: 5,
          evmTokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
        },
        logger,
        mockTelemetryEmitter,
        'test-node'
      );

      // Make telemetry throw
      mockTelemetryEmitter.emit.mockImplementation(() => {
        throw new Error('Telemetry server down');
      });

      const claim = {
        blockchain: 'xrp',
        messageId: 'msg-telemetry-fail',
        senderId: 'peer-telemetry-fail',
        channelId: 'TELEMETRYFAILCHANNEL',
        amount: '100000',
        signature: 'tel-fail-sig',
        publicKey: 'tel-fail-key',
      };

      db.prepare(
        `
        INSERT INTO received_claims (
          message_id, peer_id, blockchain, channel_id, claim_data, verified, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        claim.messageId,
        claim.senderId,
        claim.blockchain,
        claim.channelId,
        JSON.stringify(claim),
        1,
        Date.now()
      );

      // Start service
      telemetryFailService.start();

      // Wait for polling cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop service
      telemetryFailService.stop();

      // Verify claim was still redeemed despite telemetry failure
      const row = db
        .prepare('SELECT * FROM received_claims WHERE message_id = ?')
        .get(claim.messageId) as any;

      expect(row.redeemed_at).toBeTruthy();
    });
  });
});
