# Local Blockchain Development Guide

## Introduction

This guide explains how to set up and use local blockchain nodes for M2M project development. Local blockchain nodes enable rapid development and testing of payment channel smart contracts (Epic 7-9) without relying on public testnets or mainnets.

**Purpose:**

- **Epic 7-9 Development**: Local blockchain infrastructure for Base L2 (EVM) and XRP Ledger smart contract development
- **Anvil (Base L2)**: Local Ethereum node forking Base Sepolia testnet
- **rippled (XRP Ledger)**: Standalone XRP Ledger node for payment channel testing (Story 7.2)

**Benefits of Local Blockchain Development:**

- ⚡ **Instant blocks**: No waiting for block confirmation times (instant mining)
- 💰 **Zero gas costs**: Deploy and test contracts without spending real ETH
- 📍 **State pinning**: Consistent blockchain state across developer machines
- 🚫 **No rate limits**: Unlimited RPC requests without API key restrictions
- 🔌 **Offline development**: Work without internet connection after initial fork download
- 🎯 **Deterministic testing**: Same pre-funded accounts and state for reproducible tests

## Quick Start (5 minutes)

### Prerequisites

Before starting, ensure you have the following installed:

- **Docker Desktop**: 20.10+ ([Download](https://www.docker.com/products/docker-desktop))
- **Node.js**: 20.11.0 LTS ([Download](https://nodejs.org/))
- **npm**: 10.x (included with Node.js)
- **Git**: 2.x ([Download](https://git-scm.com/))
- **curl**: Pre-installed on macOS/Linux, or use Git Bash on Windows

### Setup Steps

**Step 1: Clone the M2M Repository**

```bash
git clone <repository-url>
cd m2m
```

**Step 2: Configure Environment Variables**

```bash
cp .env.dev.example .env.dev
```

Edit `.env.dev` if you need to customize the RPC endpoint or fork block number.

**Step 3: Start Local Blockchain Nodes**

```bash
# Start all development services
docker-compose -f docker-compose-dev.yml up -d

# Or start only Anvil (Base L2 node)
docker-compose -f docker-compose-dev.yml up -d anvil
```

**Step 4: Verify Anvil is Running**

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Expected output:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x13c377f"
}
```

**Step 5 (Optional): Start rippled for XRP Ledger Development**

```bash
# Start rippled (XRP Ledger) node
docker-compose -f docker-compose-dev.yml up -d rippled

# Verify rippled is running
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  -d '{"method":"server_info","params":[]}'
```

**Step 6: Start Developing!**

Your local blockchain nodes are ready:

**Anvil (Base L2):**

- **Host machine**: `http://localhost:8545`
- **Docker containers**: `http://anvil:8545`

**rippled (XRP Ledger):**

- **Host machine JSON-RPC**: `http://localhost:5005`
- **Host machine WebSocket**: `ws://localhost:6006`
- **Docker containers JSON-RPC**: `http://rippled:5005`
- **Docker containers WebSocket**: `ws://rippled:6006`

## Anvil (Base L2) Setup

### What is Anvil?

Anvil is Foundry's local Ethereum node, optimized for testing and development. It provides:

- **Fast blockchain simulation**: Instant block mining on transaction submission
- **State forking**: Download and fork existing blockchain state from any network
- **OP Stack support**: Full Optimism/Base L2 compatibility with `--optimism` flag
- **Pre-funded accounts**: 10 deterministic test accounts with 10000 ETH each

**Purpose in M2M Project:**

Anvil provides a local Base L2 fork for Epic 8 (EVM Payment Channels) development. Developers can deploy and test payment channel smart contracts locally without testnet dependencies or rate limits.

### Anvil Configuration

Anvil is configured in `docker-compose-dev.yml` with the following settings:

| Configuration           | Value                      | Purpose                                        |
| ----------------------- | -------------------------- | ---------------------------------------------- |
| **Fork URL**            | `https://sepolia.base.org` | Download Base Sepolia testnet state            |
| **Fork Block**          | `20702367` (configurable)  | Pin to specific block for consistent state     |
| **Chain ID**            | `84532`                    | Base Sepolia chain ID (matches public testnet) |
| **OP Stack Flag**       | `--optimism`               | Enable OP Stack opcodes and gas calculations   |
| **Port**                | `8545`                     | Standard Ethereum JSON-RPC port                |
| **Pre-funded Accounts** | 10 accounts                | Each account has 10000 ETH for testing         |

**Environment Variables (configured in `.env.dev`):**

```bash
# Base Sepolia RPC endpoint for forking blockchain state
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Pinned block number for consistent state
FORK_BLOCK_NUMBER=20702367
```

### Pre-funded Test Accounts

Anvil automatically generates 10 pre-funded accounts with deterministic addresses and private keys. These accounts are **identical across all Anvil instances**, enabling reproducible testing.

**Account #0** (Primary test account):

- **Address**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- **Private Key**: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- **Initial Balance**: 10000 ETH

**Account #1**:

- **Address**: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- **Private Key**: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
- **Initial Balance**: 10000 ETH

**Account #2**:

- **Address**: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- **Private Key**: `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`
- **Initial Balance**: 10000 ETH

_7 additional accounts available (see Anvil logs for full list)_

### Connecting to Anvil

#### RPC Endpoints

- **From host machine**: `http://localhost:8545`
- **From Docker containers**: `http://anvil:8545`

#### Configure MetaMask

To connect MetaMask to your local Anvil instance:

1. Open MetaMask and click the network dropdown
2. Select "Add Network" → "Add a network manually"
3. Enter the following details:
   - **Network Name**: Anvil Local (Base Sepolia Fork)
   - **RPC URL**: `http://localhost:8545`
   - **Chain ID**: `84532`
   - **Currency Symbol**: ETH
4. Click "Save"
5. Import Account #0 using the private key above for testing

#### Configure Foundry (forge/cast)

If you have Foundry installed locally, you can interact with Anvil using `forge` and `cast`:

**Deploy a smart contract:**

```bash
forge create --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  src/MyContract.sol:MyContract
```

**Check account balance:**

```bash
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --rpc-url http://localhost:8545
```

**Send a transaction:**

```bash
cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  --value 1ether \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://localhost:8545
```

## Testing Anvil

### Test 1: Get Current Block Number

**Command:**

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Expected Result:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x13c377f"
}
```

The `result` field contains the current block number in hex format (e.g., `0x13c377f` = 20702367 in decimal).

### Test 2: Get Pre-funded Account Balance

**Command (using cast):**

```bash
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://localhost:8545
```

**Expected Result:**

```
10000000000000000000000
```

This is 10000 ETH in wei (10000 \* 10^18).

**Alternative (using curl):**

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_getBalance",
    "params":["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "latest"],
    "id":1
  }'
```

### Test 3: Send Test Transaction

**Command (using cast):**

```bash
cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  --value 1ether \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://localhost:8545
```

**Expected Result:**

```
blockHash               0x1234567890abcdef...
blockNumber             20702368
transactionHash         0xabcdef1234567890...
transactionIndex        0
status                  1 (success)
```

Transaction should confirm **instantly** (Anvil auto-mines on transaction submission).

## rippled (XRP Ledger) Setup

### What is rippled Standalone Mode?

rippled is the reference implementation of the XRP Ledger server. In **standalone mode**, rippled runs offline without connecting to the consensus network, providing:

- **Offline operation**: No network peers required, works without internet
- **Manual ledger control**: Ledgers must be manually advanced using `ledger_accept` RPC method
- **Instant transactions**: No consensus delay, transactions confirm immediately after ledger advancement
- **Complete control**: Test multi-step workflows with precise ledger timing
- **Zero fees**: No transaction fees in standalone mode
- **Reset capability**: Clean ledger state for each test run

**Purpose in M2M Project:**

rippled standalone mode provides a local XRP Ledger for Epic 9 (XRP Payment Channels) development. Developers can create and manage payment channels locally without XRPL Testnet dependencies or network delays.

**CRITICAL CONCEPT - Ledger Advancement:**

Standalone mode does **NOT** automatically close ledgers. Transactions submitted to rippled stay **PENDING** until the `ledger_accept` RPC method is called. You must either:

1. **Manual advancement**: Call `./scripts/rippled-advance-ledger.sh` after each transaction
2. **Automatic advancement**: Start with `--profile auto-ledger` flag to advance every 5 seconds

### rippled Configuration

rippled is configured in `docker-compose-dev.yml` with the following settings:

| Configuration      | Value                    | Purpose                                        |
| ------------------ | ------------------------ | ---------------------------------------------- |
| **Mode**           | Standalone (`-a` flag)   | Run offline without consensus network          |
| **JSON-RPC Port**  | `5005`                   | HTTP endpoint for RPC requests                 |
| **WebSocket Port** | `6006`                   | WebSocket endpoint for subscriptions           |
| **Data Volume**    | `rippled_data`           | Persist ledger state across container restarts |
| **Health Check**   | `server_info` RPC method | Verify rippled is ready to accept requests     |
| **Initialization** | ~10-15 seconds           | Genesis ledger creation and database setup     |

**No environment variables required** - standalone mode is self-contained with no external dependencies.

### Connecting to rippled

#### RPC Endpoints

- **JSON-RPC from host**: `http://localhost:5005`
- **JSON-RPC from containers**: `http://rippled:5005`
- **WebSocket from host**: `ws://localhost:6006`
- **WebSocket from containers**: `ws://rippled:6006`

#### Test Connection with curl

```bash
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  --data '{"method":"server_info","params":[]}'
```

**Expected response:**

```json
{
  "result": {
    "info": {
      "build_version": "1.12.0",
      "complete_ledgers": "1-5",
      "validated_ledger": {
        "seq": 5,
        "hash": "ABC123...",
        "base_fee_xrp": 0.00001
      }
    },
    "status": "success"
  }
}
```

### Ledger Advancement (CRITICAL)

**Understanding Standalone Mode Behavior:**

In standalone mode, rippled does NOT automatically close ledgers. This means:

1. Transactions are submitted successfully and added to the pending transaction pool
2. Transactions stay **PENDING** until `ledger_accept` is called
3. Queries like `account_info` won't show updated balances until ledger advances
4. Transaction confirmations (`tx` method) return "transaction not found" until ledger advances

**This is the #1 source of confusion for developers new to standalone mode.**

#### Manual Ledger Advancement

Use the helper script to advance the ledger by one step:

```bash
./scripts/rippled-advance-ledger.sh
```

**When to use manual advancement:**

- Debugging multi-step workflows (precise control over ledger state)
- Testing edge cases that depend on exact ledger timing
- Performance testing (measure transaction processing without auto-advancement)

#### Automatic Ledger Advancement

Start rippled with the `auto-ledger` profile to automatically advance ledgers every 5 seconds:

```bash
docker-compose -f docker-compose-dev.yml --profile auto-ledger up -d
```

This starts the `rippled_ledger_advancer` service, which continuously calls `ledger_accept` every 5 seconds, simulating realistic XRPL block production (mainnet closes ledgers every 3-5 seconds).

**When to use automatic advancement:**

- Integration testing (simulate realistic blockchain behavior)
- Continuous development (eliminate manual ledger advancement)
- Multi-step workflows (transactions confirm automatically)

**Recommendation:** Use auto-ledger for most development, switch to manual for debugging.

### Helper Scripts

rippled standalone mode includes helper scripts for common operations:

| Script                      | Purpose                             |
| --------------------------- | ----------------------------------- |
| `rippled-create-account.sh` | Generate new XRP Ledger account     |
| `rippled-fund-account.sh`   | Fund account with XRP               |
| `rippled-advance-ledger.sh` | Manually advance ledger by one step |
| `rippled-reset.sh`          | Reset ledger state to clean genesis |

**See `scripts/README.md` for detailed usage examples.**

## Testing rippled

### Test 1: Get Server Info

**Command:**

```bash
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  --data '{"method":"server_info","params":[]}'
```

**Expected Result:**

```json
{
  "result": {
    "info": {
      "build_version": "1.12.0",
      "complete_ledgers": "1-5",
      "validated_ledger": {
        "seq": 5,
        "hash": "ABC123...",
        "base_fee_xrp": 0.00001
      },
      "server_state": "full"
    },
    "status": "success"
  }
}
```

The `validated_ledger.seq` field shows the current ledger index.

### Test 2: Create Test Account

**Command:**

```bash
./scripts/rippled-create-account.sh "test-alice"
```

**Expected Result:**

```
✓ Account created successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Account Address:  rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
Master Seed:      snoPBrXtMeMyMHUVTgbuqAfg1SUTb
Public Key:       aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Save the account address and master seed for the next test.

### Test 3: Fund Test Account

**Command (replace with your account address):**

```bash
# Fund account with 5000 XRP
./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 5000

# Advance ledger to confirm transaction
./scripts/rippled-advance-ledger.sh
```

**Expected Result:**

```
Funding account rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo with 5000 XRP...

✓ Funding transaction submitted successfully

Transaction Hash: E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0
Amount: 5000 XRP (5000000000 drops)
Destination: rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo

IMPORTANT: Transaction is PENDING until ledger advanced
Run: ./scripts/rippled-advance-ledger.sh
```

After advancing the ledger:

```
Advancing rippled ledger...
✓ Ledger advanced successfully (current index: 6)
```

### Test 4: Verify Account Balance

**Command (replace with your account address):**

```bash
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  --data '{
    "method": "account_info",
    "params": [
      {
        "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"
      }
    ]
  }'
```

**Expected Result:**

```json
{
  "result": {
    "account_data": {
      "Account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
      "Balance": "5000000000",
      "Flags": 0,
      "Sequence": 1
    },
    "status": "success"
  }
}
```

Balance is shown in **drops** (1 XRP = 1,000,000 drops), so 5000000000 drops = 5000 XRP.

## Troubleshooting

### Issue: Anvil won't start

**Symptoms:**

- Docker container fails to start
- Health check never passes
- Container logs show errors

**Problem:** Port 8545 already in use by another process

**Solution:**

1. Check what's using port 8545:

   ```bash
   lsof -i :8545
   ```

2. Kill the conflicting process:

   ```bash
   kill -9 <PID>
   ```

3. Or change Anvil port in `docker-compose-dev.yml`:
   ```yaml
   ports:
     - '8546:8545' # Map host port 8546 to container port 8545
   ```

### Issue: Anvil fork fails to download

**Symptoms:**

- Container starts but health check fails
- Logs show "fork download timeout" or rate limit errors
- Fork download takes 5+ minutes

**Problem:** `BASE_SEPOLIA_RPC_URL` rate limited or down

**Solution:**

Configure an alternative RPC endpoint in `.env.dev`:

```bash
# Use Alchemy (requires free API key)
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Or use Tenderly (free tier)
BASE_SEPOLIA_RPC_URL=https://base-sepolia.gateway.tenderly.co

# Or use Infura (requires free project ID)
BASE_SEPOLIA_RPC_URL=https://base-sepolia.infura.io/v3/YOUR_PROJECT_ID
```

Restart Anvil:

```bash
docker-compose -f docker-compose-dev.yml restart anvil
```

### Issue: Forked state is outdated

**Symptoms:**

- Missing recent Base Sepolia contracts or state
- Fork block number is weeks/months old
- Need newer testnet state for testing

**Problem:** `FORK_BLOCK_NUMBER` is too old

**Solution:**

1. Get the latest Base Sepolia block number:

   ```bash
   curl https://sepolia.base.org -X POST \
     -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

2. Convert hex result to decimal:

   ```bash
   # Example: "0x13c377f" → 20702367
   echo $((16#13c377f))
   ```

3. Update `FORK_BLOCK_NUMBER` in `.env.dev`:

   ```bash
   FORK_BLOCK_NUMBER=20702367  # Replace with latest block
   ```

4. Restart Anvil:
   ```bash
   docker-compose -f docker-compose-dev.yml restart anvil
   ```

### Issue: Smart contract deployment fails

**Symptoms:**

- `forge create` or MetaMask transactions fail
- Error: "invalid chain id" or "network mismatch"
- Contract deploys but doesn't behave correctly

**Problem:** Using wrong chain ID or RPC URL

**Solution:**

Verify configuration:

1. **Chain ID must be 84532** (Base Sepolia)
2. **RPC URL must be `http://localhost:8545`** (or `http://anvil:8545` from containers)
3. **Use `--optimism` flag** when starting Anvil (already configured in docker-compose-dev.yml)

Check Anvil is using correct chain ID:

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

Expected result: `{"result":"0x14a34"}` (84532 in hex)

### Issue: rippled won't start

**Symptoms:**

- Docker container fails to start
- Health check never passes
- Container logs show errors

**Problem:** Port 5005 or 6006 already in use by another rippled instance

**Solution:**

1. Check what's using ports 5005 and 6006:

   ```bash
   lsof -i :5005
   lsof -i :6006
   ```

2. Kill the conflicting process:

   ```bash
   kill -9 <PID>
   ```

3. Or change rippled ports in `docker-compose-dev.yml`:

   ```yaml
   ports:
     - '5007:5005' # Map host port 5007 to container port 5005
     - '6008:6006' # Map host port 6008 to container port 6006
   ```

### Issue: Transactions not confirming

**Symptoms:**

- Transactions submitted successfully but `account_info` shows old balance
- `tx` method returns "transaction not found"
- Ledger index not increasing

**Problem:** Ledger not advancing in standalone mode

**Solution:**

Standalone mode requires manual ledger advancement after each transaction:

```bash
# Advance ledger manually
./scripts/rippled-advance-ledger.sh

# OR start with auto-ledger profile for automatic advancement every 5 seconds
docker-compose -f docker-compose-dev.yml --profile auto-ledger up -d
```

**This is the most common issue for developers new to standalone mode.**

### Issue: rippled ledger state corrupted

**Symptoms:**

- rippled container crashes on startup
- Health check fails persistently
- RPC requests timeout or return errors
- Logs show "ledger validation failed" or database errors

**Problem:** Ledger volume data corrupted after crash or forced shutdown

**Solution:**

Reset rippled state with the reset script:

```bash
./scripts/rippled-reset.sh

# Manually if script fails:
docker-compose -f docker-compose-dev.yml down rippled
docker volume rm m2m_rippled_data
docker-compose -f docker-compose-dev.yml up -d rippled
```

All test accounts and ledger history will be lost, but rippled will start with clean genesis ledger.

### Issue: Account funding fails

**Symptoms:**

- `rippled-fund-account.sh` script fails with "invalid account" error
- Funding transaction submitted but balance remains 0 after ledger advancement

**Problem:** Invalid account address or ledger not advanced

**Solution:**

1. Verify account address format (must start with 'r'):

   ```bash
   # Valid: rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
   # Invalid: 0xf39Fd... (Ethereum address)
   ```

2. Ensure ledger advanced after funding transaction:

   ```bash
   ./scripts/rippled-fund-account.sh <address> 5000
   ./scripts/rippled-advance-ledger.sh  # MUST call this
   ```

3. Verify balance after ledger advancement:
   ```bash
   curl -X POST http://localhost:5005 \
     -H "Content-Type: application/json" \
     --data '{"method":"account_info","params":[{"account":"<address>"}]}'
   ```

## FAQ

### Q: Why use Anvil instead of Hardhat?

**A:** Anvil is 2-3x faster for testing, has better Foundry integration, and supports instant mining. Hardhat is also a great tool, but Anvil is optimized for the Foundry toolchain used in this project.

### Q: Can I use public Base Sepolia testnet instead of Anvil?

**A:** Yes, but local Anvil provides:

- **Faster iteration**: Instant block confirmation vs 2-second Base L2 block time
- **No rate limits**: Unlimited RPC requests vs rate-limited public endpoints
- **Offline development**: Work without internet after initial fork download
- **Deterministic state**: Same state across all developer machines

Use public Base Sepolia for final testing before mainnet deployment.

### Q: Do I need to run Anvil for all development?

**A:** Only if working on **Epic 8 (EVM Payment Channels)** smart contracts. If you're working on ILP connectors, telemetry, or dashboard, Anvil is not required.

### Q: How much disk space does Anvil use?

**A:** Approximately **2-5GB** for Base Sepolia fork (state download at fork block). Anvil uses ephemeral storage by default—state is cleared on container restart.

### Q: Can I persist Anvil state across container restarts?

**A:** Anvil uses ephemeral storage intentionally for clean development environment. If you need persistent state, add a Docker volume:

```yaml
# In docker-compose-dev.yml (not recommended for most use cases)
anvil:
  volumes:
    - anvil-data:/root/.anvil
```

### Q: How often should I update the fork block number?

**A:** Update `FORK_BLOCK_NUMBER` every **1-2 weeks** to get recent Base Sepolia state. Older fork blocks work fine but may miss recent contract deployments or state changes.

### Q: Can I fork Base mainnet instead of Base Sepolia?

**A:** Yes, but it's not recommended for development:

- **Base mainnet**: ~50GB+ state size, slower fork download
- **Base Sepolia**: ~2-5GB state size, faster fork download

Change `BASE_SEPOLIA_RPC_URL` to `https://mainnet.base.org` and update `FORK_BLOCK_NUMBER` to a recent Base mainnet block if needed for production testing.

### Q: Why use standalone mode instead of XRPL Testnet?

**A:** Standalone mode provides:

- **Instant confirmations**: Transactions confirm immediately after `ledger_accept` (no 3-5 second wait)
- **No network dependencies**: Works offline without internet or testnet availability
- **Full control**: Precise control over ledger state and timing for testing
- **Reset capability**: Clean ledger state for each test run (impossible on testnet)
- **Zero fees**: No transaction fees in standalone mode

Use XRPL Testnet for production-like testing before mainnet deployment.

### Q: Can I use rippled for both Epic 8 and Epic 9?

**A:** No, rippled is **only for Epic 9 (XRP Payment Channels)**. Use Anvil for Epic 8 (EVM Payment Channels on Base L2). They serve different blockchains:

- **Anvil**: Base L2 (Ethereum Virtual Machine) - for EVM smart contracts
- **rippled**: XRP Ledger - for XRP payment channels

### Q: Should I use auto-ledger profile or manual advancement?

**A:** Use **auto-ledger for most development** (eliminates manual steps), switch to **manual for debugging** (precise control). Specifically:

- **Auto-ledger (`--profile auto-ledger`)**: Integration testing, continuous development, multi-step workflows
- **Manual (`./scripts/rippled-advance-ledger.sh`)**: Debugging, testing edge cases, performance testing

Auto-ledger simulates realistic blockchain behavior (5-second block time similar to XRPL mainnet).

### Q: How much disk space does rippled use?

**A:** Approximately **500MB** for standalone ledger data (grows slowly with transactions). This is much smaller than mainnet (100GB+) or testnet (10GB+) ledger data.

Reset with `./scripts/rippled-reset.sh` to clear volume and free disk space.

### Q: Can I connect to rippled from outside Docker?

**A:** Yes, rippled exposes ports on the host machine:

- **JSON-RPC**: `http://localhost:5005` (from host)
- **WebSocket**: `ws://localhost:6006` (from host)

Use these URLs for local development tools, MetaMask (via custom network), or any RPC client.

### Q: How do I create deterministic test accounts?

**A:** Use the passphrase parameter with `rippled-create-account.sh`:

```bash
# Same passphrase always generates same account
./scripts/rippled-create-account.sh "alice"
./scripts/rippled-create-account.sh "bob"

# Alice and Bob accounts will be identical across all developer machines
```

This enables reproducible testing across developer teams.

## External Resources

### Anvil / Base L2 Resources

- **Foundry Documentation**: [https://book.getfoundry.sh/](https://book.getfoundry.sh/)
- **Anvil Reference**: [https://book.getfoundry.sh/reference/anvil/](https://book.getfoundry.sh/reference/anvil/)
- **Base Sepolia Documentation**: [https://docs.base.org/network-information](https://docs.base.org/network-information)
- **Base Sepolia Faucet**: [https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
- **OP Stack Documentation**: [https://docs.optimism.io/](https://docs.optimism.io/)
- **Ethereum JSON-RPC Specification**: [https://ethereum.org/en/developers/docs/apis/json-rpc/](https://ethereum.org/en/developers/docs/apis/json-rpc/)

### rippled / XRP Ledger Resources

- **XRP Ledger Documentation**: [https://xrpl.org/](https://xrpl.org/)
- **rippled Standalone Mode Guide**: [https://xrpl.org/use-standalone-mode.html](https://xrpl.org/use-standalone-mode.html)
- **XRP Ledger JSON-RPC API**: [https://xrpl.org/http-websocket-apis.html](https://xrpl.org/http-websocket-apis.html)
- **XRP Ledger Payment Channels**: [https://xrpl.org/payment-channels.html](https://xrpl.org/payment-channels.html)
- **rippled GitHub Repository**: [https://github.com/XRPLF/rippled](https://github.com/XRPLF/rippled)
- **XRPL Testnet Faucet**: [https://xrpl.org/xrp-testnet-faucet.html](https://xrpl.org/xrp-testnet-faucet.html)

---

**Need help?** Open an issue on GitHub or ask in the project Discord/Slack channel.
