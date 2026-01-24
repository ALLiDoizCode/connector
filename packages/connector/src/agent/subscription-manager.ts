import type { Logger } from 'pino';
import type { NostrFilter } from './event-database';
import type { NostrEvent } from './toon-codec';

/**
 * Represents an active subscription for event delivery.
 */
export interface Subscription {
  /** Client-provided subscription ID */
  id: string;
  /** Filter criteria for matching events */
  filter: NostrFilter;
  /** Peer connection ID for push delivery */
  peerId: string;
  /** Unix timestamp when subscription was created */
  createdAt: number;
}

/**
 * Configuration for SubscriptionManager.
 */
export interface SubscriptionManagerConfig {
  /** Maximum subscriptions per peer (default: 10) */
  maxSubscriptionsPerPeer?: number;
  /** Pino logger instance */
  logger?: Logger;
}

const DEFAULT_MAX_SUBSCRIPTIONS_PER_PEER = 10;

/**
 * SubscriptionManager tracks active subscriptions and matches incoming events
 * against subscription filters for push delivery.
 *
 * Subscriptions are established out-of-band (via configuration, BTP handshake,
 * or other mechanisms) similar to payment channel setup. This class provides
 * the storage and matching layer.
 *
 * @example
 * ```typescript
 * const subManager = new SubscriptionManager({
 *   maxSubscriptionsPerPeer: 10,
 *   logger: pino(),
 * });
 *
 * // Register a subscription
 * subManager.registerSubscription('peer-123', 'sub-1', { kinds: [1] });
 *
 * // Find matching subscriptions for an event
 * const matches = subManager.getMatchingSubscriptions(event);
 * for (const sub of matches) {
 *   // Push event to subscriber via BTP
 *   await btpClient.sendEvent(sub.peerId, event);
 * }
 * ```
 */
export class SubscriptionManager {
  /** peerId -> (subId -> Subscription) */
  private readonly _subscriptions: Map<string, Map<string, Subscription>>;
  private readonly _config: Required<SubscriptionManagerConfig>;
  private readonly _logger: Logger;

  constructor(config?: SubscriptionManagerConfig) {
    this._subscriptions = new Map();
    this._config = {
      maxSubscriptionsPerPeer:
        config?.maxSubscriptionsPerPeer ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_PEER,
      logger:
        config?.logger ??
        ({
          info: () => {},
          warn: () => {},
          debug: () => {},
          child: function () {
            return this;
          },
        } as unknown as Logger),
    };
    this._logger = this._config.logger.child({ component: 'SubscriptionManager' }) as Logger;
  }

  /**
   * Register a subscription for a peer.
   *
   * @param peerId - Peer connection ID
   * @param subId - Client-provided subscription ID
   * @param filter - NIP-01 compatible filter
   * @throws Error if subscription limit per peer is exceeded
   */
  registerSubscription(peerId: string, subId: string, filter: NostrFilter): void {
    let peerSubs = this._subscriptions.get(peerId);

    if (!peerSubs) {
      peerSubs = new Map();
      this._subscriptions.set(peerId, peerSubs);
    }

    // Check limit (existing subscription with same ID doesn't count toward limit)
    if (!peerSubs.has(subId) && peerSubs.size >= this._config.maxSubscriptionsPerPeer) {
      throw new Error(
        `Subscription limit exceeded: peer ${peerId} has ${peerSubs.size} subscriptions (max: ${this._config.maxSubscriptionsPerPeer})`
      );
    }

    const subscription: Subscription = {
      id: subId,
      filter,
      peerId,
      createdAt: Math.floor(Date.now() / 1000),
    };

    peerSubs.set(subId, subscription);
    this._logger.info({ peerId, subId }, 'Subscription registered');
  }

  /**
   * Unregister a specific subscription.
   *
   * @param peerId - Peer connection ID
   * @param subId - Subscription ID to remove
   * @returns true if removed, false if not found
   */
  unregisterSubscription(peerId: string, subId: string): boolean {
    const peerSubs = this._subscriptions.get(peerId);
    if (!peerSubs) {
      return false;
    }

    const removed = peerSubs.delete(subId);

    // Clean up empty peer maps
    if (peerSubs.size === 0) {
      this._subscriptions.delete(peerId);
    }

    if (removed) {
      this._logger.info({ peerId, subId }, 'Subscription unregistered');
    }

    return removed;
  }

