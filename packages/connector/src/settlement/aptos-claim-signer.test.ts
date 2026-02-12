/**
 * AptosClaimSigner Unit Tests
 *
 * Tests for off-chain claim signing and verification for Aptos payment channels.
 *
 * Story 27.3: Off-Chain Claim Signing and Verification
 *
 * File: packages/connector/src/settlement/aptos-claim-signer.test.ts
 */
import { Logger } from 'pino';
import {
  AptosClaimSigner,
  AptosClaimError,
  AptosClaimErrorCode,
  constructClaimMessage,
  createAptosClaimSignerFromEnv,
} from './aptos-claim-signer';

// Test keypair - deterministic for reproducible tests
// This is the standard test key from Aptos SDK examples
const TEST_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

// Another test keypair for peer simulation
const PEER_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000002';

// Sample channel owner addresses
const CHANNEL_OWNER_1 = '0x' + '1'.repeat(64);
const CHANNEL_OWNER_2 = '0x' + '2'.repeat(64);

describe('AptosClaimSigner', () => {
  let signer: AptosClaimSigner;
  let peerSigner: AptosClaimSigner;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(async () => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Logger>;

    signer = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);
    peerSigner = await AptosClaimSigner.create({ privateKey: PEER_PRIVATE_KEY }, mockLogger);
  });

  describe('create()', () => {
    it('should initialize with private key', () => {
      expect(signer).toBeDefined();
      expect(signer.getPublicKey()).toBeDefined();
    });

    it('should create child logger with component name', () => {
      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'AptosClaimSigner' });
    });

    it('should initialize with initial nonce state', async () => {
      const initialNonceState = new Map<string, number>();
      initialNonceState.set(CHANNEL_OWNER_1, 10);
      initialNonceState.set(CHANNEL_OWNER_2, 5);

      const signerWithState = await AptosClaimSigner.create(
        { privateKey: TEST_PRIVATE_KEY, initialNonceState },
        mockLogger
      );

      expect(signerWithState.getHighestNonce(CHANNEL_OWNER_1)).toBe(10);
      expect(signerWithState.getHighestNonce(CHANNEL_OWNER_2)).toBe(5);
    });

    it('should accept private key with or without 0x prefix', async () => {
      const signerWithPrefix = await AptosClaimSigner.create(
        { privateKey: '0x' + '01'.repeat(32) },
        mockLogger
      );
      const signerWithoutPrefix = await AptosClaimSigner.create(
        { privateKey: '01'.repeat(32) },
        mockLogger
      );

      // Both should work and produce the same public key
      expect(signerWithPrefix.getPublicKey()).toBe(signerWithoutPrefix.getPublicKey());
    });
  });

  describe('getPublicKey()', () => {
    it('should return consistent public key', () => {
      const pk1 = signer.getPublicKey();
      const pk2 = signer.getPublicKey();
      expect(pk1).toBe(pk2);
    });

    it('should return 64-character hex string (32 bytes)', () => {
      const pk = signer.getPublicKey();
      expect(pk).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/i.test(pk)).toBe(true);
    });

    it('should return public key without 0x prefix', () => {
      const pk = signer.getPublicKey();
      expect(pk.startsWith('0x')).toBe(false);
    });
  });

  describe('signClaim()', () => {
    it('should produce valid ed25519 signature', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      expect(claim.signature).toHaveLength(128); // 64 bytes = 128 hex chars
      expect(/^[0-9a-f]{128}$/i.test(claim.signature)).toBe(true);
    });

    it('should produce valid 32-byte public key', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      expect(claim.publicKey).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]{64}$/i.test(claim.publicKey)).toBe(true);
    });

    it('should include all claim fields', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      expect(claim.channelOwner).toBeDefined();
      expect(claim.amount).toBe(BigInt(100));
      expect(claim.nonce).toBe(1);
      expect(claim.signature).toBeDefined();
      expect(claim.publicKey).toBeDefined();
      expect(claim.createdAt).toBeGreaterThan(0);
    });

    it('should normalize channel owner address', async () => {
      // With 0x prefix
      const claim1 = await signer.signClaim('0x1234abcd', BigInt(100), 1);
      expect(claim1.channelOwner.startsWith('0x')).toBe(true);
      expect(claim1.channelOwner.length).toBe(66); // 0x + 64 hex chars

      // Create new signer to reset state
      const signer2 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);

      // Without 0x prefix (should be normalized)
      const claim2 = await signer2.signClaim('1234abcd', BigInt(100), 1);
      expect(claim2.channelOwner.startsWith('0x')).toBe(true);
    });

    it('should reject nonce <= previous nonce (equal)', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);

      await expect(signer.signClaim(CHANNEL_OWNER_1, BigInt(200), 5)).rejects.toThrow(
        AptosClaimError
      );
    });

    it('should reject nonce <= previous nonce (less than)', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);

      await expect(signer.signClaim(CHANNEL_OWNER_1, BigInt(200), 3)).rejects.toThrow(
        AptosClaimError
      );
    });

    it('should throw AptosClaimError with INVALID_NONCE code', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);

      try {
        await signer.signClaim(CHANNEL_OWNER_1, BigInt(200), 3);
        fail('Expected AptosClaimError');
      } catch (error) {
        expect(error).toBeInstanceOf(AptosClaimError);
        expect((error as AptosClaimError).code).toBe(AptosClaimErrorCode.INVALID_NONCE);
      }
    });

    it('should allow first claim with nonce 1', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      expect(claim.nonce).toBe(1);
    });

    it('should allow first claim with nonce > 1', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 100);
      expect(claim.nonce).toBe(100);
    });

    it('should track highest nonce per channel independently', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);
      await signer.signClaim(CHANNEL_OWNER_2, BigInt(200), 3);

      expect(signer.getHighestNonce(CHANNEL_OWNER_1)).toBe(5);
      expect(signer.getHighestNonce(CHANNEL_OWNER_2)).toBe(3);
    });

    it('should store latest claim for dispute resolution', async () => {
      const claim1 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      expect(signer.getLatestClaim(CHANNEL_OWNER_1)).toEqual(claim1);

      const claim2 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(200), 2);
      expect(signer.getLatestClaim(CHANNEL_OWNER_1)).toEqual(claim2);
    });

    it('should log claim signing', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          channelOwner: expect.any(String),
          amount: '100',
          nonce: 1,
        }),
        'Claim signed'
      );
    });

    it('should handle large amounts (bigint)', async () => {
      // u64 max is 18446744073709551615, use a large but valid amount
      const largeAmount = BigInt('10000000000000000000'); // 100 billion APT in octas (10^19)
      const claim = await signer.signClaim(CHANNEL_OWNER_1, largeAmount, 1);

      expect(claim.amount).toBe(largeAmount);
    });
  });

  describe('verifyClaim()', () => {
    it('should verify valid signature', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(isValid).toBe(true);
    });

    it('should verify claim signed by another signer', async () => {
      const claim = await peerSigner.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      // Verify using original signer (different instance)
      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature (wrong amount)', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        BigInt(999), // Wrong amount
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(isValid).toBe(false);
    });

    it('should reject invalid signature (wrong nonce)', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        99, // Wrong nonce
        claim.signature,
        claim.publicKey
      );

      expect(isValid).toBe(false);
    });

    it('should reject invalid signature (wrong channel owner)', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        CHANNEL_OWNER_2, // Wrong channel owner
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(isValid).toBe(false);
    });

    it('should reject invalid signature (wrong public key)', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        peerSigner.getPublicKey() // Wrong public key
      );

      expect(isValid).toBe(false);
    });

    it('should reject stale nonce from same peer', async () => {
      // Sign and verify first claim
      const claim1 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 10);
      await signer.verifyClaim(
        claim1.channelOwner,
        claim1.amount,
        claim1.nonce,
        claim1.signature,
        claim1.publicKey
      );

      // Sign a new claim with lower nonce (for a different purpose)
      const signer2 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);
      const claim2 = await signer2.signClaim(CHANNEL_OWNER_1, BigInt(50), 5);

      // Try to verify with stale nonce - should fail
      const isValid = await signer.verifyClaim(
        claim2.channelOwner,
        claim2.amount,
        claim2.nonce,
        claim2.signature,
        claim2.publicKey
      );

      expect(isValid).toBe(false);
    });

    it('should handle malformed signature gracefully', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        'invalid-signature-not-hex',
        claim.publicKey
      );

      expect(isValid).toBe(false);
    });

    it('should handle malformed public key gracefully', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const isValid = await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        'invalid-pubkey'
      );

      expect(isValid).toBe(false);
    });

    it('should update received nonce state on successful verification', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);

      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, claim.publicKey)).toBe(0);

      await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, claim.publicKey)).toBe(5);
    });

    it('should log verification result', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          channelOwner: expect.any(String),
          amount: '100',
          nonce: 1,
        }),
        'Claim verification succeeded'
      );
    });
  });

  describe('getHighestNonce()', () => {
    it('should return 0 for unknown channel', () => {
      expect(signer.getHighestNonce(CHANNEL_OWNER_1)).toBe(0);
    });

    it('should return correct nonce after signing', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);
      expect(signer.getHighestNonce(CHANNEL_OWNER_1)).toBe(5);

      await signer.signClaim(CHANNEL_OWNER_1, BigInt(200), 10);
      expect(signer.getHighestNonce(CHANNEL_OWNER_1)).toBe(10);
    });
  });

  describe('getHighestReceivedNonce()', () => {
    it('should return 0 for unknown peer', () => {
      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, 'unknown-peer')).toBe(0);
    });

    it('should return correct nonce after verification', async () => {
      const claim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);

      await signer.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, claim.publicKey)).toBe(5);
    });

    it('should track nonces per peer independently', async () => {
      // Sign with original signer
      const claim1 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 10);

      // Sign with peer signer
      const claim2 = await peerSigner.signClaim(CHANNEL_OWNER_1, BigInt(50), 5);

      // Verify both
      await signer.verifyClaim(
        claim1.channelOwner,
        claim1.amount,
        claim1.nonce,
        claim1.signature,
        claim1.publicKey
      );

      await signer.verifyClaim(
        claim2.channelOwner,
        claim2.amount,
        claim2.nonce,
        claim2.signature,
        claim2.publicKey
      );

      // Each peer tracked independently
      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, signer.getPublicKey())).toBe(10);
      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, peerSigner.getPublicKey())).toBe(5);
    });
  });

  describe('getLatestClaim()', () => {
    it('should return null for unknown channel', () => {
      expect(signer.getLatestClaim(CHANNEL_OWNER_1)).toBeNull();
    });

    it('should return latest claim after signing', async () => {
      const claim1 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      expect(signer.getLatestClaim(CHANNEL_OWNER_1)).toEqual(claim1);

      const claim2 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(200), 2);
      expect(signer.getLatestClaim(CHANNEL_OWNER_1)).toEqual(claim2);
    });
  });

  describe('getChannelOwners()', () => {
    it('should return empty array initially', () => {
      expect(signer.getChannelOwners()).toEqual([]);
    });

    it('should return all channels with signed claims', async () => {
      await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      await signer.signClaim(CHANNEL_OWNER_2, BigInt(200), 1);

      const owners = signer.getChannelOwners();
      expect(owners).toHaveLength(2);
      expect(owners).toContain(signer['normalizeAddress'](CHANNEL_OWNER_1));
      expect(owners).toContain(signer['normalizeAddress'](CHANNEL_OWNER_2));
    });
  });

  describe('Received claim tracking (separate from signed claims)', () => {
    it('should track received claims separately from signed claims', async () => {
      // Sign a claim (our outgoing claim)
      const signedClaim = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);

      // Our signed nonce should be 5
      expect(signer.getHighestNonce(CHANNEL_OWNER_1)).toBe(5);

      // Verify a claim (incoming claim - happens to be our own for testing)
      await signer.verifyClaim(
        signedClaim.channelOwner,
        signedClaim.amount,
        signedClaim.nonce,
        signedClaim.signature,
        signedClaim.publicKey
      );

      // Our signed nonce should still be 5 (unchanged by verification)
      expect(signer.getHighestNonce(CHANNEL_OWNER_1)).toBe(5);

      // Received nonce tracking is independent
      expect(signer.getHighestReceivedNonce(CHANNEL_OWNER_1, signedClaim.publicKey)).toBe(5);
    });

    it('should allow same nonce from different peers', async () => {
      // Sign and verify from signer
      const claim1 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 5);
      await signer.verifyClaim(
        claim1.channelOwner,
        claim1.amount,
        claim1.nonce,
        claim1.signature,
        claim1.publicKey
      );

      // Sign and verify from peer (same nonce 5)
      const claim2 = await peerSigner.signClaim(CHANNEL_OWNER_1, BigInt(50), 5);
      const isValid = await signer.verifyClaim(
        claim2.channelOwner,
        claim2.amount,
        claim2.nonce,
        claim2.signature,
        claim2.publicKey
      );

      // Both should be valid - same nonce but different peers
      expect(isValid).toBe(true);
    });
  });

  describe('BCS encoding compatibility', () => {
    it('should produce deterministic message bytes', async () => {
      // Sign same data twice with fresh signers - signatures should be identical
      // (ed25519 signatures are deterministic)
      const signer1 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);
      const signer2 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);

      const claim1 = await signer1.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      const claim2 = await signer2.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      expect(claim1.signature).toBe(claim2.signature);
    });

    it('should produce different signatures for different amounts', async () => {
      const signer1 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);
      const signer2 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);

      const claim1 = await signer1.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      const claim2 = await signer2.signClaim(CHANNEL_OWNER_1, BigInt(200), 1);

      expect(claim1.signature).not.toBe(claim2.signature);
    });

    it('should produce different signatures for different nonces', async () => {
      const signer1 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);
      const signer2 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);

      const claim1 = await signer1.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);
      const claim2 = await signer2.signClaim(CHANNEL_OWNER_1, BigInt(100), 2);

      expect(claim1.signature).not.toBe(claim2.signature);
    });

    it('should produce different signatures for different channel owners', async () => {
      const claim1 = await signer.signClaim(CHANNEL_OWNER_1, BigInt(100), 1);

      const signer2 = await AptosClaimSigner.create({ privateKey: TEST_PRIVATE_KEY }, mockLogger);
      const claim2 = await signer2.signClaim(CHANNEL_OWNER_2, BigInt(100), 1);

      expect(claim1.signature).not.toBe(claim2.signature);
    });
  });

  describe('constructClaimMessage()', () => {
    it('should produce consistent message for same inputs', async () => {
      const msg1 = await constructClaimMessage(CHANNEL_OWNER_1, BigInt(100), 1);
      const msg2 = await constructClaimMessage(CHANNEL_OWNER_1, BigInt(100), 1);

      expect(Buffer.from(msg1).toString('hex')).toBe(Buffer.from(msg2).toString('hex'));
    });

    it('should start with CLAIM_APTOS prefix', async () => {
      const msg = await constructClaimMessage(CHANNEL_OWNER_1, BigInt(100), 1);
      const prefix = new TextEncoder().encode('CLAIM_APTOS');

      for (let i = 0; i < prefix.length; i++) {
        expect(msg[i]).toBe(prefix[i]);
      }
    });

    it('should have correct total length', async () => {
      const msg = await constructClaimMessage(CHANNEL_OWNER_1, BigInt(100), 1);

      // 11 (CLAIM_APTOS) + 32 (address) + 8 (amount u64) + 8 (nonce u64) = 59 bytes
      expect(msg.length).toBe(59);
    });

    it('should encode amount as little-endian u64', async () => {
      const msg = await constructClaimMessage(CHANNEL_OWNER_1, BigInt(256), 1);

      // Amount starts at offset 43 (11 + 32)
      // 256 in little-endian u64: 00 01 00 00 00 00 00 00
      expect(msg[43]).toBe(0);
      expect(msg[44]).toBe(1);
      expect(msg[45]).toBe(0);
    });
  });

  describe('createAptosClaimSignerFromEnv()', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create signer from environment variable', async () => {
      process.env.APTOS_CLAIM_PRIVATE_KEY = TEST_PRIVATE_KEY;

      const envSigner = await createAptosClaimSignerFromEnv(mockLogger);

      expect(envSigner).toBeInstanceOf(AptosClaimSigner);
      expect(envSigner.getPublicKey()).toBeDefined();
    });

    it('should throw error if APTOS_CLAIM_PRIVATE_KEY not set', async () => {
      delete process.env.APTOS_CLAIM_PRIVATE_KEY;

      await expect(createAptosClaimSignerFromEnv(mockLogger)).rejects.toThrow(
        'APTOS_CLAIM_PRIVATE_KEY environment variable is required'
      );
    });
  });
});
