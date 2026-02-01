# Research Prompt: Paid Giftwrap Nostr Event Routing via ILP

**Research Type:** Product Validation Research
**Project:** M2M - Agent Society Protocol
**Date:** 2026-02-01
**Author:** Research Planning Agent

---

## Research Objective

**Validate the technical feasibility and product viability of routing encrypted private messages (NIP-59 giftwrap Nostr events) through multi-hop ILP payment channels, enabling paid, privacy-preserving agent-to-agent communication with micropayment incentives.**

This research will inform the design of **Epic 32: Paid Giftwrap Private Messaging Demo**, which extends the proven Epic 31 workflow pattern (image processing with 3-hop routing) to demonstrate private, encrypted communication routed through ILP connectors with per-hop payments.

---

## Background Context

### Existing M2M Infrastructure

**Agent Society Protocol (Epic 13):**

- Agents are unified ILP Connector-Relays that route Nostr events via ILP packets
- TOON-serialized events in packet `data` field
- BTP WebSocket connections between peers
- Event database (libSQL) for local storage
- Address pattern: `g.agent.<identifier>[.endpoint]`

**ILP Workflow Pattern (Epic 31):**

- 3-hop routing: Client → Facilitator → Connector1 → Connector2 → Workflow Peer
- Demonstrated with image processing (resize/watermark/optimize)
- Payment: 450 msat total (distributed across hops)
- Settlement: Aptos blockchain with claim events (Epic 30)

**Balance Proof Exchange (Epic 30):**

- Claim events (kinds 30001-30003) wrap message content
- Signed claims exchanged bidirectionally in every packet
- Automatic settlement when thresholds exceeded
- Supports EVM, XRP, and Aptos chains

**Current Gap:**

- No encrypted/private message routing demonstrated
- No NIP-17 (private DM) or NIP-59 (giftwrap) integration
- Epic 31 workflow uses public, unencrypted content
- Need to validate privacy preservation through payment routing

### Nostr Private Messaging Standards

**NIP-17: Private Direct Messages**

- Uses kind 14 events for chat messages
- Requires NIP-44 encryption
- Two-day timestamp randomization for metadata protection

**NIP-59: Gift Wrap (3-Layer Encryption)**

1. **Rumor** - Unsigned kind 14 event (inner plaintext message, provides deniability)
2. **Seal** - Kind 13 event, NIP-44 encrypted to recipient's pubkey
3. **Gift Wrap** - Kind 1059 event, encrypted with ephemeral sender key (metadata protection)

**Key Privacy Properties:**

- Sender anonymity (ephemeral keys)
- Recipient anonymity (sealed encryption)
- Message deniability (unsigned rumors)
- Metadata protection (randomized timestamps, ephemeral wrapping)

---

## Research Questions

### Primary Questions (Must Answer)

#### 1. Technical Feasibility

**Q1.1: Can NIP-59 giftwrap events fit within ILP packet constraints while maintaining all privacy guarantees?**

Sub-questions:

- What is the byte size of a typical giftwrap event after TOON serialization?
- Do rumor/seal/giftwrap layers exceed ILP practical packet limits (~64KB)?
- Does TOON encoding preserve the nested encryption structure?
- Can we efficiently decode giftwrap from ILP packet data without breaking encryption?

**Q1.2: How should giftwrap events route through the 3-hop ILP topology?**

Sub-questions:

