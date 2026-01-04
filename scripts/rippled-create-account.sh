#!/bin/bash
#
# rippled-create-account.sh
# Generate new XRP Ledger account with address and secret
#
# Description:
#   Creates a new XRP Ledger account by calling the wallet_propose RPC method.
#   Returns the account address (starts with 'r') and master seed (starts with 's')
#   for use in development and testing.
#
# Usage:
#   ./scripts/rippled-create-account.sh [passphrase]
#
# Parameters:
#   passphrase (optional) - Deterministic account generation from passphrase
#                          If omitted, random account is generated
#
# Example:
#   ./scripts/rippled-create-account.sh           # Random account
#   ./scripts/rippled-create-account.sh "test-1"  # Deterministic account from passphrase
#
# Requirements:
#   - rippled container must be running (docker-compose -f docker-compose-dev.yml up -d rippled)
#   - curl and jq must be installed
#
# Development Notes:
#   - Account is NOT funded automatically - use rippled-fund-account.sh to add XRP
#   - Save the master_seed securely - it's required for signing transactions
#   - In standalone mode, master seed can be used for all operations

set -e

# rippled JSON-RPC endpoint
RIPPLED_URL="http://localhost:5005"

# Optional passphrase parameter
PASSPHRASE="${1:-}"

echo "Generating new XRP Ledger account..."

# Build RPC request based on whether passphrase provided
if [ -z "$PASSPHRASE" ]; then
  # Random account generation
  REQUEST_DATA='{"method":"wallet_propose","params":[]}'
else
  # Deterministic account generation from passphrase
  REQUEST_DATA=$(cat <<EOF
{
  "method": "wallet_propose",
  "params": [
    {
      "passphrase": "$PASSPHRASE"
    }
  ]
}
EOF
)
fi

# Send wallet_propose RPC request
RESPONSE=$(curl -s -X POST "$RIPPLED_URL" \
  -H "Content-Type: application/json" \
  --data "$REQUEST_DATA")

# Check if request succeeded
if echo "$RESPONSE" | grep -q '"status":"success"'; then
  # Extract account details from response
  ACCOUNT_ID=$(echo "$RESPONSE" | grep -o '"account_id":"[^"]*"' | cut -d'"' -f4)
  MASTER_SEED=$(echo "$RESPONSE" | grep -o '"master_seed":"[^"]*"' | cut -d'"' -f4)
  PUBLIC_KEY=$(echo "$RESPONSE" | grep -o '"public_key":"[^"]*"' | cut -d'"' -f4)

  echo ""
  echo "✓ Account created successfully"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Account Address:  $ACCOUNT_ID"
  echo "Master Seed:      $MASTER_SEED"
  echo "Public Key:       $PUBLIC_KEY"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Next steps:"
  echo "  1. Fund account: ./scripts/rippled-fund-account.sh $ACCOUNT_ID [amount]"
  echo "  2. Advance ledger: ./scripts/rippled-advance-ledger.sh"
  echo "  3. Check balance: curl -X POST http://localhost:5005 -H 'Content-Type: application/json' --data '{\"method\":\"account_info\",\"params\":[{\"account\":\"$ACCOUNT_ID\"}]}'"
  echo ""
  echo "IMPORTANT: Save the master seed securely - it's required for signing transactions"
else
  echo "✗ Failed to create account"
  echo "Response: $RESPONSE"
  exit 1
fi
