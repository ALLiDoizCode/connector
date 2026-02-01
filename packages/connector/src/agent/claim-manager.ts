import type { Logger } from 'pino';
import type { PaymentChannelSDK } from '../settlement/payment-channel-sdk';
import type { ClaimSigner } from '../settlement/xrp-claim-signer';
import type { AptosClaimSigner } from '../settlement/aptos-claim-signer';
import type { ClaimStore } from './claim-store';
import type { ClaimEventBuilder } from './claim-event-builder';
import type { ClaimEventParser } from './claim-event-parser';
import type {
  SignedClaim,
  EVMSignedClaim,
  XRPSignedClaim,
  AptosSignedClaim,
  ClaimRequest,
  ClaimChain,
  NostrClaimEvent,
} from '@m2m/shared';

/**
 * Agent's blockchain wallet addresses across all supported chains.
 * Used to identify which private key to use for signing and to verify peer addresses.
 */
export interface WalletAddresses {
  evm?: string; // Ethereum address (0x... format, 42 chars)
  xrp?: string; // XRP Ledger address (r... format, classic address)
  aptos?: string; // Aptos address (0x... format, 66 chars)
}

/**
 * Result object from processReceivedClaimEvent() containing all processing outcomes.
 * Enables caller to know which claims were stored, generate response events with signed responses,
 * and log errors for debugging without breaking packet flow.
 */
export interface ProcessClaimResult {
  signedClaims: SignedClaim[]; // Valid claims that were stored
  unsignedRequests: ClaimRequest[]; // Unsigned requests extracted from event
  signedResponses: SignedClaim[]; // Signed responses for peer's requests
  errors: string[]; // Non-fatal errors encountered
}

/**
 * ClaimManager orchestrates claim generation, verification, and storage using existing signers.
 * This orchestration layer ties together signing, verification, storage, and event handling.
 *
 * Key responsibilities:
 * - Generate signed claims for outgoing packets (using chain-specific signers)
 * - Verify received claims against expected peer addresses
 * - Reject invalid signatures and stale nonces/amounts
 * - Store valid claims in SQLite via ClaimStore
 * - Handle all errors gracefully (never throw exceptions that break packet flow)
 *
 * Design principles:
 * - Graceful degradation: claim processing failures don't break packet handling
 * - No exceptions in public API: all methods catch exceptions and return null or result objects
 * - Chain-specific logic: use discriminated unions and type guards
 * - Dependency injection: all dependencies passed to constructor
 * - Stateless: no internal caching, supports concurrent instances
 */
export class ClaimManager {
  constructor(
    private readonly paymentChannelSDK: PaymentChannelSDK, // EVM claim signer (Epic 8, async methods)
    private readonly xrpClaimSigner: ClaimSigner, // XRP claim signer (Epic 9, async methods)
    private readonly aptosClaimSigner: AptosClaimSigner, // Aptos claim signer (Epic 27, sync methods)
    private readonly claimStore: ClaimStore, // SQLite persistence (Story 30.3, sync methods)
    private readonly claimEventBuilder: ClaimEventBuilder, // Event construction (Story 30.2)
    private readonly claimEventParser: ClaimEventParser, // Event parsing (Story 30.2)
    private readonly walletAddresses: WalletAddresses, // Agent's own addresses (EVM, XRP, Aptos)
    private readonly logger: Logger // Pino logger instance
  ) {}

