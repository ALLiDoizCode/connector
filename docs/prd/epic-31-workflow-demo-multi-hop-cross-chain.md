# Epic 31: ILP Workflow Demo with Multi-Hop Routing and Cross-Chain Settlement

## Epic Goal

Create a production-ready ILP workflow demonstration showcasing multi-hop payment routing through computational services with both same-currency settlement (Aptos) and cross-chain currency exchange (Aptos to ETH on Base), proving ILP's ability to facilitate complex payment flows across heterogeneous blockchain networks.

## Epic Description

### Existing System Context

**Current M2M Infrastructure:**

- **ILP Connector Framework**: Node.js 22, TypeScript 5, BTP/SPSP protocol support
- **Settlement Engines**: Aptos integration complete (Epic 28), payment channel support
- **Agent System**: Nostr-based peer discovery, event-driven architecture
- **Explorer UI**: React 18 + shadcn-ui v4 for network monitoring
- **Database**: SQLite (better-sqlite3) for persistence, claim storage (Epic 30)

**Existing Infrastructure (Incomplete):**

- Documentation: Comprehensive 50+ page workflow demo guide
- Docker Infrastructure: 6-container orchestration (docker-compose-workflow-demo.yml)
- Dockerfiles: workflow-peer, facilitator, client-ui (all created)
- Scripts: run-workflow-demo.sh startup automation
- Network Setup: setup-network.ts for payment channels and routes

### Enhancement Details

**What's Being Added:**

This epic implements the **missing application code** to make the workflow demo functional:

1. **Workflow Peer Server** - ILP connector with Sharp image processing capabilities
   - Receives ILP packets addressed to `g.workflow.*`
   - Parses workflow address to extract processing pipeline steps
   - Executes image operations: resize, watermark, optimize
   - Returns processed image in ILP Fulfill packet

2. **Facilitator Server** - X402 HTTP-to-ILP gateway
   - Accepts HTTP POST requests from web clients
   - Performs SPSP handshake with workflow peer
   - Establishes BTP connections to first-hop connector
   - Routes ILP packets through multi-hop network
   - Maintains service registry of workflow providers

3. **Client UI** - React frontend for image upload/processing
   - Upload image files (PNG/JPEG/WebP, max 10MB)
   - Select processing options (resize, watermark, optimize)
   - Display cost breakdown (450 msat total)
   - Show processed image with download button
   - Monitor payment routing through network

4. **Cross-Chain Settlement Support** - ETH on Base integration
   - Add Base (Ethereum L2) settlement engine
   - Implement EVM payment channel SDK for Base
   - Enable connector to hold both Aptos and Base channels
   - Support currency exchange: client pays Aptos, connector receives Base

**Two Demonstration Variants:**

**Variant A: Same-Currency 3-Hop (Baseline)**

```
Client → Facilitator → Connector1 → Connector2 → Workflow Peer
         [Aptos]      [Aptos]       [Aptos]       [Aptos]
```

- All hops settle in Aptos
- Demonstrates multi-hop routing
- Proves payment channel flow across 3 intermediaries

**Variant B: Cross-Chain Currency Exchange (Advanced)**

```
Client → Facilitator → Connector1 → Connector2 → Workflow Peer
         [Aptos]      [Aptos→Base] [Base]        [Base]
                      Exchange
```

- Client pays in Aptos (450 msat)
- Connector1 exchanges Aptos → ETH on Base
- Connector2 and Workflow Peer receive ETH on Base
- Demonstrates ILP's currency-agnostic routing

**How It Integrates:**

- **Existing Connector Framework**: Workflow peer extends existing Agent class
- **BTP/SPSP Protocols**: Reuses existing protocol implementations (RFC 23, RFC 9)
- **Payment Channels**: Leverages Epic 28 Aptos integration + new Base support
- **Claim Storage**: Uses Epic 30 ClaimStore for balance proof persistence
- **Explorer UI**: Existing UI monitors payment flow through all hops
- **Docker Infrastructure**: Leverages existing Dockerfile.agent pattern

**Success Criteria:**

1. **Functional Demo**:
   - Run `./scripts/run-workflow-demo.sh` successfully starts all 6 containers
   - Upload image via http://localhost:3000, process with 3 steps, receive result
   - Payment routes through 3 hops (visible in Explorer UIs)
   - Processed image downloaded with watermark + resize + optimization applied

