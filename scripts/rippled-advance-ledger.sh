#!/bin/bash
#
# rippled-advance-ledger.sh
# Manually advance rippled ledger by one step
#
# Description:
#   In standalone mode, rippled does NOT automatically close ledgers. Transactions
#   submitted to rippled stay PENDING until the ledger_accept RPC method is called.
#   This script advances the ledger by one step, confirming all pending transactions.
#
# Usage:
#   ./scripts/rippled-advance-ledger.sh
#
# Requirements:
#   - rippled container must be running (docker-compose -f docker-compose-dev.yml up -d rippled)
#   - curl must be installed
#
# Development Notes:
#   - Call this script after submitting transactions to confirm them
#   - Alternatively, use --profile auto-ledger to advance ledgers automatically every 5 seconds
#   - Each call advances the ledger index by 1

set -e

# rippled JSON-RPC endpoint
RIPPLED_URL="http://localhost:5005"

# Send ledger_accept RPC request
echo "Advancing rippled ledger..."
RESPONSE=$(curl -s -X POST "$RIPPLED_URL" \
  -H "Content-Type: application/json" \
  --data '{"method":"ledger_accept","params":[]}')

# Check if request succeeded
if echo "$RESPONSE" | grep -q '"status":"success"'; then
  # Extract ledger index from response
  LEDGER_INDEX=$(echo "$RESPONSE" | grep -o '"ledger_current_index":[0-9]*' | grep -o '[0-9]*')
  echo "✓ Ledger advanced successfully (current index: $LEDGER_INDEX)"
else
  echo "✗ Failed to advance ledger"
  echo "Response: $RESPONSE"
  exit 1
fi
