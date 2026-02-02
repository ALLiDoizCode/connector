# Local Blockchain Development Guide

## Introduction

This guide explains how to set up and use local blockchain nodes for M2M project development. Local blockchain nodes enable rapid development and testing of payment channel smart contracts (Epic 7-9) without relying on public testnets or mainnets.

**Purpose:**

- **Epic 7-9 Development**: Local blockchain infrastructure for Base L2 (EVM), XRP Ledger, and Aptos smart contract development
- **Anvil (Base L2)**: Local Ethereum node forking Base Sepolia testnet
- **rippled (XRP Ledger)**: Standalone XRP Ledger node for payment channel testing (Story 7.2)
- **Aptos Local Testnet**: Local Aptos node for Move module development (Story 7.6)

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

**Step 6 (Optional): Start Aptos for Move Development**

```bash
# Start Aptos local testnet
docker-compose -f docker-compose-dev.yml up -d aptos-local

# Verify Aptos is running (may take 45-60 seconds)
curl -s http://localhost:8080/v1 | jq .
```

**Step 7: Start Developing!**

Your local blockchain nodes are ready:

**Anvil (Base L2):**

- **Host machine**: `http://localhost:8545`
- **Docker containers**: `http://anvil:8545`

**rippled (XRP Ledger):**

- **Host machine JSON-RPC**: `http://localhost:5005`
- **Host machine WebSocket**: `ws://localhost:6006`
- **Docker containers JSON-RPC**: `http://rippled:5005`
- **Docker containers WebSocket**: `ws://rippled:6006`

**Aptos (Move):**

- **Host machine Node API**: `http://localhost:8080/v1`
- **Host machine Faucet**: `http://localhost:8081`
- **Docker containers Node API**: `http://aptos-local:8080/v1`
- **Docker containers Faucet**: `http://aptos-local:8081`

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

## Development Workflows

### Overview of Development Lifecycle

The M2M project supports two main blockchain development workflows corresponding to Epic 8 (EVM smart contracts on Base L2) and Epic 9 (XRP payment channels). Understanding the complete development lifecycle helps you ship high-quality code through systematic progression from local testing to production deployment.

**Standard Development Lifecycle:**

```
Setup → Develop → Test Locally → Deploy Testnet → Audit → Deploy Mainnet
```

**Phase Breakdown:**

| Phase              | Purpose                                           | Tools Used                   | Time Estimate             |
| ------------------ | ------------------------------------------------- | ---------------------------- | ------------------------- |
| **Setup**          | Configure local blockchain nodes and dependencies | Docker, Foundry, rippled     | 5-10 minutes              |
| **Develop**        | Write smart contracts or payment channel logic    | Solidity, TypeScript, VSCode | Hours to days             |
| **Test Locally**   | Run tests against Anvil or rippled standalone     | forge test, Jest, curl       | Seconds to minutes        |
| **Deploy Testnet** | Deploy to Base Sepolia or XRPL Testnet            | forge script, RPC methods    | 2-5 minutes               |
| **Audit**          | Security review and gas optimization              | Slither, manual review       | Days to weeks             |
| **Deploy Mainnet** | Production deployment to Base or XRPL mainnet     | forge script, RPC methods    | 5-10 minutes + monitoring |

**Key Principles:**

- **Always test locally first**: Anvil and rippled standalone provide instant feedback with zero costs
- **Never skip testnet**: Production-like testing catches network-specific issues
- **Separate private keys**: Use different keys for development, testnet, and mainnet (NEVER reuse)
- **Monitor mainnet deployments**: Watch for 24 hours before full rollout

### Workflow 1: Smart Contract Development (Epic 8)

This workflow guides you through developing, testing, and deploying EVM smart contracts for Epic 8 payment channels on Base L2.

#### Step 1: Write Solidity Contract

Create your smart contract in `packages/contracts/src/`. For this example, we'll use a payment channel contract skeleton.

**File: `packages/contracts/src/PaymentChannel.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PaymentChannel
/// @notice Simple payment channel for ILP settlement
contract PaymentChannel {
    address public sender;
    address public recipient;
    uint256 public expiresAt;

    /// @notice Emitted when a payment channel is created
    event ChannelCreated(address indexed sender, address indexed recipient, uint256 expiresAt);

    /// @notice Create a new payment channel
    /// @param _recipient Address receiving payments
    /// @param _duration Channel duration in seconds
    constructor(address _recipient, uint256 _duration) payable {
        require(msg.value > 0, "Must fund channel with ETH");
        require(_recipient != address(0), "Invalid recipient");

        sender = msg.sender;
        recipient = _recipient;
        expiresAt = block.timestamp + _duration;

        emit ChannelCreated(sender, recipient, expiresAt);
    }

    /// @notice Get channel balance
    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
```

**Contract Structure Explanation:**

- **pragma**: Specifies Solidity compiler version (0.8.20 for this project)
- **State variables**: Persistent storage (sender, recipient, expiresAt)
- **Events**: Emit logs for off-chain indexing
- **Constructor**: Initialize contract state on deployment
- **View functions**: Read-only functions that don't modify state

