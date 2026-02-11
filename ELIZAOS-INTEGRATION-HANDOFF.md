# ElizaOS Integration Handoff: Refactoring agent-runtime into an Importable Library

## Goal

Refactor `@agent-runtime/connector` from a standalone CLI application into an importable npm library so it can run **in-process** alongside `@agent-society/core` inside an ElizaOS Service.

The end state: a single ElizaOS agent process that embeds both the ILP connector (agent-runtime) and the Nostr protocol layer (agent-society), with no HTTP between them.

---

## Why

### Current Architecture (3 separate processes, HTTP everywhere)

```
┌──────────────────┐  HTTP /ilp/send   ┌──────────────────┐  BTP (ws)  ┌───────┐
│  agent-society   │ ────────────────── │  agent-runtime   │ ────────── │ peers │
│  (Nostr/SPSP)    │                    │  (ILP connector)  │            └───────┘
│                  │  HTTP /handle-     │                   │
│  BLS server      │ ◄──────────────── │  LocalDelivery    │
└──────────────────┘   payment          └──────────────────┘
```

Problems:

- **3 processes** to deploy, configure, health-check, and keep in sync
- **HTTP round-trips** on every ILP packet (agent-society → connector and connector → BLS)
- **Circular HTTP dependency**: agent-society calls connector to send, connector calls BLS to receive
- **Configuration duplication**: peer info, ILP addresses, ports repeated across configs

### Target Architecture (1 ElizaOS process, direct function calls)

```
┌─────────────────────────────────────────────────────────┐
│  ElizaOS Agent Process                                   │
│                                                          │
│  AgentSocietyService (ElizaOS Service)                   │
│  ├── ConnectorNode          ← BTP server on port 7768    │
│  │   ├── PacketHandler                                   │
│  │   │   └── onLocalDelivery = bls.handlePayment()  ←─┐ │
│  │   ├── BTPServer (incoming peer connections)        │ │
│  │   ├── BTPClientManager (outgoing peer connections) │ │
│  │   ├── RoutingTable                                 │ │
│  │   └── AccountManager (TigerBeetle)                 │ │
│  │                                                    │ │
│  ├── BusinessLogicServer (BLS)  ──────────────────────┘ │
│  │   ├── handlePayment() → direct fn call, no HTTP      │
│  │   ├── PricingService                                  │
│  │   └── EventStore (SQLite)                             │
│  │                                                       │
│  ├── NostrRelayServer        ← NIP-01 relay on port 7100 │
│  ├── BootstrapService        → calls connector.sendPacket│
│  ├── NostrSpspClient/Server                              │
│  ├── SocialTrustManager                                  │
│  └── RelayMonitor                                        │
│                                                          │
│  Actions: PAY, DISCOVER_PEERS, CHECK_TRUST, ...          │
│  Providers: trustScore, peerStatus, ilpBalance, ...      │
└──────────────────────────────────────────────────────────┘
         ↕ BTP (ws://port:7768)
    ┌─────────┐
    │  peers  │  (other connectors on the ILP network)
    └─────────┘
```

Benefits:

- **1 process** — `npm start` and everything runs
- **No HTTP between components** — BLS.handlePayment() is a direct function call
- **agent-society calls connector.sendPacket()** directly, no HTTP client
- **Single config** — ElizaOS character file is the only config needed
- **BTP still works** — the connector still opens a WebSocket port for external peers

---

## What Needs to Change in agent-runtime

### 1. Accept Config Object Instead of YAML File

**Current**: `ConnectorNode` loads config from a YAML file path.

```typescript
// Current — reads file from disk
const connector = new ConnectorNode(configFilePath, logger);
```

**Needed**: Accept a `ConnectorConfig` object directly.

```typescript
// Target — accepts config object
const connector = new ConnectorNode({
  nodeId: 'agent-alice',
  btpServerPort: 7768,
  peers: [],        // peers added dynamically via admin API or registerPeer()
  routes: [],       // routes added dynamically
  settlement: { ... },
}, logger);
```

The YAML file loading should move to the CLI entrypoint. The `ConnectorNode` class should accept the parsed config object.

### 2. Expose a Packet Handler Hook (Replace LocalDeliveryClient HTTP)

**Current**: `PacketHandler` forwards local packets via `LocalDeliveryClient` which makes an HTTP POST to an external URL (`LOCAL_DELIVERY_URL/ilp/packets`).