2. **Same-Currency Variant**:
   - All 4 nodes (Facilitator, C1, C2, Workflow) settle to Aptos
   - Payment channels established with 1M msat initial balance
   - Settlement triggered when threshold exceeded (verifiable on Aptos testnet)

3. **Cross-Chain Variant**:
   - Connector1 holds bidirectional channels: upstream Aptos, downstream Base
   - Client pays 450 msat in Aptos equivalent
   - Connector1 exchanges currency (Aptos → ETH on Base)
   - Connector2 and Workflow Peer receive Base ETH settlement
   - Exchange rate and fees transparent in logs

4. **Performance**:
   - Image processing completes in <2 seconds for 5MB images
   - End-to-end latency <3 seconds (HTTP request → processed result)
   - No packet failures under normal conditions

5. **Documentation**:
   - Architecture document explains cross-chain exchange mechanism
   - Deployment guide covers both variants
   - Troubleshooting section addresses common issues

## Stories

### Story 31.1: Workflow Peer Server with Image Processing

**Goal**: Implement workflow peer server that receives ILP packets, executes Sharp image processing, and returns results.

**Key Deliverables**:

- `packages/connector/src/workflow/workflow-peer-server.ts` - Main server entry point
- `packages/connector/src/workflow/image-processor.ts` - Sharp integration (resize, watermark, optimize)
- `packages/connector/src/workflow/workflow-handler.ts` - Address parsing and pipeline execution
- Step registry for extensible workflow operations
- Cost calculation per step (100-200 msat each)
- ILP packet integration (accept ILPv4 Prepare, return Fulfill with image data)

**Acceptance Criteria**:

- Workflow peer starts on port 8203, accepts BTP connections on 3203
- Receives ILP packet addressed to `g.workflow.resize.watermark.optimize`
- Parses address to extract steps: [resize, watermark, optimize]
- Executes steps sequentially using Sharp
- Returns processed image in ILP Fulfill packet (base64 encoded)
- Rejects packets with insufficient payment (cost = 450 msat)
- Handles errors gracefully (invalid image format, oversized file)

---

### Story 31.2: Facilitator Server with X402 Gateway

**Goal**: Implement HTTP-to-ILP gateway that accepts web requests, performs SPSP handshake, and routes packets through multi-hop network.

**Key Deliverables**:

- `packages/connector/src/facilitator/facilitator-server.ts` - Express HTTP server on port 3001
- `packages/connector/src/facilitator/spsp-client.ts` - SPSP payment pointer resolution
- `packages/connector/src/facilitator/service-registry.ts` - Workflow service directory
- POST /api/workflow/process endpoint (accepts image + options)
- BTP plugin for connector communication
- ILP packet construction and routing

**Acceptance Criteria**:

- Facilitator starts on port 3001, serves HTTP API
- POST /api/workflow/process endpoint accepts multipart/form-data (image file)
- Performs SPSP handshake with workflow peer (discovers g.workflow.\* address)
- Constructs ILP Prepare packet with image data and 450 msat amount
- Routes packet to Connector1 via BTP
- Receives ILP Fulfill, extracts processed image, returns HTTP 200 with image
- Service registry stores workflow capabilities (max size, formats, pricing)
- Handles SPSP failures (peer unreachable, invalid payment pointer)

---

### Story 31.3: Client UI for Image Upload and Processing

**Goal**: Create React frontend with shadcn-ui components for image upload, processing option selection, and result display.

**Key Deliverables**:

- `packages/connector/client-ui/src/App.tsx` - Main application component
- `packages/connector/client-ui/src/components/ImageUploader.tsx` - File upload with drag-and-drop
- `packages/connector/client-ui/src/components/ProcessingOptions.tsx` - Checkbox selection (resize, watermark, optimize)
- `packages/connector/client-ui/src/components/CostBreakdown.tsx` - Display 450 msat total cost
- `packages/connector/client-ui/src/components/ResultViewer.tsx` - Before/after image comparison
- API client for facilitator communication

**Acceptance Criteria**:

