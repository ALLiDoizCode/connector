import { Logger } from 'pino';
import {
  SignedClaim,
  ClaimRequest,
  NostrClaimEvent,
  EVMSignedClaim,
  XRPSignedClaim,
  AptosSignedClaim,
  EVMClaimRequest,
  XRPClaimRequest,
  AptosClaimRequest,
  CLAIM_TAG,
  isClaimEventKind,
  getChainFromEventKind,
} from '@m2m/shared';
import { NostrEvent } from './toon-codec';

/**
 * ClaimEventParser - Extracts claim data from Nostr claim events
 *
 * This parser extracts signed claims and unsigned requests from incoming
 * Nostr claim events following the Epic 30 Balance Proof Exchange protocol.
 *
 * Extracted claims can be verified using existing chain-specific signers:
 * - EVM: PaymentChannelSDK.verifyBalanceProof() (Epic 8)
 * - XRP: ClaimSigner.verifyClaim() (Epic 9)
 * - Aptos: AptosClaimSigner.verifyClaim() (Epic 27)
 *
 * Note: This parser does NOT perform signature verification. Signature
 * verification is deferred to ClaimManager (Story 30.4).
 *
 * Error Handling: All methods return null or empty array on failure, never throw.
 * This ensures claim events are additive: if parsing fails, packet processing
 * continues without claim data.
 *
 * @example
 * ```typescript
 * const parser = new ClaimEventParser(logger);
 * if (parser.isClaimEvent(event)) {
 *   const claim = parser.extractSignedClaim(event);
 *   const requests = parser.extractUnsignedRequests(event);
 * }
 * ```
 */
export class ClaimEventParser {
  /**
   * @param logger - Pino logger for warnings about malformed events
   */
  constructor(private readonly logger: Logger) {}

  /**
   * Check if event is a claim event (kind 30001-30003)
   *
   * @param event - Nostr event to check
   * @returns true if event kind is a claim event kind
   */
  isClaimEvent(event: NostrEvent): event is NostrClaimEvent {
    return isClaimEventKind(event.kind);
  }

  /**
   * Extract tag value by tag name
   *
   * @param tags - Event tags array
   * @param tagName - Tag name to search for
   * @returns Tag value or null if not found
   */
  private extractTagValue(tags: string[][], tagName: string): string | null {
    const tag = tags.find((t) => t[0] === tagName);
    if (!tag || tag.length < 2 || tag[1] === undefined) {
      return null;
    }
    return tag[1];
  }

  /**
   * Extract all tag values by tag name (for multiple tags with same name)
   *
   * @param tags - Event tags array
   * @param tagName - Tag name to search for
   * @returns Array of tag values
   */
  private extractTagValues(tags: string[][], tagName: string): string[] {
    return tags.filter((t) => t[0] === tagName).map((t) => t[1] || '');
  }

  /**
   * Extract signed claim from claim event
   *
   * Extracts chain-specific claim data from event tags and converts
   * string values to appropriate types (bigint for amounts, number for nonces).
   *
   * @param event - Nostr claim event
   * @returns Typed SignedClaim or null if extraction fails
   */
  extractSignedClaim(event: NostrClaimEvent): SignedClaim | null {
    // Verify event kind is valid
    const eventToCheck = event as NostrEvent;
    if (!this.isClaimEvent(eventToCheck)) {
      this.logger.warn({ kind: eventToCheck.kind }, 'Event is not a claim event');
      return null;
    }

    const chain = getChainFromEventKind(event.kind);
    if (!chain) {
      this.logger.warn({ kind: event.kind }, 'Unknown claim event kind');
      return null;
    }

    const { tags } = event;

    try {
      if (chain === 'evm') {
        // EVM: channelId, amount, nonce, locked, locks-root, chain-sig, signer
        const channelId = this.extractTagValue(tags, CLAIM_TAG.CHANNEL);
        const amountStr = this.extractTagValue(tags, CLAIM_TAG.AMOUNT);
        const nonceStr = this.extractTagValue(tags, CLAIM_TAG.NONCE);
        const lockedStr = this.extractTagValue(tags, CLAIM_TAG.LOCKED);
        const locksRoot = this.extractTagValue(tags, CLAIM_TAG.LOCKS_ROOT);
        const signature = this.extractTagValue(tags, CLAIM_TAG.SIGNATURE);
        const signer = this.extractTagValue(tags, CLAIM_TAG.SIGNER);

        if (
          !channelId ||
          !amountStr ||
          !nonceStr ||
          !lockedStr ||
          !locksRoot ||
          !signature ||
          !signer
        ) {
          this.logger.warn({ tags }, 'Missing required EVM claim tags');
          return null;
        }

        const evmClaim: EVMSignedClaim = {
          chain: 'evm',
          channelId,
          transferredAmount: BigInt(amountStr),
          nonce: Number(nonceStr),
          lockedAmount: BigInt(lockedStr),
          locksRoot,
          signature,
          signer,
        };

        return evmClaim;
      } else if (chain === 'xrp') {
        // XRP: channelId, amount, chain-sig, signer (NO nonce)
        const channelId = this.extractTagValue(tags, CLAIM_TAG.CHANNEL);
        const amountStr = this.extractTagValue(tags, CLAIM_TAG.AMOUNT);
        const signature = this.extractTagValue(tags, CLAIM_TAG.SIGNATURE);
        const signer = this.extractTagValue(tags, CLAIM_TAG.SIGNER);

        if (!channelId || !amountStr || !signature || !signer) {
          this.logger.warn({ tags }, 'Missing required XRP claim tags');
          return null;
        }

        const xrpClaim: XRPSignedClaim = {
          chain: 'xrp',
          channelId,
          amount: BigInt(amountStr),
          signature,
          signer,
        };

        return xrpClaim;
      } else if (chain === 'aptos') {
        // Aptos: channelOwner (from channel tag), amount, nonce, chain-sig, signer
        const channelOwner = this.extractTagValue(tags, CLAIM_TAG.CHANNEL);
        const amountStr = this.extractTagValue(tags, CLAIM_TAG.AMOUNT);
        const nonceStr = this.extractTagValue(tags, CLAIM_TAG.NONCE);
        const signature = this.extractTagValue(tags, CLAIM_TAG.SIGNATURE);
        const signer = this.extractTagValue(tags, CLAIM_TAG.SIGNER);

        if (!channelOwner || !amountStr || !nonceStr || !signature || !signer) {
          this.logger.warn({ tags }, 'Missing required Aptos claim tags');
          return null;
        }

        const aptosClaim: AptosSignedClaim = {
          chain: 'aptos',
          channelOwner,
          amount: BigInt(amountStr),
          nonce: Number(nonceStr),
          signature,
          signer,
        };

        return aptosClaim;
      }

      return null;
    } catch (error) {
      this.logger.warn({ error, tags }, 'Failed to parse claim data');
      return null;
    }
  }

