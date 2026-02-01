# Epic 32: Private Messaging with NIP-59 Giftwrap Routing

## Epic Goal

Create a production-ready demonstration of end-to-end encrypted private messaging using NIP-59 gift wrap protocol routed through ILP multi-hop payment channels, showcasing privacy-preserving agent-to-agent communication with cryptographic payment routing and client-side key management.

## Epic Description

### Existing System Context

**Current M2M Infrastructure:**

- **ILP Connector Framework**: Node.js 22, TypeScript 5, BTP/SPSP protocol support (Epic 1-2)
- **Agent Society Protocol**: Nostr-based peer discovery, TOON-serialized event routing (Epic 13)
- **Settlement Engines**: Tri-chain support (Aptos, Base L2, XRP) with payment channels (Epics 8, 9, 27-28)
- **Claim Events**: Balance proof exchange for settlement triggers (Epic 30)
- **Explorer UI**: React 18 + shadcn-ui v4 for network monitoring (Epic 14-15)
- **Workflow Pattern**: Multi-hop routing proven in Epic 31 (image processing demo)
- **Database**: SQLite (better-sqlite3) for event persistence

**Existing Infrastructure (Reusable):**

- Multi-hop routing topology: Client → Facilitator → C1 → C2 → Recipient (Epic 31)
- X402 HTTP-to-ILP gateway pattern (Epic 31 facilitator architecture)
- TOON encoding for Nostr events inside ILP packets (Epic 13)
- Payment channel settlement across 3 hops (Epic 30 claim exchange)
- shadcn-ui component library for UI development (Epic 14-15)

### Enhancement Details

**What's Being Added:**

This epic implements **private encrypted messaging** using the NIP-59 gift wrap protocol, where messages are encrypted client-side in 3 layers and routed through ILP payment channels:

1. **Client-Side Giftwrap Creation** - Browser-based NIP-59 encryption
   - Layer 1: Create rumor (Kind 14, unsigned, deniable)
   - Layer 2: Create seal (Kind 13, encrypted to recipient, signed by sender)
   - Layer 3: Create giftwrap (Kind 1059, ephemeral key, randomized timestamp)
   - All encryption happens in browser - server never sees private keys
   - TOON-encode giftwrap event (1.5-3 KB after compression)

2. **X402 Gateway for Message Routing** - HTTP API for message submission
   - Accept HTTP POST with pre-encrypted giftwrap from client
   - Perform SPSP handshake with recipient's ILP address
   - Establish BTP connection to first-hop connector
   - Route ILP packet with TOON-encoded giftwrap through multi-hop network
   - Return delivery confirmation (ILP Fulfill proof)

3. **Message Receiver Endpoint** - WebSocket-based delivery
   - Maintain WebSocket connection from client to X402 server
   - Receive ILP packets addressed to user's ILP address
   - Forward TOON-encoded giftwrap to client via WebSocket
   - Client unwraps 3 layers client-side with private key
   - Store decrypted messages in browser localStorage

4. **Private Messenger UI** - React interface with shadcn-ui
   - Key Manager: Generate/import private keys (stored in browser only)
   - Message Composer: Type message, encrypt client-side, send via X402
   - Encryption Inspector: Educational panel showing 3 NIP-59 layers
   - Routing Visualization: Animated payment flow through hops
   - Message List: Chat history with delivery confirmations

5. **Lightweight Claim Integration** - Privacy-preserving settlement
   - Use claim-ref tags (Kind 30001-30003) for balance proofs
   - Avoid embedding full claim events (privacy leak: reveals payment graph)
   - Settlement triggered at thresholds via existing Epic 30 infrastructure
   - Balance updates visible in Agent Explorer

**Privacy Model:**

**What Each Party Sees:**

| Party               | Can See                                                     | Cannot See                                                  |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **Alice (Sender)**  | Plaintext message, Bob's pubkey                             | -                                                           |
| **Facilitator**     | Alice's BTP connection, payment destination, encrypted blob | Message content, Alice's real identity (sees ephemeral key) |
| **Connector1**      | Payment routing info, encrypted blob                        | Message content, sender identity, recipient identity        |
| **Connector2**      | Payment routing info, encrypted blob                        | Message content, sender identity, recipient identity        |
| **Bob (Recipient)** | Plaintext message, Alice's pubkey (from seal)               | -                                                           |
| **Nostr Relays**    | Nothing (giftwrap never posted to relays)                   | Everything                                                  |