- UI loads at http://localhost:3000 with shadcn-ui Card component
- Image upload supports drag-and-drop and file picker
- File validation: PNG/JPEG/WebP, max 10MB
- Processing options displayed with checkboxes (all checked by default)
- Cost breakdown shows: Resize (100 msat), Watermark (200 msat), Optimize (150 msat)
- "Process Image" button triggers POST to facilitator API
- Loading spinner during processing (2-3 seconds)
- Result displays before/after images side-by-side
- Download button saves processed image to user's device
- Error handling: file too large, unsupported format, API failure

---

### Story 31.4: Network Setup and Multi-Hop Configuration

**Goal**: Complete setup-network.ts script to establish payment channels and configure routing tables for 3-hop network.

**Key Deliverables**:

- Enhanced `packages/connector/src/workflow/setup-network.ts` with health checks
- Payment channel opening API calls (Facilitator ↔ C1 ↔ C2 ↔ Workflow)
- Routing table configuration (g.workflow.\* prefix routing)
- Service registration with facilitator
- Validation that all peers are healthy before setup

**Acceptance Criteria**:

- Script verifies all 4 peers healthy (HTTP /health endpoints)
- Opens 3 payment channels with 1M msat initial balance each
- Configures routes: Facilitator → C1, C1 → C2, C2 → Workflow
- Registers workflow service with facilitator (pricing, capabilities)
- Logs success/failure for each step
- Script exits with code 0 on success, 1 on failure
- Idempotent: can run multiple times without errors (updates existing channels)

---

### Story 31.5: Base (ETH L2) Settlement Integration

**Goal**: Add Ethereum Base network settlement engine to enable cross-chain currency exchange at Connector1.

**Key Deliverables**:

- `packages/connector/src/settlement/base-settlement-engine.ts` - Base network integration
- EVM payment channel SDK for Base (reuse existing EVM code)
- Configuration for Base RPC URL and testnet faucet
- Dual-channel support: Connector1 holds both Aptos upstream, Base downstream
- Exchange rate calculation (Aptos → Base conversion)

**Acceptance Criteria**:

- Base settlement engine connects to Base testnet RPC
- Payment channels created on Base blockchain (ERC-20 channel contract)
- Connector1 can open channel to C2 with Base settlement
- Connector1 receives Aptos from Facilitator, sends Base to C2
- Exchange rate configurable via environment variable (default: 1 Aptos = 0.0001 ETH)
- Settlement triggered when Base channel balance exceeds threshold
- On-chain Base transactions verifiable on Base testnet explorer
- Graceful fallback: if Base unavailable, reject Base settlement but allow Aptos

---

### Story 31.6: Cross-Chain Exchange Logic and Dual-Channel Support

**Goal**: Enable Connector1 to facilitate currency exchange by holding bidirectional channels in different currencies.

**Key Deliverables**:

- `packages/connector/src/settlement/currency-exchange-handler.ts` - Exchange logic
- Enhanced routing logic: inspect packet amount, convert currency, forward with new amount
- Balance tracking: separate balances for Aptos incoming, Base outgoing
- Exchange fee calculation (configurable percentage, default 1%)
- Logging for currency exchange events

**Acceptance Criteria**:

- Connector1 accepts 450 msat Aptos from Facilitator
- Converts to Base equivalent (450 msat Aptos → ~0.000045 ETH Base)
- Deducts 1% exchange fee (4.5 msat kept by Connector1)
- Forwards 445.5 msat equivalent in Base to Connector2
- Logs exchange: { inputCurrency: 'aptos', inputAmount: 450, outputCurrency: 'base', outputAmount: 445.5, fee: 4.5 }
- Both Aptos and Base balances tracked separately
- Settlement triggers independently per currency (threshold per channel type)
- Rejects exchange if Base channel insufficient balance

---

### Story 31.7: Integration Testing and End-to-End Verification

**Goal**: Create automated tests verifying both same-currency and cross-chain variants work end-to-end.

**Key Deliverables**:

- `packages/connector/test/integration/workflow-demo-same-currency.test.ts` - Variant A tests
- `packages/connector/test/integration/workflow-demo-cross-chain.test.ts` - Variant B tests
- Docker Compose test fixtures
- Automated image upload and verification
- Settlement verification (Aptos and Base)

**Acceptance Criteria**:

