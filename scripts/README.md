# rippled Helper Scripts

Scripts for common rippled standalone mode operations during development and testing.

## Overview

These scripts simplify XRP Ledger development by automating common tasks when using rippled in standalone mode. Standalone mode runs rippled offline without consensus network, requiring manual ledger advancement after each transaction.

**IMPORTANT:** These scripts are for development only, not for production use.

## Scripts

### rippled-advance-ledger.sh

Manually advance rippled ledger by one step.

**Purpose:** In standalone mode, ledgers do NOT auto-close. Transactions stay PENDING until `ledger_accept` called.

**Usage:**

```bash
./scripts/rippled-advance-ledger.sh
```

**Example:**

```bash
# Submit a transaction (stays pending)
curl -X POST http://localhost:5005 -H "Content-Type: application/json" \
  --data '{"method":"submit","params":[...]}'

# Advance ledger to confirm transaction
./scripts/rippled-advance-ledger.sh
# Output: ✓ Ledger advanced successfully (current index: 42)
```

**When to use:**

- After submitting transactions to confirm them
- For precise control over ledger timing (debugging)
- When testing multi-step workflows that depend on ledger state

**Alternative:** Use `--profile auto-ledger` to advance ledgers automatically every 5 seconds:

```bash
docker-compose -f docker-compose-dev.yml --profile auto-ledger up -d
```

---

### rippled-create-account.sh

Generate new XRP Ledger account with address and secret.

**Purpose:** Create test accounts for development and testing.

**Usage:**

```bash
./scripts/rippled-create-account.sh [passphrase]
```

**Parameters:**

- `passphrase` (optional) - Deterministic account generation from passphrase. If omitted, random account is generated.

**Example (random account):**

```bash
./scripts/rippled-create-account.sh

# Output:
# ✓ Account created successfully
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Account Address:  rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
# Master Seed:      snoPBrXtMeMyMHUVTgbuqAfg1SUTb
# Public Key:       aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Example (deterministic account):**

```bash
./scripts/rippled-create-account.sh "test-account-alice"

# Same passphrase always generates same account
```

**Next steps after creation:**

1. Fund account: `./scripts/rippled-fund-account.sh <address> [amount]`
2. Advance ledger: `./scripts/rippled-advance-ledger.sh`
3. Check balance: See examples below

**IMPORTANT:** Save the master seed securely - it's required for signing transactions.

---

### rippled-fund-account.sh

Fund a test account in standalone mode.

**Purpose:** Send XRP from the master account to a test account.

**Usage:**

```bash
./scripts/rippled-fund-account.sh <address> [amount_in_xrp]
```

**Parameters:**

- `address` (required) - XRP Ledger address to fund (starts with 'r')
- `amount_in_xrp` (optional) - XRP amount to send (default: 10000 XRP)

**Example:**

```bash
# Fund account with default amount (10000 XRP)
./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo

# Fund account with custom amount (5000 XRP)
./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 5000

# Output:
# ✓ Funding transaction submitted successfully
#
# Transaction Hash: E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0
# Amount: 5000 XRP (5000000000 drops)
# Destination: rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
#
# IMPORTANT: Transaction is PENDING until ledger advanced
# Run: ./scripts/rippled-advance-ledger.sh

# Advance ledger to confirm transaction
./scripts/rippled-advance-ledger.sh
```

**Verify balance:**

```bash
curl -X POST http://localhost:5005 -H "Content-Type: application/json" \
  --data '{
    "method": "account_info",
    "params": [
      {
        "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"
      }
    ]
  }'
```

**Development Notes:**

- In standalone mode, the master account has unlimited XRP
- No transaction fees in standalone mode
- Transaction stays pending until `ledger_accept` called

---

### rippled-reset.sh

Reset rippled state to clean ledger (stop, remove volume, restart).

**Purpose:** Completely reset ledger state for clean testing or when ledger corrupted.

**Usage:**

```bash
./scripts/rippled-reset.sh
```

**What it does:**

1. Stops the rippled container
2. Removes the `rippled_data` Docker volume
3. Restarts rippled with a fresh genesis ledger

**Example:**

```bash
./scripts/rippled-reset.sh

