/**
 * Unified Settlement Executor
 *
 * Routes settlement operations to appropriate settlement method (EVM, XRP, or Aptos)
 * based on peer configuration and token type.
 *
 * This executor listens for SETTLEMENT_REQUIRED events from SettlementMonitor
 * and determines whether to settle via:
 * - PaymentChannelSDK (EVM payment channels - Epic 8)
 * - PaymentChannelManager (XRP payment channels - Epic 9)
 * - AptosChannelSDK (Aptos payment channels - Epic 27)
 *
 * Settlement routing logic:
 * - XRP token + peer allows XRP → XRP settlement
 * - ERC20 token + peer allows EVM → EVM settlement
 * - APT token + peer allows Aptos → Aptos settlement
 * - Incompatible combinations → Error
 *
 * Epic 17 Integration (BTP Off-Chain Claim Exchange):
 * - After signing claims, sends them to peers via BTP using ClaimSender
 * - Retrieves BTPClient instances from BTPClientManager for peer connections
 * - Handles claim send failures gracefully (logs error, allows retry)
 * - Settlement completes only after claim successfully delivered to peer
 *
 * @module settlement/unified-settlement-executor
 */

import type { Logger } from 'pino';
import type { PaymentChannelSDK } from './payment-channel-sdk';
import type { PaymentChannelManager } from './xrp-channel-manager';
import type { ClaimSigner } from './xrp-claim-signer';
import type { SettlementMonitor } from './settlement-monitor';
import type { AccountManager } from './account-manager';
import type { PeerConfig, SettlementRequiredEvent, UnifiedSettlementExecutorConfig } from './types';
import type { IAptosChannelSDK } from './aptos-channel-sdk';
import type { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import type { AptosSettlementTelemetryEvent } from '@agent-runtime/shared';
import type { ClaimSender } from './claim-sender';
import type { BTPClientManager } from '../btp/btp-client-manager';
import type { BTPClient } from '../btp/btp-client';

/**
 * Error thrown when settlement is disabled via feature flag
 */
export class SettlementDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementDisabledError';
  }
}

/**
 * UnifiedSettlementExecutor Class
 *
 * Orchestrates tri-chain settlement routing between EVM, XRP, and Aptos ledgers.
 * Integrates with TigerBeetle accounting layer for unified balance tracking.
 */
export class UnifiedSettlementExecutor {
  private readonly boundHandleSettlement: (event: SettlementRequiredEvent) => Promise<void>;
  private readonly _aptosChannelSDK: IAptosChannelSDK | null;
  private readonly _telemetryEmitter: TelemetryEmitter | null;
  private readonly _claimSender: ClaimSender;
  private readonly _btpClientManager: BTPClientManager;

  /**
   * Constructor - Extended for Aptos support and Epic 17 claim exchange
   *
   * @param config - Unified settlement configuration with peer preferences
   * @param evmChannelSDK - PaymentChannelSDK for EVM settlements (Epic 8)
   * @param xrpChannelManager - PaymentChannelManager for XRP settlements (Epic 9)
   * @param xrpClaimSigner - ClaimSigner for XRP claim generation
   * @param aptosChannelSDK - AptosChannelSDK for Aptos settlements (Epic 27), null for backward compatibility
   * @param claimSender - ClaimSender for off-chain claim delivery via BTP (Epic 17)
   * @param btpClientManager - BTPClientManager for peer connection lookup (Epic 17)
   * @param settlementMonitor - Settlement monitor emitting SETTLEMENT_REQUIRED events
   * @param accountManager - TigerBeetle account manager for balance updates
   * @param telemetryEmitter - Optional TelemetryEmitter for settlement events
   * @param logger - Pino logger instance
   */
  constructor(
    private config: UnifiedSettlementExecutorConfig,
    private evmChannelSDK: PaymentChannelSDK,
    private xrpChannelManager: PaymentChannelManager,
    private xrpClaimSigner: ClaimSigner,
    aptosChannelSDK: IAptosChannelSDK | null,
    claimSender: ClaimSender,
    btpClientManager: BTPClientManager,
    private settlementMonitor: SettlementMonitor,
    private accountManager: AccountManager,
    telemetryEmitter: TelemetryEmitter | null,
    private logger: Logger
  ) {
    this._aptosChannelSDK = aptosChannelSDK;
    this._claimSender = claimSender;
    this._btpClientManager = btpClientManager;
    this._telemetryEmitter = telemetryEmitter;
    // Bind handler once in constructor (Event Listener Cleanup pattern)
    // This ensures same reference is used in both on() and off() calls
    this.boundHandleSettlement = this.handleSettlement.bind(this);
  }