- **Variant A Test**: Start 6 containers (Aptos only), upload image, verify processed result matches expected output
- **Variant B Test**: Start 6 containers (Aptos + Base), upload image, verify cross-chain exchange occurred
- Both tests verify:
  - Image processing correctness (dimensions, watermark text, file size)
  - Payment routing through all 3 hops (log inspection)
  - Settlement triggered on correct blockchain(s)
  - No packet failures or errors
- Tests run in CI/CD pipeline
- Test execution time <60 seconds (excluding Docker build)

---

### Story 31.8: Documentation and Deployment Guide

**Goal**: Update documentation to reflect completed implementation and provide deployment instructions.

**Key Deliverables**:

- Update `docs/WORKFLOW-DEMO-SUMMARY.md` with completion status
- Update `docs/workflow-demo-guide.md` with actual implementation details
- Create `docs/architecture/cross-chain-settlement.md` - Explain currency exchange mechanism
- Update `docs/workflow-demo-quick-ref.md` with troubleshooting tips
- Deployment guide for production (Kubernetes manifests)

**Acceptance Criteria**:

- Documentation reflects actual implementation (no placeholders)
- Cross-chain settlement architecture explained with diagrams
- Troubleshooting section covers common issues (port conflicts, Docker errors, settlement failures)
- Deployment guide includes:
  - Prerequisites (Docker, Node.js 22, Aptos testnet access, Base testnet access)
  - Environment variable reference
  - Kubernetes manifests for production deployment
  - Monitoring and observability setup (Prometheus, Grafana)
- API reference for facilitator endpoints
- Security considerations (API authentication, rate limiting, DOS prevention)

---

## Compatibility Requirements

**Existing System Compatibility:**

- [x] **Existing Connector API**: Workflow peer extends Agent class, implements existing ILP packet handling interface
- [x] **BTP Protocol**: Reuses existing BTP plugin implementation (no breaking changes)
- [x] **SPSP Protocol**: Facilitator implements RFC 9 SPSP client (standard-compliant)
- [x] **Explorer UI**: Existing UI works without modification (monitors workflow packets like any ILP traffic)
- [x] **Claim Storage**: Workflow peer uses Epic 30 ClaimStore for balance proof persistence
- [x] **Database Schema**: No changes to existing tables (workflow peer uses separate database file)
- [x] **Docker Images**: Uses existing Dockerfile.agent as base, adds workflow-specific layers

**New API Contracts:**

- **Facilitator API** (new, no backward compatibility needed):
  - POST /api/workflow/process - multipart/form-data image upload
  - GET /api/services - list registered workflow services
  - POST /api/services - register new workflow provider

- **Workflow Address Format** (new standard):
  - Pattern: `g.workflow.<step1>.<step2>.<stepN>`
  - Example: `g.workflow.resize.watermark.optimize`
  - Steps: resize, watermark, optimize, blur, grayscale, rotate (extensible)

**Blockchain Compatibility:**

- **Aptos**: Uses existing Epic 28 settlement engine (no changes)
- **Base**: New settlement engine, isolated from Aptos logic (no conflicts)
- **EVM Channels**: Reuses existing ERC-20 payment channel contracts on Base

## Risk Mitigation

### Primary Risks

**Risk 1: Cross-Chain Exchange Complexity**

- **Impact**: Currency conversion logic may introduce race conditions, incorrect exchange rates, or balance inconsistencies
- **Mitigation**:
  - Implement exchange as atomic operation (debit Aptos, credit Base in single transaction)
  - Use fixed exchange rate for MVP (configurable, not dynamic)
  - Extensive logging for auditing exchange events
  - Integration tests verify balance correctness after exchange
  - Fallback: If exchange fails, reject packet with ILP Reject (no partial state)
- **Rollback Plan**: Disable cross-chain variant (remove Base settlement), fall back to Aptos-only variant

**Risk 2: Image Processing Performance**

- **Impact**: Large images (10MB) may cause slow processing, timeouts, or memory exhaustion
- **Mitigation**:
  - Sharp library is production-grade, optimized for performance
  - Set max image size limit (10MB enforced at HTTP API level)
  - Stream processing where possible (avoid loading entire image into memory)
  - Timeout configuration (max 10 seconds per processing step)
  - Load testing with 10MB images before release
