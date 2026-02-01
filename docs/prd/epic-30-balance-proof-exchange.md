# Epic 30: Balance Proof Exchange via Claim Events

## Brownfield Enhancement

This epic extends the Agent Society Protocol (Epic 13) to include signed balance proofs in every packet exchange, enabling automatic on-chain settlement when thresholds are exceeded. Claims are implemented as Nostr events that wrap message content, maintaining the "every packet is a Nostr event" architectural pattern.

---

## Epic Goal

Enable automatic on-chain settlement by exchanging signed balance proofs (claims) between peers via Nostr claim events. When settlement thresholds are exceeded, agents will have the cryptographic proofs needed to settle payment channels without manual intervention across all three chains (EVM, XRP, Aptos).

---

## Epic Description

### Existing System Context

- **Current relevant functionality:**
  - ILP/BTP packet exchange between agent peers (Epic 13)
  - Payment channel infrastructure for EVM (Epic 8), XRP (Epic 9), Aptos (Epic 27)
  - Existing claim signers: `payment-channel-sdk.ts` (EVM EIP-712), `xrp-claim-signer.ts` (ed25519), `aptos-claim-signer.ts` (ed25519/BCS)
  - Settlement threshold detection in `agent-server.ts` triggers but cannot execute (logs "balance proof exchange not yet implemented")
  - TOON codec for Nostr event encoding in ILP packets

- **Technology stack:**
  - TypeScript, Node.js
  - Nostr event model (NIP-01 compliant)
  - ethers.js (EVM EIP-712 signing)
  - xrpl.js + ripple-keypairs (XRP signing)
  - @aptos-labs/ts-sdk (Aptos BCS + ed25519)
  - SQLite (better-sqlite3) for persistence

- **Integration points:**
  - `agent-server.ts` - BTP packet handling, settlement threshold checks
  - `toon-codec.ts` - Nostr event encoding/decoding
  - Existing claim signers for each chain
  - EventStore for claim persistence

### Enhancement Details

**What's being added/changed:**

1. **Claim Event Types (Kind 30001-30003):** Define new Nostr event kinds where the claim IS the packet. The event wraps message content while tags carry payment proof data:
   - Kind 30001: EVM claim events (EIP-712 signatures)
   - Kind 30002: XRP claim events (ed25519 signatures)
   - Kind 30003: Aptos claim events (ed25519/BCS signatures)

2. **Event Structure:** Claims wrap content rather than being attached to packets:

   ```
   Kind 30001 (EVM Claim Event):
     content: <actual message text or nested event JSON>
     tags: [
       ["claim-chain", "evm"],
       ["channel", channelId],
       ["amount", transferredAmount],
       ["nonce", nonce],
       ["locked", lockedAmount],
       ["locks-root", locksRoot],
       ["chain-sig", evmEIP712Signature],
       ["signer", evmAddress],
       // Unsigned claim requests for peer to sign:
       ["request-chain", "xrp"],
       ["request-channel", xrpChannelId],
       ["request-amount", expectedAmount]
     ]
   ```

3. **Claim Verification & Storage:** Verify incoming claim signatures using existing chain signers, enforce monotonic increase (nonce for EVM/Aptos, amount for XRP), persist verified claims for settlement.

4. **Bidirectional Exchange Flow:**
   - Sender wraps message in claim event with their signed proof + unsigned requests
   - Receiver verifies sender's claim, stores if valid
   - Receiver signs the unsigned requests
   - Receiver returns signed claims in FULFILL response (also as claim event)

5. **Automatic Settlement Execution:** When threshold exceeded, retrieve stored claims and submit on-chain via existing SDK methods.

**How it integrates:**

- Extends TOON codec to recognize claim event kinds (30001-30003)
- Claim events are valid Nostr events, maintaining protocol compatibility
- Existing claim signers are reused without modification
- Settlement execution uses existing SDK methods (`cooperativeSettle`, `PaymentChannelClaim`, `submitClaim`)
- Graceful degradation: peers without claim support receive regular events (claims stripped)

**Success criteria:**

- Every packet between peers includes signed balance proof as claim event
- Both parties accumulate verified signed claims from counterparty
- Settlement threshold triggers successful on-chain claim submission
- All three chains tested (EVM, XRP, Aptos) in Docker Agent Society test
- Existing peers without claim support continue to work (backward compatible)

