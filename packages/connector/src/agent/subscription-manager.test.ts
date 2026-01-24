import type { Logger } from 'pino';
import { SubscriptionManager } from './subscription-manager';
import type { NostrFilter } from './event-database';

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

describe('SubscriptionManager', () => {
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('subscription registration', () => {
    it('should register subscription successfully', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });
      const filter: NostrFilter = { kinds: [1] };

      manager.registerSubscription('peer-1', 'sub-1', filter);

      expect(manager.hasSubscription('peer-1', 'sub-1')).toBe(true);
      expect(manager.getSubscriptionCount('peer-1')).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId: 'peer-1', subId: 'sub-1' },
        'Subscription registered'
      );
    });

    it('should register multiple subscriptions for same peer', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });

      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
      manager.registerSubscription('peer-1', 'sub-2', { kinds: [3] });
      manager.registerSubscription('peer-1', 'sub-3', { authors: ['abc'] });

      expect(manager.getSubscriptionCount('peer-1')).toBe(3);
    });

    it('should register subscriptions for different peers', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });

      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
      manager.registerSubscription('peer-2', 'sub-1', { kinds: [1] });

      expect(manager.getSubscriptionCount('peer-1')).toBe(1);
      expect(manager.getSubscriptionCount('peer-2')).toBe(1);
      expect(manager.getSubscriptionCount()).toBe(2);
    });

    it('should replace existing subscription with same ID', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });

      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
      manager.registerSubscription('peer-1', 'sub-1', { kinds: [3] });

      expect(manager.getSubscriptionCount('peer-1')).toBe(1);
      const sub = manager.getSubscription('peer-1', 'sub-1');
      expect(sub?.filter.kinds).toEqual([3]);
    });

    it('should throw when subscription limit per peer is exceeded', () => {
      const manager = new SubscriptionManager({
        maxSubscriptionsPerPeer: 2,
        logger: mockLogger,
      });

      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
      manager.registerSubscription('peer-1', 'sub-2', { kinds: [3] });

      expect(() => {
        manager.registerSubscription('peer-1', 'sub-3', { kinds: [5] });
      }).toThrow('Subscription limit exceeded: peer peer-1 has 2 subscriptions (max: 2)');
    });

    it('should allow replacing subscription at limit', () => {
      const manager = new SubscriptionManager({
        maxSubscriptionsPerPeer: 2,
        logger: mockLogger,
      });

      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
      manager.registerSubscription('peer-1', 'sub-2', { kinds: [3] });

      // Replacing existing subscription should not throw
      manager.registerSubscription('peer-1', 'sub-1', { kinds: [5] });

      expect(manager.getSubscriptionCount('peer-1')).toBe(2);
    });
  });

  describe('subscription unregistration', () => {
    it('should unregister subscription successfully', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });
      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });

      const result = manager.unregisterSubscription('peer-1', 'sub-1');

      expect(result).toBe(true);
      expect(manager.hasSubscription('peer-1', 'sub-1')).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId: 'peer-1', subId: 'sub-1' },
        'Subscription unregistered'
      );
    });

    it('should return false for non-existent subscription', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });

      const result = manager.unregisterSubscription('peer-1', 'sub-1');

      expect(result).toBe(false);
    });

    it('should return false for non-existent peer', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });
      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });

      const result = manager.unregisterSubscription('peer-2', 'sub-1');

      expect(result).toBe(false);
    });

    it('should unregister all subscriptions for peer', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });
      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
      manager.registerSubscription('peer-1', 'sub-2', { kinds: [3] });
      manager.registerSubscription('peer-1', 'sub-3', { kinds: [5] });

      const count = manager.unregisterAllForPeer('peer-1');

      expect(count).toBe(3);
      expect(manager.getSubscriptionCount('peer-1')).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { peerId: 'peer-1', count: 3 },
        'All subscriptions unregistered for peer'
      );
    });

    it('should return 0 when unregistering all for non-existent peer', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });

      const count = manager.unregisterAllForPeer('peer-1');

      expect(count).toBe(0);
    });
  });

  describe('filter matching', () => {
    describe('by kinds', () => {
      it('should match event by kind', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { kinds: [1, 3, 5] });

        const event = createTestEvent({ kind: 3 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
        expect(matches[0]?.id).toBe('sub-1');
      });

      it('should not match event with non-matching kind', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { kinds: [1, 3, 5] });

        const event = createTestEvent({ kind: 7 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('by authors', () => {
      it('should match event by author', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        const authorPubkey = 'author'.padEnd(64, '0');
        manager.registerSubscription('peer-1', 'sub-1', { authors: [authorPubkey] });

        const event = createTestEvent({ pubkey: authorPubkey });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match event with non-matching author', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { authors: ['author1'.padEnd(64, '0')] });

        const event = createTestEvent({ pubkey: 'author2'.padEnd(64, '0') });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('by since/until', () => {
      it('should match event after since timestamp', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { since: 1700000000 });

        const event = createTestEvent({ created_at: 1700000001 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should match event at exact since timestamp', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { since: 1700000000 });

        const event = createTestEvent({ created_at: 1700000000 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match event before since timestamp', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { since: 1700000000 });

        const event = createTestEvent({ created_at: 1699999999 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });

      it('should match event before until timestamp', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { until: 1800000000 });

        const event = createTestEvent({ created_at: 1799999999 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should match event at exact until timestamp', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { until: 1800000000 });

        const event = createTestEvent({ created_at: 1800000000 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match event after until timestamp', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { until: 1800000000 });

        const event = createTestEvent({ created_at: 1800000001 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('by #e tags', () => {
      it('should match event with matching e tag', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        const eventRef = 'referenced'.padEnd(64, '0');
        manager.registerSubscription('peer-1', 'sub-1', { '#e': [eventRef] });

        const event = createTestEvent({
          tags: [['e', eventRef]],
        });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match event without matching e tag', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { '#e': ['event1'.padEnd(64, '0')] });

        const event = createTestEvent({
          tags: [['e', 'event2'.padEnd(64, '0')]],
        });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });

      it('should not match event without e tags', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { '#e': ['event1'.padEnd(64, '0')] });

        const event = createTestEvent({ tags: [] });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('by #p tags', () => {
      it('should match event with matching p tag', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        const pubkeyRef = 'mentioned'.padEnd(64, '0');
        manager.registerSubscription('peer-1', 'sub-1', { '#p': [pubkeyRef] });

        const event = createTestEvent({
          tags: [['p', pubkeyRef]],
        });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match event without matching p tag', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { '#p': ['pubkey1'.padEnd(64, '0')] });

        const event = createTestEvent({
          tags: [['p', 'pubkey2'.padEnd(64, '0')]],
        });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('by ids', () => {
      it('should match event by id', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        const eventId = 'specific'.padEnd(64, '0');
        manager.registerSubscription('peer-1', 'sub-1', { ids: [eventId] });

        const event = createTestEvent({ id: eventId });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match event with different id', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { ids: ['id1'.padEnd(64, '0')] });

        const event = createTestEvent({ id: 'id2'.padEnd(64, '0') });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('combined filters', () => {
      it('should match event when all criteria match', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        const authorPubkey = 'author'.padEnd(64, '0');
        manager.registerSubscription('peer-1', 'sub-1', {
          kinds: [1],
          authors: [authorPubkey],
          since: 1700000000,
          until: 1800000000,
        });

        const event = createTestEvent({
          kind: 1,
          pubkey: authorPubkey,
          created_at: 1750000000,
        });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });

      it('should not match when any criterion fails', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', {
          kinds: [1],
          authors: ['author1'.padEnd(64, '0')],
        });

        // Wrong author
        const event = createTestEvent({
          kind: 1,
          pubkey: 'author2'.padEnd(64, '0'),
        });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });

    describe('empty filter', () => {
      it('should match all events when filter is empty', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', {});

        const event = createTestEvent();
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(1);
      });
    });

    describe('multiple subscriptions', () => {
      it('should return all matching subscriptions', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });
        manager.registerSubscription('peer-1', 'sub-2', { kinds: [1, 3] });
        manager.registerSubscription('peer-2', 'sub-1', { kinds: [1] });
        manager.registerSubscription('peer-2', 'sub-2', { kinds: [3] });

        const event = createTestEvent({ kind: 1 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(3);
        const subIds = matches.map((m) => m.id);
        expect(subIds).toContain('sub-1');
        expect(subIds).toContain('sub-2');
      });

      it('should return empty array when no matches', () => {
        const manager = new SubscriptionManager({ logger: mockLogger });
        manager.registerSubscription('peer-1', 'sub-1', { kinds: [3] });
        manager.registerSubscription('peer-2', 'sub-1', { kinds: [5] });

        const event = createTestEvent({ kind: 1 });
        const matches = manager.getMatchingSubscriptions(event);

        expect(matches).toHaveLength(0);
      });
    });
  });

  describe('getSubscription', () => {
    it('should return subscription if it exists', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });
      const filter: NostrFilter = { kinds: [1] };
      manager.registerSubscription('peer-1', 'sub-1', filter);

      const sub = manager.getSubscription('peer-1', 'sub-1');

      expect(sub).toBeDefined();
      expect(sub?.id).toBe('sub-1');
      expect(sub?.peerId).toBe('peer-1');
      expect(sub?.filter).toEqual(filter);
      expect(sub?.createdAt).toBeGreaterThan(0);
    });

    it('should return undefined if subscription does not exist', () => {
      const manager = new SubscriptionManager({ logger: mockLogger });

      const sub = manager.getSubscription('peer-1', 'sub-1');

      expect(sub).toBeUndefined();
    });
  });

  describe('without logger', () => {
    it('should work without logger', () => {
      const manager = new SubscriptionManager();

      manager.registerSubscription('peer-1', 'sub-1', { kinds: [1] });

      expect(manager.hasSubscription('peer-1', 'sub-1')).toBe(true);
    });
  });
});
