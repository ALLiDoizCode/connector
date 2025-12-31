# Complex 8-Node Hierarchical Topology

This directory contains configuration files for a complex hierarchical ILP network topology with 8 nodes: 2 hubs and 6 spokes.

## Topology Diagram

```
                    Hub-1 ←→ Hub-2
                      ↓         ↓
                  ┌───┼───┐  ┌──┼──┐
                  ↓   ↓   ↓  ↓  ↓  ↓
              Spoke-1a   Spoke-2a
              Spoke-1b   Spoke-2b
              Spoke-1c   Spoke-2c
```

**Network Structure**:

- **Hub-1** (port 3000): Top-level hub for cluster 1
- **Hub-2** (port 3001): Top-level hub for cluster 2
- **Inter-Hub Link**: Hub-1 ↔ Hub-2 (bidirectional BTP peering)
- **Cluster 1 Spokes** (ports 3002-3004): spoke-1a, spoke-1b, spoke-1c → Hub-1
- **Cluster 2 Spokes** (ports 3005-3007): spoke-2a, spoke-2b, spoke-2c → Hub-2

## Topology Characteristics

- **Total Nodes**: 8
- **Total Connections**: 7 (6 spoke→hub + 1 hub↔hub)
- **Routing Hops**:
  - Same-cluster spoke→spoke: 2 hops (spoke → hub → spoke)
  - Cross-cluster spoke→spoke: 4 hops (spoke → hub → hub → spoke)
- **Hierarchical Structure**: Two-level hierarchy with inter-hub connectivity
- **Scalability**: Can add more spokes to either cluster without affecting other nodes

## Routing Paths Examples

### Same-Cluster Communication

**Spoke-1a → Spoke-1b** (2 hops):

```
Spoke-1a → Hub-1 → Spoke-1b
```

### Cross-Cluster Communication

**Spoke-1a → Spoke-2c** (4 hops):

```
Spoke-1a → Hub-1 → Hub-2 → Spoke-2c
```

### Hub-to-Spoke Communication

**Hub-1 → Spoke-2a** (2 hops):

```
Hub-1 → Hub-2 → Spoke-2a
```

## Running the Topology

### Prerequisites

1. Build the connector image:

   ```bash
   docker build -t ilp-connector .
   ```

2. Build the dashboard image:
   ```bash
   docker build -t ilp-dashboard -f packages/dashboard/Dockerfile .
   ```

### Start the Network

```bash
# From project root directory
docker-compose -f docker-compose-complex.yml up -d
```

### View Logs

```bash
# All services
docker-compose -f docker-compose-complex.yml logs -f

# Specific node
docker-compose -f docker-compose-complex.yml logs -f hub-1
docker-compose -f docker-compose-complex.yml logs -f spoke-1a
```

### Check Health Status

```bash
docker-compose -f docker-compose-complex.yml ps
```

Expected output: All 8 connectors + dashboard showing `(healthy)` status after ~40 seconds.

### Access Dashboard

Open browser to: **http://localhost:8080**

The dashboard will visualize the hierarchical network structure with all 8 nodes and their connections.

### Stop the Network

```bash
docker-compose -f docker-compose-complex.yml down
```

## Configuration Files

| File            | Node ID  | Port | Role              | Peers |
| --------------- | -------- | ---- | ----------------- | ----- |
| `hub-1.yaml`    | hub-1    | 3000 | Hub (cluster 1)   | hub-2 |
| `hub-2.yaml`    | hub-2    | 3001 | Hub (cluster 2)   | hub-1 |
| `spoke-1a.yaml` | spoke-1a | 3002 | Spoke (cluster 1) | hub-1 |
| `spoke-1b.yaml` | spoke-1b | 3003 | Spoke (cluster 1) | hub-1 |
| `spoke-1c.yaml` | spoke-1c | 3004 | Spoke (cluster 1) | hub-1 |
| `spoke-2a.yaml` | spoke-2a | 3005 | Spoke (cluster 2) | hub-2 |
| `spoke-2b.yaml` | spoke-2b | 3006 | Spoke (cluster 2) | hub-2 |
| `spoke-2c.yaml` | spoke-2c | 3007 | Spoke (cluster 2) | hub-2 |

## Health Check Endpoints

Each connector exposes a health endpoint:

- **Hub-1**: http://localhost:9080/health
- **Hub-2**: http://localhost:9081/health
- **Spoke-1a**: http://localhost:9082/health
- **Spoke-1b**: http://localhost:9083/health
- **Spoke-1c**: http://localhost:9084/health
- **Spoke-2a**: http://localhost:9085/health
- **Spoke-2b**: http://localhost:9086/health
- **Spoke-2c**: http://localhost:9087/health
- **Dashboard**: http://localhost:8080 (web UI)

## Validation

To validate the topology configuration before deployment:

```bash
# Use topology validation script (requires implementation from Story 4.3 Task 9)
node tools/validate-topology.js --config-dir examples/complex-8-node/
```

Expected result: No disconnected nodes, all routes reachable, no circular dependencies.

## Use Cases

This topology demonstrates:

1. **Hierarchical Scaling**: Multi-level hub structure for large networks
2. **Inter-Hub Routing**: Hub-to-hub connections for cross-cluster communication
3. **Complex Routing**: Multi-hop routing paths (up to 4 hops)
4. **Cluster Isolation**: Logical grouping of nodes by hub affiliation
5. **Dashboard Flexibility**: Visualization of arbitrary complex topologies

## Troubleshooting

**Containers fail to start**:

- Ensure connector image is built: `docker images | grep ilp-connector`
- Check port conflicts: `lsof -i :3000-3007`

**Unhealthy containers**:

- Wait 40 seconds for BTP connections to establish
- Check logs for connection errors: `docker-compose -f docker-compose-complex.yml logs <service>`

**Dashboard not showing all nodes**:

- Verify all connectors are healthy: `docker-compose -f docker-compose-complex.yml ps`
- Check telemetry WebSocket connections in dashboard logs

## References

- [Configuration Schema Documentation](../../docs/configuration-schema.md)
- [Project README](../../README.md)
- [Hub-and-Spoke Topology](../hub-spoke-hub.yaml) (simpler example)
