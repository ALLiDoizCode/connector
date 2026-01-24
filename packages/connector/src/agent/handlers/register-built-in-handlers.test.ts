// Mock toon-codec to avoid ESM transformation issues with @toon-format/toon
jest.mock('../toon-codec', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

import type { Logger } from 'pino';
import { registerBuiltInHandlers } from './register-built-in-handlers';
import type { AgentEventHandler, HandlerConfig, EventHandlerContext } from '../event-handler';
import type { FollowGraphRouter } from '../follow-graph-router';

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
 * Create a mock AgentEventHandler for testing.
 */
function createMockEventHandler(): jest.Mocked<AgentEventHandler> {
  return {
    registerHandler: jest.fn(),
    unregisterHandler: jest.fn(),
    getRegisteredKinds: jest.fn(),
    hasHandler: jest.fn(),
    getHandlerConfig: jest.fn(),
    handleEvent: jest.fn(),
    createPaymentReject: jest.fn(),
    createErrorReject: jest.fn(),
  } as unknown as jest.Mocked<AgentEventHandler>;
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

describe('registerBuiltInHandlers', () => {
  let mockEventHandler: jest.Mocked<AgentEventHandler>;
  let mockRouter: jest.Mocked<FollowGraphRouter>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockEventHandler = createMockEventHandler();
    mockRouter = createMockFollowGraphRouter();
    mockLogger = createMockLogger();
  });

  it('should register all 4 built-in handlers', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    expect(mockEventHandler.registerHandler).toHaveBeenCalledTimes(4);
  });

  it('should register Kind 1 handler with noteStorage payment', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    const kind1Call = mockEventHandler.registerHandler.mock.calls.find(
      (call) => (call[0] as HandlerConfig).kind === 1
    );

    expect(kind1Call).toBeDefined();
    const config = kind1Call![0] as HandlerConfig;
    expect(config.requiredPayment).toBe(1000n);
    expect(config.description).toBe('Note storage');
    expect(typeof config.handler).toBe('function');
  });

  it('should register Kind 3 handler with followUpdate payment', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    const kind3Call = mockEventHandler.registerHandler.mock.calls.find(
      (call) => (call[0] as HandlerConfig).kind === 3
    );

    expect(kind3Call).toBeDefined();
    const config = kind3Call![0] as HandlerConfig;
    expect(config.requiredPayment).toBe(500n);
    expect(config.description).toBe('Follow list update');
    expect(typeof config.handler).toBe('function');
  });

  it('should register Kind 5 handler with deletion payment', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    const kind5Call = mockEventHandler.registerHandler.mock.calls.find(
      (call) => (call[0] as HandlerConfig).kind === 5
    );

    expect(kind5Call).toBeDefined();
    const config = kind5Call![0] as HandlerConfig;
    expect(config.requiredPayment).toBe(100n);
    expect(config.description).toBe('Event deletion');
    expect(typeof config.handler).toBe('function');
  });

  it('should register Kind 10000 handler with queryBase payment', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    const kind10000Call = mockEventHandler.registerHandler.mock.calls.find(
      (call) => (call[0] as HandlerConfig).kind === 10000
    );

    expect(kind10000Call).toBeDefined();
    const config = kind10000Call![0] as HandlerConfig;
    expect(config.requiredPayment).toBe(200n);
    expect(config.description).toBe('Query service');
    expect(typeof config.handler).toBe('function');
  });

  it('should inject followGraphRouter into follow handler', async () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    // Get the registered Kind 3 handler
    const kind3Call = mockEventHandler.registerHandler.mock.calls.find(
      (call) => (call[0] as HandlerConfig).kind === 3
    );
    const handler = (kind3Call![0] as HandlerConfig).handler;

    // Create a mock context with Kind 3 event
    const mockDatabase = {
      storeEvent: jest.fn(),
      queryEvents: jest.fn(),
    };
    const mockContext = {
      event: {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: [],
        content: '',
        sig: 'c'.repeat(128),
      },
      packet: {} as unknown as EventHandlerContext['packet'],
      amount: 1000n,
      source: 'peer-1',
      agentPubkey: 'd'.repeat(64),
      database: mockDatabase as unknown as EventHandlerContext['database'],
    };

    // Execute the handler
    await handler(mockContext);

    // Verify followGraphRouter was called
    expect(mockRouter.updateFromFollowEvent).toHaveBeenCalledWith(mockContext.event);
  });

  it('should work without optional logger', () => {
    expect(() => {
      registerBuiltInHandlers(mockEventHandler, {
        followGraphRouter: mockRouter,
        pricing: {
          noteStorage: 1000n,
          followUpdate: 500n,
          deletion: 100n,
          queryBase: 200n,
        },
      });
    }).not.toThrow();

    expect(mockEventHandler.registerHandler).toHaveBeenCalledTimes(4);
  });

  it('should apply custom queryConfig when provided', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
        queryPerResult: 10n,
      },
      queryConfig: {
        maxResults: 50,
      },
      logger: mockLogger,
    });

    // The handler is registered; the config is applied internally
    expect(mockEventHandler.registerHandler).toHaveBeenCalledTimes(4);
  });

  it('should apply different pricing values correctly', () => {
    const pricing = {
      noteStorage: 5000n,
      followUpdate: 2500n,
      deletion: 500n,
      queryBase: 1000n,
    };

    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing,
      logger: mockLogger,
    });

    const registeredConfigs = mockEventHandler.registerHandler.mock.calls.map(
      (call) => call[0] as HandlerConfig
    );

    const kind1 = registeredConfigs.find((c) => c.kind === 1);
    const kind3 = registeredConfigs.find((c) => c.kind === 3);
    const kind5 = registeredConfigs.find((c) => c.kind === 5);
    const kind10000 = registeredConfigs.find((c) => c.kind === 10000);

    expect(kind1?.requiredPayment).toBe(5000n);
    expect(kind3?.requiredPayment).toBe(2500n);
    expect(kind5?.requiredPayment).toBe(500n);
    expect(kind10000?.requiredPayment).toBe(1000n);
  });

  it('should log registration when logger is provided', () => {
    registerBuiltInHandlers(mockEventHandler, {
      followGraphRouter: mockRouter,
      pricing: {
        noteStorage: 1000n,
        followUpdate: 500n,
        deletion: 100n,
        queryBase: 200n,
      },
      logger: mockLogger,
    });

    expect(mockLogger.info).toHaveBeenCalledWith('Built-in handlers registered');
  });
});
