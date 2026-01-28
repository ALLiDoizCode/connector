/**
 * DVM (Data Vending Machine) Module - NIP-90 Compatibility
 *
 * This module provides parsing and formatting for NIP-90 DVM job requests and results,
 * enabling interoperability with the Nostr DVM ecosystem.
 */

// Types
export type {
  DVMJobRequest,
  DVMInput,
  DVMInputType,
  DVMErrorCode,
  DVMJobResult,
  DVMResultEvent,
  DVMResultStatus,
  DVMFeedback,
  DVMFeedbackEvent,
  DVMFeedbackStatus,
  ResolvedDependency,
  ResolvedDependencies,
  TaskPriority,
  TaskDelegationRequest,
  TaskDelegationResult,
  TokenMetrics,
  TaskState,
  TaskTrackingMetadata,
  TaskFeedback,
} from './types';

// Constants and Error class
export {
  DVM_KIND_RANGE,
  DVM_RESULT_KIND_OFFSET,
  DVM_FEEDBACK_KIND,
  DVM_ERROR_CODES,
  DVMParseError,
} from './types';

// Parser
export { parseDVMJobRequest, parseTaskDelegationRequest } from './dvm-job-parser';

// Result formatter
export {
  formatDVMJobResult,
  formatDVMErrorResult,
  formatTaskDelegationResult,
} from './dvm-result-formatter';

// Feedback formatter
export {
  formatDVMFeedback,
  formatTaskFeedback,
  createProgressTag,
  createEtaTag,
} from './dvm-feedback';

// Job resolver (for job chaining)
export { resolveJobDependencies } from './job-resolver';

// Task status tracker (Story 17.8)
export {
  TaskStatusTracker,
  DEFAULT_TASK_TRACKING_CONFIG,
  type TaskTrackingConfig,
  type FeedbackEmitter,
} from './task-status-tracker';
