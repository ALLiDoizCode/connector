/**
 * Aptos Channel SDK
 *
 * High-level SDK for Aptos payment channel lifecycle management.
 * Wraps AptosClient and AptosClaimSigner with channel state caching.
 *
 * Story 27.4: Aptos Payment Channel SDK
 *
 * File: packages/connector/src/settlement/aptos-channel-sdk.ts
 */
import type { Logger } from 'pino';
import type { IAptosClient } from './aptos-client';
import { AptosError, AptosErrorCode, createAptosClientFromEnv } from './aptos-client';
import type { IAptosClaimSigner, AptosClaim } from './aptos-claim-signer';
import { createAptosClaimSignerFromEnv } from './aptos-claim-signer';

// ============================================================================
// Data Models
// ============================================================================

/**
 * Aptos Payment Channel State
 *
 * Represents the on-chain state of an Aptos payment channel.
 * Queried via Move module view function `get_channel(owner)`.
 */
export interface AptosChannelState {
  /**
   * Aptos address of channel owner (0x-prefixed hex)
   * This is the account that opened the channel and deposited funds
   */
  channelOwner: string;

  /**
   * Aptos address of destination (0x-prefixed hex)
   * This is the account that can claim funds from the channel
   */
  destination: string;

  /**
   * ed25519 public key of destination for claim verification
   * Format: hex string (64 characters = 32 bytes)
   */
  destinationPubkey: string;

  /**
   * Total deposited amount in octas (1 APT = 100,000,000 octas)
   */
  deposited: bigint;

  /**
   * Amount already claimed by destination in octas
   * claimed <= deposited always
   */
  claimed: bigint;

  /**
   * Highest nonce of submitted claims
   * New claims must have nonce > this value
   */
  nonce: number;

  /**
   * Settlement delay in seconds
   * Time required between request_close and finalize_close
   */
  settleDelay: number;

  /**
   * Timestamp when close was requested, 0 if not closing
   * Used to enforce settle delay period
   */
  closeRequestedAt: number;

  /**
   * Current channel status
   * - 'open': Active channel, can make claims
   * - 'closing': Close requested, waiting for settle delay
   * - 'closed': Channel finalized and removed
   */
  status: 'open' | 'closing' | 'closed';
}

/**
 * Configuration for AptosChannelSDK
 */
export interface AptosChannelSDKConfig {
  /**
   * Full module path where Move payment channel module is deployed
   * Format: {account_address}::{module_name}
   * Example: 0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a::channel
   */
  moduleAddress: string;

  /**
   * Coin type for payment channels
   * Default: 0x1::aptos_coin::AptosCoin
   * Example: 0x1::aptos_coin::AptosCoin
   */
  coinType?: string;

  /**
   * Auto-refresh interval in milliseconds
   * Default: 30000 (30 seconds)
   */
  refreshIntervalMs?: number;

  /**
   * Default settle delay for new channels in seconds
   * Minimum: 3600 (1 hour) for production
   * Default: 86400 (24 hours)
   */
  defaultSettleDelay?: number;
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Aptos Channel SDK Interface
 *
 * High-level SDK for Aptos payment channel lifecycle management.
 * Wraps AptosClient and AptosClaimSigner with channel state caching.
 */
export interface IAptosChannelSDK {
  /**
   * Open a new payment channel
   *
   * Creates channel by calling Move module `open_channel` entry function.
   * Transfers APT from owner to module, creates Channel resource.
   *
   * @param destination - Aptos address of channel destination (0x-prefixed hex)
   * @param destinationPubkey - ed25519 public key of destination for claim verification
   * @param amount - Initial deposit in octas (bigint)
   * @param settleDelay - Settlement delay in seconds (min 3600 for production)
   * @returns Channel owner address (our address, used as channel identifier)
   */
  openChannel(
    destination: string,
    destinationPubkey: string,
    amount: bigint,
    settleDelay?: number
  ): Promise<string>;

  /**
   * Deposit additional funds to existing channel
   *
   * Calls Move module `deposit` entry function to add APT.
   *
   * @param amount - Additional deposit in octas (bigint)
   */
  deposit(amount: bigint): Promise<void>;