- **Rollback Plan**: Reduce max image size to 5MB, disable watermark step (most memory-intensive)

**Risk 3: Docker Orchestration Complexity**

- **Impact**: 6 containers with dependencies may fail to start in correct order, causing race conditions
- **Mitigation**:
  - Health checks on all containers (Docker HEALTHCHECK directive)
  - `run-workflow-demo.sh` script waits for each service before starting next
  - Retry logic with exponential backoff (max 30 seconds per service)
  - Clear error messages indicating which service failed and why
- **Rollback Plan**: Provide docker-compose down && docker-compose up recovery instructions

**Risk 4: Settlement Failures Across Chains**

- **Impact**: Aptos settlement succeeds but Base settlement fails, leading to imbalanced channels
- **Mitigation**:
  - Independent settlement per chain (failure on Base does not affect Aptos)
  - Settlement retry logic with exponential backoff
  - Manual recovery script to close channels and withdraw funds
  - Monitoring alerts for settlement failures (Prometheus metrics)
- **Rollback Plan**: Disable Base settlement, use Aptos-only variant (Variant A)

## Definition of Done

**Functional Completeness:**

- [x] All 8 stories completed with acceptance criteria met
- [x] Both Variant A (same-currency) and Variant B (cross-chain) working end-to-end
- [x] Automated integration tests passing in CI/CD
- [x] No critical bugs or crashes in demo flow

**Code Quality:**

- [x] TypeScript strict mode enabled, no compilation errors
- [x] ESLint and Prettier compliance (run `npm run lint` and `npm run format`)
- [x] > 80% code coverage for new modules (workflow-peer, facilitator, client-ui)
- [x] Security review completed (no SQL injection, XSS, DOS vulnerabilities)

**Documentation:**

- [x] Architecture document explains cross-chain exchange mechanism
- [x] Deployment guide verified by independent tester
- [x] API documentation complete (facilitator endpoints)
- [x] Troubleshooting guide covers common issues

**Testing:**

- [x] Unit tests for all new modules (workflow-peer, facilitator, image-processor, exchange-handler)
- [x] Integration tests for both variants (same-currency, cross-chain)
- [x] Load testing with 10MB images (performance validation)
- [x] Settlement verification on Aptos and Base testnets

**Deployment:**

- [x] `./scripts/run-workflow-demo.sh` successfully starts all 6 containers
- [x] Demo runs successfully on clean environment (no pre-existing state)
- [x] Kubernetes manifests tested (production deployment ready)
- [x] Monitoring dashboards configured (Prometheus + Grafana)

**Regression Testing:**

- [x] Existing connector functionality unaffected (run existing integration tests)
- [x] Epic 28 Aptos settlement still works
- [x] Epic 30 claim storage unaffected
- [x] Explorer UI still monitors all events correctly

---

## Architecture Highlights

### Multi-Hop Routing with ILPv4

**Packet Flow (Variant A - Same Currency):**

```
1. Client uploads image (5MB JPEG)
   ↓
2. Facilitator (HTTP → ILP Gateway)
   - SPSP handshake with Workflow Peer
   - Constructs ILPv4 Prepare packet:
     * Destination: g.workflow.resize.watermark.optimize
     * Amount: 450 msat
     * Data: base64(imageBytes)
   - Sends to Connector1 via BTP
   ↓
3. Connector1 (First Routing Hop)
   - Checks routing table: g.workflow.* → Connector2
   - Forwards ILP Prepare to Connector2
   - Debits 450 msat from Facilitator's channel
   - Credits 450 msat to own balance (pending settlement)
   ↓
4. Connector2 (Second Routing Hop)
   - Checks routing table: g.workflow.* → Workflow Peer
   - Forwards ILP Prepare to Workflow Peer
   - Debits 450 msat from Connector1's channel
   - Credits 450 msat to own balance (pending settlement)
   ↓
5. Workflow Peer (Destination)
   - Receives ILP Prepare
   - Validates: amount >= 450 msat, destination matches g.workflow.*
   - Parses address: [resize, watermark, optimize]
   - Executes pipeline:
     * Resize to 1024x768 using Sharp
     * Watermark "Workflow ILP Demo" at bottom-right
     * Optimize JPEG quality to 80%
   - Constructs ILP Fulfill packet:
     * Data: base64(processedImageBytes)
   - Returns to Connector2
   ↓
6. ILP Fulfill flows back: Workflow → C2 → C1 → Facilitator
   - Each hop verifies Fulfill matches Prepare
   - Balances finalized (no rollback needed)
   ↓
7. Facilitator returns HTTP 200 with processed image
   ↓
8. Client UI displays result, download button appears
```

