# Aptos Payment Channels Setup Guide

This guide explains how to set up and use Aptos blockchain payment channels with the M2M connector for settlement operations.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Aptos Account Creation](#aptos-account-creation)
4. [Move Module Deployment](#move-module-deployment)
5. [Environment Configuration](#environment-configuration)
6. [Using AptosClient](#using-aptosclient)
7. [Payment Channel Operations](#payment-channel-operations)
8. [Off-Chain Claim Signing](#off-chain-claim-signing)
9. [Channel Lifecycle Management](#channel-lifecycle-management)
10. [Security Best Practices](#security-best-practices)
11. [Troubleshooting](#troubleshooting)
12. [Architecture Overview](#architecture-overview)
13. [Local Development](#local-development)

## Overview

Aptos payment channels provide a high-throughput, low-latency settlement mechanism for ILP connectors using the Aptos blockchain. This implementation uses the official [@aptos-labs/ts-sdk](https://aptos.dev/sdks/ts-sdk/) wrapped in custom SDK classes.

**Key Features:**

- Sub-second finality (~400ms block time)
- Low transaction costs (~0.0001 APT per transaction)
- Ed25519 signature-based claim verification
- BCS-encoded message format matching Move module
- Automatic channel state refresh and caching
- Graceful error handling with typed error codes

**Why Aptos for AI Micropayments:**

| Feature                 | Aptos        | EVM (Ethereum) | XRP Ledger      |
| ----------------------- | ------------ | -------------- | --------------- |
| Block Time              | ~400ms       | ~12s           | ~4s             |
| Transaction Cost        | ~0.0001 APT  | Variable (gas) | ~0.00001 XRP    |
| Smart Contract Language | Move         | Solidity       | N/A             |
| Native Payment Channels | Module-based | Contract-based | Protocol-native |
| Finality                | Immediate    | Probabilistic  | Immediate       |

Aptos excels for AI micropayments due to its fast finality, predictable costs, and Move language safety guarantees.

## Prerequisites

- Node.js 20.11.0 LTS or higher
- Aptos CLI (`brew install aptos` or [installation guide](https://aptos.dev/tools/aptos-cli/))
- Funded Aptos testnet account (free via faucet)
- Basic understanding of Aptos concepts (accounts, transactions, Move modules)

### Installing Aptos CLI

**macOS (Homebrew):**

```bash
brew install aptos
```

**Linux/Windows:**

```bash
# Download from https://github.com/aptos-labs/aptos-core/releases
# Or use Python installer:
pip3 install aptos-cli
```

**Verify installation:**

```bash
aptos --version
# aptos 3.x.x
```

## Aptos Account Creation

### Using Aptos CLI

```bash
# Initialize a new account
aptos init

# Follow prompts to:
# 1. Select network: testnet
# 2. Generate new keypair or provide existing
```

**Output Example:**

```
Enter network: testnet
Enter your private key as a hex literal... (press enter to generate)
Account created: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

### Funding Your Account

**Testnet (for testing):**

```bash
# Using Aptos CLI
aptos account fund-with-faucet --account 0xYOUR_ADDRESS

# Or visit the web faucet:
# https://faucet.testnet.aptoslabs.com
```

**Mainnet (production):**

Transfer APT from an exchange or another wallet. Minimum recommended: 1 APT for gas fees.

### Extracting Account Details

```bash
# View account information
aptos account list --account 0xYOUR_ADDRESS

# Export private key (KEEP SECURE!)
cat ~/.aptos/config.yaml | grep private_key
```

## Move Module Deployment

The Aptos payment channel requires a Move module to be deployed on-chain.

### Building the Module

```bash
# Navigate to contracts directory
cd packages/contracts-aptos

# Compile the Move module
aptos move compile

# Run Move tests
aptos move test
```

### Deploying to Testnet

```bash
# Publish the module to your account
aptos move publish --profile testnet

# Note the module address from output
# Module published at: 0x1234...
```

### Verifying Deployment

```bash
# Query module info
aptos move view \
  --function-id 0xMODULE_ADDRESS::payment_channel::get_channel \
  --args address:0xCHANNEL_OWNER
```

**Module Entry Functions:**

| Function         | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `open_channel`   | Create new payment channel with initial deposit |
| `deposit`        | Add APT to existing channel                     |
| `claim`          | Submit signed claim to transfer APT             |
| `request_close`  | Initiate cooperative channel closure            |
| `finalize_close` | Complete closure after settle delay             |

**Module View Functions:**

| Function      | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `get_channel` | Query channel state (deposited, claimed, status) |

## Environment Configuration

### Environment Variables

Add the following to `packages/connector/.env`:

```bash
# Aptos Node Configuration
APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1       # Testnet
# APTOS_NODE_URL=https://fullnode.mainnet.aptoslabs.com/v1     # Mainnet
APTOS_FALLBACK_NODE_URL=https://aptos-testnet.nodereal.io/v1   # Optional fallback

# Account Configuration
APTOS_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HEX                       # Account private key
APTOS_ACCOUNT_ADDRESS=0xYOUR_ACCOUNT_ADDRESS                   # Account address (64 hex chars)

# Claim Signing Configuration
APTOS_CLAIM_PRIVATE_KEY=0xYOUR_CLAIM_SIGNING_KEY               # Dedicated ed25519 key for claims

# Module Configuration
APTOS_MODULE_ADDRESS=0xDEPLOYED_MODULE_ADDRESS                 # Address where Move module is deployed

# Feature Flag
APTOS_SETTLEMENT_ENABLED=true                                   # Enable/disable Aptos settlement
```

### Configuration Reference

| Variable                   | Required | Description                                 |
| -------------------------- | -------- | ------------------------------------------- |
| `APTOS_NODE_URL`           | Yes      | Aptos RPC endpoint                          |
| `APTOS_PRIVATE_KEY`        | Yes      | Account private key (ed25519 hex)           |
| `APTOS_ACCOUNT_ADDRESS`    | Yes      | Account address (0x-prefixed, 64 hex chars) |
| `APTOS_FALLBACK_NODE_URL`  | No       | Fallback RPC for reliability                |
| `APTOS_CLAIM_PRIVATE_KEY`  | Yes      | Claim signing key (ed25519 hex)             |
| `APTOS_MODULE_ADDRESS`     | Yes\*    | Deployed Move module address                |
| `APTOS_SETTLEMENT_ENABLED` | No       | Feature flag (default: true)                |

\*Required for on-chain operations; off-chain claim signing works without it.

## Using AptosClient

### Basic Operations

```typescript
import { AptosClient, createAptosClientFromEnv } from '@m2m/connector';
import pino from 'pino';

const logger = pino();

// Create client from environment variables
const client = createAptosClientFromEnv(logger);

// Connect to Aptos network
await client.connect();
console.log('Connected:', client.isConnected());

// Query account balance (returns bigint in octas)
const balance = await client.getBalance(process.env.APTOS_ACCOUNT_ADDRESS!);
console.log('Balance:', balance, 'octas'); // 1 APT = 100,000,000 octas
console.log('Balance:', Number(balance) / 100_000_000, 'APT');

// Submit a transaction
const txHash = await client.submitTransaction({
  function: '0x1::coin::transfer',
  type_arguments: ['0x1::aptos_coin::AptosCoin'],
  arguments: ['0xDESTINATION_ADDRESS', '1000000'], // 0.01 APT
});
console.log('Transaction:', txHash);

// Wait for confirmation
await client.waitForTransaction(txHash);
console.log('Transaction confirmed');

// Disconnect when done
client.disconnect();
```

### Error Handling

```typescript
import { AptosClient, AptosErrorCode } from '@m2m/connector';

try {
  await client.connect();
} catch (error) {
  if (error.code) {
    switch (error.code) {
      case AptosErrorCode.CONNECTION_FAILED:
        console.error('Cannot connect to Aptos node');
        break;
      case AptosErrorCode.ACCOUNT_NOT_FOUND:
        console.error('Account does not exist on chain');
        break;
      case AptosErrorCode.INSUFFICIENT_BALANCE:
        console.error('Account balance too low');
        break;
      case AptosErrorCode.TRANSACTION_FAILED:
        console.error('Transaction submission failed');
        break;
      default:
        console.error('Unknown error:', error.message);
    }
  }
}
```

## Payment Channel Operations

### Using AptosChannelSDK

```typescript
import { AptosChannelSDK, createAptosChannelSDKFromEnv } from '@m2m/connector';
import pino from 'pino';

const logger = pino();

// Create SDK from environment variables
const sdk = createAptosChannelSDKFromEnv(logger);

// Start automatic channel refresh
sdk.startAutoRefresh();
```

### Opening a Payment Channel

```typescript
// Open channel with destination account
const channelOwner = await sdk.openChannel(
  '0xDESTINATION_ADDRESS', // Destination address
  'DESTINATION_ED25519_PUBKEY', // Destination public key (for claim verification)
  BigInt(100_000_000), // 1 APT initial deposit (in octas)
  3600 // Settle delay: 1 hour
);

console.log('Channel opened, owner:', channelOwner);
```

### Depositing to a Channel

```typescript
// Add more APT to existing channel
await sdk.deposit(BigInt(50_000_000)); // Add 0.5 APT

const state = await sdk.getChannelState(channelOwner);
console.log('Total deposited:', state.deposited, 'octas');
```

### Querying Channel State

```typescript
const state = await sdk.getChannelState(channelOwner);

if (state) {
  console.log('Deposited:', state.deposited, 'octas');
  console.log('Claimed:', state.claimed, 'octas');
  console.log('Available:', state.deposited - state.claimed, 'octas');
  console.log('Status:', state.status); // 'open', 'closing', 'closed'
  console.log('Settle Delay:', state.settleDelay, 'seconds');
  console.log(
    'Close Requested:',
    state.closeRequestedAt > 0 ? new Date(state.closeRequestedAt * 1000) : 'N/A'
  );
} else {
  console.log('Channel not found');
}
```

## Off-Chain Claim Signing

The `AptosClaimSigner` enables off-chain claim signing for payment channel settlements without on-chain transactions until redemption.

### Signing Claims

```typescript
import { AptosClaimSigner, createAptosClaimSignerFromEnv } from '@m2m/connector';
import pino from 'pino';

const logger = pino();
const signer = createAptosClaimSignerFromEnv(logger);

// Sign a claim (off-chain operation)
const claim = signer.signClaim(
  '0xCHANNEL_OWNER_ADDRESS',
  BigInt(10_000_000) // 0.1 APT claim amount
);

console.log('Claim signed:');
console.log('  Channel:', claim.channelOwner);
console.log('  Amount:', claim.amount, 'octas');
console.log('  Nonce:', claim.nonce);
console.log('  Signature:', claim.signature);
console.log('  Public Key:', claim.publicKey);
```

### Verifying Claims

```typescript
// Verify a claim signature (off-chain operation)
const isValid = signer.verifyClaim(claim);

console.log('Claim valid:', isValid);
```

### Claim Message Format

Claims use BCS (Binary Canonical Serialization) encoding matching the Move module:

```
Bytes 0-11:   Prefix "CLAIM_APTOS" (ASCII)
Bytes 12-43:  Channel owner address (32 bytes)
Bytes 44-51:  Amount (8 bytes, u64 little-endian, octas)
Bytes 52-59:  Nonce (8 bytes, u64 little-endian)
```

### Monotonic Nonces

Claims must have strictly increasing nonces to prevent replay attacks:

```typescript
const claim1 = signer.signClaim(channelOwner, BigInt(1_000_000)); // nonce: 1
const claim2 = signer.signClaim(channelOwner, BigInt(2_000_000)); // nonce: 2
const claim3 = signer.signClaim(channelOwner, BigInt(3_000_000)); // nonce: 3

// Nonces auto-increment per channel
console.log(claim1.nonce, claim2.nonce, claim3.nonce); // 1, 2, 3
```

## Channel Lifecycle Management

### Full Lifecycle Example

```typescript
import { AptosChannelSDK, createAptosChannelSDKFromEnv } from '@m2m/connector';
import pino from 'pino';

const logger = pino();
const sdk = createAptosChannelSDKFromEnv(logger);

async function runChannelLifecycle() {
  // 1. Open channel
  const channelOwner = await sdk.openChannel(
    '0xDEST_ADDRESS',
    'DEST_PUBKEY',
    BigInt(100_000_000), // 1 APT
    3600 // 1 hour settle delay
  );
  console.log('Channel opened:', channelOwner);

  // 2. Sign claims (off-chain)
  const claim1 = sdk.signClaim(channelOwner, BigInt(10_000_000)); // 0.1 APT
  console.log('Claim 1 signed, nonce:', claim1.nonce);

  const claim2 = sdk.signClaim(channelOwner, BigInt(25_000_000)); // 0.25 APT
  console.log('Claim 2 signed, nonce:', claim2.nonce);

  // 3. Submit claim (on-chain)
  const txHash = await sdk.submitClaim(claim2);
  console.log('Claim submitted:', txHash);

  // 4. Verify channel state
  const state = await sdk.getChannelState(channelOwner);
  console.log('Claimed amount:', state!.claimed, 'octas');

  // 5. Request channel closure
  await sdk.requestClose(channelOwner);
  console.log('Channel closure requested');

  // 6. Finalize closure (after settle delay)
  // Note: Must wait for settle delay period before calling
  // await sdk.finalizeClose(channelOwner);
  // console.log('Channel closed');
}
```

### Channel State Machine

```
┌──────────┐
│   Open   │ ◄──→ signClaim() off-chain (cooperative settlement)
└────┬─────┘
     │ requestClose()
     ▼
┌──────────────┐
│   Closing    │ ──→ Settlement delay period (e.g., 1 hour)
│              │     Additional claims can still be submitted
└────┬─────────┘
     │ finalizeClose() (after settle delay)
     ▼
┌──────────┐
│  Closed  │ ──→ Channel removed, remaining balance returned to owner
└──────────┘

States:
- Open: Channel active, can process claims and deposits
- Closing: Close initiated, waiting for settlement delay
- Closed: Channel finalized, balance distributed
```

## Security Best Practices

### Private Key Management

**NEVER hardcode private keys:**

```typescript
// ❌ BAD - Key hardcoded
const config = {
  privateKey: '0xabc123...', // NEVER do this!
};

// ✅ GOOD - Key from environment variable
const config = {
  privateKey: process.env.APTOS_PRIVATE_KEY!,
};
```

### Key Separation

Use dedicated keys for different purposes:

| Key Type    | Purpose                          | Environment Variable      |
| ----------- | -------------------------------- | ------------------------- |
| Account Key | Transaction signing, gas payment | `APTOS_PRIVATE_KEY`       |
| Claim Key   | Off-chain claim signing only     | `APTOS_CLAIM_PRIVATE_KEY` |

**Benefits:**

- Claim key compromise doesn't affect account funds
- Different rotation schedules per key type
- Reduced attack surface

### Environment File Security

**NEVER commit `.env` files with real secrets:**

```bash
# .gitignore
.env
.env.local
.env.production
*.key
*.pem
```

**Use `.env.example` for templates:**

```bash
# .env.example (safe to commit)
APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
APTOS_PRIVATE_KEY=0x_YOUR_PRIVATE_KEY_HERE
APTOS_ACCOUNT_ADDRESS=0x_YOUR_ADDRESS_HERE
```

### Production Key Management

For production deployments:

- Use secrets managers (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager)
- Implement key rotation procedures
- Use hardware security modules (HSMs) for high-value accounts
- Maintain separate keys for testnet vs mainnet
- Enable monitoring and alerts for unusual activity

### Network Security

- **Always use HTTPS** for RPC connections
- Configure fallback RPC endpoints for reliability
- Consider paid RPC providers for production (rate limits, SLAs):
  - [Alchemy](https://www.alchemy.com/aptos)
  - [QuickNode](https://www.quicknode.com/chains/apt)
  - [NodeReal](https://nodereal.io/meganode/aptos)

### Monitoring and Audit

- Enable structured logging for all settlement operations
- Monitor for settlement failures and alert
- Track channel balances and utilization
- Audit claim signatures periodically
- Log all transaction hashes for forensics

## Troubleshooting

### Connection Issues

**Problem:** `CONNECTION_FAILED` error

**Solutions:**

- Verify Aptos node URL is correct and accessible
- Check network connectivity: `curl $APTOS_NODE_URL`
- Try fallback RPC endpoint
- Check if Aptos testnet is experiencing issues: [Aptos Status](https://status.aptoslabs.com/)

### Account Not Found

**Problem:** `ACCOUNT_NOT_FOUND` error

**Solutions:**

- Verify account address is correct (64 hex characters, 0x-prefixed)
- Ensure account is funded (minimum 0.1 APT for existence)
- Check you're connected to the correct network (testnet vs mainnet)
- Fund account: `aptos account fund-with-faucet --account 0xYOUR_ADDRESS`

### Insufficient Balance

**Problem:** `INSUFFICIENT_BALANCE` error

**Solutions:**

- Check account balance: `await client.getBalance(address)`
- Account needs APT for gas (~0.001 APT per transaction)
- For channel operations, ensure sufficient APT for deposit amount + gas
- Fund from faucet (testnet) or exchange (mainnet)

### Transaction Failures

**Problem:** Transaction submitted but failed

**Solutions:**

- Check transaction result using explorer: `https://explorer.aptoslabs.com/txn/TX_HASH?network=testnet`
- Verify gas limits and sequence number
- Ensure module is deployed at specified address
- Check function arguments match expected types

### Module Not Deployed

**Problem:** `MODULE_NOT_FOUND` error

**Solutions:**

- Verify `APTOS_MODULE_ADDRESS` environment variable
- Deploy module: `cd packages/contracts-aptos && aptos move publish`
- Check deployment succeeded on explorer
- Ensure using correct network (testnet vs mainnet)

### Claim Signature Verification Failures

**Problem:** `verifyClaim()` returns false

**Solutions:**

- Verify claim was signed with correct channel owner address
- Ensure amount matches exactly (bigint comparison)
- Check public key matches the one used for signing
- Verify nonce is correct (monotonically increasing)
- Confirm claim message format matches BCS encoding

### Settle Delay Issues

**Problem:** Cannot finalize channel closure

**Solutions:**

- Verify settle delay period has elapsed
- Check `closeRequestedAt` timestamp in channel state
- Settle delay is minimum 1 hour (3600 seconds) in production
- Use shorter delay for testing (still minimum enforced by module)

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         M2M Connector                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              UnifiedSettlementExecutor                   │   │
│  │  Routes settlements based on peer preference/token type  │   │
│  └───────────────────────────┬─────────────────────────────┘   │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         │                    │                    │            │
│         ▼                    ▼                    ▼            │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐      │
│  │ EVM Channel │     │ XRP Channel │     │Aptos Channel│      │
│  │     SDK     │     │     SDK     │     │     SDK     │      │
│  └─────────────┘     └─────────────┘     └──────┬──────┘      │
│                                                  │              │
│                                    ┌─────────────┴────────────┐│
│                                    │                          ││
│                                    ▼                          ▼│
│                             ┌─────────────┐          ┌──────────┐
│                             │AptosClient  │          │AptosClaim│
│                             │             │◄────────►│  Signer  │
│                             └──────┬──────┘          └──────────┘
│                                    │                            │
└────────────────────────────────────┼────────────────────────────┘
                                     │
                                     ▼
                           ┌──────────────────┐
                           │   Aptos Network  │
                           │  (Testnet/Main)  │
                           ├──────────────────┤
                           │ payment_channel  │
                           │   Move Module    │
                           └──────────────────┘
```

### Settlement Flow

```
ILP Packets → TigerBeetle → Threshold Detection → UnifiedSettlementExecutor
                                                          │
                                              ┌───────────┼───────────┐
                                              ▼           ▼           ▼
                                         EVM Channel  XRP Channel  Aptos Channel
                                         (if USDC)    (if XRP)     (if APT)
                                              │           │           │
                                              ▼           ▼           ▼
                                         PaymentChannel XRP Ledger  Aptos Move
                                         ERC20 Contract             Module
```

### Aptos SDK Hierarchy

```
AptosChannelSDK
├── AptosClient (network operations)
│   ├── connect()
│   ├── getBalance()
│   ├── submitTransaction()
│   └── waitForTransaction()
│
├── AptosClaimSigner (cryptography)
│   ├── signClaim()
│   ├── verifyClaim()
│   └── getPublicKey()
│
└── Channel State Cache
    ├── startAutoRefresh()
    ├── getChannelState()
    └── getMyChannels()
```

## Running Integration Tests

```bash
# Set environment variables
export APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
export APTOS_PRIVATE_KEY=<your-testnet-private-key>
export APTOS_ACCOUNT_ADDRESS=<your-testnet-address>
export APTOS_CLAIM_PRIVATE_KEY=<your-claim-signing-key>
export APTOS_MODULE_ADDRESS=<deployed-module-address>

# Run Aptos settlement tests
cd packages/connector
npm test -- test/integration/aptos-settlement.test.ts

# Run all Aptos-related tests
npm test -- --testPathPattern="aptos"

# Run with debug logging
TEST_LOG_LEVEL=debug npm test -- test/integration/aptos-settlement.test.ts
```

### Expected Test Output

```
PASS test/integration/aptos-settlement.test.ts
  Aptos Settlement Integration Tests
    Channel Creation on Testnet (AC: 2)
      ✓ should create channel with valid parameters (5234 ms)
      ✓ should handle duplicate channel creation error (2156 ms)
      ✓ should fail with insufficient balance (1892 ms)
    Off-Chain Claim Operations (AC: 3)
      ✓ should sign claim with valid parameters (12 ms)
      ✓ should verify valid claim signature (8 ms)
      ✓ should reject claim with invalid signature (5 ms)
      ✓ should auto-increment nonce for subsequent claims (3 ms)
    ...
```

## Local Development

This section explains how to set up and use the Aptos local testnet for Move module development.

### Overview

The Aptos local testnet provides a self-contained blockchain environment for development and testing, enabling:

- **Rapid Iteration**: Instant transaction finality without testnet delays
- **No Rate Limits**: Unlimited RPC requests without API restrictions
- **Free Transactions**: No gas costs for testing
- **Offline Development**: Works without internet after initial Docker image download
- **Consistent State**: Deterministic environment for reproducible tests

### Prerequisites

- **Docker Desktop**: 20.10+ ([Download](https://www.docker.com/products/docker-desktop))
- **Aptos CLI** (optional, for module deployment): `brew install aptos`

### Quick Start

**Step 1: Start Aptos Local Testnet**

```bash
# Start just the Aptos service
docker-compose -f docker-compose-dev.yml up -d aptos-local

# Or use the Makefile
make aptos-up
```

**Step 2: Wait for Health Check**

```bash
# Check service status
docker-compose -f docker-compose-dev.yml ps aptos-local

# Watch logs until "Ready to accept connections" appears
docker-compose -f docker-compose-dev.yml logs -f aptos-local
```

**Step 3: Initialize and Verify**

```bash
# Run initialization script
./scripts/init-aptos-local.sh

# Verify node is responding
curl -s http://localhost:8080/v1 | jq .
```

**Expected output:**

```json
{
  "chain_id": 4,
  "epoch": "1",
  "ledger_version": "0",
  "oldest_ledger_version": "0",
  "ledger_timestamp": "...",
  "node_role": "full_node",
  "oldest_block_height": "0",
  "block_height": "0"
}
```

**Step 4: Deploy Move Module (Optional)**

```bash
# Deploy payment_channel module
./scripts/aptos-deploy-module.sh

# Fund a test account
./scripts/aptos-fund-account.sh 0x<your-address>
```

### Local vs Testnet vs Mainnet Configuration

| Setting              | Local Testnet              | Aptos Testnet                               | Mainnet                                     |
| -------------------- | -------------------------- | ------------------------------------------- | ------------------------------------------- |
| `APTOS_NODE_URL`     | `http://localhost:8080/v1` | `https://fullnode.testnet.aptoslabs.com/v1` | `https://fullnode.mainnet.aptoslabs.com/v1` |
| `APTOS_FAUCET_URL`   | `http://localhost:8081`    | `https://faucet.testnet.aptoslabs.com`      | N/A (fund via exchange)                     |
| Chain ID             | 4 (local)                  | 2                                           | 1                                           |
| Transaction Cost     | Free                       | ~0.0001 APT                                 | ~0.0001 APT                                 |
| Transaction Finality | Instant                    | ~400ms                                      | ~400ms                                      |
| Rate Limits          | None                       | May apply                                   | May apply                                   |
| Use Case             | Development & Testing      | Integration Testing                         | Production                                  |

### Endpoint URLs

**From Host Machine:**

- Node REST API: `http://localhost:8080/v1`
- Faucet: `http://localhost:8081`

**From Docker Containers:**

- Node REST API: `http://aptos-local:8080/v1`
- Faucet: `http://aptos-local:8081`

### Helper Scripts

| Script                                   | Purpose                                 |
| ---------------------------------------- | --------------------------------------- |
| `./scripts/init-aptos-local.sh`          | Initialize and verify local testnet     |
| `./scripts/aptos-fund-account.sh <addr>` | Fund account via faucet (default 1 APT) |
| `./scripts/aptos-deploy-module.sh`       | Deploy payment_channel Move module      |

### Makefile Commands

| Command             | Description                            |
| ------------------- | -------------------------------------- |
| `make aptos-up`     | Start Aptos local testnet              |
| `make aptos-down`   | Stop Aptos local testnet               |
| `make aptos-init`   | Initialize testnet (run helper script) |
| `make aptos-deploy` | Deploy Move module                     |
| `make aptos-logs`   | View Aptos container logs              |

### Troubleshooting

#### Slow Startup (~2-3 minutes on first run)

This is normal. The first startup downloads the Docker image (~2GB). Subsequent startups take ~45-60 seconds.

```bash
# Check progress
docker-compose -f docker-compose-dev.yml logs -f aptos-local
```

#### Port Conflicts (8080/8081 already in use)

If ports 8080 or 8081 are used by other services, override with environment variables:

```bash
# Option 1: Export before starting
export APTOS_NODE_PORT=18080
export APTOS_FAUCET_PORT=18081
docker-compose -f docker-compose-dev.yml up -d aptos-local

# Option 2: Add to .env.dev
APTOS_NODE_PORT=18080
APTOS_FAUCET_PORT=18081
```

Then update your client configuration:

```bash
export APTOS_NODE_URL=http://localhost:18080/v1
export APTOS_FAUCET_URL=http://localhost:18081
```

#### Docker Socket Permission Issues (Indexer API)

If using `--profile aptos-indexed` and encountering Docker socket errors:

```bash
# macOS: Docker socket permissions are managed by Docker Desktop
# Linux: Add your user to the docker group
sudo usermod -aG docker $USER
# Then log out and back in
```

#### Apple Silicon (M1/M2/M3) Performance

The Aptos Docker image runs via Rosetta 2 emulation (`linux/amd64`). Performance is acceptable for development but may be slower than native.

For faster local execution, install Aptos CLI natively:

```bash
brew install aptos
aptos node run-local-testnet --test-dir /tmp/aptos-local
```

#### Container Won't Start

```bash
# Check for errors
docker-compose -f docker-compose-dev.yml logs aptos-local

# Reset and restart
docker-compose -f docker-compose-dev.yml down
docker volume rm m2m_aptos-testnet-data  # Clear persistent data
docker-compose -f docker-compose-dev.yml up -d aptos-local
```

### Using with Connectors

Connectors in Docker Compose are pre-configured to use the local Aptos testnet:

```yaml
# In docker-compose-dev.yml, connectors have:
environment:
  APTOS_NODE_URL: http://aptos-local:8080/v1
  APTOS_FAUCET_URL: http://aptos-local:8081
```

The `AptosClient` automatically detects `Network.LOCAL` when using localhost URLs:

```typescript
// packages/connector/src/settlement/aptos-client.ts
private getNetworkFromUrl(url: string): Network {
  // ...
  else if (url.includes('localhost') || url.includes('127.0.0.1')) {
    return Network.LOCAL;  // Automatically detected
  }
  // ...
}
```

## Additional Resources

- [Aptos Developer Documentation](https://aptos.dev/)
- [Move Language Book](https://move-language.github.io/move/)
- [Aptos Explorer](https://explorer.aptoslabs.com/)
- [Aptos TypeScript SDK](https://aptos.dev/sdks/ts-sdk/)
- [Aptos CLI Reference](https://aptos.dev/tools/aptos-cli/)

## Next Steps

- **Epic 13 Story 27.1 (Complete):** AptosClient integration
- **Epic 13 Story 27.2 (Complete):** Move payment channel module
- **Epic 13 Story 27.3 (Complete):** Off-chain claim signing
- **Epic 13 Story 27.4 (Complete):** AptosChannelSDK
- **Epic 13 Story 27.5 (Complete):** Tri-chain settlement integration
- **Epic 13 Story 27.6 (Current):** Testing and documentation
