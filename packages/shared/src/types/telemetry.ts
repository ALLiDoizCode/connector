/**
 * Telemetry Event Type Definitions
 *
 * This module provides TypeScript type definitions for telemetry events emitted
 * by the connector to the dashboard for real-time visualization.
 *
 * Event types support settlement monitoring, account balance tracking, and
 * network activity visualization.
 *
 * @packageDocumentation
 */

/**
 * Telemetry Event Type Discriminator
 *
 * Enumeration of all telemetry event types emitted by the connector.
 * Each event type corresponds to a specific telemetry event interface.
 */
export enum TelemetryEventType {
  /** Node status event - emitted on startup/shutdown/state change */
  NODE_STATUS = 'NODE_STATUS',
  /** Packet received event - emitted when ILP packet received */
  PACKET_RECEIVED = 'PACKET_RECEIVED',
  /** Packet forwarded event - emitted when ILP packet forwarded */
  PACKET_FORWARDED = 'PACKET_FORWARDED',
  /** Account balance event - emitted when account balance changes (Story 6.8) */
  ACCOUNT_BALANCE = 'ACCOUNT_BALANCE',
  /** Settlement triggered event - emitted when settlement threshold exceeded (Story 6.6) */
  SETTLEMENT_TRIGGERED = 'SETTLEMENT_TRIGGERED',
  /** Settlement completed event - emitted when settlement execution completes (Story 6.7) */
  SETTLEMENT_COMPLETED = 'SETTLEMENT_COMPLETED',
}

/**
 * Settlement State Enumeration
 *
 * Tracks the current state of settlement for a peer account.
 * Used by SettlementMonitor (Story 6.6) to prevent duplicate settlement triggers.
 */
export enum SettlementState {
  /** No settlement in progress, normal operation */
  IDLE = 'IDLE',
  /** Settlement threshold exceeded, settlement queued */
  SETTLEMENT_PENDING = 'SETTLEMENT_PENDING',
  /** Settlement execution in progress */
  SETTLEMENT_IN_PROGRESS = 'SETTLEMENT_IN_PROGRESS',
}

/**
 * Account Balance Telemetry Event
 *
 * Emitted whenever an account balance changes due to packet forwarding or settlement.
 * Sent by AccountManager (Story 6.3) after recordPacketTransfers() or recordSettlement().
 *
 * **BigInt Serialization:** All balance fields are strings (bigint values serialized as
 * strings for JSON compatibility). Use `BigInt(value)` to convert back to bigint.
 *
 * **Emission Points:**
 * - After packet forward: AccountManager.recordPacketTransfers()
 * - After settlement: AccountManager.recordSettlement()
 *
 * **Dashboard Usage:**
 * - SettlementStatusPanel displays balance table with color-coded thresholds
 * - NetworkGraph shows balance badges on peer nodes
 * - SettlementTimeline tracks balance changes over time
 *
 * @example
 * ```typescript
 * const event: AccountBalanceEvent = {
 *   type: 'ACCOUNT_BALANCE',
 *   nodeId: 'connector-a',
 *   peerId: 'peer-b',
 *   tokenId: 'ILP',
 *   debitBalance: '0',
 *   creditBalance: '1000',
 *   netBalance: '-1000',
 *   creditLimit: '10000',
 *   settlementThreshold: '5000',
 *   settlementState: SettlementState.IDLE,
 *   timestamp: '2026-01-03T12:00:00.000Z'
 * };
 * ```
 */
export interface AccountBalanceEvent {
  /** Event type discriminator */
  type: 'ACCOUNT_BALANCE';
  /** Connector node ID emitting this event */
  nodeId: string;
  /** Peer account ID (connector peered with) */
  peerId: string;
  /** Token ID (e.g., 'ILP', 'ETH', 'XRP') */
  tokenId: string;
  /** Debit balance (amount we owe peer), bigint as string */
  debitBalance: string;
  /** Credit balance (amount peer owes us), bigint as string */
  creditBalance: string;
  /** Net balance (debitBalance - creditBalance), bigint as string */
  netBalance: string;
  /** Credit limit (max peer can owe us), bigint as string, optional */
  creditLimit?: string;
  /** Settlement threshold (balance triggers settlement), bigint as string, optional */
  settlementThreshold?: string;
  /** Current settlement state */
  settlementState: SettlementState;
  /** Event timestamp (ISO 8601 format) */
  timestamp: string;
}

/**
 * Settlement Triggered Telemetry Event
 *
 * Emitted when SettlementMonitor (Story 6.6) detects a settlement threshold crossing.
 * Indicates that a settlement has been queued for execution.
 *
 * **Trigger Conditions:**
 * - Threshold exceeded: creditBalance >= settlementThreshold
 * - Manual trigger: Operator manually triggers settlement via API
 *
 * **BigInt Serialization:** All balance fields are strings (bigint serialized for JSON).
 *
 * **Dashboard Usage:**
 * - SettlementTimeline shows trigger event with threshold details
 * - SettlementStatusPanel updates peer state to SETTLEMENT_PENDING
 *
 * @example
 * ```typescript
 * const event: SettlementTriggeredEvent = {
 *   type: 'SETTLEMENT_TRIGGERED',
 *   nodeId: 'connector-a',
 *   peerId: 'peer-b',
 *   tokenId: 'ILP',
 *   currentBalance: '5500',
 *   threshold: '5000',
 *   exceedsBy: '500',
 *   triggerReason: 'THRESHOLD_EXCEEDED',
 *   timestamp: '2026-01-03T12:00:00.000Z'
 * };
 * ```
 */
