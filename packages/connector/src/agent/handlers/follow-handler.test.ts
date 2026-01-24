import { PacketType } from '@m2m/shared';
import { createFollowHandler } from './follow-handler';
import type { EventHandlerContext } from '../event-handler';
import type { AgentEventDatabase } from '../event-database';
import type { FollowGraphRouter } from '../follow-graph-router';

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
 * Create a mock FollowGraphRouter for testing.
 */
function createMockFollowGraphRouter(): jest.Mocked<FollowGraphRouter> {
  return {
    updateFromFollowEvent: jest.fn(),
    addFollow: jest.fn(),
    removeFollow: jest.fn(),
    getNextHop: jest.fn(),
    hasRouteTo: jest.fn(),
    getFollowByPubkey: jest.fn(),
    getFollowByILPAddress: jest.fn(),
    exportGraph: jest.fn(),
    getKnownAgents: jest.fn(),
    getFollowCount: jest.fn(),
    getAllFollows: jest.fn(),
  } as unknown as jest.Mocked<FollowGraphRouter>;
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
    kind: 3,
    tags: [
      ['ilp', 'c'.repeat(64), 'g.agent.alice'],
      ['p', 'c'.repeat(64), 'wss://relay.example.com', 'Alice'],
    ],
    content: '',
    sig: 'd'.repeat(128),
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
    agentPubkey: 'e'.repeat(64),
    database,
  };
}

describe('createFollowHandler', () => {
  let mockDatabase: jest.Mocked<AgentEventDatabase>;
  let mockRouter: jest.Mocked<FollowGraphRouter>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    mockRouter = createMockFollowGraphRouter();
  });

  describe('routing update', () => {
    it('should call followGraphRouter.updateFromFollowEvent with event', async () => {
      const handler = createFollowHandler({
        followGraphRouter: mockRouter,
      });
      const context = createTestContext({ database: mockDatabase });

      const result = await handler(context);

      expect(mockRouter.updateFromFollowEvent).toHaveBeenCalledWith(context.event);
      expect(mockRouter.updateFromFollowEvent).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should persist event to database by default', async () => {
      const handler = createFollowHandler({
        followGraphRouter: mockRouter,
      });
      const context = createTestContext({ database: mockDatabase });

      const result = await handler(context);

      expect(mockDatabase.storeEvent).toHaveBeenCalledWith(context.event);
      expect(result.success).toBe(true);
    });

    it('should not persist event to database when persistToDatabase is false', async () => {
      const handler = createFollowHandler({
        followGraphRouter: mockRouter,
        persistToDatabase: false,
      });
      const context = createTestContext({ database: mockDatabase });

      const result = await handler(context);

      expect(mockDatabase.storeEvent).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('event validation', () => {
    it('should return error for non-Kind-3 events', async () => {
      const handler = createFollowHandler({
        followGraphRouter: mockRouter,
      });
      const context = createTestContext({
        database: mockDatabase,
        event: { kind: 1 },
      });

      const result = await handler(context);

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        code: 'F99',
        message: 'Expected Kind 3 event, got Kind 1',
      });
      expect(mockRouter.updateFromFollowEvent).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle event with empty tags', async () => {
      const handler = createFollowHandler({
        followGraphRouter: mockRouter,
      });
      const context = createTestContext({
        database: mockDatabase,
        event: { tags: [] },
      });

      const result = await handler(context);

      expect(mockRouter.updateFromFollowEvent).toHaveBeenCalledWith(context.event);
      expect(result.success).toBe(true);
    });

    it('should handle event with only p-tags (no ilp tags)', async () => {
      const handler = createFollowHandler({
        followGraphRouter: mockRouter,
      });
      const context = createTestContext({
        database: mockDatabase,
        event: {
          tags: [['p', 'a'.repeat(64), 'wss://relay.example.com', 'Bob']],
        },
      });

      const result = await handler(context);

      expect(mockRouter.updateFromFollowEvent).toHaveBeenCalledWith(context.event);
      expect(result.success).toBe(true);
    });
  });
});