**Needed**: Allow a direct function handler instead of HTTP.

```typescript
// Target — direct handler, no HTTP
connector.setLocalDeliveryHandler(async (packet, sourcePeerId) => {
  // This is where agent-society's BLS handles the payment
  return bls.handlePayment({
    amount: packet.amount.toString(),
    destination: packet.destination,
    data: Buffer.from(packet.data).toString('base64'),
  });
});
```

This replaces the HTTP round-trip with an in-process function call. The `LocalDeliveryClient` HTTP path should still work as a fallback for external deployments.

### 3. Expose sendPacket() as a Public Method

**Current**: Sending packets requires going through the admin HTTP API or BTP client internals.

Agent-society currently calls `POST /ilp/send` via `createAgentRuntimeClient(baseUrl)`.

**Needed**: A clean public method on `ConnectorNode`:

```typescript
// Target — called by agent-society directly
const result = await connector.sendPacket({
  destination: 'g.peer.alice',
  amount: 5000n,
  executionCondition: conditionBuffer,
  expiresAt: new Date(Date.now() + 30000),
  data: toonEncodedBuffer,
});
// Returns: ILPFulfillPacket | ILPRejectPacket
```

This is what `BootstrapService`, `NostrSpspClient`, and the PAY action will call instead of the HTTP client.

### 4. Expose Admin Operations as Methods (Not Just HTTP)

**Current**: Peer registration, route management, balance queries all go through `AdminServer` HTTP endpoints.

**Needed**: These should be callable methods on `ConnectorNode` (or a sub-object), with `AdminServer` being an optional HTTP wrapper.

```typescript
// Target — direct method calls
await connector.registerPeer({
  id: 'peer-bob',
  url: 'ws://bob:3000',
  authToken: 'secret',
  routes: [{ prefix: 'g.bob', priority: 0 }],
});

await connector.removePeer('peer-bob');

const peers = connector.listPeers();
const balance = await connector.getBalance('peer-bob');
const routes = connector.listRoutes();
connector.addRoute({ prefix: 'g.charlie', nextHop: 'peer-bob' });
```

The `AdminServer` HTTP wrapper becomes optional — useful for debugging or external tooling, but not required for in-process usage.

### 5. Clean Lifecycle Methods

**Current**: `ConnectorNode.start()` and `stop()` exist but are tied to the CLI lifecycle.

**Needed**: Clean, reentrant lifecycle:

```typescript
const connector = new ConnectorNode(config, logger);

await connector.start();
// BTP server listening
// Connected to configured peers
// Settlement monitor running (if configured)
// Admin server running (if configured)

// ... agent runs ...

await connector.stop();
// BTP connections closed gracefully
// Settlement monitor stopped
// Admin server stopped
// TigerBeetle client closed
```

No `process.exit()` calls. No signal handlers. Those belong in the CLI entrypoint, not the library.

### 6. Separate CLI from Library

**Current**: The main entry point (`src/cli/index.ts`) mixes CLI concerns (signal handling, process.exit, config file loading) with connector logic.

**Needed**: Two entry points:

```
@agent-runtime/connector
├── src/
│   ├── index.ts              ← library exports (ConnectorNode, types, etc.)
│   └── cli/
│       └── index.ts          ← CLI entrypoint (loads YAML, handles signals)
├── package.json
│   main: "./dist/index.js"   ← library
│   bin: "./dist/cli/index.js" ← CLI
```

### 7. Export All Necessary Types

The library should export everything needed for in-process composition:

```typescript
// @agent-runtime/connector public API
export {
  // Core
  ConnectorNode,
  PacketHandler,
  RoutingTable,

  // BTP
  BTPServer,
  BTPClient,
  BTPClientManager,

  // Settlement
  AccountManager,
  SettlementMonitor,
  SettlementExecutor,

  // Admin (optional HTTP wrapper)
  AdminServer,

  // Local delivery
  LocalDeliveryClient, // kept for HTTP fallback

  // Logger
  createLogger,
};

// Types
export type {
  ConnectorConfig,
  PeerConfig,
  RouteConfig,
  SettlementConfig,
  LocalDeliveryConfig,
  ILPPreparePacket,
  ILPFulfillPacket,
  ILPRejectPacket,
  PeerAccountBalance,
};
```