**Reference**: [Solidity Documentation](https://docs.soliditylang.org/)

#### Step 2: Write Foundry Tests

Create comprehensive tests in `packages/contracts/test/` to validate contract behavior before deployment.

**File: `packages/contracts/test/PaymentChannel.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PaymentChannel.sol";

contract PaymentChannelTest is Test {
    PaymentChannel public channel;
    address public sender = address(0x1);
    address public recipient = address(0x2);
    uint256 public duration = 3600; // 1 hour

    function setUp() public {
        // Fund sender account for testing
        vm.deal(sender, 10 ether);

        // Deploy payment channel as sender
        vm.prank(sender);
        channel = new PaymentChannel{value: 1 ether}(recipient, duration);
    }

    function testChannelCreation() public {
        assertEq(channel.sender(), sender);
        assertEq(channel.recipient(), recipient);
        assertEq(channel.getBalance(), 1 ether);
        assertTrue(channel.expiresAt() > block.timestamp);
    }

    function testChannelCreatedEvent() public {
        vm.expectEmit(true, true, false, true);
        emit PaymentChannel.ChannelCreated(sender, recipient, block.timestamp + duration);

        vm.prank(sender);
        new PaymentChannel{value: 1 ether}(recipient, duration);
    }

    function testFailZeroFunding() public {
        vm.prank(sender);
        new PaymentChannel{value: 0}(recipient, duration);
    }
}
```

**Test Structure Explanation:**

- **setUp()**: Runs before each test function (deploy contract, fund accounts)
- **Assertions**: `assertEq()`, `assertTrue()` validate expected outcomes
- **Cheat codes**: `vm.prank()` sets msg.sender, `vm.deal()` funds accounts
- **Event testing**: `vm.expectEmit()` validates event emissions
- **Failure tests**: `testFail*` prefix expects function to revert

#### Step 3: Run Tests Against Local Anvil

Execute tests against your local Anvil node to validate contract logic.

**Command:**

```bash
forge test --fork-url http://localhost:8545
```

**Expected Output:**

```
[⠢] Compiling...
[⠆] Compiling 2 files with 0.8.20
[⠰] Solc 0.8.20 finished in 1.23s
Compiler run successful!

Running 3 tests for test/PaymentChannel.t.sol:PaymentChannelTest
[PASS] testChannelCreatedEvent() (gas: 89234)
[PASS] testChannelCreation() (gas: 56782)
[PASS] testFailZeroFunding() (gas: 12345)
Test result: ok. 3 passed; 0 failed; finished in 2.34ms
```

**Debugging Test Failures:**

If tests fail, use `-vvvv` flag for detailed traces:

```bash
forge test --fork-url http://localhost:8545 -vvvv
```

This shows:

- Full transaction traces
- State changes
- Revert reasons with exact line numbers

#### Step 4: Deploy to Local Anvil

Deploy your tested contract to Anvil for integration testing with connectors.

**File: `packages/contracts/script/Deploy.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaymentChannel.sol";

contract DeployScript is Script {
    function run() public {
        vm.startBroadcast();

        address recipient = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
        uint256 duration = 86400; // 24 hours

        PaymentChannel channel = new PaymentChannel{value: 1 ether}(recipient, duration);
        console.log("PaymentChannel deployed at:", address(channel));
        console.log("Sender:", channel.sender());
        console.log("Recipient:", channel.recipient());
        console.log("Balance:", channel.getBalance());

        vm.stopBroadcast();
    }
}
```

**Deploy Command:**

```bash
forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

**Expected Output:**

```
[⠢] Compiling...
No files changed, compilation skipped

Script ran successfully.
Gas used: 234567

== Logs ==
  PaymentChannel deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
  Sender: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Recipient: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  Balance: 1000000000000000000

ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
```

**Capture the deployed contract address** (`0x5FbDB2315678afecb367f032d93F642f64180aa3`) for next steps.

**Verify Deployment:**

```bash
cast code 0x5FbDB2315678afecb367f032d93F642f64180aa3 --rpc-url http://localhost:8545
```

Expected: Long bytecode hex string (contract deployed successfully)

#### Step 5: Test Integration with Connectors

Configure your M2M connector to interact with the deployed contract and verify payment channel functionality.

**Update connector config** (example: `packages/connector/config/development.yml`):

```yaml
blockchain:
  type: evm
  rpc_url: http://anvil:8545
  payment_channel_address: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
```

**Restart connector:**

```bash
make dev-reset
```

**Send test ILP packet:**

```bash
# Example using test packet sender
npm run test:send-packet --connector=connector-a --amount=100
```

**Monitor Anvil logs** for contract interactions:

```bash
docker logs -f anvil_base_local
```

Expected: Transaction logs showing contract function calls, events emitted, state changes.

#### Step 6: Deploy to Base Sepolia Testnet

After successful local testing, deploy to Base Sepolia testnet for production-like validation.

**Update environment variables** in `.env.testnet`:

```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
# Or use Alchemy/Infura for better reliability
BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```

**Deploy Command:**

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $TESTNET_PRIVATE_KEY \
  --broadcast \
  --verify
```

**Flags Explained:**

- `--broadcast`: Actually submit transactions (omit for dry-run)
- `--verify`: Auto-verify contract on BaseScan (Etherscan for Base)

**Expected Output:**

```
[⠢] Compiling...
Script ran successfully.

ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.

Contract deployed at: 0xABCD1234...
Waiting for confirmations...
Verified contract on BaseScan: https://sepolia.basescan.org/address/0xABCD1234...
```

**Wait for confirmations**: Base Sepolia has ~2-second block time, but wait for 2-3 blocks before testing.

#### Step 7: Run Integration Tests on Testnet

Validate that your contract behaves identically on testnet as it did on Anvil.

**Update test configuration** to use public Base Sepolia endpoint:

```bash
# In test config or environment
export RPC_URL=https://sepolia.base.org
export CONTRACT_ADDRESS=0xABCD1234...
```

**Run smoke tests:**

```bash
forge test --fork-url $RPC_URL --match-test testChannelCreation
```

**Verify contract behavior:**

```bash
# Check contract balance
cast call $CONTRACT_ADDRESS "getBalance()" --rpc-url $RPC_URL

# Check sender address
cast call $CONTRACT_ADDRESS "sender()" --rpc-url $RPC_URL
```

**Important**: Testnet transactions cost real (testnet) ETH and have gas fees. Monitor gas costs and ensure testnet ETH balance is sufficient.

**Get testnet ETH**: [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)

#### Step 8: Security Audit

Before production deployment, perform comprehensive security review and gas optimization.

**Static Analysis with Slither:**

```bash
slither packages/contracts/src/PaymentChannel.sol
```

Expected output: List of potential vulnerabilities (high/medium/low severity)

**Address all HIGH and MEDIUM severity findings** before mainnet deployment.

**Gas Optimization Review:**

```bash
# Generate gas snapshot
forge snapshot

# Review gas usage per function
forge test --gas-report
```

**Optimization targets:**

- Storage layout (minimize SSTORE operations)
- Function visibility (use external instead of public where possible)
- Data types (use uint256 instead of smaller types for gas efficiency)

**External Audit (for production contracts):**

- Engage professional security auditors (OpenZeppelin, Trail of Bits, Consensys Diligence)
- Budget: $10k-$50k+ depending on contract complexity
- Timeline: 2-4 weeks for comprehensive audit

#### Step 9: Deploy to Base Mainnet (Production)

After testnet validation and security audit, deploy to Base mainnet for production use.

**Update environment:**

```bash
BASE_MAINNET_RPC_URL=https://mainnet.base.org
# Or use paid RPC provider for better reliability
BASE_MAINNET_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

**Deploy Command:**

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BASE_MAINNET_RPC_URL \
  --private-key $MAINNET_PRIVATE_KEY \
  --broadcast \
  --verify
```

**CRITICAL SECURITY:**

- Use hardware wallet or secure key management (never paste private keys in terminal history)
- Verify deployment transaction before confirming
- Use `--slow` flag for lower gas prices if not time-sensitive

**Post-Deployment Steps:**

1. **Verify contract on BaseScan:**

   ```bash
   # Verify at: https://basescan.org/address/<contract-address>
   ```

2. **Update production connector config:**

   ```yaml
   blockchain:
     rpc_url: https://mainnet.base.org
     payment_channel_address: '0xMAINNET_CONTRACT_ADDRESS'
   ```

3. **Monitor mainnet deployment for 24 hours:**
   - Watch for unexpected transactions
   - Monitor gas usage
   - Validate event emissions
   - Test with small amounts first

4. **Gradual rollout:**
   - Start with 1% of traffic
   - Monitor for 24 hours
   - Increase to 10%, 50%, 100% over 1 week

#### Common Pitfalls and Tips

**Pitfall 1: Deploying without testing on Anvil first**

- **Always test locally first**: Instant feedback, zero gas costs, unlimited iterations
- Anvil catches 90% of issues before they reach testnet

**Pitfall 2: Reusing private keys across environments**

- **Use separate keys for dev/testnet/mainnet**: NEVER reuse
- Development key can be committed to repo (test funds only)
- Testnet/mainnet keys must be secured (hardware wallet, environment variables)

**Pitfall 3: Skipping Etherscan verification**

- **Verify immediately after deployment**: Enables public contract interaction
- Use `--verify` flag or verify manually on BaseScan
- Verified contracts build trust and enable debugging

**Pitfall 4: Not keeping deployment scripts in version control**

- **Commit deployment scripts**: Reproducible deployments
- Document deployment parameters (recipient, duration, initial funding)
- Tag git commits for production deployments

**Tip: Use Make targets for common workflows**

Create `Makefile` shortcuts:

```makefile
deploy-local:
	forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

deploy-testnet:
	forge script script/Deploy.s.sol --rpc-url $(BASE_SEPOLIA_RPC_URL) --broadcast --verify

test-contracts:
	forge test --fork-url http://localhost:8545 -vv
```

### Workflow 2: XRP Payment Channel Testing (Epic 9)

This workflow guides you through creating, testing, and managing XRP payment channels for Epic 9 on XRP Ledger standalone mode.

#### Step 1: Start rippled in Auto-Ledger Mode

Start rippled with automatic ledger advancement every 5 seconds for continuous development without manual intervention.

**Command:**

```bash
make dev-up-auto-ledger
```

This starts both `rippled` and `rippled_ledger_advancer` services.

**Verify rippled running:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"method":"server_info","params":[]}'
```

**Expected Response:**

```json
{
  "result": {
    "info": {
      "build_version": "1.12.0",
      "server_state": "full",
      "validated_ledger": {
        "seq": 8
      }
    },
    "status": "success"
  }
}
```

**Confirm auto-ledger advancing:**

Run `server_info` twice with 6-second delay, check `validated_ledger.seq` increased:

```bash
curl http://localhost:5005 -X POST -H 'Content-Type: application/json' --data '{"method":"server_info","params":[]}' | jq '.result.info.validated_ledger.seq'

sleep 6

curl http://localhost:5005 -X POST -H 'Content-Type: application/json' --data '{"method":"server_info","params":[]}' | jq '.result.info.validated_ledger.seq'
```

Expected: Second number is 1-2 higher than first (ledger advanced automatically)

#### Step 2: Create Source Account (Alice)

Create the account that will fund and own the payment channel.

**Command:**

```bash
./scripts/rippled-create-account.sh "alice"
```

**Expected Output:**

```
✓ Account created successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Account Address:  rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
Master Seed:      snoPBrXtMeMyMHUVTgbuqAfg1SUTb
Public Key:       aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Save these credentials securely:**

- **Account Address**: Used for all RPC requests
- **Master Seed**: Used to sign transactions (KEEP SECRET)
- **Public Key**: Used for payment channel claim verification

#### Step 3: Create Destination Account (Bob)

Create the account that will receive payments from the channel.

**Command:**

```bash
./scripts/rippled-create-account.sh "bob"
```

**Expected Output:**

```
✓ Account created successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Account Address:  rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p
Master Seed:      ss6p3w4KjLhVZfgHMy5WVK3LhZXmQ
Public Key:       aBQG8RQAzjs1eTKFEAQXr2gS4utcDiEC9wmi7pfUPTi27VCahwgG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Save Bob's credentials for receiving payments.

#### Step 4: Fund Both Accounts

Fund accounts with sufficient XRP to create payment channels and cover reserves.

**Command (fund Alice with 10,000 XRP):**

```bash
./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 10000
```

**Wait 6 seconds for auto-ledger to advance**, then verify:

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_info",
    "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
  }'
```

**Expected Response:**

```json
{
  "result": {
    "account_data": {
      "Account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
      "Balance": "10000000000"
    }
  }
}
```

**Fund Bob with 1,000 XRP:**

```bash
./scripts/rippled-fund-account.sh rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p 1000
```

Wait 6 seconds and verify Bob's balance similarly.

**Minimum Reserve Requirements:**

- **Base Reserve**: 10 XRP (minimum account balance)
- **Owner Reserve**: 2 XRP per object (payment channel counts as 1 object)
- **Channel Amount**: Actual payment capacity

**Example**: To create 1000 XRP payment channel, Alice needs:

- 10 XRP (base reserve)
- 2 XRP (channel owner reserve)
- 1000 XRP (channel amount)
- **Total: 1012 XRP minimum**

#### Step 5: Create Payment Channel Transaction JSON

Construct `PaymentChannelCreate` transaction to open payment channel from Alice to Bob.

**Transaction Structure:**

```json
{
  "TransactionType": "PaymentChannelCreate",
  "Account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
  "Destination": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p",
  "Amount": "1000000000",
  "SettleDelay": 3600,
  "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
}
```

**Field Explanations:**

- **TransactionType**: `PaymentChannelCreate` (creates new payment channel)
- **Account**: Alice's address (channel source, who funds the channel)
- **Destination**: Bob's address (channel destination, who receives payments)
- **Amount**: Channel capacity in drops (1000000000 drops = 1000 XRP)
- **SettleDelay**: Time in seconds before channel can be closed (3600 = 1 hour)
- **PublicKey**: Alice's public key for signing claims

**SettleDelay Purpose**: Prevents Alice from immediately closing channel after Bob receives signed claim. Gives Bob time to submit claims before channel closes.

#### Step 6: Sign and Submit PaymentChannelCreate Transaction

Use `sign` RPC method to sign transaction with Alice's master seed, then submit to ledger.

**Sign Transaction:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "sign",
    "params": [{
      "secret": "snoPBrXtMeMyMHUVTgbuqAfg1SUTb",
      "tx_json": {
        "TransactionType": "PaymentChannelCreate",
        "Account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
        "Destination": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p",
        "Amount": "1000000000",
        "SettleDelay": 3600,
        "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
      }
    }]
  }'
```

**Response includes `tx_blob` (signed transaction):**

```json
{
  "result": {
    "tx_blob": "1200102200000000240000000361D4838D7EA4C6800...",
    "hash": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0"
  }
}
```

**Submit Signed Transaction:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "submit",
    "params": [{
      "tx_blob": "1200102200000000240000000361D4838D7EA4C6800..."
    }]
  }'
```

**Save transaction hash** for verification.

**Wait 6 seconds for auto-ledger to advance** (transaction pending until ledger closes).

#### Step 7: Verify Payment Channel Created

Query Alice's account to confirm payment channel exists and has correct parameters.

**Command:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{
      "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"
    }]
  }'
