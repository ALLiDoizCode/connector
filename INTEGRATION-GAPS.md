# Agent-Runtime Integration Gaps

**Last Updated:** 2026-02-09
**Context:** Epic 20 (Bidirectional Middleware), Epic 21 (Payment Channel Admin APIs), Epic 22 (Middleware Simplification), Epic 23 (Unified Deployment) implementation analysis

---

## Executive Summary

Epics 20-23 are **~85% complete**. The connector Admin API endpoints exist and work (Epic 21), the agent-runtime middleware is simplified and bidirectional (Epic 22), and unified deployment infrastructure is in place (Epic 23). However, there are **integration mismatches with agent-society** and some connector endpoints that assume data is already present instead of accepting it in requests.

**Critical Impact:** The BLS (agent-society) cannot successfully open payment channels during SPSP handshakes because the connector expects peer settlement addresses to already be registered via `POST /admin/peers`, but the BLS receives that data IN the SPSP request itself and has no way to provide it to the channel opening call.

---

## Gap 1: `POST /admin/channels` Missing `peerAddress` Parameter ❌ CRITICAL

**File:** `packages/connector/src/http/admin-api.ts` lines 751-865
**Epic:** 21 (Story 21.1)

### Current Implementation

The endpoint accepts:

```typescript
interface OpenChannelRequest {
  peerId: string;
  chain: string;
  token?: string;
  tokenNetwork?: string;
  initialDeposit: string;
  settlementTimeout?: number;
}
```

For XRP channels (lines 811-818), it looks up the peer's address:

```typescript
const peerConfig = settlementPeers?.get(body.peerId);
if (!peerConfig?.xrpAddress) {
  res.status(400).json({ error: 'Peer has no XRP address configured' });
  return;
}
```

Similar pattern is expected for EVM channels.

### The Problem

During the SPSP handshake (agent-society Epic 7), the BLS receives the peer's settlement address **in the SPSP request itself** and needs to open a channel immediately. The peer hasn't been registered with settlement info yet — registration with settlement only happens AFTER the channel is opened and channelId is returned.

**Circular dependency:**

1. BLS receives SPSP request with peer's address
2. BLS wants to call `POST /admin/channels`
3. Connector expects address in `settlementPeers.get(peerId)`
4. But `settlementPeers` won't have it until SPSP completes
5. SPSP can't complete without opening the channel

### Fix Required

Add `peerAddress` to `OpenChannelRequest`:

```typescript
interface OpenChannelRequest {
  peerId: string;
  chain: string;
  token?: string;
  tokenNetwork?: string;
  peerAddress: string; // ← ADD THIS
  initialDeposit: string;
  settlementTimeout?: number;
}
```

Update the endpoint handler to:

1. Use `body.peerAddress` if provided
2. Fall back to `settlementPeers.get(peerId)` if not provided (backward compat)
3. Return 400 if neither is available

**Impact on EVM path** (lines 770-800):

- Pass `peerAddress` to `channelManager.ensureChannelExists()` or the underlying SDK
- The SDK needs the peer's address to create a bidirectional channel

**Impact on XRP path** (lines 801-835):

- Replace `peerConfig.xrpAddress` lookup with `body.peerAddress || peerConfig?.xrpAddress`

### Why This Matters

Without this change, **all SPSP-initiated channel opening will fail** with "Peer has no address configured" errors during bootstrap.

---

## Gap 2: `IlpSendResponse` Uses `fulfilled` Instead of `accepted` ⚠️

**File:** `packages/agent-runtime/src/http/ilp-send-handler.ts` lines 199-221
**Epic:** 20 (Story 20.1)

### Current Response Format

```typescript
// FULFILL
{ fulfilled: true, fulfillment: "...", data: "..." }

// REJECT
{ fulfilled: false, code: "...", message: "...", data: "..." }
```

### Agent-Society Expects

```typescript
interface IlpSendResult {
  accepted: boolean; // ← Not "fulfilled"
  fulfillment?: string;
  data?: string;
  code?: string;
  message?: string;
}
```

Agent-society checks `if (!ilpResult.accepted)` at:

- `BootstrapService.ts:410`
- `IlpSpspClient.ts:119`

