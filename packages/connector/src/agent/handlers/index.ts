/**
 * Built-in Event Kind Handlers
 *
 * This module exports handlers for core Nostr event kinds:
 * - Kind 1 (Note): Store locally, push to matching subscriptions
 * - Kind 3 (Follow): Update routing table via FollowGraphRouter
 * - Kind 5 (Delete): Remove events from database
 * - Kind 10000 (Query): Query database, return results
 */

// Note Handler (Kind 1)
export { createNoteHandler } from './note-handler';

// Follow Handler (Kind 3)
export { createFollowHandler } from './follow-handler';
export type { FollowHandlerConfig } from './follow-handler';

// Delete Handler (Kind 5)
export { createDeleteHandler } from './delete-handler';
export type { DeleteHandlerConfig } from './delete-handler';

// Query Handler (Kind 10000)
export { createQueryHandler } from './query-handler';
export type { QueryHandlerConfig } from './query-handler';

// Handler Registration Helper
export { registerBuiltInHandlers } from './register-built-in-handlers';
export type { BuiltInHandlersConfig } from './register-built-in-handlers';