---

## ILP Architecture Alignment

Per RFC-0027 (ILPv4) and RFC-0038 (Settlement Engines):

**ILP condition/fulfillment** - Used for end-to-end payment security:

- Sender creates condition (hash), receiver reveals fulfillment (preimage)
- Proves payment path completed, isolates risk between hops
- NOT for on-chain settlement

**Settlement Engines** - Handle actual value transfer:

- Exchange settlement messages through ILP packets (via `data` field)
- Triggered when accumulated balances exceed credit limits
- This epic implements this pattern using Nostr claim events

Our claim event approach aligns with this architecture - using claim events as the settlement message format exchanged between peers.

---

## Stories

### Story 30.1: Claim Event Kind Definitions & Types

**Goal:** Define Nostr event kinds 30001-30003 for claim events and create TypeScript types in shared package.

**Scope:**

- Define event kind constants: `CLAIM_EVENT_EVM = 30001`, `CLAIM_EVENT_XRP = 30002`, `CLAIM_EVENT_APTOS = 30003`
- Create tag schema for each chain type (amount, nonce, signature, signer, channel, request tags)
- Create TypeScript interfaces for claim event parsing/creation
- Add type guards for claim event detection
- Export from `@m2m/shared`

**Acceptance Criteria:**

- [ ] Event kinds 30001-30003 defined with clear documentation
- [ ] Tag schemas documented for each chain type
- [ ] TypeScript interfaces created for type-safe claim handling
- [ ] Type guards correctly identify claim events by kind
- [ ] Interfaces exported from shared package

---

### Story 30.2: Claim Event Builder & Parser

**Goal:** Create utilities to build claim events (wrapping content) and parse claim data from received events.

**Scope:**

- Create `ClaimEventBuilder` class with methods:
  - `wrapWithEVMClaim(content, signedClaim, unsignedRequests): NostrEvent`
  - `wrapWithXRPClaim(content, signedClaim, unsignedRequests): NostrEvent`
  - `wrapWithAptosClaim(content, signedClaim, unsignedRequests): NostrEvent`
- Create `ClaimEventParser` with methods:
  - `isClaimEvent(event): boolean`
  - `extractSignedClaim(event): SignedClaim | null`
  - `extractUnsignedRequests(event): UnsignedClaimRequest[]`
  - `extractContent(event): string` (unwrap original content)
- Handle nested event JSON in content field

**Acceptance Criteria:**

- [ ] Builder creates valid Nostr events with correct tags
- [ ] Parser extracts all claim data from events
- [ ] Content correctly wrapped/unwrapped (including nested events)
- [ ] Round-trip test: build → parse → verify data matches
- [ ] Invalid events handled gracefully (return null, not throw)

---

### Story 30.3: Claim Store with SQLite Persistence

**Goal:** Create SQLite-backed storage for received claims with monotonic tracking per chain type.

**Scope:**

- Create `ClaimStore` class with SQLite persistence
- Schema: `received_claims(peer_id, chain, channel_identifier, sequence_value, amount, signature, signer_key, extra_data, created_at)`
  - `channel_identifier`: bytes32 for EVM, 64-char hex for XRP, owner address for Aptos
  - `sequence_value`: nonce for EVM/Aptos, NULL for XRP (XRP uses amount for monotonicity)
- Methods: `storeEVMClaim`, `storeXRPClaim`, `storeAptosClaim`
- Methods: `getLatestClaim(peerId, chain, channelId)`, `getClaimsForSettlement(peerId, chain)`
- Enforce monotonic increase per chain type:
  - EVM/Aptos: Reject if `nonce <= stored_nonce`
  - XRP: Reject if `amount <= stored_amount` (XRP payment channels use cumulative amount)
- Index by peer_id, chain, channel_identifier for efficient queries

**Acceptance Criteria:**

- [ ] Claims persisted to SQLite database
- [ ] EVM/Aptos: Monotonic nonce enforcement (reject nonce <= stored)
- [ ] XRP: Monotonic amount enforcement (reject amount <= stored)
- [ ] Efficient retrieval by peer/chain/channel
- [ ] `getClaimsForSettlement` returns latest claim per channel
- [ ] Database created automatically if not exists

---

