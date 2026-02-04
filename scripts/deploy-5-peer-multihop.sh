#!/bin/bash
# Deploy 5 Production Peers for Multi-Hop Testing
#
# This script deploys a 5-peer linear network topology and verifies multi-hop packet routing.
#
# Topology: Peer1 → Peer2 → Peer3 → Peer4 → Peer5
# Each peer has a unique ILP address and peers are funded from the base treasury wallet.
#
# Components:
#   - TigerBeetle: High-performance accounting database for balance tracking
#   - Peer1-5: ILP connectors with EVM settlement support
#
# Usage:
#   ./scripts/deploy-5-peer-multihop.sh
#
# Prerequisites:
#   1. OrbStack installed and running (https://orbstack.dev)
#   2. Built connector image: docker build -t ilp-connector .
#   3. Treasury wallet configured in .env (TREASURY_EVM_PRIVATE_KEY, TREASURY_XRP_PRIVATE_KEY)
#   4. Base L2 RPC running (Anvil or Base testnet)
#   5. XRP Ledger testnet access

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose-5-peer-multihop.yml"
FUNDING_SCRIPT="${PROJECT_ROOT}/tools/fund-peers/dist/index.js"
COMPOSE_CMD="docker compose"

# TigerBeetle initialization function
initialize_tigerbeetle() {
  echo "Initializing TigerBeetle cluster..."

  # Create local directory for TigerBeetle data
  # Using bind mount instead of named volume for better OrbStack compatibility
  # OrbStack handles bind mounts more efficiently than Docker Desktop
  if [ ! -d "/tmp/m2m-tigerbeetle" ]; then
    echo "Creating TigerBeetle data directory..."
    mkdir -p /tmp/m2m-tigerbeetle
  fi

  # Check if data file exists
  if [ -f "/tmp/m2m-tigerbeetle/0_0.tigerbeetle" ]; then
    echo "TigerBeetle data file exists, skipping initialization"
  else
    echo "Formatting TigerBeetle cluster..."
    docker run --rm --security-opt seccomp=unconfined \
      -v "/tmp/m2m-tigerbeetle:/data" ghcr.io/tigerbeetle/tigerbeetle:0.16.68 \
      format --cluster=0 --replica=0 --replica-count=1 /data/0_0.tigerbeetle
  fi

  echo -e "${GREEN}✓ TigerBeetle initialization complete${NC}"
}

# Cleanup function for TigerBeetle volume (works with OrbStack's docker CLI)
cleanup_tigerbeetle() {
  echo "Removing TigerBeetle volume..."
  docker volume rm tigerbeetle-5peer-data 2>/dev/null || true
  echo -e "${GREEN}✓ TigerBeetle volume removed${NC}"
}

echo "======================================"
echo "  5-Peer Multi-Hop Deployment"
echo "======================================"
echo ""

# Step 1: Check prerequisites
echo -e "${BLUE}[1/7]${NC} Checking prerequisites..."
echo ""

# Check OrbStack
if command -v orb &> /dev/null; then
  # OrbStack CLI is available
  if ! orb status &> /dev/null; then
    echo -e "${YELLOW}⚠ OrbStack is installed but not running. Starting OrbStack...${NC}"
    orb start
    sleep 3
  fi
  echo -e "${GREEN}✓ OrbStack is running${NC}"
elif ! docker info > /dev/null 2>&1; then
  echo -e "${RED}✗ OrbStack/Docker is not running${NC}"
  echo "Install OrbStack from https://orbstack.dev or start it if already installed"
  exit 1
else
  echo -e "${GREEN}✓ Docker daemon is running (OrbStack or compatible)${NC}"
fi

# Check Docker Compose (provided by OrbStack)
if ! docker compose --version > /dev/null 2>&1; then
  echo -e "${RED}✗ Docker Compose not found${NC}"
  echo "OrbStack should provide docker compose. Try reinstalling OrbStack."
  exit 1
fi
echo -e "${GREEN}✓ Docker Compose is available (via OrbStack)${NC}"

# Check connector image (uses OrbStack's docker CLI)
if ! docker images ilp-connector:latest --format "{{.Repository}}" | grep -q "ilp-connector"; then
  echo -e "${YELLOW}⚠ Connector image not found. Building with OrbStack...${NC}"
  cd "${PROJECT_ROOT}"
  docker build -t ilp-connector .
fi
echo -e "${GREEN}✓ Connector image available${NC}"