export interface SettlementTriggeredEvent {
  /** Event type discriminator */
  type: 'SETTLEMENT_TRIGGERED';
  /** Connector node ID triggering settlement */
  nodeId: string;
  /** Peer account ID requiring settlement */
  peerId: string;
  /** Token ID */
  tokenId: string;
  /** Current balance when triggered, bigint as string */
  currentBalance: string;
  /** Settlement threshold that was exceeded, bigint as string */
  threshold: string;
  /** Amount over threshold (currentBalance - threshold), bigint as string */
  exceedsBy: string;
  /** Trigger reason: 'THRESHOLD_EXCEEDED' (automatic) or 'MANUAL' (operator-initiated) */
  triggerReason: string;
  /** Event timestamp (ISO 8601 format) */
  timestamp: string;
}

/**
 * Settlement Completed Telemetry Event
 *
 * Emitted when SettlementAPI (Story 6.7) completes settlement execution.
 * Reports the settlement outcome (success/failure) and balance changes.
 *
 * **Settlement Types:**
 * - 'MOCK': Mock settlement (Story 6.7) - TigerBeetle transfer only, no blockchain
 * - 'EVM': Ethereum settlement (Epic 7) - EVM blockchain payment
 * - 'XRP': XRP Ledger settlement (Epic 8) - XRP Ledger payment
 *
 * **BigInt Serialization:** All balance fields are strings (bigint serialized for JSON).
 *
 * **Dashboard Usage:**
 * - SettlementTimeline shows completion event with success/failure indicator
 * - SettlementStatusPanel updates peer balance to newBalance
 * - NetworkGraph updates balance badges to reflect settlement
 *
 * @example
 * ```typescript
 * // Successful settlement
 * const successEvent: SettlementCompletedEvent = {
 *   type: 'SETTLEMENT_COMPLETED',
 *   nodeId: 'connector-a',
 *   peerId: 'peer-b',
 *   tokenId: 'ILP',
 *   previousBalance: '5500',
 *   newBalance: '0',
 *   settledAmount: '5500',
 *   settlementType: 'MOCK',
 *   success: true,
 *   timestamp: '2026-01-03T12:01:00.000Z'
 * };
 *
 * // Failed settlement
 * const failureEvent: SettlementCompletedEvent = {
 *   type: 'SETTLEMENT_COMPLETED',
 *   nodeId: 'connector-a',
 *   peerId: 'peer-b',
 *   tokenId: 'ILP',
 *   previousBalance: '5500',
 *   newBalance: '5500',
 *   settledAmount: '0',
 *   settlementType: 'MOCK',
 *   success: false,
 *   errorMessage: 'TigerBeetle transfer failed: insufficient balance',
 *   timestamp: '2026-01-03T12:01:00.000Z'
 * };
 * ```
 */
export interface SettlementCompletedEvent {
  /** Event type discriminator */
  type: 'SETTLEMENT_COMPLETED';
  /** Connector node ID completing settlement */
  nodeId: string;
  /** Peer account ID settled with */
  peerId: string;
  /** Token ID */
  tokenId: string;
  /** Balance before settlement, bigint as string */
  previousBalance: string;
  /** Balance after settlement, bigint as string */
  newBalance: string;
  /** Amount settled (previousBalance - newBalance), bigint as string */
  settledAmount: string;
  /** Settlement type: 'MOCK' (Story 6.7), 'EVM' (Epic 7), 'XRP' (Epic 8) */
  settlementType: string;
  /** Settlement execution result: true=success, false=failure */
  success: boolean;
  /** Error message if success=false, undefined if success=true */
  errorMessage?: string;
  /** Event timestamp (ISO 8601 format) */
  timestamp: string;
}

/**
 * Telemetry Event Union Type
 *
 * Discriminated union of all telemetry event types.
 * Use `event.type` to narrow to specific event interface.
 *
 * @example
 * ```typescript
 * function handleTelemetryEvent(event: TelemetryEvent): void {
 *   switch (event.type) {
 *     case 'ACCOUNT_BALANCE':
 *       console.log(`Balance updated: ${event.peerId} = ${event.creditBalance}`);
 *       break;
 *     case 'SETTLEMENT_TRIGGERED':
 *       console.log(`Settlement triggered: ${event.peerId}, threshold exceeded by ${event.exceedsBy}`);
 *       break;
 *     case 'SETTLEMENT_COMPLETED':
 *       console.log(`Settlement ${event.success ? 'succeeded' : 'failed'}: ${event.peerId}`);
 *       break;
 *     default:
 *       console.log(`Unknown event type: ${event.type}`);
 *   }
 * }
 * ```
 */
export type TelemetryEvent =
  | AccountBalanceEvent
  | SettlementTriggeredEvent
  | SettlementCompletedEvent;
