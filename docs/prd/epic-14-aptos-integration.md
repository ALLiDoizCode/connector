# Epic 14: Public Testnet Integration for Tri-Chain Settlement

## Epic Metadata

| Field                | Value                                               |
| -------------------- | --------------------------------------------------- |
| **Epic ID**          | 14                                                  |
| **Title**            | Public Testnet Integration for Tri-Chain Settlement |
| **Status**           | In Progress                                         |
| **Priority**         | High (completes tri-chain settlement support)       |
| **Depends On**       | Epic 13 (Aptos Payment Channel Move Modules)        |
| **Enables**          | Production tri-chain settlement                     |
| **Estimated Points** | 17                                                  |

---

## Problem Statement

The Docker agent test currently requires **local blockchain containers** (Anvil, rippled, aptos-local) which create several challenges:

1. **Architecture Limitations** - Aptos official Docker image is AMD64-only; ARM64 (Apple Silicon) requires building from source or slow QEMU emulation
2. **Infrastructure Complexity** - Running 3 local blockchain nodes adds container management overhead
3. **Divergence from Production** - Local standalone nodes behave differently from public testnets
4. **Resource Consumption** - Local nodes consume significant CPU/memory

Additionally, while Aptos Move contracts and TypeScript SDK are implemented (Epic 13), integration gaps remain:

- Agent server has EVM and XRP payment channel endpoints, but no Aptos equivalents
- Test runner has phases for EVM and XRP but no Aptos phases

---

## Proposed Solution

Complete the Aptos payment channel integration and switch to **public testnets** for all three chains:

1. **Agent Server HTTP Endpoints** - Add Aptos channel management endpoints (`/aptos-channels/*`)
2. **Test Runner Aptos Phases** - Add Aptos-specific test phases (fund, open, verify, settle)
3. **Public Testnet Configuration** - Add `NETWORK_MODE=testnet/local` support for all chains
4. **Test Infrastructure Updates** - Make local containers optional, add testnet mode

**Public Testnet URLs:**

| Chain     | Network | Node URL                                    | Faucet URL                             |
| --------- | ------- | ------------------------------------------- | -------------------------------------- |
| **Aptos** | Testnet | `https://fullnode.testnet.aptoslabs.com/v1` | `https://faucet.testnet.aptoslabs.com` |
| **XRP**   | Testnet | `wss://s.altnet.rippletest.net:51233`       | `https://faucet.altnet.rippletest.net` |
| **Base**  | Sepolia | `https://sepolia.base.org`                  | Various (Alchemy, Coinbase)            |

---

## Success Criteria

| #   | Criterion                                                    | Verification                                              |
| --- | ------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | Agent server exposes Aptos channel HTTP endpoints            | `curl /aptos-channels` returns channel list               |
| 2   | Docker agent test includes Aptos phases (fund, open, settle) | Test output shows "Open Aptos Payment Channels: ✓"        |
| 3   | `NETWORK_MODE=testnet` connects to public testnets           | Agents connect to testnet URLs successfully               |
| 4   | `NETWORK_MODE=local` uses local Docker containers            | Backward compatible with existing local mode              |
| 5   | Test passes on ARM64 Mac with testnet mode                   | `NETWORK_MODE=testnet ./scripts/run-docker-agent-test.sh` |
| 6   | Production connector can open/settle Aptos channels          | Integration test with testnet                             |

---

## Stories

| Story | Title                                   | Description                                                                             | Points | Status |
| ----- | --------------------------------------- | --------------------------------------------------------------------------------------- | ------ | ------ |
| 28.1  | Add Agent Server Aptos HTTP Endpoints   | Implement `/aptos-channels/*` endpoints in agent-server.ts mirroring EVM/XRP patterns   | 5      | Done   |
| 28.2  | Add Test Runner Aptos Phases            | Implement Aptos test phases in docker-agent-test-runner.ts (fund, open, verify, settle) | 5      | Done   |
| 28.3  | Add Public Testnet Configuration        | Add `NETWORK_MODE` env var, testnet URLs, and configuration profiles                    | 3      | Draft  |
| 28.4  | Update Test Infrastructure for Testnets | Make local containers optional via profiles, add testnet startup mode                   | 5      | Draft  |
| 28.5  | Production Connector Aptos Settlement   | Wire AptosChannelSDK into connector settlement flow for production use                  | 4      | Draft  |