**Settlement Flow (per hop):**

```
When Connector2 balance with Workflow Peer exceeds 1M msat:
1. Connector2 retrieves latest claim from ClaimStore (Epic 30)
2. Submits claim to Aptos blockchain:
   - Call cooperativeSettle(channelId, amount, nonce, signature)
3. Aptos smart contract verifies signature, transfers tokens
4. Connector2 balance reset to 0 (settled on-chain)
```

---

### Cross-Chain Currency Exchange (Variant B)

**Connector1 as Exchange Point:**

```
Connector1 Configuration:
- Upstream Channel: Aptos (with Facilitator)
  * Balance: 1M msat Aptos (initial)
  * Settlement: Aptos blockchain
- Downstream Channel: Base (with Connector2)
  * Balance: 1M msat Base (initial, converted to ETH)
  * Settlement: Base blockchain

Exchange Flow:
1. Receive ILP Prepare from Facilitator
   - Amount: 450 msat (in Aptos)
   - Destination: g.workflow.resize.watermark.optimize

2. Debit Aptos channel:
   - Facilitator → Connector1 balance: +450 msat Aptos

3. Convert currency:
   - Exchange rate: 1 Aptos = 0.0001 ETH (configurable)
   - Input: 450 msat Aptos
   - Fee: 1% = 4.5 msat
   - Output: 445.5 msat Aptos → ~0.00004455 ETH Base

4. Credit Base channel:
   - Connector1 → Connector2 balance: +445.5 msat Base

5. Forward ILP Prepare to Connector2
   - Amount: 445.5 msat (in Base currency)
   - Destination: unchanged (g.workflow.*)

6. Logging:
   {
     event: 'currency_exchange',
     inputCurrency: 'aptos',
     inputAmount: 450,
     outputCurrency: 'base',
     outputAmount: 445.5,
     exchangeRate: 0.0001,
     fee: 4.5,
     feePct: 1.0
   }
```

**Why This Works (ILP Design):**

- **Currency-Agnostic Packets**: ILP packets carry abstract "amount" values, not currency-specific tokens
- **Per-Hop Settlement**: Each hop settles independently to its preferred blockchain
- **Connector Risk**: Connector1 assumes exchange rate risk (if rate changes before settlement)
- **Market Making**: Connector1 acts as market maker, profiting from 1% exchange fee
- **Bilateral Channels**: Each channel has its own settlement currency (Facilitator-C1: Aptos, C1-C2: Base)

**Settlement Independence:**

```
Aptos Settlement (Facilitator ↔ Connector1):
- When Aptos channel balance > 1M msat threshold
- Submit claim to Aptos blockchain
- Transfer Aptos tokens on-chain
- Reset Aptos balance to 0

Base Settlement (Connector1 ↔ Connector2):
- When Base channel balance > 1M msat threshold
- Submit claim to Base blockchain
- Transfer ETH on Base on-chain
- Reset Base balance to 0

No Coordination Required:
- Aptos settlement failure does not affect Base settlement
- Each blockchain operates independently
- Connector1 manages exchange rate risk
```

---

## Technology Stack

**Backend:**

- Node.js 22 (LTS)
- TypeScript 5
- Express 4 (Facilitator HTTP API)
- Sharp 0.33 (Image processing)
- better-sqlite3 11.8.1 (Claim storage)

**Frontend:**

- React 18
- shadcn-ui v4 (UI components)
- Tailwind CSS 4 (Styling)
- Vite (Build tool)

**ILP Stack:**

- ILPv4 (RFC 27)
- BTP (RFC 23)
- SPSP (RFC 9)

**Blockchain:**

- Aptos (existing settlement, Epic 28)
- Ethereum Base L2 (new settlement, Story 31.5)
- EVM Payment Channel SDK (ERC-20 channels)

**Infrastructure:**