  /**
   * Sign a claim for off-chain settlement
   *
   * Creates AptosClaim using AptosClaimSigner.
   * Nonce auto-incremented based on highest previous nonce.
   *
   * @param channelOwner - Aptos address of channel owner
   * @param amount - Cumulative amount to claim in octas
   * @returns AptosClaim with signature
   */
  signClaim(channelOwner: string, amount: bigint): Promise<AptosClaim>;

  /**
   * Verify a received claim
   *
   * Validates claim signature using AptosClaimSigner.
   *
   * @param claim - AptosClaim to verify
   * @returns true if claim is valid
   */
  verifyClaim(claim: AptosClaim): Promise<boolean>;

  /**
   * Submit claim to chain for redemption
   *
   * Calls Move module `claim` entry function.
   * Updates on-chain channel state with claimed amount.
   *
   * @param claim - AptosClaim to submit
   */
  submitClaim(claim: AptosClaim): Promise<void>;

  /**
   * Request channel closure
   *
   * Calls Move module `request_close` entry function.
   * Starts settle delay countdown.
   *
   * @param channelOwner - Aptos address of channel owner
   */
  requestClose(channelOwner: string): Promise<void>;

  /**
   * Finalize channel closure after settle delay
   *
   * Calls Move module `finalize_close` entry function.
   * Distributes remaining funds and deletes Channel resource.
   *
   * @param channelOwner - Aptos address of channel owner
   */
  finalizeClose(channelOwner: string): Promise<void>;

  /**
   * Get channel state from chain
   *
   * Calls Move module `get_channel` view function.
   * Updates local cache with latest state.
   *
   * @param channelOwner - Aptos address of channel owner
   * @returns AptosChannelState or null if channel doesn't exist
   */
  getChannelState(channelOwner: string): Promise<AptosChannelState | null>;

  /**
   * Get all channels we own
   *
   * Returns list of channel owner addresses from local cache.
   *
   * @returns Array of channel owner addresses
   */
  getMyChannels(): string[];

  /**
   * Start automatic channel refresh
   *
   * Polls chain for channel state changes every refreshIntervalMs.
   * Updates local cache with latest data.
   */
  startAutoRefresh(): void;

  /**
   * Stop automatic channel refresh
   *
   * Clears refresh interval timer.
   * Must be called before SDK disposal to avoid memory leaks.
   */
  stopAutoRefresh(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * AptosChannelSDK Implementation
 *
 * High-level SDK for Aptos payment channel lifecycle management.
 * Wraps AptosClient and AptosClaimSigner with channel state caching.
 *
 * @example
 * const sdk = new AptosChannelSDK(aptosClient, claimSigner, config, logger);
 *
 * // Open channel
 * const channelOwner = await sdk.openChannel('0xdest...', 'pubkey', BigInt(1000000000), 86400);
 *
 * // Sign claim
 * const claim = sdk.signClaim(channelOwner, BigInt(500000000));
 *
 * // Submit claim
 * await sdk.submitClaim(claim);
 *
 * // Close channel (two-phase)
 * await sdk.requestClose(channelOwner);
 * // Wait for settle delay...
 * await sdk.finalizeClose(channelOwner);
 *
 * // Start auto-refresh
 * sdk.startAutoRefresh();
 */
export class AptosChannelSDK implements IAptosChannelSDK {
  private readonly _aptosClient: IAptosClient;
  private readonly _claimSigner: IAptosClaimSigner;
  private readonly _config: AptosChannelSDKConfig;
  private readonly _logger: Logger;
  private readonly _channelStateCache: Map<string, AptosChannelState>;
  private _refreshIntervalId?: NodeJS.Timeout;

  /**
   * Constructor
   *
   * @param aptosClient - Aptos client for blockchain interactions
   * @param claimSigner - Claim signer for off-chain signatures
   * @param config - SDK configuration
   * @param logger - Pino logger instance
   */
  constructor(
    aptosClient: IAptosClient,
    claimSigner: IAptosClaimSigner,
    config: AptosChannelSDKConfig,
    logger: Logger
  ) {
    this._aptosClient = aptosClient;
    this._claimSigner = claimSigner;
    this._config = {
      ...config,
      coinType: config.coinType ?? '0x1::aptos_coin::AptosCoin',
      refreshIntervalMs: config.refreshIntervalMs ?? 30000,
      defaultSettleDelay: config.defaultSettleDelay ?? 86400,
    };
    this._logger = logger.child({ component: 'AptosChannelSDK' });
    this._channelStateCache = new Map();
  }

  /**
   * Normalize Aptos address to lowercase with 0x prefix
   */
  private normalizeAddress(address: string): string {
    const cleaned = address.replace(/^0x/i, '').toLowerCase();
    return `0x${cleaned.padStart(64, '0')}`;
  }

  /**
   * Parse full module path into account address and module name
   * Input: 0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a::channel
   * Returns: { accountAddress: '0xb206...', moduleName: 'channel' }
   */
  private parseModulePath(): { accountAddress: string; moduleName: string } {
    const parts = this._config.moduleAddress.split('::');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new AptosError(
        AptosErrorCode.INVALID_TRANSACTION,
        `Invalid module address format: ${this._config.moduleAddress}. Expected format: {account_address}::{module_name}`
      );
    }
    return {
      accountAddress: parts[0],
      moduleName: parts[1],
    };
  }

  /**
   * Convert hex string to Uint8Array for vector<u8> parameters
   * Input: hex string with or without 0x prefix
   * Returns: Uint8Array
   */
  private hexToBytes(hex: string): number[] {
    const cleanHex = hex.replace(/^0x/i, '');
    const bytes: number[] = [];
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
    }
    return bytes;
  }

