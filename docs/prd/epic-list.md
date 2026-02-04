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
Create comprehensive developer documentation explaining ILP concepts and ensure all RFC references are accurate, accessible, and properly integrated into the project documentation.

**Epic 6: Settlement Foundation & Accounting**
Integrate TigerBeetle as the double-entry accounting database, build account management infrastructure to track balances and credit limits between peers, implement settlement threshold triggers, and provide dashboard visualization of account states and settlement events.

**Epic 7: Local Blockchain Development Infrastructure**
Establish local blockchain node infrastructure with Anvil (Base L2 fork), rippled (XRP Ledger standalone mode), and Aptos local testnet via Docker Compose, enabling developers to build and test payment channel smart contracts locally without testnet/mainnet dependencies.

**Epic 8: EVM Payment Channels (Base L2)**
Implement XRP-style payment channels as EVM smart contracts on Base L2, deploy payment channel infrastructure via Docker, integrate with settlement layer for automatic channel settlement, and enable instant cryptocurrency micropayments between connector peers.

**Epic 9: XRP Payment Channels**
Integrate XRP Ledger payment channels (PayChan) for settlement, implement XRP payment channel state management and claim verification, enable dual-settlement support (both EVM and XRP), and provide unified settlement API for multi-chain operations.

**Epic 10: CI/CD Pipeline Reliability & Test Quality**
Eliminate recurring CI/CD pipeline failures on epic branch pull requests by fixing test quality issues (async handling, mock coverage, timeouts), implementing pre-commit quality gates, and establishing systematic testing workflows that ensure code quality before CI execution.

**Epic 11: Packet Explorer UI**
Deliver a per-node web-based explorer interface embedded in each connector that visualizes packets and events flowing through the network in real-time. The explorer provides block explorer-style inspection capabilities for ILP packets, settlements, and payment channel activity, with full event persistence via libSQL for historical browsing and analysis.

**Epic 12: Explorer — Performance, UX & Visual Quality**
Polish the Explorer UI with performance optimizations (60fps at 1000+ events, WebSocket batching), UX improvements (keyboard shortcuts, filter persistence, responsive layout, empty states), visual quality refinements (typography audit, spacing consistency, WCAG AA contrast, animations), historical data hydration for accounts and payment channels, and a Peers & Routing Table view for network topology visibility.

**Epic 13: Aptos Payment Channels (Move Modules)**
Integrate Aptos blockchain payment channels for settlement, enabling tri-chain settlement support where connectors can settle using EVM payment channels (Epic 8), XRP payment channels (Epic 9), and Aptos Move-based payment channels. Leverages Aptos's high throughput (160,000+ TPS) and sub-second finality for micropayments.

**Epic 14: Public Testnet Integration for Tri-Chain Settlement**
Add `NETWORK_MODE=testnet/local` support for all three chains (Aptos Testnet, XRP Testnet, Base Sepolia), enabling developers to run integration tests against public testnets without local Docker container dependencies. Includes testnet URL configuration, faucet API integration, and backward-compatible local mode for offline development.

**Epic 15: Blockchain Explorer Navigation Links**
Transform static wallet addresses and transaction hashes throughout the Explorer into interactive, clickable links that open the corresponding blockchain explorer in a new tab. Implements smart address type detection (Aptos, Base Sepolia, XRP Testnet) and integrates blockchain explorer URLs into all address display components.

**Epic 16: Infrastructure Hardening & CI/CD Improvements**
Remediate infrastructure review findings including Node version alignment (Dockerfile vs package.json), multi-architecture Docker builds (amd64 + arm64), security pipeline hardening (blocking npm audit, enforced Snyk scans), production secrets management, Alertmanager configuration for notifications, and resource limits for production deployments.

**Epic 17: BTP Off-Chain Claim Exchange Protocol**
Implement standardized off-chain payment channel claim exchange via BTP protocolData for all three settlement chains (XRP, EVM/Base L2, and Aptos). Enable connectors to send cryptographically signed settlement claims to peers over the existing BTP WebSocket connection without requiring separate communication channels. Build unified claim encoding/decoding infrastructure, implement claim verification workflows, add claim persistence for dispute resolution, automatic claim redemption service, and provide comprehensive telemetry for monitoring claim exchange health across all blockchain types.

**Epic 18: Explorer UI — Network Operations Center Redesign**
Transform the Connector Explorer into a distinctive, production-grade Network Operations Center (NOC) dashboard using the frontend-design skill and Playwright MCP verification. Deliver a modern, visually striking interface with a Dashboard-first approach that emphasizes real-time ILP packet routing metrics, live packet flow visualization, and comprehensive observability across all five tabs (Dashboard, Packets, Accounts, Peers, Keys) with seamless live and historical data integration. Features deep space color palette, neon ILP packet type indicators (cyan/emerald/rose), monospace technical typography, and custom animations for a professional monitoring experience.

**Epic 19: Production Deployment Parity**
Enable TigerBeetle accounting infrastructure in the docker-compose-5-peer-multihop.yml deployment by adding the TigerBeetle service, wiring real AccountManager to replace mock implementation, and verifying that the Explorer UI Accounts tab displays real-time balance data. This epic bridges Epic 6 (backend accounting code - completed) with Epic 18 (frontend UI - completed) by activating accounting in the multi-peer test deployment.

---

## Project Status

Epics 1-18 are **completed** or **in progress**. Epic 19 enables deployment parity. The connector is feature-complete with:

- RFC-compliant ILPv4 packet routing
- BTP WebSocket protocol for connector peering
- Tri-chain settlement (EVM, XRP, Aptos)
- TigerBeetle double-entry accounting
- Explorer UI with NOC aesthetic for professional observability
- Public testnet support for all three chains
- Off-chain claim exchange for all settlement methods