**Total Points:** 22

---

## Technical Approach

### Story 28.1: Agent Server Aptos Endpoints (Done)

Added to `packages/connector/src/agent/agent-server.ts`:

```typescript
// HTTP Endpoints
GET  /aptos-channels         - List all Aptos payment channels
POST /aptos-channels/open    - Open new channel with peer
GET  /aptos-channels/:id     - Get channel state
POST /aptos-channels/claim   - Submit claim with signature
POST /aptos-channels/close   - Request channel close
POST /configure-aptos        - Configure Aptos SDK with credentials
```

### Story 28.2: Test Runner Aptos Phases (Done)

Added to `packages/connector/src/test/docker-agent-test-runner.ts`:

```typescript
// Test phases (parallel to EVM/XRP)
[Phase] Fund Aptos Accounts...        // Faucet fund each agent
[Phase] Open Aptos Payment Channels...// Initialize channels between peers
[Phase] Verify Aptos Channels...      // Query on-chain state
```

### Story 28.3: Public Testnet Configuration (New)

Add environment variable support for network mode:

```bash
# Environment Variables
NETWORK_MODE=testnet|local  # Default: local for backward compatibility

# Testnet URLs (used when NETWORK_MODE=testnet)
APTOS_TESTNET_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
APTOS_TESTNET_FAUCET_URL=https://faucet.testnet.aptoslabs.com
XRP_TESTNET_WSS_URL=wss://s.altnet.rippletest.net:51233
XRP_TESTNET_FAUCET_URL=https://faucet.altnet.rippletest.net
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

Configuration in `docker-compose-agent-test.yml`:

```yaml
# Agent environment (testnet mode)
APTOS_NODE_URL: ${NETWORK_MODE:-local} == "testnet" ?
  "https://fullnode.testnet.aptoslabs.com/v1" : "http://aptos-local:8080/v1"
```

### Story 28.4: Test Infrastructure for Testnets

Update `docker-compose-agent-test.yml`:

```yaml
# Local blockchain services moved to profile
services:
  anvil:
    profiles: [local] # Only start in local mode
  rippled:
    profiles: [local] # Only start in local mode
  aptos-local:
    profiles: [local] # Only start in local mode
```

Update `scripts/run-docker-agent-test.sh`:

```bash
NETWORK_MODE=${NETWORK_MODE:-local}

if [ "$NETWORK_MODE" = "testnet" ]; then
    # Use public testnets - no local containers needed
    export APTOS_NODE_URL="https://fullnode.testnet.aptoslabs.com/v1"
    export XRP_WSS_URL="wss://s.altnet.rippletest.net:51233"
    export EVM_RPC_URL="https://sepolia.base.org"
else
    # Local mode - start containers
    docker compose -f "$COMPOSE_FILE" --profile local up -d
fi
```

### Story 28.5: Production Connector Integration

Wire `AptosChannelSDK` into `packages/connector/src/settlement/`:

```typescript
interface SettlementManager {
  openChannel(chain: 'evm' | 'xrp' | 'aptos', peer: PeerInfo): Promise<Channel>;
  claim(chain: string, channelId: string, amount: bigint): Promise<void>;
  settle(chain: string, channelId: string): Promise<void>;
}
```

---

## Architecture Notes

### Network Mode Selection

```
┌─────────────────────────────────────────────────────────────────┐
│                      NETWORK_MODE                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   NETWORK_MODE=local (default)     NETWORK_MODE=testnet         │
│   ┌─────────────────────────┐      ┌─────────────────────────┐  │
│   │  Local Docker           │      │  Public Testnets        │  │
│   │  ├─ anvil (EVM)         │      │  ├─ Base Sepolia        │  │
│   │  ├─ rippled (XRP)       │      │  ├─ XRP Testnet         │  │
│   │  └─ aptos-local (APT)   │      │  └─ Aptos Testnet       │  │
│   └─────────────────────────┘      └─────────────────────────┘  │
│                                                                  │
│   Use for:                         Use for:                      │
│   - Offline development            - ARM64 without QEMU          │
│   - Fast iteration                 - Production-like testing     │
│   - Isolated testing               - Cross-team testing          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Differences: Local vs Testnet