- Docker Compose (Local orchestration)
- Kubernetes (Production deployment)
- Prometheus + Grafana (Monitoring)

---

## Success Metrics

**Functional Metrics:**

- [ ] Demo runs end-to-end with 100% success rate (10 test runs)
- [ ] Image processing completes in <2 seconds (avg 5MB image)
- [ ] Total latency <3 seconds (HTTP request → response)
- [ ] No packet failures in normal operation

**Performance Metrics:**

- [ ] Supports 10 concurrent image uploads without degradation
- [ ] Memory usage <500MB per container under load
- [ ] Settlement latency <30 seconds (blockchain confirmation time)

**Quality Metrics:**

- [ ] > 80% code coverage for new modules
- [ ] Zero critical security vulnerabilities (no XSS, SQL injection, DOS)
- [ ] All integration tests passing in CI/CD

**Documentation Metrics:**

- [ ] Independent tester successfully deploys demo from docs (no assistance)
- [ ] Troubleshooting guide resolves 90% of common issues
- [ ] API documentation complete (all endpoints documented)

---

## Deployment Architecture

**Local Development (Docker Compose):**

```yaml
services:
  anvil: # Aptos local testnet (port 8545, 8081)
  base-node: # Base local testnet (port 8546, 8082) [NEW]
  workflow-peer: # Image processing (port 8203, 3203, 9203)
  connector-2: # Second hop (port 8202, 3202, 9202)
  connector-1: # First hop + Exchange (port 8201, 3201, 9201)
  facilitator: # HTTP gateway (port 8200, 3200, 9200, 3001)
  client-ui: # React frontend (port 3000)
```

**Production (Kubernetes):**

```yaml
Deployments:
  - aptos-settlement-engine (StatefulSet, persistent volume for blockchain data)
  - base-settlement-engine (StatefulSet, persistent volume for blockchain data)
  - workflow-peer (Deployment, 3 replicas, auto-scaling)
  - connector-2 (Deployment, 2 replicas)
  - connector-1 (Deployment, 2 replicas, currency exchange logic)
  - facilitator (Deployment, 3 replicas, load-balanced)
  - client-ui (Deployment, 2 replicas, CDN-backed)

Services:
  - facilitator-api (LoadBalancer, external IP)
  - client-ui (LoadBalancer, external IP)
  - Internal services (ClusterIP)

ConfigMaps:
  - Exchange rates (Aptos ↔ Base)
  - Settlement thresholds
  - Image processing limits

Secrets:
  - Blockchain private keys (Aptos, Base)
  - API authentication tokens
  - Database encryption keys
```

---

## Future Enhancements (Post-Epic)

**Phase 2 - Enhanced Workflows:**

- Video processing (FFmpeg integration)
- AI inference workflows (TensorFlow.js)
- Data pipelines (ETL with ILP payments)
- Multi-provider marketplace (multiple workflow peers)

**Phase 3 - Advanced Settlement:**

- Real-time exchange rate feeds (Chainlink oracles)
- Dynamic fee calculation (supply/demand based)
- Cross-chain atomic swaps (HTLC-based exchange)
- Additional blockchains (XRP, Polygon, Optimism)

**Phase 4 - Production Readiness:**

- Auto-scaling based on load (Kubernetes HPA)
- Geo-distributed deployment (multi-region)
- 99.9% SLA enforcement
- Disaster recovery and backup strategies
- Security hardening (API authentication, rate limiting, DDoS protection)

---

## Handoff to Story Manager

**Story Manager Handoff:**

"Please develop detailed user stories for Epic 31: ILP Workflow Demo with Multi-Hop Routing and Cross-Chain Settlement.

**Key Considerations:**

- This is a **greenfield implementation** for missing application code (workflow-peer, facilitator, client-ui)
- Infrastructure already exists: Docker Compose, Dockerfiles, run scripts, documentation (50+ pages)
- Integration points:
  - Epic 28: Aptos settlement engine (reuse existing)
  - Epic 30: ClaimStore for balance proof persistence (reuse existing)
  - Existing ILP connector framework (extend Agent class)
  - Existing BTP/SPSP protocol implementations (reuse RFC 23, RFC 9)
