import type { Logger } from 'pino';
import { FollowGraphRouter } from './follow-graph-router';
import type { NostrEvent } from './toon-codec';

/**
 * Creates a mock Pino logger for testing.
 */
function createMockLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
    level: 'info',
  } as unknown as jest.Mocked<Logger>;
}

/**
 * Creates a mock Kind 3 Nostr event with ILP address tags.
 */
function createKind3Event(
  follows: Array<{ pubkey: string; ilpAddress: string; petname?: string }>,
  eventPubkey: string = 'event-author-pubkey'
): NostrEvent {
  const tags: string[][] = [];

  for (const follow of follows) {
    // Add ILP tag
    tags.push(['ilp', follow.pubkey, follow.ilpAddress]);

    // Add p-tag with petname if provided
    if (follow.petname) {
      tags.push(['p', follow.pubkey, 'wss://relay.example.com', follow.petname]);
    } else {
      tags.push(['p', follow.pubkey, 'wss://relay.example.com']);
    }
  }

  return {
    id: 'event-id-' + Math.random().toString(36).slice(2),
    pubkey: eventPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 3,
    tags,
    content: '',
    sig: 'mock-signature',
  };
}

describe('FollowGraphRouter', () => {
  let router: FollowGraphRouter;
  let mockLogger: jest.Mocked<Logger>;
  const testAgentPubkey = 'test-agent-pubkey-64chars-hex'.padEnd(64, '0');

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('constructor', () => {
    it('should create router with empty follow graph', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        logger: mockLogger,
      });

      expect(router.getFollowCount()).toBe(0);
      expect(router.getAllFollows()).toEqual([]);
    });

    it('should initialize routes for all initial follows', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [
          { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' },
          { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
        ],
        logger: mockLogger,
      });

      expect(router.getFollowCount()).toBe(2);
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
      expect(router.getNextHop('g.agent.bob')).toBe('bob-pubkey');
    });

    it('should store all initial follows in followGraph', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [
          { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice', petname: 'Alice' },
          { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
        ],
        logger: mockLogger,
      });

      const alice = router.getFollowByPubkey('alice-pubkey');
      expect(alice).toBeDefined();
      expect(alice?.ilpAddress).toBe('g.agent.alice');
      expect(alice?.petname).toBe('Alice');

      const bob = router.getFollowByPubkey('bob-pubkey');
      expect(bob).toBeDefined();
      expect(bob?.ilpAddress).toBe('g.agent.bob');
    });

    it('should log initialization when follows are provided', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [{ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' }],
        logger: mockLogger,
      });

      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'FollowGraphRouter' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        { followCount: 1 },
        'Initialized follow graph from config'
      );
    });

    it('should work without logger', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [{ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' }],
      });

      expect(router.getFollowCount()).toBe(1);
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
    });
  });

  describe('Kind 3 event parsing', () => {
    beforeEach(() => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        logger: mockLogger,
      });
    });

    it('should parse ILP tags correctly', () => {
      const event = createKind3Event([
        { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' },
        { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
      ]);

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(2);
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
      expect(router.getNextHop('g.agent.bob')).toBe('bob-pubkey');
    });

    it('should extract petnames from p-tags when available', () => {
      const event = createKind3Event([
        { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice', petname: 'Alice' },
        { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
      ]);

      router.updateFromFollowEvent(event);

      const alice = router.getFollowByPubkey('alice-pubkey');
      expect(alice?.petname).toBe('Alice');

      const bob = router.getFollowByPubkey('bob-pubkey');
      expect(bob?.petname).toBeUndefined();
    });

    it('should handle events with no ILP tags', () => {
      const event: NostrEvent = {
        id: 'event-id',
        pubkey: 'author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: [
          ['p', 'alice-pubkey', 'wss://relay.example.com'],
          ['p', 'bob-pubkey', 'wss://relay.example.com'],
        ],
        content: '',
        sig: 'mock-signature',
      };

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(0);
    });

    it('should skip malformed ILP tags', () => {
      const event: NostrEvent = {
        id: 'event-id',
        pubkey: 'author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: [
          ['ilp', 'alice-pubkey', 'g.agent.alice'], // Valid
          ['ilp', 'bob-pubkey'], // Missing ILP address
          ['ilp'], // Missing both
          ['ilp', 'charlie-pubkey', 'g.agent.charlie'], // Valid
        ],
        content: '',
        sig: 'mock-signature',
      };

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(2);
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
      expect(router.getNextHop('g.agent.charlie')).toBe('charlie-pubkey');
    });

    it('should skip ILP tags with invalid ILP addresses', () => {
      const event: NostrEvent = {
        id: 'event-id',
        pubkey: 'author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: [
          ['ilp', 'alice-pubkey', 'g.agent.alice'], // Valid
          ['ilp', 'bob-pubkey', 'invalid address with spaces'], // Invalid
          ['ilp', 'charlie-pubkey', ''], // Empty
        ],
        content: '',
        sig: 'mock-signature',
      };

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(1);
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
    });

    it('should log warning for non-Kind-3 events', () => {
      const event: NostrEvent = {
        id: 'event-id',
        pubkey: 'author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1, // Text note, not follow list
        tags: [],
        content: 'Hello world',
        sig: 'mock-signature',
      };

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { kind: 1 },
        'Expected Kind 3 event, got different kind'
      );
    });
  });

  describe('follow graph updates', () => {
    beforeEach(() => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [{ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' }],
        logger: mockLogger,
      });
    });

    it('should add new follows via updateFromFollowEvent', () => {
      const event = createKind3Event([
        { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' },
        { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
      ]);

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(2);
      expect(router.getNextHop('g.agent.bob')).toBe('bob-pubkey');
    });

    it('should replace all follows via updateFromFollowEvent', () => {
      // Initial: alice
      expect(router.getFollowCount()).toBe(1);
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');

      // Update to: bob only
      const event = createKind3Event([{ pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' }]);

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(1);
      expect(router.getNextHop('g.agent.alice')).toBeNull();
      expect(router.getNextHop('g.agent.bob')).toBe('bob-pubkey');
    });

    it('should add single follow via addFollow', () => {
      router.addFollow({ pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' });

      expect(router.getFollowCount()).toBe(2);
      expect(router.getNextHop('g.agent.bob')).toBe('bob-pubkey');
    });

    it('should replace existing follow via addFollow with same pubkey', () => {
      router.addFollow({ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice.new' });

      expect(router.getFollowCount()).toBe(1);
      expect(router.getNextHop('g.agent.alice')).toBeNull();
      expect(router.getNextHop('g.agent.alice.new')).toBe('alice-pubkey');
    });

    it('should remove follow and route via removeFollow', () => {
      const result = router.removeFollow('alice-pubkey');

      expect(result).toBe(true);
      expect(router.getFollowCount()).toBe(0);
      expect(router.getNextHop('g.agent.alice')).toBeNull();
    });

    it('should return false when removing non-existent follow', () => {
      const result = router.removeFollow('non-existent-pubkey');

      expect(result).toBe(false);
      expect(router.getFollowCount()).toBe(1);
    });

    it('should throw error when adding follow with invalid ILP address', () => {
      expect(() => {
        router.addFollow({ pubkey: 'bob-pubkey', ilpAddress: 'invalid address' });
      }).toThrow('Invalid ILP address: invalid address');
    });
  });

  describe('routing lookups', () => {
    beforeEach(() => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [
          { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' },
          { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
          { pubkey: 'charlie-pubkey', ilpAddress: 'g.agent.alice.wallet' },
        ],
        logger: mockLogger,
      });
    });

    it('should return correct pubkey for exact match', () => {
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
      expect(router.getNextHop('g.agent.bob')).toBe('bob-pubkey');
    });

    it('should return correct pubkey for prefix match', () => {
      // g.agent.alice.query should match g.agent.alice
      expect(router.getNextHop('g.agent.alice.query')).toBe('alice-pubkey');
    });

    it('should return longest prefix match', () => {
      // g.agent.alice.wallet.USD should match g.agent.alice.wallet (longer) not g.agent.alice
      expect(router.getNextHop('g.agent.alice.wallet.USD')).toBe('charlie-pubkey');
    });

    it('should return null for unknown destination', () => {
      expect(router.getNextHop('g.agent.unknown')).toBeNull();
      expect(router.getNextHop('test.invalid')).toBeNull();
    });

    it('should correctly check route existence with hasRouteTo', () => {
      expect(router.hasRouteTo('g.agent.alice')).toBe(true);
      expect(router.hasRouteTo('g.agent.alice.query')).toBe(true);
      expect(router.hasRouteTo('g.agent.unknown')).toBe(false);
    });

    it('should find follow by ILP address', () => {
      const alice = router.getFollowByILPAddress('g.agent.alice');
      expect(alice).toBeDefined();
      expect(alice?.pubkey).toBe('alice-pubkey');

      const unknown = router.getFollowByILPAddress('g.agent.unknown');
      expect(unknown).toBeUndefined();
    });
  });

  describe('graph export', () => {
    beforeEach(() => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [
          { pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' },
          { pubkey: 'bob-pubkey', ilpAddress: 'g.agent.bob' },
        ],
        logger: mockLogger,
      });
    });

    it('should export graph with correct edge structure', () => {
      const edges = router.exportGraph();

      expect(edges).toHaveLength(2);

      const aliceEdge = edges.find((e) => e.toPubkey === 'alice-pubkey');
      expect(aliceEdge).toBeDefined();
      expect(aliceEdge?.fromPubkey).toBe(testAgentPubkey);
      expect(aliceEdge?.ilpAddress).toBe('g.agent.alice');
      expect(aliceEdge?.addedAt).toBeDefined();
      expect(typeof aliceEdge?.addedAt).toBe('number');
    });

    it('should return empty array for empty graph', () => {
      const emptyRouter = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        logger: mockLogger,
      });

      expect(emptyRouter.exportGraph()).toEqual([]);
    });

    it('should return correct pubkey -> address map via getKnownAgents', () => {
      const agents = router.getKnownAgents();

      expect(agents.size).toBe(2);
      expect(agents.get('alice-pubkey')).toBe('g.agent.alice');
      expect(agents.get('bob-pubkey')).toBe('g.agent.bob');
    });

    it('should return all follows via getAllFollows', () => {
      const follows = router.getAllFollows();

      expect(follows).toHaveLength(2);
      expect(follows.map((f) => f.pubkey).sort()).toEqual(['alice-pubkey', 'bob-pubkey']);
    });
  });

  describe('edge cases', () => {
    it('should handle empty initial follows config', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [],
        logger: mockLogger,
      });

      expect(router.getFollowCount()).toBe(0);
      expect(router.getNextHop('g.agent.anyone')).toBeNull();
    });

    it('should handle event with mixed valid/invalid ILP tags', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        logger: mockLogger,
      });

      const event: NostrEvent = {
        id: 'event-id',
        pubkey: 'author-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: [
          ['ilp', 'alice-pubkey', 'g.agent.alice'],
          ['ilp', 'bob-pubkey', 'invalid with spaces'],
          ['ilp', 'charlie-pubkey', 'g.agent.charlie'],
          ['random', 'tag', 'data'],
          ['ilp'], // malformed
        ],
        content: '',
        sig: 'mock-signature',
      };

      router.updateFromFollowEvent(event);

      expect(router.getFollowCount()).toBe(2);
      expect(router.getFollowByPubkey('alice-pubkey')).toBeDefined();
      expect(router.getFollowByPubkey('charlie-pubkey')).toBeDefined();
      expect(router.getFollowByPubkey('bob-pubkey')).toBeUndefined();
    });

    it('should update follow that already exists (replace)', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [{ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice.old' }],
        logger: mockLogger,
      });

      router.addFollow({ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice.new' });

      expect(router.getFollowCount()).toBe(1);
      const alice = router.getFollowByPubkey('alice-pubkey');
      expect(alice?.ilpAddress).toBe('g.agent.alice.new');
      expect(router.getNextHop('g.agent.alice.old')).toBeNull();
      expect(router.getNextHop('g.agent.alice.new')).toBe('alice-pubkey');
    });

    it('should preserve addedAt timestamp in follows', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        logger: mockLogger,
      });

      const beforeAdd = Math.floor(Date.now() / 1000);
      router.addFollow({ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice' });
      const afterAdd = Math.floor(Date.now() / 1000);

      const alice = router.getFollowByPubkey('alice-pubkey');
      expect(alice?.addedAt).toBeGreaterThanOrEqual(beforeAdd);
      expect(alice?.addedAt).toBeLessThanOrEqual(afterAdd);
    });

    it('should handle updating follow with same ILP address', () => {
      router = new FollowGraphRouter({
        agentPubkey: testAgentPubkey,
        initialFollows: [{ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice', petname: 'Alice' }],
        logger: mockLogger,
      });

      router.addFollow({ pubkey: 'alice-pubkey', ilpAddress: 'g.agent.alice', petname: 'Alicia' });

      expect(router.getFollowCount()).toBe(1);
      const alice = router.getFollowByPubkey('alice-pubkey');
      expect(alice?.petname).toBe('Alicia');
      expect(router.getNextHop('g.agent.alice')).toBe('alice-pubkey');
    });
  });
});