  // --------------------------------------------------------------------------
  // Channel Lifecycle Methods
  // --------------------------------------------------------------------------

  async openChannel(
    destination: string,
    destinationPubkey: string,
    amount: bigint,
    settleDelay?: number
  ): Promise<string> {
    const normalizedDestination = this.normalizeAddress(destination);
    const effectiveSettleDelay = settleDelay ?? this._config.defaultSettleDelay!;

    this._logger.info(
      {
        destination: normalizedDestination,
        amount: amount.toString(),
        settleDelay: effectiveSettleDelay,
      },
      'Opening Aptos payment channel...'
    );

    // Build open_channel transaction
    const transaction = await this.buildOpenChannelTransaction(
      normalizedDestination,
      destinationPubkey,
      amount,
      effectiveSettleDelay
    );

    // Submit transaction
    const result = await this._aptosClient.submitTransaction(transaction);

    if (!result.success) {
      throw new AptosError(
        AptosErrorCode.TRANSACTION_FAILED,
        `Failed to open channel: ${result.vmStatus}`
      );
    }

    // Channel owner is our address
    const channelOwner = this.normalizeAddress(this._aptosClient.getAddress());

    // Fetch and cache initial channel state
    const channelState = await this.getChannelState(channelOwner);
    if (channelState) {
      this._channelStateCache.set(channelOwner, channelState);
    }

    this._logger.info(
      { channelOwner, txHash: result.hash },
      'Aptos payment channel opened successfully'
    );

    return channelOwner;
  }

  async deposit(amount: bigint): Promise<void> {
    const channelOwner = this.normalizeAddress(this._aptosClient.getAddress());

    this._logger.info(
      { channelOwner, amount: amount.toString() },
      'Depositing to Aptos payment channel...'
    );

    // Build deposit transaction
    const transaction = await this.buildDepositTransaction(amount);

    // Submit transaction
    const result = await this._aptosClient.submitTransaction(transaction);

    if (!result.success) {
      throw new AptosError(
        AptosErrorCode.TRANSACTION_FAILED,
        `Failed to deposit to channel: ${result.vmStatus}`
      );
    }

    // Refresh channel state cache
    await this.refreshChannelState(channelOwner);

    this._logger.info(
      { channelOwner, amount: amount.toString(), txHash: result.hash },
      'Deposit to Aptos payment channel successful'
    );
  }

