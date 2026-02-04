# Multi-Hop ILP Network - Quick Start

Deploy and test a 5-peer ILP network with multi-hop packet routing in minutes.

## TL;DR

```bash
# 1. Build the connector
docker build -t ilp-connector .

# 2. Configure environment
cp .env.example .env
# Edit .env and set TREASURY_EVM_PRIVATE_KEY

# 3. Deploy and test
./scripts/deploy-5-peer-multihop.sh
```

## What Gets Deployed

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  Peer1  │─────▶│  Peer2  │─────▶│  Peer3  │─────▶│  Peer4  │─────▶│  Peer5  │
│ :3000   │      │ :3001   │      │ :3002   │      │ :3003   │      │ :3004   │
└─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘
g.peer1          g.peer2          g.peer3          g.peer4          g.peer5
```

**5 ILP Connectors** running in Docker, each with:

- ✓ Unique ILP address (g.peer1 through g.peer5)
- ✓ Funded from treasury wallet with ETH and tokens
- ✓ BTP connections to adjacent peers
- ✓ Routing tables configured for multi-hop forwarding
- ✓ BTP off-chain claim exchange enabled (Epic 17)

## Prerequisites

1. **Docker & Docker Compose**

   ```bash
   docker --version  # 20.10+
   docker-compose --version  # 2.x
   ```

2. **Built Connector Image**

   ```bash
   docker build -t ilp-connector .
   ```

3. **Environment Configuration**

   Create `.env` file with:

   ```env
   TREASURY_EVM_PRIVATE_KEY=0x...  # Your treasury wallet key
   BASE_L2_RPC_URL=http://localhost:8545
   ```

   > **Optional:** Pre-generate peer addresses and add to `.env`:
   >
   > ```env
   > PEER1_EVM_ADDRESS=0x...
   > PEER2_EVM_ADDRESS=0x...
   > PEER3_EVM_ADDRESS=0x...
   > PEER4_EVM_ADDRESS=0x...
   > PEER5_EVM_ADDRESS=0x...
   > ```

## Quick Deploy

### Automated (Recommended)

The deployment script handles everything:

```bash
./scripts/deploy-5-peer-multihop.sh
```

**What it does:**

1. ✓ Checks prerequisites
2. ✓ Starts 5-peer network
3. ✓ Waits for peers to be healthy
4. ✓ Funds peers from treasury
5. ✓ Sends test packet through all 5 hops
6. ✓ Verifies multi-hop routing

**Expected output:**

```
======================================
  5-Peer Multi-Hop Deployment
======================================

[1/6] Checking prerequisites...
✓ Docker is running
✓ Docker Compose is available
✓ Connector image available
✓ .env file exists

[2/6] Starting 5-peer network...
Starting containers...
  Checking peer1... ✓
  Checking peer2... ✓
  Checking peer3... ✓
  Checking peer4... ✓
  Checking peer5... ✓

[3/6] Funding peers from treasury wallet...
Funding peers with ETH and ERC20 tokens...

[4/6] Network Topology
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  Peer1  │─────▶│  Peer2  │─────▶│  Peer3  │─────▶│  Peer4  │─────▶│  Peer5  │
│ :3000   │      │ :3001   │      │ :3002   │      │ :3003   │      │ :3004   │
└─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘

[5/6] Sending multi-hop test packet...
Sending packet from Peer1 to g.peer5 (5 hops)...
✓ Packet fulfilled

[6/6] Verifying multi-hop routing...
peer1:
  PREPARE packets: 1
  FULFILL packets: 1
  Forwarded: 1
  ✓ Transit peer forwarded packet

peer5:
  PREPARE packets: 1
  FULFILL packets: 1
  ✓ Destination peer correctly delivered packet

======================================
  Deployment Summary
======================================
✓ Multi-hop test packet FULFILLED

The packet successfully traversed all 5 peers:
  Peer1 (entry) → Peer2 → Peer3 → Peer4 → Peer5 (destination)
```

### Manual Deploy

If you prefer step-by-step control:

```bash
# 1. Start network
docker-compose -f docker-compose-5-peer-multihop.yml up -d

# 2. Wait for healthy
sleep 10

# 3. Fund peers
cd tools/fund-peers
npm install && npm run build
npm run fund -- --peers peer1,peer2,peer3,peer4,peer5

# 4. Send test packet
cd ../send-packet
npm install && npm run build
npm run send -- \
  -c ws://localhost:3000 \
  -d g.peer5.dest \
  -a 1000000
```

## Verify Multi-Hop Routing

### Check Logs

View all peers:

```bash
docker-compose -f docker-compose-5-peer-multihop.yml logs -f
```

View specific peer:

```bash
docker-compose -f docker-compose-5-peer-multihop.yml logs -f peer3
```

### Expected Packet Flow

When sending a packet to `g.peer5.dest`:

**Peer1** (Entry):

```json
{"msg":"Packet received","destination":"g.peer5.dest"}
{"msg":"Routing decision","nextHop":"peer2"}
{"msg":"Forwarding packet","peer":"peer2"}
```

**Peer3** (Middle):

```json
{"msg":"Packet received from peer","peer":"peer2"}
{"msg":"Routing decision","nextHop":"peer4"}
{"msg":"Forwarding packet","peer":"peer4"}
```

**Peer5** (Destination):

```json
{"msg":"Packet received from peer","peer":"peer4"}
{"msg":"Local delivery","destination":"g.peer5.dest"}
{"msg":"Packet fulfilled"}
```

## Common Operations

### Send Additional Packets

```bash
cd tools/send-packet