  /**
   * Start settlement executor
   *
   * Registers listener for SETTLEMENT_REQUIRED events from SettlementMonitor.
   * Settlement routing begins after start() is called.
   */
  start(): void {
    this.logger.info('Starting UnifiedSettlementExecutor...');
    this.settlementMonitor.on('SETTLEMENT_REQUIRED', this.boundHandleSettlement);
    this.logger.info('UnifiedSettlementExecutor started');
  }

  /**
   * Add a peer's settlement configuration at runtime
   *
   * Stores the PeerConfig in the executor's peers Map for settlement routing.
   * Called by the Admin API when a peer is registered with settlement config.
   *
   * @param peerConfig - Settlement configuration for the peer
   */
  addPeerConfig(peerConfig: PeerConfig): void {
    this.config.peers.set(peerConfig.peerId, peerConfig);
    this.logger.info(
      { peerId: peerConfig.peerId, preference: peerConfig.settlementPreference },
      'Added peer settlement config'
    );
  }

  /**
   * Remove a peer's settlement configuration at runtime
   *
   * Removes the PeerConfig from the executor's peers Map.
   * Called by the Admin API when a peer is deleted.
   *
   * @param peerId - Peer identifier to remove
   * @returns true if the peer config existed and was removed
   */
  removePeerConfig(peerId: string): boolean {
    const existed = this.config.peers.delete(peerId);
    if (existed) {
      this.logger.info({ peerId }, 'Removed peer settlement config');
    }
    return existed;
  }

  /**
   * Get a peer's settlement configuration
   *
   * @param peerId - Peer identifier to look up
   * @returns PeerConfig if found, undefined otherwise
   */
  getPeerConfig(peerId: string): PeerConfig | undefined {
    return this.config.peers.get(peerId);
  }

  /**
   * Get all peer settlement configurations
   *
   * @returns Map of peerId to PeerConfig
   */
  getAllPeerConfigs(): Map<string, PeerConfig> {
    return this.config.peers;
  }

  /**
   * Stop settlement executor
   *
   * Unregisters listener and stops settlement processing.
   * Ensures proper cleanup of event handlers.
   */
  stop(): void {
    this.logger.info('Stopping UnifiedSettlementExecutor...');
    this.settlementMonitor.off('SETTLEMENT_REQUIRED', this.boundHandleSettlement);
    this.logger.info('UnifiedSettlementExecutor stopped');
  }

  /**
   * Check if Aptos settlement is enabled via feature flag
   *
   * @returns true if Aptos settlement is enabled (default), false if disabled
   */
  private isAptosEnabled(): boolean {
    return process.env.APTOS_SETTLEMENT_ENABLED !== 'false';
  }

  /**
   * Get BTPClient instance for a peer (Epic 17)
   *
   * Retrieves active BTP connection for peer from BTPClientManager.
   * Validates connection state before returning client.
   *
   * @param peerId - Peer identifier
   * @returns BTPClient instance for peer
   * @throws Error if peer not connected or connection inactive
   */
  private getBTPClientForPeer(peerId: string): BTPClient {
    const client = this._btpClientManager.getClientForPeer(peerId);
    if (!client) {
      const error = `No BTP connection to peer ${peerId}`;
      this.logger.error({ peerId }, error);
      throw new Error(error);
    }

    if (!this._btpClientManager.isConnected(peerId)) {
      const error = `BTP connection to peer ${peerId} is not active`;
      this.logger.error({ peerId }, error);
      throw new Error(error);
    }

    return client;
  }

