# ILP Connector Configuration Examples

This directory contains example YAML configuration files for different network topologies. These examples demonstrate how to configure ILP connectors for various deployment scenarios.

## Table of Contents

- [Configuration Format](#configuration-format)
- [Linear Topology](#linear-topology-3-nodes)
- [Mesh Topology](#mesh-topology-4-nodes)
- [Hub-and-Spoke Topology](#hub-and-spoke-topology)
- [Usage](#usage)
- [Customization](#customization)

## Configuration Format

Each connector configuration file follows this YAML schema:

```yaml
# Node Identity
nodeId: string # Unique identifier for this connector
btpServerPort: number # Port for incoming BTP connections (1-65535)
logLevel: string # Optional: 'debug' | 'info' | 'warn' | 'error' (default: 'info')
healthCheckPort: number # Optional: HTTP health endpoint port (default: 8080)

# Peer Connections
peers:
  - id: string # Peer identifier (used in routes)
    url: string # WebSocket URL (ws://host:port or wss://host:port)
    authToken: string # Shared secret for BTP authentication

# Routing Table
routes:
  - prefix: string # ILP address prefix (RFC-0015 format)
    nextHop: string # Peer ID from peers list
    priority: number # Optional: Route priority (default: 0)
```

## Linear Topology (3 Nodes)

**Topology**: A → B → C

A simple linear chain where connector B acts as a relay between A and C.

### Files

- `linear-3-nodes-a.yaml` - First connector (accepts incoming only)
- `linear-3-nodes-b.yaml` - Middle connector (connects to both A and C)
- `linear-3-nodes-c.yaml` - Last connector (accepts incoming only)

### Diagram

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│ Connector A │←─────│ Connector B │─────→│ Connector C │
│   Port 3000 │      │   Port 3001 │      │   Port 3002 │
└─────────────┘      └─────────────┘      └─────────────┘
```

### Characteristics

- **Low complexity**: Simple to understand and debug
- **Single path**: No redundancy - failure of B disrupts A↔C communication
- **Minimal connections**: Only 2 BTP connections total
- **Use case**: Development, testing, proof of concept

### Running Linear Topology

```bash
# Using Docker Compose (recommended)
docker-compose up -d

# Or run connectors individually
CONFIG_FILE=examples/linear-3-nodes-a.yaml npm start --workspace=packages/connector
CONFIG_FILE=examples/linear-3-nodes-b.yaml npm start --workspace=packages/connector
CONFIG_FILE=examples/linear-3-nodes-c.yaml npm start --workspace=packages/connector
```

## Mesh Topology (4 Nodes)

**Topology**: Full mesh - each connector connected to all others

A fully connected network where every connector has direct connections to all other connectors.

### Files

- `mesh-4-nodes-a.yaml` - Connector A (connects to B, C, D)
- `mesh-4-nodes-b.yaml` - Connector B (connects to A, C, D)
- `mesh-4-nodes-c.yaml` - Connector C (connects to A, B, D)
- `mesh-4-nodes-d.yaml` - Connector D (connects to A, B, C)

### Diagram

```
       ┌─────────────┐
     ┌─│ Connector A │─┐
     │ │   Port 3000 │ │
     │ └─────────────┘ │
     │                 │
     │                 │
┌─────────────┐   ┌─────────────┐
│ Connector B │───│ Connector C │
│   Port 3001 │   │   Port 3002 │
└─────────────┘   └─────────────┘
     │                 │
     │ ┌─────────────┐ │
     └─│ Connector D │─┘
       │   Port 3003 │
       └─────────────┘
```

### Characteristics

- **High redundancy**: Multiple paths between any two nodes
- **Low latency**: Direct connections minimize hops
- **High complexity**: N×(N-1) connections for N nodes (12 connections for 4 nodes)
- **Resilient**: Network remains functional even if multiple connectors fail
- **Use case**: Production deployments requiring high availability

### Running Mesh Topology

```bash
# Using Docker Compose
docker-compose -f docker/docker-compose.mesh.yml up -d
```

## Hub-and-Spoke Topology

**Topology**: Hub ← Spoke1, Spoke2, Spoke3

A centralized network where all spoke connectors connect to a single hub. All inter-spoke traffic flows through the hub.

### Files

- `hub-spoke-hub.yaml` - Central hub connector (accepts incoming only)
- `hub-spoke-spoke1.yaml` - Spoke 1 (connects to hub)
- `hub-spoke-spoke2.yaml` - Spoke 2 (connects to hub)
- `hub-spoke-spoke3.yaml` - Spoke 3 (connects to hub)

### Diagram

```
              ┌─────────────┐
              │  Hub Node   │
              │  Port 3000  │
              └─────────────┘
                 ↑   ↑   ↑
        ┌────────┘   │   └────────┐
        │            │            │
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ Spoke 1  │ │ Spoke 2  │ │ Spoke 3  │
  │Port 3001 │ │Port 3002 │ │Port 3003 │
  └──────────┘ └──────────┘ └──────────┘
```

### Characteristics

- **Centralized**: Hub is critical infrastructure - failure disconnects all spokes
- **Efficient connections**: Only N connections for N spokes
- **Scalable**: Easy to add new spokes without reconfiguring existing ones
- **Moderate latency**: 2-hop maximum for spoke-to-spoke communication
- **Use case**: Branch office networks, edge computing scenarios

### Running Hub-and-Spoke Topology

```bash
# Using Docker Compose
docker-compose -f docker/docker-compose.hub-spoke.yml up -d
```

## Usage

### Environment Variables

- `CONFIG_FILE`: Path to YAML configuration file (default: `./config.yaml`)
- `LOG_LEVEL`: Logging verbosity - `debug`, `info`, `warn`, `error` (default: `info`)

### Docker Compose Usage

The main `docker-compose.yml` file uses the linear topology configuration:

```bash
# Start linear topology
docker-compose up -d

# View logs
docker-compose logs -f

# Check connector status
docker-compose ps

# Stop network
docker-compose down
```

### Standalone Usage

Run a single connector with a specific configuration:

```bash
# Build the connector
npm run build --workspace=packages/connector

# Run with configuration
CONFIG_FILE=examples/linear-3-nodes-a.yaml npm start --workspace=packages/connector
```

### Testing Connectivity

Once connectors are running, you can verify connectivity:

```bash
# Check connector logs for successful peer connections
docker-compose logs connector-b | grep "peer_connected"

# Expected output:
# {"event":"peer_connected","peerId":"connector-a"}
# {"event":"peer_connected","peerId":"connector-c"}
```

## Customization

### Creating Custom Topologies

You can create custom configurations by copying and modifying existing examples:

```bash
# Copy an example
cp examples/linear-3-nodes-b.yaml custom-config.yaml

# Edit configuration
nano custom-config.yaml

# Run with custom config
CONFIG_FILE=custom-config.yaml npm start --workspace=packages/connector
```

### Important Configuration Guidelines

1. **Unique Node IDs**: Each connector must have a unique `nodeId`
2. **Unique Ports**: Each connector must use a different `btpServerPort`
3. **Matching Peer IDs**: Route `nextHop` values must match peer `id` values
4. **Valid ILP Prefixes**: Route prefixes must follow RFC-0015 format (lowercase, alphanumeric, dots, underscores, tildes, hyphens)
5. **WebSocket URLs**: Peer URLs must use `ws://` or `wss://` protocol and include port number
6. **Bidirectional Connections**: If A connects to B, ensure B's routing table includes routes back to A

### Common Configuration Patterns

#### Adding a New Peer

```yaml
peers:
  - id: new-connector
    url: ws://new-connector:3004
    authToken: shared-secret-token
```

#### Adding a Route

```yaml
routes:
  - prefix: g.newdestination
    nextHop: new-connector
    priority: 0
```

#### Catch-All Route

```yaml
routes:
  # Specific routes first (longest prefix matching)
  - prefix: g.alice
    nextHop: connector-a

  # Catch-all route (shortest prefix)
  - prefix: g
    nextHop: default-gateway
```

## Validation

The connector validates configuration files on startup. Common validation errors:

- **Missing required field**: A required field (nodeId, btpServerPort, peers, routes) is not present
- **Invalid WebSocket URL**: Peer URL doesn't match `ws://` or `wss://` format
- **Route references non-existent peer**: A route's `nextHop` doesn't match any peer ID
- **Duplicate peer ID**: Two peers have the same ID
- **Invalid port range**: Port number is not between 1-65535
- **Invalid ILP address prefix**: Route prefix contains invalid characters

Example error message:

```
Configuration error: Route references non-existent peer: unknown-connector
```

## Troubleshooting

### Connector Fails to Start

1. **Check configuration file exists**: Verify `CONFIG_FILE` path is correct
2. **Validate YAML syntax**: Use a YAML linter to check for syntax errors
3. **Review validation errors**: Check connector logs for specific validation failures
4. **Verify port availability**: Ensure `btpServerPort` is not already in use

### Peers Not Connecting

1. **Check network connectivity**: Verify peer URLs are reachable
2. **Verify auth tokens**: Ensure both connectors use matching auth tokens
3. **Check routing configuration**: Confirm routes reference correct peer IDs
4. **Review firewall rules**: Ensure WebSocket ports are not blocked

### Packets Not Routing

1. **Verify routing table**: Check connector logs for `route_added` events
2. **Confirm peer connectivity**: Verify all required peers are connected
3. **Check ILP address prefixes**: Ensure route prefixes match packet destinations
4. **Review logs**: Look for `packet_forwarding` events to trace packet flow

## Additional Resources

- [Interledger RFC-0027: ILPv4](https://interledger.org/rfcs/0027-interledger-protocol-4/)
- [Interledger RFC-0023: Bilateral Transfer Protocol](https://interledger.org/rfcs/0023-bilateral-transfer-protocol/)
- [Interledger RFC-0015: ILP Addresses](https://interledger.org/rfcs/0015-ilp-addresses/)
- [Project Documentation](../docs/)
