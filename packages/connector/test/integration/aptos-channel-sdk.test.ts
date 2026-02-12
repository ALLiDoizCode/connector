/**
 * Integration tests for AptosChannelSDK
 *
 * Prerequisites:
 * - APTOS_NODE_URL: Aptos testnet RPC URL
 * - APTOS_PRIVATE_KEY: Account private key (funded with APT)
 * - APTOS_ACCOUNT_ADDRESS: Account address
 * - APTOS_CLAIM_PRIVATE_KEY: Claim signing key
 * - APTOS_MODULE_ADDRESS: Deployed Move module address
 * - Account must have >1 APT balance for gas fees
 *
 * These tests interact with actual Aptos testnet and require:
 * 1. A deployed payment_channel Move module
 * 2. Funded test accounts
 * 3. Network connectivity
 *
 * Story 27.4: Aptos Payment Channel SDK
 *
 * File: packages/connector/test/integration/aptos-channel-sdk.test.ts
 */
import pino from 'pino';
import {
  AptosChannelSDK,
  AptosChannelSDKConfig,
  createAptosChannelSDKFromEnv,
} from '../../src/settlement/aptos-channel-sdk';
import { AptosClient, createAptosClientFromEnv } from '../../src/settlement/aptos-client';
import {
  AptosClaimSigner,
  createAptosClaimSignerFromEnv,
} from '../../src/settlement/aptos-claim-signer';

// ============================================================================
// Test Configuration
// ============================================================================

// Check required environment variables
const APTOS_NODE_URL = process.env.APTOS_NODE_URL;
const APTOS_PRIVATE_KEY = process.env.APTOS_PRIVATE_KEY;
const APTOS_ACCOUNT_ADDRESS = process.env.APTOS_ACCOUNT_ADDRESS;
const APTOS_CLAIM_PRIVATE_KEY = process.env.APTOS_CLAIM_PRIVATE_KEY;
const APTOS_MODULE_ADDRESS = process.env.APTOS_MODULE_ADDRESS;

// Minimum balance required (1 APT = 100,000,000 octas)
const MIN_BALANCE_OCTAS = BigInt(100_000_000); // 1 APT for gas

// Test logger
const logger = pino({ level: 'debug' });

// ============================================================================
// Skip Check
// ============================================================================

const SKIP_TESTS =
  !APTOS_NODE_URL ||
  !APTOS_PRIVATE_KEY ||
  !APTOS_ACCOUNT_ADDRESS ||
  !APTOS_CLAIM_PRIVATE_KEY ||
  !APTOS_MODULE_ADDRESS;

