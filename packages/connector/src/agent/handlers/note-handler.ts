import type { EventHandler, EventHandlerResult } from '../event-handler';
import { DatabaseSizeExceededError } from '../event-database';

/**
 * Creates a handler for Kind 1 (Note/Text) events.
 *
 * The note handler stores incoming events in the database. Subscription
 * matching and BTP push is handled by AgentNode (Story 13.6) after the
 * handler returns success.
 *
 * @returns EventHandler function for Kind 1 events
 *
 * @example
 * ```typescript
 * const noteHandler = createNoteHandler();
 * agentEventHandler.registerHandler({
 *   kind: 1,
 *   handler: noteHandler,
 *   requiredPayment: 1000n,
 *   description: 'Note storage',
 * });
 * ```
 */
export function createNoteHandler(): EventHandler {
  return async (context): Promise<EventHandlerResult> => {
    try {
      await context.database.storeEvent(context.event);
      return { success: true };
    } catch (error) {
      if (error instanceof DatabaseSizeExceededError) {
        return {
          success: false,
          error: {
            code: 'T00',
            message: 'Storage limit exceeded',
          },
        };
      }
      throw error;
    }
  };
}
