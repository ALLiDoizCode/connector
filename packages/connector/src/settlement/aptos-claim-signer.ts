/**
 * Aptos Claim Signer
 *
 * Signs and verifies off-chain balance proofs for Aptos payment channels.
 * Compatible with Move module ed25519 signature verification.
 *
 * Story 27.3: Off-Chain Claim Signing and Verification
 *
 * File: packages/connector/src/settlement/aptos-claim-signer.ts
 */
import type { Ed25519PrivateKey, Ed25519PublicKey } from '@aptos-labs/ts-sdk';
import { Logger } from 'pino';
import { requireOptional } from '../utils/optional-require';

// Module-level SDK cache for @aptos-labs/ts-sdk
let _aptosSdk: typeof import('@aptos-labs/ts-sdk') | null = null;
async function loadAptosSdk(): Promise<typeof import('@aptos-labs/ts-sdk')> {
  if (!_aptosSdk) {
    _aptosSdk = await requireOptional<typeof import('@aptos-labs/ts-sdk')>(
      '@aptos-labs/ts-sdk',
      'Aptos settlement'
    );
  }
  return _aptosSdk;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Aptos Claim Error Codes
 *
 * Error codes for claim signing and verification operations.
 * Follows AptosErrorCode pattern from Story 27.1.
 */
export enum AptosClaimErrorCode {
  // Nonce errors
  INVALID_NONCE = 'APTOS_CLAIM_INVALID_NONCE', // Nonce <= previous nonce
  STALE_NONCE = 'APTOS_CLAIM_STALE_NONCE', // Received claim has stale nonce

  // Signature errors
  INVALID_SIGNATURE = 'APTOS_CLAIM_INVALID_SIGNATURE', // Signature verification failed
  MALFORMED_SIGNATURE = 'APTOS_CLAIM_MALFORMED_SIGNATURE', // Signature format invalid

  // Key errors
  MALFORMED_PUBLIC_KEY = 'APTOS_CLAIM_MALFORMED_PUBLIC_KEY', // Public key format invalid

  // General errors
  ENCODING_ERROR = 'APTOS_CLAIM_ENCODING_ERROR', // BCS encoding failed
}

/**
 * Aptos Claim Error Class
 *
 * Thrown for claim signing/verification errors.
 */
export class AptosClaimError extends Error {
  constructor(
    public readonly code: AptosClaimErrorCode,
    message: string,
    public readonly originalError?: Error | unknown
  ) {
    super(message);
    this.name = 'AptosClaimError';
  }
}

// ============================================================================
// Data Models
// ============================================================================

/**
 * Aptos Payment Channel Claim Structure
 *
 * Represents a signed balance proof that can be submitted on-chain
 * to claim APT from a payment channel.
 */
export interface AptosClaim {
  /**
   * Aptos address of the channel owner (payer)
   * Format: 0x-prefixed 64-character hex
   */
  channelOwner: string;

  /**
   * Cumulative amount in octas (1 APT = 100,000,000 octas)
   * This is the TOTAL amount claimed so far, not incremental
   */
  amount: bigint;

  /**
   * Monotonically increasing counter for replay protection
   * Each claim must have nonce > previous claim's nonce
   */
  nonce: number;

  /**
   * ed25519 signature over the claim message
   * Format: hex string (64 bytes = 128 hex characters)
   */
  signature: string;

  /**
   * ed25519 public key of the signer (claim creator)
   * Format: hex string (32 bytes = 64 hex characters)
   * Used for on-chain verification
   */
  publicKey: string;

  /**
   * Timestamp when this claim was created
   * Used for dispute resolution and claim ordering
   */
  createdAt: number;
}

/**
 * Configuration for AptosClaimSigner
 */
export interface AptosClaimSignerConfig {
  /**
   * ed25519 private key for claim signing
   * Format: 64-character hex string (32 bytes) or with 0x prefix
   * MUST be stored in environment variable (APTOS_CLAIM_PRIVATE_KEY)
   */
  privateKey: string;

  /**
   * Optional: Initial nonce state per channel (for recovery)
   * Map from channelOwner address to highest known nonce
   */
  initialNonceState?: Map<string, number>;
}

/**
 * Tracks claim state per payment channel for dispute resolution
 * Used for claims WE SIGN (outgoing claims to peers)
 */
interface ChannelClaimState {
  /**
   * Highest nonce signed for this channel
   */
  highestNonce: number;

  /**
   * Highest cumulative amount claimed
   */
  highestAmount: bigint;

  /**
   * Latest claim signed (for dispute resolution)
   */
  latestClaim: AptosClaim;
}

/**
 * Tracks received claim state from peers
 * Used for claims WE RECEIVE AND VERIFY (incoming claims from peers)
 * Keyed by composite key: `${channelOwner}:${peerPublicKey}`
 */
interface ReceivedClaimState {
  /**
   * Highest nonce received and verified from this peer
   */
  highestNonce: number;

  /**
   * Latest verified claim from this peer
   */
  latestClaim: AptosClaim;
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Aptos Claim Signer Interface
 *
 * Signs and verifies off-chain balance proofs for Aptos payment channels.
 * Compatible with Move module ed25519 signature verification.
 *
 * Implementation: packages/connector/src/settlement/aptos-claim-signer.ts
 */
export interface IAptosClaimSigner {
  /**
   * Sign a claim for a payment channel
   *
   * Creates an ed25519 signature over the canonical claim message.
   * Message format: "CLAIM_APTOS" || channelOwner (BCS) || amount (BCS) || nonce (BCS)
   *
   * @param channelOwner - Aptos address of the channel owner (0x-prefixed hex)
   * @param amount - Cumulative amount in octas (TOTAL claimed, not incremental)
   * @param nonce - Must be greater than any previously signed nonce for this channel
   * @returns AptosClaim with signature
   * @throws AptosClaimError if nonce <= previously signed nonce for this channel
   */
  signClaim(channelOwner: string, amount: bigint, nonce: number): Promise<AptosClaim>;

  /**
   * Verify a claim signature from a peer
   *
   * Validates that the signature matches the claim data using the provided public key.
   *
   * **Nonce Tracking Behavior:**
   * - Tracks received claims SEPARATELY from signed claims (different state)
   * - Uses (channelOwner, publicKey) as composite key for tracking peer claims
   * - Rejects claims with nonce <= highest previously verified nonce from same peer
   * - This prevents replay attacks from peers resending old claims
   *
   * @param channelOwner - Aptos address of the channel owner
   * @param amount - Cumulative amount in octas
   * @param nonce - Claim nonce
   * @param signature - ed25519 signature (hex string)
   * @param publicKey - ed25519 public key of signer (hex string)
   * @returns true if signature is valid and nonce is fresh, false otherwise
   */
  verifyClaim(
    channelOwner: string,
    amount: bigint,
    nonce: number,
    signature: string,
    publicKey: string
  ): Promise<boolean>;

  /**
   * Get the highest nonce received from a peer for a channel
   *
   * Used to track replay protection for received claims.
   * Tracked separately from signed claims.
   *
   * @param channelOwner - Aptos address of the channel owner
   * @param publicKey - Public key of the peer who signed claims
   * @returns Highest verified nonce from this peer, or 0 if none
   */
  getHighestReceivedNonce(channelOwner: string, publicKey: string): number;

  /**
   * Get the public key for this signer
   *
   * Returns the ed25519 public key that corresponds to this signer's private key.
   * Used to share with channel owners for on-chain claim verification.
   *
   * @returns Public key as hex string (32 bytes = 64 hex characters)
   */
  getPublicKey(): string;

  /**
   * Get the highest nonce signed for a channel
   *
   * Used to determine next valid nonce when creating claims.
   *
   * @param channelOwner - Aptos address of the channel owner
   * @returns Highest signed nonce, or 0 if no claims signed for this channel
   */
  getHighestNonce(channelOwner: string): number;

  /**
   * Get the latest claim for a channel
   *
   * Returns the most recent claim signed for dispute resolution.
   *
   * @param channelOwner - Aptos address of the channel owner
   * @returns Latest AptosClaim or null if no claims signed
   */
  getLatestClaim(channelOwner: string): AptosClaim | null;

  /**
   * Get all channels with signed claims
   *
   * Returns list of channel owner addresses that have signed claims.
   * Used for claim state recovery and monitoring.
   *
   * @returns Array of channel owner addresses
   */
  getChannelOwners(): string[];
}

// ============================================================================
// BCS Encoding
// ============================================================================

/**
 * Construct canonical claim message matching Move BCS encoding
 *
 * MUST match Move module's verify_claim_signature():
 *   let message = b"CLAIM_APTOS";
 *   vector::append(&mut message, bcs::to_bytes(&channel_owner));
 *   vector::append(&mut message, bcs::to_bytes(&amount));
 *   vector::append(&mut message, bcs::to_bytes(&nonce));
 *
 * @param channelOwner - Aptos address (0x-prefixed hex)
 * @param amount - Amount in octas
 * @param nonce - Claim nonce
 * @returns Uint8Array containing the message bytes for signing
 */
async function constructClaimMessage(
  channelOwner: string,
  amount: bigint,
  nonce: number
): Promise<Uint8Array> {
  const sdk = await loadAptosSdk();

  // "CLAIM_APTOS" as bytes (raw UTF-8, no length prefix)
  const prefix = new TextEncoder().encode('CLAIM_APTOS');

  // BCS encode address (32 bytes, no length prefix for fixed-size)
  // Remove 0x prefix if present and convert hex to bytes
  const addressHex = channelOwner.replace(/^0x/i, '').padStart(64, '0');
  const addressBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    addressBytes[i] = parseInt(addressHex.slice(i * 2, i * 2 + 2), 16);
  }

  // BCS encode amount (u64 - 8 bytes little-endian)
  const amountSerializer = new sdk.Serializer();
  amountSerializer.serializeU64(amount);
  const amountBytes = amountSerializer.toUint8Array();

  // BCS encode nonce (u64 - 8 bytes little-endian)
  const nonceSerializer = new sdk.Serializer();
  nonceSerializer.serializeU64(BigInt(nonce));
  const nonceBytes = nonceSerializer.toUint8Array();

  // Concatenate all parts
  const message = new Uint8Array(
    prefix.length + addressBytes.length + amountBytes.length + nonceBytes.length
  );
  let offset = 0;
  message.set(prefix, offset);
  offset += prefix.length;
  message.set(addressBytes, offset);
  offset += addressBytes.length;
  message.set(amountBytes, offset);
  offset += amountBytes.length;
  message.set(nonceBytes, offset);

  return message;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * AptosClaimSigner Implementation
 *
 * Signs and verifies off-chain balance proofs for Aptos payment channels.
 * Uses ed25519 signatures compatible with Aptos Move module verification.
 */
export class AptosClaimSigner implements IAptosClaimSigner {
  private readonly _privateKey: Ed25519PrivateKey;
  private readonly _publicKey: Ed25519PublicKey;
  private readonly _channelStates: Map<string, ChannelClaimState>;
  private readonly _receivedClaimStates: Map<string, ReceivedClaimState>;
  private readonly _logger: Logger;

  private constructor(privateKey: Ed25519PrivateKey, publicKey: Ed25519PublicKey, logger: Logger) {
    this._privateKey = privateKey;
    this._publicKey = publicKey;
    this._channelStates = new Map();
    this._receivedClaimStates = new Map();
    this._logger = logger.child({ component: 'AptosClaimSigner' });
  }

  static async create(config: AptosClaimSignerConfig, logger: Logger): Promise<AptosClaimSigner> {
    const sdk = await loadAptosSdk();

    const privateKey = new sdk.Ed25519PrivateKey(config.privateKey);
    const publicKey = privateKey.publicKey();
    const signer = new AptosClaimSigner(privateKey, publicKey, logger);

    // Initialize nonce state if provided (for recovery)
    if (config.initialNonceState) {
      config.initialNonceState.forEach((nonce, channelOwner) => {
        signer._channelStates.set(signer.normalizeAddress(channelOwner), {
          highestNonce: nonce,
          highestAmount: BigInt(0),
          latestClaim: null as unknown as AptosClaim, // Will be set on first claim
        });
      });
    }

    return signer;
  }

  /**
   * Normalize Aptos address to lowercase with 0x prefix
   */
  private normalizeAddress(address: string): string {
    const cleaned = address.replace(/^0x/i, '').toLowerCase();
    return `0x${cleaned.padStart(64, '0')}`;
  }

  /**
   * Get composite key for received claim tracking
   * Format: channelOwner:peerPublicKey
   */
  private getReceivedClaimKey(channelOwner: string, peerPublicKey: string): string {
    return `${this.normalizeAddress(channelOwner)}:${peerPublicKey.toLowerCase().replace(/^0x/i, '')}`;
  }

  getPublicKey(): string {
    // Return public key as hex string without 0x prefix (64 hex chars = 32 bytes)
    return this._publicKey.toString().replace(/^0x/i, '');
  }

  getHighestNonce(channelOwner: string): number {
    const normalizedAddress = this.normalizeAddress(channelOwner);
    return this._channelStates.get(normalizedAddress)?.highestNonce ?? 0;
  }

  getHighestReceivedNonce(channelOwner: string, publicKey: string): number {
    const key = this.getReceivedClaimKey(channelOwner, publicKey);
    return this._receivedClaimStates.get(key)?.highestNonce ?? 0;
  }

  getLatestClaim(channelOwner: string): AptosClaim | null {
    const normalizedAddress = this.normalizeAddress(channelOwner);
    return this._channelStates.get(normalizedAddress)?.latestClaim ?? null;
  }

  getChannelOwners(): string[] {
    return Array.from(this._channelStates.keys());
  }

  async signClaim(channelOwner: string, amount: bigint, nonce: number): Promise<AptosClaim> {
    const normalizedAddress = this.normalizeAddress(channelOwner);

    // Get or create channel state
    const state = this._channelStates.get(normalizedAddress);
    const currentHighestNonce = state?.highestNonce ?? 0;

    // Validate nonce is strictly greater
    if (nonce <= currentHighestNonce) {
      throw new AptosClaimError(
        AptosClaimErrorCode.INVALID_NONCE,
        `Invalid nonce: ${nonce} must be greater than ${currentHighestNonce}`
      );
    }

    // Construct message
    const message = await constructClaimMessage(normalizedAddress, amount, nonce);

    // Sign with ed25519
    const signature = this._privateKey.sign(message);

    // Create claim object
    const claim: AptosClaim = {
      channelOwner: normalizedAddress,
      amount,
      nonce,
      signature: signature.toString().replace(/^0x/i, ''), // Hex string without prefix
      publicKey: this.getPublicKey(),
      createdAt: Date.now(),
    };

    // Update channel state
    this._channelStates.set(normalizedAddress, {
      highestNonce: nonce,
      highestAmount: amount,
      latestClaim: claim,
    });

    this._logger.info(
      { channelOwner: normalizedAddress, amount: amount.toString(), nonce },
      'Claim signed'
    );

    return claim;
  }

  async verifyClaim(
    channelOwner: string,
    amount: bigint,
    nonce: number,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      const normalizedAddress = this.normalizeAddress(channelOwner);

      // Validate nonce freshness against RECEIVED claims from this peer
      // Uses composite key: channelOwner + peerPublicKey
      const key = this.getReceivedClaimKey(channelOwner, publicKey);
      const receivedState = this._receivedClaimStates.get(key);
      if (receivedState && nonce <= receivedState.highestNonce) {
        this._logger.warn(
          {
            channelOwner: normalizedAddress,
            nonce,
            highestNonce: receivedState.highestNonce,
            peerPublicKey: publicKey,
          },
          'Claim verification failed: stale nonce from peer'
        );
        return false;
      }

      const sdk = await loadAptosSdk();

      // Construct message
      const message = await constructClaimMessage(normalizedAddress, amount, nonce);

      // Parse signature and public key
      // Ensure hex strings have 0x prefix for SDK
      const sigHex = signature.startsWith('0x') ? signature : `0x${signature}`;
      const pkHex = publicKey.startsWith('0x') ? publicKey : `0x${publicKey}`;

      const sig = new sdk.Ed25519Signature(sigHex);
      const pk = new sdk.Ed25519PublicKey(pkHex);

      // Verify signature
      const isValid = pk.verifySignature({ message, signature: sig });

      if (isValid) {
        // Update received claim state for this peer
        this._receivedClaimStates.set(key, {
          highestNonce: nonce,
          latestClaim: {
            channelOwner: normalizedAddress,
            amount,
            nonce,
            signature: signature.replace(/^0x/i, ''),
            publicKey: publicKey.replace(/^0x/i, ''),
            createdAt: Date.now(),
          },
        });

        this._logger.info(
          {
            channelOwner: normalizedAddress,
            amount: amount.toString(),
            nonce,
            peerPublicKey: publicKey,
          },
          'Claim verification succeeded'
        );
      } else {
        this._logger.warn(
          { channelOwner: normalizedAddress, amount: amount.toString(), nonce },
          'Claim verification failed: invalid signature'
        );
      }

      return isValid;
    } catch (error) {
      this._logger.error({ error, channelOwner, nonce }, 'Claim verification error');
      return false;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create AptosClaimSigner from environment variables
 *
 * Convenience factory function for creating an AptosClaimSigner
 * with configuration loaded from environment variables.
 *
 * @param logger - Pino logger instance
 * @returns Configured AptosClaimSigner
 * @throws Error if required environment variables are not set
 */
export async function createAptosClaimSignerFromEnv(logger: Logger): Promise<AptosClaimSigner> {
  const privateKey = process.env.APTOS_CLAIM_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('APTOS_CLAIM_PRIVATE_KEY environment variable is required');
  }

  const config: AptosClaimSignerConfig = {
    privateKey,
  };

  return AptosClaimSigner.create(config, logger);
}

// Export constructClaimMessage for testing purposes
export { constructClaimMessage };