**Privacy Guarantees:**

- ✅ **Content Privacy**: 3-layer encryption protects message content
- ✅ **Metadata Privacy**: Ephemeral key + randomized timestamp protects sender
- ✅ **Deniability**: Unsigned rumor provides legal deniability
- ✅ **Forward Secrecy**: New ephemeral key per message
- ⚠️ **First-Hop Limitation**: Facilitator knows Alice initiated payment (similar to Tor entry node or Nostr relay knowing IP address)
- ✅ **Multi-Hop Anonymity**: Intermediate connectors don't know sender or recipient

**How It Integrates:**

- **Epic 31 Workflow Pattern**: Reuse 3-hop routing topology exactly
- **Epic 13 TOON Encoding**: Existing codec handles giftwrap events without modification
- **Epic 30 Claim Events**: Lightweight claim-ref tags for settlement
- **Epic 28 Testnet Support**: Aptos testnet settlement for payments
- **Epic 14-15 Explorer UI**: Monitor payment routing in real-time
- **NIP-59 Spec**: Standard Nostr gift wrap protocol (compatibility with broader ecosystem)
- **NIP-44 Encryption**: Standard Nostr encryption (no custom crypto)

**Success Criteria:**

1. **Functional Demo**:
   - User opens Private Messenger UI, generates key pair client-side
   - User types message, clicks "Send Encrypted", watches 3-layer encryption progress
   - Message routes through 3 hops (visible in routing visualization)
   - Recipient receives message, decrypts client-side, reads plaintext
   - Total latency <5 seconds including random delays

2. **Client-Side Encryption**:
   - Private keys stored in browser localStorage only
   - Server never receives unencrypted message or private keys
   - All NIP-59 encryption/decryption happens in browser JavaScript
   - Green "🔒 Key never leaves browser" indicator visible

