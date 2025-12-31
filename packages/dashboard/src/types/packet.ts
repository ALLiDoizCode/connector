/**
 * Packet detail types for inspection panel
 */

import { TelemetryEvent } from '../hooks/useTelemetry';

/**
 * Detailed packet information for inspection panel
 * Aggregated from PACKET_RECEIVED and PACKET_SENT telemetry events
 */
export interface PacketDetail {
  /** Unique packet identifier (from telemetry packetId) */
  packetId: string;

  /** Packet type for conditional field display */
  type: 'PREPARE' | 'FULFILL' | 'REJECT';

  /** ISO 8601 timestamp when packet received */
  timestamp: string;

  /** Source connector node ID */
  sourceNodeId: string;

  /** ILP destination address (hierarchical, e.g., "g.connectorC.dest") */
  destinationAddress: string;

  // PREPARE-specific fields
  /** Transfer amount in smallest unit (only for PREPARE) */
  amount?: string;

  /** Execution condition as hex string (only for PREPARE) */
  executionCondition?: string;

  /** Expiration timestamp ISO 8601 (only for PREPARE) */
  expiresAt?: string;

  // FULFILL-specific fields
  /** Fulfillment preimage as hex string (only for FULFILL) */
  fulfillment?: string;

  // REJECT-specific fields
  /** ILP error code (e.g., "F02", "T01") (only for REJECT) */
  errorCode?: string;

  /** Human-readable error message (only for REJECT) */
  errorMessage?: string;

  /** Connector that triggered the error (only for REJECT) */
  triggeredBy?: string;

  // Common fields
  /** Application data payload as hex string (all packet types) */
  dataPayload?: string;

  /** Sequence of connector node IDs packet traversed (built from PACKET_SENT events) */
  routingPath: string[];
}

/**
 * Parse telemetry event into PacketDetail object
 * Returns null if event is not PACKET_RECEIVED or missing required fields
 */
export function parsePacketDetail(event: TelemetryEvent): PacketDetail | null {
  if (event.type !== 'PACKET_RECEIVED') return null;

  const packetId = event.data.packetId as string | undefined;
  const packetType = event.data.packetType as 'PREPARE' | 'FULFILL' | 'REJECT' | undefined;

  if (!packetId || !packetType) return null;

  return {
    packetId,
    type: packetType,
    timestamp: event.timestamp,
    sourceNodeId: event.nodeId,
    destinationAddress: (event.data.destination as string) || 'Unknown',
    amount: event.data.amount as string | undefined,
    executionCondition: event.data.executionCondition as string | undefined,
    expiresAt: event.data.expiresAt as string | undefined,
    fulfillment: event.data.fulfillment as string | undefined,
    errorCode: event.data.errorCode as string | undefined,
    errorMessage: event.data.message as string | undefined,
    triggeredBy: event.data.triggeredBy as string | undefined,
    dataPayload: event.data.data as string | undefined,
    routingPath: [], // Initially empty, populated from PACKET_SENT events
  };
}

/**
 * Format binary data (hex string) for display
 * Adds spaces every 2 bytes for readability
 */
export function formatHex(hex: string): string {
  const cleaned = hex.replace(/^0x/, '').toUpperCase();
  return cleaned.match(/.{1,2}/g)?.join(' ') || cleaned;
}

/**
 * Truncate long hex string for UI display
 * Shows first N chars + "..." + last 8 chars
 */
export function truncateHex(hex: string, maxChars: number = 32): string {
  if (hex.length <= maxChars) return hex;
  const firstPart = hex.substring(0, maxChars);
  const lastPart = hex.substring(hex.length - 8);
  return `${firstPart}...${lastPart}`;
}
