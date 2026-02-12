/**
 * Claim Sender - Send payment channel claims to peers via BTP
 *
 * This module implements the claim transport layer for Epic 17 (BTP Off-Chain Claim Exchange).
 * It sends signed payment channel claims over BTP WebSocket connections to enable off-chain
 * settlement without on-chain transactions for every payment.
 *
 * Key Features:
 * - Sends blockchain-specific claims (XRP, EVM, Aptos) via BTP protocolData
 * - Retry logic with exponential backoff (3 attempts: 1s, 2s, 4s delays)
 * - Claim persistence in SQLite for dispute resolution
 * - Telemetry emission for observability
 * - Idempotent message IDs for duplicate detection
 *
 * References:
 * - RFC-0023: Bilateral Transfer Protocol
 * - Epic 17: BTP Off-Chain Claim Exchange Protocol
 * - Story 17.1: BTP Claim Message Protocol Definition
 *
 * @module claim-sender
 */

import type { Database } from 'better-sqlite3';
import { Logger } from 'pino';
import { BTPClient } from '../btp/btp-client';
import {
  BTP_CLAIM_PROTOCOL,
  BTPClaimMessage,
  XRPClaimMessage,
  EVMClaimMessage,
  AptosClaimMessage,
  BlockchainType,
} from '../btp/btp-claim-types';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';

/**
 * Result of a claim send operation
 */
export interface ClaimSendResult {
  /** Whether the claim send was successful */
  success: boolean;
  /** Unique message ID for this claim */
  messageId: string;
  /** ISO 8601 timestamp of the send attempt */
  timestamp: string;
  /** Error message if send failed */
  error?: string;
}

/**
 * ClaimSender handles sending payment channel claims to peers via BTP.
 *
 * It integrates with BTPClient for WebSocket transmission, implements retry logic,
 * persists claims for dispute resolution, and emits telemetry events.
 *
 * The caller (UnifiedSettlementExecutor) is responsible for:
 * 1. Obtaining BTPClient from BTPConnectionManager.getClientForPeer(peerId)
 * 2. Passing BTPClient to sendXRPClaim() / sendEVMClaim() / sendAptosClaim()
 *
 * This separation ensures ClaimSender remains focused on transport, while
 * connection management stays with BTPConnectionManager.
 */
