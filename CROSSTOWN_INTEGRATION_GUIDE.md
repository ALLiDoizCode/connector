# Crosstown Integration Guide

## Overview

This guide explains how to integrate Crosstown nodes with the Connector infrastructure for SPSP payment reception. This setup enables Crosstown nodes to send payments to connectors acting as receivers.

## What Was Done

### 1. E2E Test Suite

Created comprehensive end-to-end test validating SPSP receiver functionality:

- **File:** `packages/connector/test/integration/crosstown-comprehensive-e2e.test.ts`
- **Coverage:** 28 tests covering connector initialization, SPSP handshake, accounting, and on-chain verification
- **Backends:** Dual support for TigerBeetle and in-memory accounting
- **Features:** On-chain balance verification using ethers.js for Anvil chain

### 2. SPSP Handshake Documentation

Comprehensive guide for implementing SPSP client in Crosstown:

- **File:** `docs/guides/crosstown-spsp-handshake.md`
- **Contents:**
  - Complete SPSP handshake flow diagram
  - HTTP request/response examples
  - BTP connection establishment
  - ILP packet sending/receiving
  - Example TypeScript client code
  - Security considerations
  - Troubleshooting guide

### 3. Docker Infrastructure

- **Pruned old images:** Removed outdated connector and crosstown images
- **Built fresh image:** New connector:1.20.0 and connector:latest (858MB)
- **Docker Compose:** `docker-compose-base-e2e-lite.yml` for testing infrastructure

## Docker Images

### Available Images

```bash
connector:latest    # Latest build (45a5ffc4ed32)
connector:1.20.0    # Version 1.20.0
```

### Image Details

- **Size:** 858MB
- **Base:** node:22-alpine
- **Architecture:** Multi-stage build (builder, ui-builder, runtime)
- **Security:** Runs as non-root user (node)
- **Ports:**
  - 3000: BTP WebSocket server
  - 3001: Explorer UI (HTTP/WebSocket)
  - 8080: Health check HTTP endpoint

### Running the Connector

**Quick Start:**

```bash
docker run -d \
  --name connector-receiver \
  -e NODE_ID=connector-receiver \
  -e BTP_SERVER_PORT=3000 \
  -e HEALTH_CHECK_PORT=8080 \
  -p 3000:3000 \
  -p 3001:3001 \
  -p 8080:8080 \
  connector:latest
```

**With Environment Variables:**

```bash
docker run -d \
  --name connector-receiver \
  -e NODE_ID=connector-receiver \
  -e LOG_LEVEL=debug \
  -e ANVIL_RPC_URL=http://host.docker.internal:8545 \
  -e SETTLEMENT_REGISTRY_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 \
  -p 3000:3000 \
  -p 8080:8080 \
  connector:latest
```

## Testing the Integration

### 1. Start Infrastructure

```bash
# Start Anvil and TigerBeetle
docker compose -f docker-compose-base-e2e-lite.yml up -d

# Verify services are healthy
docker compose -f docker-compose-base-e2e-lite.yml ps
```

### 2. Run E2E Test

```bash
# From packages/connector directory
cd packages/connector

# Run the test
E2E_TESTS=true npm run test:crosstown-e2e
```

**Expected Output:**

```
Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
Time:        ~7 seconds
```

### 3. Test Breakdown

The test validates:

- ✅ Connector initialization (BTP server, routing table)
- ✅ SPSP payment reception with TigerBeetle accounting
- ✅ SPSP payment reception with in-memory accounting
- ✅ On-chain ETH balance verification
- ✅ On-chain token balance verification
- ✅ Anvil chain responsiveness
- ✅ Optional contract deployment checks
- ✅ Payment channel integration

## Crosstown Implementation Steps

### Phase 1: SPSP Client Implementation

**Goal:** Enable Crosstown nodes to perform SPSP handshake

**Tasks:**

1. Implement SPSP discovery (GET /.well-known/pay)
2. Parse SPSP response (destination_account, shared_secret)
3. Handle shared secret for STREAM encryption
4. Add error handling and retries

**Reference:** `docs/guides/crosstown-spsp-handshake.md` (Example code included)

### Phase 2: BTP Connection

**Goal:** Establish WebSocket connection with connector

**Tasks:**

1. Implement WebSocket client for BTP protocol
2. Handle BTP authentication
3. Add connection health monitoring (ping/pong)
4. Implement reconnection logic

**Reference:** RFC 0023 - Bilateral Transfer Protocol

### Phase 3: ILP Payment Sending

**Goal:** Send ILP packets over BTP connection

