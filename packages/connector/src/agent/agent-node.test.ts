// Mock the ESM-only @toon-format/toon package
jest.mock('@toon-format/toon', () => ({
  encode: (input: unknown) => JSON.stringify(input),
  decode: (input: string) => JSON.parse(input),
}));

import * as crypto from 'crypto';
import { AgentNode, AgentNodeConfig, AgentTelemetryEvent } from './agent-node';
import { ToonCodec, NostrEvent } from './toon-codec';
import { AgentEventDatabase } from './event-database';
import { PacketType, ILPPreparePacket, ILPErrorCode } from '@m2m/shared';
import type { Logger } from 'pino';

// ============================================
// Test Utilities
// ============================================

function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Logger>;
}

function createTestConfig(overrides?: Partial<AgentNodeConfig>): AgentNodeConfig {
  return {
    agentPubkey: 'a'.repeat(64),
    databasePath: ':memory:',
    pricing: {
      noteStorage: 100n,
      followUpdate: 50n,
      deletion: 10n,
      queryBase: 200n,
    },
    ...overrides,
  };
}

function createTestEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: 'Test note',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

function createTestPreparePacket(
  data: Buffer,
  overrides?: Partial<ILPPreparePacket>
): ILPPreparePacket {
  return {
    type: PacketType.PREPARE,
    amount: 1000n,
    destination: 'g.agent.test',
    executionCondition: AgentNode.AGENT_CONDITION,
    expiresAt: new Date(Date.now() + 30000),
    data,
    ...overrides,
  };
}

// ============================================
// Task 12: Unit Tests for AgentNode Initialization (AC: 1)
// ============================================