export class ClaimSender {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly telemetryEmitter?: TelemetryEmitter,
    private readonly nodeId?: string
  ) {}

  /**
   * Send an XRP payment channel claim to a peer
   *
   * @param peerId - Peer identifier
   * @param btpClient - BTPClient instance for this peer connection
   * @param channelId - 64-character hex XRP channel ID
   * @param amount - XRP drops as string
   * @param signature - 128-character hex signature
   * @param publicKey - 66-character hex public key (ED prefix)
   * @returns Promise resolving to ClaimSendResult
   *
   * @example
   * ```typescript
   * const result = await claimSender.sendXRPClaim(
   *   'peer-alice',
   *   btpClient,
   *   'a1b2c3d4...',
   *   '1000000',
   *   'abcd1234...',
   *   'ED01234...'
   * );
   * if (result.success) {
   *   logger.info({ messageId: result.messageId }, 'XRP claim sent');
   * }
   * ```
   */
  async sendXRPClaim(
    peerId: string,
    btpClient: BTPClient,
    channelId: string,
    amount: string,
    signature: string,
    publicKey: string
  ): Promise<ClaimSendResult> {
    const messageId = this._generateMessageId('xrp', channelId, undefined);
    const timestamp = new Date().toISOString();

    const claimMessage: XRPClaimMessage = {
      version: '1.0',
      blockchain: 'xrp',
      messageId,
      timestamp,
      senderId: this.nodeId ?? 'unknown',
      channelId,
      amount,
      signature,
      publicKey,
    };

    return this.sendClaim(peerId, btpClient, claimMessage);
  }

  /**
   * Send an EVM payment channel claim to a peer
   *
   * @param peerId - Peer identifier
   * @param btpClient - BTPClient instance for this peer connection
   * @param channelId - bytes32 hex channel ID
   * @param nonce - Balance proof nonce
   * @param transferredAmount - Cumulative transferred amount
   * @param lockedAmount - Locked amount in channel
   * @param locksRoot - Merkle root of locks
   * @param signature - EIP-712 signature
   * @param signerAddress - Ethereum address
   * @returns Promise resolving to ClaimSendResult
   *
   * @example
   * ```typescript
   * const result = await claimSender.sendEVMClaim(
   *   'peer-bob',
   *   btpClient,
   *   '0xabcd...',
   *   42,
   *   '5000000000000000000',
   *   '0',
   *   '0x0000...',
   *   '0x1234...',
   *   '0x5678...'
   * );
   * ```
   */
  async sendEVMClaim(
    peerId: string,
    btpClient: BTPClient,
    channelId: string,
    nonce: number,
    transferredAmount: string,
    lockedAmount: string,
    locksRoot: string,
    signature: string,
    signerAddress: string
  ): Promise<ClaimSendResult> {
    const messageId = this._generateMessageId('evm', channelId, nonce);
    const timestamp = new Date().toISOString();

    const claimMessage: EVMClaimMessage = {
      version: '1.0',
      blockchain: 'evm',
      messageId,
      timestamp,
      senderId: this.nodeId ?? 'unknown',
      channelId,
      nonce,
      transferredAmount,
      lockedAmount,
      locksRoot,
      signature,
      signerAddress,
    };

    return this.sendClaim(peerId, btpClient, claimMessage);
  }

  /**
   * Send an Aptos payment channel claim to a peer
   *
   * @param peerId - Peer identifier
   * @param btpClient - BTPClient instance for this peer connection
   * @param channelOwner - Aptos account address
   * @param amount - Octas as string
   * @param nonce - Balance proof nonce
   * @param signature - ed25519 signature
   * @param publicKey - ed25519 public key
   * @returns Promise resolving to ClaimSendResult
   *
   * @example
   * ```typescript
   * const result = await claimSender.sendAptosClaim(
   *   'peer-charlie',
   *   btpClient,
   *   '0x123...',
   *   '10000000',
   *   5,
   *   'abc123...',
   *   'def456...'
   * );
   * ```
   */
  async sendAptosClaim(
    peerId: string,
    btpClient: BTPClient,
    channelOwner: string,
    amount: string,
    nonce: number,
    signature: string,
    publicKey: string
  ): Promise<ClaimSendResult> {
    const messageId = this._generateMessageId('aptos', channelOwner, nonce);
    const timestamp = new Date().toISOString();

    const claimMessage: AptosClaimMessage = {
      version: '1.0',
      blockchain: 'aptos',
      messageId,
      timestamp,
      senderId: this.nodeId ?? 'unknown',
      channelOwner,
      amount,
      nonce,
      signature,
      publicKey,
    };

    return this.sendClaim(peerId, btpClient, claimMessage);
  }

  /**
   * Core claim sending logic (private method)
   *
   * Handles serialization, retry logic, persistence, and telemetry for all claim types.
   *
   * @param peerId - Peer identifier
   * @param btpClient - BTPClient instance
   * @param claimMessage - Blockchain-specific claim message
   * @returns Promise resolving to ClaimSendResult
   */
  private async sendClaim(
    peerId: string,
    btpClient: BTPClient,
    claimMessage: BTPClaimMessage
  ): Promise<ClaimSendResult> {
    const childLogger = this.logger.child({ peerId, messageId: claimMessage.messageId });

    childLogger.info({ blockchain: claimMessage.blockchain }, 'Sending claim to peer');

    try {
      // Serialize claim to JSON buffer
      const serializedClaim = this._serializeClaimMessage(claimMessage);

      // Send with retry (3 attempts, exponential backoff)
      await this._sendWithRetry(
        btpClient,
        BTP_CLAIM_PROTOCOL.NAME,
        BTP_CLAIM_PROTOCOL.CONTENT_TYPE,
        serializedClaim
      );

      // Persist claim to database
      this._persistSentClaim(peerId, claimMessage.messageId, claimMessage);

      // Emit success telemetry
      this._emitClaimSentTelemetry(peerId, claimMessage, true);

      childLogger.info('Claim sent successfully');

      return {
        success: true,
        messageId: claimMessage.messageId,
        timestamp: claimMessage.timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit failure telemetry
      this._emitClaimSentTelemetry(peerId, claimMessage, false, errorMessage);

      childLogger.error({ error: errorMessage }, 'Failed to send claim');

      return {
        success: false,
        messageId: claimMessage.messageId,
        timestamp: claimMessage.timestamp,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate a unique message ID for claim deduplication
   *
   * Format: `<blockchain>-<channelId-prefix>-<nonce>-<timestamp>`
   *
   * @param blockchain - Blockchain type ('xrp', 'evm', 'aptos')
   * @param channelId - Channel identifier (first 8 chars used as prefix)
   * @param nonce - Optional nonce (undefined for XRP, number for EVM/Aptos)
   * @returns Unique message ID string
   *
   * @example
   * // XRP: xrp-a1b2c3d4-n/a-1706889600000
   * // EVM: evm-0xabcdef-42-1706889600000
   * // Aptos: aptos-0x123456-5-1706889600000
   */
  private _generateMessageId(
    blockchain: BlockchainType,
    channelId: string,
    nonce: number | undefined
  ): string {
    const prefix = channelId.substring(0, 8);
    const nonceStr = nonce !== undefined ? nonce.toString() : 'n/a';
    const timestamp = Date.now();
    return `${blockchain}-${prefix}-${nonceStr}-${timestamp}`;
  }

  /**
   * Extract claim amount for telemetry
   *
   * @param claim - BTP claim message
   * @returns Amount as string
   */
  private _getClaimAmount(claim: BTPClaimMessage): string {
    if (claim.blockchain === 'xrp' || claim.blockchain === 'aptos') {
      return claim.amount;
    } else {
      // EVM uses transferredAmount
      return claim.transferredAmount;
    }
  }

  /**
   * Serialize claim message to JSON buffer for BTP transmission
   *
   * @param claimMessage - Claim message to serialize
   * @returns Buffer containing JSON-encoded claim
   */
  private _serializeClaimMessage(claimMessage: BTPClaimMessage): Buffer {
    const json = JSON.stringify(claimMessage);
    return Buffer.from(json, 'utf8');
  }

  /**
   * Send claim with retry logic and exponential backoff
   *
   * Retry strategy:
   * - Attempt 1: Immediate send
   * - Attempt 2: Wait 1s, retry
   * - Attempt 3: Wait 2s, retry
   * - Attempt 4: Wait 4s, retry (if maxAttempts=4)
   *
   * @param btpClient - BTPClient instance
   * @param protocolName - Protocol name (payment-channel-claim)
   * @param contentType - Content type (1 for JSON)
   * @param data - Serialized claim data
   * @param maxAttempts - Maximum retry attempts (default: 3)
   * @throws Error if all attempts fail
   */
  private async _sendWithRetry(
    btpClient: BTPClient,
    protocolName: string,
    contentType: number,
    data: Buffer,
    maxAttempts: number = 3
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await btpClient.sendProtocolData(protocolName, contentType, data);
        return; // Success
      } catch (error) {
        if (attempt === maxAttempts) {
          // Final attempt failed
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        this.logger.warn({ attempt, maxAttempts, delay }, 'Retrying claim send');

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Persist sent claim to database for dispute resolution
   *
   * Stores claim in `sent_claims` table with:
   * - message_id (PRIMARY KEY)
   * - peer_id
   * - blockchain ('xrp', 'evm', 'aptos')
   * - claim_data (JSON-encoded claim)
   * - sent_at (Unix timestamp ms)
   *
   * Handles duplicate message IDs gracefully (UNIQUE constraint violation).
   *
   * @param peerId - Peer identifier
   * @param messageId - Unique message ID
   * @param claim - Claim message to persist
   */
  private _persistSentClaim(peerId: string, messageId: string, claim: BTPClaimMessage): void {
    try {
      this.db
        .prepare(
          `
        INSERT INTO sent_claims (
          message_id, peer_id, blockchain, claim_data, sent_at
        ) VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(messageId, peerId, claim.blockchain, JSON.stringify(claim), Date.now());
    } catch (error) {
      // Handle duplicate message IDs (idempotency)
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        this.logger.warn({ messageId, peerId }, 'Duplicate claim message ID, skipping insert');
      } else {
        // Log other database errors but don't block send
        this.logger.error({ error, messageId, peerId }, 'Failed to persist claim to database');
      }
    }
  }

  /**
   * Emit telemetry event for claim send attempt
   *
   * Wraps emit() in try-catch to prevent telemetry failures from blocking claim sends.
   *
   * @param peerId - Peer identifier
   * @param claim - Claim message
   * @param success - Whether send was successful
   * @param error - Optional error message
   */
  private _emitClaimSentTelemetry(
    peerId: string,
    claim: BTPClaimMessage,
    success: boolean,
    error?: string
  ): void {
    if (!this.telemetryEmitter) {
      return;
    }

    try {
      this.telemetryEmitter.emit({
        type: 'CLAIM_SENT',
        nodeId: this.nodeId ?? 'unknown',
        peerId,
        blockchain: claim.blockchain,
        messageId: claim.messageId,
        amount: this._getClaimAmount(claim),
        success,
        error,
        timestamp: new Date().toISOString(),
      });
    } catch (emitError) {
      // Non-blocking: log telemetry emission errors
      this.logger.error(
        { error: emitError, messageId: claim.messageId },
        'Failed to emit claim telemetry'
      );
    }
  }
}
