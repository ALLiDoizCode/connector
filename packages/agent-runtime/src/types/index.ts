/**
 * Agent Runtime Type Definitions
 *
 * This module provides TypeScript type definitions for the Agent Runtime,
 * which handles ILP/SPSP/STREAM protocol complexity for business logic agents.
 */

import type { ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@agent-runtime/shared';

/**
 * Payment session stored by the runtime.
 * Contains the shared secret for STREAM fulfillment computation.
 */
export interface PaymentSession {
  /** Unique payment identifier (used as ILP address suffix) */
  paymentId: string;
  /** 32-byte STREAM shared secret for fulfillment computation */
  sharedSecret: Buffer;
  /** Full ILP destination address for this payment */
  destinationAddress: string;
  /** Optional metadata from SPSP setup */
  metadata?: Record<string, string>;
  /** When the session was created */
  createdAt: Date;
  /** When the session expires (optional) */
  expiresAt?: Date;
}

/**
 * Payment request sent to business logic handler.
 * Simplified representation of an incoming ILP payment.
 */
export interface PaymentRequest {
  /** Unique payment identifier */
  paymentId: string;
  /** Full destination address */
  destination: string;
  /** Amount in smallest unit (as string for precision) */
  amount: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
  /** Decoded STREAM data (base64) */
  data?: string;
  /** Session metadata from SPSP setup */
  metadata?: Record<string, string>;
}

/**
 * Response from business logic handler.
 * Determines whether to fulfill or reject the payment.
 */
export interface PaymentResponse {
  /** Whether to accept (fulfill) the payment */
  accept: boolean;
  /** Optional response data (base64) for fulfill packet */
  data?: string;
  /** Rejection reason if accept is false */
  rejectReason?: {
    /** Error code (e.g., 'insufficient_funds', 'expired', 'invalid_request') */
    code: string;
    /** Human-readable error message */
    message: string;
  };
}

/**
 * Request from connector to agent runtime for local delivery.
 * Represents an ILP Prepare packet destined for this agent.
 */
export interface LocalDeliveryRequest {
  /** Full ILP destination address */
  destination: string;
  /** Amount in smallest unit (as string for precision) */
  amount: string;
  /** Execution condition (base64-encoded 32-byte hash) */
  executionCondition: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
  /** Prepare packet data (base64) */
  data: string;
  /** Peer that sent this packet */
  sourcePeer: string;
}

/**
 * Response from agent runtime to connector.
 * Contains either a fulfill or reject response.
 */
export interface LocalDeliveryResponse {
  /** Fulfill response (mutually exclusive with reject) */
  fulfill?: {
    /** Fulfillment preimage (base64-encoded 32-byte value) */
    fulfillment: string;
    /** Optional response data (base64) */
    data?: string;
  };
  /** Reject response (mutually exclusive with fulfill) */
  reject?: {
    /** ILP error code (F00-F99, T00-T99, R00-R99) */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Optional error data (base64) */
    data?: string;
  };
}

/**
 * SPSP (Simple Payment Setup Protocol) response.
 * Returned when a sender queries the SPSP endpoint.
 *
 * @see https://interledger.org/rfcs/0009-simple-payment-setup-protocol/
 */
export interface SPSPResponse {
  /** Full ILP destination address for this payment */
  destination_account: string;
  /** Base64-encoded shared secret for STREAM */
  shared_secret: string;
}

/**
 * Optional hook called when SPSP endpoint is queried.
 * Allows business logic to customize payment setup.
 */
export interface PaymentSetupRequest {
  /** Payment ID from the SPSP query path */
  paymentId?: string;
  /** Query parameters from SPSP request */
  queryParams?: Record<string, string>;
}

/**
 * Response from payment setup hook.
 */
export interface PaymentSetupResponse {
  /** Whether to allow this payment setup */
  allow: boolean;
  /** Optional metadata to attach to the session */
  metadata?: Record<string, string>;
  /** Custom payment ID (if not provided, one is generated) */
  paymentId?: string;
  /** Error message if allow is false */
  errorMessage?: string;
}

/**
 * Agent Runtime configuration.
 */
export interface AgentRuntimeConfig {
  /** HTTP server port (default: 3100) */
  port: number;
  /** ILP address prefix (e.g., "g.connector.agent") */
  baseAddress: string;
  /** URL to business logic handler (e.g., "http://business:8080") */
  businessLogicUrl: string;
  /** Timeout for business logic calls in ms (default: 5000) */
  businessLogicTimeout?: number;
  /** Enable SPSP endpoint (default: true) */
  spspEnabled?: boolean;
  /** Session TTL in ms (default: 3600000 = 1 hour) */
  sessionTtlMs?: number;
  /** Log level (default: 'info') */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Node ID for logging (default: 'agent-runtime') */
  nodeId?: string;
}

/**
 * Resolved configuration with defaults applied.
 */
export interface ResolvedAgentRuntimeConfig extends Required<AgentRuntimeConfig> {}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Partial<AgentRuntimeConfig> = {
  port: 3100,
  businessLogicTimeout: 5000,
  spspEnabled: true,
  sessionTtlMs: 3600000, // 1 hour
  logLevel: 'info',
  nodeId: 'agent-runtime',
};

/**
 * Map business logic reject codes to ILP error codes.
 */
export const REJECT_CODE_MAP: Record<string, string> = {
  insufficient_funds: 'T04',
  expired: 'R00',
  invalid_request: 'F00',
  invalid_amount: 'F03',
  unexpected_payment: 'F06',
  application_error: 'F99',
  internal_error: 'T00',
  timeout: 'T00',
};

/**
 * Request body for `POST /ilp/send`.
 *
 * Used by the BLS to initiate outbound ILP packets through the agent-runtime.
 *
 * @example
 * ```json
 * {
 *   "destination": "g.connector.peer1",
 *   "amount": "1500000",
 *   "data": "SGVsbG8gV29ybGQ=",
 *   "timeoutMs": 30000
 * }
 * ```
 */
export interface IlpSendRequest {
  /** Valid ILP address (RFC-0015) */
  destination: string;
  /** Non-negative integer string (e.g., "0", "1500000") */
  amount: string;
  /** Base64-encoded application data (max 64KB decoded) */
  data: string;
  /** Optional timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * Response body for `POST /ilp/send`.
 *
 * Both FULFILL and REJECT ILP responses return HTTP 200, distinguished by the
 * `fulfilled` boolean.
 *
 * @example Fulfill response
 * ```json
 * {
 *   "fulfilled": true,
 *   "fulfillment": "base64...",
 *   "data": "base64..."
 * }
 * ```
 *
 * @example Reject response
 * ```json
 * {
 *   "fulfilled": false,
 *   "code": "F02",
 *   "message": "No route to destination",
 *   "data": "base64..."
 * }
 * ```
 */
export interface IlpSendResponse {
  /** Whether the ILP packet was fulfilled */
  fulfilled: boolean;
  /** Base64-encoded 32-byte fulfillment preimage (when fulfilled=true) */
  fulfillment?: string;
  /** ILP error code (when fulfilled=false) */
  code?: string;
  /** Human-readable error message (when fulfilled=false) */
  message?: string;
  /** Base64-encoded response data (optional in both cases) */
  data?: string;
}

/**
 * Interface for sending outbound ILP packets.
 *
 * Story 20.2's `OutboundBTPClient` will implement this interface.
 * During Story 20.1, a mock implementation is used for testing.
 */
export interface IPacketSender {
  /** Send an ILP Prepare packet and return the response (Fulfill or Reject). */
  sendPacket(prepare: ILPPreparePacket): Promise<ILPFulfillPacket | ILPRejectPacket>;
  /** Check whether the sender is connected and ready to send packets. */
  isConnected(): boolean;
}
