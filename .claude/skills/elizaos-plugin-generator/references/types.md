# ElizaOS Type Reference

All types importable from `@elizaos/core`. Source: `packages/core/src/types/` in `elizaos/eliza` repo (`develop` branch).

## Table of Contents

1. [Plugin](#plugin)
2. [Action](#action)
3. [Provider](#provider)
4. [Evaluator](#evaluator)
5. [Service](#service)
6. [Route](#route)
7. [Memory & Content](#memory--content)
8. [State](#state)
9. [ActionResult](#actionresult)
10. [IAgentRuntime](#iagentruntim)
11. [Events](#events)
12. [ModelType & ModelHandler](#modeltype--modelhandler)
13. [Task & TaskWorker](#task--taskworker)
14. [TestSuite](#testsuite)
15. [Character](#character)

---

## Plugin

```typescript
interface Plugin {
  name: string;                    // REQUIRED - must start with "plugin-"
  description: string;             // REQUIRED
  init?: (config: Record<string, string>, runtime: IAgentRuntime) => Promise<void>;
  config?: { [key: string]: string | number | boolean | null | undefined };
  actions?: Action[];
  providers?: Provider[];
  evaluators?: Evaluator[];
  services?: (typeof Service)[];   // Class references, not instances
  adapter?: IDatabaseAdapter;
  models?: {
    [K in keyof ModelParamsMap]?: (
      runtime: IAgentRuntime,
      params: ModelParamsMap[K]
    ) => Promise<PluginModelResult<K>>;
  };
  events?: PluginEvents;           // { [EventType.X]: handler[] }
  routes?: Route[];
  tests?: TestSuite[];
  componentTypes?: { name: string; schema: Record<string, unknown>; validator?: (data: unknown) => boolean }[];
  dependencies?: string[];         // Plugin names loaded first
  testDependencies?: string[];
  priority?: number;               // Lower = loads earlier (default 0)
  schema?: Record<string, unknown>; // Drizzle ORM tables
}
```

## Action

```typescript
interface Action {
  name: string;              // UPPER_SNAKE_CASE
  similes?: string[];        // Alternative trigger names
  description: string;       // Used by LLM for selection
  examples?: ActionExample[][]; // Conversation examples
  handler: Handler;
  validate: Validator;
  [key: string]: unknown;
}

interface ActionExample {
  name: string;     // "{{userName}}" or "{{agentName}}"
  content: Content;
}

type Handler = (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State,
  options?: HandlerOptions,
  callback?: HandlerCallback,
  responses?: Memory[]
) => Promise<ActionResult | void | undefined>;

type Validator = (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
) => Promise<boolean>;

type HandlerCallback = (response: Content) => Promise<Memory[]>;

interface HandlerOptions {
  actionContext?: ActionContext;
  actionPlan?: { totalSteps: number; currentStep: number; steps: ActionPlanStep[]; thought: string };
  [key: string]: unknown;
}
```

## Provider

```typescript
interface Provider {
  name: string;
  description?: string;
  dynamic?: boolean;      // Context-dependent
  position?: number;      // Execution order (lower = earlier)
  private?: boolean;      // Hide from LLM context
  get: (runtime: IAgentRuntime, message: Memory, state: State) => Promise<ProviderResult>;
}

interface ProviderResult {
  text?: string;                      // Appended to agent context
  values?: Record<string, unknown>;   // Injected into state.values
  data?: Record<string, unknown>;     // Added to state.data
}
```

## Evaluator

```typescript
interface Evaluator {
  name: string;
  description: string;
  alwaysRun?: boolean;       // true = run after every message
  similes?: string[];
  examples: EvaluationExample[];
  handler: Handler;
  validate: Validator;       // Determines if evaluator runs (when alwaysRun=false)
}

interface EvaluationExample {
  prompt: string;
  messages: ActionExample[];
  outcome: string;
}
```

## Service

```typescript
abstract class Service {
  protected runtime!: IAgentRuntime;
  constructor(runtime?: IAgentRuntime);
  abstract stop(): Promise<void>;
  static serviceType: string;        // Unique identifier
  abstract capabilityDescription: string;
  config?: Metadata;
  static async start(_runtime: IAgentRuntime): Promise<Service>;
  static async stop(_runtime: IAgentRuntime): Promise<void>;
}

// Predefined ServiceType values:
const ServiceType = {
  TRANSCRIPTION: 'transcription', VIDEO: 'video', BROWSER: 'browser',
  PDF: 'pdf', REMOTE_FILES: 'aws_s3', WEB_SEARCH: 'web_search',
  EMAIL: 'email', TEE: 'tee', TASK: 'task', WALLET: 'wallet',
  LP_POOL: 'lp_pool', TOKEN_DATA: 'token_data',
  MESSAGE_SERVICE: 'message_service', MESSAGE: 'message',
  POST: 'post', UNKNOWN: 'unknown',
} as const;
```

## Route

```typescript
type Route = {
  type: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'STATIC';
  path: string;
  handler?: (req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => Promise<void>;
  filePath?: string;       // For STATIC type
  public?: boolean;        // Skip auth
  name?: string;
  isMultipart?: boolean;   // File uploads
};

interface RouteRequest {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  path?: string;
  url?: string;
}

interface RouteResponse {
  status: (code: number) => RouteResponse;
  json: (data: unknown) => RouteResponse;
  send: (data: unknown) => RouteResponse;
  end: () => RouteResponse;
  setHeader?: (name: string, value: string | string[]) => RouteResponse;
}
```

## Memory & Content

```typescript
interface Memory {
  id?: UUID;
  entityId: UUID;          // Required
  agentId?: UUID;
  roomId: UUID;            // Required
  worldId?: UUID;
  content: Content;        // Required
  embedding?: number[];
  createdAt?: number;
  unique?: boolean;
  similarity?: number;
  metadata?: MemoryMetadata;
}

interface Content {
  thought?: string;
  text?: string;
  actions?: string[];
  providers?: string[];
  source?: string;
  target?: string;
  url?: string;
  inReplyTo?: UUID;
  attachments?: Media[];
  channelType?: ChannelType;
  [key: string]: unknown;
}

type UUID = `${string}-${string}-${string}-${string}-${string}`;
```

## State

```typescript
interface State {
  values: Record<string, unknown>;  // Key-value store
  data: StateData;                  // Structured data
  text: string;                     // String context
  [key: string]: unknown;
}

interface StateData {
  room?: Room;
  world?: World;
  entity?: Entity;
  providers?: Record<string, Record<string, unknown>>;
  actionPlan?: ActionPlan;
  actionResults?: ActionResult[];
  [key: string]: unknown;
}
```

## ActionResult

```typescript
interface ActionResult {
  success: boolean;
  text?: string;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: string | Error;
}
```

## IAgentRuntime

Key methods (extends IDatabaseAdapter):

```typescript
interface IAgentRuntime {
  // Properties
  agentId: UUID;
  character: Character;
  actions: Action[];
  providers: Provider[];
  evaluators: Evaluator[];
  plugins: Plugin[];
  services: Map<ServiceTypeName, Service[]>;
  events: RuntimeEventStorage;
  routes: Route[];
  logger: Logger;

  // Settings
  getSetting(key: string): string | boolean | number | null;
  setSetting(key: string, value: string | boolean | null, secret?: boolean): void;

  // Model usage
  useModel(modelType: TextGenerationModelType, params: GenerateTextParams, provider?: string): Promise<string>;
  useModel<T extends keyof ModelParamsMap>(modelType: T, params: ModelParamsMap[T], provider?: string): Promise<ModelResultMap[T]>;

  // State & processing
  composeState(message: Memory, includeList?: string[], onlyInclude?: boolean, skipCache?: boolean): Promise<State>;
  processActions(message: Memory, responses: Memory[], state?: State, callback?: HandlerCallback): Promise<void>;
  evaluate(message: Memory, state?: State, didRespond?: boolean, callback?: HandlerCallback): Promise<Evaluator[] | null>;

  // Registration
  registerPlugin(plugin: Plugin): Promise<void>;
  registerAction(action: Action): void;
  registerProvider(provider: Provider): void;
  registerEvaluator(evaluator: Evaluator): void;
  registerService(service: typeof Service): Promise<void>;
  registerModel(modelType: string, handler: Function, provider: string, priority?: number): void;
  registerEvent<T extends keyof EventPayloadMap>(event: T, handler: EventHandler<T>): void;

  // Services
  getService<T extends Service>(service: ServiceTypeName | string): T | null;
  hasService(serviceType: ServiceTypeName | string): boolean;

  // Memory
  createMemory(memory: Memory, tableName: string, unique?: boolean): Promise<UUID>;
  getMemories(params: { tableName: string; roomId?: UUID; count?: number; unique?: boolean }): Promise<Memory[]>;

  // Events
  emitEvent<T extends keyof EventPayloadMap>(event: T, params: EventPayloadMap[T]): Promise<void>;

  // Tasks
  registerTaskWorker(taskHandler: TaskWorker): void;
}
```

## Events

```typescript
enum EventType {
  WORLD_JOINED, WORLD_CONNECTED, WORLD_LEFT,
  ENTITY_JOINED, ENTITY_LEFT, ENTITY_UPDATED,
  ROOM_JOINED, ROOM_LEFT,
  MESSAGE_RECEIVED, MESSAGE_SENT, MESSAGE_DELETED,
  VOICE_MESSAGE_RECEIVED, VOICE_MESSAGE_SENT,
  REACTION_RECEIVED, POST_GENERATED, INTERACTION_RECEIVED,
  RUN_STARTED, RUN_ENDED, RUN_TIMEOUT,
  ACTION_STARTED, ACTION_COMPLETED,
  EVALUATOR_STARTED, EVALUATOR_COMPLETED,
  MODEL_USED,
  EMBEDDING_GENERATION_REQUESTED, EMBEDDING_GENERATION_COMPLETED, EMBEDDING_GENERATION_FAILED,
  CONTROL_MESSAGE,
}

type PluginEvents = { [K in keyof EventPayloadMap]?: EventHandler<K>[] };

// Key payload types:
interface MessagePayload { runtime: IAgentRuntime; message: Memory; source: string; callback?: HandlerCallback }
interface WorldPayload { runtime: IAgentRuntime; world: World; rooms: Room[]; entities: Entity[]; source: string }
interface EntityPayload { runtime: IAgentRuntime; entityId: UUID; source: string; worldId?: UUID; roomId?: UUID }
interface RunEventPayload { runtime: IAgentRuntime; runId: UUID; messageId: UUID; roomId: UUID; entityId: UUID; startTime: number; status: string; source: string }
interface ActionEventPayload { runtime: IAgentRuntime; roomId: UUID; world: UUID; content: Content; source: string }
```

## ModelType & ModelHandler

```typescript
const ModelType = {
  TEXT_SMALL: 'TEXT_SMALL',
  TEXT_LARGE: 'TEXT_LARGE',
  TEXT_EMBEDDING: 'TEXT_EMBEDDING',
  TEXT_TOKENIZER_ENCODE: 'TEXT_TOKENIZER_ENCODE',
  TEXT_TOKENIZER_DECODE: 'TEXT_TOKENIZER_DECODE',
  TEXT_REASONING_SMALL: 'REASONING_SMALL',
  TEXT_REASONING_LARGE: 'REASONING_LARGE',
  TEXT_COMPLETION: 'TEXT_COMPLETION',
  IMAGE: 'IMAGE',
  IMAGE_DESCRIPTION: 'IMAGE_DESCRIPTION',
  TRANSCRIPTION: 'TRANSCRIPTION',
  TEXT_TO_SPEECH: 'TEXT_TO_SPEECH',
  AUDIO: 'AUDIO',
  VIDEO: 'VIDEO',
  OBJECT_SMALL: 'OBJECT_SMALL',
  OBJECT_LARGE: 'OBJECT_LARGE',
} as const;

interface GenerateTextParams {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void | Promise<void>;
}
```

## Task & TaskWorker

```typescript
interface TaskWorker {
  name: string;
  execute: (runtime: IAgentRuntime, options: Record<string, unknown>, task: Task) => Promise<void>;
  validate?: (runtime: IAgentRuntime, message: Memory, state: State) => Promise<boolean>;
}

interface Task {
  id?: UUID;
  name: string;
  description: string;
  roomId?: UUID;
  worldId?: UUID;
  entityId?: UUID;
  tags: string[];
  metadata?: TaskMetadata;
}
```

## TestSuite

```typescript
interface TestSuite {
  name: string;
  tests: TestCase[];
}

interface TestCase {
  name: string;
  fn: (runtime: IAgentRuntime) => Promise<void> | void;
}
```

## Character

```typescript
interface Character {
  id?: UUID;
  name: string;
  username?: string;
  system?: string;
  bio: string | string[];
  templates?: Record<string, TemplateType>;
  messageExamples?: MessageExample[][];
  postExamples?: string[];
  topics?: string[];
  adjectives?: string[];
  knowledge?: (string | { path: string; shared?: boolean })[];
  plugins?: string[];
  settings?: Record<string, string | boolean | number | Record<string, unknown>>;
  secrets?: Record<string, string | boolean | number>;
  style?: { all?: string[]; chat?: string[]; post?: string[] };
}
```
