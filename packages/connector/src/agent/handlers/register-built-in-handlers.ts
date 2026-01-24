import type { Logger } from 'pino';
import type { AgentEventHandler } from '../event-handler';
import type { FollowGraphRouter } from '../follow-graph-router';
import { createNoteHandler } from './note-handler';
import { createFollowHandler } from './follow-handler';
import { createDeleteHandler } from './delete-handler';
import { createQueryHandler } from './query-handler';

/**
 * Configuration for built-in handler registration.
 */
export interface BuiltInHandlersConfig {
  /** FollowGraphRouter instance for Kind 3 handler */
  followGraphRouter: FollowGraphRouter;
  /** Pricing configuration for each handler */
  pricing: {
    /** Cost for Kind 1 (Note storage) */
    noteStorage: bigint;
    /** Cost for Kind 3 (Follow list update) */
    followUpdate: bigint;
    /** Cost for Kind 5 (Event deletion) */
    deletion: bigint;
    /** Base cost for Kind 10000 (Query) */
    queryBase: bigint;
    /** Additional cost per query result (informational) */
    queryPerResult?: bigint;
  };
  /** Query handler configuration */
  queryConfig?: {
    /** Maximum results to return (default: 100) */
    maxResults?: number;
  };
  /** Pino logger instance */
  logger?: Logger;
}

/**
 * Registers all built-in event kind handlers with the AgentEventHandler.
 *
 * This helper function creates and registers handlers for:
 * - Kind 1 (Note): Store events in database
 * - Kind 3 (Follow): Update routing table via FollowGraphRouter
 * - Kind 5 (Delete): Remove events from database
 * - Kind 10000 (Query): Query database and return results
 *
 * @param eventHandler - AgentEventHandler instance to register handlers with
 * @param config - Configuration including pricing and dependencies
 *
 * @example
 * ```typescript
 * const eventHandler = new AgentEventHandler({
 *   agentPubkey: 'my-pubkey',
 *   database: eventDatabase,
 *   logger: pino(),
 * });
 *
 * registerBuiltInHandlers(eventHandler, {
 *   followGraphRouter: router,
 *   pricing: {
 *     noteStorage: 1000n,
 *     followUpdate: 500n,
 *     deletion: 100n,
 *     queryBase: 200n,
 *     queryPerResult: 10n,
 *   },
 *   logger: pino(),
 * });
 * ```
 */
export function registerBuiltInHandlers(
  eventHandler: AgentEventHandler,
  config: BuiltInHandlersConfig
): void {
  const logger = config.logger?.child({ component: 'BuiltInHandlers' }) ?? {
    info: () => {},
  };

  // Register Kind 1 (Note) handler
  eventHandler.registerHandler({
    kind: 1,
    handler: createNoteHandler(),
    requiredPayment: config.pricing.noteStorage,
    description: 'Note storage',
  });

  // Register Kind 3 (Follow) handler
  eventHandler.registerHandler({
    kind: 3,
    handler: createFollowHandler({
      followGraphRouter: config.followGraphRouter,
      persistToDatabase: true,
    }),
    requiredPayment: config.pricing.followUpdate,
    description: 'Follow list update',
  });

  // Register Kind 5 (Delete) handler
  eventHandler.registerHandler({
    kind: 5,
    handler: createDeleteHandler({
      logger: config.logger,
    }),
    requiredPayment: config.pricing.deletion,
    description: 'Event deletion',
  });

  // Register Kind 10000 (Query) handler
  eventHandler.registerHandler({
    kind: 10000,
    handler: createQueryHandler({
      maxResults: config.queryConfig?.maxResults,
      perResultPayment: config.pricing.queryPerResult,
    }),
    requiredPayment: config.pricing.queryBase,
    description: 'Query service',
  });

  logger.info('Built-in handlers registered');
}
