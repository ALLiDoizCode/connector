// Mock toon-codec to avoid ESM transformation issues with @toon-format/toon
jest.mock('./toon-codec', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

import type { Logger } from 'pino';
import { PacketType, ILPErrorCode } from '@m2m/shared';
import {
  AgentEventHandler,
  EventHandlerContext,
  EventHandlerResult,
  HandlerConfig,
  InsufficientPaymentError,
} from './event-handler';
import type { AgentEventDatabase } from './event-database';

// Local NostrEvent interface for testing (matches toon-codec)
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

  // Make child() return the same mock logger
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
function createTestContext(overrides: Partial<EventHandlerContext> = {}): EventHandlerContext {
  const event = createTestEvent(overrides.event as Partial<NostrEvent>);
  return {
    event,
    packet: {
      type: PacketType.PREPARE,
      amount: 1000n,
      destination: 'g.test.agent',
      executionCondition: Buffer.alloc(32),
      expiresAt: new Date(Date.now() + 30000),
      data: Buffer.alloc(0),
    },
    amount: 1000n,
    source: 'peer-1',
    agentPubkey: 'd'.repeat(64),
    database: createMockDatabase(),
    ...overrides,
  };
}

describe('AgentEventHandler', () => {
  let handler: AgentEventHandler;
  let mockDatabase: jest.Mocked<AgentEventDatabase>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    mockLogger = createMockLogger();
    handler = new AgentEventHandler({
      agentPubkey: 'test-pubkey',
      database: mockDatabase,
      logger: mockLogger,
    });
  });

  // ============================================
  // Handler Registration Tests (Task 3)
  // ============================================
  describe('handler registration', () => {
    it('should register handler for kind successfully', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });

      handler.registerHandler({
        kind: 1,
        handler: testHandler,
        requiredPayment: 100n,
        description: 'Test handler',
      });

      expect(handler.hasHandler(1)).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { kind: 1, description: 'Test handler' },
        'Handler registered'
      );
    });

    it('should return registered kinds via getRegisteredKinds', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });

      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });
      handler.registerHandler({ kind: 3, handler: testHandler, requiredPayment: 0n });
      handler.registerHandler({ kind: 5, handler: testHandler, requiredPayment: 0n });

      const kinds = handler.getRegisteredKinds();
      expect(kinds).toHaveLength(3);
      expect(kinds).toContain(1);
      expect(kinds).toContain(3);
      expect(kinds).toContain(5);
    });

    it('should return true for hasHandler on registered kind', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 42, handler: testHandler, requiredPayment: 0n });

      expect(handler.hasHandler(42)).toBe(true);
    });

    it('should return false for hasHandler on unregistered kind', () => {
      expect(handler.hasHandler(999)).toBe(false);
    });

    it('should unregister handler and return true', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const result = handler.unregisterHandler(1);

      expect(result).toBe(true);
      expect(handler.hasHandler(1)).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith({ kind: 1 }, 'Handler unregistered');
    });

    it('should return false when unregistering non-existent handler', () => {
      const result = handler.unregisterHandler(999);
      expect(result).toBe(false);
    });

    it('should throw error for invalid kind (negative number)', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });

      expect(() => {
        handler.registerHandler({ kind: -1, handler: testHandler, requiredPayment: 0n });
      }).toThrow('Invalid kind: must be a non-negative integer, got -1');
    });

    it('should throw error for invalid kind (non-integer)', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });

      expect(() => {
        handler.registerHandler({ kind: 1.5, handler: testHandler, requiredPayment: 0n });
      }).toThrow('Invalid kind: must be a non-negative integer, got 1.5');
    });

    it('should throw error for invalid handler (not a function)', () => {
      expect(() => {
        handler.registerHandler({
          kind: 1,
          handler: 'not a function' as unknown as () => Promise<EventHandlerResult>,
          requiredPayment: 0n,
        });
      }).toThrow('Invalid handler: must be a function');
    });

    it('should throw error for invalid requiredPayment (negative)', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });

      expect(() => {
        handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: -100n });
      }).toThrow('Invalid requiredPayment: must be a non-negative bigint');
    });

    it('should return handler config via getHandlerConfig', () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      const config: HandlerConfig = {
        kind: 1,
        handler: testHandler,
        requiredPayment: 500n,
        description: 'Test',
      };

      handler.registerHandler(config);

      const retrieved = handler.getHandlerConfig(1);
      expect(retrieved).toEqual(config);
    });

    it('should return undefined for getHandlerConfig on unregistered kind', () => {
      expect(handler.getHandlerConfig(999)).toBeUndefined();
    });

    it('should allow overwriting existing handler', () => {
      const handler1 = jest.fn().mockResolvedValue({ success: true });
      const handler2 = jest.fn().mockResolvedValue({ success: false });

      handler.registerHandler({ kind: 1, handler: handler1, requiredPayment: 100n });
      handler.registerHandler({ kind: 1, handler: handler2, requiredPayment: 200n });

      const config = handler.getHandlerConfig(1);
      expect(config?.handler).toBe(handler2);
      expect(config?.requiredPayment).toBe(200n);
    });
  });

  // ============================================
  // Payment Validation Tests (Task 4)
  // ============================================
  describe('payment validation', () => {
    it('should allow event when payment >= required', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 100n });

      const context = createTestContext({ amount: 100n, event: createTestEvent({ kind: 1 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(true);
      expect(testHandler).toHaveBeenCalled();
    });

    it('should allow event when payment > required (overpayment)', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 100n });

      const context = createTestContext({ amount: 500n, event: createTestEvent({ kind: 1 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(true);
      expect(testHandler).toHaveBeenCalled();
    });

    it('should throw InsufficientPaymentError when payment < required', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 1000n });

      const context = createTestContext({ amount: 100n, event: createTestEvent({ kind: 1 }) });

      await expect(handler.handleEvent(context)).rejects.toThrow(InsufficientPaymentError);
      expect(testHandler).not.toHaveBeenCalled();
    });

    it('should include correct amounts in InsufficientPaymentError', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 1000n });

      const context = createTestContext({ amount: 100n, event: createTestEvent({ kind: 1 }) });

      try {
        await handler.handleEvent(context);
        fail('Expected InsufficientPaymentError');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientPaymentError);
        const paymentError = error as InsufficientPaymentError;
        expect(paymentError.required).toBe(1000n);
        expect(paymentError.received).toBe(100n);
        expect(paymentError.code).toBe('F03');
      }
    });

    it('should accept zero payment for free handlers (requiredPayment: 0n)', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({ amount: 0n, event: createTestEvent({ kind: 1 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(true);
      expect(testHandler).toHaveBeenCalled();
    });

    it('should use defaultPayment for unregistered kinds when configured', async () => {
      const handlerWithDefault = new AgentEventHandler({
        agentPubkey: 'test-pubkey',
        database: mockDatabase,
        logger: mockLogger,
        defaultPayment: 500n,
      });

      // No handler registered for kind 99
      const context = createTestContext({ amount: 100n, event: createTestEvent({ kind: 99 }) });

      await expect(handlerWithDefault.handleEvent(context)).rejects.toThrow(
        InsufficientPaymentError
      );
    });

    it('should allow unregistered kind with defaultPayment met', async () => {
      const handlerWithDefault = new AgentEventHandler({
        agentPubkey: 'test-pubkey',
        database: mockDatabase,
        logger: mockLogger,
        defaultPayment: 500n,
      });

      // No handler registered - should pass payment but fail with F99
      const context = createTestContext({ amount: 500n, event: createTestEvent({ kind: 99 }) });
      const result = await handlerWithDefault.handleEvent(context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('F99');
    });

    it('should allow free access to unregistered kinds when no defaultPayment', async () => {
      // No handler registered for kind 99, no defaultPayment
      const context = createTestContext({ amount: 0n, event: createTestEvent({ kind: 99 }) });
      const result = await handler.handleEvent(context);

      // Should pass payment validation but fail with F99 (no handler)
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('F99');
    });
  });

  // ============================================
  // Event Dispatch Tests (Task 5)
  // ============================================
  describe('event dispatch', () => {
    it('should route event to correct handler based on kind', async () => {
      const handler1 = jest.fn().mockResolvedValue({ success: true });
      const handler2 = jest.fn().mockResolvedValue({ success: true });

      handler.registerHandler({ kind: 1, handler: handler1, requiredPayment: 0n });
      handler.registerHandler({ kind: 3, handler: handler2, requiredPayment: 0n });

      const context1 = createTestContext({ event: createTestEvent({ kind: 1 }) });
      await handler.handleEvent(context1);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();

      const context3 = createTestContext({ event: createTestEvent({ kind: 3 }) });
      await handler.handleEvent(context3);

      expect(handler2).toHaveBeenCalled();
    });

    it('should pass complete context to handler', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({
        amount: 500n,
        source: 'test-peer',
        agentPubkey: 'test-agent-key',
        event: createTestEvent({ kind: 1, content: 'hello world' }),
      });
      await handler.handleEvent(context);

      expect(testHandler).toHaveBeenCalledWith(context);
      const calledWith = testHandler.mock.calls[0][0] as EventHandlerContext;
      expect(calledWith.amount).toBe(500n);
      expect(calledWith.source).toBe('test-peer');
      expect(calledWith.agentPubkey).toBe('test-agent-key');
      expect(calledWith.event.content).toBe('hello world');
      expect(calledWith.database).toBeDefined();
    });

    it('should return handler result on success', async () => {
      const responseEvent = createTestEvent({ kind: 10000, content: 'response' });
      const testHandler = jest.fn().mockResolvedValue({
        success: true,
        responseEvent,
      });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({ event: createTestEvent({ kind: 1 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(true);
      expect(result.responseEvent).toEqual(responseEvent);
    });

    it('should return F99 error for unregistered kinds', async () => {
      const context = createTestContext({ event: createTestEvent({ kind: 999 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('F99');
      expect(result.error?.message).toBe('Unsupported event kind');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { kind: 999 },
        'No handler registered for event kind'
      );
    });

    it('should return T00 error when handler throws', async () => {
      const testHandler = jest.fn().mockRejectedValue(new Error('Handler crashed'));
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({ event: createTestEvent({ kind: 1 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('T00');
      expect(result.error?.message).toBe('Handler execution failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return T00 error when handler returns invalid result', async () => {
      const testHandler = jest.fn().mockResolvedValue(null);
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({ event: createTestEvent({ kind: 1 }) });
      const result = await handler.handleEvent(context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('T00');
    });

    it('should validate payment before calling handler', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 1000n });

      const context = createTestContext({ amount: 100n, event: createTestEvent({ kind: 1 }) });

      await expect(handler.handleEvent(context)).rejects.toThrow(InsufficientPaymentError);
      expect(testHandler).not.toHaveBeenCalled();
    });

    it('should log successful event handling', async () => {
      const testHandler = jest.fn().mockResolvedValue({ success: true });
      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({ event: createTestEvent({ kind: 1 }) });
      await handler.handleEvent(context);

      expect(mockLogger.info).toHaveBeenCalledWith({ kind: 1, success: true }, 'Event handled');
    });
  });

  // ============================================
  // Rejection Helper Tests (Task 6)
  // ============================================
  describe('rejection helpers', () => {
    it('should create correct F03 packet via createPaymentReject', () => {
      const error = new InsufficientPaymentError(1000n, 100n);
      const reject = handler.createPaymentReject(error, 'g.test.connector');

      expect(reject.type).toBe(PacketType.REJECT);
      expect(reject.code).toBe(ILPErrorCode.F03_INVALID_AMOUNT);
      expect(reject.triggeredBy).toBe('g.test.connector');
      expect(reject.message).toBe('Insufficient payment: required 1000, received 100');

      const data = JSON.parse(reject.data.toString());
      expect(data.required).toBe('1000');
      expect(data.received).toBe('100');
    });

    it('should create correct F99 packet via createErrorReject', () => {
      const reject = handler.createErrorReject(
        ILPErrorCode.F99_APPLICATION_ERROR,
        'Unsupported event kind',
        'g.test.agent'
      );

      expect(reject.type).toBe(PacketType.REJECT);
      expect(reject.code).toBe(ILPErrorCode.F99_APPLICATION_ERROR);
      expect(reject.triggeredBy).toBe('g.test.agent');
      expect(reject.message).toBe('Unsupported event kind');
      expect(reject.data.length).toBe(0);
    });

    it('should create correct T00 packet via createErrorReject', () => {
      const reject = handler.createErrorReject(
        ILPErrorCode.T00_INTERNAL_ERROR,
        'Handler execution failed',
        'g.test.agent'
      );

      expect(reject.type).toBe(PacketType.REJECT);
      expect(reject.code).toBe(ILPErrorCode.T00_INTERNAL_ERROR);
      expect(reject.triggeredBy).toBe('g.test.agent');
      expect(reject.message).toBe('Handler execution failed');
    });
  });

  // ============================================
  // Concurrent Handling Tests
  // ============================================
  describe('concurrent handling', () => {
    it('should handle multiple events correctly in parallel', async () => {
      const results: number[] = [];
      const testHandler = jest.fn().mockImplementation(async (ctx: EventHandlerContext) => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(ctx.event.kind);
        return { success: true };
      });

      handler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });
      handler.registerHandler({ kind: 2, handler: testHandler, requiredPayment: 0n });
      handler.registerHandler({ kind: 3, handler: testHandler, requiredPayment: 0n });

      const context1 = createTestContext({ event: createTestEvent({ kind: 1 }) });
      const context2 = createTestContext({ event: createTestEvent({ kind: 2 }) });
      const context3 = createTestContext({ event: createTestEvent({ kind: 3 }) });

      const [result1, result2, result3] = await Promise.all([
        handler.handleEvent(context1),
        handler.handleEvent(context2),
        handler.handleEvent(context3),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);
      expect(testHandler).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
      expect(results).toContain(1);
      expect(results).toContain(2);
      expect(results).toContain(3);
    });

    it('should isolate failures between concurrent events', async () => {
      const successHandler = jest.fn().mockResolvedValue({ success: true });
      const failHandler = jest.fn().mockRejectedValue(new Error('Crash'));

      handler.registerHandler({ kind: 1, handler: successHandler, requiredPayment: 0n });
      handler.registerHandler({ kind: 2, handler: failHandler, requiredPayment: 0n });

      const context1 = createTestContext({ event: createTestEvent({ kind: 1 }) });
      const context2 = createTestContext({ event: createTestEvent({ kind: 2 }) });

      const [result1, result2] = await Promise.all([
        handler.handleEvent(context1),
        handler.handleEvent(context2),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result2.error?.code).toBe('T00');
    });
  });

  // ============================================
  // Constructor Tests
  // ============================================
  describe('constructor', () => {
    it('should work without logger (uses no-op logger)', async () => {
      const noLoggerHandler = new AgentEventHandler({
        agentPubkey: 'test-pubkey',
        database: mockDatabase,
      });

      const testHandler = jest.fn().mockResolvedValue({ success: true });
      noLoggerHandler.registerHandler({ kind: 1, handler: testHandler, requiredPayment: 0n });

      const context = createTestContext({ event: createTestEvent({ kind: 1 }) });
      const result = await noLoggerHandler.handleEvent(context);

      expect(result.success).toBe(true);
    });

    it('should create child logger from provided logger', () => {
      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'AgentEventHandler' });
    });
  });

  // ============================================
  // InsufficientPaymentError Tests
  // ============================================
  describe('InsufficientPaymentError', () => {
    it('should have correct properties', () => {
      const error = new InsufficientPaymentError(1000n, 100n);

      expect(error.name).toBe('InsufficientPaymentError');
      expect(error.code).toBe('F03');
      expect(error.required).toBe(1000n);
      expect(error.received).toBe(100n);
      expect(error.message).toBe('Insufficient payment: required 1000, received 100');
    });

    it('should be instanceof Error', () => {
      const error = new InsufficientPaymentError(1000n, 100n);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