  /**
   * Generate a signed claim for a peer on a specific chain.
   * Used for outgoing packets (Story 30.5).
   *
   * @param peerId - Nostr public key of the peer
   * @param chain - Blockchain chain ('evm', 'xrp', or 'aptos')
   * @param channelId - Channel identifier (format depends on chain)
   * @param amount - Claim amount in smallest unit (wei, drops, octas)
   * @param nonce - Nonce for EVM/Aptos (optional for XRP, which uses amount for monotonicity)
   * @returns SignedClaim object or null if generation fails
   */
  async generateClaimForPeer(
    peerId: string,
    chain: ClaimChain,
    channelId: string,
    amount: bigint,
    nonce?: number
  ): Promise<SignedClaim | null> {
    try {
      let signedClaim: SignedClaim | null = null;

      switch (chain) {
        case 'evm': {
          if (!this.walletAddresses.evm) {
            this.logger.warn({ peerId, chain }, 'EVM address not configured');
            return null;
          }
          if (nonce === undefined) {
            this.logger.warn({ peerId, chain }, 'Nonce required for EVM claims');
            return null;
          }

          // Sign EVM balance proof (async)
          const signature = await this.paymentChannelSDK.signBalanceProof(
            channelId,
            nonce,
            amount, // transferredAmount
            0n, // lockedAmount (0 for simple claims)
            '0x' + '0'.repeat(64) // locksRoot (0x000... for simple claims)
          );

          signedClaim = {
            chain: 'evm',
            channelId,
            transferredAmount: amount,
            nonce,
            lockedAmount: 0n,
            locksRoot: '0x' + '0'.repeat(64),
            signature,
            signer: this.walletAddresses.evm,
          } as EVMSignedClaim;
          break;
        }

        case 'xrp': {
          if (!this.walletAddresses.xrp) {
            this.logger.warn({ peerId, chain }, 'XRP address not configured');
            return null;
          }

          // Sign XRP claim (async) - signClaim expects number for amount parameter
          const signature = await this.xrpClaimSigner.signClaim(channelId, amount.toString());

          // Get public key (async)
          const publicKey = await this.xrpClaimSigner.getPublicKey();

          signedClaim = {
            chain: 'xrp',
            channelId,
            amount,
            signature,
            signer: publicKey, // XRP uses public key as signer
          } as XRPSignedClaim;
          break;
        }

        case 'aptos': {
          if (!this.walletAddresses.aptos) {
            this.logger.warn({ peerId, chain }, 'Aptos address not configured');
            return null;
          }
          if (nonce === undefined) {
            this.logger.warn({ peerId, chain }, 'Nonce required for Aptos claims');
            return null;
          }

          // Sign Aptos claim (synchronous, returns AptosClaim object)
          const aptosClaim = this.aptosClaimSigner.signClaim(
            this.walletAddresses.aptos, // channelOwner
            amount,
            nonce
          );

          signedClaim = {
            chain: 'aptos',
            channelOwner: this.walletAddresses.aptos,
            amount,
            nonce,
            signature: aptosClaim.signature,
            signer: aptosClaim.publicKey, // Public key already included in AptosClaim
          } as AptosSignedClaim;
          break;
        }

        default:
          this.logger.warn({ peerId, chain }, 'Unknown chain type');
          return null;
      }

      this.logger.info(
        { peerId, chain, channelId, amount: amount.toString(), nonce },
        'Claim generated'
      );

      return signedClaim;
    } catch (error) {
      // Signer exceptions must be caught and logged
      this.logger.error(
        { peerId, chain, channelId, error: (error as Error).message },
        'Failed to generate claim'
      );
      return null;
    }
  }

  /**
   * Generate a Nostr claim event wrapping content with signed claims and unsigned requests.
   * Used for outgoing packets (Story 30.5).
   *
   * @param peerId - Nostr public key of the peer
   * @param content - Message content to wrap
   * @param claimsToInclude - Signed claims to include in event (multi-chain support)
   * @param requestsForPeer - Unsigned requests for peer to sign
   * @returns NostrClaimEvent or null if event creation fails
   */
  async generateClaimEventForPeer(
    peerId: string,
    content: string,
    claimsToInclude: SignedClaim[],
    requestsForPeer: ClaimRequest[]
  ): Promise<NostrClaimEvent | null> {
    try {
      if (claimsToInclude.length === 0) {
        this.logger.warn({ peerId }, 'No claims to include in event');
        return null;
      }

      // Select primary claim (first in claimsToInclude array) for event kind
      const primaryClaim = claimsToInclude[0]!; // Safe: length check above ensures this exists

      // Combine all unsigned requests (both additional claims as unsigned and actual requests)
      const allRequests: ClaimRequest[] = [
        ...requestsForPeer,
        // Note: wrapContent doesn't support multiple signed claims directly
        // Multi-chain support would require extending ClaimEventBuilder
      ];

      // Use ClaimEventBuilder to create claim event
      const claimEvent = this.claimEventBuilder.wrapContent(content, primaryClaim, allRequests);

      this.logger.info(
        {
          peerId,
          claimCount: claimsToInclude.length,
          requestCount: requestsForPeer.length,
        },
        'Claim event created'
      );

      return claimEvent;
    } catch (error) {
      // Builder errors must be handled gracefully
      this.logger.error(
        { peerId, error: (error as Error).message },
        'Failed to create claim event'
      );
      return null;
    }
  }