### Impact

All SPSP handshakes fail because `accepted` is undefined. The condition `!ilpResult.accepted` is always truthy (undefined is falsy), causing the error handling branch to execute.

**This is a critical bug** that would prevent bootstrap from working.

### Fix Required

Change `ilp-send-handler.ts` lines 200, 211:

```typescript
// Before
fulfilled: true,
fulfilled: false,

// After
accepted: true,
accepted: false,
```

Or maintain both fields for backward compatibility:

```typescript
fulfilled: true,
accepted: true,
```

### Files to Update

- `packages/agent-runtime/src/http/ilp-send-handler.ts` (response field name)
- `packages/agent-runtime/src/types/index.ts` (IlpSendResponse interface if it exists)
- Any tests that check `fulfilled` field

---

## Gap 3: `POST /admin/peers` Returns 409 on Duplicate Registration ⚠️

**File:** `packages/connector/src/http/admin-api.ts` lines 332-340
**Epic:** 20 (Story 20.3)

### Current Behavior

```typescript
if (existingPeers.includes(body.id)) {
  res.status(409).json({
    error: 'Conflict',
    message: `Peer with id '${body.id}' already exists`,
  });
  return;
}
```

### Agent-Society Behavior

`BootstrapService.ts` calls `addPeer()` twice for the same peer:

1. Line 347: Initial registration (routing only)
2. Line 440: Update with settlement config after SPSP

The second call will return 409 Conflict.

### Impact

Settlement config update fails. The peer remains registered with routing but no settlement info, so:

- Channel opening will fail (Gap 1)
- Balance queries won't work
- Settlement monitoring won't track the peer

### Fix Required

**Option A — Idempotent POST** (Recommended):

```typescript
if (existingPeers.includes(body.id)) {
  // Update existing peer instead of rejecting
  await btpClientManager.updatePeer(peer);

  // Update settlement config if provided
  if (body.settlement && settlementPeers) {
    settlementPeers.set(body.id, peerConfig);
  }

  // Update routes
  if (body.routes) {
    for (const route of body.routes) {
      routingTable.addRoute(route.prefix, body.id, route.priority ?? 0);
    }
  }

  res.status(200).json({ success: true, peer: {...}, updated: true });
  return;
}
```

**Option B — Add PUT endpoint:**

- `PUT /admin/peers/:peerId` for updates
- Keep `POST /admin/peers` for create-only
- Agent-society calls POST then PUT

**Option C — Make second call conditional:**

- Agent-society checks if peer exists first
- Only calls `addPeer()` once with complete config
- Requires restructuring bootstrap phases

### Recommendation

Option A (idempotent POST) is simplest and most robust. It matches REST semantics where POST can be used for both create and update.

---

## Gap 4: Channel Manager `ensureChannelExists()` Signature Unknown ⚠️

**File:** `packages/connector/src/http/admin-api.ts` line 784
**Epic:** 21 (Story 21.1)

### Current Call

```typescript
const channelId = await channelManager.ensureChannelExists(body.peerId, tokenId, {
  initialDeposit: BigInt(body.initialDeposit),
  settlementTimeout: body.settlementTimeout,
  chain: body.chain,
});
```

### Unknown

The `ChannelManager` interface passed to `createAdminRouter()` is typed as `ChannelManager` (line 40), but I don't have visibility into:

- Whether `ensureChannelExists()` accepts a `peerAddress` parameter
- How it gets the peer's on-chain address for creating the channel
- Whether it pulls from `settlementPeers` map or expects it in the options

### Why This Matters

If `ensureChannelExists()` internally looks up `settlementPeers.get(peerId)`, then Gap 1's fix won't work — need to pass `peerAddress` all the way down through the ChannelManager to the underlying SDK.

### Investigation Required

Read `packages/connector/src/settlement/channel-manager.ts` to understand:

- `ensureChannelExists()` signature
- How peer address is resolved
- Whether it can accept `peerAddress` as a parameter

---

## Gap 5: Stale SPSP Endpoint Test in Deploy Script ⚠️

**File:** `scripts/deploy-5-peer-multihop.sh` lines 1447-1466
**Epic:** 22, 23

### Stale Test

