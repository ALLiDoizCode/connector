import type { EventHandler, EventHandlerResult } from '../event-handler';
import type { FollowGraphRouter } from '../follow-graph-router';

/**
 * Configuration for the Follow handler.
 */
export interface FollowHandlerConfig {
  /** FollowGraphRouter instance for routing table updates */
  followGraphRouter: FollowGraphRouter;
  /** Whether to persist Kind 3 events to database (default: true) */
  persistToDatabase?: boolean;
}

/**
 * Creates a handler for Kind 3 (Follow List) events.
 *
 * The follow handler updates the routing table via FollowGraphRouter when
 * follow list events are received. This enables routing ILP packets based
 * on Nostr social graph topology.
 *
 * @param config - Handler configuration with FollowGraphRouter dependency
 * @returns EventHandler function for Kind 3 events
 *
 * @example
 * ```typescript
 * const followHandler = createFollowHandler({
 *   followGraphRouter: router,
 *   persistToDatabase: true,
 * });
 * agentEventHandler.registerHandler({
 *   kind: 3,
 *   handler: followHandler,
 *   requiredPayment: 500n,
 *   description: 'Follow list update',
 * });
 * ```
 */
export function createFollowHandler(config: FollowHandlerConfig): EventHandler {
  const persistToDatabase = config.persistToDatabase ?? true;

  return async (context): Promise<EventHandlerResult> => {
    // Validate event kind (defensive - handler shouldn't receive non-Kind-3)
    if (context.event.kind !== 3) {
      return {
        success: false,
        error: {
          code: 'F99',
          message: `Expected Kind 3 event, got Kind ${context.event.kind}`,
        },
      };
    }

    // Update routing table via FollowGraphRouter
    config.followGraphRouter.updateFromFollowEvent(context.event);

    // Optionally persist the Kind 3 event to database
    if (persistToDatabase) {
      await context.database.storeEvent(context.event);
    }

    return { success: true };
  };
}
