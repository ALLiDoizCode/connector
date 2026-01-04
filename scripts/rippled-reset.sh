#!/bin/bash
#
# rippled-reset.sh
# Reset rippled state to clean ledger (stop, remove volume, restart)
#
# Description:
#   Completely resets the rippled ledger state by stopping the container, removing
#   the Docker volume containing ledger data, and restarting the container with a
#   fresh genesis ledger. All accounts, transactions, and ledger history will be lost.
#
# Usage:
#   ./scripts/rippled-reset.sh
#
# Requirements:
#   - docker-compose must be installed
#   - User must have Docker permissions
#
# Development Notes:
#   - This operation is DESTRUCTIVE and IRREVERSIBLE
#   - All test accounts and transaction history will be lost
#   - Use this when ledger state becomes corrupted or for clean testing
#   - After reset, ledger starts at index 1 (genesis ledger)

set -e

# Project root directory (one level up from scripts/)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose-dev.yml"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "WARNING: This will DELETE all rippled ledger data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "This operation will:"
echo "  • Stop the rippled container"
echo "  • Remove the rippled_data Docker volume"
echo "  • Restart rippled with a clean genesis ledger"
echo ""
echo "All of the following will be LOST:"
echo "  • All test accounts and balances"
echo "  • All transaction history"
echo "  • All ledger state"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Reset cancelled"
  exit 0
fi

echo ""
echo "Step 1/3: Stopping rippled container..."
docker-compose -f "$COMPOSE_FILE" stop rippled

echo "Step 2/3: Removing rippled_data volume..."
# Volume name includes project prefix (m2m_)
docker volume rm m2m_rippled_data 2>/dev/null || true

echo "Step 3/3: Starting rippled with clean state..."
docker-compose -f "$COMPOSE_FILE" up -d rippled

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ rippled reset complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Ledger state cleared. rippled is starting with genesis ledger."
echo ""
echo "Wait for rippled to become healthy (~15 seconds):"
echo "  docker ps --filter name=rippled_standalone"
echo ""
echo "Next steps:"
echo "  1. Create test accounts: ./scripts/rippled-create-account.sh"
echo "  2. Fund accounts: ./scripts/rippled-fund-account.sh <address> <amount>"
echo "  3. Advance ledger: ./scripts/rippled-advance-ledger.sh"
echo ""