  /**
   * Handle settlement required event (private)
   *
   * Routes settlement to appropriate method based on peer config and token type.
   * Updates TigerBeetle accounts after successful settlement.
   *
   * @param event - Settlement required event from SettlementMonitor
   * @throws Error if no compatible settlement method found
   */
  private async handleSettlement(event: SettlementRequiredEvent): Promise<void> {
    const { peerId, balance, tokenId } = event;

    this.logger.info({ peerId, balance, tokenId }, 'Handling settlement request...');

    // Get peer configuration
    const peerConfig = this.config.peers.get(peerId);
    if (!peerConfig) {
      this.logger.error({ peerId }, 'Peer configuration not found');
      throw new Error(`Peer configuration not found for peerId: ${peerId}`);
    }

    // Route to appropriate settlement method
    try {
      // Determine token type
      const isXRPToken = tokenId === 'XRP';
      const isAPTToken = tokenId === 'APT';

      // Normalize 'both' to 'any' for backward compatibility
      const preference =
        peerConfig.settlementPreference === 'both' ? 'any' : peerConfig.settlementPreference;

      // Determine which settlement methods are available
      const canUseXRP = preference === 'xrp' || preference === 'any';
      const canUseEVM = preference === 'evm' || preference === 'any';
      const canUseAptos = preference === 'aptos' || preference === 'any';

      // Route APT token to Aptos settlement
      if (isAPTToken) {
        if (!canUseAptos) {
          throw new Error(
            `No compatible settlement method for peer ${peerId} with token ${tokenId} (preference: ${preference})`
          );
        }
        // Check feature flag
        if (!this.isAptosEnabled()) {
          this.logger.warn({ peerId, tokenId }, 'Aptos settlement disabled, skipping');
          throw new SettlementDisabledError('Aptos settlement is currently disabled');
        }
        // Check SDK availability
        if (!this._aptosChannelSDK) {
          throw new Error('AptosChannelSDK not configured');
        }
        await this.settleViaAptos(peerId, balance, peerConfig);
      } else if (isXRPToken) {
        // Route XRP token to XRP settlement
        if (!canUseXRP) {
          throw new Error(
            `No compatible settlement method for peer ${peerId} with token ${tokenId} (preference: ${preference})`
          );
        }
        await this.settleViaXRP(peerId, balance, peerConfig);
      } else {
        // Route ERC20 tokens to EVM settlement
        if (!canUseEVM) {
          throw new Error(
            `No compatible settlement method for peer ${peerId} with token ${tokenId} (preference: ${preference})`
          );
        }
        await this.settleViaEVM(peerId, balance, tokenId, peerConfig);
      }

      // Update TigerBeetle accounts (unified accounting layer)
      await this.accountManager.recordSettlement(peerId, tokenId, BigInt(balance));

      this.logger.info({ peerId, balance, tokenId }, 'Settlement completed successfully');
    } catch (error) {
      this.logger.error({ error, peerId, balance, tokenId }, 'Settlement failed');
      throw error;
    }
  }

  /**
   * Settle via EVM payment channels (private)
   *
   * Routes settlement to PaymentChannelSDK (Epic 8).
   * For MVP: Opens new channel with initial deposit for settlement.
   * Future: Channel reuse and cooperative settlement (deferred to future story).
   *
   * @param peerId - Peer identifier
   * @param amount - Amount to settle (string for bigint)
   * @param tokenAddress - ERC20 token contract address
   * @param config - Peer configuration
   */
  private async settleViaEVM(
    peerId: string,
    amount: string,
    tokenAddress: string,
    config: PeerConfig
  ): Promise<void> {
    this.logger.info({ peerId, amount, tokenAddress }, 'Settling via EVM payment channel...');

    if (!config.evmAddress) {
      throw new Error(`Peer ${peerId} missing evmAddress for EVM settlement`);
    }

    // For MVP: Open new channel with settlement amount as initial deposit
    // Default settlement timeout: 86400 seconds (24 hours)
    const settlementTimeout = 86400;
    const depositAmount = BigInt(amount);

    this.logger.info(
      {
        peerId,
        peerAddress: config.evmAddress,
        depositAmount: depositAmount.toString(),
        settlementTimeout,
      },
      'Opening new EVM payment channel for settlement...'
    );

    const { channelId } = await this.evmChannelSDK.openChannel(
      config.evmAddress,
      tokenAddress,
      settlementTimeout,
      depositAmount
    );

    // Sign balance proof for settlement amount
    const nonce = 1; // Initial nonce for new channel
    const signature = await this.evmChannelSDK.signBalanceProof(
      channelId,
      nonce,
      depositAmount,
      0n,
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    );
    const signerAddress = await this.evmChannelSDK.getSignerAddress();

    // Send balance proof to peer via BTP (Epic 17)
    try {
      const btpClient = this.getBTPClientForPeer(peerId);

      const result = await this._claimSender.sendEVMClaim(
        peerId,
        btpClient,
        channelId,
        nonce,
        depositAmount.toString(),
        '0',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        signature,
        signerAddress
      );

      if (!result.success) {
        throw new Error(`Failed to send EVM claim to peer: ${result.error}`);
      }

      this.logger.info(
        {
          peerId,
          channelId,
          amount,
          messageId: result.messageId,
        },
        'EVM claim sent to peer successfully'
      );
    } catch (error) {
      this.logger.error({ error, peerId, channelId, amount }, 'Failed to send EVM claim');
      throw error;
    }

    this.logger.info({ peerId, channelId, amount }, 'EVM settlement completed');
  }

