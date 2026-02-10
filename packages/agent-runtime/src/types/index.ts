/**
 * Agent Runtime Type Definitions
 *
 * ILP middleware type definitions for the Agent Runtime.
 */

import type { ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@agent-runtime/shared';

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
  /** Base64-encoded application data (optional) */
  data?: string;
  /** Session metadata (optional) */
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
  /** WebSocket URL of the local connector BTP endpoint (e.g., "ws://localhost:8081") */
  connectorBtpUrl?: string;
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
 * `accepted` boolean.
 *
 * @example Fulfill response
 * ```json
 * {
 *   "accepted": true,
 *   "fulfilled": true,
 *   "fulfillment": "base64...",
 *   "data": "base64..."
 * }
 * ```
 *
 * @example Reject response
 * ```json
 * {
 *   "accepted": false,
 *   "fulfilled": false,
 *   "code": "F02",
 *   "message": "No route to destination",
 *   "data": "base64..."
 * }
 * ```
 */
export interface IlpSendResponse {
  /** Whether the ILP packet was accepted (fulfilled) */
  accepted: boolean;
  /** @deprecated Use `accepted` instead. Kept for backward compatibility. */
  fulfilled?: boolean;
  /** Base64-encoded 32-byte fulfillment preimage (when accepted=true) */
  fulfillment?: string;
  /** ILP error code (when accepted=false) */
  code?: string;
  /** Human-readable error message (when accepted=false) */
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