```

**Expected Response:**

```json
{
  "result": {
    "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
    "channels": [
      {
        "channel_id": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
        "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
        "destination_account": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p",
        "amount": "1000000000",
        "balance": "0",
        "settle_delay": 3600,
        "public_key": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
      }
    ]
  }
}
```

**Copy `channel_id`** for next steps (used in claim transactions).

**Verify Channel Fields:**

- **amount**: 1000000000 drops (1000 XRP total capacity)
- **balance**: 0 (no claims settled yet)
- **destination_account**: Bob's address
- **settle_delay**: 3600 seconds (1 hour)

#### Step 8: Create Off-Ledger Payment Claim

Generate signed payment claim for Bob without submitting to ledger. This demonstrates the key value of payment channels: off-ledger payments.

**Claim Structure:**

A claim consists of:

- **Channel ID**: Identifies which payment channel
- **Amount**: Total amount claimed so far (cumulative, not incremental)
- **Signature**: Alice's signature proving authorization

**Example: Claim 100 XRP from 1000 XRP channel**

The claim signature is generated by Alice and sent to Bob through ILP packet. Bob can validate the signature off-ledger or submit to ledger to settle.

**In production**: M2M connectors handle claim generation and validation automatically. For this tutorial, we demonstrate the concept:

```typescript
// Pseudocode - actual implementation in Epic 9
const claim = {
  channelID: 'E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0',
  amount: '100000000', // 100 XRP in drops
  signature: signPaymentChannelClaim(channelID, amount, aliceMasterSeed),
};
```

**Off-ledger validation**: Bob verifies signature matches Alice's public key without submitting to blockchain.

**Key Benefit**: Unlimited off-ledger payments with zero transaction fees until settlement.

#### Step 9: Submit Claim to Settle 100 XRP

Bob submits payment channel claim to settle 100 XRP on-ledger.

**Claim Transaction:**

```json
{
  "TransactionType": "PaymentChannelClaim",
  "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "Amount": "100000000",
  "Signature": "<alice-signature>",
  "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
}
```

**Sign and submit** (using Bob's master seed):

```bash
# Sign transaction
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "sign",
    "params": [{
      "secret": "ss6p3w4KjLhVZfgHMy5WVK3LhZXmQ",
      "tx_json": {
        "TransactionType": "PaymentChannelClaim",
        "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
        "Amount": "100000000"
      }
    }]
  }'

# Submit signed transaction (after 6 seconds)
# ... submit tx_blob ...
```

**Wait for ledger advancement**, then verify Bob's balance increased by 100 XRP:

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_info",
    "params": [{"account": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p"}]
  }'
```

**Verify channel balance reduced to 900 XRP:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
  }'
```

Expected: `"balance": "100000000"` (100 XRP claimed), `"amount": "1000000000"` (1000 XRP total capacity)

#### Step 10: Close Payment Channel

Close the payment channel to return remaining funds to Alice.

**Option 1: Immediate Close (after expiration)**

If current ledger time > `expiresAt`, Alice can close immediately:

```json
{
  "TransactionType": "PaymentChannelClaim",
  "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "Flags": 2147483648
}
```

**Flags: 2147483648** = `tfClose` flag (close channel immediately)

**Option 2: Request Close (before expiration)**

Alice requests close, must wait `SettleDelay` seconds:

```json
{
  "TransactionType": "PaymentChannelClaim",
  "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "Flags": 65536
}
```

**Flags: 65536** = `tfRequestClose` flag (request close, wait SettleDelay)

After `SettleDelay` seconds, submit close transaction with `tfClose` flag.

**Verify channel removed:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
  }'
```

Expected: `"channels": []` (channel closed, no longer exists)

**Verify Alice receives remaining balance:**

Check Alice's account balance increased by 900 XRP (1000 - 100 claimed).

#### Common Pitfalls and Tips

**Pitfall 1: Insufficient XRP for payment channel creation**

- **Always fund above minimum reserve**: 10 XRP base + 2 XRP channel + channel amount
- Example: 1000 XRP channel requires 1012+ XRP minimum
- Funding transaction fails if balance below reserve

**Pitfall 2: Payment channel destination tag confusion**

- Payment channels use account addresses, NOT destination tags
- Destination tags are for payment transactions, not channels

**Pitfall 3: Claims must be signed with channel source account**

- **Alice signs claims**, not Bob
- Bob submits claims with Alice's signature
- Mismatched signature → transaction rejected

**Pitfall 4: Forgetting settle delay timing**

- **SettleDelay** prevents immediate channel close
- Test different settle delays: 60 seconds (testing), 3600 seconds (production)
- Expiration vs close request: different timing behaviors

**Pitfall 5: Not using auto-ledger for continuous testing**

- **Manual ledger advancement** tedious for multi-step workflows
- Use `make dev-up-auto-ledger` for automatic 5-second advancement
- Switch to manual only for debugging precise ledger states

**Tip: Save account credentials in .env.test**

```bash
# .env.test (DO NOT COMMIT)
ALICE_ADDRESS=rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
ALICE_SECRET=snoPBrXtMeMyMHUVTgbuqAfg1SUTb
BOB_ADDRESS=rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p
BOB_SECRET=ss6p3w4KjLhVZfgHMy5WVK3LhZXmQ
```

Reuse accounts across test runs for consistent testing.

### Debugging Workflows

#### Debugging Smart Contract Issues

**Use Foundry's verbose trace flags** for detailed execution inspection:

**Level 1: Basic logs (-v)**

```bash
forge test -v
```

Shows test results and console.log() outputs.

**Level 2: Event logs (-vv)**

```bash
forge test -vv
```

Shows test results, logs, and emitted events.

**Level 3: Failed test traces (-vvv)**

```bash
forge test -vvv
```

Shows stack traces for failed tests (most useful).

**Level 4: All test traces (-vvvv)**

```bash
forge test -vvvv
```

Shows complete stack traces for ALL tests (very verbose).

**Check Anvil logs** for transaction details:

```bash
docker logs anvil_base_local
```

Shows: Transaction hashes, block numbers, gas used, contract deployments, function calls.

**Query contract state** with cast:

```bash
# Check balance
cast balance <contract-address> --rpc-url http://localhost:8545

# Call view function
cast call <contract-address> "getBalance()" --rpc-url http://localhost:8545

# Call with parameters
cast call <contract-address> "balanceOf(address)" <wallet-address> --rpc-url http://localhost:8545
```

**Foundry debugger** for interactive debugging:

```bash
forge test --debug testFunctionName
```

Opens interactive TUI debugger with:

- Step through execution line-by-line
- Inspect stack, memory, storage
- View opcode execution
- Identify exact revert location

#### Debugging rippled Payment Channels

**Check transaction status** with `tx` RPC method:

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "tx",
    "params": [{
      "transaction": "<transaction-hash>"
    }]
  }'
```

Shows: Transaction result, validated status, metadata, ledger index.

**View account payment channels:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{"account": "<account-address>"}]
  }'
```

Shows all payment channels owned by account.

**Inspect ledger state:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "ledger",
    "params": [{
      "ledger_index": "validated",
      "transactions": true
    }]
  }'
```

Shows: Ledger index, transaction list, state hash, close time.

**Enable rippled debug logging** (advanced):

Modify `rippled.cfg`:

```ini
[rpc_startup]
{ "command": "log_level", "severity": "debug" }
```

Restart rippled: `docker-compose restart rippled`

**Warning**: Debug logging is VERY verbose. Use only for deep debugging.

#### Common Debugging Scenarios

**Scenario 1: "Transaction reverted" (Solidity)**

**Symptom**: forge script or cast send fails with generic revert

**Debug Steps**:

1. Run with `-vvvv` to see revert reason:

   ```bash
   forge script Deploy.s.sol -vvvv --rpc-url http://localhost:8545
   ```

2. Check require() conditions in contract:

   ```solidity
   require(msg.value > 0, "Must fund channel"); // ← Revert reason here
   ```

3. Verify function parameters match expected types
4. Check account balance sufficient for transaction + gas

**Scenario 2: "Insufficient funds" (Anvil)**

**Symptom**: Transaction fails with out-of-gas or insufficient balance

**Debug Steps**:

1. Check account balance:

   ```bash
   cast balance <account> --rpc-url http://localhost:8545
   ```

2. Verify gas estimation:

   ```bash
   cast estimate <contract-address> "functionName()" --rpc-url http://localhost:8545
   ```

3. Fund account if needed (Anvil pre-funded accounts should have 10000 ETH)

**Scenario 3: "Invalid signature" (rippled payment channel)**

**Symptom**: PaymentChannelClaim rejected with signature error

**Debug Steps**:

1. Verify claim signed with channel **source** account (Alice), not destination (Bob)
2. Check claim amount doesn't exceed channel capacity
3. Verify channel ID matches `account_channels` output
4. Ensure public key in claim matches channel public key

**Scenario 4: "Payment channel not found" (rippled)**

**Symptom**: `account_channels` returns empty array after creation

**Debug Steps**:

1. Verify ledger advanced after transaction submission:

   ```bash
   ./scripts/rippled-advance-ledger.sh
   ```

2. Check transaction status:

   ```bash
   curl http://localhost:5005 -X POST -H 'Content-Type: application/json' \
     --data '{"method":"tx","params":[{"transaction":"<tx-hash>"}]}'
   ```

3. Verify transaction succeeded (not tesSUCCESS could mean validation failure)

**Scenario 5: "Ledger not advancing" (rippled)**

**Symptom**: Transactions pending indefinitely, balances not updating

**Debug Steps**:

1. Check auto-ledger container running:

   ```bash
   docker ps | grep rippled_ledger_advancer
   ```

2. Manually advance if auto-ledger not running:

   ```bash
   ./scripts/rippled-advance-ledger.sh
   ```

3. Restart with auto-ledger profile:
   ```bash
   make dev-up-auto-ledger
   ```

## Deploying Your First Smart Contract

### Prerequisites

Before deploying your first smart contract, ensure you have:

- **Foundry installed locally**: [Installation guide](https://book.getfoundry.sh/getting-started/installation)
- **Anvil running**: See [Quick Start](#quick-start-5-minutes) section
- **Basic Solidity knowledge**: Familiarity with contract structure and syntax

### Step 1: Install Foundry

Install Foundry toolchain (forge, cast, anvil) on your local machine:

**Command:**

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**Verify installation:**

```bash
forge --version
```

**Expected Output:**

```
forge 0.2.0 (abc123 2024-01-15T00:00:00.000000000Z)
```

**Troubleshooting**: If `foundryup` not found, restart terminal or add to PATH:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
```

### Step 2: Create New Foundry Project

Initialize a new Foundry project for your smart contracts:

**Command:**

```bash
forge init packages/contracts
cd packages/contracts
```

