import type { Logger } from 'pino';
import { RoutingTable } from '../routing/routing-table';
import type { NostrEvent } from './toon-codec';
import { isValidILPAddress } from '@m2m/shared';

/**
 * Follow list entry representing a followed agent.
 */
export interface AgentFollow {
  /** Followed agent's Nostr pubkey (64-char hex) */
  pubkey: string;
  /** Agent's ILP address (e.g., "g.agent.alice") */
  ilpAddress: string;
  /** Optional human-readable name */
  petname?: string;
  /** Optional relay hint (unused in MVP) */
  relayHint?: string;
  /** Unix timestamp when added */
  addedAt: number;
}

/**
 * Edge in the follow graph for export/debugging.
 */
export interface FollowGraphEdge {
  /** This agent's pubkey */
  fromPubkey: string;
  /** Followed agent's pubkey */
  toPubkey: string;
  /** Target ILP address */
  ilpAddress: string;
  /** Unix timestamp when added */
  addedAt: number;
}

/**
 * Configuration for FollowGraphRouter.
 */
export interface FollowGraphRouterConfig {
  /** This agent's Nostr pubkey */
  agentPubkey: string;
  /** Static config follows */
  initialFollows?: Omit<AgentFollow, 'addedAt'>[];
  /** Pino logger instance */
  logger?: Logger;
}

/**
 * FollowGraphRouter maintains routing table entries derived from Kind 3 (Follow List)
 * Nostr events. It enables routing ILP packets to followed agents using social graph
 * topology derived from Nostr follow relationships.
 *
 * @example
 * ```typescript
 * const router = new FollowGraphRouter({
 *   agentPubkey: 'my-agent-pubkey',
 *   initialFollows: [
 *     { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' },
 *     { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
 *   ],
 *   logger: pino(),
 * });
 *
 * // Route lookup
 * const nextHop = router.getNextHop('g.agent.alice.query');
 * // Returns: 'alice-pubkey'
 * ```
 */
export class FollowGraphRouter {
  private readonly routingTable: RoutingTable;
  private readonly followGraph: Map<string, AgentFollow>;
  private readonly config: FollowGraphRouterConfig;
  private readonly logger: Logger;

  /**
   * Creates a new FollowGraphRouter instance.
   *
   * @param config - Router configuration
   */
  constructor(config: FollowGraphRouterConfig) {
    this.config = config;
    this.followGraph = new Map();

    // Create child logger or use a no-op logger
    this.logger = config.logger
      ? (config.logger.child({ component: 'FollowGraphRouter' }) as Logger)
      : ({
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          child: () => this.logger,
        } as unknown as Logger);

    // Initialize routing table with logger adapter
    this.routingTable = new RoutingTable(undefined, {
      info: (obj: object, msg?: string) => this.logger.info(obj, msg),
      error: (obj: object, msg?: string) => this.logger.error(obj, msg),
    });

    // Process initial follows from config
    if (config.initialFollows && config.initialFollows.length > 0) {
      const now = Math.floor(Date.now() / 1000);
      for (const follow of config.initialFollows) {
        const followWithTimestamp: AgentFollow = {
          ...follow,
          addedAt: now,
        };
        this.followGraph.set(follow.pubkey, followWithTimestamp);
        this.routingTable.addRoute(follow.ilpAddress, follow.pubkey);
      }
      this.logger.info(
        { followCount: config.initialFollows.length },
        'Initialized follow graph from config'
      );
    }
  }

  /**
   * Parses a Kind 3 Nostr event to extract follow list entries.
   *
   * @param event - Kind 3 Nostr event
   * @returns Array of AgentFollow objects extracted from the event
   */
  private parseFollowEvent(event: NostrEvent): AgentFollow[] {
    if (event.kind !== 3) {
      this.logger.warn({ kind: event.kind }, 'Expected Kind 3 event, got different kind');
      return [];
    }

    const follows: AgentFollow[] = [];
    const now = Math.floor(Date.now() / 1000);

    // Extract ILP address tags: ["ilp", "<pubkey>", "<ilp address>"]
    const ilpTags = event.tags.filter(
      (tag): tag is [string, string, string, ...string[]] =>
        Array.isArray(tag) && tag[0] === 'ilp' && tag.length >= 3
    );

    // Extract p-tags for petnames: ["p", "<pubkey>", "<relay>", "<petname>"]
    const pTags = event.tags.filter(
      (tag): tag is [string, string, ...string[]] =>
        Array.isArray(tag) && tag[0] === 'p' && tag.length >= 2
    );

    // Build a map of pubkey -> petname from p-tags
    const petnames = new Map<string, string>();
    for (const pTag of pTags) {
      if (pTag.length >= 4 && pTag[3]) {
        petnames.set(pTag[1], pTag[3]);
      }
    }

    // Create AgentFollow for each valid ILP tag
    for (const ilpTag of ilpTags) {
      const pubkey = ilpTag[1];
      const ilpAddress = ilpTag[2];

      // Validate ILP address
      if (!isValidILPAddress(ilpAddress)) {
        this.logger.warn({ pubkey, ilpAddress }, 'Skipping follow with invalid ILP address');
        continue;
      }

      follows.push({
        pubkey,
        ilpAddress,
        petname: petnames.get(pubkey),
        addedAt: now,
      });
    }

    this.logger.debug({ kind: 3, followCount: follows.length }, 'Parsed follow event');
    return follows;
  }