  /**
   * Settle via XRP payment channels (private)
   *
   * Routes settlement to PaymentChannelManager (Epic 9).
   * Creates channel if needed, signs claim, sends claim to peer off-chain.
   *
   * @param peerId - Peer identifier
   * @param amount - Amount to settle (XRP drops as string)
   * @param config - Peer configuration
   */
  private async settleViaXRP(peerId: string, amount: string, config: PeerConfig): Promise<void> {
    this.logger.info({ peerId, amount }, 'Settling via XRP payment channel...');

    if (!config.xrpAddress) {
      throw new Error(`Peer ${peerId} missing xrpAddress for XRP settlement`);
    }

    // Find or create XRP payment channel
    const channelId = await this.findOrCreateXRPChannel(config.xrpAddress, amount);

    // Sign claim for amount
    const signature = await this.xrpClaimSigner.signClaim(channelId, amount);
    const publicKey = await this.xrpClaimSigner.getPublicKey();

    // Send claim to peer via BTP (Epic 17)
    try {
      const btpClient = this.getBTPClientForPeer(peerId);

      const result = await this._claimSender.sendXRPClaim(
        peerId,
        btpClient,
        channelId,
        amount,
        signature,
        publicKey
      );

      if (!result.success) {
        throw new Error(`Failed to send XRP claim to peer: ${result.error}`);
      }

      this.logger.info(
        {
          peerId,
          channelId,
          amount,
          messageId: result.messageId,
        },
        'XRP claim sent to peer successfully'
      );
    } catch (error) {
      this.logger.error({ error, peerId, channelId, amount }, 'Failed to send XRP claim');
      throw error;
    }

    this.logger.info({ peerId, channelId, amount }, 'XRP settlement completed');
  }

  /**
   * Find or create XRP payment channel (private helper)
   *
   * Queries database for existing channel with peer.
   * Creates new channel if none exists.
   *
   * @param destination - XRP Ledger destination address
   * @param amount - Required channel capacity (drops)
   * @returns Channel ID (64-char hex)
   */
  private async findOrCreateXRPChannel(destination: string, amount: string): Promise<string> {
    // Query existing channels for destination
    // For MVP, always create new channel (channel reuse deferred to future story)
    // Default settle delay: 86400 seconds (24 hours)
    const settleDelay = 86400;

    this.logger.info({ destination, amount, settleDelay }, 'Creating new XRP payment channel...');

    const channelId = await this.xrpChannelManager.createChannel(destination, amount, settleDelay);

    this.logger.info({ channelId, destination }, 'XRP payment channel created');

    return channelId;
  }

