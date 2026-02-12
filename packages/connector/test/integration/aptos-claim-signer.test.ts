/**
 * AptosClaimSigner Integration Tests
 *
 * Integration tests for AptosClaimSigner with Aptos testnet.
 *
 * Prerequisites:
 * - Internet connectivity to Aptos testnet
 * - APTOS_PRIVATE_KEY, APTOS_ACCOUNT_ADDRESS configured
 * - APTOS_CLAIM_PRIVATE_KEY configured (can be same as account key for testing)
 * - Move payment channel module deployed to testnet (optional, for BCS validation)
 *
 * These tests verify end-to-end claim signing with the Aptos SDK.
 * Full on-chain submission tests are deferred to Story 27.4 (requires AptosChannelSDK).
 *
 * Story 27.3: Off-Chain Claim Signing and Verification
 *
 * File: packages/connector/test/integration/aptos-claim-signer.test.ts
 */
import pino from 'pino';
import {
  AptosClaimSigner,
  createAptosClaimSignerFromEnv,
  constructClaimMessage,
} from '../../src/settlement/aptos-claim-signer';
import { createAptosClientFromEnv, AptosClient } from '../../src/settlement/aptos-client';

// Test timeout for network operations
const INTEGRATION_TEST_TIMEOUT = 30000;