```bash
curl -H 'Accept: application/spsp4+json' http://localhost:3100/.well-known/pay
```

### Why It's Stale

Epic 22 (Middleware Simplification) removed SPSP HTTP endpoints from agent-runtime:

- "Remove SPSP HTTP endpoints" (UNIFIED-DEPLOYMENT-PLAN.md line 79)
- "Agent-society handles SPSP via Nostr (kind:23194/23195)" (line 69)

The `--with-agent` test mode still checks for this endpoint and expects it to return SPSP parameters.

### Impact

Test fails when run with `--with-agent` flag in post-Epic-22 deployments.

### Fix Required

Remove or comment out the SPSP endpoint test (lines 1447-1466) from the `--with-agent` test suite. Replace with a test that:

- Sends a kind:23194 via `POST /ilp/send`
- Verifies FULFILL contains kind:23195 response
- Checks that settlement negotiation occurred (if applicable)

---

## Gap 6: No `GET /admin/channels` Verification in Unified Deploy Script ⚠️

**File:** `scripts/deploy-5-peer-multihop.sh` lines 745-776
**Epic:** 23

### Current Phase 5 Verification

```bash
CHANNELS_RESPONSE=$(curl -s "http://localhost:${ADMIN_PORT}/admin/channels")
CHANNEL_COUNT=$(echo "${CHANNELS_RESPONSE}" | grep -o '"channelId"' | wc -l)
```

### Issues

1. **No validation of response structure** — if endpoint returns an error, the grep silently returns 0
2. **No check of channel status** — channels could be in "opening" or "closed" state
3. **No verification that channels are with expected peers**
4. **TOTAL_CHANNELS could be 0 and phase still passes with "warn"** (line 772)

### Expected Verification

```bash
# For each peer, verify:
# 1. Channels endpoint returns 200
# 2. At least one channel with status="open" or status="active"
# 3. Channel is with a known peer (peer1, peer2, etc.)
# 4. Channel has non-zero deposit
# 5. Optional: verify on-chain via cast call

# Example:
CHANNELS=$(curl -s http://localhost:8181/admin/channels)
if ! echo "$CHANNELS" | jq -e '.[] | select(.status == "open" or .status == "active")' > /dev/null; then
  echo "No open channels found"
  PHASE5_FAILED=true
fi
```

### Fix Required

Enhance Phase 5 verification to validate channel details, not just count. Fail the phase if zero channels are open (not just warn).

---

## Gap 7: Missing Error Handling for Channel Opening in Admin API ⚠️

**File:** `packages/connector/src/http/admin-api.ts` lines 784-800
**Epic:** 21 (Story 21.1)

### Current Code

```typescript
const channelId = await channelManager.ensureChannelExists(body.peerId, tokenId, {
  initialDeposit: BigInt(body.initialDeposit),
  settlementTimeout: body.settlementTimeout,
  chain: body.chain,
});

log.info({ peerId: body.peerId, chain: body.chain, channelId }, 'Channel opened via Admin API');

res.status(201).json({
  channelId,
  chain: body.chain,
  status: 'open',
  deposit: body.initialDeposit,
} satisfies OpenChannelResponse);
```

### Missing

No check for:

- Whether `ensureChannelExists()` actually succeeded (could return null/undefined)
- Whether the channel is truly open or still opening
- On-chain confirmation of channel state

The response hardcodes `status: 'open'` regardless of actual state.

### Impact

The BLS polls `GET /admin/channels/:channelId` expecting the status to transition to "open", but the POST response already claims it's open. If the channel is actually still "opening", the BLS's polling might succeed on the first check and include an unconfirmed channelId in the SPSP response.

### Fix Required

```typescript
const channelId = await channelManager.ensureChannelExists(...);

// Query actual state
const metadata = channelManager.getChannelById(channelId);
if (!metadata) {
  res.status(500).json({ error: 'Channel created but metadata unavailable' });
  return;
}

res.status(201).json({
  channelId,
  chain: body.chain,
  status: metadata.status,  // Actual status, not hardcoded
  deposit: body.initialDeposit,
});
```

---

## Gap 8: `POST /admin/channels` Doesn't Validate Peer Exists ⚠️

