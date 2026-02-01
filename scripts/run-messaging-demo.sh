#!/bin/bash
# ILP Private Messaging Demo Runner (Epic 32)
#
# NIP-59 giftwrap encrypted messaging with multi-hop ILP routing
# Shows: Alice (Browser) → Facilitator → Connector1 → Connector2 → Bob Agent
#
# Uses public Aptos Testnet with M2M tokens for settlement
# Requires: testnet-wallets.json with funded Aptos wallet
#
# Usage:
#   ./scripts/run-messaging-demo.sh
#   ./scripts/run-messaging-demo.sh stop   # Stop and cleanup
#   LOG_LEVEL=debug ./scripts/run-messaging-demo.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
LOG_LEVEL=${LOG_LEVEL:-info}
COMPOSE_FILE="docker-compose-messaging-demo.yml"

# M2M Token Configuration from testnet-wallets.json
APTOS_MODULE_ADDRESS="${APTOS_MODULE_ADDRESS:-0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a}"
APTOS_COIN_TYPE="${APTOS_COIN_TYPE:-0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a::m2m_token::M2M}"
export APTOS_MODULE_ADDRESS APTOS_COIN_TYPE

# Handle stop command
if [ "$1" == "stop" ]; then
    echo -e "${YELLOW}Stopping Epic 32 Private Messaging Demo...${NC}"
    docker compose -f "$COMPOSE_FILE" down -v
    echo -e "${GREEN}Demo stopped and cleaned up.${NC}"
    exit 0
fi

echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}🔒 Epic 32: Private Messaging Demo${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo ""
echo "Network Topology:"
echo -e "  ${GREEN}Alice${NC} (Browser - Client-side encryption)"
echo "      ↓ HTTPS"
echo -e "  ${GREEN}Facilitator${NC} (X402 Gateway + Messaging Gateway)"
echo "      ↓ ILP/BTP"
echo -e "  ${GREEN}Connector 1${NC} (Routing Hop - Privacy Layer)"
echo "      ↓ ILP/BTP"
echo -e "  ${GREEN}Connector 2${NC} (Routing Hop - Privacy Layer)"
echo "      ↓ ILP/BTP"
echo -e "  ${GREEN}Bob Agent${NC} (Message Receiver)"
echo "      ↓ WebSocket"
echo -e "  ${GREEN}Bob${NC} (Browser - Client-side decryption)"
echo ""
echo "Features:"
echo "  🔐 Client-side NIP-59 giftwrap encryption (3 layers)"
echo "  🛡️  Privacy-preserving routing (ephemeral keys)"
echo "  💰 ILP payments for message delivery (300 msat)"
echo "  ⚡ Automatic settlement on Aptos public testnet"
echo "  📊 Real-time routing visualization"
echo ""
echo "Configuration:"
echo "  Log Level: $LOG_LEVEL"
echo "  Settlement: Aptos Public Testnet (M2M tokens)"
echo "  Module: $APTOS_MODULE_ADDRESS"
echo "  Message Cost: 300 msat (~\$0.03 USD)"
echo ""

# Prerequisites check
echo -e "${YELLOW}[Checking Prerequisites]${NC}"

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running${NC}"
    echo "   Please start Docker Desktop and try again"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker: Running"

# Check docker-compose
if ! docker compose version > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: docker-compose not found${NC}"
    echo "   Please install Docker Compose v2.24+"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} docker-compose: $(docker compose version --short)"

# Check Node.js
if ! node --version > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Node.js not found${NC}"
    echo "   Please install Node.js 20.11.0 LTS or higher"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "  ${GREEN}✓${NC} Node.js: $NODE_VERSION"

echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Step 1: Build explorer UI first (includes private messenger UI)
echo -e "${YELLOW}[Step 1/6] Building Explorer UI (Private Messenger)...${NC}"
if [ ! -d "packages/connector/dist/explorer-ui" ]; then
    echo "  Building React app with private messenger components..."
    npm run build:explorer-ui -w @m2m/connector
else
    echo "  Explorer UI already built (skipping rebuild)"
fi

# Step 2: Build Docker images
echo -e "${YELLOW}[Step 2/6] Building Docker images...${NC}"
docker compose -f "$COMPOSE_FILE" build