### Story 30.4: Claim Manager Orchestration

**Goal:** Create ClaimManager to orchestrate claim generation, verification, and storage using existing signers.

**Scope:**

- Create `ClaimManager` class coordinating:
  - Existing signers: PaymentChannelSDK (EVM), ClaimSigner (XRP), AptosClaimSigner (Aptos)
  - ClaimStore for persistence
  - ClaimEventBuilder/Parser for event handling
- Methods:
  - `generateClaimEventForPeer(peerId, content): NostrEvent` - wraps content with signed claims
  - `processReceivedClaimEvent(peerId, event): ProcessResult` - verify, store, return signed response
  - `getClaimsForSettlement(peerId, chain): SignedClaim[]`
- Verification includes: signature validity, signer identity, monotonic increase, within deposit bounds
- Error handling strategy (graceful degradation):
  - Invalid signature: Log warning, continue packet processing without storing claim
  - Unknown signer: Log warning, skip claim (peer address mismatch)
  - Stale sequence: Log info (duplicate/replay), skip storage
  - Amount exceeds deposit: Log error, reject claim (potential fraud)
  - Malformed claim tags: Log warning, extract what's possible, continue

**Acceptance Criteria:**

- [ ] Generates claim events using correct signer per chain
- [ ] Verifies received claims against expected peer addresses
- [ ] Rejects invalid signatures with warning log
- [ ] Rejects stale nonces/amounts with info log
- [ ] Accepts and stores valid claims
- [ ] Returns signed claims for unsigned requests
- [ ] Never throws exceptions that break packet flow

---

### Story 30.5: BTP Integration - Send & Receive Flow

**Goal:** Integrate claim events into BTP packet send/receive flow in agent-server.ts.

**Scope:**

- Add feature flag configuration:
  - `CLAIM_EXCHANGE_ENABLED` environment variable (default: true)
  - `AgentServerConfig.claimExchangeEnabled` option
  - When disabled, packets sent/received without claim wrapping
- Update `sendEventToPeer()`:
  - Check feature flag before wrapping
  - Use ClaimManager to wrap outgoing content in claim event
  - Include signed claims for channels with peer + unsigned requests
- Update `handleBtpMessage()` (receiving PREPARE):
  - Detect claim events, extract and verify claims
  - Process unsigned requests, generate signed response
  - Store valid claims
- Update `serializeBtpResponse()` (sending FULFILL):
  - Include signed claim responses in FULFILL
- Update `handlePeerResponse()` (receiving FULFILL):
  - Extract and store signed claims from response
- TOON codec integration:
  - No changes to toon-codec.ts required (claim events are standard Nostr events)
  - ClaimEventParser uses existing TOON decode, then inspects event kind

**Acceptance Criteria:**

- [ ] Feature flag `CLAIM_EXCHANGE_ENABLED` controls claim wrapping
- [ ] Outgoing packets wrapped as claim events with balance proofs
- [ ] Incoming claim events parsed and claims extracted
- [ ] Valid claims stored, invalid claims logged and rejected
- [ ] FULFILL includes signed response to unsigned requests
- [ ] Backward compatible: non-claim events still processed normally
- [ ] Feature flag disabled: system operates as before (no claims)

---

### Story 30.6: Automatic Settlement Execution

**Goal:** Update performSettlement to use stored claims for on-chain settlement.

**Scope:**

- Update `performSettlement()` in agent-server.ts:
  - Retrieve latest claim from ClaimStore for the channel/peer
  - EVM: Call `cooperativeSettle()` with both parties' balance proofs
  - XRP: Submit `PaymentChannelClaim` transaction using xrpl.js client
  - Aptos: Call `aptosChannelSDK.submitClaim()` with stored claim