  async requestClose(channelOwner: string): Promise<void> {
    const normalizedOwner = this.normalizeAddress(channelOwner);

    this._logger.info({ channelOwner: normalizedOwner }, 'Requesting Aptos channel closure...');

    // Build request_close transaction
    const transaction = await this.buildRequestCloseTransaction(normalizedOwner);

    // Submit transaction
    const result = await this._aptosClient.submitTransaction(transaction);

    if (!result.success) {
      throw new AptosError(
        AptosErrorCode.TRANSACTION_FAILED,
        `Failed to request channel close: ${result.vmStatus}`
      );
    }

    // Update cache status to 'closing'
    const cachedState = this._channelStateCache.get(normalizedOwner);
    if (cachedState) {
      cachedState.status = 'closing';
      cachedState.closeRequestedAt = Math.floor(Date.now() / 1000);
    }

    this._logger.info(
      { channelOwner: normalizedOwner, txHash: result.hash },
      'Aptos channel close requested (settle delay started)'
    );
  }

  async finalizeClose(channelOwner: string): Promise<void> {
    const normalizedOwner = this.normalizeAddress(channelOwner);

    this._logger.info({ channelOwner: normalizedOwner }, 'Finalizing Aptos channel closure...');

    // Build finalize_close transaction
    const transaction = await this.buildFinalizeCloseTransaction(normalizedOwner);

    // Submit transaction
    const result = await this._aptosClient.submitTransaction(transaction);

    if (!result.success) {
      throw new AptosError(
        AptosErrorCode.TRANSACTION_FAILED,
        `Failed to finalize channel close: ${result.vmStatus}`
      );
    }

    // Remove channel from cache
    this._channelStateCache.delete(normalizedOwner);

    this._logger.info(
      { channelOwner: normalizedOwner, txHash: result.hash },
      'Aptos channel finalized and closed'
    );
  }

  // --------------------------------------------------------------------------
  // Claim Operations
  // --------------------------------------------------------------------------

  async signClaim(channelOwner: string, amount: bigint): Promise<AptosClaim> {
    const normalizedOwner = this.normalizeAddress(channelOwner);

    // Get highest nonce from claim signer and auto-increment
    const highestNonce = this._claimSigner.getHighestNonce(normalizedOwner);
    const newNonce = highestNonce + 1;

    this._logger.debug(
      { channelOwner: normalizedOwner, amount: amount.toString(), nonce: newNonce },
      'Signing Aptos claim'
    );

    // Delegate to claim signer
    return this._claimSigner.signClaim(normalizedOwner, amount, newNonce);
  }

  async verifyClaim(claim: AptosClaim): Promise<boolean> {
    this._logger.debug(
      {
        channelOwner: claim.channelOwner,
        amount: claim.amount.toString(),
        nonce: claim.nonce,
      },
      'Verifying Aptos claim'
    );

    // Delegate to claim signer with extracted parameters
    const result = await this._claimSigner.verifyClaim(
      claim.channelOwner,
      claim.amount,
      claim.nonce,
      claim.signature,
      claim.publicKey
    );

    this._logger.debug({ result }, 'Claim verification result');

    return result;
  }

  async submitClaim(claim: AptosClaim): Promise<void> {
    const normalizedOwner = this.normalizeAddress(claim.channelOwner);

    this._logger.info(
      {
        channelOwner: normalizedOwner,
        amount: claim.amount.toString(),
        nonce: claim.nonce,
      },
      'Submitting Aptos claim to chain...'
    );

    // Build claim transaction
    const transaction = await this.buildClaimTransaction(
      normalizedOwner,
      claim.amount,
      claim.nonce,
      claim.signature
    );

    // Submit transaction
    const result = await this._aptosClient.submitTransaction(transaction);

    if (!result.success) {
      throw new AptosError(
        AptosErrorCode.TRANSACTION_FAILED,
        `Failed to submit claim: ${result.vmStatus}`
      );
    }

    // Refresh channel state cache
    await this.refreshChannelState(normalizedOwner);

    this._logger.info(
      { channelOwner: normalizedOwner, txHash: result.hash },
      'Aptos claim submitted successfully'
    );
  }