**Project Structure Created:**

```
packages/contracts/
├── src/              # Smart contract source files
├── test/             # Test files
├── script/           # Deployment scripts
├── lib/              # Dependencies (forge-std)
└── foundry.toml      # Foundry configuration
```

**Explanation**:

- **src/**: Where you write Solidity contracts
- **test/**: Co-located tests for each contract
- **script/**: Deployment and interaction scripts
- **lib/**: Dependencies installed via `forge install`

### Step 3: Write a Simple Storage Contract

Create a minimal smart contract to demonstrate deployment workflow.

**File: `packages/contracts/src/SimpleStorage.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SimpleStorage
/// @notice Stores and retrieves a single uint256 value
contract SimpleStorage {
    uint256 private storedValue;

    /// @notice Emitted when stored value changes
    event ValueChanged(uint256 newValue);

    /// @notice Set the stored value
    /// @param _value New value to store
    function setValue(uint256 _value) public {
        storedValue = _value;
        emit ValueChanged(_value);
    }

    /// @notice Get the current stored value
    /// @return The stored value
    function getValue() public view returns (uint256) {
        return storedValue;
    }
}
```

**Contract Explanation:**

- **State Variable**: `storedValue` persists between function calls (stored on blockchain)
- **Setter Function**: `setValue()` modifies state and emits event
- **Getter Function**: `getValue()` reads state (view function, no gas cost for external calls)
- **Event**: `ValueChanged` logs state changes for off-chain indexing

### Step 4: Write a Test for the Contract

Validate contract behavior with comprehensive tests before deployment.

**File: `packages/contracts/test/SimpleStorage.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SimpleStorage.sol";

contract SimpleStorageTest is Test {
    SimpleStorage public simpleStorage;

    function setUp() public {
        simpleStorage = new SimpleStorage();
    }

    function testSetValue() public {
        simpleStorage.setValue(42);
        assertEq(simpleStorage.getValue(), 42);
    }

    function testValueChangedEvent() public {
        vm.expectEmit(true, true, true, true);
        emit SimpleStorage.ValueChanged(100);
        simpleStorage.setValue(100);
    }

    function testInitialValueIsZero() public {
        assertEq(simpleStorage.getValue(), 0);
    }
}
```

**Test Explanation:**

- **setUp()**: Deploys fresh contract before each test
- **testSetValue()**: Verifies setValue() updates state correctly
- **testValueChangedEvent()**: Validates event emission
- **Assertions**: `assertEq()` compares expected vs actual values

### Step 5: Run Tests Locally

Execute tests against local Anvil to validate contract logic.

**Command:**

```bash
forge test --fork-url http://localhost:8545
```

**Expected Output:**

```
[⠢] Compiling...
[⠆] Compiling 3 files with 0.8.20
[⠰] Solc 0.8.20 finished in 823ms
Compiler run successful!

Running 3 tests for test/SimpleStorage.t.sol:SimpleStorageTest
[PASS] testInitialValueIsZero() (gas: 8234)
[PASS] testSetValue() (gas: 29876)
[PASS] testValueChangedEvent() (gas: 31245)
Test result: ok. 3 passed; 0 failed; finished in 1.45ms
```

**All tests passing** (green checkmarks) indicates contract ready for deployment.

**If tests fail:**

1. Review error messages for revert reasons
2. Use `-vvv` flag for detailed traces:

   ```bash
   forge test --fork-url http://localhost:8545 -vvv
   ```

3. Fix contract or test code and re-run

### Step 6: Create Deployment Script

Write deployment script to automate contract deployment.

**File: `packages/contracts/script/Deploy.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SimpleStorage.sol";

contract DeployScript is Script {
    function run() public {
        vm.startBroadcast();

        SimpleStorage simpleStorage = new SimpleStorage();
        console.log("SimpleStorage deployed at:", address(simpleStorage));

        // Optional: Initialize with value
        simpleStorage.setValue(42);
        console.log("Initial value set to:", simpleStorage.getValue());

        vm.stopBroadcast();
    }
}
```

**Script Explanation:**

- **vm.startBroadcast()**: Begin recording transactions for broadcast
- **new SimpleStorage()**: Deploy contract
- **console.log()**: Output deployment info
- **vm.stopBroadcast()**: Stop recording transactions

### Step 7: Deploy to Local Anvil

Deploy contract to your local Anvil node.

**Command:**

```bash
forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

**Expected Output:**

```
[⠢] Compiling...
No files changed, compilation skipped

Script ran successfully.
Gas used: 145623

== Logs ==
  SimpleStorage deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
  Initial value set to: 42

ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
Total Paid: 0.000145623 ETH (145623 gas * 1 gwei)
```

**Save the deployed contract address**: `0x5FbDB2315678afecb367f032d93F642f64180aa3`

**Verify deployment** succeeded:

```bash
cast code 0x5FbDB2315678afecb367f032d93F642f64180aa3 --rpc-url http://localhost:8545
```

**Expected**: Long bytecode hex string starting with `0x608060...` (contract deployed)

**If empty (`0x`)**: Deployment failed, check error messages

### Step 8: Interact with Deployed Contract

Test contract functionality by calling functions directly.

**Set value to 123:**

```bash
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "setValue(uint256)" 123 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://localhost:8545
```

**Expected Output:**

```
blockHash               0xabcdef1234567890...
blockNumber             20702369
transactionHash         0x1234567890abcdef...
status                  1 (success)
```

**Get value:**

```bash
cast call 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  "getValue()" \
  --rpc-url http://localhost:8545
```

**Expected Output:**

```
0x000000000000000000000000000000000000000000000000000000000000007b
```

**Decode hex output**: `0x7b` = 123 in decimal (matches value we set)

**Decode using cast:**

```bash
cast --to-dec 0x000000000000000000000000000000000000000000000000000000000000007b
```

Output: `123`

### Step 9: Verify Deployment with Connector Integration (Optional)

Integrate deployed contract with M2M connector for full-stack testing.

**Update connector configuration** (`packages/connector/config/development.yml`):

```yaml
blockchain:
  type: evm
  rpc_url: http://anvil:8545
  simple_storage_address: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
```

**Restart connector:**

```bash
make dev-reset
```

**Send test ILP packet** (if connector configured to interact with SimpleStorage):

```bash
npm run test:send-packet --connector=connector-a --amount=100
```

**Verify contract interaction** in Anvil logs:

```bash
docker logs -f anvil_base_local | grep setValue
```

Expected: Transaction logs showing `setValue()` function calls from connector.

## Creating Your First XRP Payment Channel

### Prerequisites

Before creating your first XRP payment channel, ensure you have:

- **rippled running in auto-ledger mode**: See [Quick Start](#quick-start-5-minutes) section
- **Basic XRP Ledger knowledge**: Familiarity with accounts, transactions, ledgers
- **curl or Postman**: For sending RPC requests

### Step 1: Verify rippled Auto-Ledger Running

Confirm rippled is running with automatic ledger advancement.

**Start rippled with auto-ledger:**

```bash
make dev-up-auto-ledger
```

**Check Docker containers:**

```bash
docker ps | grep rippled
```

**Expected Output:**

```
CONTAINER ID   IMAGE          COMMAND                  STATUS
abc123def456   rippled:1.12   "rippled --conf..."      Up 2 minutes (healthy)
def456abc789   rippled:1.12   "/bin/sh -c 'while..."   Up 2 minutes
```

**Verify auto-ledger container**: `rippled_ledger_advancer` should be running.

**Confirm ledgers advancing:**

```bash
# Get current ledger index
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"method":"server_info","params":[]}' | jq '.result.info.validated_ledger.seq'

# Wait 6 seconds
sleep 6

# Get ledger index again
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"method":"server_info","params":[]}' | jq '.result.info.validated_ledger.seq'
```

**Expected**: Second number is 1-2 higher than first (ledger advanced automatically).

### Step 2: Create Source Account (Alice)

Generate Alice's account, who will fund the payment channel.

**Command:**

```bash
./scripts/rippled-create-account.sh "alice"
```

**Expected Output:**

```
✓ Account created successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Account Address:  rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo
Master Seed:      snoPBrXtMeMyMHUVTgbuqAfg1SUTb
Public Key:       aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Copy and save securely:**

- **Account Address**: `rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo` (use in RPC requests)
- **Master Seed**: `snoPBrXtMeMyMHUVTgbuqAfg1SUTb` (sign transactions, KEEP SECRET)
- **Public Key**: `aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3` (payment channel verification)

**Deterministic Accounts**: Using passphrase "alice" always generates the same account. This enables reproducible testing across developer machines.

### Step 3: Create Destination Account (Bob)

Generate Bob's account, who will receive payments from the channel.

**Command:**

```bash
./scripts/rippled-create-account.sh "bob"
```

**Expected Output:**

```
✓ Account created successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Account Address:  rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p
Master Seed:      ss6p3w4KjLhVZfgHMy5WVK3LhZXmQ
Public Key:       aBQG8RQAzjs1eTKFEAQXr2gS4utcDiEC9wmi7pfUPTi27VCahwgG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Copy and save Bob's credentials** for later steps.

### Step 4: Fund Both Accounts

Fund Alice and Bob with sufficient XRP to create payment channels.

**Fund Alice with 10,000 XRP:**

```bash
./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 10000
```

**Wait 6 seconds** for auto-ledger to advance (transaction pending until ledger closes).

**Verify Alice balance:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_info",
    "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
  }' | jq '.result.account_data.Balance'
```

**Expected Output:**

```
"10000000000"
```

Balance in **drops** (1 XRP = 1,000,000 drops), so 10000000000 drops = 10,000 XRP.

**Fund Bob with 1,000 XRP:**

```bash
./scripts/rippled-fund-account.sh rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p 1000
```

Wait 6 seconds and verify Bob's balance similarly.

### Step 5: Create Payment Channel Transaction JSON

Construct `PaymentChannelCreate` transaction structure.

**Transaction JSON:**

```json
{
  "TransactionType": "PaymentChannelCreate",
  "Account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
  "Destination": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p",
  "Amount": "1000000000",
  "SettleDelay": 3600,
  "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
}
```

**Field Explanations:**

- **TransactionType**: `PaymentChannelCreate` creates new payment channel
- **Account**: Alice's address (source, who funds the channel)
- **Destination**: Bob's address (destination, who receives payments)
- **Amount**: Channel capacity in drops (1000000000 drops = 1000 XRP)
- **SettleDelay**: Time in seconds before channel can be closed (3600 = 1 hour)
  - **Purpose**: Prevents Alice from immediately closing channel after Bob receives signed claim
  - **Gives Bob time** to submit claims to ledger before channel closes
- **PublicKey**: Alice's public key for signing off-ledger claims

### Step 6: Sign and Submit PaymentChannelCreate Transaction

Sign transaction with Alice's master seed and submit to rippled.

**Sign Transaction:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "sign",
    "params": [{
      "secret": "snoPBrXtMeMyMHUVTgbuqAfg1SUTb",
      "tx_json": {
        "TransactionType": "PaymentChannelCreate",
        "Account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
        "Destination": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p",
        "Amount": "1000000000",
        "SettleDelay": 3600,
        "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
      }
    }]
  }'
```

**Response includes `tx_blob` (signed transaction binary):**

```json
{
  "result": {
    "tx_blob": "1200102200000000240000000361D4838D7EA4C6800...",
    "tx_json": {
      "hash": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0"
    }
  }
}
```

**Save transaction hash**: `E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0`

**Submit Signed Transaction:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "submit",
    "params": [{
      "tx_blob": "1200102200000000240000000361D4838D7EA4C6800..."
    }]
  }'
```

**Wait 6 seconds** for auto-ledger to advance (transaction pending until ledger closes).

### Step 7: Verify Payment Channel Created

Query Alice's account to confirm payment channel exists with correct parameters.

**Command:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{
      "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"
    }]
  }'
```

**Expected Response:**

```json
{
  "result": {
    "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
    "channels": [
      {
        "channel_id": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
        "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
        "destination_account": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p",
        "amount": "1000000000",
        "balance": "0",
        "settle_delay": 3600,
        "public_key": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
      }
    ]
  }
}
```

**Copy channel ID** for next steps: `E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0`

**Verify Channel Fields:**

- **amount**: `"1000000000"` (1000 XRP total capacity)
- **balance**: `"0"` (no claims settled yet, full capacity available)
- **destination_account**: Bob's address
- **settle_delay**: `3600` (1 hour in seconds)

### Step 8: Create Off-Ledger Payment Claim

Generate signed payment claim for Bob without submitting to ledger (demonstrates off-ledger payments).

**Claim Concept:**

Payment channels enable unlimited off-ledger payments by exchanging signed claims:

1. **Alice signs claim**: "I authorize Bob to claim up to 100 XRP from channel X"
2. **Bob receives claim**: Via ILP packet (off-ledger, instant, zero fees)
3. **Bob validates signature**: Verifies Alice's signature matches channel public key
4. **Bob can submit to ledger**: Anytime before channel closes to settle on-chain

**Key Benefit**: Unlimited off-ledger payments with zero transaction fees until settlement.

**Example Claim Structure (pseudocode):**

```typescript
const claim = {
  channelID: 'E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0',
  amount: '100000000', // 100 XRP in drops (cumulative, not incremental)
  signature: signPaymentChannelClaim(channelID, amount, aliceMasterSeed),
};
```

**Actual implementation** handled by M2M connectors in Epic 9. For this tutorial, we demonstrate on-ledger settlement in next step.

### Step 9: Submit Claim to Settle 100 XRP

Bob submits payment channel claim to settle 100 XRP on-ledger.

**Claim Transaction JSON:**

```json
{
  "TransactionType": "PaymentChannelClaim",
  "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "Amount": "100000000",
  "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
}
```

**Sign and Submit (using Bob's master seed):**

```bash
# Sign claim transaction
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "sign",
    "params": [{
      "secret": "ss6p3w4KjLhVZfgHMy5WVK3LhZXmQ",
      "tx_json": {
        "TransactionType": "PaymentChannelClaim",
        "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
        "Amount": "100000000",
        "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3"
      }
    }]
  }'

# Submit signed transaction (extract tx_blob from response)
# ... wait 6 seconds for ledger advancement ...
```

**Verify Bob's balance increased by 100 XRP:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_info",
    "params": [{"account": "rDN4runBKs5wtvPfj8LzKc8SfqmXhcuN6p"}]
  }' | jq '.result.account_data.Balance'
```

**Expected**: Balance increased from 1000000000 to 1100000000 (1000 XRP + 100 XRP claim)

**Verify channel balance reduced to 900 XRP:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
  }' | jq '.result.channels[0]'
```

**Expected Response:**

```json
{
  "channel_id": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "amount": "1000000000",
  "balance": "100000000",
  "settle_delay": 3600
}
```

**balance** updated to `"100000000"` (100 XRP claimed), **amount** still `"1000000000"` (total capacity unchanged).

### Step 10: Close Payment Channel

Close the payment channel to return remaining funds to Alice.

**Option 1: Immediate Close (after expiration)**

If current ledger time > channel expiration time, Alice can close immediately.

**Close Transaction:**

```json
{
  "TransactionType": "PaymentChannelClaim",
  "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "Flags": 2147483648
}
```

**Flags: 2147483648** = `tfClose` flag (close channel immediately)

**Option 2: Request Close (before expiration)**

If channel not expired, Alice must request close and wait `SettleDelay` seconds.

**Request Close Transaction:**

```json
{
  "TransactionType": "PaymentChannelClaim",
  "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
  "Flags": 65536
}
```

**Flags: 65536** = `tfRequestClose` flag (request close, wait SettleDelay)

After `SettleDelay` seconds (3600 = 1 hour), submit close transaction with `tfClose` flag.

**Sign and Submit Close Transaction (using Alice's secret):**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "sign",
    "params": [{
      "secret": "snoPBrXtMeMyMHUVTgbuqAfg1SUTb",
      "tx_json": {
        "TransactionType": "PaymentChannelClaim",
        "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0",
        "Flags": 65536
      }
    }]
  }'

# Submit tx_blob, wait for ledger advancement
```

**Verify channel removed:**

```bash
curl http://localhost:5005 -X POST \
  -H 'Content-Type: application/json' \
  --data '{
    "method": "account_channels",
    "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
  }'
```

**Expected Response:**

```json
{
  "result": {
    "account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo",
    "channels": []
  }
}
```

**Empty channels array** confirms channel closed successfully.

**Verify Alice receives remaining balance:**

Check Alice's account balance increased by 900 XRP (1000 - 100 claimed).

## Aptos Local Testnet Setup

### What is Aptos Local Testnet?

Aptos local testnet is a self-contained Aptos blockchain running in Docker, providing:

- **Instant finality**: Transactions confirm immediately
- **Free transactions**: No gas costs during development
- **Isolated environment**: No network dependencies after Docker image download
- **Move development**: Full support for Move module compilation and deployment

**Purpose in M2M Project:**

Aptos local testnet completes the tri-chain development infrastructure for Epic 13 (Aptos Payment Channels). Developers can deploy and test payment_channel Move modules locally alongside existing Anvil (EVM) and rippled (XRP) services.

### Aptos Configuration

Aptos is configured in `docker-compose-dev.yml` with the following settings:

| Configuration       | Value                                   | Purpose                                 |
| ------------------- | --------------------------------------- | --------------------------------------- |
| **Image**           | `aptoslabs/tools:nightly`               | Official Aptos tools image              |
| **Platform**        | `linux/amd64`                           | Apple Silicon compatibility via Rosetta |
| **Node API Port**   | `8080`                                  | REST API for transactions and queries   |
| **Faucet Port**     | `8081`                                  | Fund test accounts                      |
| **Start Period**    | `60s`                                   | Allow time for Aptos initialization     |
| **Contracts Mount** | `./packages/contracts-aptos:/contracts` | Move module access (read-only)          |

**Environment Variables (configured in `.env.dev`):**

```bash
# Aptos image configuration
APTOS_IMAGE_TAG=nightly

# Port overrides (if 8080/8081 conflict with other services)
APTOS_NODE_PORT=8080
APTOS_FAUCET_PORT=8081

# Aptos RPC URLs (for host machine access)
APTOS_NODE_URL=http://localhost:8080/v1
APTOS_FAUCET_URL=http://localhost:8081
```

### Starting Aptos Local Testnet

**Start just Aptos:**

```bash
docker-compose -f docker-compose-dev.yml up -d aptos-local

# Or use Makefile
make aptos-up
```

**Start with Indexer API (optional, more resources required):**

```bash
docker-compose -f docker-compose-dev.yml --profile aptos-indexed up -d
```

**Wait for health check:**

```bash
# Check status
docker-compose -f docker-compose-dev.yml ps aptos-local

# NAME          STATUS          PORTS
# aptos-local   healthy         0.0.0.0:8080->8080/tcp, 0.0.0.0:8081->8081/tcp
```

### Connecting to Aptos

#### RPC Endpoints

- **From host machine**: `http://localhost:8080/v1`
- **From Docker containers**: `http://aptos-local:8080/v1`

#### Test Connection

```bash
# Get node info
curl -s http://localhost:8080/v1 | jq .
```

**Expected output:**

```json
{
  "chain_id": 4,
  "epoch": "1",
  "ledger_version": "0",
  "node_role": "full_node",
  "block_height": "0"
}
```

### Testing Aptos

#### Test 1: Get Node Info

```bash
curl -s http://localhost:8080/v1 | jq .
```

#### Test 2: Fund an Account via Faucet

```bash
# Using helper script
./scripts/aptos-fund-account.sh 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Using curl directly
curl -X POST http://localhost:8081/mint \
  -H "Content-Type: application/json" \
  -d '{"address":"0x1234...","amount":100000000}'
```

#### Test 3: Deploy Move Module

```bash
# Deploy payment_channel module
./scripts/aptos-deploy-module.sh
```

### Aptos Helper Scripts

| Script                             | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `./scripts/init-aptos-local.sh`    | Initialize and verify local testnet     |
| `./scripts/aptos-fund-account.sh`  | Fund account via faucet (default 1 APT) |
| `./scripts/aptos-deploy-module.sh` | Deploy payment_channel Move module      |

### Port Conflict Resolution

If ports 8080/8081 are in use by other services:

```bash
# Set custom ports in .env.dev or export before starting
export APTOS_NODE_PORT=18080
export APTOS_FAUCET_PORT=18081
docker-compose -f docker-compose-dev.yml up -d aptos-local

# Update your scripts/tests to use new ports
export APTOS_NODE_URL=http://localhost:18080/v1
export APTOS_FAUCET_URL=http://localhost:18081
```

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

### Issue: Smart contract deployment fails with 'invalid chain id'

**Symptoms:**

- `forge script` fails with chain ID mismatch error
- Error message: "invalid chain id" or "expected X, got Y"

**Problem:** Anvil not started with --optimism flag or wrong chain ID configured

**Solution:**

1. Verify Anvil started with correct flags in `docker-compose-dev.yml`:

   ```yaml
   command:
     - anvil
     - --fork-url=${BASE_SEPOLIA_RPC_URL}
     - --fork-block-number=${FORK_BLOCK_NUMBER}
     - --chain-id=84532
     - --optimism
   ```

2. Check current chain ID:

   ```bash
   curl -X POST http://localhost:8545 \
     -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
   ```

   **Expected**: `{"result":"0x14a34"}` (84532 in hex)

3. If wrong chain ID, restart Anvil:
   ```bash
   make dev-reset
   ```

### Issue: Contract deployment succeeds but contract doesn't work

**Symptoms:**

- Contract deployed successfully but function calls revert
- Contract returns unexpected values or reverts with no reason
- Previously working contract suddenly stops functioning

**Problem:** Contract state not persisted (Anvil restarted) or using wrong RPC URL

**Solution:**

1. Verify Anvil still running:

   ```bash
   docker ps | grep anvil
   ```

2. Check contract bytecode exists at deployment address:

   ```bash
   cast code <contract-address> --rpc-url http://localhost:8545
   ```

   **Expected**: Long hex string starting with `0x608060...`
   **If `0x`**: Contract doesn't exist, Anvil was reset

3. Redeploy contract if Anvil was reset:
   ```bash
   forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
   ```

**Note**: Anvil uses ephemeral storage by default. All state is lost on container restart. This is intentional for clean development environment.

### Issue: Gas estimation fails with 'execution reverted'

**Symptoms:**

- `forge script` or `cast send` fails during gas estimation phase
- Error: "execution reverted" before transaction is submitted
- Transaction would fail if submitted

**Problem:** Contract require() condition failing or insufficient account funds

**Solution:**

1. Run with `-vvvv` flag to see revert reason:

   ```bash
   forge script Deploy.s.sol -vvvv --rpc-url http://localhost:8545
   ```

   Output shows exact require() condition that failed.

2. Check account balance sufficient for transaction + gas:

   ```bash
   cast balance <account> --rpc-url http://localhost:8545
   ```

   Expected: At least 1 ETH (Anvil pre-funded accounts have 10000 ETH)

3. Review contract require() conditions:

   ```solidity
   require(msg.value > 0, "Must fund channel"); // ← Check this condition
   require(recipient != address(0), "Invalid recipient"); // ← And this
   ```

4. Verify function parameters match expected types and values

### Issue: Payment channel creation fails with 'insufficient XRP'

**Symptoms:**

- `PaymentChannelCreate` transaction fails with "insufficient XRP" or "unfunded" error
- Transaction rejected before submission
- Account has XRP but channel creation still fails

**Problem:** Account balance below minimum reserve + channel amount

**Solution:**

1. Calculate minimum required balance:
   - **Base Reserve**: 10 XRP (minimum account balance)
   - **Owner Reserve**: 2 XRP per payment channel object
   - **Channel Amount**: Actual channel capacity
   - **Example**: 1000 XRP channel needs 10 + 2 + 1000 = **1012 XRP minimum**

2. Verify Alice's balance exceeds minimum:

   ```bash
   curl http://localhost:5005 -X POST \
     -H 'Content-Type: application/json' \
     --data '{
       "method": "account_info",
       "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
     }' | jq '.result.account_data.Balance'
   ```

   Balance should be > `1012000000` drops (1012 XRP)

3. Fund account if needed:
   ```bash
   ./scripts/rippled-fund-account.sh rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo 1100
   ./scripts/rippled-advance-ledger.sh
   ```

### Issue: Payment channel claim rejected with 'invalid signature'

**Symptoms:**

- `PaymentChannelClaim` transaction fails with signature error
- Error: "temBAD_SIGNATURE" or "invalid signature"
- Claim transaction submitted but rejected by rippled

**Problem:** Claim signed with wrong private key or malformed claim structure

**Solution:**

1. Verify claim signed by channel **source** account (Alice), not destination (Bob):
   - Alice creates and signs claims (off-ledger)
   - Bob submits claims with Alice's signature (on-ledger)
   - Signature must match channel's public key

2. Check claim amount doesn't exceed channel balance:

   ```bash
   curl http://localhost:5005 -X POST \
     -H 'Content-Type: application/json' \
     --data '{
       "method": "account_channels",
       "params": [{"account": "rN7n7otQDd6FczFgLdlqtyMVrn3qHwuSUo"}]
     }' | jq '.result.channels[0]'
   ```

   **amount** (total capacity) must be >= claim amount
   **balance** (already claimed) + new claim <= amount

3. Verify channel ID in claim matches `account_channels` output:
   ```json
   {
     "TransactionType": "PaymentChannelClaim",
     "Channel": "E08D6E9754025BA2534A78707605E0601F03ACE063687A0CA1BDDACFCD1698C0", // ← Must match
     "Amount": "100000000",
     "PublicKey": "aB44YfzW24VDEJQ2UuLPV2PvqcPCSoLnL7y5M1EzhdW4LnK5xMS3" // ← Must match channel public key
   }
   ```

### Issue: Payment channel not found after creation

**Symptoms:**

- `account_channels` returns empty array after PaymentChannelCreate
- Channel creation transaction submitted successfully
- No channel exists when querying account

**Problem:** Ledger not advanced after transaction submission

**Solution:**

1. Verify auto-ledger running:

   ```bash
   docker ps | grep rippled_ledger_advancer
   ```

   **Expected**: Container running with status "Up X minutes"

2. Manually advance ledger if auto-ledger not running:

   ```bash
   ./scripts/rippled-advance-ledger.sh
   ```

3. Check transaction status to verify it succeeded:

   ```bash
   curl http://localhost:5005 -X POST \
     -H 'Content-Type: application/json' \
     --data '{
       "method": "tx",
       "params": [{"transaction": "<transaction-hash>"}]
     }'
   ```

   **Expected**: `"validated": true` and `"TransactionResult": "tesSUCCESS"`
   **If not tesSUCCESS**: Transaction failed validation, check error code

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

### Q: What's the difference between Base Sepolia testnet and Base mainnet for Epic 8?

**A:** Base Sepolia (testnet) is recommended for Epic 8 development for several reasons:

**Base Sepolia (testnet) benefits:**

- **Free testnet ETH** from faucets (no real money required)
- **2-second block time** (same as mainnet, realistic testing)
- **Smaller state size** (~5GB vs 50GB+ for mainnet fork)
- **Safe for mistakes** (no financial risk if something goes wrong)
- **Identical behavior** to mainnet (same OP Stack configuration)

**Base mainnet (production):**

- Use **only after** testnet validation and security audit
- Real ETH required for gas fees (financial risk)
- Larger state size (slower fork downloads)
- Production-grade monitoring required

**Anvil can fork either**, but testnet is recommended for cost and safety during development.

### Q: Should I use Anvil or public Base Sepolia RPC for Epic 8 development?

**A:** Use **Anvil for rapid local development**, switch to **public Base Sepolia for integration testing**:

**Use Anvil for local development:**

- **Instant block confirmation** (no 2-second wait)
- **Unlimited RPC requests** (no rate limits)
- **Offline development** after initial fork download
- **Zero gas costs** (unlimited experimentation)
- **Deterministic state** (reproducible across machines)

**Use public Base Sepolia for integration testing:**

- **Realistic network conditions** (block time, gas estimation, network latency)
- **External visibility** (team members can verify deployments on BaseScan)
- **Persistence** (contracts remain deployed across sessions)
- **Production-like environment** (catches network-specific issues)

**Best Practice**: Develop and test on Anvil (fast iteration), then deploy to Base Sepolia for final validation before mainnet.

### Q: Can I use Hardhat instead of Foundry/Anvil for Epic 8?

**A:** Foundry/Anvil is the recommended and supported toolchain for M2M because:

**Foundry/Anvil advantages:**

- **2-3x faster test execution** (native Rust vs JavaScript/TypeScript)
- **Better gas optimization tooling** (`forge snapshot` for gas analysis)
- **Native Solidity test framework** (no JavaScript/TypeScript needed)
- **Excellent Base L2 / OP Stack support** with `--optimism` flag
- **Built-in fuzzing and invariant testing**
- **Faster compilation** (Rust compiler)

**A:** Hardhat is also excellent and can work, but:

- M2M documentation assumes Foundry
- Hardhat requires JavaScript/TypeScript for tests
- Slightly slower test execution
- Additional configuration for OP Stack compatibility

If you prefer Hardhat, it will work, but you'll need to adapt documentation examples.

### Q: Why use rippled standalone instead of XRPL Testnet for Epic 9?

**A:** rippled standalone provides significant benefits for Epic 9 development:

**Standalone mode benefits:**

- **Instant confirmations** (no 3-5 second consensus delay)
- **Offline development** (no internet or testnet availability required)
- **Full control over ledger state and timing** (manual or auto advancement)
- **Reset capability** (clean genesis ledger for each test run)
- **Zero transaction fees** (testnet still charges small fees)
- **Reproducible state** (same genesis across all developer machines)

**XRPL Testnet:**

- Use for **final integration testing** before mainnet
- Realistic network conditions (consensus, fee pressure, network latency)
- Public visibility (external validators)

**Best Practice**: Develop and test on standalone (fast iteration), then test on XRPL Testnet for final validation before mainnet.

### Q: What's the minimum XRP balance needed to create a payment channel?

**A:** Account must have sufficient XRP to cover **all reserves and channel amount**:

**Reserve Requirements:**

- **Base Reserve**: 10 XRP (minimum account balance for any account)
- **Owner Reserve**: 2 XRP per object (payment channel counts as 1 object)
- **Channel Amount**: The actual payment capacity (e.g., 1000 XRP)

**Example Calculation:**

For a 1000 XRP payment channel:

- 10 XRP (base reserve)
- 2 XRP (channel owner reserve)
- 1000 XRP (channel amount)
- **Total: 1012 XRP minimum**

**If account balance drops below reserve**, payment channel creation fails with "insufficient XRP" error.

**Best Practice**: Fund test accounts generously with `./scripts/rippled-fund-account.sh` to avoid reserve issues.

### Q: How do I test Epic 8 (EVM) and Epic 9 (XRP) simultaneously?

**A:** Use `make dev-up-all` to start all blockchain services simultaneously:

**Command:**

```bash
make dev-up-all
```

**This starts:**

- Anvil (Base L2 fork on port 8545)
- rippled (XRP Ledger standalone on port 5005)
- Dashboard (network visualization on port 9000)
- Auto-ledger (automatic XRPL ledger advancement every 5 seconds)

**Multi-chain development workflow:**

- Connectors can interact with both Anvil (port 8545) and rippled (port 5005)
- Dashboard visualizes packet routing across both blockchains
- Test cross-chain settlement workflows
- Validate multi-ledger connector behavior

**Resource Usage**: ~4GB RAM total, acceptable for most development machines

**Alternative**: Start services individually if RAM limited:

```bash
# Epic 8 only
make dev-up  # Starts Anvil + connectors

# Epic 9 only
make dev-up-auto-ledger  # Starts rippled + auto-ledger + connectors
```

### Q: What happens if I restart Anvil? Do I lose deployed contracts?

**A:** YES - Anvil uses **ephemeral storage by default**:

**On Anvil restart:**

- **All deployed contracts lost** (addresses become empty)
- **Forked state re-downloaded** from BASE_SEPOLIA_RPC_URL (reverts to fork block)
- **Account balances reset** to default (10000 ETH per test account)
- **Transaction history cleared** (fresh chain)

**This is intentional** for clean development environment. Every restart gives you a pristine fork.

**Workaround for persistent storage** (not recommended for most use cases):

Add volume in `docker-compose-dev.yml`:

```yaml
anvil:
  volumes:
    - anvil-data:/root/.anvil
```

**Best Practice**: Accept ephemeral storage. Redeploy contracts quickly using `forge script` after restart.

### Q: What happens if I restart rippled? Do I lose payment channels?

**A:** NO - rippled uses **persistent volume** (`rippled_data`):

**On rippled restart:**

- **Ledger state preserved** (payment channels, account balances, transaction history)
- **Payment channels maintained** (channel IDs remain valid)
- **Account balances unchanged**
- **Transaction history retained**

**To reset rippled state** (clean genesis):

```bash
./scripts/rippled-reset.sh

# Or manually:
docker-compose -f docker-compose-dev.yml down
docker volume rm m2m_rippled_data
docker-compose -f docker-compose-dev.yml up -d rippled
```

**Best Practice**: Persistent state enables long-running payment channel tests without recreation.

### Q: How do I debug smart contract reverts on Anvil?

**A:** Foundry provides excellent debugging tools for contract reverts:

**Step 1: Run tests with -vvvv flag for detailed traces**

```bash
forge test -vvvv --match-test testFunctionName
```

Shows:

- Full transaction traces
- State changes
- Revert reasons with exact line numbers
- Stack traces

**Step 2: Use Foundry debugger for interactive debugging**

```bash
forge test --debug testFunctionName
```

Opens interactive TUI debugger:

- Step through execution line-by-line
- Inspect stack, memory, storage at each step
- View opcode execution
- Identify exact revert location

**Step 3: Check Anvil logs for transaction details**

```bash
docker logs anvil_base_local
```

Shows transaction hashes, gas used, contract events.

**Step 4: Query contract state with cast**

```bash
# Check specific state variable
cast call <address> "storedValue()" --rpc-url http://localhost:8545

# Check balance
cast balance <address> --rpc-url http://localhost:8545
```

**Common revert reasons:**

- Insufficient funds (account balance too low)
- Failed require() conditions (check contract logic)
- Wrong function parameters (type mismatch)
- Gas estimation failure (contract logic error)

### Q: How do I find recent Base Sepolia block numbers for forking?

**A:** Query Base Sepolia RPC for current block number:

**Step 1: Get current block (hex format)**

```bash
curl https://sepolia.base.org -X POST \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Expected Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x13c377f"
}
```

**Step 2: Convert hex to decimal**

```bash
echo $((16#13c377f))
```

**Output:** `20702367` (decimal block number)

**Step 3: Update FORK_BLOCK_NUMBER in .env.dev**

```bash
FORK_BLOCK_NUMBER=20702367
```

**Step 4: Restart Anvil to apply new fork block**

```bash
make dev-reset
```

**Best Practice**: Update fork block every **1-2 weeks** to track recent testnet state. Older fork blocks work fine but may miss recent contract deployments or state changes.

**Alternative**: Use BaseScan to find specific block by timestamp:

[BaseScan Sepolia Blocks](https://sepolia.basescan.org/blocks)

### Q: Can I use MetaMask with Anvil and rippled?

**A:** Anvil (yes), rippled (no direct support):

**Anvil + MetaMask (supported):**

MetaMask supports custom Ethereum networks:

1. Open MetaMask → Networks → Add Network Manually
2. Enter network details:
   - **Network Name**: Anvil Local (Base Sepolia Fork)
   - **RPC URL**: `http://localhost:8545`
   - **Chain ID**: `84532` (Base Sepolia)
   - **Currency Symbol**: ETH
3. Click "Save"
4. Import test account using Anvil private key:
   - **Private Key**: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Account #0)
5. Send transactions and deploy contracts via MetaMask

**rippled + MetaMask (not supported):**

XRP Ledger uses different signing model than Ethereum:

- **Different transaction types** (PaymentChannelCreate, PaymentChannelClaim)
- **Different signing algorithm** (secp256k1 vs ECDSA variations)
- **Different address format** (rXXX... vs 0xXXX...)

**Alternatives for XRPL:**

- **XRPL-compatible wallets**: Xaman (formerly Xumm), GemWallet
- **Configure custom server** in wallet settings to point to `http://localhost:5005`
- **Or use RPC methods directly** (sign, submit) for testing

MetaMask doesn't support XRPL transaction types, so use XRPL-specific tools.

## Environment Variable Reference

### Overview

Environment variables control blockchain node configuration, connector behavior, and development tooling. Understanding variable precedence and application ensures predictable development environments.

**Variable Precedence (highest to lowest):**

1. **Shell environment variables**: `export BASE_SEPOLIA_RPC_URL=https://custom.url`
2. **.env.dev file**: `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`
3. **Docker Compose defaults**: `${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}`

**When variables are loaded:**

- Container startup only (no hot-reload)
- Restart containers to apply changes: `make dev-reset` or `docker-compose restart`

**Verifying active values:**

```bash
docker exec <container-name> env | grep <VAR_NAME>
```

### Anvil Configuration Variables

Configure Anvil's blockchain forking and network behavior.

| Variable             | Default                  | Description                                          | Required | Example                                        |
| -------------------- | ------------------------ | ---------------------------------------------------- | -------- | ---------------------------------------------- |
| BASE_SEPOLIA_RPC_URL | https://sepolia.base.org | RPC endpoint for forking Base Sepolia state          | No       | https://base-sepolia.g.alchemy.com/v2/YOUR_KEY |
| FORK_BLOCK_NUMBER    | 20702367                 | Block number to fork from (pin for consistent state) | No       | 21000000                                       |

**Impact of changing variables:**

- **BASE_SEPOLIA_RPC_URL**: Different RPC provider affects fork download speed and rate limits
  - Public endpoint (sepolia.base.org): Free, rate-limited, slower
  - Alchemy/Infura: Free tier available, faster, higher rate limits
  - Update every 1-2 weeks to track recent testnet state

- **FORK_BLOCK_NUMBER**: Older blocks may miss recent contract deployments
  - Find recent block: `curl https://sepolia.base.org -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
  - Convert hex to decimal: `echo $((16#<hex-result>))`

**Link to Base Sepolia block explorer**: [BaseScan Sepolia](https://sepolia.basescan.org/)

### Connector Configuration Variables

Control connector logging, development features, and dashboard integration.

| Variable          | Default     | Description                                           | Required | Example    |
| ----------------- | ----------- | ----------------------------------------------------- | -------- | ---------- |
| LOG_LEVEL         | info        | Logging verbosity (debug, info, warn, error)          | No       | debug      |
| NODE_ENV          | development | Environment mode (enables hot-reload, debug features) | No       | production |
| DASHBOARD_ENABLED | false       | Enable dashboard telemetry emission                   | No       | true       |
| ENABLE_HOT_RELOAD | true        | Auto-restart connectors on code changes               | No       | false      |
| AUTO_RESTART      | true        | Restart connectors on crash during development        | No       | false      |

**Impact of changing variables:**

- **LOG_LEVEL**:
  - `debug`: Verbose logging (packet details, routing decisions, state changes)
  - `info`: Standard logging (connection events, transactions)
  - `warn`: Warnings only (potential issues)
  - `error`: Errors only (failures)
  - Use `debug` for development, `info` for production

- **ENABLE_HOT_RELOAD**:
  - `true`: Connectors auto-restart when source files change (faster development)
  - `false`: Manual restart required (use for performance testing, profiling)
  - Requires `nodemon` or similar file watcher

- **DASHBOARD_ENABLED**:
  - `true`: Connector emits telemetry to dashboard (visualize packet routing)
  - `false`: No telemetry emission (reduces overhead for testing)

### TigerBeetle Configuration Variables

Configure TigerBeetle distributed ledger behavior.

| Variable                  | Default | Description                                      | Required | Example              |
| ------------------------- | ------- | ------------------------------------------------ | -------- | -------------------- |
| TIGERBEETLE_CLUSTER_ID    | 0       | Unique cluster identifier (IMMUTABLE after init) | No       | 1                    |
| TIGERBEETLE_REPLICA_COUNT | 1       | Number of replicas (1=dev, 3-5=prod)             | No       | 3                    |
| TIGERBEETLE_PORT          | 3000    | Internal port (NOT exposed to host)              | No       | 3000                 |
| TIGERBEETLE_DATA_DIR      | /data   | Data directory inside container                  | No       | /var/lib/tigerbeetle |

**CRITICAL WARNING**: Changing `TIGERBEETLE_CLUSTER_ID` requires deleting volume (data loss).

**Impact of changing variables:**

- **TIGERBEETLE_CLUSTER_ID**:
  - Must be unique across all TigerBeetle clusters
  - **IMMUTABLE** after initialization (changing requires data wipe)
  - To change: `docker volume rm m2m_tigerbeetle_data && make dev-reset`

- **TIGERBEETLE_REPLICA_COUNT**:
  - `1` (development): Single replica, no fault tolerance
  - `3-5` (production): Quorum-based consensus, survives replica failures
  - Requires network coordination for multi-replica setups

### Network Mode Configuration (Testnet vs Local)

The `NETWORK_MODE` environment variable controls whether the test infrastructure connects to local Docker containers or public testnets. This is useful for ARM64 development (where some Docker images aren't available) or for production-like testing.

| Variable                 | Default                                   | Description                        | Required | Example                                        |
| ------------------------ | ----------------------------------------- | ---------------------------------- | -------- | ---------------------------------------------- |
| NETWORK_MODE             | local                                     | Network mode: `local` or `testnet` | No       | testnet                                        |
| APTOS_TESTNET_NODE_URL   | https://fullnode.testnet.aptoslabs.com/v1 | Aptos testnet full node URL        | No       | https://fullnode.testnet.aptoslabs.com/v1      |
| APTOS_TESTNET_FAUCET_URL | https://faucet.testnet.aptoslabs.com      | Aptos testnet faucet URL           | No       | https://faucet.testnet.aptoslabs.com           |
| XRP_TESTNET_WSS_URL      | wss://s.altnet.rippletest.net:51233       | XRP Testnet WebSocket URL          | No       | wss://s.altnet.rippletest.net:51233            |
| XRP_TESTNET_FAUCET_URL   | https://faucet.altnet.rippletest.net      | XRP Testnet faucet URL             | No       | https://faucet.altnet.rippletest.net           |
| BASE_SEPOLIA_RPC_URL     | https://sepolia.base.org                  | Base Sepolia RPC URL               | No       | https://base-sepolia.g.alchemy.com/v2/YOUR_KEY |

**Network Mode Behavior:**

- **`NETWORK_MODE=local` (default)**:
  - Connects to local Docker containers (Anvil, rippled, Aptos)
  - Uses genesis accounts for funding (XRP)
  - Uses Docker-internal hostnames (e.g., `http://aptos-local:8080`)
  - Instant block confirmation times
  - Best for rapid development iteration

- **`NETWORK_MODE=testnet`**:
  - Connects to public testnet endpoints
  - Uses public faucet APIs for funding accounts
  - Uses public testnet URLs (e.g., `https://fullnode.testnet.aptoslabs.com/v1`)
  - Real network latency (5-30 seconds for confirmations)
  - Best for ARM64 development or production-like testing

**Running Tests in Testnet Mode:**

```bash
# Run integration tests against public testnets
NETWORK_MODE=testnet npm run test:integration

# Run Docker agent tests against public testnets
NETWORK_MODE=testnet ./scripts/run-docker-agent-test.sh
```

**Timeout Adjustments:**

When using testnet mode, timeouts are automatically increased to accommodate network latency:

| Timeout Type     | Local Mode | Testnet Mode |
| ---------------- | ---------- | ------------ |
| Faucet Wait      | 5 seconds  | 30 seconds   |
| Transaction Wait | 10 seconds | 60 seconds   |
| Health Check     | 30 seconds | 60 seconds   |
| HTTP Request     | 10 seconds | 30 seconds   |

**Faucet Rate Limits:**

Public testnet faucets have rate limits:

- **Aptos Testnet**: ~1 request per minute per IP
- **XRP Testnet**: ~1 request per minute per IP
- **Base Sepolia**: Use external faucets (Coinbase faucet, etc.)

**Example: ARM64 Development Workflow:**

ARM64 (Apple Silicon, Raspberry Pi) may not have Docker images for all blockchain nodes. Use testnet mode:

```bash
# In .env.dev
NETWORK_MODE=testnet

# Start only the services that work on ARM64
docker-compose -f docker-compose-dev.yml up -d anvil

# Run tests against public testnets for missing services
NETWORK_MODE=testnet npm test
```

### Aptos Connector Settlement Variables

Variables for enabling Aptos payment channel settlement in the production connector (Story 28.5).

**Required when APTOS_ENABLED=true:**

| Variable                | Description                          | Required | Example                                   |
| ----------------------- | ------------------------------------ | -------- | ----------------------------------------- |
| APTOS_ENABLED           | Enable Aptos settlement              | Yes      | true                                      |
| APTOS_NODE_URL          | Aptos fullnode REST API URL          | Yes      | https://fullnode.testnet.aptoslabs.com/v1 |
| APTOS_PRIVATE_KEY       | Account private key (ed25519 hex)    | Yes      | 0xabcd1234...                             |
| APTOS_ACCOUNT_ADDRESS   | Account address (0x-prefixed)        | Yes      | 0x1234567890abcdef...                     |
| APTOS_CLAIM_PRIVATE_KEY | Claim signing private key (ed25519)  | Yes      | 0xefgh5678...                             |
| APTOS_MODULE_ADDRESS    | Deployed payment_channel module addr | Yes      | 0xmodule123...                            |

**Optional:**

| Variable                          | Default | Description                          | Example |
| --------------------------------- | ------- | ------------------------------------ | ------- |
| APTOS_SETTLEMENT_ENABLED          | true    | Feature flag to disable settlement   | false   |
| APTOS_CHANNEL_REFRESH_INTERVAL_MS | 30000   | Auto-refresh interval (milliseconds) | 60000   |
| APTOS_DEFAULT_SETTLE_DELAY        | 86400   | Default settle delay (seconds)       | 3600    |

**Example .env for Tri-Chain Settlement:**

```bash
# Enable Aptos settlement
APTOS_ENABLED=true
APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
APTOS_PRIVATE_KEY=0x<your-private-key>
APTOS_ACCOUNT_ADDRESS=0x<your-account-address>
APTOS_CLAIM_PRIVATE_KEY=0x<your-claim-private-key>
APTOS_MODULE_ADDRESS=0x<deployed-module-address>

# Optional: Customize refresh interval
APTOS_CHANNEL_REFRESH_INTERVAL_MS=30000

# Optional: Disable settlement (testing)
# APTOS_SETTLEMENT_ENABLED=false
```

**Validation Behavior:**

- If `APTOS_ENABLED=true` but required variables are missing, the connector logs a warning and continues without Aptos settlement support
- If `APTOS_SETTLEMENT_ENABLED=false`, Aptos settlement requests throw `SettlementDisabledError`
- The `AptosChannelSDK` auto-refresh is started during connector startup and stopped during shutdown

**Peer Configuration for Aptos Settlement:**

Peers supporting Aptos settlement must include `aptosAddress` and `aptosPubkey` fields:

```yaml
peers:
  - peerId: peer-alice
    address: g.alice
    settlementPreference: any # or 'aptos' for Aptos-only
    settlementTokens: ['USDC', 'XRP', 'APT']
    evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
    xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW'
    aptosAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    aptosPubkey: 'abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
```

**Technical Notes:**

- Aptos uses ed25519 private keys (not secp256k1 like Ethereum)
- APT token uses 8 decimal places (1 APT = 100,000,000 octas)
- Minimum production settle delay: 3600 seconds (1 hour)
- Module address must match the deployed payment_channel Move module

**Troubleshooting:**

| Issue                            | Solution                                              |
| -------------------------------- | ----------------------------------------------------- |
| `APTOS_MODULE_ADDRESS not set`   | Deploy Move module and set the module address         |
| `AptosChannelSDK not configured` | Ensure `APTOS_ENABLED=true` and all required vars set |
| `Peer missing aptosAddress`      | Add `aptosAddress` to peer config for APT settlement  |
| `Peer missing aptosPubkey`       | Add `aptosPubkey` (ed25519 public key) to peer config |
| `SettlementDisabledError`        | Unset or set `APTOS_SETTLEMENT_ENABLED=true`          |
| Connection timeout               | Verify `APTOS_NODE_URL` is reachable                  |
| Insufficient balance             | Fund account at https://faucet.testnet.aptoslabs.com  |

### Production-Specific Variables

Variables used in production environments (from `.env.production.example`).

| Variable                   | Default    | Description                                      | Required       | Example                |
| -------------------------- | ---------- | ------------------------------------------------ | -------------- | ---------------------- |
| NODE_ID                    | (required) | Unique connector identifier                      | Yes            | production-connector-1 |
| BTP_PORT                   | 3000       | BTP server port (exposed to host in production)  | No             | 4000                   |
| DASHBOARD_TELEMETRY_URL    | (empty)    | Dashboard WebSocket URL (leave empty to disable) | No             | ws://dashboard:9000    |
| BTP*PEER*<PEER_ID>\_SECRET | (required) | BTP peer authentication secret                   | Yes (per peer) | <generated-secret>     |

**BTP Peer Secret Naming Pattern:**

- Peer ID → uppercase → `BTP_PEER_CONNECTOR_B_SECRET`
- Example: `connector-b` → `BTP_PEER_CONNECTOR_B_SECRET`
- Each peer connection requires unique secret

**Security Best Practices:**

- Generate secrets with `openssl rand -base64 32`
- Store secrets in secure vault (AWS Secrets Manager, HashiCorp Vault)
- Never commit secrets to version control
- Rotate secrets periodically (30-90 days)

**Reference**: See Story 7.5 for complete production deployment documentation.

### Changing Environment Variables

Follow these steps to safely update environment variables.

**Step 1: Edit .env.dev file**

```bash
# Edit with your preferred editor
vim .env.dev

# Or use sed for single variable
sed -i '' 's/LOG_LEVEL=info/LOG_LEVEL=debug/' .env.dev
```

**Step 2: Restart affected services**

For **Anvil or rippled**:

```bash
# Restart specific service
docker-compose -f docker-compose-dev.yml restart anvil

# Or restart rippled
docker-compose -f docker-compose-dev.yml restart rippled
```

For **connectors**:

```bash
# Full reset ensures clean state
make dev-reset
```

For **TigerBeetle** (CRITICAL - changing cluster ID requires volume delete):

```bash
# ONLY if changing TIGERBEETLE_CLUSTER_ID
docker-compose -f docker-compose-dev.yml down
docker volume rm m2m_tigerbeetle_data
make dev-reset
```

**Step 3: Verify changes applied**

```bash
# Check container environment
docker exec <container-name> env | grep <VAR_NAME>

# Example: Verify Anvil fork block
docker exec anvil_base_local env | grep FORK_BLOCK_NUMBER
```

**Warning**: Some variables require container rebuild:

- `NODE_ENV`: Affects build process
- `ENABLE_HOT_RELOAD`: Requires different container command

Rebuild containers:

```bash
docker-compose -f docker-compose-dev.yml build
make dev-reset
```

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