# Step 3: Stop existing containers
echo -e "${YELLOW}[Step 3/6] Stopping existing containers...${NC}"
docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true

# Step 4: Start services (sequential startup with health checks)
echo -e "${YELLOW}[Step 4/6] Starting services...${NC}"

# Verify Aptos testnet connectivity
echo -n "  Verifying Aptos testnet: "
if curl -sf https://fullnode.testnet.aptoslabs.com/v1 > /dev/null 2>&1; then
    echo -e "${GREEN}reachable${NC}"
else
    echo -e "${RED}unreachable${NC}"
    echo -e "${RED}Error: Cannot reach Aptos testnet. Check your internet connection.${NC}"
    exit 1
fi

# Start Bob Agent (message receiver)
echo "  Starting Bob Agent..."
docker compose -f "$COMPOSE_FILE" up -d bob-agent

echo -n "  Waiting for Bob Agent: "
for i in {1..30}; do
    if curl -sf http://localhost:8203/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC} (${i}s)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs bob-agent
        exit 1
    fi
    echo -n "."
    sleep 1
done

# Start Connector 2
echo "  Starting Connector 2..."
docker compose -f "$COMPOSE_FILE" up -d connector2

echo -n "  Waiting for Connector 2: "
for i in {1..30}; do
    if curl -sf http://localhost:8202/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC} (${i}s)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs connector2
        exit 1
    fi
    echo -n "."
    sleep 1
done

# Start Connector 1
echo "  Starting Connector 1..."
docker compose -f "$COMPOSE_FILE" up -d connector1

echo -n "  Waiting for Connector 1: "
for i in {1..30}; do
    if curl -sf http://localhost:8201/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC} (${i}s)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs connector1
        exit 1
    fi
    echo -n "."
    sleep 1
done

# Start Facilitator (X402 + Messaging Gateway)
echo "  Starting Facilitator..."
docker compose -f "$COMPOSE_FILE" up -d facilitator

echo -n "  Waiting for Facilitator: "
for i in {1..30}; do
    # Check both facilitator API and messaging gateway API
    if curl -sf http://localhost:3001/health > /dev/null 2>&1 && \
       curl -sf http://localhost:3002/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC} (${i}s)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs facilitator
        exit 1
    fi
    echo -n "."
    sleep 1
done

# Start Explorer UI (Private Messenger UI)
echo "  Starting Explorer UI..."
docker compose -f "$COMPOSE_FILE" up -d explorer-ui

sleep 3

# Step 5: Fund agents with M2M tokens
echo -e "${YELLOW}[Step 5/6] Funding agents with M2M tokens...${NC}"

# Check if testnet-wallets.json exists
if [ -f "testnet-wallets.json" ]; then
    echo "  Found testnet-wallets.json"

    # Build TypeScript if needed
    if [ ! -f "packages/connector/dist/test/docker-agent-test-runner.js" ]; then
        echo "  Building TypeScript for funding..."
        npm run build:connector-only -w @m2m/connector 2>/dev/null || true
    fi

    # Get agent Aptos addresses and fund them
    echo "  Querying agent Aptos addresses..."
    for service in bob-agent connector2 connector1 facilitator; do
        port=$(case $service in
            bob-agent) echo 8203;;
            connector2) echo 8202;;
            connector1) echo 8201;;
            facilitator) echo 8200;;
        esac)

        APTOS_ADDR=$(curl -sf "http://localhost:$port/status" 2>/dev/null | grep -o '"aptosAddress":"[^"]*"' | cut -d'"' -f4 || echo "")
        if [ -n "$APTOS_ADDR" ]; then
            echo "    $service: $APTOS_ADDR"
        else
            echo "    $service: (no Aptos address)"
        fi
    done

    echo ""
    echo -e "  ${YELLOW}Note: To fund agents with M2M tokens, run:${NC}"
    echo "    npm run test:docker-agent -w @m2m/connector"
    echo "  Or manually transfer M2M tokens to the addresses above."
else
    echo -e "  ${YELLOW}Warning: testnet-wallets.json not found${NC}"
    echo "  Agents will not have M2M tokens for settlement."
    echo "  Run ./scripts/run-docker-agent-test.sh first to set up wallets."
