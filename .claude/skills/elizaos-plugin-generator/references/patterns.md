# ElizaOS Plugin Patterns & Examples

## Table of Contents

1. [Action Example](#action-example)
2. [Provider Example](#provider-example)
3. [Service Example](#service-example)
4. [Evaluator Example](#evaluator-example)
5. [Event Handlers](#event-handlers)
6. [HTTP Routes](#http-routes)
7. [Config with Zod Validation](#config-with-zod-validation)
8. [Test Utilities](#test-utilities)
9. [Action Test Example](#action-test-example)
10. [Pattern Archetypes](#pattern-archetypes)
11. [Anti-Patterns](#anti-patterns)

---

## Action Example

```typescript
import type { Action, ActionResult, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { logger } from '@elizaos/core';

export const generateVideoAction: Action = {
  name: 'TEXT_TO_VIDEO',
  similes: ['CREATE_VIDEO', 'MAKE_VIDEO', 'GENERATE_VIDEO'],
  description: 'Generate a video from a text prompt',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    const apiKey = runtime.getSetting('FAL_KEY');
    return !!apiKey;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const prompt = message.content.text || '';
      // ... API call logic ...
      const videoUrl = 'https://example.com/video.mp4'; // placeholder

      if (callback) {
        await callback({
          text: `Video generated: ${videoUrl}`,
          actions: ['TEXT_TO_VIDEO'],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text: 'Video generated successfully',
        data: { videoUrl },
      };
    } catch (error) {
      logger.error('Video generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      { name: '{{userName}}', content: { text: 'Create a video of a sunset', actions: [] } },
      { name: '{{agentName}}', content: { text: 'Generating video...', actions: ['TEXT_TO_VIDEO'] } },
    ],
  ],
};
```

## Provider Example

```typescript
import type { Provider, ProviderResult, IAgentRuntime, Memory, State } from '@elizaos/core';

export const weatherProvider: Provider = {
  name: 'WEATHER_PROVIDER',
  description: 'Provides current weather information',
  position: 10,

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<ProviderResult> => {
    const apiKey = runtime.getSetting('WEATHER_API_KEY');
    if (!apiKey) return { text: '', values: {}, data: {} };

    // ... fetch weather data ...
    const weather = { description: 'Sunny', temp: 72 }; // placeholder

    return {
      text: `Current weather: ${weather.description}, ${weather.temp}F`,
      values: { temperature: weather.temp, conditions: weather.description },
      data: { weather },
    };
  },
};
```

## Service Example

```typescript
import { Service, type IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';

export class PollingService extends Service {
  static serviceType = 'polling';
  capabilityDescription = 'Polls external API for updates';

  private intervalId?: NodeJS.Timeout;

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new PollingService(runtime);
    const interval = parseInt(runtime.getSetting('POLL_INTERVAL') as string || '60000');

    service.intervalId = setInterval(async () => {
      try {
        await service.poll();
      } catch (error) {
        logger.error('Polling failed:', error);
      }
    }, interval);

    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = runtime.getService<PollingService>(PollingService.serviceType);
    if (service) await service.stop();
  }

  private async poll() {
    // ... fetch data, emit events, update memory ...
  }

  async stop(): Promise<void> {
    if (this.intervalId) clearInterval(this.intervalId);
    logger.info('Polling service stopped');
  }
}
```

## Evaluator Example

```typescript
import type { Evaluator, IAgentRuntime, Memory, State } from '@elizaos/core';

export const sentimentEvaluator: Evaluator = {
  name: 'SENTIMENT_EVALUATOR',
  description: 'Analyzes message sentiment for relationship tracking',
  alwaysRun: true,

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    return !!message.content.text;
  },

  handler: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    // ... analyze sentiment ...
    await runtime.createMemory({
      entityId: message.entityId,
      roomId: message.roomId,
      content: { text: 'Sentiment: positive', metadata: { score: 0.8 } },
    } as any, 'sentiments');
  },

  examples: [],
};
```

## Event Handlers

```typescript
import type { Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';

// In your plugin definition:
events: {
  MESSAGE_RECEIVED: [
    async (params) => {
      const { runtime, message } = params;
      logger.info(`Message received: ${message.content.text}`);
    },
  ],
  WORLD_JOINED: [
    async (params) => {
      const { runtime, world } = params;
      logger.info(`Joined world: ${world.name}`);
    },
  ],
  ACTION_COMPLETED: [
    async (params) => {
      const { runtime, content } = params;
      logger.info(`Action completed`);
    },
  ],
},
```

## HTTP Routes

```typescript
routes: [
  {
    name: 'webhook-handler',
    type: 'POST',
    path: '/webhook',
    handler: async (req, res, runtime) => {
      const apiKey = req.headers?.['x-api-key'];
      if (apiKey !== runtime.getSetting('WEBHOOK_KEY')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const data = req.body;
      res.json({ status: 'ok' });
    },
  },
  {
    name: 'health-check',
    type: 'GET',
    path: '/health',
    public: true,
    handler: async (_req, res) => {
      res.json({ status: 'healthy' });
    },
  },
  {
    name: 'file-upload',
    type: 'POST',
    path: '/upload',
    isMultipart: true,
    handler: async (req, res, runtime) => {
      res.json({ uploaded: true });
    },
  },
  {
    name: 'dashboard',
    type: 'STATIC',
    path: '/dashboard',
    filePath: './frontend/dist',
  },
],
```

## Config with Zod Validation

```typescript
import { z } from 'zod';
import type { Plugin, IAgentRuntime } from '@elizaos/core';

const configSchema = z.object({
  MY_API_KEY: z.string().min(1, 'API key is required'),
  MY_ENDPOINT: z.string().url().optional(),
});

export const myPlugin: Plugin = {
  name: 'plugin-my-name',
  description: 'My plugin',
  config: {
    MY_API_KEY: process.env.MY_API_KEY,
    MY_ENDPOINT: process.env.MY_ENDPOINT,
  },
  async init(config: Record<string, string>) {
    const validated = await configSchema.parseAsync(config);
    for (const [key, value] of Object.entries(validated)) {
      if (value) process.env[key] = value;
    }
  },
};
```

## Test Utilities

Generate this as `src/__tests__/test-utils.ts`:

```typescript
import { mock } from 'bun:test';
import type { IAgentRuntime, Memory, State, UUID, Character } from '@elizaos/core';

export type MockRuntime = Partial<IAgentRuntime> & {
  agentId: UUID;
  character: Character;
  getSetting: ReturnType<typeof mock>;
  useModel: ReturnType<typeof mock>;
  composeState: ReturnType<typeof mock>;
  createMemory: ReturnType<typeof mock>;
  getMemories: ReturnType<typeof mock>;
  getService: ReturnType<typeof mock>;
};

export function createMockRuntime(overrides?: Partial<MockRuntime>): MockRuntime {
  return {
    agentId: 'test-agent-00000000-0000-0000-0000-000000000001' as UUID,
    character: {
      name: 'TestAgent',
      bio: 'A test agent',
      id: 'test-char-00000000-0000-0000-0000-000000000001' as UUID,
      ...overrides?.character,
    } as Character,
    getSetting: mock((key: string) => {
      const settings: Record<string, string> = { TEST_API_KEY: 'test-key-123' };
      return settings[key];
    }),
    useModel: mock(async () => 'Mock response'),
    composeState: mock(async () => ({ values: {}, data: {}, text: '' })),
    createMemory: mock(async () => 'memory-00000000-0000-0000-0000-000000000001'),
    getMemories: mock(async () => []),
    getService: mock(() => null),
    ...overrides,
  };
}

export function createMockMessage(overrides?: Partial<Memory>): Memory {
  return {
    id: 'msg-00000000-0000-0000-0000-000000000001' as UUID,
    entityId: 'entity-00000000-0000-0000-0000-000000000001' as UUID,
    roomId: 'room-00000000-0000-0000-0000-000000000001' as UUID,
    content: { text: 'Test message', ...overrides?.content },
    ...overrides,
  } as Memory;
}

export function createMockState(overrides?: Partial<State>): State {
  return {
    values: { ...overrides?.values },
    data: overrides?.data || {},
    text: overrides?.text || '',
  } as State;
}
```

## Action Test Example

```typescript
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { myAction } from '../actions/myAction';
import { createMockRuntime, createMockMessage, createMockState } from './test-utils';

describe('MyAction', () => {
  let mockRuntime: any;
  let mockMessage: any;
  let mockState: any;

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    mockMessage = createMockMessage({ content: { text: 'Do the thing' } });
    mockState = createMockState();
  });

  it('validates when API key present', async () => {
    expect(await myAction.validate(mockRuntime, mockMessage, mockState)).toBe(true);
  });

  it('fails validation without API key', async () => {
    mockRuntime.getSetting = mock(() => undefined);
    expect(await myAction.validate(mockRuntime, mockMessage, mockState)).toBe(false);
  });

  it('returns success on execution', async () => {
    const result = await myAction.handler(mockRuntime, mockMessage, mockState, {}, mock());
    expect(result.success).toBe(true);
  });

  it('handles errors gracefully', async () => {
    mockRuntime.getService = mock(() => { throw new Error('Service unavailable'); });
    const result = await myAction.handler(mockRuntime, mockMessage, mockState);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

## Pattern Archetypes

### 1. API Integration (Action + Provider)
Action validates API key, calls external API, returns result. Provider caches data for context.
**Use for**: Weather APIs, AI services (image gen, video gen), data lookups.

### 2. Platform Connector (Service + Events + Actions)
Service maintains persistent connection (WebSocket/polling). Events bridge platform messages. Actions send messages back.
**Use for**: Discord, Twitter, Telegram, Slack bots.

### 3. LLM Provider (Models + Config)
Registers model handlers for TEXT_SMALL, TEXT_LARGE, TEXT_EMBEDDING. Uses priority to become preferred.
**Use for**: OpenAI, Anthropic, Ollama, local model integrations.

### 4. Data Provider (Provider + Service)
Service maintains/updates cache. Provider surfaces cached data during state composition.
**Use for**: Knowledge bases, price feeds, user context.

### 5. Blockchain Integration (Service + Actions + Provider)
Service manages wallet/connection. Actions execute transactions. Provider shows balances.
**Use for**: Solana, EVM chains, token operations.

### 6. Webhook/API (Routes + Actions)
Routes receive external HTTP calls. Actions process incoming data.
**Use for**: GitHub webhooks, payment notifications, custom APIs.

### 7. Analytics/Logging (Evaluator + Events)
Evaluator with `alwaysRun: true` captures metrics. Events track action/model usage.
**Use for**: Sentiment analysis, usage tracking, conversation analytics.

### 8. Database Extension (Schema + Adapter)
Drizzle ORM schema via `schema`. Optional full IDatabaseAdapter implementation.
**Use for**: Custom storage, SQL extensions.

### 9. Background Task (Service + TaskWorker)
Service registers TaskWorkers. Tasks with `queue`/`repeat` tags for scheduling.
**Use for**: Scheduled reports, data sync, periodic cleanup.

### 10. Frontend Dashboard (Routes STATIC + Routes API + Service)
STATIC route serves React/Vite frontend. API routes provide data. Service manages state.
**Use for**: Admin dashboards, analytics UIs.

## Anti-Patterns

- **Business logic in providers** - Providers are read-only context suppliers
- **Actions for internal operations** - Actions are user-facing; use services for internal work
- **Skipping validation** - Always validate API keys and prerequisites in `validate()`
- **Blocking event handlers** - Event handlers should be fast; queue heavy work
- **Bundling @elizaos/core** - Always mark as external in tsup config
- **Using CommonJS** - ElizaOS requires ESM format
- **Hardcoding secrets** - Use `runtime.getSetting()` for all configuration
- **Wrong action name format** - Must be UPPER_SNAKE_CASE
- **Missing callback invocation** - Always call `callback` if provided, for streaming responses