| Aspect        | Local Mode                 | Testnet Mode            |
| ------------- | -------------------------- | ----------------------- |
| Startup Time  | 30-60s (containers)        | Instant (no containers) |
| Network       | Docker bridge              | Public internet         |
| State         | Reset each run             | Persistent across runs  |
| Faucet        | Unlimited                  | Rate limited            |
| ARM64 Support | Requires multi-arch images | Native (no containers)  |
| Offline       | Yes                        | No                      |

---

## Risks & Mitigations

| Risk                          | Likelihood | Impact | Mitigation                                          |
| ----------------------------- | ---------- | ------ | --------------------------------------------------- |
| Testnet faucet rate limits    | Medium     | Medium | Implement retry with backoff, cache funded accounts |
| Testnet instability           | Low        | Medium | Fallback to local mode, add timeout handling        |
| Network latency affects tests | Medium     | Low    | Increase timeouts for testnet mode                  |
| Testnet API changes           | Low        | Medium | Pin to known-working endpoints, monitor for changes |

---

## Out of Scope

- Mainnet deployment (testnet only for now)
- Cross-chain atomic swaps (future epic)
- Hardware wallet support
- ~~Multi-arch Docker image build~~ (deprecated - using public testnets instead)

---

## Dependencies

### External

- Aptos Testnet availability
- XRP Testnet availability
- Base Sepolia availability
- Network connectivity for testnet mode

### Internal

- Epic 13: Aptos Payment Channel Move modules (✅ Complete)
- Aptos TypeScript SDK (✅ Complete)

---

## Deprecated Content

### Story 28.3 (Original): Build Multi-Arch Aptos Docker Image

**Status: DEPRECATED**

The original Story 28.3 focused on building a multi-architecture Aptos Docker image to solve ARM64 compatibility. This approach has been deprecated in favor of using public testnets, which:

1. Eliminates the need for local Aptos containers entirely
2. Removes complex multi-arch build infrastructure
3. Provides more production-like testing environment
4. Works natively on ARM64 without any special configuration

The workflow file `.github/workflows/build-aptos-image.yml` and Dockerfile at `docker/aptos/` remain in the codebase but are no longer part of the critical path.

---

## Acceptance Criteria

1. **AC1**: `curl http://localhost:8100/aptos-channels` returns Aptos channel list from agent-0
2. **AC2**: Docker agent test output includes successful Aptos phases
3. **AC3**: `NETWORK_MODE=testnet ./scripts/run-docker-agent-test.sh` passes on ARM64 Mac
4. **AC4**: `NETWORK_MODE=local ./scripts/run-docker-agent-test.sh` continues to work (backward compatible)
5. **AC5**: Production connector can open Aptos channel with testnet peer

---

## Change Log

| Date       | Version | Description                                                                 | Author        |
| ---------- | ------- | --------------------------------------------------------------------------- | ------------- |
| 2026-01-31 | 2.0     | Major pivot: Deprecated multi-arch Docker image in favor of public testnets | Product Owner |
| 2026-01-31 | 1.0     | Initial draft - Aptos integration with multi-arch Docker image              | Product Owner |

---

## References

- [Aptos Testnet Documentation](https://aptos.dev/network/faucet)
- [XRP Testnet](https://xrpl.org/xrp-testnet-faucet.html)
- [Base Sepolia](https://docs.base.org/docs/network-information)
- [Epic 13: Aptos Payment Channels](./epic-13-aptos-payment-channels.md)
- Existing SDK: `packages/connector/src/settlement/aptos-channel-sdk.ts`
