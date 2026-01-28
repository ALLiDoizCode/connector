# Epic List

**Epic 1: Foundation & Core ILP Protocol Implementation**
Establish monorepo structure, implement RFC-0027 (ILPv4) packet handling and routing logic with OER encoding, and deliver basic packet forwarding capability with unit tests and logging.

**Epic 2: BTP Protocol & Multi-Node Docker Deployment**
Implement RFC-0023 BTP WebSocket communication between connectors, create Docker containerization with Compose orchestration, and enable deployment of configurable N-node networks with health checks.

**Epic 3: Real-Time Visualization Dashboard**
Build React-based network visualization showing topology and animated packet flow, implement telemetry aggregation from connector nodes, and provide interactive packet inspection capabilities.

**Epic 4: Logging, Configuration & Developer Experience**
Implement comprehensive structured logging with filterable log viewer, add support for multiple network topology configurations, create test packet sender utility, and complete documentation for user onboarding.

**Epic 5: Documentation and RFC Integration**
Create comprehensive developer documentation explaining ILP concepts and ensure all RFC references are accurate, accessible, and properly integrated into the M2M project documentation.

**Epic 6: Settlement Foundation & Accounting**
Integrate TigerBeetle as the double-entry accounting database, build account management infrastructure to track balances and credit limits between peers, implement settlement threshold triggers, and provide dashboard visualization of account states and settlement events.

**Epic 7: Local Blockchain Development Infrastructure**
Establish local blockchain node infrastructure with Anvil (Base L2 fork) and rippled (XRP Ledger standalone mode) via Docker Compose, enabling developers to build and test payment channel smart contracts locally without testnet/mainnet dependencies, with instant block finality and zero gas costs.

**Epic 8: EVM Payment Channels (Base L2)**
Implement XRP-style payment channels as EVM smart contracts on Base L2, deploy payment channel infrastructure via Docker, integrate with settlement layer for automatic channel settlement, and enable instant cryptocurrency micropayments between connector peers.

**Epic 9: XRP Payment Channels**
Integrate XRP Ledger payment channels (PayChan) for settlement, implement XRP payment channel state management and claim verification, enable dual-settlement support (both EVM and XRP), and provide unified settlement API for multi-chain operations.

**Epic 10: CI/CD Pipeline Reliability & Test Quality**
Eliminate recurring CI/CD pipeline failures on epic branch pull requests by fixing test quality issues (async handling, mock coverage, timeouts), implementing pre-commit quality gates, and establishing systematic testing workflows that ensure code quality before CI execution.

**Epic 11: AI Agent Wallet Infrastructure**
Implement programmatic wallet creation and management for AI agents, provide HD wallet derivation for scalable agent provisioning, enable per-agent wallet isolation with automated lifecycle management, and deliver wallet monitoring, balance tracking, and recovery procedures for autonomous agent operations.

**Epic 12: Multi-Chain Settlement & Production Hardening**
Add cross-chain settlement coordination, implement production-grade security hardening (key management, rate limiting, fraud detection), optimize for AI agent micropayment performance (10K+ TPS), and deliver complete Docker deployment with simplified peer onboarding for M2M economy ecosystem.

**Epic 13: Agent Society Protocol (ILP + Nostr Integration)**
Extend the ILP implementation to support autonomous AI agents as unified Connector-Relays that combine ILP packet routing with Nostr event storage and handling. Agents use ILP packets to route TOON-serialized Nostr events, store events locally in SQLite databases, and charge for services via the packet amount field. Follow relationships (Kind 3) determine routing topology, enabling decentralized agent-to-agent communication with native micropayment capabilities.

**Epic 14: Packet/Event Explorer UI**
Deliver a per-node web-based explorer interface embedded in each connector that visualizes packets and events in real-time. The explorer provides block explorer-style inspection for ILP packets, TOON events, settlements, and agent activity, with full event persistence via libSQL for historical browsing and analysis. Built with React, shadcn/ui, and WebSocket streaming.