- XRP PaymentChannelClaim transaction construction:
  - Transaction type: `PaymentChannelClaim`
  - Required fields: `Channel` (64-char hex), `Balance` (drops as string), `Signature` (from stored claim), `PublicKey` (signer's ed25519 public key)
  - Use `xrplClient.submitAndWait()` for submission
- Add settlement telemetry events (following existing patterns in `telemetry-emitter.ts`):
  - `claim_settlement_initiated`: { chain, channelId, amount, peerId }
  - `claim_settlement_success`: { chain, channelId, txHash, settledAmount }
  - `claim_settlement_failed`: { chain, channelId, error, attemptedAmount }
- Handle missing claims gracefully (log warning, skip settlement)

**Acceptance Criteria:**

- [ ] EVM settlement uses stored claims for cooperative settle
- [ ] XRP settlement submits PaymentChannelClaim with signature
- [ ] Aptos settlement submits claim via SDK
- [ ] Missing claims logged but don't crash
- [ ] Settlement telemetry events emitted (initiated, success, failed)
- [ ] Docker Agent Society test verifies end-to-end settlement

---

## Compatibility Requirements

- [x] Existing BTP packet flow unchanged for non-claim events
- [x] Existing claim signers reused without API changes
- [x] Nostr event model preserved (claims ARE events, not attachments)
- [x] Settlement threshold logic unchanged (just adds execution capability)
- [x] Peers without claim support receive unwrapped content (graceful degradation)

---

## Risk Mitigation

- **Primary Risk:** Signature verification failures breaking packet flow
- **Mitigation:**
  - Graceful degradation: log warning but don't reject packet if claim invalid
  - Fall back to non-claim packet processing
  - Separate claim verification from packet handling
- **Secondary Risk:** Nonce desync between peers causing repeated claim rejections
- **Mitigation:**
  - Track nonces per-peer, per-channel, per-chain
  - Accept claims with higher nonces even if intermediate claims missed
  - Log warnings for unexpected nonce jumps
- **Rollback Plan:**
  - Feature flag `CLAIM_EXCHANGE_ENABLED=false` disables claim wrapping
  - Configuration: `AgentServerConfig.claimExchangeEnabled: boolean`
  - When disabled: packets sent without claim wrapping, received claims ignored
  - Revert to current non-claim packet behavior instantly
  - Stored claims remain in database for manual settlement if needed
  - No data migration required for rollback

---

## Definition of Done

- [ ] Claim event kinds (30001-30003) defined and documented
- [ ] Claims exchanged as events wrapping message content
- [ ] Received claims verified and stored in SQLite
- [ ] Settlement threshold triggers on-chain settlement using stored claims
- [ ] All three chains tested (EVM, XRP, Aptos)
- [ ] Docker Agent Society test passes with settlement verification
- [ ] Backward compatible with peers not supporting claims
- [ ] No regression in existing packet handling

---

## Technical Notes

### Nostr Event Kind Selection

Kinds 30001-30003 are in the NIP-01 "Replaceable Parameterized" range (30000-39999). This is intentional:

- Claim events represent the latest state for a channel (newer replaces older)
- The `d` tag can specify the channel identifier for deduplication
- Standard Nostr relays will handle these as valid events

### Claim Event Tag Schema

**EVM Claim (Kind 30001):**

```
tags: [
  ["d", channelId],               // Replaceable event identifier
  ["claim-chain", "evm"],
  ["channel", "0x..."],           // bytes32 channel ID
  ["amount", "1000000"],          // transferredAmount in token units
  ["nonce", "5"],                 // monotonic nonce (REQUIRED for EVM)
  ["locked", "0"],                // lockedAmount
  ["locks-root", "0x000..."],     // bytes32 locks root
  ["chain-sig", "0x..."],         // EIP-712 signature
  ["signer", "0x..."],            // Ethereum address
  // Unsigned requests for peer to sign (optional):
  ["request-chain", "evm"],
  ["request-channel", "0x..."],
  ["request-amount", "500000"],
  ["request-nonce", "3"]
]
```

**XRP Claim (Kind 30002):**

Note: XRP payment channels do NOT use nonces. The `amount` field represents cumulative balance and must increase monotonically. Each new claim authorizes withdrawal up to the specified amount.

```
tags: [
  ["d", channelId],               // Replaceable event identifier
  ["claim-chain", "xrp"],
  ["channel", "ABC123..."],       // 64-char hex channel ID
  ["amount", "5000000"],          // drops (cumulative, monotonically increasing)
  ["chain-sig", "..."],           // ed25519 signature (128 hex chars)
  ["signer", "ED..."],            // ed25519 public key (66 hex chars, ED prefix)
  // Unsigned requests for peer to sign (optional):
  ["request-chain", "xrp"],
  ["request-channel", "DEF456..."],
  ["request-amount", "3000000"]
  // Note: No request-nonce for XRP (amount is the sequence)
]
```

**Aptos Claim (Kind 30003):**

```
tags: [
  ["d", channelOwner],            // Replaceable event identifier
  ["claim-chain", "aptos"],
  ["channel", "0x..."],           // channel owner address (identifies channel)
  ["amount", "100000000"],        // octas (1 APT = 100,000,000 octas)
  ["nonce", "7"],                 // monotonic nonce (REQUIRED for Aptos)
  ["chain-sig", "..."],           // ed25519 signature (128 hex chars)
  ["signer", "..."],              // ed25519 public key (64 hex chars)
  // Unsigned requests for peer to sign (optional):
  ["request-chain", "aptos"],
  ["request-channel", "0x..."],
  ["request-amount", "50000000"],
  ["request-nonce", "4"]
]
```

### Chain-Specific Monotonicity Rules

| Chain | Monotonic Field | Enforcement Rule                                        |
| ----- | --------------- | ------------------------------------------------------- |
| EVM   | `nonce`         | New nonce must be > stored nonce                        |
| XRP   | `amount`        | New amount must be > stored amount (cumulative balance) |
| Aptos | `nonce`         | New nonce must be > stored nonce                        |

### XRP PaymentChannelClaim Transaction

When settling XRP channels, construct a `PaymentChannelClaim` transaction:

```typescript
const claimTx: PaymentChannelClaim = {
  TransactionType: 'PaymentChannelClaim',
  Account: destinationAddress, // Claimer's XRP address
  Channel: storedClaim.channelId, // 64-char hex channel ID
  Balance: storedClaim.amount, // Drops as string (cumulative)
  Signature: storedClaim.signature, // 128 hex char ed25519 signature
  PublicKey: storedClaim.publicKey, // 66 hex char ed25519 public key (ED prefix)
};

const result = await xrplClient.submitAndWait(claimTx, { wallet });
```

The signature covers `CLM\0` + channel ID (32 bytes) + amount (64-bit BE) per XRP Ledger spec.

### Error Handling Matrix

| Error Condition                   | Action                | Log Level | Packet Processing   |
| --------------------------------- | --------------------- | --------- | ------------------- |
| Invalid signature                 | Skip claim storage    | WARN      | Continue normally   |
| Unknown signer (address mismatch) | Skip claim storage    | WARN      | Continue normally   |
| Stale nonce (EVM/Aptos)           | Skip claim storage    | INFO      | Continue normally   |
| Stale amount (XRP)                | Skip claim storage    | INFO      | Continue normally   |
| Amount exceeds channel deposit    | Reject claim          | ERROR     | Continue normally   |
| Malformed claim tags              | Extract partial data  | WARN      | Continue normally   |
| Missing required tags             | Skip claim entirely   | WARN      | Continue normally   |
| ClaimStore write failure          | Log and continue      | ERROR     | Continue normally   |
| Peer has no channels              | Skip claim generation | DEBUG     | Send without claims |

**Key Principle:** Claim processing failures NEVER break packet handling. The claim layer is additive - if it fails, we fall back to non-claim behavior.

### ClaimStore Database Schema

```sql
-- Received claims from peers (what they owe us)
CREATE TABLE received_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_id TEXT NOT NULL,              -- Nostr pubkey of peer
  chain TEXT NOT NULL,                -- 'evm', 'xrp', 'aptos'
  channel_identifier TEXT NOT NULL,   -- Chain-specific channel ID
  sequence_value INTEGER,             -- Nonce for EVM/Aptos, NULL for XRP
  amount TEXT NOT NULL,               -- Amount as string (handles large numbers)
  signature TEXT NOT NULL,            -- Chain-specific signature
  signer_key TEXT NOT NULL,           -- Signer's public key/address
  extra_data TEXT,                    -- JSON: locks_root, locked_amount, etc.
  created_at INTEGER DEFAULT (unixepoch()),

  UNIQUE(peer_id, chain, channel_identifier)  -- Latest claim per channel
);

-- Indexes for efficient queries
CREATE INDEX idx_claims_peer_chain ON received_claims(peer_id, chain);
CREATE INDEX idx_claims_settlement ON received_claims(chain, channel_identifier);
```

**Notes:**

- `channel_identifier` stores: bytes32 (EVM), 64-char hex (XRP), owner address (Aptos)
- `sequence_value` is NULL for XRP since amount provides monotonicity
- `amount` stored as TEXT to handle uint256 (EVM) and large drop amounts
- UNIQUE constraint ensures we only keep the latest claim per channel
- `extra_data` JSON for EVM-specific fields (lockedAmount, locksRoot)

### Settlement Flow Diagram

```
Agent A sends to Agent B:
┌─────────────────────────────────────────────────────────┐
│ Kind 30001 (EVM Claim Event)                           │
│   content: "Hello from Agent A"                        │
│   tags: [                                              │
│     ["claim-chain", "evm"],                           │
│     ["channel", channelId],                           │
│     ["amount", "1000"],        ← A owes B 1000        │
│     ["chain-sig", sigA],       ← A's signature        │
│     ["request-chain", "evm"],  ← Request B to sign    │
│     ["request-amount", "500"], ← B owes A 500         │
│   ]                                                    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              Agent B receives, verifies:
              1. Verify sigA over (channel, 1000, nonce)
              2. Store claim: "A owes me 1000, signed"
              3. Sign requested claim: "I owe A 500"
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ FULFILL Response (Kind 30001)                          │
│   content: ""                                          │
│   tags: [                                              │
│     ["claim-chain", "evm"],                           │
│     ["channel", channelId],                           │
│     ["amount", "500"],         ← B owes A 500         │
│     ["chain-sig", sigB],       ← B's signature        │
│   ]                                                    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              Agent A receives, verifies:
              1. Verify sigB over (channel, 500, nonce)
              2. Store claim: "B owes me 500, signed"

When threshold exceeded:
- Agent A uses stored sigB to claim on-chain
- Agent B uses stored sigA to claim on-chain
```

### Multi-Chain Claim Exchange Flow

When agents have channels on multiple chains, a single packet exchange carries claims for all active channels:

```
Agent A (has EVM + XRP channels with B) sends message:
┌─────────────────────────────────────────────────────────────────────┐
│ Kind 30001 (Primary claim: EVM)                                    │
│   content: "Task result from Agent A"                              │
│   tags: [                                                          │
│     // A's signed EVM claim (what A owes B):                       │
│     ["claim-chain", "evm"],                                        │
│     ["channel", evmChannelId], ["amount", "1000"], ["nonce", "5"], │
│     ["chain-sig", evmSigA], ["signer", evmAddressA],               │
│                                                                     │
│     // A's signed XRP claim (what A owes B):                       │
│     ["claim-chain", "xrp"],                                        │
│     ["channel", xrpChannelId], ["amount", "50000"],                │
│     ["chain-sig", xrpSigA], ["signer", xrpPubkeyA],                │
│                                                                     │
│     // Requests for B to sign (what B owes A):                     │
│     ["request-chain", "evm"], ["request-channel", evmChannelId],   │
│     ["request-amount", "500"], ["request-nonce", "3"],             │
│     ["request-chain", "xrp"], ["request-channel", xrpChannelId],   │
│     ["request-amount", "25000"]                                    │
│   ]                                                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              Agent B processes:
              1. Verify & store A's EVM claim (nonce 5)
              2. Verify & store A's XRP claim (amount 50000 drops)
              3. Sign requested EVM claim (nonce 3, amount 500)
              4. Sign requested XRP claim (amount 25000 drops)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FULFILL Response (Kind 30001)                                       │
│   tags: [                                                          │
│     // B's signed EVM claim:                                       │
│     ["claim-chain", "evm"], ["channel", evmChannelId],             │
│     ["amount", "500"], ["nonce", "3"],                             │
│     ["chain-sig", evmSigB], ["signer", evmAddressB],               │
│                                                                     │
│     // B's signed XRP claim:                                       │
│     ["claim-chain", "xrp"], ["channel", xrpChannelId],             │
│     ["amount", "25000"],                                           │
│     ["chain-sig", xrpSigB], ["signer", xrpPubkeyB]                 │
│   ]                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Future Enhancements (Out of Scope)

- Multi-hop claim aggregation (claims for intermediate connectors)
- Dispute resolution UI in Explorer
- Automatic channel rebalancing based on claim history
- Claim compression for high-frequency exchanges
- Hardware security module (HSM) integration for claim signing
