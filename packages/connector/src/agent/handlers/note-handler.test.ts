// Mock toon-codec to avoid ESM transformation issues with @toon-format/toon
jest.mock('../toon-codec', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

import { PacketType } from '@m2m/shared';
import { createNoteHandler } from './note-handler';
import { DatabaseSizeExceededError } from '../event-database';
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
 * Create a mock AgentEventDatabase for testing.
 */
function createMockDatabase(): jest.Mocked<AgentEventDatabase> {
  return {
    storeEvent: jest.fn(),
    storeEvents: jest.fn(),
    queryEvents: jest.fn(),
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
    kind: 1,
    tags: [],
    content: 'test content',
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

describe('createNoteHandler', () => {
  let mockDatabase: jest.Mocked<AgentEventDatabase>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
  });

  describe('successful storage', () => {
    it('should store event in database and return success', async () => {
      const handler = createNoteHandler();
      const context = createTestContext({ database: mockDatabase });

      const result = await handler(context);

      expect(mockDatabase.storeEvent).toHaveBeenCalledWith(context.event);
      expect(mockDatabase.storeEvent).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle event with empty content', async () => {
      const handler = createNoteHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: { content: '' },
      });

      const result = await handler(context);

      expect(mockDatabase.storeEvent).toHaveBeenCalledWith(context.event);
      expect(result.success).toBe(true);
    });

    it('should handle event with tags', async () => {
      const handler = createNoteHandler();
      const context = createTestContext({
        database: mockDatabase,
        event: {
          tags: [
            ['e', 'abc123'],
            ['p', 'def456'],
          ],
        },
      });

      const result = await handler(context);

      expect(mockDatabase.storeEvent).toHaveBeenCalledWith(context.event);
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return T00 error when database size limit is exceeded', async () => {
      const handler = createNoteHandler();
      mockDatabase.storeEvent.mockRejectedValueOnce(
        new DatabaseSizeExceededError('Storage limit exceeded')
      );
      const context = createTestContext({ database: mockDatabase });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'T00',
        message: 'Storage limit exceeded',
      });
    });

    it('should propagate unexpected errors', async () => {
      const handler = createNoteHandler();
      const unexpectedError = new Error('Unexpected database error');
      mockDatabase.storeEvent.mockRejectedValueOnce(unexpectedError);
      const context = createTestContext({ database: mockDatabase });

      await expect(handler(context)).rejects.toThrow('Unexpected database error');
    });
  });
});