---

## How agent-society Will Use It

Once agent-runtime is a library, `@agent-society/core` will import it and wire the two together:

```typescript
import { ConnectorNode } from '@agent-runtime/connector';
import { BusinessLogicServer, SqliteEventStore, PricingService } from '@agent-society/bls';
import { BootstrapService, NostrSpspClient, SocialTrustManager } from '@agent-society/core';

// 1. Create connector
const connector = new ConnectorNode({
  nodeId: 'agent-alice',
  btpServerPort: 7768,
  peers: [],
  routes: [],
});

// 2. Create BLS
const eventStore = new SqliteEventStore('/data/events.db');
const pricing = new PricingService({ basePricePerByte: 10n });
const bls = new BusinessLogicServer({ basePricePerByte: 10n, pricingService: pricing }, eventStore);

// 3. Wire BLS to connector (replaces HTTP /handle-payment)
connector.setLocalDeliveryHandler(async (packet, sourcePeerId) => {
  return bls.handlePayment({
    amount: packet.amount.toString(),
    destination: packet.destination,
    data: Buffer.from(packet.data).toString('base64'),
  });
});

// 4. Start connector (BTP server opens, ready for peers)
await connector.start();

// 5. Bootstrap uses connector directly (replaces HTTP /ilp/send)
const bootstrap = new BootstrapService({
  // ...config
  sendPacket: (params) => connector.sendPacket(params), // direct call
  registerPeer: (peer) => connector.registerPeer(peer), // direct call
});

await bootstrap.bootstrap();
```

The circular HTTP dependency is gone. Both directions are direct function calls:

- **Outbound**: `BootstrapService → connector.sendPacket()` (was HTTP POST /ilp/send)
- **Inbound**: `connector → bls.handlePayment()` (was HTTP POST /handle-payment)

---

## How the ElizaOS Plugin Wraps Everything

The final layer is a thin ElizaOS plugin that wraps this composed system:

```typescript
import { Service, type IAgentRuntime } from '@elizaos/core';

class AgentSocietyService extends Service {
  static serviceType = 'agent_society';

  static async start(runtime: IAgentRuntime) {
    const service = new AgentSocietyService(runtime);

    // Read config from ElizaOS character settings
    const btpPort = Number(runtime.getSetting('BTP_PORT') || 7768);
    const nostrKey = runtime.getSetting('NOSTR_PRIVATE_KEY');

    // Initialize connector (agent-runtime)
    service.connector = new ConnectorNode({
      nodeId: runtime.character.name,
      btpServerPort: btpPort,
    });

    // Initialize BLS (agent-society)
    service.bls = new BusinessLogicServer(blsConfig, eventStore);

    // Wire them together
    service.connector.setLocalDeliveryHandler((packet, peer) =>
      service.bls.handlePayment(/* ... */)
    );

    // Start connector (opens BTP port)
    await service.connector.start();

    // Bootstrap into ILP network via Nostr
    await service.bootstrap.bootstrap();

    return service;
  }

  async stop() {
    await this.connector.stop();
  }

  // Accessors for Actions and Providers
  getConnector() {
    return this.connector;
  }
  getTrustManager() {
    return this.trustManager;
  }
  // ...
}
```

---

## Summary of Changes Required

| #   | Change                                                           | Scope                            | Files Affected                                                    |
| --- | ---------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| 1   | Accept `ConnectorConfig` object in constructor                   | `ConnectorNode`                  | `src/core/connector-node.ts`, config loader                       |
| 2   | Add `setLocalDeliveryHandler()` for direct fn calls              | `PacketHandler`, `ConnectorNode` | `src/core/packet-handler.ts`, `src/core/local-delivery-client.ts` |
| 3   | Expose `sendPacket()` as public method                           | `ConnectorNode`                  | `src/core/connector-node.ts`                                      |
| 4   | Expose admin ops as methods (registerPeer, etc.)                 | `ConnectorNode`                  | `src/core/connector-node.ts`, `src/http/admin-api.ts`             |
| 5   | Clean lifecycle (no process.exit, no signal handlers in library) | `ConnectorNode`, CLI             | `src/core/connector-node.ts`, `src/cli/index.ts`                  |
| 6   | Separate CLI entrypoint from library exports                     | Package structure                | `package.json`, `src/index.ts`, `src/cli/index.ts`                |
| 7   | Export all types needed for in-process composition               | Package exports                  | `src/index.ts`                                                    |