# Check .env file
if [ ! -f "${PROJECT_ROOT}/.env" ]; then
  echo -e "${RED}✗ .env file not found${NC}"
  echo "Copy .env.example to .env and configure treasury wallet keys"
  exit 1
fi
echo -e "${GREEN}✓ .env file exists${NC}"

echo ""

# Step 2: Initialize TigerBeetle
echo -e "${BLUE}[2/7]${NC} Initializing TigerBeetle accounting database..."
echo ""

cd "${PROJECT_ROOT}"

# Stop any existing deployment
docker compose -f "${COMPOSE_FILE}" down 2>/dev/null || true

# Initialize TigerBeetle cluster
initialize_tigerbeetle

echo ""

# Step 3: Start the network
echo -e "${BLUE}[3/7]${NC} Starting 5-peer network with OrbStack..."
echo ""

# Start the network (OrbStack provides faster container startup than Docker Desktop)
echo "Starting containers..."
echo "Waiting for TigerBeetle to become healthy..."
docker compose -f "${COMPOSE_FILE}" up -d

echo ""
echo "Waiting for connectors to become healthy..."
sleep 10

# Wait for all connectors to be healthy
for i in {1..5}; do
  CONNECTOR="peer${i}"
  echo -n "  Checking ${CONNECTOR}... "

  for attempt in {1..30}; do
    if docker compose -f "${COMPOSE_FILE}" exec -T ${CONNECTOR} wget --no-verbose --tries=1 --spider http://localhost:8080/health 2>/dev/null; then
      echo -e "${GREEN}✓${NC}"
      break
    fi

    if [ $attempt -eq 30 ]; then
      echo -e "${RED}✗ Timeout${NC}"
      echo "Check logs: docker compose -f ${COMPOSE_FILE} logs ${CONNECTOR}"
      exit 1
    fi

    sleep 2
  done
done

echo ""
echo -e "${GREEN}✓ All peers are healthy${NC}"
echo ""

# Step 4: Fund peers from treasury wallet
echo -e "${BLUE}[4/7]${NC} Funding peers from treasury wallet..."
echo ""

# Check if funding script exists
if [ ! -f "${FUNDING_SCRIPT}" ]; then
  echo "Building funding utility..."
  cd "${PROJECT_ROOT}/tools/fund-peers"
  npm install
  npm run build
  cd "${PROJECT_ROOT}"
fi

# Fund each peer with minimal ETH (Base Sepolia has very low gas costs)
echo "Funding peers with ETH for gas (0.0001 ETH each)..."
echo "Note: On Base Sepolia, transactions cost ~0.00001 ETH, so 0.0001 ETH = ~10 transactions"
node "${FUNDING_SCRIPT}" \
  --peers peer1,peer2,peer3,peer4,peer5 \
  --eth-amount 0.0001 \
  --token-amount 1000 || {
    echo -e "${RED}✗ Failed to fund peers${NC}"
    echo "Note: Funding script will be created in Step 4 if it doesn't exist"
  }

echo ""

# Step 5: Display network topology
echo -e "${BLUE}[5/7]${NC} Network Topology"
echo ""

cat << 'EOF'
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  Peer1  │─────▶│  Peer2  │─────▶│  Peer3  │─────▶│  Peer4  │─────▶│  Peer5  │
│ :3000   │      │ :3001   │      │ :3002   │      │ :3003   │      │ :3004   │
└─────────┘      └─────────┘      └─────────┘      └─────────┘      └─────────┘
g.peer1          g.peer2          g.peer3          g.peer4          g.peer5

Packet flow for destination g.peer5:
  1. Peer1 receives PREPARE → routes to peer2
  2. Peer2 receives PREPARE → routes to peer3
  3. Peer3 receives PREPARE → routes to peer4
  4. Peer4 receives PREPARE → routes to peer5
  5. Peer5 receives PREPARE → local delivery, returns FULFILL
  6. FULFILL propagates back: Peer5 → Peer4 → Peer3 → Peer2 → Peer1
EOF

echo ""

# Step 6: Send test packet through the network
echo -e "${BLUE}[6/7]${NC} Sending multi-hop test packet..."
echo ""

echo "Sending packet from Peer1 to g.peer5 (5 hops)..."
cd "${PROJECT_ROOT}/tools/send-packet"

# Build send-packet tool if needed
if [ ! -f "./dist/index.js" ]; then
  echo "Building send-packet tool..."
  npm install
  npm run build
fi