- Should destination be `g.agent.bob.private` (exposes recipient) or use onion addressing?
- Do connectors need to inspect giftwrap outer layer (kind 1059) or treat as opaque blob?
- How do we handle ephemeral sender keys in routing tables (can't route by pubkey)?
- Should we reuse Epic 31's facilitator pattern or direct peer-to-peer routing?

**Q1.3: What modifications are needed to existing Agent Society Protocol event handlers?**

Sub-questions:

- Does kind 1059 (giftwrap) need special handling vs. kind 1 (note)?
- How do subscription managers filter encrypted events (can't read content)?
- Should we add a dedicated `GiftwrapHandler` to the event handler registry?
- Can existing TOON codec handle nested encrypted events without modification?

#### 2. Payment Model & Economics

**Q2.1: What payment structure incentivizes honest relay behavior for private messages?**

Payment models to evaluate:

- **Flat fee per message** (e.g., 300 msat total, 100 msat per hop)
- **Size-based pricing** (base + per-KB for large messages)
- **Delivery confirmation bonus** (extra payment on successful ILP Fulfill)
- **Reputation multiplier** (trusted relays charge premium)

Considerations:

- How much should privacy relay cost vs. public message routing?
- Should payment be split equally (100/100/100) or weighted (50/100/150 - higher for final delivery)?
- How to prevent connectors from dropping messages (payment released on fulfill only)?

**Q2.2: How do claim events (Epic 30) integrate with giftwrap routing?**

Sub-questions:

- Should every giftwrap packet trigger bidirectional claim exchange?
- Do encrypted messages need different settlement thresholds (privacy concerns)?
- Can claim event tags leak metadata about private messages (timing, size)?
- Should we batch claim exchanges to avoid correlation with specific messages?

#### 3. Privacy & Security Analysis

**Q3.1: What information do intermediary connectors learn when routing giftwrap?**

Threat model:

- **Connector sees:** Destination address, encrypted payload, payment amount, timing
- **Connector learns:** Alice paying someone ~300 msat at specific timestamp
- **Connector cannot see:** Message content, final recipient (if using onion routing)

Attack vectors to evaluate:

- **Timing correlation** - Link sender/receiver by message timing
- **Size correlation** - Infer message type from encrypted payload size
- **Payment analysis** - Pattern recognition across multiple messages
- **Settlement correlation** - Link messages via claim event timing

**Q3.2: Does routing through ILP degrade NIP-59 privacy guarantees?**

Compare to standard Nostr relay model:

- **Traditional:** Client → Relay (WebSocket) → Relay (gossip) → Recipient
- **ILP Model:** Client → Connector1 → Connector2 → Connector3 → Recipient

Privacy differences:

- ILP requires destination address (leaks recipient unless onion-routed)
- Payment amounts may reveal message importance/urgency
- Settlement events create on-chain correlation points
- Multi-hop reduces single point of surveillance (improvement?)

**Q3.3: What additional privacy protections should be added?**

Potential mitigations:

- **Onion routing** - Encrypt destination in layers (only final hop knows recipient)
- **Timing obfuscation** - Random delays at each hop (prevent correlation)
- **Decoy traffic** - Send fake messages to mask real traffic patterns
- **Anonymous payment channels** - Use privacy-preserving settlement (ZK proofs?)

#### 4. Product Validation

**Q4.1: What real-world use cases justify paid private messaging over free alternatives (Signal, Matrix)?**

Scenarios to validate:

- **Agent-to-agent confidential coordination** - Autonomous agents negotiating contracts
- **Paid anonymous tips/whistleblowing** - Pay for secure, deniable communication channel
- **Competitive multi-agent bidding** - Sealed-bid auctions without central authority
- **Medical/legal data exchange** - HIPAA-compliant messaging with audit trail
- **Cross-border remittance messaging** - Send money + encrypted memo in single transaction

Value proposition analysis:

- When is micropayment overhead justified vs. free messaging?
- Does payment create stronger incentive for relay reliability?
- Can paid routing enable censorship-resistant messaging (economic Sybil resistance)?

**Q4.2: How does this compare to existing paid messaging solutions?**

Competitive analysis:

- **Lightning Network messaging** (Sphinx, Juggernaut) - How does ILP compare?
- **Status.im paid stickers** - Similar micropayment UX?
- **Session.im** - Onion routing without payments, what's the trade-off?
- **Matrix homeserver fees** - Subscription vs. per-message, which is better?

Differentiation:

- What unique value does ILP + Nostr giftwrap provide?
- Why would users choose this over established alternatives?
- What developer/integration benefits justify the complexity?

### Secondary Questions (Nice to Have)

**Q5: Can we extend to group messaging with differential pricing per recipient?**

Scenario: Alice sends giftwrap to group of 5 agents, each gets different payment based on priority.

**Q6: How would this integrate with NIP-90 DVM marketplace?**

Use case: DVMs submit private work results via paid giftwrap to prevent competitors seeing output.

**Q7: What metrics prove the demo successfully showcases the value proposition?**

Success metrics:

- Message delivery success rate (>99%)
- Privacy preservation (intermediaries cannot decrypt)
- Payment distribution accuracy (each hop receives correct amount)
- User comprehension (non-technical viewers understand the demo)

---

## Research Methodology

### Information Sources

**Primary Technical Documentation:**

1. **NIP-59 Specification** - https://github.com/nostr-protocol/nips/blob/master/59.md
2. **NIP-17 Specification** - https://github.com/nostr-protocol/nips/blob/master/17.md
3. **NIP-44 Encryption** - https://github.com/nostr-protocol/nips/blob/master/44.md
4. **RFC-0027 ILPv4** - https://interledger.org/rfcs/0027-interledger-protocol-4/
5. **RFC-0038 Settlement Engines** - https://interledger.org/rfcs/0038-settlement-engines/

**M2M Codebase Analysis:**

- `docs/prd/epic-31-workflow-demo-multi-hop-cross-chain.md` - Workflow routing pattern
- `docs/prd/epic-30-balance-proof-exchange.md` - Claim event integration
- `docs/architecture/agent-society-protocol.md` - Agent addressing and event handling
- `packages/connector/src/agent/event-handler.ts` - Current event kind handling
- `packages/connector/src/workflow/workflow-peer-server.ts` - Workflow endpoint pattern
- `packages/shared/src/types/claim-events.ts` - Claim event structure

**Comparative Systems Research:**

- Sphinx Chat (Lightning Network messaging) - Architecture and payment model
- Status.im - Paid messaging UX patterns
- Session.im - Onion routing without payments
- Matrix protocol - Federation vs. P2P trade-offs

### Analysis Frameworks

**Framework 1: TOON Encoding Size Analysis**

Methodology:

1. Create sample NIP-59 giftwrap event (rumor → seal → wrap)
2. Serialize with TOON encoder
3. Measure byte size at each layer
4. Compare to ILP packet size limits
5. Test with varying message sizes (100 bytes, 1KB, 10KB, 50KB)

Expected output:

- Size comparison table (JSON vs. TOON for each layer)
- Compression ratio analysis
- Chunking requirements (if >64KB)

**Framework 2: Payment Flow Modeling**

3-hop routing scenario:

```
Alice → Facilitator → Connector1 → Connector2 → Bob

Payment allocation (300 msat total):
- Facilitator: 50 msat (gateway service)
- Connector1: 100 msat (first relay hop)
- Connector2: 100 msat (second relay hop)
- Bob: 50 msat (delivery confirmation)

Flow:
1. Alice creates giftwrap(seal(rumor("Hello Bob")))
2. Alice sends ILP Prepare:
   - destination: g.agent.bob.private
   - amount: 300 msat
   - data: TOON(giftwrap_event)
   - condition: hash(secret)
3. Facilitator forwards to Connector1 (deducts 50 msat)
4. Connector1 forwards to Connector2 (deducts 100 msat)
5. Connector2 forwards to Bob (deducts 100 msat)
6. Bob unwraps → unseals → reads rumor
7. Bob sends ILP Fulfill (secret revealed, releases 50 msat)
8. Fulfill propagates back: C2 → C1 → Facilitator → Alice
9. All payments finalized, claim events exchanged
```

**Framework 3: Privacy Threat Modeling (STRIDE)**

| Threat                     | Example                                   | Mitigation                                         | Priority      |
| -------------------------- | ----------------------------------------- | -------------------------------------------------- | ------------- |
| **Spoofing**               | Malicious connector impersonates Bob      | Verify destination pubkey in seal                  | Medium        |
| **Tampering**              | Connector modifies encrypted payload      | ILP condition/fulfillment + signature verification | High          |
| **Repudiation**            | Alice denies sending message              | Unsigned rumor (deniability by design)             | N/A (feature) |
| **Information Disclosure** | Connector learns Alice → Bob relationship | Onion routing, timing obfuscation                  | High          |
| **Denial of Service**      | Connector drops messages                  | Require delivery confirmation, reputation system   | Medium        |
| **Elevation of Privilege** | Connector decrypts seal layer             | NIP-44 encryption, ephemeral keys                  | High          |

**Framework 4: Economic Viability Analysis**

Price sensitivity research:

- What price point do users accept for private messaging?
- Survey potential users (AI agent developers) on willingness to pay
- Calculate connector operational costs (storage, bandwidth, compute)
- Model break-even point for connector operators

Pricing scenarios:

- **Free tier:** 0 msat (subsidized by connector for network growth)
- **Micro tier:** 100 msat (~$0.0001 at $100k/BTC)
- **Standard tier:** 300 msat (Epic 32 demo price)
- **Premium tier:** 1000 msat (guaranteed low-latency, high-reliability)

### Data Requirements

**Quantitative Data:**

- Giftwrap event sizes (bytes) at each encryption layer
- ILP packet overhead (TOON encoding + ILP headers)
- Encryption/decryption latency (ms)
- Message delivery success rate (% across 100 test messages)
- Settlement threshold impact on privacy (messages per claim event)

**Qualitative Data:**

- Developer feedback on API ergonomics (ease of integration)
- User comprehension of privacy guarantees (survey after demo)
- Competitive positioning vs. Lightning/Matrix messaging
- Use case validation interviews with potential users

---

## Expected Deliverables

### 1. Executive Summary (2-3 pages)

**Structure:**

- **Research Objective:** Product validation for paid giftwrap routing
- **Key Findings:** 3-5 bullet points answering primary research questions
- **Recommendation:** Go/No-Go decision with rationale
- **Critical Risks:** Top 3 risks and mitigation strategies
- **Next Steps:** If Go, outline Epic 32 implementation roadmap

### 2. Technical Feasibility Report (10-15 pages)

**Section 2.1: NIP-59 + ILP Integration Architecture**

- Giftwrap event structure diagram (rumor → seal → wrap)
- TOON encoding analysis (size, compression, performance)
- ILP packet structure with embedded giftwrap
- Routing flow diagram (3-hop topology)
- Event handler modifications needed

**Section 2.2: Privacy Analysis**

- Threat model (what connectors learn)
- Privacy guarantees preserved vs. degraded
- Comparison to standard Nostr relay model
- Recommended mitigations (onion routing, timing obfuscation)

**Section 2.3: Payment Model Design**

- Recommended fee structure (msat per hop)
- Claim event integration strategy
- Settlement threshold recommendations
- Economic incentive alignment analysis

**Section 2.4: Implementation Roadmap**

- Story breakdown (8-10 stories, ~4 weeks)
- Dependency graph (what must be built first)
- Code modification scope (files to change, new files to create)
- Testing strategy (unit, integration, E2E)

### 3. Comparison Matrix (1-2 pages)

| Dimension        | Epic 31 Image Processing       | Epic 32 Giftwrap Routing           | Delta              |
| ---------------- | ------------------------------ | ---------------------------------- | ------------------ |
| **Content Type** | Public image data              | Encrypted private message          | +Privacy           |
| **Encryption**   | None                           | NIP-59 3-layer (rumor/seal/wrap)   | +Security          |
| **Event Kind**   | Kind 1 (note)                  | Kind 1059 (giftwrap)               | +Anonymity         |
| **Routing**      | 3-hop (Facilitator→C1→C2→Peer) | Same topology reused               | No change          |
| **Payment**      | 450 msat (workflow steps)      | 300 msat (relay service)           | -33% cost          |
| **Settlement**   | Claim events (public)          | Claim events (batched for privacy) | +Privacy           |
| **Use Case**     | Computational work routing     | Confidential communication         | Different vertical |
| **Demo UI**      | Upload + result viewer         | Chat interface                     | New component      |

### 4. Product Validation Summary (5-8 pages)

**Section 4.1: Use Case Analysis**

- Top 5 validated use cases with user stories
- Competitive positioning vs. alternatives
- Unique value proposition statement
- Target user segments (AI agent developers, privacy-focused apps)

**Section 4.2: Economic Model Validation**

- Pricing sensitivity analysis
- Connector revenue modeling (messages/day × fee)
- User willingness to pay (survey results)
- Break-even analysis for connector operators

**Section 4.3: Go-to-Market Considerations**

- Target demo audience (developers, investors, researchers)
- Key messaging points (privacy + payments + decentralization)
- Demonstration script (5-minute live demo flow)
- Success metrics (what proves this is valuable?)

### 5. Risk Assessment & Mitigation Plan (3-5 pages)

| Risk                               | Impact                        | Probability | Mitigation                          | Owner         |
| ---------------------------------- | ----------------------------- | ----------- | ----------------------------------- | ------------- |
| **Giftwrap event too large**       | High (demo fails)             | Medium      | Message chunking, compression       | Dev Team      |
| **Privacy degradation visible**    | High (invalidates value prop) | Medium      | Onion routing, timing obfuscation   | Security Team |
| **Users find pricing too high**    | Medium (adoption blocker)     | Low         | Free tier, dynamic pricing          | Product Team  |
| **Connectors drop messages**       | Medium (reliability issue)    | Low         | Delivery receipts, reputation       | Dev Team      |
| **Claim events leak metadata**     | High (privacy breach)         | Medium      | Batch settlement, separate channels | Dev Team      |
| **Demo too complex to understand** | Medium (marketing fails)      | High        | Simplified UI, clear narration      | UX Team       |

### 6. Implementation Artifacts

**Artifact 6.1: Epic 32 PRD Draft**

- Epic goal and description
- Story breakdown (8-10 stories)
- Acceptance criteria per story
- Technical dependencies and integration points

**Artifact 6.2: Architecture Diagrams**

- System architecture (components and data flow)
- Sequence diagram (Alice sends giftwrap to Bob)
- Payment flow diagram (3-hop routing with claim events)
- Encryption layer diagram (rumor → seal → wrap)

**Artifact 6.3: API Specification**

- `g.agent.*.private` endpoint definition
- Giftwrap event builder API
- Payment model configuration
- Error handling and rejection codes

**Artifact 6.4: Demo UI Mockups**

- Chat interface layout (shadcn-ui components)
- Encryption status indicators
- Payment routing visualization (privacy-preserving)
- Message composition and delivery confirmation UX

---

## Success Criteria

### Research Completeness

**✅ All primary questions (Q1.1 - Q4.2) answered with evidence-backed conclusions**

Validation checklist:

- [ ] Technical feasibility confirmed (giftwrap fits in ILP packets)
- [ ] Privacy analysis complete (threat model + mitigations documented)
- [ ] Payment model designed (fee structure + incentive alignment)
- [ ] Use cases validated (at least 3 compelling scenarios identified)
- [ ] Competitive analysis complete (vs. Lightning, Matrix, Session)

**✅ Clear Go/No-Go recommendation with rationale**

Decision criteria:

- **Go:** Technical feasibility high, use cases validated, risks mitigable
- **No-Go:** Privacy degradation too severe OR no compelling use case OR implementation too complex
- **Conditional Go:** Feasible but requires specific mitigations (e.g., must add onion routing)

### Deliverable Quality

**✅ Executive summary readable by non-technical stakeholders**

- No jargon without definitions
- Clear value proposition articulated
- Risks and mitigations understandable

**✅ Technical report actionable for development team**

- Specific code modifications identified
- Story breakdown ready for sprint planning
- Testing strategy defined

**✅ Product validation informs go-to-market strategy**

- Target users identified
- Pricing model validated
- Demo script ready for presentation

### Decision-Support Quality

**✅ Research enables confident prioritization decision**

Answers:

1. Should we build Epic 32 or focus on other epics?
2. If yes, what's the minimum viable implementation?
3. What risks must be mitigated before launch?
4. How do we measure success after launch?

---

## Timeline and Priority

### Research Phase Duration: 2 Weeks

**Week 1: Technical Validation (Days 1-5)**

- Day 1-2: NIP-59 + TOON integration prototype
- Day 3-4: Privacy threat modeling and analysis
- Day 5: Payment model design and economic analysis

**Week 2: Product Validation (Days 6-10)**

- Day 6-7: Use case validation (interviews, surveys)
- Day 8: Competitive analysis and positioning
- Day 9: Risk assessment and mitigation planning
- Day 10: Deliverable synthesis and recommendation

### Critical Path Items

**Blocker 1:** Giftwrap event size validation (Day 1-2)

- If giftwrap >64KB, must design chunking mechanism
- Blocks entire research if not resolvable

**Blocker 2:** Privacy degradation assessment (Day 3-4)

- If ILP routing fundamentally breaks NIP-59 privacy, research stops
- Must validate before proceeding to implementation design

**Milestone 1 (Day 5):** Technical feasibility checkpoint

- Decision point: Is this technically viable?
- If no, abort research and document why

**Milestone 2 (Day 10):** Final Go/No-Go recommendation

- Deliverables complete
- Presentation to stakeholders
- Decision to create Epic 32 PRD or defer

---

## Integration Points with Existing Epics

### Builds On (Dependencies)

**Epic 13: Agent Society Protocol**

- Reuse: `g.agent.*` addressing, event handlers, TOON codec
- Extend: Add `GiftwrapHandler` for kind 1059 events
- Modify: Subscription manager to handle encrypted events

**Epic 30: Balance Proof Exchange**

- Reuse: Claim event structure (kinds 30001-30003)
- Extend: Privacy-preserving claim batching
- Consider: Separate claim channels for private vs. public messages

**Epic 31: Workflow Demo**

- Reuse: 3-hop routing topology (Facilitator → C1 → C2 → Peer)
- Reuse: Payment distribution pattern
- Reuse: Docker orchestration for demo
- Differ: Chat UI instead of upload/process UI

### Enables (Future Work)

**Epic 33: Private DVM Job Submission** (potential)

- Use case: Submit confidential work requests via giftwrap
- Prevents competitors from seeing job parameters

**Epic 34: Sealed-Bid Auction Protocol** (potential)

- Use case: Multi-agent bidding with bid privacy
- Requires group giftwrap extension

**Epic 35: Onion-Routed Payments** (potential)

- Use case: Full sender/receiver anonymity
- Requires onion addressing research (referenced in Q3.3)

---

## Appendix A: Key Terms & Definitions

**Rumor:** Unsigned Nostr event (kind 14) containing plaintext message. Provides deniability (anyone could have created it).

**Seal:** NIP-44 encrypted wrapper around rumor, encrypted to recipient's public key (kind 13).

**Gift Wrap:** Outermost layer (kind 1059) encrypted with ephemeral sender key. Provides sender anonymity.

**TOON:** Token-Oriented Object Notation. Human-readable serialization format, ~40% smaller than JSON.

**ILP Prepare:** Payment request packet containing amount, destination, condition, expiry, and data.

**ILP Fulfill:** Payment confirmation packet containing fulfillment (preimage) and optional data.

**Claim Event:** Nostr event (kinds 30001-30003) that wraps message content while carrying signed payment proofs in tags.

**Settlement Threshold:** Accumulated balance limit that triggers on-chain settlement.

**Onion Routing:** Layered encryption where each hop only knows previous and next hop, not full path.

---

## Appendix B: Research Questions Priority Matrix

| Question                    | Impact if Unanswered                 | Research Effort             | Priority |
| --------------------------- | ------------------------------------ | --------------------------- | -------- |
| Q1.1 (Event size)           | **Blocker** - Demo won't work        | Low (prototype test)        | **P0**   |
| Q1.2 (Routing design)       | **Blocker** - Can't implement        | Medium (design exploration) | **P0**   |
| Q3.1 (Privacy leakage)      | **Blocker** - Invalidates value prop | High (threat modeling)      | **P0**   |
| Q4.1 (Use cases)            | **High** - No product-market fit     | Medium (user research)      | **P1**   |
| Q2.1 (Payment model)        | **High** - Poor economics            | Medium (modeling)           | **P1**   |
| Q1.3 (Code changes)         | Medium - Implementation delay        | Low (code review)           | **P2**   |
| Q3.2 (Privacy comparison)   | Medium - Unclear positioning         | Medium (analysis)           | **P2**   |
| Q4.2 (Competitive analysis) | Low - Nice to have                   | Medium (research)           | **P3**   |

**Priority Levels:**

- **P0:** Must answer before Day 5 checkpoint (blocks entire research)
- **P1:** Must answer before Day 10 final recommendation
- **P2:** Should answer if time permits (improves quality)
- **P3:** Optional (valuable but not critical)

---

## Appendix C: Reference Implementation Checklist

When conducting technical research, validate these implementation aspects:

**NIP-59 Giftwrap Creation:**

- [ ] Generate ephemeral key pair for gift wrap
- [ ] Create unsigned rumor (kind 14) with message content
- [ ] Seal rumor with NIP-44 encryption to recipient pubkey (kind 13)
- [ ] Wrap seal with ephemeral sender key (kind 1059)
- [ ] Randomize timestamp (±2 days per NIP-17)

**TOON Encoding:**

- [ ] Serialize giftwrap event with TOON encoder
- [ ] Measure encoded byte size
- [ ] Verify round-trip (encode → decode → matches original)
- [ ] Test with various message sizes (100B, 1KB, 10KB, 50KB)

**ILP Packet Integration:**

- [ ] Embed TOON-encoded giftwrap in ILP Prepare `data` field
- [ ] Set destination to `g.agent.bob.private`
- [ ] Set amount to 300 msat (100 per hop)
- [ ] Generate condition/fulfillment pair
- [ ] Route through 3 hops (Facilitator → C1 → C2 → Bob)

**Event Handler Extension:**

- [ ] Add kind 1059 detection in event handler
- [ ] Route to `GiftwrapHandler` (new component)
- [ ] Unwrap → unseal → extract rumor
- [ ] Return decrypted message content
- [ ] Handle decryption errors gracefully

**Claim Event Integration:**

- [ ] Wrap giftwrap event in claim event (kind 30001/30002/30003)
- [ ] Add signed claim tags (channel, amount, nonce, signature)
- [ ] Add unsigned request tags for peer to sign
- [ ] Exchange bidirectionally (sender and receiver both get claims)
- [ ] Verify no metadata leakage through claim tags

---

## Appendix D: Demo Script Outline

**5-Minute Live Demo Flow:**

**[0:00-1:00] Setup & Context**

- Show 4 terminal windows (Alice, Connector1, Connector2, Bob)
- Explain: "This is a 3-hop ILP payment network"
- Explain: "We'll send an encrypted private message with payment routing"

**[1:00-2:00] Message Composition**

- Alice opens chat UI (shadcn-ui interface)
- Types: "Hey Bob, confidential project update..."
- Shows encryption status: "Creating giftwrap (3 layers)"
- Shows payment: "300 msat total (100 per hop)"
- Clicks "Send Encrypted Message"

**[2:00-3:30] Payment Routing Visualization**

- Terminal 1 (Alice): "Creating ILP Prepare → Connector1"
- Terminal 2 (Connector1): "Received Prepare (encrypted blob), forwarding → Connector2"
- Terminal 3 (Connector2): "Received Prepare, forwarding → Bob"
- Terminal 4 (Bob): "Received giftwrap, decrypting..."
- Highlight: Connectors see encrypted blob, NOT message content

**[3:30-4:30] Message Delivery & Payment Release**

- Bob's UI shows decrypted message: "Hey Bob, confidential project update..."
- Shows: "Unwrapped → Unsealed → Rumor"
- Bob clicks "Confirm Receipt" (sends ILP Fulfill)
- Payment flows back: Bob ← C2 ← C1 ← Alice
- Each connector shows: "Received 100 msat for relay service"

**[4:30-5:00] Privacy Highlight**

- Replay connector logs: "Cannot see message content (encrypted)"
- Replay connector logs: "Cannot prove sender identity (ephemeral keys)"
- Summarize: "Private, paid, peer-to-peer messaging through ILP"

---

**End of Research Prompt**

---

## Usage Instructions

**For Researchers:**

1. Read Research Objective and Background Context first
2. Answer Primary Questions (Q1.1-Q4.2) in order - these are blocking questions
3. Use Analysis Frameworks (TOON encoding, payment flow, threat modeling, economics)
4. Produce deliverables in specified format (executive summary first, then technical report)
5. Ensure success criteria met before finalizing recommendation

**For Stakeholders:**

1. Read Executive Summary (produced by researcher) for Go/No-Go decision
2. Review Risk Assessment for implementation planning
3. Use Product Validation Summary for positioning and messaging
4. Reference Implementation Roadmap for sprint planning if Go decision

**For Implementation Team (if Go decision):**

1. Use Technical Feasibility Report as architecture specification
2. Convert Implementation Roadmap to Epic 32 PRD stories
3. Use API Specification for interface design
4. Use Demo Script for E2E test scenarios

---

**Research Prompt Version:** 1.0
**Last Updated:** 2026-02-01
**Status:** Ready for Execution