### What Does NOT Change

- **BTPServer** — still opens a WebSocket port, peers still connect via BTP
- **BTPClient** — still connects outbound to other connectors
- **PacketHandler** — same routing logic, same RFC compliance
- **AccountManager** — same TigerBeetle double-entry accounting
- **SettlementMonitor/Executor** — same settlement logic
- **RoutingTable** — same longest-prefix matching
- **AdminServer** — still available as optional HTTP wrapper for debugging
- **All existing tests** — should continue to pass

The refactor is about **how you start and wire the connector**, not about changing what it does.

---

## Dependency Graph After Refactoring

```
@agent-runtime/shared           (ILP types, OER codec — no changes)
        ▲
        │
@agent-runtime/connector        (ILP connector library — refactored)
        ▲
        │ imports
        │
@agent-society/core              (Nostr protocol + composes connector + BLS)
  ├── imports @agent-runtime/connector
  ├── imports @agent-society/bls
  └── wires: connector ↔ BLS ↔ bootstrap ↔ SPSP
        ▲
        │ imports
        │
@agent-society/elizaos-plugin    (thin ElizaOS wrapper)
  └── wraps @agent-society/core as ElizaOS Service/Actions/Providers
```

---

## Integration Gaps to Resolve

These existing gaps (from `INTEGRATION-GAPS.md` in agent-society) become easier to fix once both run in-process:

| Gap                                                       | Description                                                            | Resolution with In-Process                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Field name mismatch (`fulfilled` vs `accepted`)           | agent-runtime returns `fulfilled`, agent-society checks `accepted`     | Direct function call — define one shared return type                                    |
| Missing settlement in ILP path                            | BLS lacks settlement negotiation                                       | BLS and connector share config in-process                                               |
| Circular dependency (peer registration before settlement) | Can't register peer without settlement info, can't settle without peer | In-process wiring eliminates chicken-and-egg — register peer, then configure settlement |
| Missing TOKEN_NETWORK parsing                             | Env vars not parsed                                                    | Config object passed directly, no env parsing needed                                    |

---

## Publishing as npm Packages

Both `@agent-runtime/shared` and `@agent-runtime/connector` need to be published to npm so `@agent-society/core` can depend on them.

### Current State

- Root `package.json` has `"private": true` — correct, the monorepo root should not be published
- `@agent-runtime/shared` — `"version": "0.1.0"`, no `"private"` flag, zero runtime dependencies. **Ready to publish as-is.**
- `@agent-runtime/connector` — `"version": "0.1.0"`, no `"private"` flag, but has heavy dependencies and CLI concerns mixed in. **Needs refactoring before publishing.**
- `@agent-runtime/core` — `"version": "0.1.0"`, minimal Express-based package. Evaluate whether it's still needed or should merge into connector.

### Changes Required for Publishing

#### 1. Package.json Updates for `@agent-runtime/connector`

```jsonc
{
  "name": "@agent-runtime/connector",
  "version": "1.0.0",
  "description": "ILP connector with BTP support — importable library and CLI",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "agent-runtime": "./dist/cli/index.js",
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts",
    },
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
  },
  "engines": {
    "node": ">=22.11.0",
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/ALLiDoizCode/agent-runtime.git",
    "directory": "packages/connector",
  },
  "license": "Apache-2.0",
}
```

#### 2. Package.json Updates for `@agent-runtime/shared`

```jsonc
{
  "name": "@agent-runtime/shared",
  "version": "1.0.0",
  "description": "Shared ILP types, OER codec, and utilities for Agent Runtime",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts",
    },
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/ALLiDoizCode/agent-runtime.git",
    "directory": "packages/shared",
  },
  "license": "Apache-2.0",
}
```

#### 3. Trim Dependencies for `@agent-runtime/connector`

The current connector `package.json` has many dependencies that are only needed for specific features. For the published library, consider making heavy/optional dependencies peer dependencies:

**Keep as direct dependencies** (core functionality):

- `ws` — BTP WebSocket protocol (required)
- `@agent-runtime/shared` — ILP types (required)
- `js-yaml` — config loading (required for CLI, could be optional for library)
- `pino` — logging (required)
- `tslib` — TypeScript runtime (required)
- `zod` — config validation (required)