describe('AptosClaimSigner Integration (Testnet)', () => {
  let client: AptosClient | null = null;
  let claimSigner: AptosClaimSigner | null = null;
  let logger: pino.Logger;

  // Check if environment is configured for integration tests
  const isEnvConfigured = (): boolean => {
    return !!(
      process.env.APTOS_PRIVATE_KEY &&
      process.env.APTOS_ACCOUNT_ADDRESS &&
      process.env.APTOS_CLAIM_PRIVATE_KEY &&
      process.env.APTOS_NODE_URL
    );
  };

  beforeAll(async () => {
    // Skip if environment not configured
    if (!isEnvConfigured()) {
      logger = pino({ level: 'silent' });
      // eslint-disable-next-line no-console
      console.log(
        'Skipping Aptos claim integration tests: environment not configured. ' +
          'Set APTOS_NODE_URL, APTOS_PRIVATE_KEY, APTOS_ACCOUNT_ADDRESS, and APTOS_CLAIM_PRIVATE_KEY.'
      );
      return;
    }

    logger = pino({ level: 'info' });
    client = await createAptosClientFromEnv(logger);
    await client.connect();

    claimSigner = await createAptosClaimSignerFromEnv(logger);
  }, INTEGRATION_TEST_TIMEOUT);

  afterAll(() => {
    client?.disconnect();
  });

  describe('Claim Signing and Local Verification', () => {
    it('should sign claim and verify locally', async () => {
      if (!client || !claimSigner) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      const channelOwner = client.getAddress();
      const amount = BigInt(100000000); // 1 APT in octas
      const nonce = 1;

      // Sign the claim
      const claim = await claimSigner.signClaim(channelOwner, amount, nonce);

      // Verify claim format
      expect(claim.channelOwner).toContain('0x');
      expect(claim.amount).toBe(amount);
      expect(claim.nonce).toBe(nonce);
      expect(claim.signature).toHaveLength(128); // 64 bytes hex
      expect(claim.publicKey).toHaveLength(64); // 32 bytes hex
      expect(claim.createdAt).toBeGreaterThan(0);

      // Verify claim signature locally
      const isValid = await claimSigner.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );
      expect(isValid).toBe(true);
    });

    it('should produce consistent signatures for same data', async () => {
      if (!client || !claimSigner) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      const channelOwner = client.getAddress();
      const amount = BigInt(100000000);

      // Sign with fresh signer (same key)
      const signer1 = await createAptosClaimSignerFromEnv(logger);
      const signer2 = await createAptosClaimSignerFromEnv(logger);

      const claim1 = await signer1.signClaim(channelOwner, amount, 1);
      const claim2 = await signer2.signClaim(channelOwner, amount, 1);

      // ed25519 signatures are deterministic
      expect(claim1.signature).toBe(claim2.signature);
      expect(claim1.publicKey).toBe(claim2.publicKey);
    });

    it('should correctly track nonces across multiple claims', async () => {
      if (!client || !claimSigner) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      const channelOwner = client.getAddress();
      const signer = await createAptosClaimSignerFromEnv(logger);

      // Sign multiple claims with increasing nonces
      const claim1 = await signer.signClaim(channelOwner, BigInt(100), 10);
      const claim2 = await signer.signClaim(channelOwner, BigInt(200), 20);
      const claim3 = await signer.signClaim(channelOwner, BigInt(300), 30);

      // Verify all claims are valid
      expect(
        await signer.verifyClaim(
          claim1.channelOwner,
          claim1.amount,
          claim1.nonce,
          claim1.signature,
          claim1.publicKey
        )
      ).toBe(true);

      // Can only verify claim2 once (nonce tracking)
      // After verifying claim3, claim2 would be stale
      const signerForVerification = await createAptosClaimSignerFromEnv(logger);
      expect(
        await signerForVerification.verifyClaim(
          claim2.channelOwner,
          claim2.amount,
          claim2.nonce,
          claim2.signature,
          claim2.publicKey
        )
      ).toBe(true);

      // claim1 now rejected (stale nonce)
      expect(
        await signerForVerification.verifyClaim(
          claim1.channelOwner,
          claim1.amount,
          claim1.nonce,
          claim1.signature,
          claim1.publicKey
        )
      ).toBe(false);

      // claim3 still works
      expect(
        await signerForVerification.verifyClaim(
          claim3.channelOwner,
          claim3.amount,
          claim3.nonce,
          claim3.signature,
          claim3.publicKey
        )
      ).toBe(true);

      // Highest nonce tracking
      expect(signer.getHighestNonce(channelOwner)).toBe(30);
      expect(signer.getLatestClaim(channelOwner)).toEqual(claim3);
    });
  });

  describe('Signature Format Compatibility', () => {
    it('should produce ed25519 signature in correct format', async () => {
      if (!client || !claimSigner) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      const channelOwner = client.getAddress();
      const claim = await claimSigner.signClaim(channelOwner, BigInt(100), 100);

      // Signature: 64 bytes = 128 hex chars (no prefix)
      expect(claim.signature).toMatch(/^[0-9a-f]{128}$/i);
      expect(claim.signature.startsWith('0x')).toBe(false);

      // Public key: 32 bytes = 64 hex chars (no prefix)
      expect(claim.publicKey).toMatch(/^[0-9a-f]{64}$/i);
      expect(claim.publicKey.startsWith('0x')).toBe(false);
    });

    it('should produce message with correct structure', async () => {
      if (!client) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      const channelOwner = client.getAddress();
      const amount = BigInt(100000000);
      const nonce = 1;

      const message = await constructClaimMessage(channelOwner, amount, nonce);

      // Message structure: "CLAIM_APTOS" (11) + address (32) + amount u64 (8) + nonce u64 (8) = 59 bytes
      expect(message.length).toBe(59);

      // Check prefix
      const prefixBytes = new TextEncoder().encode('CLAIM_APTOS');
      for (let i = 0; i < prefixBytes.length; i++) {
        expect(message[i]).toBe(prefixBytes[i]);
      }
    });
  });

  describe('BCS Encoding Cross-Validation', () => {
    /**
     * BCS Encoding Cross-Validation Test
     *
     * CRITICAL: This test validates that TypeScript BCS encoding matches Move BCS encoding.
     * If this test fails, ALL on-chain signature verifications will fail.
     *
     * Requires: Move module deployed with a view function to verify signatures
     */
    it('should produce BCS encoding compatible with Move module', async () => {
      if (!client || !claimSigner) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      const moduleAddress = process.env.APTOS_MODULE_ADDRESS;
      if (!moduleAddress) {
        // eslint-disable-next-line no-console
        console.log('Skipping BCS validation: APTOS_MODULE_ADDRESS not set');
        return;
      }

      const channelOwner = client.getAddress();
      const amount = BigInt(1000000); // 0.01 APT
      const nonce = 1;

      const signer = await createAptosClaimSignerFromEnv(logger);
      const claim = await signer.signClaim(channelOwner, amount, nonce);

      // Call Move module view function to verify signature on-chain
      // This validates that our BCS encoding matches Move's encoding
      try {
        const result = await client.view<[boolean]>(
          moduleAddress,
          'payment_channel',
          'verify_signature_view', // View function that verifies without state changes
          [],
          [
            channelOwner,
            amount.toString(),
            nonce.toString(),
            `0x${claim.signature}`,
            `0x${claim.publicKey}`,
          ]
        );

        expect(result[0]).toBe(true);
        // eslint-disable-next-line no-console
        console.log('BCS encoding cross-validation: PASS');
      } catch (error) {
        // If view function doesn't exist, skip test
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('MODULE_NOT_FOUND') ||
          errorMessage.includes('FUNCTION_NOT_FOUND')
        ) {
          // eslint-disable-next-line no-console
          console.log(
            'Skipping BCS validation: verify_signature_view not available in deployed module'
          );
        } else {
          throw error;
        }
      }
    });
  });

  describe('Cross-Signer Verification', () => {
    it('should verify claims between different signers', async () => {
      if (!client) {
        // eslint-disable-next-line no-console
        console.log('Test skipped: environment not configured');
        return;
      }

      // Create two signers with different keys
      const signer1 = await AptosClaimSigner.create(
        { privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001' },
        logger
      );
      const signer2 = await AptosClaimSigner.create(
        { privateKey: '0x0000000000000000000000000000000000000000000000000000000000000002' },
        logger
      );

      const channelOwner = client.getAddress();

      // Signer1 signs a claim
      const claim = await signer1.signClaim(channelOwner, BigInt(100), 1);

      // Signer2 can verify it
      const isValid = await signer2.verifyClaim(
        claim.channelOwner,
        claim.amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      expect(isValid).toBe(true);
    });
  });
});

