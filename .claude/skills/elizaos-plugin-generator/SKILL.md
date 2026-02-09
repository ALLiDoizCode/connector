---
name: elizaos-plugin-generator
description: Generate complete, production-ready ElizaOS plugins from natural language descriptions. Creates full plugin scaffolding with Actions, Providers, Services, Evaluators, Events, Routes, and Model Handlers following ElizaOS conventions. Use when users ask to "create an ElizaOS plugin", "build a plugin for ElizaOS", "generate an ElizaOS agent plugin", "scaffold an elizaos plugin", or any request involving ElizaOS/Eliza plugin development, plugin architecture, or agent plugin creation.
---

# ElizaOS Plugin Generator

Generate complete ElizaOS plugins from natural language descriptions. Output is a ready-to-build npm package with TypeScript source, tests, and config.

## Workflow

1. **Clarify requirements** - Determine what the plugin does, which components it needs
2. **Select components** using the decision framework below
3. **Generate the plugin** - Scaffold all files following the structure and patterns in references
4. **Verify** - Ensure all conventions and anti-patterns are respected

## Component Decision Framework

| User Need | Component | Key Interface |
|-----------|-----------|---------------|
| User triggers an operation | **Action** | `name`, `description`, `validate`, `handler`, `examples` |
| Supply context to agent | **Provider** | `name`, `get` returning `{ text, values, data }` |
| Post-message analysis | **Evaluator** | `name`, `handler`, `validate`, `alwaysRun` |
| Long-running background work | **Service** | extends `Service`, static `start`, instance `stop` |
| External HTTP endpoints | **Route** | `type`, `path`, `handler` |
| React to system events | **Event Handler** | entries in `events` map |
| Custom AI model | **Model Handler** | entries in `models` map |
| Custom database | **Adapter + Schema** | `adapter`, `schema` fields |

## Plugin Structure (always generate)

```
plugin-{name}/
├── src/
│   ├── index.ts              # Plugin manifest & default export
│   ├── actions/              # One file per action
│   │   └── {actionName}.ts
│   ├── providers/            # One file per provider
│   │   └── {providerName}.ts
│   ├── services/             # One file per service
│   │   └── {serviceName}.ts
│   ├── evaluators/           # One file per evaluator (if needed)
│   │   └── {evaluatorName}.ts
│   └── types/
│       └── index.ts          # Plugin-specific types
├── src/__tests__/
│   ├── test-utils.ts         # Mock runtime/message/state factories
│   └── {component}.test.ts   # Tests per component
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── images/                   # Required for publishing
    ├── logo.jpg              # 400x400, max 500KB
    └── banner.jpg            # 1280x640, max 1MB
```

## Critical Conventions

- Plugin `name` field: `plugin-{name}` prefix required
- Action names: `UPPER_SNAKE_CASE`
- Build: ESM only, `@elizaos/core` as external in tsup
- All imports from `@elizaos/core`
- Settings via `runtime.getSetting('KEY')`, never hardcode secrets
- Registration order: adapter -> actions -> evaluators -> providers -> models -> routes -> events -> services
- Handler returns `ActionResult` with `{ success, text?, data?, error? }`
- Use `HandlerCallback` for streaming/intermediate responses
- Service: static `serviceType` string, static `start(runtime)` factory, abstract `stop()`

## Reference Files

Load these as needed for detailed type definitions and examples:

- **[references/types.md](references/types.md)** - Complete TypeScript interfaces: Plugin, Action, Provider, Evaluator, Service, Route, Memory, State, Content, IAgentRuntime, ModelType, EventType. Read when generating any component to get exact type signatures.
- **[references/patterns.md](references/patterns.md)** - Complete code examples for every component type (Action, Provider, Service, Evaluator, Events, Routes), 10 plugin pattern archetypes, anti-patterns list, and the test utilities template. Read when implementing component logic.
- **[references/publishing.md](references/publishing.md)** - Build config templates (package.json, tsconfig.json, tsup.config.ts), publishing checklist, and CLI commands. Read when generating config files or advising on publishing.

## Quick Reference: src/index.ts Template

```typescript
import type { Plugin } from '@elizaos/core';
// import actions, providers, services, etc.

export const myPlugin: Plugin = {
  name: 'plugin-my-name',
  description: 'What this plugin does',
  actions: [],
  providers: [],
  evaluators: [],
  services: [],
  events: {},
  routes: [],
  // Optional:
  // config: { MY_KEY: process.env.MY_KEY },
  // init: async (config, runtime) => { ... },
  // models: { [ModelType.TEXT_SMALL]: async (runtime, params) => { ... } },
  // dependencies: ['@elizaos/plugin-other'],
  // priority: 0,
  // schema: { ... },
};

export default myPlugin;
```
