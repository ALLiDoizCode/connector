#!/bin/bash
# Health Check Polling Script
#
# Waits for all Docker Compose services to become healthy.
# Used by: run-messaging-demo.sh, CI/CD workflows
#
# Usage:
#   ./scripts/wait-for-healthy.sh [timeout_seconds] [compose_file]
#
# Arguments:
#   timeout_seconds - Maximum wait time (default: 60)
#   compose_file    - Docker Compose file (default: docker-compose-messaging-demo.yml)
#
# Example:
#   ./scripts/wait-for-healthy.sh 120 docker-compose-messaging-demo.yml

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TIMEOUT=${1:-60}
COMPOSE_FILE=${2:-docker-compose-messaging-demo.yml}
POLL_INTERVAL=2  # Poll every 2 seconds

echo "Waiting for all services to be healthy..."
echo "  Timeout: ${TIMEOUT}s"
echo "  Compose file: $COMPOSE_FILE"
echo "  Poll interval: ${POLL_INTERVAL}s"
echo ""

# Calculate number of iterations
MAX_ITERATIONS=$((TIMEOUT / POLL_INTERVAL))

for i in $(seq 1 $MAX_ITERATIONS); do
    # Get status of all services
    SERVICE_STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null || echo "[]")

    # Check if all services are healthy
    UNHEALTHY_COUNT=$(echo "$SERVICE_STATUS" | jq -r '.[] | select(.Health != "healthy") | .Name' | wc -l)
    TOTAL_COUNT=$(echo "$SERVICE_STATUS" | jq -r '.[].Name' | wc -l)
    HEALTHY_COUNT=$((TOTAL_COUNT - UNHEALTHY_COUNT))

    if [ "$TOTAL_COUNT" -eq 0 ]; then
        echo -e "${RED}Error: No services found in $COMPOSE_FILE${NC}"
        exit 1
    fi

    # Display progress
    ELAPSED=$((i * POLL_INTERVAL))
    echo -ne "\r  Progress: ${HEALTHY_COUNT}/${TOTAL_COUNT} healthy (${ELAPSED}s elapsed)   "

    # Check if all healthy
    if [ "$UNHEALTHY_COUNT" -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓ All services healthy (${ELAPSED}s)${NC}"
        exit 0
    fi

    # Wait before next poll
    sleep "$POLL_INTERVAL"
done

# Timeout reached
echo ""
echo -e "${RED}✗ Timeout reached (${TIMEOUT}s)${NC}"
echo ""
echo "Unhealthy services:"
docker compose -f "$COMPOSE_FILE" ps --format json | jq -r '.[] | select(.Health != "healthy") | "  - \(.Name): \(.Health // "no health check")"'

echo ""
echo "Container logs:"
UNHEALTHY_SERVICES=$(docker compose -f "$COMPOSE_FILE" ps --format json | jq -r '.[] | select(.Health != "healthy") | .Name')

for service in $UNHEALTHY_SERVICES; do
    echo ""
    echo -e "${YELLOW}=== Logs for $service ===${NC}"
    docker compose -f "$COMPOSE_FILE" logs --tail=50 "$service"
done

exit 1