  // --------------------------------------------------------------------------
  // State Querying and Caching
  // --------------------------------------------------------------------------

  async getChannelState(channelOwner: string): Promise<AptosChannelState | null> {
    const normalizedOwner = this.normalizeAddress(channelOwner);

    this._logger.debug({ channelOwner: normalizedOwner }, 'Querying Aptos channel state...');

    try {
      // Call view function: get_channel(owner) -> (destination, destination_pubkey, deposited, claimed, nonce, settle_delay, close_requested_at)
      const { accountAddress, moduleName } = this.parseModulePath();
      const result = await this._aptosClient.view<
        [string, string, string, string, string, string, string]
      >(accountAddress, moduleName, 'get_channel', [this._config.coinType!], [normalizedOwner]);

      // Parse tuple result
      const [
        destination,
        destinationPubkey,
        deposited,
        claimed,
        nonce,
        settleDelay,
        closeRequestedAt,
      ] = result;

      const closeRequestedAtNum = parseInt(closeRequestedAt, 10);

      const channelState: AptosChannelState = {
        channelOwner: normalizedOwner,
        destination: this.normalizeAddress(destination),
        destinationPubkey,
        deposited: BigInt(deposited),
        claimed: BigInt(claimed),
        nonce: parseInt(nonce, 10),
        settleDelay: parseInt(settleDelay, 10),
        closeRequestedAt: closeRequestedAtNum,
        status: closeRequestedAtNum > 0 ? 'closing' : 'open',
      };

      // Update local cache
      this._channelStateCache.set(normalizedOwner, channelState);

      this._logger.debug(
        {
          channelOwner: normalizedOwner,
          deposited: channelState.deposited.toString(),
          claimed: channelState.claimed.toString(),
          status: channelState.status,
        },
        'Aptos channel state retrieved'
      );

      return channelState;
    } catch (error) {
      // Channel doesn't exist - return null
      if (error instanceof AptosError && error.code === AptosErrorCode.RESOURCE_NOT_FOUND) {
        this._logger.debug({ channelOwner: normalizedOwner }, 'Channel not found');
        return null;
      }

      // Re-throw other errors
      throw error;
    }
  }

  getMyChannels(): string[] {
    return Array.from(this._channelStateCache.keys());
  }

  /**
   * Refresh single channel state (private helper)
   */
  private async refreshChannelState(channelOwner: string): Promise<void> {
    try {
      const channelState = await this.getChannelState(channelOwner);
      if (channelState) {
        this._channelStateCache.set(channelOwner, channelState);
      } else {
        // Channel no longer exists (closed)
        this._channelStateCache.delete(channelOwner);
      }
    } catch (error) {
      this._logger.error({ error, channelOwner }, 'Failed to refresh channel state');
    }
  }

  /**
   * Refresh all channels in cache (private helper)
   */
  private async refreshAllChannels(): Promise<void> {
    const channelOwners = Array.from(this._channelStateCache.keys());
    this._logger.debug({ count: channelOwners.length }, 'Refreshing all Aptos channels...');

    await Promise.all(channelOwners.map((owner) => this.refreshChannelState(owner)));
  }

  // --------------------------------------------------------------------------
  // Auto-Refresh
  // --------------------------------------------------------------------------

  startAutoRefresh(): void {
    if (this._refreshIntervalId) {
      this._logger.warn('Auto-refresh already started');
      return;
    }

    this._logger.info(
      { intervalMs: this._config.refreshIntervalMs },
      'Starting Aptos channel auto-refresh'
    );

    this._refreshIntervalId = setInterval(async () => {
      try {
        await this.refreshAllChannels();
      } catch (error) {
        this._logger.error({ error }, 'Error during channel auto-refresh');
      }
    }, this._config.refreshIntervalMs);
  }

  stopAutoRefresh(): void {
    if (this._refreshIntervalId) {
      clearInterval(this._refreshIntervalId);
      this._refreshIntervalId = undefined;
      this._logger.info('Aptos channel auto-refresh stopped');
    }
  }