# Output:
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# WARNING: This will DELETE all rippled ledger data
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# This operation will:
#   • Stop the rippled container
#   • Remove the rippled_data Docker volume
#   • Restart rippled with a clean genesis ledger
#
# All of the following will be LOST:
#   • All test accounts and balances
#   • All transaction history
#   • All ledger state
#
# Continue? (y/N): y
#
# Step 1/3: Stopping rippled container...
# Step 2/3: Removing rippled_data volume...
# Step 3/3: Starting rippled with clean state...
#
# ✓ rippled reset complete
```

**When to use:**

- Ledger state corrupted after crash or forced shutdown
- Starting fresh for clean integration testing
- Disk space cleanup (ledger data ~500MB+)

**WARNING:** This operation is DESTRUCTIVE and IRREVERSIBLE. All data will be lost.

---

## Common Workflows

### Create and Fund a Test Account

```bash
# 1. Create account
./scripts/rippled-create-account.sh "alice"
# Save the account address and master seed

# 2. Fund account with 5000 XRP
./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 5000

# 3. Advance ledger to confirm transaction
./scripts/rippled-advance-ledger.sh

# 4. Verify balance
curl -X POST http://localhost:5005 -H "Content-Type: application/json" \
  --data '{"method":"account_info","params":[{"account":"rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]}'
```

### Reset Ledger for Clean Testing

```bash
# 1. Reset rippled state
./scripts/rippled-reset.sh

# 2. Wait for rippled to become healthy (~15 seconds)
docker ps --filter name=rippled_standalone

# 3. Create and fund new test accounts
./scripts/rippled-create-account.sh "alice"
./scripts/rippled-fund-account.sh <alice-address> 10000
./scripts/rippled-advance-ledger.sh
```

### Integration Testing with Auto-Ledger

```bash
# 1. Start rippled with automatic ledger advancement
docker-compose -f docker-compose-dev.yml --profile auto-ledger up -d

# 2. Create and fund accounts (no manual advancement needed)
./scripts/rippled-create-account.sh "alice"
./scripts/rippled-fund-account.sh <alice-address> 5000

# Wait 5 seconds - ledger auto-advances
sleep 5

# 3. Verify balance (transaction already confirmed)
curl -X POST http://localhost:5005 -H "Content-Type: application/json" \
  --data '{"method":"account_info","params":[{"account":"<alice-address>"}]}'
```

---

## Requirements

All scripts require:

- **Docker Compose** - For managing rippled container
- **curl** - For sending JSON-RPC requests
- **rippled container running** - Start with:
  ```bash
  docker-compose -f docker-compose-dev.yml up -d rippled
  ```

---

## Troubleshooting

### Script fails: "Connection refused"

**Problem:** rippled container not running or not healthy

**Solution:**

```bash
# Check rippled status
docker ps --filter name=rippled_standalone

# If not running, start it
docker-compose -f docker-compose-dev.yml up -d rippled

# Wait for health check (~15 seconds)
docker ps --filter name=rippled_standalone
# Look for "healthy" in STATUS column
```

### Transaction stays pending after funding

**Problem:** Ledger not advanced in standalone mode

**Solution:**

```bash
# Advance ledger manually
./scripts/rippled-advance-ledger.sh

# OR use auto-ledger profile for automatic advancement
docker-compose -f docker-compose-dev.yml --profile auto-ledger up -d
```

### Reset script fails: "Volume not found"

**Problem:** rippled volume already deleted or never created

**Solution:** This is harmless - script continues and restarts rippled with fresh state.

---

## Additional Resources

- **XRP Ledger Documentation:** https://xrpl.org/
- **rippled Standalone Mode:** https://xrpl.org/use-standalone-mode.html
- **XRP Ledger JSON-RPC API:** https://xrpl.org/http-websocket-apis.html
- **Local Blockchain Development Guide:** `docs/guides/local-blockchain-development.md`