describe('AgentNode', () => {
  describe('constructor', () => {
    it('should create AgentNode with valid config', () => {
      const config = createTestConfig();
      const node = new AgentNode(config);
      expect(node).toBeInstanceOf(AgentNode);
      expect(node.isInitialized).toBe(false);
      expect(node.agentPubkey).toBe(config.agentPubkey);
    });

    it('should create AgentNode with logger', () => {
      const config = createTestConfig();
      const logger = createMockLogger();
      const node = new AgentNode(config, logger);
      expect(node).toBeInstanceOf(AgentNode);
      expect(logger.child).toHaveBeenCalledWith({ component: 'AgentNode' });
    });

    it('should throw error for missing agentPubkey', () => {
      const config = createTestConfig({ agentPubkey: '' });
      expect(() => new AgentNode(config)).toThrow('Invalid config: agentPubkey is required');
    });

    it('should throw error for missing databasePath', () => {
      const config = createTestConfig({ databasePath: '' });
      expect(() => new AgentNode(config)).toThrow('Invalid config: databasePath is required');
    });

    it('should throw error for missing pricing', () => {
      const config = createTestConfig();
      // @ts-expect-error - testing missing pricing
      delete config.pricing;
      expect(() => new AgentNode(config)).toThrow('Invalid config: pricing is required');
    });

    it('should create all component instances', () => {
      const config = createTestConfig();
      const node = new AgentNode(config);
      expect(node.database).toBeInstanceOf(AgentEventDatabase);
      expect(node.eventHandler).toBeDefined();
      expect(node.subscriptionManager).toBeDefined();
      expect(node.followGraphRouter).toBeDefined();
    });
  });

  describe('initialize', () => {
    let node: AgentNode;
    let logger: jest.Mocked<Logger>;

    beforeEach(() => {
      logger = createMockLogger();
      node = new AgentNode(createTestConfig(), logger);
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should initialize database and set initialized flag', async () => {
      expect(node.isInitialized).toBe(false);
      await node.initialize();
      expect(node.isInitialized).toBe(true);
    });

    it('should register built-in handlers when enableBuiltInHandlers=true', async () => {
      const config = createTestConfig({ enableBuiltInHandlers: true });
      node = new AgentNode(config, logger);
      await node.initialize();

      // Check that handlers are registered
      expect(node.eventHandler.hasHandler(1)).toBe(true); // Note
      expect(node.eventHandler.hasHandler(3)).toBe(true); // Follow
      expect(node.eventHandler.hasHandler(5)).toBe(true); // Delete
      expect(node.eventHandler.hasHandler(10000)).toBe(true); // Query
    });

    it('should skip built-in handlers when enableBuiltInHandlers=false', async () => {
      const config = createTestConfig({ enableBuiltInHandlers: false });
      node = new AgentNode(config, logger);
      await node.initialize();

      // Check that handlers are NOT registered
      expect(node.eventHandler.hasHandler(1)).toBe(false);
      expect(node.eventHandler.hasHandler(3)).toBe(false);
      expect(node.eventHandler.hasHandler(5)).toBe(false);
      expect(node.eventHandler.hasHandler(10000)).toBe(false);
    });

    it('should register built-in handlers by default', async () => {
      const config = createTestConfig();
      // enableBuiltInHandlers not specified - should default to true
      node = new AgentNode(config, logger);
      await node.initialize();

      expect(node.eventHandler.hasHandler(1)).toBe(true);
    });

    it('should handle double initialization gracefully', async () => {
      await node.initialize();
      expect(node.isInitialized).toBe(true);

      // Second call should warn but not error
      await node.initialize();
      expect(node.isInitialized).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith('AgentNode already initialized');
    });

    it('should log initialization success', async () => {
      await node.initialize();
      expect(logger.info).toHaveBeenCalledWith('AgentNode initialized');
    });
  });

  // ============================================
  // Task 13: Unit Tests for TOON Event Detection (AC: 2)
  // ============================================

  describe('isToonEvent', () => {
    let node: AgentNode;
    const codec = new ToonCodec();

    beforeEach(() => {
      node = new AgentNode(createTestConfig());
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should return true for valid TOON-encoded NostrEvent', () => {
      const event = createTestEvent();
      const toonData = codec.encode(event);
      expect(node.isToonEvent(toonData)).toBe(true);
    });

    it('should return false for random binary data', () => {
      const randomData = Buffer.from('random binary data that is not TOON');
      expect(node.isToonEvent(randomData)).toBe(false);
    });

    // Note: With the @toon-format/toon mock using JSON.stringify/parse,
    // JSON data is actually valid TOON in test environment.
    // In production, real TOON format is different from JSON.
    // This test is skipped as it tests mock behavior, not real behavior.
    it.skip('should return false for JSON data (non-TOON)', () => {
      const jsonData = Buffer.from(JSON.stringify(createTestEvent()));
      expect(node.isToonEvent(jsonData)).toBe(false);
    });

    it('should return false for empty buffer', () => {
      expect(node.isToonEvent(Buffer.alloc(0))).toBe(false);
    });

    it('should return false for very small buffer', () => {
      expect(node.isToonEvent(Buffer.from('ab'))).toBe(false);
    });

    it('should return false for invalid input type', () => {
      // @ts-expect-error - testing invalid input
      expect(node.isToonEvent('not a buffer')).toBe(false);
      // @ts-expect-error - testing invalid input
      expect(node.isToonEvent(null)).toBe(false);
      // @ts-expect-error - testing invalid input
      expect(node.isToonEvent(undefined)).toBe(false);
    });

    it('should handle decode errors gracefully', () => {
      // Partial TOON-like data that will fail validation
      const partialData = Buffer.from('{"id":"test"}');
      expect(node.isToonEvent(partialData)).toBe(false);
    });
  });

  // ============================================
  // Task 14: Unit Tests for Event Processing (AC: 2, 3, 4)
  // ============================================

  describe('processIncomingPacket', () => {
    let node: AgentNode;
    let logger: jest.Mocked<Logger>;
    const codec = new ToonCodec();

    beforeEach(async () => {
      logger = createMockLogger();
      node = new AgentNode(createTestConfig(), logger);
      await node.initialize();
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should return T00 reject when not initialized', async () => {
      const uninitializedNode = new AgentNode(createTestConfig());
      const event = createTestEvent();
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await uninitializedNode.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.T00_INTERNAL_ERROR);
        expect(response.message).toBe('Agent not initialized');
      }

      await uninitializedNode.shutdown();
    });

    it('should return F01 reject for non-TOON data', async () => {
      const packet = createTestPreparePacket(Buffer.from('not toon data'));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F01_INVALID_PACKET);
        expect(response.message).toBe('Invalid packet data');
      }
    });

    it('should route Kind 1 event to note handler', async () => {
      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.FULFILL);
    });

    it('should route Kind 3 event to follow handler', async () => {
      const event = createTestEvent({
        kind: 3,
        tags: [['ilp', 'd'.repeat(64), 'g.agent.alice']],
      });
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.FULFILL);
    });

    it('should route Kind 5 event to delete handler', async () => {
      // First store an event to delete
      const targetEvent = createTestEvent({ kind: 1, pubkey: 'b'.repeat(64) });
      await node.database.storeEvent(targetEvent);

      const deleteEvent = createTestEvent({
        kind: 5,
        pubkey: 'b'.repeat(64), // Same author
        tags: [['e', targetEvent.id]],
      });
      const packet = createTestPreparePacket(codec.encode(deleteEvent));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.FULFILL);
    });

    it('should route Kind 10000 event to query handler', async () => {
      const queryEvent = createTestEvent({
        kind: 10000,
        content: JSON.stringify({ kinds: [1], limit: 10 }),
      });
      const packet = createTestPreparePacket(codec.encode(queryEvent));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.FULFILL);
    });

    it('should return F03 reject for insufficient payment', async () => {
      const event = createTestEvent({ kind: 1 });
      // Note handler requires 100n, send only 10n
      const packet = createTestPreparePacket(codec.encode(event), { amount: 10n });

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F03_INVALID_AMOUNT);
      }
    });

    it('should return F99 reject for unsupported event kind', async () => {
      const event = createTestEvent({ kind: 9999 }); // Unsupported kind
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F99_APPLICATION_ERROR);
        expect(response.message).toBe('Unsupported event kind');
      }
    });

    it('should encode response events as TOON in fulfill packet', async () => {
      // Store some events first
      const storedEvent = createTestEvent({ kind: 1 });
      await node.database.storeEvent(storedEvent);

      // Query for them
      const queryEvent = createTestEvent({
        kind: 10000,
        content: JSON.stringify({ kinds: [1], limit: 10 }),
      });
      const packet = createTestPreparePacket(codec.encode(queryEvent));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.FULFILL);
      if (response.type === PacketType.FULFILL) {
        // Response should contain TOON-encoded events
        expect(response.data.length).toBeGreaterThan(0);
        // Decode to verify
        const decoded = codec.decodeMany(response.data);
        expect(Array.isArray(decoded)).toBe(true);
        expect(decoded.length).toBeGreaterThan(0);
      }
    });

    it('should include empty data when no response events', async () => {
      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.FULFILL);
      if (response.type === PacketType.FULFILL) {
        // Note handler returns success with no response events
        expect(response.data.length).toBe(0);
      }
    });
  });

  // ============================================
  // Task 14 (continued): Telemetry Tests (AC: 4)
  // ============================================

  describe('telemetry emission', () => {
    let node: AgentNode;
    let telemetryEvents: AgentTelemetryEvent[];
    const codec = new ToonCodec();

    beforeEach(async () => {
      telemetryEvents = [];
      node = new AgentNode(createTestConfig());
      node.onTelemetry = (event) => telemetryEvents.push(event);
      await node.initialize();
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should emit AGENT_EVENT_RECEIVED when TOON event detected', async () => {
      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-1');

      const receivedEvents = telemetryEvents.filter((e) => e.type === 'AGENT_EVENT_RECEIVED');
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0]!.eventKind).toBe(1);
      expect(receivedEvents[0]!.eventId).toBe(event.id);
    });

    it('should emit AGENT_EVENT_HANDLED after handler completes (success case)', async () => {
      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-1');

      const handledEvents = telemetryEvents.filter((e) => e.type === 'AGENT_EVENT_HANDLED');
      expect(handledEvents.length).toBe(1);
      expect(handledEvents[0]!.success).toBe(true);
      expect(handledEvents[0]!.eventKind).toBe(1);
    });

    it('should emit AGENT_EVENT_HANDLED after handler completes (failure case)', async () => {
      const event = createTestEvent({ kind: 9999 }); // Unsupported
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-1');

      const handledEvents = telemetryEvents.filter((e) => e.type === 'AGENT_EVENT_HANDLED');
      expect(handledEvents.length).toBe(1);
      expect(handledEvents[0]!.success).toBe(false);
      expect(handledEvents[0]!.errorCode).toBe('F99');
    });

    it('should emit AGENT_EVENT_HANDLED with F03 for insufficient payment', async () => {
      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event), { amount: 10n });

      await node.processIncomingPacket(packet, 'peer-1');

      const handledEvents = telemetryEvents.filter((e) => e.type === 'AGENT_EVENT_HANDLED');
      expect(handledEvents.length).toBe(1);
      expect(handledEvents[0]!.success).toBe(false);
      expect(handledEvents[0]!.errorCode).toBe('F03');
    });

    it('should include correct eventKind and eventId in telemetry', async () => {
      const event = createTestEvent({ kind: 3, id: 'x'.repeat(64) });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-1');

      const receivedEvents = telemetryEvents.filter((e) => e.type === 'AGENT_EVENT_RECEIVED');
      expect(receivedEvents[0]!.eventKind).toBe(3);
      expect(receivedEvents[0]!.eventId).toBe('x'.repeat(64));
    });

    it('should not block packet processing if telemetry emission fails', async () => {
      // Make telemetry handler throw
      node.onTelemetry = () => {
        throw new Error('Telemetry failure');
      };

      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event));

      // Should not throw - processing should continue
      const response = await node.processIncomingPacket(packet, 'peer-1');

      // Packet should still be processed successfully
      expect(response.type).toBe(PacketType.FULFILL);
    });
  });

  // ============================================
  // Task 15: Unit Tests for Subscription Push (AC: 3, 4)
  // ============================================

  describe('subscription matching after note handler', () => {
    let node: AgentNode;
    let telemetryEvents: AgentTelemetryEvent[];
    let logger: jest.Mocked<Logger>;
    const codec = new ToonCodec();

    beforeEach(async () => {
      telemetryEvents = [];
      logger = createMockLogger();
      node = new AgentNode(createTestConfig(), logger);
      node.onTelemetry = (event) => telemetryEvents.push(event);
      await node.initialize();
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should find matching subscriptions for Kind 1 event', async () => {
      // Register a subscription that matches the event
      const eventAuthor = 'b'.repeat(64);
      node.subscriptionManager.registerSubscription('peer-1', 'sub-1', {
        authors: [eventAuthor],
        kinds: [1],
      });

      const event = createTestEvent({ kind: 1, pubkey: eventAuthor });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-2');

      // Check that subscription match was logged
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'peer-1', subId: 'sub-1' }),
        'Event matches subscription'
      );
    });

    it('should emit AGENT_SUBSCRIPTION_PUSH when event matches subscriptions', async () => {
      const eventAuthor = 'b'.repeat(64);
      node.subscriptionManager.registerSubscription('peer-1', 'sub-1', {
        authors: [eventAuthor],
      });

      const event = createTestEvent({ kind: 1, pubkey: eventAuthor });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-2');

      const pushEvents = telemetryEvents.filter((e) => e.type === 'AGENT_SUBSCRIPTION_PUSH');
      expect(pushEvents.length).toBe(1);
      expect(pushEvents[0]!.subscriptionCount).toBe(1);
    });

    it('should include correct subscriptionCount in telemetry', async () => {
      const eventAuthor = 'b'.repeat(64);
      // Register multiple subscriptions
      node.subscriptionManager.registerSubscription('peer-1', 'sub-1', {
        authors: [eventAuthor],
      });
      node.subscriptionManager.registerSubscription('peer-2', 'sub-2', {
        kinds: [1],
      });

      const event = createTestEvent({ kind: 1, pubkey: eventAuthor });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-3');

      const pushEvents = telemetryEvents.filter((e) => e.type === 'AGENT_SUBSCRIPTION_PUSH');
      expect(pushEvents.length).toBe(1);
      expect(pushEvents[0]!.subscriptionCount).toBe(2);
    });

    it('should not emit AGENT_SUBSCRIPTION_PUSH when no subscriptions match', async () => {
      // Register subscription that won't match
      node.subscriptionManager.registerSubscription('peer-1', 'sub-1', {
        authors: ['x'.repeat(64)], // Different author
      });

      const event = createTestEvent({ kind: 1, pubkey: 'y'.repeat(64) });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-2');

      const pushEvents = telemetryEvents.filter((e) => e.type === 'AGENT_SUBSCRIPTION_PUSH');
      expect(pushEvents.length).toBe(0);
    });

    it('should handle no registered subscriptions gracefully', async () => {
      // No subscriptions registered
      const event = createTestEvent({ kind: 1 });
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      // Should still succeed
      expect(response.type).toBe(PacketType.FULFILL);

      // No push telemetry
      const pushEvents = telemetryEvents.filter((e) => e.type === 'AGENT_SUBSCRIPTION_PUSH');
      expect(pushEvents.length).toBe(0);
    });

    it('should not check subscriptions for non-Kind-1 events', async () => {
      // Register subscription for Kind 3
      node.subscriptionManager.registerSubscription('peer-1', 'sub-1', {
        kinds: [3],
      });

      const event = createTestEvent({
        kind: 3,
        tags: [['ilp', 'd'.repeat(64), 'g.agent.test']],
      });
      const packet = createTestPreparePacket(codec.encode(event));

      await node.processIncomingPacket(packet, 'peer-2');

      // No push telemetry for Kind 3 (only Kind 1 triggers push)
      const pushEvents = telemetryEvents.filter((e) => e.type === 'AGENT_SUBSCRIPTION_PUSH');
      expect(pushEvents.length).toBe(0);
    });
  });

  // ============================================
  // Task 16: Unit Tests for Graceful Shutdown (AC: 5)
  // ============================================

  describe('shutdown', () => {
    it('should close database connection', async () => {
      const node = new AgentNode(createTestConfig());
      await node.initialize();

      // Store an event to verify DB is working
      const event = createTestEvent();
      await node.database.storeEvent(event);

      await node.shutdown();

      // Database should be closed - operations should fail
      await expect(node.database.getEventById(event.id)).rejects.toThrow();
    });

    it('should set initialized to false', async () => {
      const node = new AgentNode(createTestConfig());
      await node.initialize();
      expect(node.isInitialized).toBe(true);

      await node.shutdown();
      expect(node.isInitialized).toBe(false);
    });

    it('should handle shutdown when not initialized', async () => {
      const node = new AgentNode(createTestConfig());
      // Not initialized

      // Should not throw
      await expect(node.shutdown()).resolves.not.toThrow();
    });

    it('should handle double shutdown safely', async () => {
      const logger = createMockLogger();
      const node = new AgentNode(createTestConfig(), logger);
      await node.initialize();

      await node.shutdown();
      await node.shutdown(); // Second call

      // Should log shutdown info (may be called multiple times)
      expect(logger.info).toHaveBeenCalledWith('AgentNode shutdown complete');
    });

    it('should log shutdown progress', async () => {
      const logger = createMockLogger();
      const node = new AgentNode(createTestConfig(), logger);
      await node.initialize();

      await node.shutdown();

      expect(logger.info).toHaveBeenCalledWith('AgentNode shutting down...');
      expect(logger.info).toHaveBeenCalledWith('AgentNode shutdown complete');
    });
  });

  // ============================================
  // Component Accessors Tests
  // ============================================

  describe('component accessors', () => {
    let node: AgentNode;

    beforeEach(() => {
      node = new AgentNode(createTestConfig({ agentPubkey: 'test'.repeat(16) }));
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should expose database', () => {
      expect(node.database).toBeInstanceOf(AgentEventDatabase);
    });

    it('should expose eventHandler', () => {
      expect(node.eventHandler).toBeDefined();
    });

    it('should expose subscriptionManager', () => {
      expect(node.subscriptionManager).toBeDefined();
    });

    it('should expose followGraphRouter', () => {
      expect(node.followGraphRouter).toBeDefined();
    });

    it('should expose isInitialized', () => {
      expect(typeof node.isInitialized).toBe('boolean');
    });

    it('should expose agentPubkey', () => {
      expect(node.agentPubkey).toBe('test'.repeat(16));
    });
  });

  // ============================================
  // Static Constants Tests
  // ============================================

  describe('static constants', () => {
    it('should expose AGENT_CONDITION', () => {
      expect(Buffer.isBuffer(AgentNode.AGENT_CONDITION)).toBe(true);
      expect(AgentNode.AGENT_CONDITION.length).toBe(32);
    });

    it('should expose AGENT_FULFILLMENT', () => {
      expect(Buffer.isBuffer(AgentNode.AGENT_FULFILLMENT)).toBe(true);
      expect(AgentNode.AGENT_FULFILLMENT.length).toBe(32);
    });

    it('should have AGENT_CONDITION be SHA-256 hash of AGENT_FULFILLMENT', () => {
      const expectedCondition = crypto
        .createHash('sha256')
        .update(AgentNode.AGENT_FULFILLMENT)
        .digest();
      expect(AgentNode.AGENT_CONDITION.equals(expectedCondition)).toBe(true);
    });
  });

  // ============================================
  // Error Code Mapping Tests
  // ============================================

  describe('error code mapping', () => {
    let node: AgentNode;
    const codec = new ToonCodec();

    beforeEach(async () => {
      node = new AgentNode(createTestConfig());
      await node.initialize();
    });

    afterEach(async () => {
      await node.shutdown();
    });

    it('should map T00 to T00_INTERNAL_ERROR', async () => {
      // T00 is returned when not initialized
      const uninitNode = new AgentNode(createTestConfig());
      const packet = createTestPreparePacket(codec.encode(createTestEvent()));

      const response = await uninitNode.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.T00_INTERNAL_ERROR);
      }

      await uninitNode.shutdown();
    });

    it('should map F01 to F01_INVALID_PACKET', async () => {
      const packet = createTestPreparePacket(Buffer.from('invalid'));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F01_INVALID_PACKET);
      }
    });

    it('should map F99 to F99_APPLICATION_ERROR', async () => {
      const event = createTestEvent({ kind: 9999 });
      const packet = createTestPreparePacket(codec.encode(event));

      const response = await node.processIncomingPacket(packet, 'peer-1');

      expect(response.type).toBe(PacketType.REJECT);
      if (response.type === PacketType.REJECT) {
        expect(response.code).toBe(ILPErrorCode.F99_APPLICATION_ERROR);
      }
    });
  });
});