  /**
   * Verify a claim signature against the expected signer address/public key.
   * Dispatches to chain-specific verification based on claim.chain discriminator.
   *
   * @param claim - Signed claim to verify
   * @param expectedSigner - Expected signer address (EVM) or public key (XRP/Aptos)
   * @returns true if signature is valid, false otherwise
   */
  async verifyClaimSignature(claim: SignedClaim, expectedSigner: string): Promise<boolean> {
    try {
      switch (claim.chain) {
        case 'evm': {
          const evmClaim = claim as EVMSignedClaim;
          // Create BalanceProof object for verification
          const balanceProof = {
            channelId: evmClaim.channelId,
            nonce: evmClaim.nonce,
            transferredAmount: evmClaim.transferredAmount,
            lockedAmount: evmClaim.lockedAmount,
            locksRoot: evmClaim.locksRoot,
          };

          const valid = await this.paymentChannelSDK.verifyBalanceProof(
            balanceProof,
            evmClaim.signature,
            expectedSigner
          );

          // Verify signer address matches expectedSigner (case-insensitive)
          const signerMatch = evmClaim.signer.toLowerCase() === expectedSigner.toLowerCase();

          return valid && signerMatch;
        }

        case 'xrp': {
          const xrpClaim = claim as XRPSignedClaim;
          const valid = await this.xrpClaimSigner.verifyClaim(
            xrpClaim.channelId,
            xrpClaim.amount.toString(),
            xrpClaim.signature,
            xrpClaim.signer
          );

          // Verify signer public key matches expectedSigner
          const signerMatch = xrpClaim.signer === expectedSigner;

          return valid && signerMatch;
        }

        case 'aptos': {
          const aptosClaim = claim as AptosSignedClaim;
          const valid = this.aptosClaimSigner.verifyClaim(
            aptosClaim.channelOwner,
            aptosClaim.amount,
            aptosClaim.nonce,
            aptosClaim.signature,
            aptosClaim.signer
          );

          // Verify signer public key matches expectedSigner
          const signerMatch = aptosClaim.signer === expectedSigner;

          return valid && signerMatch;
        }

        default:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.logger.warn({ chain: (claim as any).chain }, 'Unknown chain type');
          return false;
      }
    } catch (error) {
      // Verification exceptions must be caught and logged
      this.logger.warn(
        { chain: claim.chain, error: (error as Error).message },
        'Claim verification failed'
      );
      return false;
    }
  }

  /**
   * Verify claim monotonicity (nonce or amount must be strictly increasing).
   * EVM/Aptos: Check nonce monotonicity
   * XRP: Check amount monotonicity (cumulative balance)
   *
   * @param peerId - Nostr public key of the peer
   * @param claim - Signed claim to verify
   * @returns true if claim is newer than stored claim, false if stale
   */
  verifyMonotonicity(peerId: string, claim: SignedClaim): boolean {
    const channelId = this.getChannelIdentifier(claim);
    const existingClaim = this.claimStore.getLatestClaim(peerId, claim.chain, channelId);

    if (!existingClaim) {
      // No existing claim, new claim is valid
      return true;
    }

    switch (claim.chain) {
      case 'evm': {
        const evmClaim = claim as EVMSignedClaim;
        const evmExisting = existingClaim as EVMSignedClaim;

        if (evmExisting.nonce >= evmClaim.nonce) {
          this.logger.info(
            {
              peerId,
              chain: claim.chain,
              storedNonce: evmExisting.nonce,
              newNonce: evmClaim.nonce,
            },
            'Stale nonce rejected'
          );
          return false;
        }
        return true;
      }

      case 'xrp': {
        const xrpClaim = claim as XRPSignedClaim;
        const xrpExisting = existingClaim as XRPSignedClaim;

        if (xrpExisting.amount >= xrpClaim.amount) {
          this.logger.info(
            {
              peerId,
              chain: claim.chain,
              storedAmount: xrpExisting.amount.toString(),
              newAmount: xrpClaim.amount.toString(),
            },
            'Stale amount rejected'
          );
          return false;
        }
        return true;
      }

      case 'aptos': {
        const aptosClaim = claim as AptosSignedClaim;
        const aptosExisting = existingClaim as AptosSignedClaim;

        if (aptosExisting.nonce >= aptosClaim.nonce) {
          this.logger.info(
            {
              peerId,
              chain: claim.chain,
              storedNonce: aptosExisting.nonce,
              newNonce: aptosClaim.nonce,
            },
            'Stale nonce rejected'
          );
          return false;
        }
        return true;
      }

      default:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.logger.warn({ chain: (claim as any).chain }, 'Unknown chain type');
        return false;
    }
  }

