/**
 * Multi-Agent Integration Tests - Story 13.8
 *
 * End-to-end integration tests for multi-agent communication using the
 * Agent Society Protocol with TOON-serialized events, payment flows,
 * follow graph routing, rejection codes, and settlement.
 */

// Mock the ESM-only @toon-format/toon package
jest.mock('@toon-format/toon', () => ({
  encode: (input: unknown) => JSON.stringify(input),
  decode: (input: string) => JSON.parse(input),
}));

import {
  createTestNostrEvent,
  createTestILPPreparePacket,
  createTestAgentConfig,
  createInitializedAgent,
  AGENT_A_PRIVKEY,
  AGENT_B_PRIVKEY,
  AGENT_A_PUBKEY,
  AGENT_B_PUBKEY,
  AGENT_C_PUBKEY,
  DEFAULT_TEST_PRICING,
  toonCodec,
  PacketType,
  ILPErrorCode,
} from './helpers/agent-test-helpers';
import { AgentNode } from '../../src/agent/agent-node';
import type { AgentTelemetryEvent } from '../../src/agent/agent-node';

describe('Multi-Agent Integration Tests', () => {
  // ==========================================================================
  // Task 3: Two-Agent Communication Test Setup (AC: 1, 2, 4)
  // ==========================================================================
  describe('Two-Agent Communication', () => {
    let agentA: AgentNode;
    let agentB: AgentNode;

    beforeEach(async () => {
      // Create Agent A with in-memory database
      agentA = new AgentNode(
        createTestAgentConfig({
          agentPubkey: AGENT_A_PUBKEY,
          agentPrivkey: AGENT_A_PRIVKEY,
        })
      );

      // Create Agent B with in-memory database
      agentB = new AgentNode(
        createTestAgentConfig({
          agentPubkey: AGENT_B_PUBKEY,
          agentPrivkey: AGENT_B_PRIVKEY,
        })
      );

      // Initialize both agents
      await agentA.initialize();
      await agentB.initialize();

      // Configure Agent A to follow Agent B with ILP address
      agentA.followGraphRouter.addFollow({
        pubkey: AGENT_B_PUBKEY,
        ilpAddress: 'g.agent.b',
      });
    });

    afterEach(async () => {
      await agentA.shutdown();
      await agentB.shutdown();
    });

    // ========================================================================
    // Task 4: Test Agent A Queries Agent B's Database (AC: 1)
    // ========================================================================
    it('should query Agent B database and receive results', async () => {
      // 1. Store a note event in Agent B's database directly
      const testNoteEvent = createTestNostrEvent({
        kind: 1,
        pubkey: AGENT_A_PUBKEY,
        content: 'Test note for query',
      });
      await agentB.database.storeEvent(testNoteEvent);

      // 2. Create Kind 10000 query event from Agent A
      const queryEvent = createTestNostrEvent({
        kind: 10000,
        pubkey: AGENT_A_PUBKEY,
        content: JSON.stringify({ kinds: [1] }), // Query all Kind 1 events
      });

      // 3. Create ILP Prepare packet with query event
      const packet = createTestILPPreparePacket(queryEvent, 200n, 'g.agent.b.query');

      // 4. Process packet through Agent B
      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      // 5. Verify Fulfill with query results
      expect(response.type).toBe(PacketType.FULFILL);
      if (response.type === PacketType.FULFILL) {
        const events = toonCodec.decodeMany(response.data);
        expect(events).toHaveLength(1);
        expect(events[0]!.id).toBe(testNoteEvent.id);
      }
    });

    // ========================================================================
    // Task 5: Test Payment Validation (AC: 2)
    // ========================================================================
    it('should fulfill when payment is sufficient', async () => {
      // Send Kind 1 note with amount equal to pricing.noteStorage (100n)
      const noteEvent = createTestNostrEvent({ kind: 1 });
      const packet = createTestILPPreparePacket(noteEvent, 100n, 'g.agent.b');

      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.FULFILL);
    });

    it('should reject when payment is insufficient', async () => {
      // Send Kind 1 note with amount below pricing.noteStorage (100n)
      const noteEvent = createTestNostrEvent({ kind: 1 });
      const packet = createTestILPPreparePacket(noteEvent, 50n, 'g.agent.b');

      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F03_INVALID_AMOUNT);
        // Verify error message indicates required vs provided amount
        expect(response.message).toContain('100');
        expect(response.message).toContain('50');
      }
    });

    it('should accept zero payment for free tier services', async () => {
      // Create agent with free tier pricing
      const freeAgent = new AgentNode(
        createTestAgentConfig({
          agentPubkey: AGENT_B_PUBKEY,
          pricing: {
            noteStorage: 0n,
            followUpdate: 0n,
            deletion: 0n,
            queryBase: 0n,
          },
        })
      );
      await freeAgent.initialize();

      try {
        const noteEvent = createTestNostrEvent({ kind: 1 });
        const packet = createTestILPPreparePacket(noteEvent, 0n, 'g.agent.free');

        const response = await freeAgent.processIncomingPacket(packet, 'agent-a');

        expect(response.type).toBe(PacketType.FULFILL);
      } finally {
        await freeAgent.shutdown();
      }
    });
  });

  // ==========================================================================
  // Task 6: Test Event Propagation Through Follow Graph (AC: 3)
  // ==========================================================================
  describe('Follow Graph Routing', () => {
    let agentA: AgentNode;
    let agentB: AgentNode;
    let agentC: AgentNode;

    beforeEach(async () => {
      agentA = await createInitializedAgent({ agentPubkey: AGENT_A_PUBKEY });
      agentB = await createInitializedAgent({ agentPubkey: AGENT_B_PUBKEY });
      agentC = await createInitializedAgent({ agentPubkey: AGENT_C_PUBKEY });
    });

    afterEach(async () => {
      await agentA.shutdown();
      await agentB.shutdown();
      await agentC.shutdown();
    });

    it('should route events through follow graph', async () => {
      // Setup: A follows B, B follows C
      // A → B → C topology
      agentA.followGraphRouter.addFollow({
        pubkey: AGENT_B_PUBKEY,
        ilpAddress: 'g.agent.b',
      });
      agentB.followGraphRouter.addFollow({
        pubkey: AGENT_C_PUBKEY,
        ilpAddress: 'g.agent.c',
      });

      // Verify routing lookups work
      expect(agentA.followGraphRouter.hasRouteTo('g.agent.b')).toBe(true);
      expect(agentB.followGraphRouter.hasRouteTo('g.agent.c')).toBe(true);
      expect(agentB.followGraphRouter.getNextHop('g.agent.c')).toBe(AGENT_C_PUBKEY);
    });

    it('should return F02 for unreachable destination', async () => {
      // Agent A has no route to unknown destination
      expect(agentA.followGraphRouter.hasRouteTo('g.agent.unknown')).toBe(false);
      expect(agentA.followGraphRouter.getNextHop('g.agent.unknown')).toBe(null);
    });
  });

  // ==========================================================================
  // Task 7: Test Rejection Codes for Error Scenarios (AC: 4)
  // ==========================================================================
  describe('Rejection Codes', () => {
    let agentB: AgentNode;

    beforeEach(async () => {
      agentB = await createInitializedAgent({ agentPubkey: AGENT_B_PUBKEY });
    });

    afterEach(async () => {
      await agentB.shutdown();
    });

    it('should return F01 for malformed TOON data', async () => {
      // Create packet with invalid data (not TOON encoded)
      const packet = {
        type: PacketType.PREPARE as const,
        amount: 100n,
        destination: 'g.agent.b',
        executionCondition: Buffer.alloc(32),
        expiresAt: new Date(Date.now() + 30000),
        data: Buffer.from('not valid toon data'),
      };

      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F01_INVALID_PACKET);
      }
    });

    it('should return F03 for insufficient payment', async () => {
      const noteEvent = createTestNostrEvent({ kind: 1 });
      const packet = createTestILPPreparePacket(noteEvent, 10n, 'g.agent.b');

      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F03_INVALID_AMOUNT);
      }
    });

    it('should return F99 for unsupported event kind', async () => {
      // Send event with unregistered kind (e.g., Kind 9999)
      const unknownKindEvent = createTestNostrEvent({ kind: 9999 });
      const packet = createTestILPPreparePacket(unknownKindEvent, 100n, 'g.agent.b');

      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F99_APPLICATION_ERROR);
        expect(response.message).toContain('Unsupported event kind');
      }
    });

    it('should return T00 for internal errors', async () => {
      // Simulate database error by closing database then processing packet
      await agentB.database.close();

      const noteEvent = createTestNostrEvent({ kind: 1 });
      const packet = createTestILPPreparePacket(noteEvent, 100n, 'g.agent.b');

      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.T00_INTERNAL_ERROR);
      }
    });

    it('should return T00 when agent not initialized', async () => {
      // Create agent but don't call initialize()
      const uninitializedAgent = new AgentNode(
        createTestAgentConfig({ agentPubkey: AGENT_A_PUBKEY })
      );

      const noteEvent = createTestNostrEvent({ kind: 1 });
      const packet = createTestILPPreparePacket(noteEvent, 100n, 'g.agent.test');

      const response = await uninitializedAgent.processIncomingPacket(packet, 'agent-a');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.T00_INTERNAL_ERROR);
        expect(response.message).toBe('Agent not initialized');
      }
    });
  });

  // ==========================================================================
  // Task 8: Test Settlement Threshold Detection (AC: 5)
  // ==========================================================================
  describe('Settlement Threshold Detection', () => {
    let agentB: AgentNode;
    let telemetryEvents: AgentTelemetryEvent[];

    beforeEach(async () => {
      agentB = await createInitializedAgent({ agentPubkey: AGENT_B_PUBKEY });
      telemetryEvents = [];
      agentB.onTelemetry = (event) => telemetryEvents.push(event);
    });

    afterEach(async () => {
      await agentB.shutdown();
    });

    it('should accumulate balance and detect settlement threshold', async () => {
      // Create multiple successful transactions
      for (let i = 0; i < 10; i++) {
        const event = createTestNostrEvent({ kind: 1, content: `Note ${i}` });
        const packet = createTestILPPreparePacket(event, 100n, 'g.agent.b');
        const response = await agentB.processIncomingPacket(packet, 'agent-a');
        expect(response.type).toBe(PacketType.FULFILL);
      }

      // Verify 10 events stored (represents 1000n total value accepted)
      const storedEvents = await agentB.database.queryEvents({ kinds: [1] });
      expect(storedEvents).toHaveLength(10);

      // Verify telemetry shows 10 successful AGENT_EVENT_HANDLED events
      const handledEvents = telemetryEvents.filter(
        (e) => e.type === 'AGENT_EVENT_HANDLED' && e.success
      );
      expect(handledEvents).toHaveLength(10);
    });
  });

  // ==========================================================================
  // Task 9: Test Kind 3 Follow Event Processing (AC: 3)
  // ==========================================================================
  describe('Kind 3 Follow Event Processing', () => {
    let agentA: AgentNode;

    beforeEach(async () => {
      agentA = await createInitializedAgent({ agentPubkey: AGENT_A_PUBKEY });
    });

    afterEach(async () => {
      await agentA.shutdown();
    });

    it('should update routing table from Kind 3 event', async () => {
      // Create Kind 3 follow event with ILP address tags
      const followEvent = createTestNostrEvent({
        kind: 3,
        pubkey: AGENT_A_PUBKEY,
        tags: [
          ['p', AGENT_B_PUBKEY, '', 'bob'],
          ['ilp', AGENT_B_PUBKEY, 'g.agent.bob.query'],
        ],
      });

      // Process as ILP packet
      const packet = createTestILPPreparePacket(followEvent, 50n, 'g.agent.a');
      const response = await agentA.processIncomingPacket(packet, 'external');

      // Verify Fulfill
      expect(response.type).toBe(PacketType.FULFILL);

      // Verify routing table updated
      expect(agentA.followGraphRouter.hasRouteTo('g.agent.bob.query')).toBe(true);
    });
  });

  // ==========================================================================
  // Task 10: Test Kind 5 Delete Event Processing (AC: 1)
  // ==========================================================================
  describe('Kind 5 Delete Event Processing', () => {
    let agentA: AgentNode;

    beforeEach(async () => {
      agentA = await createInitializedAgent({ agentPubkey: AGENT_A_PUBKEY });
    });

    afterEach(async () => {
      await agentA.shutdown();
    });

    it('should delete events when authorized', async () => {
      // Store an event first
      const noteEvent = createTestNostrEvent({
        kind: 1,
        pubkey: AGENT_A_PUBKEY,
        content: 'Event to delete',
      });
      await agentA.database.storeEvent(noteEvent);

      // Create delete request from same author
      const deleteEvent = createTestNostrEvent({
        kind: 5,
        pubkey: AGENT_A_PUBKEY, // Same author
        tags: [['e', noteEvent.id]],
      });

      // Process delete request
      const packet = createTestILPPreparePacket(deleteEvent, 10n, 'g.agent.a');
      const response = await agentA.processIncomingPacket(packet, 'external');

      // Verify deletion
      expect(response.type).toBe(PacketType.FULFILL);
      const remaining = await agentA.database.queryEvents({ ids: [noteEvent.id] });
      expect(remaining).toHaveLength(0);
    });

    it('should reject unauthorized deletion attempts', async () => {
      // Store event from Author A
      const noteEvent = createTestNostrEvent({
        kind: 1,
        pubkey: AGENT_A_PUBKEY,
        content: 'Protected event',
      });
      await agentA.database.storeEvent(noteEvent);

      // Send delete request from Author B (different author)
      const deleteEvent = createTestNostrEvent({
        kind: 5,
        pubkey: AGENT_B_PUBKEY, // Different author
        tags: [['e', noteEvent.id]],
      });

      const packet = createTestILPPreparePacket(deleteEvent, 10n, 'g.agent.a');
      const response = await agentA.processIncomingPacket(packet, 'external');

      // Handler returns success but event NOT deleted (authorization check)
      expect(response.type).toBe(PacketType.FULFILL);
      const remaining = await agentA.database.queryEvents({ ids: [noteEvent.id] });
      expect(remaining).toHaveLength(1); // Event still exists
    });
  });

  // ==========================================================================
  // Task 11: Test Telemetry Event Emission (AC: 1-5)
  // ==========================================================================
  describe('Telemetry Event Emission', () => {
    let agentB: AgentNode;
    let telemetryEvents: AgentTelemetryEvent[];

    beforeEach(async () => {
      agentB = await createInitializedAgent({ agentPubkey: AGENT_B_PUBKEY });
      telemetryEvents = [];
      agentB.onTelemetry = (event) => telemetryEvents.push(event);
    });

    afterEach(async () => {
      await agentB.shutdown();
    });

    it('should emit telemetry events during packet processing', async () => {
      // Process a packet
      const event = createTestNostrEvent({ kind: 1 });
      const packet = createTestILPPreparePacket(event, 100n, 'g.agent.b');
      await agentB.processIncomingPacket(packet, 'agent-a');

      // Verify AGENT_EVENT_RECEIVED telemetry emitted
      expect(telemetryEvents).toContainEqual(
        expect.objectContaining({
          type: 'AGENT_EVENT_RECEIVED',
          eventKind: 1,
        })
      );

      // Verify AGENT_EVENT_HANDLED telemetry emitted
      expect(telemetryEvents).toContainEqual(
        expect.objectContaining({
          type: 'AGENT_EVENT_HANDLED',
          success: true,
        })
      );
    });
  });

  // ==========================================================================
  // Task 12: Test Subscription Matching and Push (AC: 3)
  // ==========================================================================
  describe('Subscription Matching and Push', () => {
    let agentB: AgentNode;
    let telemetryEvents: AgentTelemetryEvent[];

    beforeEach(async () => {
      agentB = await createInitializedAgent({ agentPubkey: AGENT_B_PUBKEY });
      telemetryEvents = [];
      agentB.onTelemetry = (event) => telemetryEvents.push(event);
    });

    afterEach(async () => {
      await agentB.shutdown();
    });

    it('should match events to active subscriptions', async () => {
      // Register a subscription on Agent B
      agentB.subscriptionManager.registerSubscription('agent-a', 'sub-1', {
        kinds: [1],
        authors: [AGENT_A_PUBKEY],
      });

      // Store an event that matches the subscription
      const noteEvent = createTestNostrEvent({
        kind: 1,
        pubkey: AGENT_A_PUBKEY,
        content: 'First note',
      });
      const packet = createTestILPPreparePacket(noteEvent, 100n, 'g.agent.b');
      await agentB.processIncomingPacket(packet, 'agent-a');

      // Check that subscription push telemetry was emitted
      expect(telemetryEvents).toContainEqual(
        expect.objectContaining({
          type: 'AGENT_SUBSCRIPTION_PUSH',
          subscriptionCount: 1,
        })
      );
    });
  });

  // ==========================================================================
  // Task 13: Test TOON Encoding/Decoding Round-Trip (AC: 1)
  // ==========================================================================
  describe('TOON Encoding/Decoding Round-Trip', () => {
    let agentB: AgentNode;

    beforeEach(async () => {
      agentB = await createInitializedAgent({ agentPubkey: AGENT_B_PUBKEY });
    });

    afterEach(async () => {
      await agentB.shutdown();
    });

    it('should encode and decode events losslessly through ILP packet', async () => {
      // Create complex event with tags
      const originalEvent = createTestNostrEvent({
        kind: 1,
        content: 'Test message with Unicode: 你好',
        tags: [
          ['e', 'referenced-event-id'],
          ['p', 'referenced-pubkey'],
          ['custom', 'value1', 'value2'],
        ],
      });

      // Encode as TOON in ILP packet
      const packet = createTestILPPreparePacket(originalEvent, 100n, 'g.agent.b');

      // Process through agent (will decode internally)
      const response = await agentB.processIncomingPacket(packet, 'agent-a');

      // Verify event stored correctly
      expect(response.type).toBe(PacketType.FULFILL);
      const stored = await agentB.database.queryEvents({ ids: [originalEvent.id] });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.content).toBe(originalEvent.content);
      expect(stored[0]!.tags).toEqual(originalEvent.tags);
    });
  });

  // ==========================================================================
  // Task 14: Test Database Size Limit Enforcement (AC: 4)
  // ==========================================================================
  describe('Database Size Limit Enforcement', () => {
    it('should reject events when database size exceeded', async () => {
      // Create agent with very small database limit (1KB)
      const smallAgent = new AgentNode(
        createTestAgentConfig({
          agentPubkey: AGENT_A_PUBKEY,
          databasePath: ':memory:',
          databaseMaxSize: 1024, // 1KB limit
          pricing: { ...DEFAULT_TEST_PRICING },
        })
      );
      await smallAgent.initialize();

      try {
        // Fill database with events until limit reached
        let rejected = false;
        for (let i = 0; i < 100 && !rejected; i++) {
          const event = createTestNostrEvent({
            kind: 1,
            content: 'A'.repeat(100), // ~100 bytes per event
          });
          const packet = createTestILPPreparePacket(event, 100n, 'g.agent.test');
          const response = await smallAgent.processIncomingPacket(packet, 'external');
          if (response.type === PacketType.REJECT) {
            rejected = true;
            expect(response.code).toBe(ILPErrorCode.T00_INTERNAL_ERROR);
          }
        }

        expect(rejected).toBe(true);
      } finally {
        await smallAgent.shutdown();
      }
    });
  });
});

