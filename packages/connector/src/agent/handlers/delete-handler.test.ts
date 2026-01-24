import type { Logger } from 'pino';
import { PacketType } from '@m2m/shared';
import { createDeleteHandler } from './delete-handler';
import type { EventHandlerContext } from '../event-handler';
import type { AgentEventDatabase } from '../event-database';

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
 * Create a mock Pino logger for testing.
 */
function createMockLogger(): jest.Mocked<Logger> {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as unknown as jest.Mocked<Logger>;

  (logger.child as jest.Mock).mockReturnValue(logger);

  return logger;
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
    deleteEvents: jest.fn().mockResolvedValue(0),
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
    kind: 5,
    tags: [],
    content: '',
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

describe('createDeleteHandler', () => {
  let mockDatabase: jest.Mocked<AgentEventDatabase>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    mockLogger = createMockLogger();
  });

  describe('event ID extraction', () => {
    it('should extract event IDs from e tags', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const eventId1 = 'event1'.padEnd(64, '0');
      const eventId2 = 'event2'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);

      // Mock database to return events owned by requester
      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: eventId1, pubkey: requesterPubkey, kind: 1 }),
        createTestEvent({ id: eventId2, pubkey: requesterPubkey, kind: 1 }),
      ]);
      mockDatabase.deleteEvents.mockResolvedValueOnce(2);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [
            ['e', eventId1],
            ['e', eventId2],
          ],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        ids: [eventId1, eventId2],
      });
      expect(mockDatabase.deleteEvents).toHaveBeenCalledWith([eventId1, eventId2]);
      expect(result.success).toBe(true);
    });

    it('should return success with no deletions when no e tags', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const context = createTestContext({
        database: mockDatabase,
        event: { tags: [] },
      });

      const result = await handler(context);

      expect(mockDatabase.queryEvents).not.toHaveBeenCalled();
      expect(mockDatabase.deleteEvents).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should skip malformed tags', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const eventId = 'event1'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);

      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: eventId, pubkey: requesterPubkey, kind: 1 }),
      ]);
      mockDatabase.deleteEvents.mockResolvedValueOnce(1);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [
            ['e'], // Missing event ID
            ['e', eventId], // Valid
            ['p', 'some-pubkey'], // Not an e tag
            ['e', 123 as unknown as string], // Invalid type
          ],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({
        ids: [eventId],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('authorization', () => {
    it('should delete events authored by requester', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const eventId = 'event1'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);

      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: eventId, pubkey: requesterPubkey, kind: 1 }),
      ]);
      mockDatabase.deleteEvents.mockResolvedValueOnce(1);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [['e', eventId]],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.deleteEvents).toHaveBeenCalledWith([eventId]);
      expect(result.success).toBe(true);
    });

    it('should skip events authored by different pubkey', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const eventId = 'event1'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);
      const otherPubkey = 'other'.padEnd(64, '0');

      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: eventId, pubkey: otherPubkey, kind: 1 }),
      ]);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [['e', eventId]],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.deleteEvents).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterPubkey,
          unauthorizedCount: 1,
          unauthorizedIds: [eventId],
        }),
        'Unauthorized deletion attempt - requester is not the author'
      );
      expect(result.success).toBe(true);
    });

    it('should handle mixed authorization - delete only authorized events', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const authorizedId = 'authorized'.padEnd(64, '0');
      const unauthorizedId = 'unauthorized'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);
      const otherPubkey = 'other'.padEnd(64, '0');

      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: authorizedId, pubkey: requesterPubkey, kind: 1 }),
        createTestEvent({ id: unauthorizedId, pubkey: otherPubkey, kind: 1 }),
      ]);
      mockDatabase.deleteEvents.mockResolvedValueOnce(1);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [
            ['e', authorizedId],
            ['e', unauthorizedId],
          ],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.deleteEvents).toHaveBeenCalledWith([authorizedId]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterPubkey,
          unauthorizedCount: 1,
          unauthorizedIds: [unauthorizedId],
        }),
        'Unauthorized deletion attempt - requester is not the author'
      );
      expect(result.success).toBe(true);
    });

    it('should return success when all events are unauthorized', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const eventId = 'event1'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);
      const otherPubkey = 'other'.padEnd(64, '0');

      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: eventId, pubkey: otherPubkey, kind: 1 }),
      ]);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [['e', eventId]],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.deleteEvents).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle event IDs that do not exist in database', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const eventId = 'nonexistent'.padEnd(64, '0');

      mockDatabase.queryEvents.mockResolvedValueOnce([]);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          tags: [['e', eventId]],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.queryEvents).toHaveBeenCalledWith({ ids: [eventId] });
      expect(mockDatabase.deleteEvents).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should return error for non-Kind-5 events', async () => {
      const handler = createDeleteHandler({ logger: mockLogger });
      const context = createTestContext({
        database: mockDatabase,
        event: { kind: 1 },
      });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'F99',
        message: 'Expected Kind 5 event, got Kind 1',
      });
    });

    it('should work without logger', async () => {
      const handler = createDeleteHandler();
      const eventId = 'event1'.padEnd(64, '0');
      const requesterPubkey = 'b'.repeat(64);

      mockDatabase.queryEvents.mockResolvedValueOnce([
        createTestEvent({ id: eventId, pubkey: requesterPubkey, kind: 1 }),
      ]);
      mockDatabase.deleteEvents.mockResolvedValueOnce(1);

      const context = createTestContext({
        database: mockDatabase,
        event: {
          pubkey: requesterPubkey,
          tags: [['e', eventId]],
        },
      });

      const result = await handler(context);

      expect(result.success).toBe(true);
    });
  });
});