3. **Privacy Verification**:
   - Giftwrap event uses ephemeral pubkey (not Alice's real pubkey)
   - Timestamp randomized ±2 days (metadata protection)
   - Intermediate connectors see encrypted blob only (verified in logs)
   - Bob can read message and identify Alice (from seal), but cannot prove it to others

4. **Payment Routing**:
   - 300 msat total cost (50 + 100 + 100 + 50 distribution)
   - Payment channels settle via Aptos testnet
   - Claim-ref tags used (no full claim embedding)
   - Settlement visible in Agent Explorer

5. **Educational UI**:
   - Encryption Inspector shows all 3 layers with explanations
   - Routing Visualization animates payment flow
   - "What Connectors See" section explains privacy model
   - Demo script narration (5 minutes)

## Stories

### Story 32.1: Client-Side NIP-59 Giftwrap Integration

**Goal**: Implement browser-based NIP-59 gift wrap creation and unwrapping with client-side key management.

**Key Deliverables**:

- `packages/connector/explorer-ui/src/lib/nostr-crypto.ts` - NIP-59 wrapper around nostr-tools
- `packages/connector/explorer-ui/src/hooks/useGiftwrap.ts` - React hook for giftwrap creation
- `packages/connector/explorer-ui/src/hooks/useKeyManager.ts` - React hook for key storage (localStorage)
- `packages/connector/explorer-ui/src/components/KeyManager.tsx` - UI for key generation/import
- Client-side encryption: rumor → seal → giftwrap
- Client-side decryption: giftwrap → seal → rumor
- TOON encoding preparation (pre-encode before sending to server)

**Acceptance Criteria**:

- User clicks "Generate New Key", keypair created with `generateSecretKey()`
- Private key stored in browser localStorage (nsec format)
- Public key displayed (npub format) for sharing
- User types "Secret message", calls `createGiftwrap(message, recipientPubkey, myPrivateKey)`
- Returns giftwrap event: `{ kind: 1059, pubkey: <ephemeral>, content: <encrypted> }`
- Ephemeral pubkey is different from user's real pubkey (verified)
- Timestamp randomized ±2 days (verified)
- Unwrap with `unwrapGiftwrap(giftwrap, myPrivateKey)` returns plaintext message
- No server API calls during encryption/decryption (verified in network tab)

**Testing**:

- Unit tests: `useGiftwrap.test.ts` - encrypt/decrypt roundtrip
- Integration test: Create giftwrap in one browser tab, unwrap in another with different key pair
- Security test: Verify private key never sent in network requests

---

### Story 32.2: X402 Gateway for Giftwrap Routing

**Goal**: Implement HTTP API that accepts pre-encrypted giftwrap from client and routes through ILP multi-hop network.

**Key Deliverables**:

- `packages/connector/src/messaging/messaging-gateway.ts` - Express HTTP server on port 3002
- `packages/connector/src/messaging/giftwrap-router.ts` - ILP packet creation and routing
- `POST /api/route-giftwrap` endpoint - Accept giftwrap, return delivery proof
- SPSP client integration (reuse from Epic 31 facilitator)
- BTP connection management (reuse from Epic 31)
- WebSocket server for receiving messages (port 3003)

**Acceptance Criteria**:

- Gateway starts on port 3002, WebSocket on 3003
- Client POSTs `{ giftwrap: <event>, recipient: "g.agent.bob.private", amount: 300 }`
- Gateway TOON-encodes giftwrap event (no decryption)
- Gateway creates ILP Prepare packet with TOON payload
- Gateway routes packet through BTP connection to first-hop connector
- Returns `{ success: true, fulfill: <base64>, latency: 4200 }` on delivery
- WebSocket receives ILP packets for connected clients
- Forwards TOON-encoded giftwrap to client via WebSocket message
- Handles errors: insufficient funds, routing failure, timeout

**Testing**:

- Unit tests: `giftwrap-router.test.ts` - TOON encoding, packet creation
- Integration test: Send giftwrap through 3-hop network (Facilitator → C1 → C2 → Recipient)
- Load test: 100 concurrent messages, all delivered successfully
- Error test: Invalid giftwrap format, oversized payload, disconnected WebSocket

---

### Story 32.3: Private Messenger UI Components

**Goal**: Build React interface with shadcn-ui components for sending/receiving encrypted messages.

**Key Deliverables**:

- `packages/connector/explorer-ui/src/pages/PrivateMessenger.tsx` - Main page
- `packages/connector/explorer-ui/src/components/MessageComposer.tsx` - Input with encryption status
- `packages/connector/explorer-ui/src/components/MessageList.tsx` - Chat history
- `packages/connector/explorer-ui/src/components/ContactSidebar.tsx` - Contact list
- `packages/connector/explorer-ui/src/components/MessageBubble.tsx` - Individual message display
- Navigation: Add "Private Messenger" to main app nav

**shadcn-ui Components Used**:

- `Card`, `CardHeader`, `CardContent`, `CardFooter` - Layout
- `Input`, `Textarea` - Message input
- `Button` - Send, copy, generate key actions
- `Badge` - Encryption status, delivery status, cost display
- `ScrollArea` - Message history scrolling
- `Avatar` - Contact avatars
- `Separator` - Visual dividers

**Acceptance Criteria**:

- User navigates to `/messenger` route, sees main interface
- Sidebar shows contact list (pubkeys), click to select recipient
- Message composer shows textarea with "Type your message..." placeholder
- User types message, encryption status shows: "🔐 Ready to encrypt"
- User clicks "Send Encrypted" button, see real-time status updates:
  - "🔐 Creating rumor (Layer 1)..."
  - "🔒 Sealing with your key (Layer 2)..."
  - "🎁 Wrapping with ephemeral key (Layer 3)..."
  - "📤 Routing through ILP network..."
  - "✅ Delivered!"
- Message appears in chat history with badges: "🔒 Encrypted • ✅ Delivered • 💰 300 msat"
- WebSocket receives message, client unwraps, shows in chat: "[Alice] Secret message"
- Familiar chat UX (similar to Signal/WhatsApp)

**Testing**:

- Component tests: `MessageComposer.test.tsx` - encryption status updates
- Integration test: Send message from Alice to Bob, verify delivery
- UI test with Playwright: Full send/receive flow in browser

---

### Story 32.4: Encryption Inspector Panel

**Goal**: Build educational UI panel that visualizes the 3 NIP-59 layers and explains privacy model.

**Key Deliverables**:

- `packages/connector/explorer-ui/src/components/EncryptionInspector.tsx` - Educational panel
- Collapsible panel (shadcn-ui `Collapsible` component)
- Layer 3 (Gift Wrap): Show ephemeral pubkey, randomized timestamp
- Layer 2 (Seal): Show real sender pubkey, signature
- Layer 1 (Rumor): Show plaintext content, unsigned status
- "What Connectors See" section: Explain what each hop can/cannot see

**shadcn-ui Components Used**:

- `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger` - Expandable panel
- `Badge` - Layer labels (Layer 1, Layer 2, Layer 3)
- Color-coded borders: Purple (Layer 3), Blue (Layer 2), Green (Layer 1)
- Info icons and explanatory text

**Acceptance Criteria**:

- Panel appears below message composer, collapsed by default
- User clicks "Show Details", panel expands to show all 3 layers
- Layer 3 shows:
  - Pubkey: `abc123...` (ephemeral, different from sender's real key)
  - Timestamp: Randomized ±2 days
  - Badge: "✅ Anonymous - relays can't track you"
- Layer 2 shows:
  - Pubkey: `alice123...` (sender's real key)
  - Signed by: "You (Alice)"
  - Badge: "✅ Bob knows it's from you, but can't prove it"
- Layer 1 shows:
  - Content: "Secret message..." (plaintext)
  - Signature: "NONE (Unsigned)"
  - Badge: "✅ Deniable - legally unprovable"
- "What Connectors See" section lists:
  - ✅ Destination: g.agent.bob.private
  - ✅ Payment: 300 msat
  - ✅ Encrypted blob: 748 bytes
  - ❌ Message content (strikethrough)
  - ❌ Real sender (strikethrough)

**Testing**:

- Component test: `EncryptionInspector.test.tsx` - layer rendering
- Visual regression test: Screenshot comparison
- Accessibility test: WCAG AA contrast, keyboard navigation

---

### Story 32.5: Payment Routing Visualization

**Goal**: Build animated visualization showing payment flow through 3 hops with cost breakdown.

**Key Deliverables**:

- `packages/connector/explorer-ui/src/components/RoutingVisualization.tsx` - Animated diagram
- `packages/connector/explorer-ui/src/hooks/useRouteAnimation.ts` - Animation state management
- Real-time animation: Alice → Facilitator → C1 → C2 → Bob
- Progress bar showing packet flow
- Cost breakdown: Gateway (50) + Relay (100) + Relay (100) + Delivery (50)
- Delivery time and privacy level badges

**shadcn-ui Components Used**:

- `Avatar` - Node avatars (icons for each hop)
- `Badge` - Status badges (✅ Done, 🕐 Processing)
- `Progress` - Horizontal progress bar
- `ArrowRight` icon from `lucide-react` - Arrows between hops

**Acceptance Criteria**:

- Panel appears below Encryption Inspector
- Shows 5 nodes horizontally: You → Facilitator → Connector1 → Connector2 → Bob
- Each node shows: Avatar icon, name, fee amount
- Arrows between nodes animate when packet flows (green when complete, gray when pending)
- Progress bar updates: 0% → 25% → 50% → 75% → 100%
- Status badges update: "Processing..." → "✅ Done"
- Cost breakdown shows:
  - Total Cost: 300 msat (~$0.03 USD)
  - Delivery Time: 4200ms (including privacy delays)
  - Privacy Level: 🔒 High
  - Delivery Proof: ✅ ILP Fulfill
- Animation completes when ILP Fulfill received from gateway

**Testing**:

- Component test: `RoutingVisualization.test.tsx` - animation state transitions
- Integration test: Verify animation matches actual packet flow timing
- Visual test with Playwright: Record animation, verify smooth transitions

---

### Story 32.6: Integration Testing and Demo Script

**Goal**: Create automated integration tests and 5-minute demo script for Epic 32 presentation.

**Key Deliverables**:

- `packages/connector/test/integration/private-messaging.test.ts` - End-to-end test
- `scripts/run-messaging-demo.sh` - One-command demo startup
- `docs/demos/epic-32-demo-script.md` - 5-minute narrated walkthrough
- Docker Compose setup for demo environment
- Automated test: Alice sends message to Bob, verify delivery
- Performance benchmarks: latency, throughput

**Integration Test Scenarios**:

1. **Happy Path**: Alice → Bob successful delivery
2. **Multi-User**: Alice → Bob, Bob → Carol concurrent messages
3. **Error Handling**: Invalid recipient address, insufficient funds
4. **Privacy Verification**: Verify ephemeral keys, timestamp randomization
5. **Settlement**: Trigger settlement threshold, verify claim exchange

**Demo Script Structure** (5 minutes):

- **Minute 1**: Introduction - Show main interface, explain client-side encryption
- **Minute 2**: Send message - Type message, watch encryption progress
- **Minute 3**: Routing visualization - Explain payment flow through hops
- **Minute 4**: Encryption inspector - Deep dive into 3 layers
- **Minute 5**: Delivery confirmation - Show Bob receiving message

**Acceptance Criteria**:

- Run `./scripts/run-messaging-demo.sh`, all containers start successfully
- Integration test suite passes: 5/5 scenarios green
- Demo completes in <5 minutes with narration
- Performance benchmarks: <5s latency, 10+ messages/minute throughput
- Settlement verified on Aptos testnet explorer
- Documentation includes troubleshooting section

**Testing**:

- CI/CD: Integration test runs on every PR
- Docker test: Clean environment startup from scratch
- Performance test: 100 messages, measure p50/p95/p99 latency
- Demo dry-run: Record video, verify narration timing

---

### Story 32.7: Agent Server Messaging Integration

**Goal**: Wire messaging components (GiftwrapWebSocketServer, MessagingGateway) into agent-server startup when ENABLE_PRIVATE_MESSAGING=true.

**Key Deliverables**:

- Configuration parsing for ENABLE_PRIVATE_MESSAGING, MESSAGING_GATEWAY_PORT, MESSAGING_WEBSOCKET_PORT
- Conditional startup of GiftwrapWebSocketServer and MessagingGateway
- ILP packet routing to WebSocket clients for message delivery
- Graceful shutdown of messaging components
- Unit tests for messaging integration

**Acceptance Criteria**:

- Agent server reads ENABLE_PRIVATE_MESSAGING environment variable (default: false)
- When enabled, starts GiftwrapWebSocketServer on configured port (default: 3003)
- When enabled, starts MessagingGateway HTTP server on configured port (default: 3002)
- Incoming ILP packets for messaging address forwarded to WebSocket clients
- Health endpoint returns 200 OK
- Graceful shutdown stops all messaging components
- Private Messenger UI shows "connected" status (green circle)

**Testing**:

- Unit tests: Configuration parsing, conditional startup, shutdown
- Integration test: End-to-end message delivery via Docker demo
- Manual verification: UI connection status in browser

---

## Compatibility Requirements

- [x] Existing Agent Society Protocol unchanged (Epic 13)
- [x] Existing TOON codec handles giftwrap events without modification
- [x] Existing multi-hop routing topology reused from Epic 31
- [x] Existing payment channel settlement (Epic 30) works without changes
- [x] Existing Explorer UI continues to function (Epic 14-15)
- [x] NIP-59 standard compliance (compatible with Nostr ecosystem)
- [x] NIP-44 encryption standard (no custom crypto)

## Risk Mitigation

**Primary Risks:**

1. **Key Management Security**
   - Risk: Private keys leaked via browser storage, XSS attacks
   - Mitigation: Warn users about browser storage risks, implement CSP headers, sanitize all inputs
   - Future: Add optional hardware wallet support (WebAuthn, Ledger)

2. **Privacy Leakage via Timing**
   - Risk: Timing analysis reveals sender/recipient relationship
   - Mitigation: Random delays at each hop (±500ms), timestamp randomization (±2 days)
   - Future: Add cover traffic, batch processing

3. **TOON Encoding Size**
   - Risk: Giftwrap events exceed ILP packet size limits (64KB)
   - Mitigation: Research validates 1.5-3 KB size after TOON compression (well under limit)
   - Monitoring: Log packet sizes, alert if approaching 32KB (50% threshold)

4. **UX Complexity**
   - Risk: Users confused by 3-layer encryption model
   - Mitigation: Educational panels, tooltips, demo script narration
   - Testing: User testing with non-technical users before release

**Rollback Plan:**

- Feature flag: `ENABLE_PRIVATE_MESSAGING=false` disables messaging UI
- Database: No schema changes (messages stored client-side only)
- API: New endpoints don't affect existing routes
- Rollback: Remove `/messenger` route, disable messaging gateway server

## Definition of Done

- [x] All 6 stories completed with acceptance criteria met
- [x] Client-side encryption verified (keys never leave browser)
- [x] Privacy model validated (ephemeral keys, randomized timestamps)
- [x] Integration tests passing (5/5 scenarios)
- [x] Demo script completed successfully (<5 minutes)
- [x] Performance benchmarks met (<5s latency)
- [x] Settlement verified on Aptos testnet
- [x] Documentation updated (architecture, demo guide, troubleshooting)
- [x] No regression in existing Agent Society Protocol functionality
- [x] shadcn-ui component integration complete
- [x] NIP-59 and NIP-44 standard compliance verified

## Dependencies

**Upstream Dependencies** (must be completed first):

- Epic 13: Agent Society Protocol (TOON encoding, event routing) ✅ Complete
- Epic 30: Balance Proof Exchange (claim events for settlement) ✅ Complete
- Epic 31: Workflow Demo (multi-hop routing pattern, X402 gateway) ✅ Complete
- Epic 28: Testnet Integration (Aptos testnet settlement) ✅ Complete
- Epic 14-15: Explorer UI (shadcn-ui component library) ✅ Complete

**Downstream Dependencies** (blocked until this epic completes):

- Epic 33+: Future epics building on private messaging infrastructure
- Nostr Ecosystem Integration: Potential collaboration with Nostr app developers

**External Dependencies**:

- NIP-59 specification (stable, no breaking changes expected)
- NIP-44 encryption standard (stable, widely adopted)
- nostr-tools npm package (actively maintained)
- shadcn-ui v4 (stable, project standard)

## Research Validation

This epic is based on comprehensive research findings documented in:

- `docs/research/epic-32-giftwrap-research-findings.md` - **GO recommendation with 90% confidence**
- `docs/architecture/epic-32-complete-flow.md` - Full 18-step flow specification
- `docs/architecture/epic-32-ui-ux-design.md` - Complete UI/UX design with shadcn-ui

**Key Research Findings:**

✅ **Technical Feasibility**: Giftwrap events fit in ILP packets (1.5-3 KB after TOON, well under 64KB limit)
✅ **Privacy Guarantees**: Multi-hop routing preserves privacy through 3-layer encryption
✅ **Integration Simplicity**: Clean integration with Epic 31/30 infrastructure (no code changes required)
✅ **Use Case Validation**: 5 validated use cases (agent coordination, whistleblowing, auctions, medical, remittance)
✅ **Economic Viability**: 300 msat (~$0.03) pricing, connector profitability confirmed
✅ **Implementation Estimate**: 6 stories, ~4 weeks (realistic scoping)

## Success Metrics

**Functional Metrics**:

- 100% integration test pass rate (5/5 scenarios)
- <5s end-to-end latency (HTTP request → delivery confirmation)
- 10+ messages/minute throughput per user
- Zero private key leakage incidents (verified in security audit)

**Privacy Metrics**:

- 100% ephemeral key usage (no real pubkeys in giftwrap layer)
- ±2 day timestamp randomization (verified in logs)
- 0% content leakage to connectors (verified in packet inspection)

**User Experience Metrics**:

- <30 seconds first-time setup (key generation)
- <10 seconds to send encrypted message
- 5-minute demo completion (including narration)
- Positive user feedback from non-technical testers

**Business Metrics**:

- Demonstrates ILP's privacy capabilities to potential enterprise customers
- Validates Nostr ecosystem integration strategy
- Proves multi-hop routing for non-financial use cases
- Foundation for future private communication features

---

## Notes

**Why This Epic Matters:**

Private messaging demonstrates ILP's versatility beyond financial transactions. By routing encrypted Nostr events through payment channels, we prove that ILP can serve as a privacy-preserving communication layer with built-in micropayments. This opens doors to:

- **Enterprise Use Cases**: Confidential business communications with payment for priority delivery
- **Agent-to-Agent Coordination**: Private task delegation between AI agents
- **Nostr Ecosystem Integration**: Bridge to broader Nostr community (1M+ users)
- **Privacy-as-a-Service**: Charge for privacy guarantees (multi-hop routing, ephemeral keys)

**Architecture Philosophy:**

This epic follows the "every packet is a Nostr event" pattern from Epic 13, maintaining consistency with the Agent Society Protocol while adding NIP-59 privacy layers. The client-side encryption model ensures true end-to-end encryption without server trust, aligning with Nostr's decentralization ethos.

**Future Enhancements:**

- Group messaging (NIP-29 integration)
- Message deletion and editing (NIP-09)
- Media attachments (Blossom/IPFS integration)
- Mobile app (React Native)
- Hardware wallet support (WebAuthn, Ledger)
- Onion routing (Tor-style multi-hop anonymity)

---

**Epic Owner**: Product Owner (Sarah)
**Technical Lead**: Dev (TBD - assign after epic approval)
**Target Sprint**: Q1 2026
**Estimated Effort**: 4 weeks (6 stories × 3-4 days each)
