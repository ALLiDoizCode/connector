# @crosstown/connector

[![npm](https://img.shields.io/npm/v/@crosstown/connector)](https://www.npmjs.com/package/@crosstown/connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

> ILP connector node for AI agent payment networks. Routes messages, tracks balances, settles on-chain.

This is the core package of the [connector](https://github.com/ALLiDoizCode/connector) monorepo. See the root README for full usage documentation.

## Install

```bash
npm install @crosstown/connector
```

## What's Inside

- **ILP Packet Routing** — RFC-0027 compliant packet forwarding with configurable routing tables
- **BTP Peers** — WebSocket-based peer connections using Bilateral Transfer Protocol (RFC-0023)
- **Tri-Chain Settlement** — Payment channels on Base L2 (EVM), XRP Ledger, and Aptos
- **Accounting** — In-memory ledger (default, zero dependencies) or TigerBeetle (optional, high-throughput)
- **Explorer UI** — Built-in real-time dashboard for packet flow, balances, and settlement monitoring
- **Admin API** — HTTP endpoints for peer management, balance queries, and ILP packet sending
- **CLI** — `npx connector setup`, `health`, `validate` commands

## Quick Example

```typescript
import { ConnectorNode, createLogger } from '@crosstown/connector';

const node = new ConnectorNode('config.yaml', createLogger('my-agent', 'info'));

node.setPacketHandler(async (request) => {
  console.log(`Received ${request.amount} tokens`);
  return { accept: true };
});

await node.start();
```

## Configuration

YAML config file or pass a config object directly:

```yaml
nodeId: my-agent
btpServerPort: 3000
healthCheckPort: 8080

peers:
  - id: peer-b
    url: ws://peer-b:3001
    authToken: secret-token # Or "" for no-auth (requires BTP_ALLOW_NOAUTH=true)

routes:
  - prefix: g.peer-b
    nextHop: peer-b
```

### BTP Authentication

**Two deployment models:**

#### 1. Permissionless Networks (ILP-Gated) - DEFAULT

**Default mode.** For permissionless networks where access control happens at the ILP layer (via routing policies, credit limits, and settlement):

```yaml
peers:
  - id: peer-b
    url: ws://peer-b:3001
    authToken: '' # Empty = permissionless (default)
```

No environment configuration needed - permissionless mode is the default.

**Security:** Protection comes from ILP-layer controls (credit limits, settlement requirements, routing policies, payment channels). See [peer-onboarding-guide.md](../../docs/operators/peer-onboarding-guide.md#ilp-layer-gating-production-security) for production security checklist.

#### 2. Private Networks (Authenticated BTP)

For private networks with known peers, disable permissionless mode and configure shared secrets:

```bash
# Switch to private network mode
BTP_ALLOW_NOAUTH=false
```

```yaml
peers:
  - id: peer-b
    url: ws://peer-b:3001
    authToken: secret-token # Shared secret for bilateral trust
```

Configure peer secrets via environment variables:

```bash
BTP_PEER_PEER_B_SECRET=secret-token
```

## Accounting Backend

### Default: In-Memory Ledger

Zero dependencies. Persists to JSON snapshots on disk.

| Variable                     | Default                       | Description               |
| ---------------------------- | ----------------------------- | ------------------------- |
| `LEDGER_SNAPSHOT_PATH`       | `./data/ledger-snapshot.json` | Snapshot file path        |
| `LEDGER_PERSIST_INTERVAL_MS` | `30000`                       | Persistence interval (ms) |

### Optional: TigerBeetle

High-performance double-entry accounting. Falls back to in-memory if connection fails.

| Variable                 | Required | Description                       |
| ------------------------ | -------- | --------------------------------- |
| `TIGERBEETLE_CLUSTER_ID` | Yes      | TigerBeetle cluster identifier    |
| `TIGERBEETLE_REPLICAS`   | Yes      | Comma-separated replica addresses |

## Explorer UI

Enabled by default. Provides real-time packet visualization and settlement monitoring.

| Variable                  | Default   | Description              |
| ------------------------- | --------- | ------------------------ |
| `EXPLORER_ENABLED`        | `true`    | Enable/disable explorer  |
| `EXPLORER_PORT`           | `3001`    | HTTP/WebSocket port      |
| `EXPLORER_RETENTION_DAYS` | `7`       | Event retention period   |
| `EXPLORER_MAX_EVENTS`     | `1000000` | Maximum events to retain |

**Endpoints:**

| Endpoint          | Description                                  |
| ----------------- | -------------------------------------------- |
| `GET /api/events` | Query historical events (supports filtering) |
| `GET /api/health` | Explorer health status                       |
| `WS /ws`          | Real-time event streaming                    |

## Admin API Security

The Admin API provides HTTP endpoints for runtime management (add/remove peers, send ILP packets, query balances). Security options include API key authentication and/or IP allowlisting.

### Authentication Options

**Production requirement:** At least one of the following must be configured:

1. **API Key** — Header-based authentication (recommended for most deployments)
2. **IP Allowlist** — Network-level access control (recommended for containerized environments)
3. **Both** — Defense in depth (recommended for high-security deployments)

### API Key Authentication

```yaml
adminApi:
  enabled: true
  port: 8081
  apiKey: ${ADMIN_API_KEY} # Required in production (if no IP allowlist)
```

**Generate secure API key:**

```bash
# Best: OpenSSL (256-bit entropy)
openssl rand -base64 32

# Alternative: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Usage:**

```bash
curl -H "X-Api-Key: your-secret-key" http://localhost:8081/admin/peers
```

**Security notes:**

- API keys must be sent via `X-Api-Key` header (query params are rejected to prevent log leakage)
- Uses timing-safe comparison to prevent timing attacks
- In production, API key is **required** unless IP allowlist is configured

### IP Allowlist

```yaml
adminApi:
  enabled: true
  port: 8081
  allowedIPs:
    - 127.0.0.1 # IPv4 localhost
    - ::1 # IPv6 localhost
    - 10.0.1.5 # Specific server IP
    - 172.18.0.0/16 # Docker network (CIDR)
    - 10.244.0.0/16 # Kubernetes pod network (CIDR)
  trustProxy: false # Set true when behind reverse proxy
```

**Finding network CIDRs:**

```bash
# Docker network
docker network inspect myapp_default --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# Output: 172.18.0.0/16

# Kubernetes pod network
kubectl cluster-info dump | grep -m 1 cluster-cidr
# Output: --cluster-cidr=10.244.0.0/16

# Server's private IP
hostname -I  # On the business logic server
# Output: 10.0.1.5
```

**Behind reverse proxy (nginx, traefik, ALB):**

```yaml
adminApi:
  enabled: true
  port: 8081
  allowedIPs: [203.0.113.5] # Actual client IP (from X-Forwarded-For)
  trustProxy: true # CRITICAL: Only enable behind trusted proxy
```

**Security notes:**

- IP allowlist is checked **before** API key validation (fast rejection)
- Supports both individual IPs and CIDR notation
- When `trustProxy: true`, client IP extracted from `X-Forwarded-For` header
- **WARNING:** Only enable `trustProxy` if your reverse proxy strips/overwrites `X-Forwarded-For` (untrusted proxies can spoof this header)

### Defense in Depth (Recommended)

```yaml
adminApi:
  enabled: true
  port: 8081
  apiKey: ${ADMIN_API_KEY}
  allowedIPs: [10.0.1.0/24]
  trustProxy: false
```

Both IP allowlist **and** API key provide layered security:

1. IP allowlist rejects unauthorized networks immediately
2. API key authenticates authorized networks

### Environment Variables

| Variable                | Description                | Example                 |
| ----------------------- | -------------------------- | ----------------------- |
| `ADMIN_API_ENABLED`     | Enable admin API           | `true`                  |
| `ADMIN_API_PORT`        | HTTP port                  | `8081`                  |
| `ADMIN_API_HOST`        | Bind host                  | `0.0.0.0`               |
| `ADMIN_API_KEY`         | API key (required in prod) | `your-secret-key`       |
| `ADMIN_API_ALLOWED_IPS` | Comma-separated IPs/CIDRs  | `127.0.0.1,10.0.0.0/16` |
| `ADMIN_API_TRUST_PROXY` | Trust X-Forwarded-For      | `false`                 |

**Endpoints:**

| Endpoint                       | Description           |
| ------------------------------ | --------------------- |
| `GET /admin/peers`             | List all peers        |
| `POST /admin/peers`            | Add a new peer        |
| `DELETE /admin/peers/:peerId`  | Remove a peer         |
| `GET /admin/routes`            | List routing table    |
| `POST /admin/routes`           | Add a route           |
| `DELETE /admin/routes/:prefix` | Remove a route        |
| `POST /admin/ilp/send`         | Send ILP packet       |
| `GET /admin/balances/:peerId`  | Query peer balances   |
| `GET /admin/channels`          | List payment channels |
| `POST /admin/channels`         | Open payment channel  |

## Exported API

**Classes:** `ConnectorNode`, `ConfigLoader`, `RoutingTable`, `PacketHandler`, `BTPServer`, `BTPClient`, `BTPClientManager`, `AdminServer`, `AccountManager`, `SettlementMonitor`, `UnifiedSettlementExecutor`

**Types:** `ConnectorConfig`, `PeerConfig`, `RouteConfig`, `SettlementConfig`, `LocalDeliveryConfig`, `SendPacketParams`, `PaymentRequest`, `PaymentResponse`, `ILPPreparePacket`, `ILPFulfillPacket`, `ILPRejectPacket`

**Utilities:** `createLogger`, `createPaymentHandlerAdapter`, `computeFulfillmentFromData`, `computeConditionFromData`, `validateIlpSendRequest`

## Package Structure

```
src/
├── core/       # Packet forwarding, ConnectorNode, payment handler
├── btp/        # BTP server and client (WebSocket peers)
├── routing/    # Routing table and prefix matching
├── settlement/ # Multi-chain settlement executors, claim signing
├── http/       # Admin API, health endpoints, ILP send handler
├── explorer/   # Embedded telemetry UI server and event store
├── wallet/     # HD wallet derivation for multi-chain keys
├── security/   # KMS integration (AWS, Azure, GCP)
├── config/     # Configuration schema and validation
└── utils/      # Logger, OER encoding
```

## Testing

```bash
npm test                 # Unit tests
npm run test:acceptance  # Acceptance tests
```

## License

MIT — see [LICENSE](../../LICENSE).