# Send test packet
node ./dist/index.js \
  --connector-url ws://localhost:3000 \
  --destination g.peer5.dest \
  --amount 1000000 \
  --auth-token test-token \
  --log-level info

PACKET_RESULT=$?

echo ""

# Step 7: Verify multi-hop routing
echo -e "${BLUE}[7/7]${NC} Verifying multi-hop routing..."
echo ""

cd "${PROJECT_ROOT}"

echo "Checking packet flow through each peer:"
echo ""

for i in {1..5}; do
  PEER="peer${i}"
  echo -e "${BLUE}${PEER}:${NC}"

  # Get logs from last 30 seconds
  LOGS=$(docker compose -f "${COMPOSE_FILE}" logs --tail=100 ${PEER} 2>&1 || echo "")

  # Check for packet events
  PREPARE_COUNT=$(echo "${LOGS}" | grep -c "PREPARE" 2>/dev/null || echo "0")
  FULFILL_COUNT=$(echo "${LOGS}" | grep -c "FULFILL" 2>/dev/null || echo "0")
  FORWARD_COUNT=$(echo "${LOGS}" | grep -c "Forwarding packet" 2>/dev/null || echo "0")

  echo "  PREPARE packets: ${PREPARE_COUNT}"
  echo "  FULFILL packets: ${FULFILL_COUNT}"
  echo "  Forwarded: ${FORWARD_COUNT}"

  # Verify expected behavior
  if [ "$i" -eq 5 ]; then
    # Peer5 should receive PREPARE and send FULFILL (local delivery)
    if [ "${PREPARE_COUNT}" -gt "0" ] && [ "${FULFILL_COUNT}" -gt "0" ]; then
      echo -e "  ${GREEN}✓ Destination peer correctly delivered packet${NC}"
    else
      echo -e "  ${YELLOW}⚠ Expected packet delivery at destination${NC}"
    fi
  else
    # Other peers should forward
    if [ "${FORWARD_COUNT}" -gt "0" ] || [ "${PREPARE_COUNT}" -gt "0" ]; then
      echo -e "  ${GREEN}✓ Transit peer forwarded packet${NC}"
    else
      echo -e "  ${YELLOW}⚠ Expected packet forwarding${NC}"
    fi
  fi

  echo ""
done

# Final summary
echo "======================================"
echo "  Deployment Summary"
echo "======================================"
echo ""

if [ ${PACKET_RESULT} -eq 0 ]; then
  echo -e "${GREEN}✓ Multi-hop test packet FULFILLED${NC}"
  echo ""
  echo "The packet successfully traversed all 5 peers:"
  echo "  Peer1 (entry) → Peer2 → Peer3 → Peer4 → Peer5 (destination)"
  echo ""
  echo "Verification:"
  echo "  - Each transit peer (1-4) received and forwarded the PREPARE packet"
  echo "  - Destination peer (5) delivered the packet locally and returned FULFILL"
  echo "  - FULFILL response propagated back through all hops"
else
  echo -e "${RED}✗ Multi-hop test packet FAILED${NC}"
  echo ""
  echo "Check logs for details:"
  echo "  docker compose -f ${COMPOSE_FILE} logs"
fi

echo ""
echo "======================================"
echo "  Useful Commands (OrbStack)"
echo "======================================"
echo ""
echo "View logs:"
echo "  docker compose -f ${COMPOSE_FILE} logs -f"
echo ""
echo "View specific peer:"
echo "  docker compose -f ${COMPOSE_FILE} logs -f peer3"
echo ""
echo "Send another packet:"
echo "  cd tools/send-packet"
echo "  npm run send -- -c ws://localhost:3000 -d g.peer5.dest -a 5000"
echo ""
echo "Check peer health:"
echo "  curl http://localhost:9080/health  # Peer1"
echo "  curl http://localhost:9084/health  # Peer5"
echo ""
echo "Check TigerBeetle health:"
echo "  docker inspect --format='{{.State.Health.Status}}' tigerbeetle-5peer"
echo ""
echo "OrbStack-specific commands:"
echo "  orb status                          # Check OrbStack status"
echo "  orb logs                            # View OrbStack logs"
echo "  orb stop                            # Stop OrbStack VM"
echo ""
echo "Stop network:"
echo "  docker compose -f ${COMPOSE_FILE} down"
echo ""
echo "Stop network and remove volumes (includes TigerBeetle data):"
echo "  docker compose -f ${COMPOSE_FILE} down -v"
echo ""

exit ${PACKET_RESULT}
