# @m2m/connector

The M2M Connector package provides the core ILP connector functionality for the Machine-to-Machine Economy platform.

## Overview

This package implements:

- ILP packet routing and forwarding
- Settlement coordination (EVM and XRP Ledger)
- Balance tracking with TigerBeetle
- Peer management via BTP
- Security controls and rate limiting
- Explorer UI for telemetry visualization

## Explorer UI

The connector includes an embedded Explorer UI for visualizing telemetry events in real-time.

### Configuration

The Explorer is enabled by default. Configure via environment variables:

| Variable                  | Default   | Description                              |
| ------------------------- | --------- | ---------------------------------------- |
| `EXPLORER_ENABLED`        | `true`    | Enable/disable explorer UI               |
| `EXPLORER_PORT`           | `3001`    | HTTP/WebSocket server port               |
| `EXPLORER_RETENTION_DAYS` | `7`       | Event retention period (1-365 days)      |
| `EXPLORER_MAX_EVENTS`     | `1000000` | Maximum events to retain (1000-10000000) |

### Accessing the Explorer

When enabled, access the Explorer UI at:

- Local development: `http://localhost:3001`
- Docker (mesh topology): `http://localhost:3010` (connector-a), `3011` (b), `3012` (c), `3013` (d)

### API Endpoints

| Endpoint          | Description                                  |
| ----------------- | -------------------------------------------- |
| `GET /api/events` | Query historical events (supports filtering) |
| `GET /api/health` | Explorer health status                       |
| `WS /ws`          | Real-time event streaming                    |

### Docker Topologies

Explorer ports are pre-configured in each docker-compose file:

**Linear (3-node):**

```bash
docker-compose -f docker/docker-compose.linear.yml up -d
# Connector A: http://localhost:3010
# Connector B: http://localhost:3011
# Connector C: http://localhost:3012
```

**Mesh (4-node):**

```bash
docker-compose -f docker/docker-compose.mesh.yml up -d
# Connector A-D: http://localhost:3010-3013
```

**Hub-Spoke:**

```bash
docker-compose -f docker/docker-compose.hub-spoke.yml up -d
# Hub: http://localhost:3010
# Spokes: http://localhost:3011-3013
```

## Workflow Peer Mode (Epic 31)

The connector can run as a **workflow peer** to execute image processing pipelines in response to ILP packets. This enables pay-per-use computational services routed via Interledger Protocol.

### Starting the Workflow Peer

The workflow peer receives ILP packets addressed to `g.workflow.*` and executes Sharp-based image processing steps.

### Workflow Addresses

Workflow addresses follow the pattern: `g.workflow.<step1>.<step2>.<step3>`

**Available Steps:**

| Step        | Cost (msat) | Description                          |
| ----------- | ----------- | ------------------------------------ |
| `resize`    | 100         | Resize image to 1024x768 (cover fit) |
| `watermark` | 200         | Add watermark text overlay           |
| `optimize`  | 150         | Optimize JPEG quality (80%)          |

**Example Addresses:**

- `g.workflow.resize` - Resize only (100 msat)
- `g.workflow.resize.watermark` - Resize + watermark (300 msat)
- `g.workflow.resize.watermark.optimize` - Full pipeline (450 msat)

### Configuration

Configure workflow peer via environment variables:

| Variable                   | Default             | Description                        |
| -------------------------- | ------------------- | ---------------------------------- |
| `WORKFLOW_PEER_PORT`       | `8203`              | HTTP health endpoint port          |
| `WORKFLOW_BTP_PORT`        | `3203`              | BTP WebSocket port                 |
| `MAX_IMAGE_SIZE`           | `10485760`          | Maximum image size (10MB in bytes) |
| `DEFAULT_RESIZE_WIDTH`     | `1024`              | Default resize width (pixels)      |
| `DEFAULT_RESIZE_HEIGHT`    | `768`               | Default resize height (pixels)     |
| `DEFAULT_WATERMARK_TEXT`   | `Workflow ILP Demo` | Default watermark text             |
| `DEFAULT_OPTIMIZE_QUALITY` | `80`                | Default JPEG quality (1-100)       |

### Workflow Execution

Send an ILP Prepare packet with:

1. **Destination**: `g.workflow.resize.watermark.optimize`
2. **Amount**: Total cost in millisatoshis (e.g., `450n`)
3. **Data**: Raw image buffer or base64-encoded image
4. **Execution Condition**: Standard ILP condition

The workflow peer will:

1. Parse the workflow address to extract steps
2. Validate payment amount matches required cost
3. Execute steps sequentially (resize → watermark → optimize)
4. Return processed image in ILP Fulfill packet (base64 encoded)

### Error Handling

| Error Code | Condition               | Message                    |
| ---------- | ----------------------- | -------------------------- |
| `F02`      | Non-workflow address    | Destination unreachable    |
| `T04`      | Insufficient payment    | Required X msat, got Y     |
| `T00`      | Invalid image format    | Invalid image format       |
| `T00`      | Image too large (>10MB) | Image exceeds maximum size |
| `T00`      | Unknown workflow step   | Unknown workflow step: X   |

## Installation

```bash
npm install @m2m/connector
```

## Usage

See the main project README for configuration and deployment instructions.

## Messaging Gateway Mode

The connector can run in **messaging gateway mode** to route pre-encrypted NIP-59 giftwrap events through the ILP network. This enables browser clients to send end-to-end encrypted messages without exposing private keys to the server.