  /**
   * Updates the follow graph from a Kind 3 Nostr event.
   * This replaces all follows for the agent that authored the event.
   *
   * @param event - Kind 3 Nostr event
   */
  updateFromFollowEvent(event: NostrEvent): void {
    const follows = this.parseFollowEvent(event);

    // Clear existing routes for all current follows
    for (const existingFollow of this.followGraph.values()) {
      this.routingTable.removeRoute(existingFollow.ilpAddress);
    }
    this.followGraph.clear();

    // Add new follows
    for (const follow of follows) {
      this.followGraph.set(follow.pubkey, follow);
      this.routingTable.addRoute(follow.ilpAddress, follow.pubkey);
    }

    this.logger.info(
      { pubkey: event.pubkey, followCount: follows.length },
      'Updated follow graph from event'
    );
  }

  /**
   * Adds a single follow to the graph.
   *
   * @param follow - Follow entry to add
   * @throws Error if ILP address is invalid
   */
  addFollow(follow: Omit<AgentFollow, 'addedAt'>): void {
    if (!isValidILPAddress(follow.ilpAddress)) {
      throw new Error(`Invalid ILP address: ${follow.ilpAddress}`);
    }

    const followWithTimestamp: AgentFollow = {
      ...follow,
      addedAt: Math.floor(Date.now() / 1000),
    };

    // Check if replacing existing follow
    const existing = this.followGraph.get(follow.pubkey);
    if (existing) {
      // Remove old route if ILP address changed
      if (existing.ilpAddress !== follow.ilpAddress) {
        this.routingTable.removeRoute(existing.ilpAddress);
      }
      this.logger.info(
        { pubkey: follow.pubkey, ilpAddress: follow.ilpAddress },
        'Replacing existing follow'
      );
    }

    this.followGraph.set(follow.pubkey, followWithTimestamp);
    this.routingTable.addRoute(follow.ilpAddress, follow.pubkey);

    this.logger.info({ pubkey: follow.pubkey, ilpAddress: follow.ilpAddress }, 'Added follow');
  }

  /**
   * Removes a follow from the graph by pubkey.
   *
   * @param pubkey - Pubkey of the agent to unfollow
   * @returns true if the follow was removed, false if not found
   */
  removeFollow(pubkey: string): boolean {
    const follow = this.followGraph.get(pubkey);
    if (!follow) {
      return false;
    }

    this.routingTable.removeRoute(follow.ilpAddress);
    this.followGraph.delete(pubkey);

    this.logger.info({ pubkey }, 'Removed follow');
    return true;
  }

  /**
   * Gets the next-hop pubkey for a destination ILP address.
   *
   * @param destination - Destination ILP address
   * @returns Pubkey of the next-hop agent, or null if no route
   */
  getNextHop(destination: string): string | null {
    return this.routingTable.getNextHop(destination);
  }

  /**
   * Checks if there is a route to the given destination.
   *
   * @param destination - Destination ILP address
   * @returns true if a route exists
   */
  hasRouteTo(destination: string): boolean {
    return this.getNextHop(destination) !== null;
  }

  /**
   * Gets a follow entry by pubkey.
   *
   * @param pubkey - Pubkey of the followed agent
   * @returns AgentFollow if found, undefined otherwise
   */
  getFollowByPubkey(pubkey: string): AgentFollow | undefined {
    return this.followGraph.get(pubkey);
  }

  /**
   * Gets a follow entry by ILP address.
   *
   * @param ilpAddress - ILP address to search for
   * @returns AgentFollow if found, undefined otherwise
   */
  getFollowByILPAddress(ilpAddress: string): AgentFollow | undefined {
    for (const follow of this.followGraph.values()) {
      if (follow.ilpAddress === ilpAddress) {
        return follow;
      }
    }
    return undefined;
  }

  /**
   * Exports the follow graph as an array of edges for debugging/visualization.
   *
   * @returns Array of FollowGraphEdge objects
   */
  exportGraph(): FollowGraphEdge[] {
    const edges: FollowGraphEdge[] = [];

    for (const follow of this.followGraph.values()) {
      edges.push({
        fromPubkey: this.config.agentPubkey,
        toPubkey: follow.pubkey,
        ilpAddress: follow.ilpAddress,
        addedAt: follow.addedAt,
      });
    }

    return edges;
  }

  /**
   * Gets a map of all known agents (pubkey -> ILP address).
   *
   * @returns Map of pubkey to ILP address
   */
  getKnownAgents(): Map<string, string> {
    const agents = new Map<string, string>();
    for (const follow of this.followGraph.values()) {
      agents.set(follow.pubkey, follow.ilpAddress);
    }
    return agents;
  }

  /**
   * Gets the number of follows in the graph.
   *
   * @returns Number of followed agents
   */
  getFollowCount(): number {
    return this.followGraph.size;
  }

  /**
   * Gets all follows as an array.
   *
   * @returns Array of all AgentFollow objects
   */
  getAllFollows(): AgentFollow[] {
    return Array.from(this.followGraph.values());
  }
}