**File:** `packages/connector/src/http/admin-api.ts` lines 751-865
**Epic:** 21

### Current Code

No check that `body.peerId` exists in `btpClientManager.getPeerIds()` before attempting to open a channel.

### Impact

If the BLS calls `POST /admin/channels` before calling `POST /admin/peers`, the channel opening will succeed but:

- No BTP route to the peer exists
- Can't send claims via BTP
- Channel is orphaned

### Expected Behavior

```typescript
const existingPeers = btpClientManager.getPeerIds();
if (!existingPeers.includes(body.peerId)) {
  res.status(404).json({
    error: 'Not found',
    message: `Peer '${body.peerId}' must be registered before opening channels`,
  });
  return;
}
```

### Fix Required

Add peer existence check at the start of the `POST /admin/channels` handler (after validation, before channel opening).

---

## Gap 9: Settlement Fields in `POST /admin/peers` Not Fully Utilized ⚠️

**File:** `packages/connector/src/http/admin-api.ts` lines 379-530
**Epic:** 20 (Story 20.3)

### Current Implementation

The endpoint accepts `settlement?: AdminSettlementConfig` and validates it thoroughly (lines 379-475), then creates a `PeerConfig` and stores it in `settlementPeers` map (lines 491-530).

### What Works

- Validation of preference, addresses, tokens, chainId
- Storage in `settlementPeers` map
- Returned in `GET /admin/peers` response

### What's Missing

The stored `PeerConfig` is **never used by channel opening logic** because:

- `POST /admin/channels` for XRP explicitly looks up from `settlementPeers` (line 811) ✅
- `POST /admin/channels` for EVM has no such lookup ❌
- EVM channel path derives `tokenId` from `body.token` but doesn't get peer's EVM address from anywhere

### Impact

Even if Gap 1 is fixed to accept `peerAddress` in the request, the existing `settlementPeers` registration is underutilized. Channels can only be opened by providing ALL info in the channel request, not relying on prior peer registration.

### Fix Required

Document that `settlement` in `POST /admin/peers` is optional metadata and not required for channel opening if `peerAddress` is provided in the channel request. Or enhance EVM channel opening to check `settlementPeers` first:

```typescript
// Try to get peer address from registration, fall back to request body
const peerConfig = settlementPeers?.get(body.peerId);
const peerAddress = body.peerAddress || peerConfig?.evmAddress;

if (!peerAddress) {
  res.status(400).json({
    error: 'Bad request',
    message: 'Peer address must be provided in request or peer registration',
  });
  return;
}
```

---

## Gap 10: Admin API Response Doesn't Match Agent-Society Types ⚠️

**Files:**

- Agent-runtime returns: `admin-api.ts` lines 795-800, 1437-1442
- Agent-society expects: `packages/core/src/types.ts` lines 159-164, 169-176

### The Mismatch

**Agent-runtime `OpenChannelResponse`:**

```typescript
interface OpenChannelResponse {
  channelId: string;
  chain: string;
  status: string;
  deposit: string;
}
```

**Agent-society `OpenChannelResult`:**

```typescript
interface OpenChannelResult {
  channelId: string;
  status: string; // No 'chain' or 'deposit'
}
```

### Impact

Agent-society's `ConnectorChannelClient.openChannel()` expects only `{channelId, status}` in the response. The connector returns extra fields that are ignored. This is benign (extra fields don't break anything), but shows interface drift.

### Fix Required

Either:

- Update agent-society's `OpenChannelResult` to include `chain` and `deposit` fields
- Or document that connector returns a superset of required fields

---

## Gap 11: `ChannelState` Interface Mismatch ⚠️

**Files:**

- Agent-runtime returns: `admin-api.ts` lines 1454-1460 (ChannelDetailResponse)
- Agent-society expects: `packages/core/src/types.ts` lines 169-176

### The Mismatch

**Agent-society expects:**

```typescript
interface ChannelState {
  channelId: string;
  status: 'opening' | 'open' | 'closed' | 'settled';
  chain: string;
}
```

**Agent-runtime returns** (GET /admin/channels/:id):

```typescript
interface ChannelDetailResponse {
  channelId: string;
  status: string;
  deposit: string;
  [key: string]: unknown; // Many other fields
}
```