  /**
   * Settle via Aptos payment channels (private)
   *
   * Routes settlement to AptosChannelSDK (Epic 27).
   * Opens new channel if needed, signs claim, updates accounting.
   *
   * @param peerId - Peer identifier
   * @param amount - Amount to settle in octas (string for bigint)
   * @param config - Peer configuration with aptosAddress and aptosPubkey
   */
  private async settleViaAptos(peerId: string, amount: string, config: PeerConfig): Promise<void> {
    this.logger.info({ peerId, amount }, 'Settling via Aptos payment channel...');

    if (!config.aptosAddress) {
      throw new Error(`Peer ${peerId} missing aptosAddress for Aptos settlement`);
    }

    if (!config.aptosPubkey) {
      throw new Error(`Peer ${peerId} missing aptosPubkey for Aptos settlement`);
    }

    try {
      // Find or create Aptos payment channel
      const channelOwner = await this.findOrCreateAptosChannel(
        config.aptosAddress,
        config.aptosPubkey,
        amount
      );

      // Sign claim for amount
      const claim = this._aptosChannelSDK!.signClaim(channelOwner, BigInt(amount));

      // Send claim to peer via BTP (Epic 17)
      const btpClient = this.getBTPClientForPeer(peerId);

      const result = await this._claimSender.sendAptosClaim(
        peerId,
        btpClient,
        channelOwner,
        amount,
        claim.nonce,
        claim.signature,
        claim.publicKey
      );

      if (!result.success) {
        throw new Error(`Failed to send Aptos claim to peer: ${result.error}`);
      }

      this.logger.info(
        {
          peerId,
          channelOwner,
          amount,
          nonce: claim.nonce,
          messageId: result.messageId,
        },
        'Aptos claim sent to peer successfully'
      );

      // Emit telemetry for claim signed
      this.emitAptosTelemetry({
        type: 'APTOS_CLAIM_SIGNED',
        channelOwner,
        amount,
        nonce: claim.nonce,
        timestamp: Date.now(),
      });

      // Emit telemetry for settlement completed
      this.emitAptosTelemetry({
        type: 'APTOS_SETTLEMENT_COMPLETED',
        peerId,
        amount,
        channelOwner,
        timestamp: Date.now(),
      });

      this.logger.info({ peerId, channelOwner, amount }, 'Aptos settlement completed');
    } catch (error) {
      // Emit telemetry for settlement failed
      this.emitAptosTelemetry({
        type: 'APTOS_SETTLEMENT_FAILED',
        peerId,
        amount,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  /**
   * Find or create Aptos payment channel (private helper)
   *
   * Checks local SDK cache for existing channel.
   * Creates new channel if none exists.
   *
   * @param destination - Aptos destination address (0x-prefixed)
   * @param destinationPubkey - Destination ed25519 public key
   * @param amount - Required channel capacity (octas)
   * @returns Channel owner address (used as channel identifier)
   */
  private async findOrCreateAptosChannel(
    destination: string,
    destinationPubkey: string,
    amount: string
  ): Promise<string> {
    // Check existing channels in SDK cache
    const existingChannels = this._aptosChannelSDK!.getMyChannels();

    // For MVP, look for any existing channel (channel selection strategy deferred)
    // In future: Match by destination address
    if (existingChannels.length > 0) {
      const existingOwner = existingChannels[0]!;
      this.logger.info(
        { channelOwner: existingOwner, destination },
        'Reusing existing Aptos channel'
      );
      return existingOwner;
    }

    // Create new channel if none exists
    // Default settle delay: 86400 seconds (24 hours)
    const settleDelay = 86400;
    const depositAmount = BigInt(amount);

    this.logger.info({ destination, amount, settleDelay }, 'Creating new Aptos payment channel...');

    const channelOwner = await this._aptosChannelSDK!.openChannel(
      destination,
      destinationPubkey,
      depositAmount,
      settleDelay
    );

    // Emit telemetry for channel opened
    this.emitAptosTelemetry({
      type: 'APTOS_CHANNEL_OPENED',
      channelOwner,
      destination,
      amount,
      settleDelay,
      timestamp: Date.now(),
    });

    this.logger.info({ channelOwner, destination }, 'Aptos payment channel created');

    return channelOwner;
  }

  /**
   * Emit Aptos telemetry event (private helper)
   *
   * Guards telemetry emission with null check.
   * Uses try-catch to prevent telemetry errors from affecting settlement.
   *
   * @param event - Aptos telemetry event to emit
   */
  private emitAptosTelemetry(event: AptosSettlementTelemetryEvent): void {
    if (!this._telemetryEmitter) {
      return;
    }

    try {
      // TelemetryEmitter.emit() takes a single event parameter
      // Cast to any since TelemetryEvent union may not include Aptos types yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._telemetryEmitter.emit(event as any);
    } catch (error) {
      // Non-blocking: log but don't throw
      this.logger.warn({ error, eventType: event.type }, 'Failed to emit Aptos telemetry');
    }
  }
}