  /**
   * Extract unsigned claim requests from claim event
   *
   * Unsigned requests are identified by tags prefixed with "request-".
   * Multiple requests can be included in a single event.
   *
   * @param event - Nostr claim event
   * @returns Array of ClaimRequest objects (empty array if none found)
   */
  extractUnsignedRequests(event: NostrClaimEvent): ClaimRequest[] {
    const requests: ClaimRequest[] = [];
    const { tags } = event;

    // Extract all request-chain tags to determine how many requests exist
    const requestChains = this.extractTagValues(tags, CLAIM_TAG.REQUEST_CHAIN);

    for (const chain of requestChains) {
      try {
        // Find the index of this request-chain tag
        const chainTagIndex = tags.findIndex(
          (t) => t[0] === CLAIM_TAG.REQUEST_CHAIN && t[1] === chain
        );
        if (chainTagIndex === -1) continue;

        // Extract request tags starting from this chain tag
        // We need to find the next set of request tags after this chain tag
        const requestTagsSubset = tags.slice(chainTagIndex);

        if (chain === 'evm') {
          const channelId = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_CHANNEL)?.[1];
          const amountStr = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_AMOUNT)?.[1];
          const nonceStr = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_NONCE)?.[1];

          if (!channelId || !amountStr || !nonceStr) {
            this.logger.warn(
              { chain, channelId, amountStr, nonceStr },
              'Incomplete EVM request tags'
            );
            continue;
          }

          const evmRequest: EVMClaimRequest = {
            chain: 'evm',
            channelId,
            amount: BigInt(amountStr),
            nonce: Number(nonceStr),
          };

          requests.push(evmRequest);
        } else if (chain === 'xrp') {
          // XRP: NO nonce
          const channelId = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_CHANNEL)?.[1];
          const amountStr = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_AMOUNT)?.[1];

          if (!channelId || !amountStr) {
            this.logger.warn({ chain, channelId, amountStr }, 'Incomplete XRP request tags');
            continue;
          }

          const xrpRequest: XRPClaimRequest = {
            chain: 'xrp',
            channelId,
            amount: BigInt(amountStr),
          };

          requests.push(xrpRequest);
        } else if (chain === 'aptos') {
          const channelOwner = requestTagsSubset.find(
            (t) => t[0] === CLAIM_TAG.REQUEST_CHANNEL
          )?.[1];
          const amountStr = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_AMOUNT)?.[1];
          const nonceStr = requestTagsSubset.find((t) => t[0] === CLAIM_TAG.REQUEST_NONCE)?.[1];

          if (!channelOwner || !amountStr || !nonceStr) {
            this.logger.warn(
              { chain, channelOwner, amountStr, nonceStr },
              'Incomplete Aptos request tags'
            );
            continue;
          }

          const aptosRequest: AptosClaimRequest = {
            chain: 'aptos',
            channelOwner,
            amount: BigInt(amountStr),
            nonce: Number(nonceStr),
          };

          requests.push(aptosRequest);
        }
      } catch (error) {
        this.logger.warn({ error, chain }, 'Failed to parse request data');
        continue;
      }
    }

    return requests;
  }

  /**
   * Extract content from claim event
   *
   * Content may be plain text or JSON-serialized nested event.
   * Caller is responsible for parsing JSON if needed.
   *
   * @param event - Nostr claim event
   * @returns Content string
   */
  extractContent(event: NostrClaimEvent): string {
    return event.content;
  }

  /**
   * Extract nested Nostr event from content field
   *
   * Attempts to parse content as JSON and validate it has NostrEvent structure.
   * Used for FULFILL responses where content contains another Nostr event.
   *
   * @param event - Nostr claim event
   * @returns Nested NostrEvent or null if content is not valid JSON event
   */
  extractNestedEvent(event: NostrClaimEvent): NostrEvent | null {
    try {
      const parsed = JSON.parse(event.content);

      // Validate parsed object has required NostrEvent fields
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.id === 'string' &&
        typeof parsed.pubkey === 'string' &&
        typeof parsed.kind === 'number' &&
        typeof parsed.created_at === 'number' &&
        Array.isArray(parsed.tags) &&
        typeof parsed.content === 'string' &&
        typeof parsed.sig === 'string'
      ) {
        return parsed as NostrEvent;
      }

      return null;
    } catch {
      // Content is not JSON, return null (not an error)
      return null;
    }
  }
}