**Epic 15: Agent Explorer — Performance, UX & Visual Quality**
Rebrand "M2M Explorer" to "Agent Explorer" and polish the Explorer UI with performance optimizations (60fps at 1000+ events, WebSocket batching), UX improvements (keyboard shortcuts, filter persistence, responsive layout, empty states), visual quality refinements (typography audit, spacing consistency, WCAG AA contrast, animations), historical data hydration for accounts and payment channels, and a new Peers & Routing Table view for network topology visibility. All work verified against real Docker Agent Society test data.

**Epic 16: AI Agent Node — Vercel AI SDK Integration**
Integrate the Vercel AI SDK to make the M2M agent node AI-native. The AI agent uses agent skills — modular capabilities mapped to Nostr event kinds — to process events, compose responses, and route packets. Each skill wraps an existing handler as an AI SDK tool() with a description, Zod schema, and execute function. The AI agent orchestrates which skills to invoke based on the incoming event. AI dispatch is enabled by default, with direct handler dispatch (from Epic 13) serving as a fallback when the AI is unavailable (budget exhausted, API error) or explicitly disabled. Provider-agnostic via the AI SDK provider system (Anthropic, OpenAI, Google, etc.).

**Epic 17: NIP-90 DVM Compatibility & Agent Task Delegation**
Migrate the M2M agent's service architecture to NIP-90 Data Vending Machine (DVM) patterns, establishing ecosystem compatibility with the broader Nostr agent ecosystem. Includes structured task delegation between agents (Kind 5900) as a DVM job type. The current Kind 10000 query service will be refactored to use the NIP-90 job marketplace model (kinds 5000-6999). Payment is handled by existing ILP infrastructure — the packet amount field IS the payment. Critical foundation for all agent-to-agent service interactions.

**Epic 18: Agent Capability Discovery (NIP-XX1)**
Implement NIP-XX1 (Agent Capability Advertisement), enabling agents to advertise their capabilities, supported event kinds, pricing, and availability to the network. Builds on NIP-89 (Recommended Application Handlers) with agent-specific metadata fields, allowing agents to discover peers through the social graph and filter by required capabilities before task delegation. Includes pricing tags for price discovery.

**Epic 20: Multi-Agent Coordination (NIP-XX3)**
Implement NIP-XX3 (Multi-Agent Coordination), defining coordination primitives for multi-agent consensus, voting, and collective decision-making. Enables scenarios requiring multiple agents to agree on actions: multi-signature approvals, distributed task allocation, consensus on shared state, and conflict resolution.

**Epic 21: Agent Reputation, Trust & Disputes (NIP-XX4)**
Implement NIP-XX4 (Agent Reputation & Trust), defining a decentralized reputation system for AI agents based on attestations, performance metrics, and trust scoring within the social graph. Enables agents to evaluate peer reliability before delegation, build reputation through successful interactions, and share trust assessments with the network. Includes dispute resolution mechanisms (Kind 30882) for contesting attestations and resolving conflicts, absorbed from the removed Epic 23.

**Epic 22: Emergent Workflow Composition (NIP-XX5)**
Implement NIP-XX5 (Emergent Workflow Composition), defining how agents compose multi-step workflows dynamically. Enables declarative workflow definitions that orchestrate multiple agents in sequence or parallel for complex task pipelines like data processing, multi-modal transformations, approval workflows, and conditional branching.

---

## Removed Epics (After Redundancy Review)

**Epic 19: Agent Task Delegation** — _Merged into Epic 17_. Task delegation is implemented as a DVM job type (Kind 5900) rather than a separate protocol, avoiding duplication of patterns.

**Epic 23: Agent Payment Protocol** — _Removed as redundant_. Payment is already handled by existing infrastructure: ILP PREPARE packet amounts, `EventHandler._validatePayment()`, EVM/XRP payment channels (Epics 8, 9), and TigerBeetle accounting (Epic 6). Dispute resolution mechanisms were absorbed into Epic 21. No additional payment protocol needed.

---