if (SKIP_TESTS) {
  // eslint-disable-next-line no-console
  console.log(`
================================================================================
SKIPPING Aptos Channel SDK Integration Tests

Missing required environment variables. To run these tests, set:
  - APTOS_NODE_URL: Aptos testnet RPC URL (e.g., https://fullnode.testnet.aptoslabs.com/v1)
  - APTOS_PRIVATE_KEY: Account private key (ed25519 hex)
  - APTOS_ACCOUNT_ADDRESS: Account address (0x-prefixed)
  - APTOS_CLAIM_PRIVATE_KEY: Claim signing private key (ed25519 hex)
  - APTOS_MODULE_ADDRESS: Deployed payment_channel module address

Current status:
  APTOS_NODE_URL: ${APTOS_NODE_URL ? 'SET' : 'MISSING'}
  APTOS_PRIVATE_KEY: ${APTOS_PRIVATE_KEY ? 'SET' : 'MISSING'}
  APTOS_ACCOUNT_ADDRESS: ${APTOS_ACCOUNT_ADDRESS ? 'SET' : 'MISSING'}
  APTOS_CLAIM_PRIVATE_KEY: ${APTOS_CLAIM_PRIVATE_KEY ? 'SET' : 'MISSING'}
  APTOS_MODULE_ADDRESS: ${APTOS_MODULE_ADDRESS ? 'SET' : 'MISSING'}
================================================================================
`);
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('AptosChannelSDK Integration Tests', () => {
  let sdk: AptosChannelSDK;
  let aptosClient: AptosClient;
  let claimSigner: AptosClaimSigner;
  let testChannelOwner: string | null = null;

  beforeAll(async () => {
    if (SKIP_TESTS) {
      return;
    }

    // Create dependencies
    aptosClient = await createAptosClientFromEnv(logger);
    claimSigner = await createAptosClaimSignerFromEnv(logger);

    // Connect to Aptos
    await aptosClient.connect();

    // Check balance
    const balance = await aptosClient.getBalance(APTOS_ACCOUNT_ADDRESS!);
    if (balance < MIN_BALANCE_OCTAS) {
      throw new Error(
        `Insufficient balance: ${balance} octas. Need at least ${MIN_BALANCE_OCTAS} octas (1 APT).`
      );
    }

    // Create SDK
    const config: AptosChannelSDKConfig = {
      moduleAddress: APTOS_MODULE_ADDRESS!,
      refreshIntervalMs: 30000,
      defaultSettleDelay: 3600, // 1 hour for testing
    };

    sdk = new AptosChannelSDK(aptosClient, claimSigner, config, logger);
  });

  afterAll(async () => {
    if (SKIP_TESTS) {
      return;
    }

    // Cleanup: Stop auto-refresh
    sdk?.stopAutoRefresh();

    // Cleanup: Try to close any test channels
    if (testChannelOwner) {
      try {
        await sdk.requestClose(testChannelOwner);
        // Note: Can't finalize immediately due to settle delay
        logger.info({ channelOwner: testChannelOwner }, 'Test channel close requested for cleanup');
      } catch (error) {
        logger.warn({ error, channelOwner: testChannelOwner }, 'Failed to cleanup test channel');
      }
    }

    // Disconnect
    aptosClient?.disconnect();
  });

  // Skip all tests if environment not configured
  const itOrSkip = SKIP_TESTS ? it.skip : it;

  // --------------------------------------------------------------------------
  // Factory Function Tests
  // --------------------------------------------------------------------------

  describe('Factory function', () => {
    itOrSkip('should create SDK from environment variables', async () => {
      const envSdk = await createAptosChannelSDKFromEnv(logger);
      expect(envSdk).toBeInstanceOf(AptosChannelSDK);
      envSdk.stopAutoRefresh(); // Cleanup
    });
  });

  // --------------------------------------------------------------------------
  // Channel State Tests
  // --------------------------------------------------------------------------

  describe('Channel state querying', () => {
    itOrSkip('should return null for non-existent channel', async () => {
      const state = await sdk.getChannelState(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      );
      expect(state).toBeNull();
    });

    itOrSkip('should return empty channels list initially', () => {
      const channels = sdk.getMyChannels();
      expect(Array.isArray(channels)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Claim Signing Tests (Off-chain, no transaction required)
  // --------------------------------------------------------------------------

  describe('Off-chain claim operations', () => {
    itOrSkip('should sign a claim', async () => {
      const claim = await sdk.signClaim(APTOS_ACCOUNT_ADDRESS!, BigInt(100000000));

      expect(claim).toBeDefined();
      expect(claim.channelOwner).toContain('0x');
      expect(claim.amount).toBe(BigInt(100000000));
      expect(claim.nonce).toBe(1);
      expect(claim.signature).toBeDefined();
      expect(claim.publicKey).toBeDefined();
    });

    itOrSkip('should verify a valid claim', async () => {
      const claim = await sdk.signClaim(APTOS_ACCOUNT_ADDRESS!, BigInt(200000000));
      const isValid = await sdk.verifyClaim(claim);

      expect(isValid).toBe(true);
    });

    itOrSkip('should reject claim with invalid signature', async () => {
      const claim = await sdk.signClaim(APTOS_ACCOUNT_ADDRESS!, BigInt(300000000));

      // Tamper with signature
      const tamperedClaim = {
        ...claim,
        signature: 'invalid' + claim.signature.slice(7),
      };

      const isValid = await sdk.verifyClaim(tamperedClaim);
      expect(isValid).toBe(false);
    });

    itOrSkip('should auto-increment nonce for subsequent claims', async () => {
      const claim1 = await sdk.signClaim(APTOS_ACCOUNT_ADDRESS!, BigInt(100000000));
      const claim2 = await sdk.signClaim(APTOS_ACCOUNT_ADDRESS!, BigInt(200000000));

      expect(claim2.nonce).toBe(claim1.nonce + 1);
    });
  });

  // --------------------------------------------------------------------------
  // Auto-refresh Tests
  // --------------------------------------------------------------------------

  describe('Auto-refresh', () => {
    itOrSkip('should start and stop auto-refresh without errors', () => {
      expect(() => sdk.startAutoRefresh()).not.toThrow();
      expect(() => sdk.stopAutoRefresh()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // On-chain Tests (Require deployed Move module and funded account)
  // NOTE: These tests are more expensive (gas costs) and slower
  // --------------------------------------------------------------------------

  // Skip on-chain tests by default - uncomment to run full lifecycle tests
  describe.skip('On-chain channel lifecycle', () => {
    // These tests require:
    // 1. Deployed payment_channel Move module at APTOS_MODULE_ADDRESS
    // 2. A second account to act as destination
    // 3. Sufficient APT balance for multiple transactions

    const DESTINATION_ADDRESS = process.env.APTOS_DESTINATION_ADDRESS;
    const DESTINATION_PUBKEY = process.env.APTOS_DESTINATION_PUBKEY;

    itOrSkip(
      'should open a payment channel on testnet',
      async () => {
        if (!DESTINATION_ADDRESS || !DESTINATION_PUBKEY) {
          logger.warn('Skipping: APTOS_DESTINATION_ADDRESS and APTOS_DESTINATION_PUBKEY required');
          return;
        }

        const channelOwner = await sdk.openChannel(
          DESTINATION_ADDRESS,
          DESTINATION_PUBKEY,
          BigInt(10000000), // 0.1 APT
          3600 // 1 hour settle delay
        );

        expect(channelOwner).toContain('0x');
        testChannelOwner = channelOwner;

        // Verify channel state
        const state = await sdk.getChannelState(channelOwner);
        expect(state).not.toBeNull();
        expect(state!.deposited).toBe(BigInt(10000000));
        expect(state!.claimed).toBe(BigInt(0));
        expect(state!.status).toBe('open');
      },
      60000
    ); // 60s timeout for on-chain operation

    itOrSkip(
      'should deposit to channel on testnet',
      async () => {
        if (!testChannelOwner) {
          logger.warn('Skipping: No test channel available');
          return;
        }

        await sdk.deposit(BigInt(5000000)); // Add 0.05 APT

        const state = await sdk.getChannelState(testChannelOwner);
        expect(state!.deposited).toBe(BigInt(15000000)); // 0.15 APT total
      },
      60000
    );

    itOrSkip(
      'should request channel closure on testnet',
      async () => {
        if (!testChannelOwner) {
          logger.warn('Skipping: No test channel available');
          return;
        }

        await sdk.requestClose(testChannelOwner);

        const state = await sdk.getChannelState(testChannelOwner);
        expect(state!.status).toBe('closing');
        expect(state!.closeRequestedAt).toBeGreaterThan(0);
      },
      60000
    );

    // Note: finalizeClose cannot be tested immediately due to settle delay
    // Would need to wait for settle_delay seconds (minimum 1 hour in test config)
  });
});