### Impact

Agent-society's `getChannelState()` can extract the fields it needs, but:

- Status values might not match the enum (`'opening' | 'open' | 'closed' | 'settled'`)
- Agent-runtime uses `'active'` in some places (line 1028), `'open'` in others (line 798)
- Agent-society code expects specific enum values

### Fix Required

Standardize status values across both repos:

- Define canonical channel status enum
- Ensure connector returns values from the enum
- Agent-society validates received status against enum

---

## Gap 12: No `PUT /admin/peers/:peerId` Endpoint ⚠️

**File:** `packages/connector/src/http/admin-api.ts`
**Epic:** 20, 21

### Current API

- `GET /admin/peers` ✅
- `POST /admin/peers` ✅ (create only, returns 409 on duplicate)
- `DELETE /admin/peers/:peerId` ✅
- No `PUT` or `PATCH` endpoint

### Agent-Society Need

After SPSP completes, agent-society wants to update the peer registration with:

- `channelId`
- `negotiatedChain`
- `settlementAddress`
- `tokenAddress`
- `tokenNetworkAddress`

Currently it calls `addPeer()` again with all fields, which returns 409.

### Fix Required

Add `PUT /admin/peers/:peerId`:

```typescript
router.put('/peers/:peerId', async (req: Request, res: Response) => {
  const peerId = req.params.peerId;
  const existingPeers = btpClientManager.getPeerIds();

  if (!existingPeers.includes(peerId)) {
    res.status(404).json({ error: 'Peer not found' });
    return;
  }

  // Update settlement config if provided
  if (req.body.settlement && settlementPeers) {
    const existing = settlementPeers.get(peerId) || {};
    const merged = { ...existing, ...buildPeerConfig(req.body) };
    settlementPeers.set(peerId, merged);
  }

  // Update routes if provided
  if (req.body.routes) {
    for (const route of req.body.routes) {
      routingTable.addRoute(route.prefix, peerId, route.priority ?? 0);
    }
  }

  res.json({ success: true, peerId, updated: true });
});
```

Or make `POST /admin/peers` idempotent (Gap 3).

---

## Gap 13: Missing `peerAddress` Propagation to Channel SDK ⚠️

**File:** `packages/connector/src/settlement/channel-manager.ts` (not read, inferred from admin-api.ts)
**Epic:** 21

### Assumption

The `ChannelManager.ensureChannelExists()` method likely calls the underlying `PaymentChannelSDK` to create an on-chain channel. For bidirectional channels, the SDK needs:

- Our address (from wallet/config)
- Peer's address (from... where?)

### Current State (Inferred)

If `ensureChannelExists()` doesn't accept `peerAddress` as a parameter, it must:

- Look up from `settlementPeers.get(peerId)` (creates Gap 1 circular dependency)
- Or derive from `peerId` somehow (doesn't work — peerId is a string like "nostr-abc123", not an address)

### Fix Required

Update `ChannelManager.ensureChannelExists()` signature to accept `peerAddress`:

```typescript
async ensureChannelExists(
  peerId: string,
  tokenId: string,
  options: {
    initialDeposit: bigint;
    settlementTimeout?: number;
    chain: string;
    peerAddress: string;  // ← ADD THIS
  }
): Promise<string>
```

Then pass it through to the SDK when creating the channel.

---

## Gap 14: Unified Docker Compose Missing Environment Variable Interpolation ⚠️

**File:** `docker-compose-unified.yml` (referenced in deploy script line 46, 573, but never read)
**Epic:** 23

### Expected

The deployment plan (UNIFIED-DEPLOYMENT-PLAN.md lines 236-238) shows:

```yaml
KNOWN_PEERS: |
  [{"pubkey": "${PEER1_NOSTR_PUBKEY}", "relayUrl": "ws://agent-society-1:7100", "btpEndpoint": "ws://peer1:3000"}]
```

### Unknown

Haven't read `docker-compose-unified.yml` to verify:

- Whether it exists
- Whether env var substitution is correct (${PEER1_NOSTR_PUBKEY}, ${PEER1_EVM_ADDRESS}, etc.)
- Whether all 16 services are defined
- Whether dependency chains match the plan

### Investigation Required

Read `/Users/jonathangreen/Documents/agent-runtime/docker-compose-unified.yml` to verify Epic 23 unified stack is correctly configured.

---

## Gap 15: No Validation of ILP FULFILL Data Field in Middleware ⚠️

**File:** `packages/agent-runtime/src/packet/packet-handler.ts` lines 77-88
**Epic:** 22

### Current Code

```typescript
return {
  fulfill: {
    fulfillment: fulfillment.toString('base64'),
    data: response.data, // ← Passes through BLS data blindly
  },
};
```

### Missing

No validation that:

- `response.data` is valid base64 (if present)
- `response.data` size is within ILP limits (32KB max)
- `response.data` can be decoded back to valid TOON

### Impact

If the BLS returns malformed data, the ILP FULFILL packet will be invalid and the connector might reject it or propagate garbage to the sender.

### Fix Required

Add validation before passing through:

```typescript
if (response.data) {
  // Validate base64
  try {
    const decoded = Buffer.from(response.data, 'base64');
    if (decoded.length > 32768) {
      this.logger.warn('BLS response data exceeds 32KB, truncating');
      // Decide: truncate, omit, or reject
    }
  } catch {
    this.logger.warn('BLS returned invalid base64 data, omitting from FULFILL');
    response.data = undefined;
  }
}
```

---

## Priority Fix Order

### P0 - Critical (Bootstrap Broken)

1. **Gap 2:** Fix `fulfilled` → `accepted` field name in `IlpSendResponse`
2. **Gap 1:** Add `peerAddress` parameter to `POST /admin/channels`
3. **Gap 3:** Make `POST /admin/peers` idempotent (or add PUT endpoint)

### P1 - High (Functionality Incomplete)

4. **Gap 13:** Propagate `peerAddress` to `ChannelManager.ensureChannelExists()`
5. **Gap 4:** Investigate and update ChannelManager signature
6. **Gap 8:** Add peer existence validation to `POST /admin/channels`

### P2 - Medium (Polish & Safety)

7. **Gap 7:** Add error handling and state verification to channel opening
8. **Gap 15:** Validate BLS response data before passing to FULFILL
9. **Gap 11:** Standardize channel status enum values

### P3 - Low (Testing & Documentation)

10. **Gap 5:** Update deploy script to remove stale SPSP test
11. **Gap 6:** Enhance Phase 5 channel verification in unified deploy
12. **Gap 14:** Verify docker-compose-unified.yml correctness
13. **Gap 10:** Document OpenChannelResponse field superset

---

## Related Agent-Society Gaps

See `INTEGRATION-GAPS.md` in the agent-society repository for BLS-side gaps:

- BLS `/handle-payment` missing settlement negotiation
- `ConnectorChannelClient` never instantiated
- Two SPSP code paths never converge
- TOON + NIP-44 round-trip untested

---

## Testing Recommendations

### Integration Tests Needed

- [ ] Full bootstrap flow with channel opening (local Anvil + all 3 layers)
- [ ] `POST /admin/channels` with all parameters including `peerAddress`
- [ ] `POST /admin/peers` idempotency (create, update, verify)
- [ ] Channel state polling until "open"
- [ ] Error cases: missing peer, invalid address, channel already exists

### E2E Tests Needed

- [ ] `./deploy-5-peer-multihop.sh --unified` with channel verification
- [ ] Cross-peer payments after bootstrap (verify channels are used)
- [ ] Settlement claim exchange through opened channels

### Acceptance Criteria for Complete Integration

- [ ] Bootstrap completes with 0 warnings
- [ ] All peers have at least 1 open channel (verified via `GET /admin/channels`)
- [ ] Test packet peer1 → peer5 succeeds with FULFILL
- [ ] Channel opening time < 30s (Base L2 confirmation time)
- [ ] SPSP responses include `channelId`, `negotiatedChain`, `settlementAddress`

---

## Notes

- Most gaps are **API integration mismatches** — both sides have the logic but expect different signatures
- The connector Admin API is production-ready; the BLS just isn't calling it correctly yet
- Fixes are mostly straightforward parameter additions and field renames
- No fundamental architectural changes required
