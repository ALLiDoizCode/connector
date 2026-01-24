import type { Logger } from 'pino';
import type { EventHandler, EventHandlerResult } from '../event-handler';

/**
 * Configuration for the Delete handler.
 */
export interface DeleteHandlerConfig {
  /** Pino logger instance */
  logger?: Logger;
}

/**
 * Creates a handler for Kind 5 (Deletion Request) events.
 *
 * The delete handler removes events from the database following NIP-09
 * deletion request format. Only the original author of an event can
 * request its deletion (authorization check).
 *
 * NIP-09 format:
 * ```json
 * {
 *   "kind": 5,
 *   "pubkey": "<author requesting deletion>",
 *   "tags": [
 *     ["e", "<event-id-to-delete>"],
 *     ["e", "<another-event-id>"]
 *   ],
 *   "content": "<optional reason>"
 * }
 * ```
 *
 * @param config - Optional handler configuration
 * @returns EventHandler function for Kind 5 events
 *
 * @example
 * ```typescript
 * const deleteHandler = createDeleteHandler({ logger });
 * agentEventHandler.registerHandler({
 *   kind: 5,
 *   handler: deleteHandler,
 *   requiredPayment: 100n,
 *   description: 'Event deletion',
 * });
 * ```
 */
export function createDeleteHandler(config?: DeleteHandlerConfig): EventHandler {
  const logger = config?.logger?.child({ component: 'DeleteHandler' }) ?? {
    warn: () => {},
    debug: () => {},
  };

  return async (context): Promise<EventHandlerResult> => {
    // Validate event kind (defensive - handler shouldn't receive non-Kind-5)
    if (context.event.kind !== 5) {
      return {
        success: false,
        error: {
          code: 'F99',
          message: `Expected Kind 5 event, got Kind ${context.event.kind}`,
        },
      };
    }

    // Extract event IDs from 'e' tags per NIP-09
    const eventIds = context.event.tags
      .filter(
        (tag): tag is [string, string, ...string[]] =>
          Array.isArray(tag) && tag[0] === 'e' && tag.length >= 2 && typeof tag[1] === 'string'
      )
      .map((tag) => tag[1]);

    // If no event IDs found, return success with count 0
    if (eventIds.length === 0) {
      return { success: true };
    }

    // Query database for original events to verify authorship
    const originalEvents = await context.database.queryEvents({ ids: eventIds });

    // Filter to only events authored by the requester (authorization check)
    const requesterPubkey = context.event.pubkey;
    const authorizedIds: string[] = [];
    const unauthorizedIds: string[] = [];

    for (const event of originalEvents) {
      if (event.pubkey === requesterPubkey) {
        authorizedIds.push(event.id);
      } else {
        unauthorizedIds.push(event.id);
      }
    }

    // Log warning for unauthorized deletion attempts
    if (unauthorizedIds.length > 0) {
      logger.warn(
        {
          requesterPubkey,
          unauthorizedCount: unauthorizedIds.length,
          unauthorizedIds,
        },
        'Unauthorized deletion attempt - requester is not the author'
      );
    }

    // Delete only authorized events
    let deletedCount = 0;
    if (authorizedIds.length > 0) {
      deletedCount = await context.database.deleteEvents(authorizedIds);
      logger.debug({ requesterPubkey, deletedCount, authorizedIds }, 'Deleted authorized events');
    }

    return { success: true };
  };
}
