# Send Packet CLI Tool

Command-line utility for injecting test ILP packets into the M2M connector network.

## Overview

The `send-packet` tool allows developers to:

- Send test ILP Prepare packets to connector nodes
- Test multi-hop routing through connector networks
- Observe packet flow in real-time via the dashboard
- Validate routing configurations and BTP connectivity
- Perform load testing with batch and sequence modes

## Installation

The tool is included in the M2M monorepo workspace. After running `npm install` from the project root, the tool is automatically available.

```bash
# From project root
npm install

# Build the tool
cd tools/send-packet
npm run build
```

## Usage

### Basic Usage

```bash
# From project root
npm run send-packet -- -c ws://localhost:3000 -d g.connectora.dest -a 1000

# Or from tools/send-packet directory
npm start -- -c ws://localhost:3000 -d g.connectora.dest -a 1000
```

### Command-Line Options

**Required Options:**

- `-c, --connector-url <url>` - WebSocket URL of connector (e.g., `ws://localhost:3000`)
- `-d, --destination <address>` - ILP destination address (e.g., `g.connectora.dest`)
- `-a, --amount <value>` - Payment amount in smallest unit (e.g., `1000`)

**Optional Options:**

- `--auth-token <token>` - BTP authentication token (default: `test-token`)
- `--expiry <seconds>` - Packet expiry time in seconds (default: `30`)
- `--data <payload>` - Optional UTF-8 data payload
- `--log-level <level>` - Log level: `debug`, `info`, `warn`, `error` (default: `info`)
- `--batch <count>` - Send N packets in parallel (default: `1`)
- `--sequence <count>` - Send N packets sequentially (default: `1`)
- `--delay <ms>` - Delay between sequential packets in milliseconds (default: `0`)

### Examples

**Send a single test packet:**

```bash
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectora.dest \
  -a 1000
```

**Send packet with custom expiry and data:**

```bash
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectora.dest \
  -a 5000 \
  --expiry 60 \
  --data "Hello ILP"
```

**Send 10 packets in parallel (batch mode):**

```bash
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectora.dest \
  -a 1000 \
  --batch 10
```

**Send 5 packets sequentially with 1-second delay:**

```bash
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectora.dest \
  -a 1000 \
  --sequence 5 \
  --delay 1000
```

**Send packet with debug logging:**

```bash
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectora.dest \
  -a 1000 \
  --log-level debug
```

## Testing Different Network Topologies

### Linear Topology (3-node chain)

Test multi-hop routing through a linear chain of connectors:

```bash
# Start 3-node linear topology
docker-compose -f docker-compose.yml up -d

# Send packet from connector-a to connector-c (routes through connector-b)
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectorc.dest \
  -a 1000

# Observe packet flow in dashboard at http://localhost:8080
```

### Mesh Topology (4-node full mesh)

Test direct routing in a mesh network:

```bash
# Start 4-node mesh topology
docker-compose -f docker-compose-mesh.yml up -d

# Send packet from connector-a to connector-d (direct route)
npm run send-packet -- \
  -c ws://localhost:3000 \
  -d g.connectord.dest \
  -a 1000
```

### Hub-and-Spoke Topology

Test hub routing from spoke to spoke:

```bash
# Start hub-spoke topology
docker-compose -f docker-compose-hub-spoke.yml up -d

# Send packet from spoke-1 to spoke-2 (routes through hub)
npm run send-packet -- \
  -c ws://localhost:3001 \
  -d g.spoke2.dest \
  -a 1000
```

## Observing Results

### CLI Output

The tool logs packet send confirmation and response status:

```
INFO: Packet created { destination: "g.connectora.dest", amount: "1000" }
INFO: Packet sent { requestId: 1, destination: "g.connectora.dest" }
INFO: Packet fulfilled { packetType: "FULFILL", fulfillment: "a3f2..." }
```

### Dashboard Visualization

Open the dashboard at `http://localhost:8080` to see:

- Real-time packet animation along network edges
- Network topology graph with connector nodes
- LogViewer showing structured logs from all connectors
- Packet telemetry events (PACKET_SENT, PACKET_RECEIVED, ROUTE_LOOKUP)

### Exit Codes

- `0` - Packet fulfilled successfully
- `1` - Packet rejected or error occurred
- `2` - Invalid arguments or configuration

## Architecture

### Components

**Packet Factory** (`src/packet-factory.ts`)

- Creates valid ILP Prepare, Fulfill, and Reject packets
- Generates random 32-byte preimages
- Computes SHA-256 execution conditions
- Validates ILP addresses per RFC-0015

**BTP Sender** (`src/btp-sender.ts`)

- WebSocket BTP client for packet transmission
- BTP authentication handshake
- Request/response correlation with timeouts
- Message parsing and serialization

**CLI Interface** (`src/index.ts`)

- Commander.js argument parsing
- Pino structured logging with pino-pretty
- Batch and sequence mode orchestration
- Error handling and exit codes

### Packet Flow

1. CLI parses arguments and creates Pino logger
2. Packet Factory generates ILP Prepare packet with:
   - Random 32-byte preimage
   - SHA-256(preimage) as execution condition
   - Future expiry timestamp (current time + expiry seconds)
3. BTP Sender connects to connector via WebSocket
4. BTP authentication handshake with auth token
5. Serialize ILP packet using OER encoding
6. Send BTP MESSAGE with ILP packet payload
7. Wait for BTP RESPONSE with ILP Fulfill/Reject packet
8. Deserialize response and log result
9. Disconnect and exit with appropriate code

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run tests in watch mode
npm run test:watch
```

### Building

```bash
# Compile TypeScript to JavaScript
npm run build

# Output: dist/index.js (executable with shebang)
```

### Making Changes

The tool is structured as a standalone TypeScript package with:

- `src/` - TypeScript source files
- `test/unit/` - Jest unit tests
- `dist/` - Compiled JavaScript output
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration

When making changes:

1. Edit source files in `src/`
2. Add/update tests in `test/unit/`
3. Run `npm test` to verify tests pass
4. Run `npm run build` to compile
5. Test CLI functionality: `npm start -- --help`

## Troubleshooting

**Connection refused:**

- Verify connector is running: `docker ps`
- Check connector URL and port match configuration
- Ensure connector BTP server is listening on correct port

**Authentication failed:**

- Verify `--auth-token` matches connector's `authToken` in configuration
- Check connector logs for authentication errors

**Packet rejected with F02 (Unreachable):**

- Verify destination address exists in connector's routing table
- Check routing configuration in connector config YAML
- Use dashboard to visualize network topology

**Packet timeout:**

- Increase `--expiry` value (default 30 seconds may be too short)
- Check connector logs for packet processing errors
- Verify all intermediate connectors are running and connected

## References

- [RFC-0027: ILPv4](../../docs/rfcs/rfc-0027-ilpv4.md) - ILP packet format specification
- [RFC-0023: BTP](../../docs/rfcs/rfc-0023-btp.md) - Bilateral Transfer Protocol
- [RFC-0015: ILP Addresses](../../docs/rfcs/rfc-0015-ilp-addresses.md) - Address format rules
- [Project README](../../README.md) - M2M project overview and setup