  // --------------------------------------------------------------------------
  // Transaction Building (Private Helpers)
  // --------------------------------------------------------------------------

  /**
   * Build open_channel transaction payload
   */
  private buildOpenChannelTransaction(
    destination: string,
    destinationPubkey: string,
    amount: bigint,
    settleDelay: number
  ): unknown {
    // Convert pubkey hex string to byte array for vector<u8> parameter
    const pubkeyBytes = this.hexToBytes(destinationPubkey);

    return {
      function: `${this._config.moduleAddress}::open_channel`,
      typeArguments: [this._config.coinType!],
      functionArguments: [destination, pubkeyBytes, amount.toString(), settleDelay.toString()],
    };
  }

  /**
   * Build deposit transaction payload
   */
  private buildDepositTransaction(amount: bigint): unknown {
    return {
      function: `${this._config.moduleAddress}::deposit`,
      typeArguments: [this._config.coinType!],
      functionArguments: [amount.toString()],
    };
  }

  /**
   * Build claim transaction payload
   */
  private buildClaimTransaction(
    channelOwner: string,
    amount: bigint,
    nonce: number,
    signature: string
  ): unknown {
    return {
      function: `${this._config.moduleAddress}::claim`,
      typeArguments: [this._config.coinType!],
      functionArguments: [channelOwner, amount.toString(), nonce.toString(), signature],
    };
  }

  /**
   * Build request_close transaction payload
   */
  private buildRequestCloseTransaction(channelOwner: string): unknown {
    return {
      function: `${this._config.moduleAddress}::request_close`,
      typeArguments: [this._config.coinType!],
      functionArguments: [channelOwner],
    };
  }

  /**
   * Build finalize_close transaction payload
   */
  private buildFinalizeCloseTransaction(channelOwner: string): unknown {
    return {
      function: `${this._config.moduleAddress}::finalize_close`,
      typeArguments: [this._config.coinType!],
      functionArguments: [channelOwner],
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create AptosChannelSDK from environment variables
 *
 * Convenience factory function for creating an AptosChannelSDK
 * with configuration loaded from environment variables.
 *
 * Required environment variables:
 * - APTOS_MODULE_ADDRESS: Address where Move payment channel module is deployed
 * - APTOS_NODE_URL: Aptos fullnode REST API URL
 * - APTOS_PRIVATE_KEY: Account private key
 * - APTOS_ACCOUNT_ADDRESS: Account address
 * - APTOS_CLAIM_PRIVATE_KEY: Claim signing private key
 *
 * Optional environment variables:
 * - APTOS_CHANNEL_REFRESH_INTERVAL_MS: Auto-refresh interval (default: 30000)
 * - APTOS_DEFAULT_SETTLE_DELAY: Default settle delay in seconds (default: 86400)
 *
 * @param logger - Pino logger instance
 * @returns Configured AptosChannelSDK
 * @throws Error if required environment variables are not set
 */
export async function createAptosChannelSDKFromEnv(logger: Logger): Promise<AptosChannelSDK> {
  const moduleAddress = process.env.APTOS_MODULE_ADDRESS;

  if (!moduleAddress) {
    throw new Error('APTOS_MODULE_ADDRESS environment variable is required');
  }

  // Create dependencies
  const aptosClient = await createAptosClientFromEnv(logger);
  const claimSigner = await createAptosClaimSignerFromEnv(logger);

  // Build SDK config
  const config: AptosChannelSDKConfig = {
    moduleAddress,
    refreshIntervalMs: process.env.APTOS_CHANNEL_REFRESH_INTERVAL_MS
      ? parseInt(process.env.APTOS_CHANNEL_REFRESH_INTERVAL_MS, 10)
      : undefined,
    defaultSettleDelay: process.env.APTOS_DEFAULT_SETTLE_DELAY
      ? parseInt(process.env.APTOS_DEFAULT_SETTLE_DELAY, 10)
      : undefined,
  };

  return new AptosChannelSDK(aptosClient, claimSigner, config, logger);
}

// Export types
export type { AptosClaim } from './aptos-claim-signer';