/**
 * Standalone tests that don't require network connectivity
 */
describe('AptosClaimSigner Standalone Integration', () => {
  const logger = pino({ level: 'silent' });

  it('should work end-to-end without network', async () => {
    // Create signer with test key
    const signer = await AptosClaimSigner.create(
      { privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001' },
      logger
    );

    const channelOwner = '0x' + '1'.repeat(64);

    // Sign claim
    const claim = await signer.signClaim(channelOwner, BigInt(1000000), 1);

    // Verify claim
    const isValid = await signer.verifyClaim(
      claim.channelOwner,
      claim.amount,
      claim.nonce,
      claim.signature,
      claim.publicKey
    );

    expect(isValid).toBe(true);
  });

  it('should maintain state across multiple operations', async () => {
    const signer = await AptosClaimSigner.create(
      { privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001' },
      logger
    );

    const channel1 = '0x' + '1'.repeat(64);
    const channel2 = '0x' + '2'.repeat(64);

    // Sign claims for multiple channels
    await signer.signClaim(channel1, BigInt(100), 1);
    await signer.signClaim(channel1, BigInt(200), 2);
    await signer.signClaim(channel2, BigInt(500), 5);

    // Verify state
    expect(signer.getHighestNonce(channel1)).toBe(2);
    expect(signer.getHighestNonce(channel2)).toBe(5);
    expect(signer.getChannelOwners()).toHaveLength(2);
    expect(signer.getLatestClaim(channel1)?.amount).toBe(BigInt(200));
    expect(signer.getLatestClaim(channel2)?.amount).toBe(BigInt(500));
  });

  it('should recover from initial nonce state', async () => {
    const initialNonceState = new Map<string, number>();
    const channel = '0x' + '1'.repeat(64);
    initialNonceState.set(channel, 100);

    const signer = await AptosClaimSigner.create(
      {
        privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
        initialNonceState,
      },
      logger
    );

    // Should reject nonce <= 100
    await expect(signer.signClaim(channel, BigInt(100), 50)).rejects.toThrow();
    await expect(signer.signClaim(channel, BigInt(100), 100)).rejects.toThrow();

    // Should accept nonce > 100
    const claim = await signer.signClaim(channel, BigInt(100), 101);
    expect(claim.nonce).toBe(101);
  });
});