  /**
   * Unregister all subscriptions for a peer (for connection cleanup).
   *
   * @param peerId - Peer connection ID
   * @returns Count of removed subscriptions
   */
  unregisterAllForPeer(peerId: string): number {
    const peerSubs = this._subscriptions.get(peerId);
    if (!peerSubs) {
      return 0;
    }

    const count = peerSubs.size;
    this._subscriptions.delete(peerId);

    this._logger.info({ peerId, count }, 'All subscriptions unregistered for peer');
    return count;
  }

  /**
   * Get all subscriptions matching an event.
   *
   * @param event - Nostr event to match against
   * @returns Array of matching subscriptions
   */
  getMatchingSubscriptions(event: NostrEvent): Subscription[] {
    const matches: Subscription[] = [];

    for (const peerSubs of this._subscriptions.values()) {
      for (const subscription of peerSubs.values()) {
        if (this._matchesFilter(event, subscription.filter)) {
          matches.push(subscription);
        }
      }
    }

    this._logger.debug(
      { eventId: event.id, matchCount: matches.length },
      'Found matching subscriptions'
    );

    return matches;
  }

  /**
   * Get the count of subscriptions.
   *
   * @param peerId - Optional peer ID to filter by
   * @returns Subscription count
   */
  getSubscriptionCount(peerId?: string): number {
    if (peerId) {
      return this._subscriptions.get(peerId)?.size ?? 0;
    }

    let total = 0;
    for (const peerSubs of this._subscriptions.values()) {
      total += peerSubs.size;
    }
    return total;
  }

  /**
   * Check if a subscription exists.
   *
   * @param peerId - Peer connection ID
   * @param subId - Subscription ID
   * @returns true if subscription exists
   */
  hasSubscription(peerId: string, subId: string): boolean {
    return this._subscriptions.get(peerId)?.has(subId) ?? false;
  }

  /**
   * Get a specific subscription.
   *
   * @param peerId - Peer connection ID
   * @param subId - Subscription ID
   * @returns Subscription or undefined if not found
   */
  getSubscription(peerId: string, subId: string): Subscription | undefined {
    return this._subscriptions.get(peerId)?.get(subId);
  }

  // ============================================
  // Filter Matching Logic (Task 8)
  // ============================================

  /**
   * Check if an event matches a filter.
   *
   * All defined criteria must match (AND logic).
   * Undefined filter fields match all events.
   *
   * @param event - Nostr event to check
   * @param filter - Filter criteria
   * @returns true if event matches filter
   */
  private _matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
    // Check ids
    if (filter.ids && filter.ids.length > 0) {
      if (!filter.ids.includes(event.id)) {
        return false;
      }
    }

    // Check authors
    if (filter.authors && filter.authors.length > 0) {
      if (!filter.authors.includes(event.pubkey)) {
        return false;
      }
    }

    // Check kinds
    if (filter.kinds && filter.kinds.length > 0) {
      if (!filter.kinds.includes(event.kind)) {
        return false;
      }
    }

    // Check since (lower bound)
    if (filter.since !== undefined) {
      if (event.created_at < filter.since) {
        return false;
      }
    }

    // Check until (upper bound)
    if (filter.until !== undefined) {
      if (event.created_at > filter.until) {
        return false;
      }
    }

    // Check #e (events referenced in tags)
    if (filter['#e'] && filter['#e'].length > 0) {
      const eventETags = event.tags
        .filter((tag): tag is [string, string, ...string[]] => tag[0] === 'e' && tag.length >= 2)
        .map((tag) => tag[1]);

      const hasMatchingETag = filter['#e'].some((e) => eventETags.includes(e));
      if (!hasMatchingETag) {
        return false;
      }
    }

    // Check #p (pubkeys referenced in tags)
    if (filter['#p'] && filter['#p'].length > 0) {
      const eventPTags = event.tags
        .filter((tag): tag is [string, string, ...string[]] => tag[0] === 'p' && tag.length >= 2)
        .map((tag) => tag[1]);

      const hasMatchingPTag = filter['#p'].some((p) => eventPTags.includes(p));
      if (!hasMatchingPTag) {
        return false;
      }
    }

    // All defined criteria matched
    return true;
  }
}
