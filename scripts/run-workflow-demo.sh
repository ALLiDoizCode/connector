#!/bin/bash
# ILP Workflow Demo Runner
#
# Multi-hop image processing workflow demonstration
# Shows Client → Facilitator → Connector1 → Connector2 → Workflow Peer
#
# Usage:
#   ./scripts/run-workflow-demo.sh
#   LOG_LEVEL=debug ./scripts/run-workflow-demo.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
LOG_LEVEL=${LOG_LEVEL:-info}
COMPOSE_FILE="docker-compose-workflow-demo.yml"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}ILP Workflow Image Processing Demo${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo "Network Topology:"
echo -e "  ${GREEN}Client UI${NC} (Browser)"
echo "      ↓ HTTP"
echo -e "  ${GREEN}Facilitator${NC} (X402 Gateway)"
echo "      ↓ ILP/BTP"
echo -e "  ${GREEN}Connector 1${NC} (Routing Hop)"
echo "      ↓ ILP/BTP"
echo -e "  ${GREEN}Connector 2${NC} (Routing Hop)"
echo "      ↓ ILP/BTP"
echo -e "  ${GREEN}Workflow Peer${NC} (Image Processing)"
echo ""
echo "Configuration:"
echo "  Log Level: $LOG_LEVEL"
echo "  Local Settlement: Aptos (local testnet)"
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running${NC}"
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Step 1: Build explorer UI first
echo -e "${YELLOW}[Step 1/5] Building Explorer UI...${NC}"
if [ ! -d "packages/connector/dist/explorer-ui" ]; then
    echo "  Building React app..."
    npm run build:explorer-ui -w @m2m/connector
else
    echo "  Explorer UI already built (skipping)"
fi

# Step 2: Build Docker images
echo -e "${YELLOW}[Step 2/5] Building Docker images...${NC}"
docker compose -f "$COMPOSE_FILE" build

# Step 3: Stop existing containers
echo -e "${YELLOW}[Step 3/5] Stopping existing containers...${NC}"
docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true

# Step 4: Start services
echo -e "${YELLOW}[Step 4/5] Starting services...${NC}"

# Start Anvil first
echo "  Starting Aptos local testnet..."
docker compose -f "$COMPOSE_FILE" up -d anvil

echo -n "  Waiting for Anvil: "
for i in {1..30}; do
    if curl -sf http://localhost:8545/v1 > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs anvil
        exit 1
    fi
    sleep 1
done

# Start workflow peer
echo "  Starting Workflow Peer..."
docker compose -f "$COMPOSE_FILE" up -d workflow-peer

echo -n "  Waiting for Workflow Peer: "
for i in {1..30}; do
    if curl -sf http://localhost:8203/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs workflow-peer
        exit 1
    fi
    sleep 1
done

# Start connector-2
echo "  Starting Connector 2..."
docker compose -f "$COMPOSE_FILE" up -d connector-2

echo -n "  Waiting for Connector 2: "
for i in {1..30}; do
    if curl -sf http://localhost:8202/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs connector-2
        exit 1
    fi
    sleep 1
done

# Start connector-1
echo "  Starting Connector 1..."
docker compose -f "$COMPOSE_FILE" up -d connector-1

echo -n "  Waiting for Connector 1: "
for i in {1..30}; do
    if curl -sf http://localhost:8201/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs connector-1
        exit 1
    fi
    sleep 1
done

# Start facilitator
echo "  Starting Facilitator..."
docker compose -f "$COMPOSE_FILE" up -d facilitator

echo -n "  Waiting for Facilitator: "
for i in {1..30}; do
    if curl -sf http://localhost:3001/api/services > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}TIMEOUT${NC}"
        docker compose -f "$COMPOSE_FILE" logs facilitator
        exit 1
    fi
    sleep 1
done

# Start client UI
echo "  Starting Client UI..."
docker compose -f "$COMPOSE_FILE" up -d client-ui

sleep 3

# Step 5: Setup payment channels and routes
echo -e "${YELLOW}[Step 5/5] Configuring ILP network...${NC}"

# Build setup script if needed
if [ ! -f "packages/connector/dist/workflow/setup-network.js" ]; then
    echo "  Building TypeScript..."
    npm run build:connector-only -w @m2m/connector
fi

# Run network setup
echo "  Establishing payment channels..."
echo "  Setting up routes..."
node packages/connector/dist/workflow/setup-network.js

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Demo is Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Access Points:"
echo -e "  ${CYAN}Client UI:${NC}         http://localhost:3000"
echo -e "  ${CYAN}Facilitator API:${NC}   http://localhost:3001"
echo ""
echo "Explorer UIs (Network Monitoring):"
echo -e "  ${CYAN}Facilitator:${NC}       http://localhost:9200"
echo -e "  ${CYAN}Connector 1:${NC}       http://localhost:9201"
echo -e "  ${CYAN}Connector 2:${NC}       http://localhost:9202"
echo -e "  ${CYAN}Workflow Peer:${NC}     http://localhost:9203"
echo ""
echo "Demo Instructions:"
echo "  1. Open http://localhost:3000 in your browser"
echo "  2. Upload an image (PNG or JPEG, max 10MB)"
echo "  3. Select processing options (resize, watermark, optimize)"
echo "  4. Click 'Process Image' to initiate workflow"
echo "  5. Watch the payment route through 3 hops in Explorer UIs"
echo "  6. Download your processed image!"
echo ""
echo "To stop the demo:"
echo "  docker compose -f $COMPOSE_FILE down -v"
echo ""
echo "To view logs:"
echo "  docker compose -f $COMPOSE_FILE logs -f [service-name]"
echo ""

# Follow logs
echo -e "${YELLOW}Following logs (Ctrl+C to exit)...${NC}"
docker compose -f "$COMPOSE_FILE" logs -f