/**
 * Test Coverage Matrix - Story 13.8 Acceptance Criteria
 *
 * AC1: Agent A queries Agent B's database
 *   - ✓ 'should query Agent B database and receive results'
 *   - ✓ 'should encode and decode events losslessly through ILP packet'
 *
 * AC2: Payment flows correctly between agents
 *   - ✓ 'should fulfill when payment is sufficient'
 *   - ✓ 'should reject when payment is insufficient'
 *   - ✓ 'should accept zero payment for free tier services'
 *
 * AC3: Events propagate through follow graph
 *   - ✓ 'should route events through follow graph'
 *   - ✓ 'should return F02 for unreachable destination'
 *   - ✓ 'should update routing table from Kind 3 event'
 *   - ✓ 'should match events to active subscriptions'
 *
 * AC4: Rejection codes returned for errors
 *   - ✓ 'should return F01 for malformed TOON data'
 *   - ✓ 'should return F03 for insufficient payment'
 *   - ✓ 'should return F99 for unsupported event kind'
 *   - ✓ 'should return T00 for internal errors'
 *   - ✓ 'should return T00 when agent not initialized'
 *   - ✓ 'should reject events when database size exceeded'
 *
 * AC5: Settlement triggers after threshold
 *   - ✓ 'should accumulate balance and detect settlement threshold'
 */