### Starting the Gateway

Set the `mode` configuration to `gateway` in your YAML config file:

```yaml
mode: gateway
nodeId: gateway-1
firstHopUrl: ws://connector1:3000
btpAuthToken: your-shared-secret
logLevel: info
```

Or use environment variables:

```bash
export MODE=gateway
export FIRST_HOP_URL=ws://connector1:3000
export BTP_AUTH_TOKEN=your-token
npm start
```

### API Endpoints

**POST /api/route-giftwrap**

Send encrypted giftwrap through ILP network.

Request:

```json
{
  "giftwrap": {
    "kind": 1059,
    "pubkey": "...",
    "created_at": 1234567890,
    "tags": [["p", "recipient-pubkey"]],
    "content": "encrypted-content",
    "id": "...",
    "sig": "..."
  },
  "recipient": "g.agent.bob.private",
  "amount": 300
}
```

Response (Success):

```json
{
  "success": true,
  "fulfill": "c2VjcmV0MTIz...",
  "latency": 4200
}
```

Response (Error):

```json
{
  "error": "Insufficient funds"
}
```

**Error Codes:**

- `400 Bad Request` - Missing required fields
- `402 Payment Required` - Insufficient funds
- `503 Service Unavailable` - Routing failure
- `504 Gateway Timeout` - Request timeout

**GET /health**

Health check endpoint.

Response:

```json
{
  "status": "ok"
}
```

### WebSocket Connection

Clients connect to receive giftwrap messages:

```javascript
const ws = new WebSocket('ws://localhost:3003?clientId=alice');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // { type: 'giftwrap', data: <NostrEvent>, amount: '50' }
  console.log('Received giftwrap:', message.data);
};
```

**Connection Parameters:**

- `clientId` (required) - Client identifier for routing messages

**Message Format:**

```json
{
  "type": "giftwrap",
  "data": {
    "kind": 1059,
    "pubkey": "...",
    "content": "...",
    ...
  },
  "amount": "50"
}
```

### Configuration

See `examples/messaging-gateway-config.yaml` for a complete example configuration.

**Required Fields:**

- `mode: gateway` - Enable gateway mode
- `firstHopUrl` - BTP URL of first-hop connector
- `btpAuthToken` - Authentication token for BTP connection

**Optional Fields:**

- `nodeId` - Gateway node identifier (default: 'gateway')
- `logLevel` - Logging level (default: 'info')

### Security Notes

- Gateway is **content-blind** - it never decrypts giftwrap events
- Uses TOON encoding for efficient ILP packet size (~40% smaller than JSON)
- Query parameter authentication (`?clientId=`) is MVP-only
- **TODO:** Upgrade to JWT/OAuth token-based authentication for production

## Testing

```bash
# Unit tests
npm test

# Acceptance tests
npm run test:acceptance

# Load tests (requires staging environment)
npm run test:load
```

## Package Structure

- `src/` - Source code
  - `core/` - Core connector logic
  - `routing/` - Packet routing
  - `settlement/` - Settlement engines
  - `wallet/` - Wallet management
  - `explorer/` - Explorer server and event store
- `explorer-ui/` - Explorer UI (React/Vite)
- `test/` - Test suites
  - `unit/` - Unit tests
  - `integration/` - Integration tests
  - `acceptance/` - Acceptance tests

## Facilitator Server (Epic 31)

The facilitator acts as an HTTP-to-ILP gateway for workflow requests.

### Starting the Facilitator

```bash
npm run start:facilitator
```

### API Endpoints

#### POST /api/workflow/process

Submit an image for processing through the workflow pipeline.

**Request:**

- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `image` (file): Image file (JPEG/PNG/WebP, max 10MB)
  - `steps` (JSON string): Array of processing steps (default: ["resize", "watermark", "optimize"])

**Response:**

- Success (200): Processed image as binary data
- Error (400): Invalid request (file too large, invalid format)
- Error (503): Workflow service unavailable
- Error (500): Internal error

**Example:**

```bash
curl -X POST http://localhost:3001/api/workflow/process \
  -F "image=@my-photo.jpg" \
  -F 'steps=["resize", "watermark", "optimize"]' \
  --output processed.jpg
```

#### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "services": {
    "workflow-peer": "available"
  }
}
```

### Configuration

| Variable                        | Default                    | Description                             |
| ------------------------------- | -------------------------- | --------------------------------------- |
| `FACILITATOR_HTTP_PORT`         | `3001`                     | HTTP API port                           |
| `FACILITATOR_BTP_PORT`          | `3200`                     | BTP WebSocket port (optional)           |
| `CONNECTOR1_BTP_URL`            | `ws://connector-1:3201`    | Connector1 BTP endpoint                 |
| `CONNECTOR1_AUTH_TOKEN`         | `shared-secret-123`        | BTP authentication token                |
| `WORKFLOW_PEER_PAYMENT_POINTER` | `$workflow-peer/workflow`  | SPSP payment pointer for workflow peer  |
| `MAX_IMAGE_SIZE`                | `10485760` (10MB)          | Maximum image upload size (bytes)       |
| `ACCEPTED_FORMATS`              | `image/jpeg,image/png,...` | Accepted MIME types (comma-separated)   |
| `SPSP_TIMEOUT`                  | `5000`                     | SPSP handshake timeout (milliseconds)   |
| `WORKFLOW_TIMEOUT`              | `30000`                    | Workflow request timeout (milliseconds) |

## License

See root LICENSE file.
