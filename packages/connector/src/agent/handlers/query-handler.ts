import type { EventHandler, EventHandlerResult } from '../event-handler';
import type { NostrFilter } from '../event-database';

/**
 * Configuration for the Query handler.
 */
export interface QueryHandlerConfig {
  /** Maximum results to return (default: 100) */
  maxResults?: number;
  /** Additional payment per result (for pricing - informational only) */
  perResultPayment?: bigint;
}

const DEFAULT_MAX_RESULTS = 100;

/**
 * Creates a handler for Kind 10000 (Query) events.
 *
 * The query handler parses NIP-01 compatible filters from the event content
 * and queries the database, returning matching events in the response.
 *
 * Query event format:
 * ```json
 * {
 *   "kind": 10000,
 *   "content": "{\"kinds\":[1],\"authors\":[\"abc...\"],\"limit\":50}",
 *   ...
 * }
 * ```
 *
 * @param config - Optional handler configuration
 * @returns EventHandler function for Kind 10000 events
 *
 * @example
 * ```typescript
 * const queryHandler = createQueryHandler({ maxResults: 50 });
 * agentEventHandler.registerHandler({
 *   kind: 10000,
 *   handler: queryHandler,
 *   requiredPayment: 200n,
 *   description: 'Query service',
 * });
 * ```
 */
export function createQueryHandler(config?: QueryHandlerConfig): EventHandler {
  const maxResults = config?.maxResults ?? DEFAULT_MAX_RESULTS;

  return async (context): Promise<EventHandlerResult> => {
    // Validate event kind (defensive - handler shouldn't receive non-Kind-10000)
    if (context.event.kind !== 10000) {
      return {
        success: false,
        error: {
          code: 'F99',
          message: `Expected Kind 10000 event, got Kind ${context.event.kind}`,
        },
      };
    }

    // Parse filter from event.content
    let filter: NostrFilter;
    try {
      filter = JSON.parse(context.event.content) as NostrFilter;
    } catch {
      return {
        success: false,
        error: {
          code: 'F01',
          message: 'Malformed query filter',
        },
      };
    }

    // Validate filter is an object
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
      return {
        success: false,
        error: {
          code: 'F01',
          message: 'Malformed query filter',
        },
      };
    }

    // Apply maxResults limit
    filter.limit = Math.min(filter.limit ?? DEFAULT_MAX_RESULTS, maxResults);

    // Query database
    const events = await context.database.queryEvents(filter);

    return {
      success: true,
      responseEvents: events,
    };
  };
}
