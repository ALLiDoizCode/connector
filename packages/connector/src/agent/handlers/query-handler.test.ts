import { PacketType } from '@m2m/shared';
import { createQueryHandler } from './query-handler';
import type { EventHandlerContext } from '../event-handler';
import type { AgentEventDatabase, NostrFilter } from '../event-database';

// Local NostrEvent interface for testing
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Create a mock AgentEventDatabase for testing.
 */
function createMockDatabase(): jest.Mocked<AgentEventDatabase> {
  return {
    storeEvent: jest.fn(),
    storeEvents: jest.fn(),
    queryEvents: jest.fn().mockResolvedValue([]),
    getEventById: jest.fn(),
    deleteEvent: jest.fn(),
    deleteEvents: jest.fn(),
    deleteByFilter: jest.fn(),
    getDatabaseSize: jest.fn(),
    getEventCount: jest.fn(),
    pruneOldEvents: jest.fn(),
    initialize: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<AgentEventDatabase>;
}

/**
 * Create a test Nostr event with default values.
 */
function createTestEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: timestamp,
    kind: 10000,
    tags: [],
    content: '{}',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

/**
 * Create a test EventHandlerContext with default values.
 */
function createTestContext(
  overrides: Partial<{
    event: Partial<NostrEvent>;
    database: jest.Mocked<AgentEventDatabase>;
    amount: bigint;
  }> = {}
): EventHandlerContext {
  const event = createTestEvent(overrides.event);
  const database = overrides.database ?? createMockDatabase();

  return {
    event,
    packet: {
      type: PacketType.PREPARE,
      amount: overrides.amount ?? 1000n,
      destination: 'g.test.agent',
      executionCondition: Buffer.alloc(32),
      expiresAt: new Date(Date.now() + 30000),
      data: Buffer.alloc(0),
    },
    amount: overrides.amount ?? 1000n,
    source: 'peer-123',
    agentPubkey: 'd'.repeat(64),
    database,
  };
}

describe('createQueryHandler', () => {
  let mockDatabase: jest.Mocked<AgentEventDatabase>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
  });

  describe('query execution', () => {
    it('should parse filter from event.content and query database', async () => {
      const handler = createQueryHandler();
      const filter: NostrFilter = { kinds: [1], limit: 10 };
      const expectedEvents = [
        createTestEvent({ kind: 1, content: 'note 1' }),
        createTestEvent({ kind: 1, content: 'note 2' }),
      ];
      mockDatabase.queryEvents.mockResolvedValueOnce(expectedEvents);

      const context = createTestContext({
        database: mockDatabase,
        event: { content: JSON.stringify(filter) },
      });

      const result = await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        kinds: [1],
        limit: 10,
      });
      expect(result.success).toBe(true);
      expect(result.responseEvents).toEqual(expectedEvents);
    });

    it('should return events in responseEvents array', async () => {
      const handler = createQueryHandler();
      const expectedEvents = [
        createTestEvent({ id: '1'.repeat(64), kind: 1 }),
        createTestEvent({ id: '2'.repeat(64), kind: 1 }),
        createTestEvent({ id: '3'.repeat(64), kind: 1 }),
      ];
      mockDatabase.queryEvents.mockResolvedValueOnce(expectedEvents);

      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{"kinds":[1]}' },
      });

      const result = await handler(context);

      expect(result.success).toBe(true);
      expect(result.responseEvents).toHaveLength(3);
      expect(result.responseEvents).toEqual(expectedEvents);
    });

    it('should handle empty results', async () => {
      const handler = createQueryHandler();
      mockDatabase.queryEvents.mockResolvedValueOnce([]);

      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{"kinds":[1]}' },
      });

      const result = await handler(context);

      expect(result.success).toBe(true);
      expect(result.responseEvents).toEqual([]);
    });
  });

  describe('maxResults limit', () => {
    it('should apply default maxResults limit of 100', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{"kinds":[1],"limit":500}' },
      });

      await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        kinds: [1],
        limit: 100,
      });
    });

    it('should apply configured maxResults limit', async () => {
      const handler = createQueryHandler({ maxResults: 50 });
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{"kinds":[1],"limit":200}' },
      });

      await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        kinds: [1],
        limit: 50,
      });
    });

    it('should use filter limit when lower than maxResults', async () => {
      const handler = createQueryHandler({ maxResults: 100 });
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{"kinds":[1],"limit":25}' },
      });

      await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        kinds: [1],
        limit: 25,
      });
    });

    it('should apply default limit when filter has no limit', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{"kinds":[1]}' },
      });

      await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        kinds: [1],
        limit: 100,
      });
    });
  });

  describe('error handling', () => {
    it('should return F01 error for invalid JSON', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: 'not valid json' },
      });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'F01',
        message: 'Malformed query filter',
      });
      expect(mockDatabase.queryEvents).not.toHaveBeenCalled();
    });

    it('should return F01 error for null filter', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: 'null' },
      });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'F01',
        message: 'Malformed query filter',
      });
    });

    it('should return F01 error for array filter', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '[]' },
      });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'F01',
        message: 'Malformed query filter',
      });
    });

    it('should return error for non-Kind-10000 events', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { kind: 1 },
      });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'F99',
        message: 'Expected Kind 10000 event, got Kind 1',
      });
    });
  });

  describe('complex filters', () => {
    it('should handle filter with all criteria', async () => {
      const handler = createQueryHandler();
      const filter: NostrFilter = {
        ids: ['id1'.repeat(16)],
        authors: ['author1'.repeat(16)],
        kinds: [1, 3],
        since: 1700000000,
        until: 1800000000,
        limit: 50,
        '#e': ['event1'.repeat(16)],
        '#p': ['pubkey1'.repeat(16)],
      };
      const context = createTestContext({
        database: mockDatabase,
        event: { content: JSON.stringify(filter) },
      });

      await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith(filter);
    });

    it('should handle empty filter object', async () => {
      const handler = createQueryHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '{}' },
      });

      await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({ limit: 100 });
    });
  });
});