# Send to peer5
npm run send -- -c ws://localhost:3000 -d g.peer5.dest -a 5000

# Send to peer3 (3 hops)
npm run send -- -c ws://localhost:3000 -d g.peer3.dest -a 5000

# Send batch of 10 packets
npm run send -- -c ws://localhost:3000 -d g.peer5.dest -a 1000 --batch 10
```

### Check Peer Health

```bash
# Peer1
curl http://localhost:9080/health

# Peer5
curl http://localhost:9084/health
```

### View Network Status

```bash
docker-compose -f docker-compose-5-peer-multihop.yml ps
```

### Stop Network

```bash
docker-compose -f docker-compose-5-peer-multihop.yml down
```

### Restart Network

```bash
docker-compose -f docker-compose-5-peer-multihop.yml restart
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose-5-peer-multihop.yml logs peer2

# Check config
docker-compose -f docker-compose-5-peer-multihop.yml config
```

### BTP Connection Failed

```bash
# Verify network connectivity
docker exec peer2 ping peer1

# Check auth tokens in .env
grep BTP_PEER .env
```

### Packet Rejected

**Error: F02_UNREACHABLE**

- Check routing tables in config files
- Verify destination address format

**Error: T01_PEER_UNREACHABLE**

- Check peer is running: `docker-compose ps peer2`
- Verify BTP connection in logs

**Error: T04_INSUFFICIENT_LIQUIDITY**

- Fund peer wallets with more tokens
- Check payment channel balances

### Funding Failed

```bash
# Check treasury balance
cast balance <TREASURY_ADDRESS> --rpc-url http://localhost:8545

# Verify RPC connection
curl -X POST http://localhost:8545 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## Network Topology Details

### ILP Addresses

| Peer  | ILP Address | Role                              |
| ----- | ----------- | --------------------------------- |
| Peer1 | g.peer1     | Entry (receives external packets) |
| Peer2 | g.peer2     | Transit 1                         |
| Peer3 | g.peer3     | Transit 2 (middle)                |
| Peer4 | g.peer4     | Transit 3                         |
| Peer5 | g.peer5     | Exit (destination)                |

### BTP Connections

```
Peer1:3000 ←─── Peer2 (client)
Peer2:3001 ←─── Peer3 (client)
Peer3:3002 ←─── Peer4 (client)
Peer4:3003 ←─── Peer5 (client)
```

### Port Mappings

| Peer  | BTP Port | Health Check Port |
| ----- | -------- | ----------------- |
| Peer1 | 3000     | 9080              |
| Peer2 | 3001     | 9081              |
| Peer3 | 3002     | 9082              |
| Peer4 | 3003     | 9083              |
| Peer5 | 3004     | 9084              |
| Anvil | 8545     | -                 |

## Files and Scripts

### Deployment Files

- `scripts/deploy-5-peer-multihop.sh` - Automated deployment script
- `docker-compose-5-peer-multihop.yml` - Docker Compose configuration
- `examples/multihop-peer1.yaml` - Peer1 configuration
- `examples/multihop-peer2.yaml` - Peer2 configuration
- `examples/multihop-peer3.yaml` - Peer3 configuration
- `examples/multihop-peer4.yaml` - Peer4 configuration
- `examples/multihop-peer5.yaml` - Peer5 configuration

### Tools

- `tools/fund-peers/` - Fund peer wallets from treasury
- `tools/send-packet/` - Send test ILP packets

### Documentation

- `docs/guides/multi-hop-deployment.md` - Comprehensive deployment guide
- `MULTIHOP-QUICKSTART.md` - This quick start guide (you are here)

## Next Steps

- **Load Testing**: Send 1000s of packets to test performance

  ```bash
  npm run send -- -c ws://localhost:3000 -d g.peer5.dest -a 1000 --batch 1000
  ```

- **Monitoring**: Set up Prometheus/Grafana for real-time metrics

  ```bash
  docker-compose -f docker-compose-monitoring.yml up -d
  ```

- **Production Deployment**: See `docs/operators/production-deployment.md`

- **Security Hardening**: See `docs/operators/security-hardening-guide.md`

## Help

For detailed documentation, see:

- `docs/guides/multi-hop-deployment.md` - Full deployment guide
- `docs/architecture/high-level-architecture.md` - System architecture
- `docs/prd.md` - Product requirements

For issues or questions:

- Check logs: `docker-compose -f docker-compose-5-peer-multihop.yml logs`
- Open GitHub issue: https://github.com/yourusername/m2m/issues
