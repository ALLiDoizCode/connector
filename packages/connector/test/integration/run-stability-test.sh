#!/bin/bash

# Stability Test Script for Claim Redemption Integration Tests
#
# Runs claim-redemption.integration.test.ts multiple times to verify stability.
# Tests should pass consistently (100% pass rate over 3 runs) to meet AC 10.
#
# Usage:
#   ./run-stability-test.sh [num_runs]
#
# Default: 3 runs
#
# Prerequisites:
# - Testnet wallets funded (see testnet-wallets.json)
# - XRP Testnet: ~30 XRP for 3 runs (10 XRP per run)
# - Base Sepolia: ~30 M2M tokens + ~0.003 ETH for gas
# - Aptos Testnet: ~30 M2M tokens + ~0.003 APT for gas

set -e

# Number of runs (default: 3)
NUM_RUNS=${1:-3}

echo "=== Claim Redemption Integration Test Stability Verification ==="
echo "Running tests $NUM_RUNS times to verify 100% pass rate"
echo ""

FAILURES=0
SUCCESSES=0

for i in $(seq 1 $NUM_RUNS); do
  echo "=== Stability Test Run $i/$NUM_RUNS ==="
  echo "Started at: $(date)"

  if npm test -- claim-redemption.integration.test.ts --silent; then
    echo "✓ Run $i PASSED"
    ((SUCCESSES++))
  else
    echo "✗ Run $i FAILED"
    ((FAILURES++))
  fi

  echo "Completed at: $(date)"
  echo ""
done

echo "=== Stability Test Results ==="
echo "Total Runs: $NUM_RUNS"
echo "Passed: $SUCCESSES"
echo "Failed: $FAILURES"
echo "Pass Rate: $(echo "scale=2; $SUCCESSES * 100 / $NUM_RUNS" | bc)%"
echo ""

if [ $FAILURES -eq 0 ]; then
  echo "✓ STABLE - All tests passed consistently"
  exit 0
else
  echo "✗ FLAKY - Tests failed $FAILURES time(s)"
  echo "Fix flakiness before marking story as complete"
  exit 1
fi