  /**
   * Verify claim amount is within channel deposit bounds.
   * If claim amount exceeds channel deposit, log ERROR (potential fraud) and reject.
   *
   * @param claim - Signed claim to verify
   * @param channelDeposit - Total channel deposit amount
   * @returns true if amount is within bounds, false if exceeds
   */
  verifyAmountWithinBounds(claim: SignedClaim, channelDeposit: bigint): boolean {
    const claimAmount = this.getClaimAmount(claim);

    if (claimAmount > channelDeposit) {
      this.logger.error(
        {
          chain: claim.chain,
          claimAmount: claimAmount.toString(),
          deposit: channelDeposit.toString(),
        },
        'Claim exceeds deposit - potential fraud'
      );
      return false;
    }

    return true;
  }

  /**
   * Process a received claim event from a peer.
   * Extracts signed claims and unsigned requests, verifies signatures, checks monotonicity,
   * stores valid claims, and generates signed responses for unsigned requests.
   *
   * @param peerId - Nostr public key of the peer
   * @param event - Nostr claim event to process
   * @param peerAddresses - Peer's blockchain wallet addresses
   * @returns ProcessClaimResult with all processing outcomes
   */
  async processReceivedClaimEvent(
    peerId: string,
    event: NostrClaimEvent,
    peerAddresses: WalletAddresses
  ): Promise<ProcessClaimResult> {
    const result: ProcessClaimResult = {
      signedClaims: [],
      unsignedRequests: [],
      signedResponses: [],
      errors: [],
    };

    try {
      // Extract signed claim from event
      const signedClaim = this.claimEventParser.extractSignedClaim(event);

      // Extract unsigned requests from event
      const unsignedRequests = this.claimEventParser.extractUnsignedRequests(event);
      result.unsignedRequests = unsignedRequests;

      // Process signed claim (if present)
      if (signedClaim) {
        const expectedSigner = this.getExpectedSigner(signedClaim.chain, peerAddresses);

        if (!expectedSigner) {
          const error = `No ${signedClaim.chain} address configured for peer`;
          this.logger.warn({ peerId, chain: signedClaim.chain }, error);
          result.errors.push(error);
        } else {
          // Verify signature
          const signatureValid = await this.verifyClaimSignature(signedClaim, expectedSigner);

          if (!signatureValid) {
            const error = `Invalid signature for ${signedClaim.chain} claim`;
            this.logger.warn(
              {
                peerId,
                chain: signedClaim.chain,
                reason: 'invalid_signature',
                channelId: this.getChannelIdentifier(signedClaim),
                amount: this.getClaimAmount(signedClaim).toString(),
              },
              'Claim verification failed'
            );
            result.errors.push(error);
          } else {
            // Verify monotonicity
            const monotonicity = this.verifyMonotonicity(peerId, signedClaim);

            if (!monotonicity) {
              const error = `Stale ${signedClaim.chain} claim (nonce/amount not increasing)`;
              result.errors.push(error);
            } else {
              // Store valid claim
              const stored = this.storeClaim(peerId, signedClaim);

              if (stored) {
                result.signedClaims.push(signedClaim);
                this.logger.debug(
                  {
                    peerId,
                    chain: signedClaim.chain,
                    channelId: this.getChannelIdentifier(signedClaim),
                    amount: this.getClaimAmount(signedClaim).toString(),
                  },
                  'Claim stored successfully'
                );
              } else {
                const error = `Failed to store ${signedClaim.chain} claim`;
                this.logger.error({ peerId, chain: signedClaim.chain }, error);
                result.errors.push(error);
              }
            }
          }
        }
      }

      // Process unsigned requests
      for (const request of unsignedRequests) {
        const signedResponse = await this.generateClaimForPeer(
          peerId,
          request.chain,
          this.getRequestChannelId(request),
          request.amount,
          this.getRequestNonce(request)
        );

        if (signedResponse) {
          result.signedResponses.push(signedResponse);
        } else {
          const error = `Failed to generate signed response for ${request.chain} request`;
          this.logger.warn({ peerId, chain: request.chain }, error);
          result.errors.push(error);
        }
      }
    } catch (error) {
      // Parser exceptions must be caught and logged
      const errorMsg = `Failed to process claim event: ${(error as Error).message}`;
      this.logger.error({ peerId, error: (error as Error).message }, errorMsg);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Get stored claims for settlement on a specific chain.
   * Used by settlement executor (Story 30.6) to retrieve stored claims for on-chain submission.
   *
   * @param peerId - Nostr public key of the peer
   * @param chain - Blockchain chain ('evm', 'xrp', or 'aptos')
   * @returns Array of signed claims for settlement (sorted by timestamp descending)
   */
  getClaimsForSettlement(peerId: string, chain: ClaimChain): SignedClaim[] {
    return this.claimStore.getClaimsForSettlement(peerId, chain);
  }

  // ==================== Private Helper Methods ====================

  /**
   * Get the channel identifier from a claim.
   * EVM/XRP use channelId, Aptos uses channelOwner.
   */
  private getChannelIdentifier(claim: SignedClaim): string {
    switch (claim.chain) {
      case 'evm':
        return (claim as EVMSignedClaim).channelId;
      case 'xrp':
        return (claim as XRPSignedClaim).channelId;
      case 'aptos':
        return (claim as AptosSignedClaim).channelOwner;
      default:
        return '';
    }
  }

  /**
   * Get the claim amount from a claim.
   * EVM uses transferredAmount, XRP/Aptos use amount.
   */
  private getClaimAmount(claim: SignedClaim): bigint {
    switch (claim.chain) {
      case 'evm':
        return (claim as EVMSignedClaim).transferredAmount;
      case 'xrp':
        return (claim as XRPSignedClaim).amount;
      case 'aptos':
        return (claim as AptosSignedClaim).amount;
      default:
        return 0n;
    }
  }

  /**
   * Get the expected signer address/public key from peer addresses.
   */
  private getExpectedSigner(chain: ClaimChain, peerAddresses: WalletAddresses): string | null {
    switch (chain) {
      case 'evm':
        return peerAddresses.evm || null;
      case 'xrp':
        return peerAddresses.xrp || null;
      case 'aptos':
        return peerAddresses.aptos || null;
      default:
        return null;
    }
  }

  /**
   * Get the channel identifier from a claim request.
   */
  private getRequestChannelId(request: ClaimRequest): string {
    switch (request.chain) {
      case 'evm':
        return request.channelId;
      case 'xrp':
        return request.channelId;
      case 'aptos':
        return request.channelOwner;
      default:
        return '';
    }
  }

  /**
   * Get the nonce from a claim request (undefined for XRP).
   */
  private getRequestNonce(request: ClaimRequest): number | undefined {
    switch (request.chain) {
      case 'evm':
        return request.nonce;
      case 'xrp':
        return undefined; // XRP uses amount for monotonicity
      case 'aptos':
        return request.nonce;
      default:
        return undefined;
    }
  }

  /**
   * Store a claim using the appropriate ClaimStore method.
   */
  private storeClaim(peerId: string, claim: SignedClaim): boolean {
    try {
      switch (claim.chain) {
        case 'evm':
          return this.claimStore.storeEVMClaim(peerId, claim as EVMSignedClaim);
        case 'xrp':
          return this.claimStore.storeXRPClaim(peerId, claim as XRPSignedClaim);
        case 'aptos':
          return this.claimStore.storeAptosClaim(peerId, claim as AptosSignedClaim);
        default:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.logger.warn({ chain: (claim as any).chain }, 'Unknown chain type');
          return false;
      }
    } catch (error) {
      this.logger.error(
        { peerId, chain: claim.chain, error: (error as Error).message },
        'ClaimStore write failure'
      );
      return false;
    }
  }
}