**Tasks:**

1. Create ILP PREPARE packets
2. Handle FULFILL/REJECT responses
3. Implement STREAM protocol data encryption
4. Add payment tracking and confirmation

**Reference:** RFC 0027 - Interledger Protocol V4

### Phase 4: Integration Testing

**Goal:** Validate end-to-end flow

**Tasks:**

1. Create test in Crosstown project
2. Test SPSP handshake with live connector
3. Validate payment flow with real accounting
4. Test on-chain settlement integration

**Test File:** `packages/crosstown/test/integration/spsp-sender.test.ts`

## SPSP Handshake Flow (Quick Reference)

```
Crosstown Node                       Connector
     │                                   │
     │ 1. GET /.well-known/pay           │
     │──────────────────────────────────>│
     │                                   │
     │ 2. SPSP Response                  │
     │   {destination, shared_secret}    │
     │<──────────────────────────────────│
     │                                   │
     │ 3. BTP WebSocket Connect          │
     │──────────────────────────────────>│
     │                                   │
     │ 4. ILP PREPARE packet             │
     │──────────────────────────────────>│
     │                                   │
     │ 5. ILP FULFILL response           │
     │<──────────────────────────────────│
     │                                   │
```

## Configuration Examples

### Connector Config (Receiver)

```yaml
nodeId: connector-receiver
btpServerPort: 3000
healthCheckPort: 8080

settlementInfra:
  enabled: true
  rpcUrl: http://localhost:8545
  registryAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
```

### Crosstown Config (Sender)

```yaml
nodeId: crosstown-node-1
connectorUrl: http://connector-receiver:8080
btpUrl: ws://connector-receiver:3000
btpAuthToken: optional-secret-token
```

## API Endpoints

### Connector Endpoints

**SPSP Discovery:**

```http
GET /.well-known/pay
Accept: application/spsp4+json
```

**Health Check:**

```http
GET /health
```

**BTP WebSocket:**

```
ws://connector-host:3000
```

## Security Considerations

### Production Checklist

- [ ] Use HTTPS for SPSP requests (not HTTP)
- [ ] Use WSS for BTP connections (not WS)
- [ ] Configure BTP authentication tokens
- [ ] Rotate secrets regularly
- [ ] Implement rate limiting on SPSP endpoint
- [ ] Never log shared secrets
- [ ] Use secure random generation for secrets
- [ ] Monitor for suspicious payment patterns

## Troubleshooting

### Common Issues

**1. SPSP 404 Error**

- **Cause:** Connector's public API not enabled
- **Fix:** Enable `publicApi.spspEnabled: true` in connector config

**2. BTP Connection Refused**

- **Cause:** BTP server not started or firewall blocking
- **Fix:** Check `btpServerPort` config and firewall rules

**3. ILP Packet Rejected**

- **Cause:** Invalid ILP address or insufficient balance
- **Fix:** Verify ILP address matches SPSP response exactly

**4. Contract Deployment Failed**

- **Cause:** Anvil not running or deployer container exited
- **Fix:** Restart docker-compose infrastructure

## Next Steps

1. **Review SPSP Documentation**
   - Read `docs/guides/crosstown-spsp-handshake.md`
   - Understand the handshake flow and packet format

2. **Run E2E Test Locally**
   - Validate connector setup works
   - Study test implementation as reference

3. **Implement SPSP Client**
   - Use provided example code as template
   - Start with handshake, then BTP, then payments

4. **Create Crosstown Tests**
   - Write integration tests in Crosstown project
   - Test against live connector instance

5. **Production Hardening**
   - Add comprehensive error handling
   - Implement retry logic
   - Add metrics and monitoring

## Resources

### Documentation

- `docs/guides/crosstown-spsp-handshake.md` - Complete SPSP guide with code examples
- `packages/connector/test/integration/crosstown-comprehensive-e2e.test.ts` - Working E2E test
- `docker-compose-base-e2e-lite.yml` - Infrastructure configuration

### RFCs

- RFC 0009: Simple Payment Setup Protocol
- RFC 0027: Interledger Protocol V4
- RFC 0029: STREAM Protocol
- RFC 0023: Bilateral Transfer Protocol

### Scripts

- `scripts/run-crosstown-e2e-test.sh` - Run E2E test with infrastructure
- `npm run test:crosstown-e2e` - Run test (requires E2E_TESTS=true)

## Support

For questions or issues with Crosstown integration:

1. Check troubleshooting section above
2. Review SPSP handshake documentation
3. Examine E2E test for working implementation
4. Check connector logs for error details
