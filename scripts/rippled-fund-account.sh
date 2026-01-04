#!/bin/bash
#
# rippled-fund-account.sh
# Fund a test account in standalone mode
#
# Description:
#   Funds an XRP Ledger account with the specified amount of XRP using a Payment
#   transaction. In standalone mode, this uses the master account to send XRP to
#   the target account. After funding, you must advance the ledger to confirm the
#   transaction.
#
# Usage:
#   ./scripts/rippled-fund-account.sh <address> [amount_in_xrp]
#
# Parameters:
#   address (required)        - XRP Ledger address to fund (starts with 'r')
#   amount_in_xrp (optional)  - XRP amount to send (default: 10000 XRP)
#
# Example:
#   ./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 5000
#   ./scripts/rippled-advance-ledger.sh  # Confirm the transaction
#
# Requirements:
#   - rippled container must be running (docker-compose -f docker-compose-dev.yml up -d rippled)
#   - curl must be installed
#
# Development Notes:
#   - In standalone mode, the master account has unlimited XRP
#   - No transaction fees in standalone mode
#   - Transaction stays pending until ledger_accept called

set -e

# rippled JSON-RPC endpoint
RIPPLED_URL="http://localhost:5005"

# Parameters
ACCOUNT_ADDRESS="$1"
AMOUNT="${2:-10000}"

# Validation
if [ -z "$ACCOUNT_ADDRESS" ]; then
  echo "Usage: $0 <address> [amount_in_xrp]"
  echo "Example: $0 rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 5000"
  exit 1
fi

# Basic address validation (must start with 'r')
if [[ ! "$ACCOUNT_ADDRESS" =~ ^r ]]; then
  echo "✗ Invalid XRP Ledger address: must start with 'r'"
  echo "Example valid address: rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"
  exit 1
fi

echo "Funding account $ACCOUNT_ADDRESS with $AMOUNT XRP..."

# Convert XRP to drops (1 XRP = 1,000,000 drops)
AMOUNT_DROPS=$((AMOUNT * 1000000))

# In standalone mode, we can use a simplified Payment transaction
# The master account is automatically funded and can send to any address
REQUEST_DATA=$(cat <<EOF
{
  "method": "submit",
  "params": [
    {
      "tx_json": {
        "TransactionType": "Payment",
        "Account": "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        "Destination": "$ACCOUNT_ADDRESS",
        "Amount": "$AMOUNT_DROPS"
      },
      "secret": "snoPBrXtMeMyMHUVTgbuqAfg1SUTb"
    }
  ]
}
EOF
)

# Send submit RPC request
RESPONSE=$(curl -s -X POST "$RIPPLED_URL" \
  -H "Content-Type: application/json" \
  --data "$REQUEST_DATA")

# Check if request succeeded
if echo "$RESPONSE" | grep -q '"status":"success"'; then
  # Extract transaction hash
  TX_HASH=$(echo "$RESPONSE" | grep -o '"tx_json":.*"hash":"[^"]*"' | grep -o '"hash":"[^"]*"' | cut -d'"' -f4)

  echo ""
  echo "✓ Funding transaction submitted successfully"
  echo ""
  echo "Transaction Hash: $TX_HASH"
  echo "Amount: $AMOUNT XRP ($AMOUNT_DROPS drops)"
  echo "Destination: $ACCOUNT_ADDRESS"
  echo ""
  echo "IMPORTANT: Transaction is PENDING until ledger advanced"
  echo "Run: ./scripts/rippled-advance-ledger.sh"
  echo ""
else
  echo "✗ Failed to fund account"
  echo "Response: $RESPONSE"
  exit 1
fi
