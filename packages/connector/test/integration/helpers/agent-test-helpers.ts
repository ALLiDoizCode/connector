/**
 * Test Helpers for Agent Multi-Agent Integration Tests
 *
 * Provides utility functions for creating test events, packets, and agent configurations.
 */

import * as crypto from 'crypto';
import { AgentNode } from '../../../src/agent/agent-node';
import type { AgentNodeConfig, AgentTelemetryEvent } from '../../../src/agent/agent-node';
import { ToonCodec } from '../../../src/agent/toon-codec';
import type { NostrEvent } from '../../../src/agent/toon-codec';
import { ILPPreparePacket, PacketType, ILPErrorCode } from '@m2m/shared';
import { getPublicKey } from 'nostr-tools';

// ============================================
// Test Constants
// ============================================

export const AGENT_A_PRIVKEY = 'a'.repeat(64); // Test agent A
export const AGENT_B_PRIVKEY = 'b'.repeat(64); // Test agent B
export const AGENT_C_PRIVKEY = 'c'.repeat(64); // Test agent C (for multi-hop)

export const AGENT_A_PUBKEY = getPublicKey(Buffer.from(AGENT_A_PRIVKEY, 'hex'));
export const AGENT_B_PUBKEY = getPublicKey(Buffer.from(AGENT_B_PRIVKEY, 'hex'));
export const AGENT_C_PUBKEY = getPublicKey(Buffer.from(AGENT_C_PRIVKEY, 'hex'));

// Deterministic fulfillment for agent service requests
export const AGENT_FULFILLMENT = Buffer.alloc(32, 0);
export const AGENT_CONDITION = crypto.createHash('sha256').update(AGENT_FULFILLMENT).digest();

// Default pricing for tests
export const DEFAULT_TEST_PRICING = {
  noteStorage: 100n,
  followUpdate: 50n,
  deletion: 10n,
  queryBase: 200n,
  queryPerResult: 5n,
};

// ============================================
// TOON Codec Instance
// ============================================

export const toonCodec = new ToonCodec();

// ============================================
// Event Creation Helpers
// ============================================

let eventCounter = 0;

/**
 * Creates a test Nostr event with optional overrides.
 *
 * @param overrides - Partial NostrEvent to merge with defaults
 * @returns A complete NostrEvent
 */
export function createTestNostrEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  eventCounter++;
  const timestamp = Math.floor(Date.now() / 1000);

  const event: NostrEvent = {
    id: crypto.randomBytes(32).toString('hex'),
    pubkey: overrides?.pubkey ?? AGENT_A_PUBKEY,
    created_at: timestamp,
    kind: 1,
    tags: [],
    content: `Test event ${eventCounter}`,
    sig: crypto.randomBytes(64).toString('hex'),
    ...overrides,
  };

  return event;
}

/**
 * Creates a test ILP Prepare packet containing a TOON-encoded Nostr event.
 *
 * @param event - The Nostr event to encode
 * @param amount - Payment amount (bigint)
 * @param destination - ILP destination address
 * @returns ILPPreparePacket
 */
export function createTestILPPreparePacket(
  event: NostrEvent,
  amount: bigint,
  destination: string
): ILPPreparePacket {
  return {
    type: PacketType.PREPARE,
    amount,
    destination,
    executionCondition: AGENT_CONDITION,
    expiresAt: new Date(Date.now() + 30000), // 30 seconds from now
    data: toonCodec.encode(event),
  };
}

/**
 * Creates a test AgentNodeConfig with optional overrides.
 *
 * @param overrides - Partial config to merge with defaults
 * @returns Complete AgentNodeConfig
 */
export function createTestAgentConfig(overrides?: Partial<AgentNodeConfig>): AgentNodeConfig {
  return {
    agentPubkey: overrides?.agentPubkey ?? AGENT_A_PUBKEY,
    agentPrivkey: overrides?.agentPrivkey,
    databasePath: ':memory:',
    databaseMaxSize: overrides?.databaseMaxSize,
    pricing: overrides?.pricing ?? { ...DEFAULT_TEST_PRICING },
    enableBuiltInHandlers: overrides?.enableBuiltInHandlers ?? true,
    maxSubscriptionsPerPeer: overrides?.maxSubscriptionsPerPeer ?? 10,
    ...overrides,
  };
}

/**
 * Creates and initializes an AgentNode with optional config overrides.
 *
 * @param overrides - Partial config to merge with defaults
 * @returns Initialized AgentNode
 */
export async function createInitializedAgent(
  overrides?: Partial<AgentNodeConfig>
): Promise<AgentNode> {
  const config = createTestAgentConfig(overrides);
  const agent = new AgentNode(config);
  await agent.initialize();
  return agent;
}

/**
 * Creates a telemetry collector for capturing events.
 *
 * @returns Object with events array and collector function
 */
export function createTelemetryCollector(): {
  events: AgentTelemetryEvent[];
  collector: (event: AgentTelemetryEvent) => void;
} {
  const events: AgentTelemetryEvent[] = [];
  const collector = (event: AgentTelemetryEvent) => events.push(event);
  return { events, collector };
}

// ============================================
// Packet Type Helpers
// ============================================

export { PacketType, ILPErrorCode };

/**
 * Helper to check if response is a Fulfill packet.
 */
export function isFulfill(response: {
  type: PacketType;
}): response is { type: PacketType.FULFILL; fulfillment: Buffer; data: Buffer } {
  return response.type === PacketType.FULFILL;
}

/**
 * Helper to check if response is a Reject packet.
 */
export function isReject(response: {
  type: PacketType;
}): response is { type: PacketType.REJECT; code: ILPErrorCode; message: string; data: Buffer } {
  return response.type === PacketType.REJECT;
}

// ============================================
// Re-exports for convenience
// ============================================

export type { NostrEvent, AgentNodeConfig, AgentTelemetryEvent };
export { AgentNode, ToonCodec, getPublicKey };
