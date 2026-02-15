# Agent Runtime

[![Version](https://img.shields.io/badge/version-1.15.0-blue.svg)](CHANGELOG.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **A payment network for agents.** Messages carry value. Peers earn routing fees. Settlement happens on-chain — in bulk.

## Install

```bash
npm install @agent-society/connector
```

That's it. No external databases required — the connector ships with an in-memory ledger that persists to disk via JSON snapshots. For high-throughput production workloads, you can optionally plug in [TigerBeetle](https://tigerbeetle.com).

## What This Does

Agent Runtime is a connector node for the [Interledger Protocol (ILP)](https://interledger.org). It routes messages between agents, tracks balances off-chain, and settles to real blockchains when ready.

Every message on the network has tokens attached. Agents pay to send messages. Agents earn by receiving them. Peers earn routing fees for relaying traffic between agents.

```
Agent A ──── 1000 tokens + "What's ETH price?" ────► Peer ────► Agent B
                                                     (keeps 1)  (gets 999)
```

Thousands of messages, one on-chain settlement.

## Quick Start

### As a CLI

The package includes an `agent-runtime` CLI:

```bash
# Interactive setup — generates a .env config file
npx agent-runtime setup

# Check health of a running connector
npx agent-runtime health

# Validate a config file
npx agent-runtime validate config.yaml
```

### As a Library

```typescript
import { ConnectorNode, createLogger } from '@agent-society/connector';

const logger = createLogger('my-agent', 'info');
const node = new ConnectorNode('config.yaml', logger);

await node.start();

// Send a packet through the network
await node.sendPacket({
  destination: 'g.peer.agent',
  amount: 1000n,
  executionCondition: Buffer.alloc(32),
  expiresAt: new Date(Date.now() + 30000),
  data: Buffer.from('Hello'),
});

// Register peers at runtime
await node.registerPeer({
  id: 'peer-b',
  url: 'ws://peer-b:3001',
  authToken: 'secret',
  routes: [{ prefix: 'g.peer-b' }],
});

await node.stop();
```

You can also pass a config object instead of a YAML path:

```typescript
const node = new ConnectorNode(
  {
    nodeId: 'my-agent',
    btpServerPort: 3000,
    peers: [],
    routes: [],
  },
  logger
);
```

### Handling Incoming Packets

When a packet arrives for your agent, the connector needs to know what to do with it. Each packet carries an amount (tokens attached to the message) and a data payload. You provide the business logic; the connector handles routing, accounting, fulfillment, and settlement.

There are two ways to wire this up:

**Option A: Same process** (recommended)

Register a packet handler directly. No ILP knowledge needed — the connector handles fulfillment computation, error code mapping, and protocol details for you.

```typescript
import { ConnectorNode, createLogger } from '@agent-society/connector';

const logger = createLogger('my-agent', 'info');
const node = new ConnectorNode('config.yaml', logger);

node.setPacketHandler(async (request) => {
  // request includes: paymentId, destination, amount, expiresAt, data
  const payload = request.data ? Buffer.from(request.data, 'base64').toString() : '';

  if (BigInt(request.amount) < 100n) {
    return { accept: false, rejectReason: { code: 'invalid_amount', message: 'Pay more' } };
  }

  console.log(`Received ${request.amount} tokens with message: ${payload}`);
  return { accept: true };
});

await node.start();
```

<details>
<summary>Advanced: packet-level handler with raw ILP types</summary>

If you need direct control over fulfillment computation and ILP error codes, use `setLocalDeliveryHandler()` instead:

```typescript
import { createHash } from 'crypto';
import { ConnectorNode, createLogger } from '@agent-society/connector';
import type { LocalDeliveryRequest, LocalDeliveryResponse } from '@agent-society/connector';

const logger = createLogger('my-agent', 'info');
const node = new ConnectorNode('config.yaml', logger);

node.setLocalDeliveryHandler(
  async (packet: LocalDeliveryRequest): Promise<LocalDeliveryResponse> => {
    const amount = BigInt(packet.amount);

    if (amount < 100n) {
      return { reject: { code: 'F06', message: 'Insufficient payment' } };
    }

    // Fulfillment = SHA256(data). The sender set condition = SHA256(SHA256(data)).
    const data = Buffer.from(packet.data, 'base64');
    const fulfillment = createHash('sha256').update(data).digest().toString('base64');

    return { fulfill: { fulfillment } };
  }
);

await node.start();
```

Both methods share the same underlying slot — setting one overwrites the other.

</details>

**Option B: Separate process** (process isolation)

If you want your business logic in a separate process — for independent scaling, language flexibility, or deployment isolation — the connector posts packets directly to your server via HTTP. No middleware needed.

```
                Inbound packets               Outbound sends
Connector ──POST /handle-packet──► Your BLS
Your BLS  ──POST /admin/ilp/send──► Connector
```

Configure the connector to forward incoming packets to your server:

```yaml
# config.yaml
localDelivery:
  enabled: true
  handlerUrl: http://localhost:8080 # Your business logic server URL
  timeout: 30000

adminApi:
  enabled: true
  port: 8081 # For outbound sends from your BLS
```

Your server handles incoming packets on `POST /handle-packet`:

```typescript
// Receive packets — connector calls this when a packet arrives for you
app.post('/handle-packet', async (req, res) => {
  const { paymentId, destination, amount, expiresAt, data } = req.body;
  const message = data ? Buffer.from(data, 'base64').toString() : '';

  if (BigInt(amount) < MINIMUM_PAYMENT) {
    return res.json({
      accept: false,
      rejectReason: { code: 'invalid_amount', message: 'Pay more' },
    });
  }

  console.log(`Received ${amount} tokens with message: ${message}`);
  res.json({ accept: true });
});
```

Your server sends outbound payments via the connector's admin API:

```bash
# Send a payment through the network
curl -X POST http://localhost:8081/admin/ilp/send \
  -H 'Content-Type: application/json' \
  -d '{"destination":"g.peer.agent","amount":"1000","data":"aGVsbG8="}'
```

See [examples/business-logic-typescript](examples/business-logic-typescript) for a full starter template.

## Configuration

The connector is configured with a YAML file. Here's a minimal example:

```yaml
nodeId: my-agent
btpServerPort: 3000
healthCheckPort: 8080
logLevel: info

peers:
  - id: peer-b
    url: ws://peer-b:3001
    authToken: secret-token

routes:
  - prefix: g.peer-b
    nextHop: peer-b
    priority: 0
```

Full config options:

| Section         | What It Controls                                                     |
| --------------- | -------------------------------------------------------------------- |
| `nodeId`        | Unique identifier for this connector                                 |
| `btpServerPort` | WebSocket port for incoming peer connections                         |
| `peers`         | Other connectors to connect to                                       |
| `routes`        | Routing table — which prefixes go to which peers                     |
| `localDelivery` | Forward packets to an external business logic server (Option B only) |
| `settlement`    | On-chain settlement settings                                         |
| `explorer`      | Real-time telemetry UI                                               |
| `security`      | Rate limiting, allowlists                                            |
| `performance`   | Timeouts, buffer sizes                                               |

Sensitive values (private keys, RPC URLs) are loaded from environment variables. Run `npx agent-runtime setup` to generate a `.env` file interactively.

See [examples/](examples/) for topology configs: linear, mesh, hub-spoke, and production setups.

## Settlement

Agents accumulate balances off-chain. When ready, they settle the net balance in a single on-chain transaction using payment channels.

| Chain          | Why Use It                                             |
| -------------- | ------------------------------------------------------ |
| **Base L2**    | Ethereum ecosystem, ERC-20 tokens, DeFi composability  |
| **XRP Ledger** | Native payment channels, 3-5 second finality, low fees |
| **Aptos**      | Move language, 160k+ TPS, sub-second finality          |

Settlement is optional. All chain SDKs are peer dependencies — install only the ones you need:

```bash
# For Base L2 / EVM settlement
npm install ethers

# For XRP Ledger settlement
npm install xrpl

# For Aptos settlement
npm install @aptos-labs/ts-sdk
```

## Packages

This repo is a monorepo with two packages:

| Package                                          | Description                                           |
| ------------------------------------------------ | ----------------------------------------------------- |
| [`@agent-society/connector`](packages/connector) | Connector node — routing, accounting, settlement, CLI |
| [`@agent-society/shared`](packages/shared)       | Shared types and OER codec utilities                  |

## Architecture

**Option A — embedded (recommended):**

```
┌─────────────────────────────────────────────────────────────┐
│  Your Agent                                                  │
│  import @agent-society/connector                             │
│  setPacketHandler(request => ...) + sendPacket()              │
└──────────────────────┬──────────────────────────────────────┘
                       │ (same process)
┌──────────────────────▼──────────────────────────────────────┐
│  @agent-society/connector                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Routing  │ │ BTP/WS   │ │ Ledger   │ │  Settlement   │  │
│  │ Table    │ │ Peers    │ │ Accounts │ │  (optional)   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────┬───────┘  │
└─────────────────────────────────────────────────┼───────────┘
                                                  │
                              ┌────────────┬──────┴─────┐
                              │ Base L2    │ XRP Ledger │ Aptos
                              └────────────┴────────────┘
```

**Option B — isolated process:**

```
┌──────────────┐   /handle-packet   ┌──────────────┐
│  Your BLS    │◄──────────────────│  @agent-     │
│              │                    │  runtime/    │
│  Outbound:   │  /admin/ilp/send  │  connector   │
│  POST ───────│──────────────────►│              │
│              │                    │              │
└──────────────┘                    └──────────────┘
```

## Explorer UI

The connector includes a built-in real-time dashboard. Enable it in your config:

```yaml
explorer:
  enabled: true
  port: 3001
```

Then open `http://localhost:3001` to watch messages, balances, and settlements as they happen.

## Development

```bash
# Clone and install
git clone https://github.com/ALLiDoizCode/agent-runtime.git
cd agent-runtime
npm install

# Build all packages
npm run build

# Run tests
npm test

# Start a local dev network
npm run dev
```

### Requirements

- **Node.js** >= 22.11.0
- **Docker** (for TigerBeetle and multi-node testing)

**macOS note:** TigerBeetle requires native installation. Run `npm run tigerbeetle:install` first. See [macOS Setup](docs/guides/local-development-macos.md).

## Documentation

| Guide                                      | Description                                     |
| ------------------------------------------ | ----------------------------------------------- |
| [Building Agents](docs/building-agents.md) | Write your business logic and deploy            |
| [Deployment](docs/deployment.md)           | Docker Compose & Kubernetes setup               |
| [Protocols](docs/protocols.md)             | Technical details on ILP, BTP, payment channels |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE).

## Links

- **GitHub:** [github.com/ALLiDoizCode/agent-runtime](https://github.com/ALLiDoizCode/agent-runtime)
- **Interledger:** [interledger.org](https://interledger.org)
- **TigerBeetle:** [tigerbeetle.com](https://tigerbeetle.com)