fi

# Step 6: Setup and display summary
echo -e "${YELLOW}[Step 6/6] Verifying configuration...${NC}"

# Verify all services healthy
echo -n "  Health check: "
ALL_HEALTHY=true

for service in bob-agent connector2 connector1 facilitator; do
    if ! docker compose -f "$COMPOSE_FILE" ps "$service" | grep -q "healthy"; then
        echo -e "${RED}$service unhealthy${NC}"
        ALL_HEALTHY=false
    fi
done

if [ "$ALL_HEALTHY" = true ]; then
    echo -e "${GREEN}all services healthy${NC}"
else
    echo -e "${RED}Some services are unhealthy. Check logs:${NC}"
    echo "  docker compose -f $COMPOSE_FILE logs"
    exit 1
fi

# Note: Startup complete

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Demo is Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}🚀 Access Points:${NC}"
echo -e "  ${CYAN}Explorer UI (Alice):${NC}  http://localhost:5173/messenger"
echo -e "  ${CYAN}Bob's UI:${NC}             http://localhost:5174/messenger?user=bob"
echo -e "  ${CYAN}Gateway API:${NC}          http://localhost:3002"
echo ""
echo -e "${CYAN}📊 Network Monitoring (Explorer UIs):${NC}"
echo -e "  ${CYAN}Facilitator:${NC}          http://localhost:9200"
echo -e "  ${CYAN}Connector 1:${NC}          http://localhost:9201"
echo -e "  ${CYAN}Connector 2:${NC}          http://localhost:9202"
echo -e "  ${CYAN}Bob Agent:${NC}            http://localhost:9203"
echo ""
echo -e "${CYAN}📖 Documentation:${NC}"
echo -e "  ${CYAN}Demo Guide:${NC}           docs/demos/epic-32-demo-script.md"
echo -e "  ${CYAN}5-Minute Demo:${NC}        Follow the narrated walkthrough"
echo ""
echo -e "${MAGENTA}🎬 Quick Start:${NC}"
echo "  1. Open http://localhost:5173/messenger in your browser"
echo "  2. Click 'Generate New Key' in Key Manager (first time only)"
echo "  3. Type a message: 'Hey Bob, confidential project update!'"
echo "  4. Click 'Send Encrypted' button"
echo "  5. Watch real-time encryption status and routing visualization"
echo "  6. Open Bob's view in second tab: http://localhost:5174/messenger?user=bob"
echo "  7. See the decrypted message in Bob's chat history"
echo ""
echo -e "${CYAN}💡 Key Features:${NC}"
echo "  🔒 Client-side NIP-59 encryption (3 layers: rumor → seal → giftwrap)"
echo "  🎭 Ephemeral keys hide sender identity from connectors"
echo "  💰 ILP payments: 300 msat per message (~\$0.03 USD)"
echo "  ⚡ Auto-settlement on Aptos public testnet with M2M tokens"
echo "  📈 Real-time routing visualization with cost breakdown"
echo ""
echo -e "${YELLOW}⚙️  Management Commands:${NC}"
echo "  Stop demo:        ./scripts/run-messaging-demo.sh stop"
echo "  View logs:        docker compose -f $COMPOSE_FILE logs -f [service]"
echo "  Restart service:  docker compose -f $COMPOSE_FILE restart [service]"
echo ""
echo -e "${CYAN}🐛 Troubleshooting:${NC}"
echo "  Gateway error?    Check: docker compose -f $COMPOSE_FILE logs facilitator"
echo "  Key not found?    Click 'Generate New Key' in browser UI"
echo "  Message timeout?  Verify WebSocket: ws://localhost:3003 (status indicator)"
echo "  No M2M tokens?    Run docker-agent-test first, or fund manually"
echo "  Settlement?       Check https://explorer.aptoslabs.com/?network=testnet"
echo ""

# Optionally follow logs (can Ctrl+C to exit)
read -p "Follow logs now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Following logs (Ctrl+C to exit and return to shell)...${NC}"
    docker compose -f "$COMPOSE_FILE" logs -f
fi
