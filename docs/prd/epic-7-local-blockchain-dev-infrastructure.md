# Epic 7: Local Blockchain Development Infrastructure

**Epic Number:** 7
**Priority:** High - Required before Epic 8 and Epic 9
**Type:** Development Infrastructure / Enabler Epic

**Goal:** Establish local blockchain node infrastructure for Base L2 (EVM) and XRP Ledger development, enabling developers to build and test payment channel smart contracts locally without relying on public testnets or mainnets. Deploy Anvil (Foundry) as a local Base L2 fork and rippled in standalone mode via Docker Compose, providing instant block finality, zero gas costs, pre-funded test accounts, and complete control over blockchain state. This epic delivers a turnkey local development environment that accelerates iteration cycles and eliminates testnet rate limits and network dependencies.

**Foundation:** This epic implements the recommendations from `docs/research/local-blockchain-nodes-setup-guide.md`, providing local blockchain infrastructure for Epic 8 (EVM Payment Channels) and Epic 9 (XRP Payment Channels) development and testing.

**Important:** These local blockchain nodes are **for development and testing only**. Production deployments will connect to:

- **Base L2:** Public mainnet via RPC endpoint (https://mainnet.base.org)
- **XRP Ledger:** Public mainnet via RPC endpoint (https://xrplcluster.com)

---

## Story 7.1: Anvil (Foundry) Docker Service for Base L2 Local Development

As a smart contract developer,
I want a local Base L2 node running in Docker that forks Base Sepolia testnet,
so that I can develop and test payment channel contracts without testnet rate limits or network delays.

### Acceptance Criteria

1. Anvil service added to `docker-compose-dev.yml` (separate from production compose file)
2. Anvil configured to fork Base Sepolia testnet with pinned block number for consistency
3. Anvil exposes JSON-RPC endpoint on port 8545 accessible from all containers
4. Anvil configured with `--optimism` flag for OP Stack compatibility
5. Anvil pre-funds 10 accounts with test ETH for development
6. Health check implemented to verify Anvil is ready before dependent services start
7. Environment variable `BASE_SEPOLIA_RPC_URL` configurable for fork source (default: https://sepolia.base.org)
8. Environment variable `FORK_BLOCK_NUMBER` configurable for state consistency across restarts
9. Documentation added to `docs/guides/local-blockchain-development.md` explaining Anvil usage
10. Integration test verifies Anvil starts, accepts RPC requests, and serves forked state

### Docker Compose Configuration

```yaml
# docker-compose-dev.yml
services:
  anvil:
    image: ghcr.io/foundry-rs/foundry:latest
    container_name: anvil_base_local
    command: >
      anvil
      --host 0.0.0.0
      --port 8545
      --fork-url ${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}
      --fork-block-number ${FORK_BLOCK_NUMBER:-20702367}
      --chain-id 84532
      --optimism
    ports:
      - '8545:8545'
    networks:
      - m2m_dev_network
    environment:
      - BASE_SEPOLIA_RPC_URL=${BASE_SEPOLIA_RPC_URL}
      - FORK_BLOCK_NUMBER=${FORK_BLOCK_NUMBER}
    healthcheck:
      test:
        [
          'CMD',
          'sh',
          '-c',
          'curl -f http://localhost:8545 -X POST -H ''Content-Type: application/json'' --data ''{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'' || exit 1',
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

networks:
  m2m_dev_network:
    driver: bridge
```

### Environment Variables (.env.dev)

```bash
# Base L2 Fork Configuration
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
FORK_BLOCK_NUMBER=20702367

# Alternative RPC endpoints (avoid rate limits)
# BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
# BASE_SEPOLIA_RPC_URL=https://base-sepolia.gateway.tenderly.co
```

### Testing Anvil

```bash
# Start Anvil
docker-compose -f docker-compose-dev.yml up -d anvil

# Test RPC endpoint
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }'

# Get pre-funded account balances
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://localhost:8545
```

### Benefits

- **Instant blocks:** No waiting for 2-second Base L2 block times
- **Zero gas costs:** Free transactions for rapid testing
- **State pinning:** Consistent fork state across developer machines
- **No rate limits:** Unlimited RPC calls for testing
- **Offline development:** Work without internet after initial fork

---

## Story 7.2: rippled Standalone Mode Docker Service for XRP Ledger Development

As a blockchain developer,
I want a local XRP Ledger node running in standalone mode via Docker,
so that I can develop and test XRP payment channels without testnet dependencies.

### Acceptance Criteria

1. rippled service added to `docker-compose-dev.yml` in standalone mode
2. rippled configured to run offline with manual ledger advancement
3. rippled exposes JSON-RPC endpoint on port 5005 and WebSocket on port 6006
4. rippled uses persistent Docker volume for ledger data across restarts
5. Health check implemented to verify rippled is ready before dependent services start
6. Automated ledger advancer service (optional) advances ledgers every 5 seconds
7. Pre-funded test accounts created via initialization script
8. Documentation added explaining rippled standalone mode and manual ledger advancement
9. Helper scripts provided for common operations (fund account, advance ledger, reset state)
10. Integration test verifies rippled starts, accepts JSON-RPC calls, and processes transactions

### Docker Compose Configuration

```yaml
# docker-compose-dev.yml (continued)
services:
  rippled:
    image: xrpllabsofficial/xrpld:latest
    container_name: rippled_standalone
    command: ['-a'] # standalone mode
    ports:
      - '5005:5005' # JSON-RPC
      - '6006:6006' # WebSocket
    networks:
      - m2m_dev_network
    healthcheck:
      test:
        [
          'CMD',
          'sh',
          '-c',
          'curl -f http://localhost:5005 -X POST -H ''Content-Type: application/json'' --data ''{"method":"server_info","params":[]}'' || exit 1',
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    volumes:
      - rippled_data:/var/lib/rippled
      - ./scripts/rippled-init.sh:/docker-entrypoint-initdb.d/init.sh

  # Optional: Automated ledger advancement (simulates block production)
  rippled_ledger_advancer:
    image: curlimages/curl:latest
    container_name: rippled_ledger_advancer
    networks:
      - m2m_dev_network
    depends_on:
      rippled:
        condition: service_healthy
    command: >
      sh -c "
      while true; do
        sleep 5;
        curl -X POST http://rippled:5005 \
          -H 'Content-Type: application/json' \
          --data '{\"method\":\"ledger_accept\",\"params\":[]}' || true;
      done
      "
    restart: unless-stopped
    profiles:
      - auto-ledger # Only start with: docker-compose --profile auto-ledger up

volumes:
  rippled_data:
```

### Helper Scripts

**scripts/rippled-advance-ledger.sh:**

```bash
#!/bin/bash
# Manually advance rippled ledger
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  -d '{
    "method": "ledger_accept",
    "params": []
  }'
```

**scripts/rippled-fund-account.sh:**

```bash
#!/bin/bash
# Fund a test account in standalone mode
ACCOUNT=$1
AMOUNT=${2:-10000}  # Default: 10,000 XRP

curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"wallet_propose\",
    \"params\": [{
      \"passphrase\": \"$ACCOUNT\"
    }]
  }"
```

**scripts/rippled-reset.sh:**

```bash
#!/bin/bash
# Reset rippled state (stop, remove volume, restart)
docker-compose -f docker-compose-dev.yml down -v rippled_data
docker-compose -f docker-compose-dev.yml up -d rippled
```

### Testing rippled

```bash
# Start rippled
docker-compose -f docker-compose-dev.yml up -d rippled

# Test JSON-RPC endpoint
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  -d '{
    "method": "server_info",
    "params": []
  }'

# Advance ledger manually
./scripts/rippled-advance-ledger.sh

# Check ledger index
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  -d '{
    "method": "ledger",
    "params": [{"ledger_index": "validated"}]
  }'
```

### Benefits

- **Offline operation:** No network peers, complete control
- **Instant transactions:** No consensus delay
- **Manual ledger control:** Test multi-step transaction sequences
- **Payment channel testing:** Full XRP PayChan support
- **Reset capability:** Clean slate for each test run

---

## Story 7.3: Docker Compose Integration and Service Dependencies

As a developer,
I want all local blockchain nodes and connectors orchestrated in a single Docker Compose file,
so that I can start the entire development environment with one command.

### Acceptance Criteria

1. `docker-compose-dev.yml` integrates Anvil, rippled, TigerBeetle, and connectors
2. Service dependencies configured with health checks (connectors wait for blockchain nodes)
3. Shared development network for inter-service communication
4. Environment variable configuration via `.env.dev` file
5. Makefile targets for common development workflows (`make dev-up`, `make dev-down`, `make dev-reset`)
6. README section added explaining development vs. production Docker Compose files
7. Development-specific environment variables isolated from production config
8. Volume mounts for hot-reload during development (code changes reflect immediately)
9. Docker Compose profiles for optional services (e.g., ledger advancer, dashboard)
10. Integration test verifies full stack startup with all dependencies healthy

### Complete docker-compose-dev.yml

```yaml
version: '3.8'

services:
  # ===== Local Blockchain Nodes =====

  anvil:
    image: ghcr.io/foundry-rs/foundry:latest
    container_name: anvil_base_local
    command: >
      anvil
      --host 0.0.0.0
      --port 8545
      --fork-url ${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}
      --fork-block-number ${FORK_BLOCK_NUMBER:-20702367}
      --chain-id 84532
      --optimism
    ports:
      - '8545:8545'
    networks:
      - m2m_dev_network
    healthcheck:
      test:
        [
          'CMD',
          'sh',
          '-c',
          'curl -f http://localhost:8545 -X POST -H ''Content-Type: application/json'' --data ''{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'' || exit 1',
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  rippled:
    image: xrpllabsofficial/xrpld:latest
    container_name: rippled_standalone
    command: ['-a']
    ports:
      - '5005:5005'
      - '6006:6006'
    networks:
      - m2m_dev_network
    healthcheck:
      test:
        [
          'CMD',
          'sh',
          '-c',
          'curl -f http://localhost:5005 -X POST -H ''Content-Type: application/json'' --data ''{"method":"server_info","params":[]}'' || exit 1',
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    volumes:
      - rippled_data:/var/lib/rippled

  rippled_ledger_advancer:
    image: curlimages/curl:latest
    container_name: rippled_ledger_advancer
    networks:
      - m2m_dev_network
    depends_on:
      rippled:
        condition: service_healthy
    command: >
      sh -c "
      while true; do
        sleep 5;
        curl -X POST http://rippled:5005 \
          -H 'Content-Type: application/json' \
          --data '{\"method\":\"ledger_accept\",\"params\":[]}' || true;
      done
      "
    restart: unless-stopped
    profiles:
      - auto-ledger

  # ===== Settlement Infrastructure =====

  tigerbeetle:
    image: ghcr.io/tigerbeetle/tigerbeetle:latest
    container_name: tigerbeetle_dev
    command: start --addresses=0.0.0.0:3000
    ports:
      - '3000:3000'
    networks:
      - m2m_dev_network
    volumes:
      - tigerbeetle_data:/var/lib/tigerbeetle
    healthcheck:
      test: ['CMD', 'tigerbeetle', 'version']
      interval: 10s
      timeout: 5s
      retries: 5

  # ===== Connectors =====

  connector-alice:
    build:
      context: ./packages/connector
      dockerfile: Dockerfile.dev
    container_name: connector_alice_dev
    environment:
      - NODE_ID=alice
      - BTP_SERVER_PORT=3001
      - BASE_RPC_URL=http://anvil:8545
      - XRPL_RPC_URL=http://rippled:5005
      - TIGERBEETLE_URL=tigerbeetle:3000
      - DASHBOARD_TELEMETRY_URL=http://dashboard:8080/telemetry
    ports:
      - '3001:3001'
      - '8081:8080'
    networks:
      - m2m_dev_network
    depends_on:
      anvil:
        condition: service_healthy
      rippled:
        condition: service_healthy
      tigerbeetle:
        condition: service_healthy
    volumes:
      - ./packages/connector/src:/app/src # Hot-reload
      - ./packages/shared/src:/app/node_modules/@m2m/shared/src # Hot-reload shared

  connector-bob:
    build:
      context: ./packages/connector
      dockerfile: Dockerfile.dev
    container_name: connector_bob_dev
    environment:
      - NODE_ID=bob
      - BTP_SERVER_PORT=3002
      - BASE_RPC_URL=http://anvil:8545
      - XRPL_RPC_URL=http://rippled:5005
      - TIGERBEETLE_URL=tigerbeetle:3000
      - DASHBOARD_TELEMETRY_URL=http://dashboard:8080/telemetry
    ports:
      - '3002:3002'
      - '8082:8080'
    networks:
      - m2m_dev_network
    depends_on:
      anvil:
        condition: service_healthy
      rippled:
        condition: service_healthy
      tigerbeetle:
        condition: service_healthy
    volumes:
      - ./packages/connector/src:/app/src
      - ./packages/shared/src:/app/node_modules/@m2m/shared/src

  # ===== Dashboard =====

  dashboard:
    build:
      context: ./packages/dashboard
      dockerfile: Dockerfile.dev
    container_name: dashboard_dev
    ports:
      - '8080:8080'
    networks:
      - m2m_dev_network
    volumes:
      - ./packages/dashboard/src:/app/src # Hot-reload
    profiles:
      - dashboard

networks:
  m2m_dev_network:
    driver: bridge

volumes:
  rippled_data:
  tigerbeetle_data:
```

### Makefile for Development Workflows

```makefile
# Makefile
.PHONY: dev-up dev-down dev-reset dev-logs dev-test

dev-up:
	docker-compose -f docker-compose-dev.yml up -d

dev-up-dashboard:
	docker-compose -f docker-compose-dev.yml --profile dashboard up -d

dev-up-auto-ledger:
	docker-compose -f docker-compose-dev.yml --profile auto-ledger up -d

dev-down:
	docker-compose -f docker-compose-dev.yml down

dev-reset:
	docker-compose -f docker-compose-dev.yml down -v
	docker-compose -f docker-compose-dev.yml up -d

dev-logs:
	docker-compose -f docker-compose-dev.yml logs -f

dev-test:
	docker-compose -f docker-compose-dev.yml exec connector-alice npm test
```

### Usage

```bash
# Start full development environment
make dev-up

# Start with dashboard
make dev-up-dashboard

# Start with automated XRPL ledger advancement
make dev-up-auto-ledger

# View logs
make dev-logs

# Reset all state (fresh blockchain nodes)
make dev-reset

# Stop all services
make dev-down
```

---

## Story 7.4: Development Workflow Documentation and Developer Onboarding

As a new developer joining the M2M project,
I want comprehensive documentation explaining the local blockchain development environment,
so that I can quickly set up my development machine and start contributing.

### Acceptance Criteria

1. `docs/guides/local-blockchain-development.md` created with complete setup instructions
2. README.md updated with "Development Environment" section linking to full guide
3. Documentation covers: prerequisites, installation, starting services, testing, troubleshooting
4. Step-by-step tutorial for deploying first smart contract to local Anvil
5. Step-by-step tutorial for creating XRP payment channel on local rippled
6. Troubleshooting section covering common issues (port conflicts, fork failures, ledger advancement)
7. Developer workflow examples (test → deploy local → test → deploy testnet → audit → deploy mainnet)
8. Environment variable reference table with all configuration options
9. FAQ section addressing common questions (Why Anvil vs Hardhat? Why standalone rippled?)
10. Video walkthrough (optional) showing end-to-end setup and first contract deployment

### Documentation Structure

**docs/guides/local-blockchain-development.md:**

````markdown
# Local Blockchain Development Guide

## Quick Start (5 minutes)

1. Install prerequisites
2. Clone repository
3. Start development environment
4. Verify blockchain nodes
5. Deploy first contract

## Prerequisites

- Docker Desktop (latest)
- Node.js 20+ and npm 10+
- Git
- curl (for testing)

## Setup Steps

### 1. Install Foundry (for smart contract development)

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```
````

### 2. Clone M2M Repository

```bash
git clone https://github.com/yourorg/m2m.git
cd m2m
npm install
```

### 3. Configure Environment

```bash
cp .env.dev.example .env.dev
# Edit .env.dev with your RPC URLs (optional, defaults provided)
```

### 4. Start Local Blockchain Nodes

```bash
make dev-up
```

This starts:

- Anvil (Base L2 fork) on http://localhost:8545
- rippled (XRPL standalone) on http://localhost:5005

### 5. Verify Services

```bash
# Test Anvil
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Test rippled
curl -X POST http://localhost:5005 \
  -H "Content-Type: application/json" \
  -d '{"method":"server_info","params":[]}'
```

## Deploying Your First Smart Contract

[Step-by-step tutorial...]

## Creating Your First XRP Payment Channel

[Step-by-step tutorial...]

## Development Workflows

### Workflow 1: Smart Contract Development

1. Write contract in `packages/contracts/src/`
2. Write tests in `packages/contracts/test/`
3. Run tests: `forge test`
4. Deploy to local Anvil: `forge script Deploy --rpc-url http://localhost:8545`
5. Test integration with connectors
6. Deploy to Base Sepolia testnet
7. Run integration tests on testnet
8. Security audit
9. Deploy to Base mainnet

### Workflow 2: XRP Payment Channel Testing

1. Start rippled: `make dev-up`
2. Create test accounts
3. Fund accounts
4. Open payment channel
5. Sign claims
6. Test settlement
7. Advance ledgers manually or use auto-advancer

## Troubleshooting

### Anvil won't start

**Problem:** Port 8545 already in use

**Solution:**

```bash
# Find process using port
lsof -i :8545
# Kill process or change Anvil port
```

### rippled ledger not advancing

**Problem:** Transactions submitted but not confirmed

**Solution:**

```bash
# Manually advance ledger
./scripts/rippled-advance-ledger.sh

# Or start auto-advancer
docker-compose --profile auto-ledger up -d
```

## FAQ

**Q: Why use Anvil instead of Hardhat?**
A: Anvil is 2-3x faster for testing and has better Foundry integration.

**Q: Can I use public testnets instead?**
A: Yes, but local nodes provide faster iteration and no rate limits.

**Q: Do I need to run both Anvil and rippled?**
A: Only if working on both Epic 8 (EVM) and Epic 9 (XRP).

````

---

## Story 7.5: Connector Configuration for Development vs. Production Environments

As a connector developer,
I want clear separation between development and production blockchain configurations,
so that I don't accidentally deploy to mainnet or hit production RPC limits during testing.

### Acceptance Criteria

1. Connector configuration supports `ENVIRONMENT` variable (dev/staging/production)
2. Development configuration defaults to local blockchain nodes (Anvil, rippled standalone)
3. Production configuration defaults to public mainnet RPC endpoints
4. Environment-specific config files: `connector-config.dev.yaml`, `connector-config.prod.yaml`
5. Validation prevents production private keys from being used in development
6. Warning logs when running development config (clearly indicate test environment)
7. RPC URL validation ensures correct chain ID matches environment
8. Separate Docker Compose files: `docker-compose-dev.yml`, `docker-compose-prod.yml`
9. Documentation explains configuration precedence and environment switching
10. Integration test verifies connector connects to correct blockchain based on environment

### Configuration Examples

**connector-config.dev.yaml:**
```yaml
# Development configuration (local blockchain nodes)
nodeId: alice
environment: development

blockchain:
  base:
    enabled: true
    rpcUrl: http://anvil:8545  # Local Anvil
    chainId: 84532  # Base Sepolia (forked)
    privateKey: ${DEV_PRIVATE_KEY}  # Anvil pre-funded account
    registryAddress: "0x..."  # Deployed to local Anvil

  xrpl:
    enabled: true
    rpcUrl: http://rippled:5005  # Local rippled standalone
    privateKey: ${DEV_XRP_PRIVATE_KEY}  # Generated for standalone
    network: standalone

settlement:
  tigerbeetleUrl: http://tigerbeetle:3000
  thresholds:
    default: 100  # Lower threshold for easier testing

telemetry:
  enabled: true
  dashboardUrl: http://dashboard:8080/telemetry
````

**connector-config.prod.yaml:**

```yaml
# Production configuration (public mainnets)
nodeId: ${NODE_ID}
environment: production

blockchain:
  base:
    enabled: true
    rpcUrl: https://mainnet.base.org # Base mainnet
    chainId: 8453
    privateKey: ${BASE_PRIVATE_KEY} # Secure key from KMS/HSM
    registryAddress: '0x...' # Production contract address

  xrpl:
    enabled: true
    rpcUrl: https://xrplcluster.com # XRPL mainnet
    privateKey: ${XRP_PRIVATE_KEY} # Secure key from KMS/HSM
    network: mainnet

settlement:
  tigerbeetleUrl: ${TIGERBEETLE_CLUSTER_URL}
  thresholds:
    default: 10000 # Higher threshold for production

telemetry:
  enabled: true
  dashboardUrl: ${DASHBOARD_URL}
```

### Validation Logic

```typescript
// packages/connector/src/config/environment-validator.ts

export function validateEnvironment(config: ConnectorConfig) {
  if (config.environment === 'production') {
    // Production validations
    if (
      !config.blockchain.base.privateKey.startsWith('0x') ||
      config.blockchain.base.privateKey === KNOWN_DEV_KEY
    ) {
      throw new Error('Cannot use development private key in production');
    }

    if (
      config.blockchain.base.rpcUrl.includes('localhost') ||
      config.blockchain.base.rpcUrl.includes('127.0.0.1')
    ) {
      throw new Error('Cannot use localhost RPC in production');
    }

    if (config.blockchain.base.chainId !== 8453) {
      throw new Error('Production must use Base mainnet (chainId 8453)');
    }
  } else if (config.environment === 'development') {
    // Development warnings
    logger.warn('⚠️  DEVELOPMENT MODE - Using local blockchain nodes');
    logger.warn('⚠️  This is NOT production configuration');
  }
}
```

---

## Epic Completion Criteria

- [ ] Anvil service running in Docker Compose and forking Base Sepolia
- [ ] rippled service running in Docker Compose in standalone mode
- [ ] All services integrated with health checks and dependency ordering
- [ ] Makefile provides simple dev commands (dev-up, dev-down, dev-reset)
- [ ] Documentation complete with setup guide, tutorials, and troubleshooting
- [ ] Connector supports environment-specific configuration (dev vs. prod)
- [ ] Integration tests verify full stack startup with all services healthy
- [ ] Developer onboarding time reduced to <30 minutes from zero to first contract deployment
- [ ] Local blockchain nodes enable offline development (after initial fork)
- [ ] Zero testnet/mainnet dependencies during development

---

## Dependencies and Integration Points

**Enables:**

- **Epic 8:** EVM Payment Channels (Base L2) - Local Anvil for contract development and testing
- **Epic 9:** XRP Payment Channels - Local rippled for PayChan development and testing
- **Epic 10:** Multi-Chain Settlement - Local environment for cross-chain testing

**Integrates With:**

- **Epic 6:** Settlement Foundation - TigerBeetle added to dev compose file
- **Epic 2:** BTP Protocol - Connectors start with blockchain dependencies healthy
- **Epic 3:** Dashboard - Optional dashboard service for development visualization

---

## Technical Architecture Notes

### Development vs. Production Architecture

**Development (Local Nodes):**

```
Connector → Anvil (localhost:8545) → Forked Base Sepolia state
Connector → rippled (localhost:5005) → Standalone mode (offline)
```

**Production (Public Mainnets):**

```
Connector → Base Mainnet (https://mainnet.base.org) → Live blockchain
Connector → XRPL Mainnet (https://xrplcluster.com) → Live blockchain
```

### Why Fork Base Sepolia (Not Mainnet)?

1. **Faster sync:** Sepolia has less state than mainnet
2. **Free testnet ETH:** Can use faucets for initial funding
3. **Lower risk:** Mistakes don't cost real money
4. **Identical to mainnet:** Full EVM compatibility, contracts work identically

**When to fork mainnet:**

- Testing production contract deployments
- Verifying interactions with deployed mainnet contracts
- Performance testing with real state size

### rippled Standalone Mode Limitations

1. **Manual ledger advancement:** Must call `ledger_accept` after each transaction
2. **No consensus:** All transactions succeed immediately (no network validation)
3. **State isolation:** Standalone ledger state doesn't sync with testnet/mainnet
4. **Payment channel testing:** Full support, but claims must be manually validated

**Mitigation:**

- Auto-ledger advancer service (optional) advances ledgers every 5 seconds
- Helper scripts automate common operations
- Documentation clearly explains standalone mode behavior

---

## Testing Strategy

### Integration Tests

**Test 1: Full Stack Startup**

1. Start all services with `docker-compose-dev.yml`
2. Verify all health checks pass
3. Verify Anvil serves Base Sepolia forked state
4. Verify rippled accepts JSON-RPC calls
5. Verify connectors connect to both blockchain nodes

**Test 2: Smart Contract Deployment to Local Anvil**

1. Deploy payment channel contract to Anvil
2. Verify deployment transaction succeeds
3. Verify contract address returned
4. Verify contract state accessible via RPC

**Test 3: XRP Payment Channel on Local rippled**

1. Create two test accounts in rippled
2. Fund accounts
3. Open payment channel
4. Advance ledger
5. Verify channel exists on ledger

**Test 4: Connector Blockchain Integration**

1. Start connector with dev config
2. Verify connector connects to Anvil
3. Verify connector connects to rippled
4. Submit test transaction to each blockchain
5. Verify transactions confirmed

---

## Performance Requirements

- **Anvil startup time:** <10 seconds (with fork)
- **rippled startup time:** <15 seconds (standalone mode)
- **Full stack startup time:** <60 seconds (all services healthy)
- **Anvil block time:** Instant (auto-mine on transaction)
- **rippled ledger close time:** Manual (or 5 seconds with auto-advancer)
- **Fork sync time:** <30 seconds (initial fetch of Base Sepolia state)

---

## Documentation Deliverables

1. `docs/guides/local-blockchain-development.md` - Complete setup and usage guide
2. `docs/guides/local-vs-production-config.md` - Environment configuration guide
3. `README.md` - Updated with Development Environment section
4. `scripts/README.md` - Helper scripts documentation
5. `.env.dev.example` - Example development environment variables
6. `docker-compose-dev.yml` - Annotated with comments explaining each service

---

## Success Metrics

- Developer onboarding time: <30 minutes (zero to first contract deployment)
- Local development iteration speed: <5 seconds (change code → test)
- Testnet dependency elimination: 100% (can develop offline)
- Developer satisfaction: Survey after Epic 8/9 completion
- Smart contract deployment success rate: >99% (local Anvil)
- XRPL transaction success rate: 100% (standalone mode accepts all valid transactions)

---

## Timeline Estimate

**Total Duration:** 1-2 weeks

- **Days 1-2:** Anvil Docker service and health checks (Story 7.1)
- **Days 3-4:** rippled Docker service and helper scripts (Story 7.2)
- **Days 5-6:** Docker Compose integration and Makefile (Story 7.3)
- **Days 7-8:** Documentation and developer onboarding (Story 7.4)
- **Days 9-10:** Environment configuration and validation (Story 7.5)

**Can be parallelized with Epic 6** - Local blockchain infrastructure doesn't depend on TigerBeetle settlement.

**Must complete before Epic 8/9** - Payment channel development requires local blockchain nodes.