- Technology stack: Node.js 22, TypeScript 5, React 18, Sharp 0.33, shadcn-ui v4
- Critical compatibility requirements:
  - No breaking changes to existing connector API
  - Workflow peer extends Agent class (implements ILP packet handling interface)
  - Facilitator uses existing BTP plugin for connector communication
  - Client UI built with shadcn-ui v4 (project standard)

**Two Demonstration Variants:**

1. **Variant A (Baseline)**: Same-currency 3-hop routing with Aptos settlement throughout
2. **Variant B (Advanced)**: Cross-chain currency exchange (Aptos → ETH on Base) at Connector1

**Each story must include:**

- Verification that both variants work (where applicable)
- Integration tests for new functionality
- Cross-chain settlement verification (Variant B only)
- Backward compatibility checks (existing connector features unaffected)
- Documentation updates reflecting actual implementation

The epic should deliver a **production-ready demonstration** that proves ILP's ability to route payments through computational services across heterogeneous blockchain networks, with transparent currency exchange at intermediate hops."

---

## Epic Dependencies

**Depends On (Must Be Complete):**

- ✅ **Epic 28**: Aptos Integration (settlement engine, payment channels)
- ✅ **Epic 30**: Balance Proof Exchange (ClaimStore for claim persistence)
- ✅ **Existing ILP Framework**: BTP/SPSP protocol implementations, Agent class, Explorer UI

**Blocks (Cannot Start Until This Epic Complete):**

- **Epic 32**: Multi-Provider Workflow Marketplace (requires working single-provider demo)
- **Future**: Production deployment to cloud infrastructure (requires tested demo)

---

## Risk Assessment

**Overall Risk Level: MEDIUM-HIGH**

**High-Risk Components:**

1. **Cross-Chain Currency Exchange (Story 31.6)**: Complex logic, potential for balance inconsistencies
   - Mitigation: Extensive integration tests, fixed exchange rates for MVP, independent settlement per chain
   - Fallback: Disable cross-chain variant if issues arise

2. **Image Processing Performance (Story 31.1)**: Large images may cause memory/timeout issues
   - Mitigation: Sharp library is production-grade, enforced 10MB limit, load testing
   - Fallback: Reduce max size to 5MB, disable memory-intensive steps

**Medium-Risk Components:**

3. **Docker Orchestration (Story 31.4)**: 6 containers with dependencies, potential race conditions
   - Mitigation: Health checks, startup sequence in run script, retry logic
   - Fallback: Clear recovery instructions (docker-compose down && up)

4. **Settlement Across Chains (Story 31.5)**: Aptos succeeds but Base fails, imbalanced channels
   - Mitigation: Independent settlement per chain, retry logic, manual recovery script
   - Fallback: Disable Base settlement, use Aptos-only variant

**Low-Risk Components:**

5. **Client UI (Story 31.3)**: Straightforward React implementation with shadcn-ui
6. **Facilitator API (Story 31.2)**: Standard Express HTTP server, well-understood patterns
7. **Documentation (Story 31.8)**: Writing and updating docs (no code risk)

---

## Timeline Estimate

**Epic Duration: 3-4 Weeks (assuming full-time development)**

**Week 1:**

- Story 31.1: Workflow Peer Server (3 days)
- Story 31.2: Facilitator Server (2 days)

**Week 2:**

- Story 31.3: Client UI (2 days)
- Story 31.4: Network Setup (1 day)
- Story 31.5: Base Settlement (2 days)

**Week 3:**

- Story 31.6: Cross-Chain Exchange (3 days)
- Story 31.7: Integration Testing (2 days)

**Week 4:**

- Story 31.8: Documentation (2 days)
- Buffer for bug fixes and refinement (3 days)

**Milestones:**

- **End of Week 1**: Basic workflow demo working (Variant A, same-currency)
- **End of Week 2**: Cross-chain infrastructure complete (Base settlement integrated)
- **End of Week 3**: Both variants working end-to-end, tests passing
- **End of Week 4**: Documentation complete, demo production-ready

---

## Change Log

| Date       | Version | Description                                                                              | Author     |
| ---------- | ------- | ---------------------------------------------------------------------------------------- | ---------- |
| 2026-02-01 | 1.0     | Initial epic draft - ILP Workflow Demo with Multi-Hop Routing and Cross-Chain Settlement | Sarah (PO) |