**Move to optional/peer dependencies** (feature-specific):

- `tigerbeetle-node` — only if TigerBeetle settlement enabled
- `ethers` — only if EVM settlement enabled
- `xrpl` — only if XRP settlement enabled
- `@aptos-labs/ts-sdk` — only if Aptos settlement enabled
- `better-sqlite3` — only if SQLite event store used
- `nostr-tools` — only if Nostr features used
- `@aws-sdk/*`, `@azure/*`, `@google-cloud/*` — only if cloud KMS used
- `express`, `cors`, `multer` — only if AdminServer HTTP enabled
- `ai`, `@ai-sdk/*` — only if AI features used
- `sharp`, `qrcode` — only if visual features used
- `prom-client`, `@opentelemetry/*` — only if observability enabled

This reduces the install footprint dramatically. A consumer using just the ILP connector + BTP would only pull in `ws`, `pino`, `zod`, and `tslib`.

```jsonc
{
  "dependencies": {
    "@agent-runtime/shared": "^1.0.0",
    "ws": "^8.16.0",
    "pino": "^8.21.0",
    "tslib": "^2.8.1",
    "zod": "^3.25.0",
  },
  "optionalDependencies": {
    "tigerbeetle-node": "0.16.68",
    "ethers": "^6.16.0",
    "xrpl": "^2.14.3",
    "@aptos-labs/ts-sdk": "^1.39.0",
    "better-sqlite3": "^11.8.1",
    "express": "4.18.x",
  },
  "peerDependencies": {
    "tigerbeetle-node": ">=0.16.0",
    "ethers": ">=6.0.0",
    "xrpl": ">=2.14.0",
  },
  "peerDependenciesMeta": {
    "tigerbeetle-node": { "optional": true },
    "ethers": { "optional": true },
    "xrpl": { "optional": true },
  },
}
```

#### 4. Build and Publish Steps

```bash
# 1. Build shared first (connector depends on it)
cd packages/shared
npm run build

# 2. Build connector
cd ../connector
npm run build

# 3. Publish shared first
cd ../shared
npm publish --access public

# 4. Update connector to use published shared version
# Change "@agent-runtime/shared": "*" → "@agent-runtime/shared": "^1.0.0"

# 5. Publish connector
cd ../connector
npm publish --access public
```

#### 5. Monorepo Publish Automation

Add a root-level publish script or use a tool like `changeset`:

```jsonc
// root package.json
{
  "scripts": {
    "publish:shared": "npm run build --workspace=packages/shared && npm publish --workspace=packages/shared --access public",
    "publish:connector": "npm run build --workspace=packages/connector && npm publish --workspace=packages/connector --access public",
    "publish:all": "npm run publish:shared && npm run publish:connector",
  },
}
```

Or adopt [changesets](https://github.com/changesets/changesets) for proper versioning across packages.

#### 6. Versioning Strategy

- `@agent-runtime/shared` and `@agent-runtime/connector` should be versioned independently
- Use semver: breaking API changes = major bump
- The library refactoring (config object, public sendPacket, etc.) is a **major version bump** → `1.0.0`
- Pre-refactoring state can be tagged `0.x` for existing Docker/CLI users

#### 7. `.npmignore` or `"files"` Field

Ensure only built artifacts are published (not test files, Docker configs, explorer UI, etc.):

```
# .npmignore for @agent-runtime/connector
src/
test/
explorer-ui/
scripts/
config/
coverage/
*.config.js
*.config.ts
docker/
k8s/
Dockerfile
docker-compose*.yml
Makefile
```

Or rely on the `"files"` field in package.json (preferred — allowlist over denylist):

```jsonc
"files": ["dist", "README.md", "LICENSE"]
```

---

## Testing Strategy

1. **Unit tests** — all existing tests should pass (ConnectorNode API is a superset)
2. **Integration test** — new test that instantiates ConnectorNode + BLS in-process, sends a packet, verifies BLS receives it via direct handler (no HTTP)
3. **BTP test** — verify BTP server still accepts external peer connections when running as library
4. **E2E test** — two in-process connectors peered via BTP, routing packets between them
5. **Package test** — `npm pack` both packages, install them in a fresh project, verify imports work and types resolve
