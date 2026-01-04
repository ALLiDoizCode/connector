/**
 * Configuration Types for ILP Connector
 *
 * Defines TypeScript interfaces for YAML configuration schema.
 * These types support defining network topology, peer connections,
 * and routing tables in a declarative configuration file.
 *
 * Example YAML Configuration:
 *
 * ```yaml
 * # Connector Configuration (Linear Topology - Middle Node)
 * nodeId: connector-b
 * btpServerPort: 3001
 * healthCheckPort: 8080
 * logLevel: info
 *
 * # Peer connector definitions
 * peers:
 *   - id: connector-a
 *     url: ws://connector-a:3000
 *     authToken: secret-a-to-b
 *
 *   - id: connector-c
 *     url: ws://connector-c:3002
 *     authToken: secret-b-to-c
 *
 * # Routing table entries
 * routes:
 *   - prefix: g.connectora
 *     nextHop: connector-a
 *     priority: 0
 *
 *   - prefix: g.connectorc
 *     nextHop: connector-c
 *     priority: 0
 * ```
 *
 * @packageDocumentation
 */

/**
 * Peer Configuration Interface
 *
 * Defines connection parameters for a peer connector in the network.
 * Peers are other ILP connectors that this node will establish
 * BTP (Bilateral Transfer Protocol) connections with.
 *
 * @property id - Unique peer identifier used in route definitions
 * @property url - WebSocket URL for peer connection (ws:// or wss://)
 * @property authToken - Shared secret for BTP authentication
 *
 * @example
 * ```typescript
 * const peer: PeerConfig = {
 *   id: 'connector-a',
 *   url: 'ws://connector-a:3000',
 *   authToken: 'shared-secret-123'
 * };
 * ```
 */
export interface PeerConfig {
  /**
   * Unique identifier for this peer
   * Used as reference in route nextHop fields
   * Must be unique across all peers in the configuration
   */
  id: string;

  /**
   * WebSocket URL for connecting to peer's BTP server
   * Format: ws://hostname:port or wss://hostname:port
   * Examples:
   * - ws://connector-a:3000
   * - wss://secure-connector.example.com:3001
   */
  url: string;

  /**
   * Shared secret for BTP authentication
   * Used to authenticate this connector to the peer
   * Should be a strong, randomly generated token
   */
  authToken: string;
}

/**
 * Route Configuration Interface
 *
 * Defines a routing table entry mapping ILP address prefixes
 * to peer connectors. Routes determine packet forwarding decisions.
 *
 * @property prefix - ILP address prefix pattern (RFC-0015 format)
 * @property nextHop - Peer ID to forward packets to
 * @property priority - Optional priority for tie-breaking (default: 0)
 *
 * @example
 * ```typescript
 * const route: RouteConfig = {
 *   prefix: 'g.alice',
 *   nextHop: 'connector-b',
 *   priority: 10
 * };
 * ```
 */
export interface RouteConfig {
  /**
   * ILP address prefix for route matching
   * Format: RFC-0015 compliant address prefix
   * Pattern: lowercase alphanumeric characters, dots, underscores, tildes, hyphens
   * Examples:
   * - g.alice
   * - g.bob.usd
   * - g.exchange.crypto
   */
  prefix: string;

  /**
   * Peer ID to forward matching packets to
   * Must reference an existing peer ID from the peers list
   * Used to determine which BTP connection to use
   */
  nextHop: string;

  /**
   * Route priority for tie-breaking when multiple routes match
   * Higher priority routes are preferred
   * Optional - defaults to 0 if not specified
   */
  priority?: number;
}

/**
 * Connector Configuration Interface
 *
 * Top-level configuration for an ILP connector node.
 * Defines node identity, network settings, peers, and routing.
 *
 * @property nodeId - Unique identifier for this connector instance
 * @property btpServerPort - Port for incoming BTP connections
 * @property healthCheckPort - Optional HTTP health endpoint port (default: 8080)
 * @property logLevel - Optional logging verbosity (default: 'info')
 * @property peers - List of peer connectors to connect to
 * @property routes - Initial routing table entries
 * @property dashboardTelemetryUrl - Optional WebSocket URL for telemetry
 *
 * @example
 * ```typescript
 * const config: ConnectorConfig = {
 *   nodeId: 'connector-b',
 *   btpServerPort: 3001,
 *   healthCheckPort: 8080,
 *   logLevel: 'info',
 *   peers: [
 *     { id: 'connector-a', url: 'ws://connector-a:3000', authToken: 'secret-a' }
 *   ],
 *   routes: [
 *     { prefix: 'g.connectora', nextHop: 'connector-a', priority: 0 }
 *   ]
 * };
 * ```
 */
export interface ConnectorConfig {
  /**
   * Unique identifier for this connector instance
   * Used in logging, telemetry, and network identification
   * Should be descriptive and unique across the network
   *
   * Examples: 'connector-a', 'hub-node', 'spoke-1'
   */
  nodeId: string;

  /**
   * Port number for BTP server to listen on
   * Accepts incoming BTP connections from peer connectors
   * Valid range: 1-65535
   *
   * Common ports: 3000, 3001, 3002, etc.
   */
  btpServerPort: number;

  /**
   * Port number for HTTP health check endpoint
   * Optional - defaults to 8080 if not specified
   * Valid range: 1-65535
   *
   * Used by orchestration systems (Docker, Kubernetes) for health monitoring
   */
  healthCheckPort?: number;

  /**
   * Logging verbosity level
   * Optional - defaults to 'info' if not specified
   *
   * Levels:
   * - 'debug': Detailed debugging information
   * - 'info': General informational messages
   * - 'warn': Warning messages
   * - 'error': Error messages only
   */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * List of peer connectors to establish BTP connections with
   * Each peer represents another connector in the network
   * Can be an empty array if this node only accepts incoming connections
   *
   * Peer IDs must be unique within this list
   */
  peers: PeerConfig[];

  /**
   * Initial routing table entries
   * Defines how to forward packets based on destination address
   * Can be an empty array for nodes with no predefined routes
   *
   * Route nextHop values must reference peer IDs from the peers list
   */
  routes: RouteConfig[];

  /**
   * Optional WebSocket URL for sending telemetry to dashboard
   * Used for real-time monitoring and visualization
   * Format: ws://hostname:port or wss://hostname:port
   *
   * Example: 'ws://dashboard.example.com:8080'
   */
  dashboardTelemetryUrl?: string;

  /**
   * Optional settlement configuration for TigerBeetle integration
   * When provided, enables settlement recording for packet forwarding
   * Defaults to settlement disabled if not specified
   */
  settlement?: SettlementConfig;
}

/**
 * Credit Limit Configuration Interface
 *
 * Configures credit limits for managing counterparty risk.
 * Credit limits define the maximum amount peers can owe the connector
 * (accounts receivable ceiling) before packets are rejected.
 *
 * **Credit Limit Semantics:**
 * - Credit limit applies to peer's debt to the connector (creditBalance)
 * - Limit on accounts receivable (how much peers can owe us)
 * - Undefined limits = unlimited exposure (backward compatible)
 * - Limits enforced BEFORE settlement recording (fail-safe design)
 *
 * **Limit Hierarchy (highest priority first):**
 * 1. Token-specific limit: perTokenLimits[peerId][tokenId]
 * 2. Per-peer limit: perPeerLimits[peerId]
 * 3. Default limit: defaultLimit
 * 4. Unlimited: undefined (no limit configured)
 *
 * Global ceiling applies to ALL limits as security override.
 *
 * @property defaultLimit - Default credit limit for all peers (undefined = unlimited)
 * @property perPeerLimits - Per-peer credit limit overrides
 * @property perTokenLimits - Token-specific limits per peer
 * @property globalCeiling - Maximum credit limit allowed (security safety valve)
 *
 * @example
 * ```typescript
 * const creditLimits: CreditLimitConfig = {
 *   defaultLimit: 1000000n,           // 1M units default
 *   perPeerLimits: new Map([
 *     ['trusted-peer', 10000000n],    // 10M units for trusted peer
 *     ['new-peer', 100000n]           // 100K units for new peer
 *   ]),
 *   perTokenLimits: new Map([
 *     ['high-value-peer', new Map([
 *       ['BTC', 100n],                // 100 satoshis max for BTC
 *       ['ETH', 1000n]                // 1000 wei max for ETH
 *     ])]
 *   ]),
 *   globalCeiling: 50000000n          // 50M units absolute max
 * };
 * ```
 */
export interface CreditLimitConfig {
  /**
   * Default credit limit for all peers
   * Applied when no per-peer or token-specific limit is configured
   * Format: bigint (matches ILP packet amount type)
   * undefined = unlimited (backward compatible)
   */
  defaultLimit?: bigint;

  /**
   * Per-peer credit limit overrides
   * Key: peerId (from peer configuration)
   * Value: credit limit as bigint
   * Overrides defaultLimit for specified peers
   */
  perPeerLimits?: Map<string, bigint>;

  /**
   * Token-specific credit limits per peer
   * Key: peerId (from peer configuration)
   * Value: Map of tokenId to credit limit
   * Highest priority in limit hierarchy
   *
   * Use case: Different limits for different currencies/tokens
   * Example: Lower limit for volatile assets (BTC, ETH) vs stablecoins (USDC)
   */
  perTokenLimits?: Map<string, Map<string, bigint>>;

  /**
   * Global credit limit ceiling (security safety valve)
   * Maximum allowed credit limit per peer regardless of configuration
   * Prevents misconfiguration from creating unbounded exposure
   * Format: bigint, undefined = no global ceiling
   * Typically set via environment variable: SETTLEMENT_GLOBAL_CREDIT_CEILING
   *
   * Applied AFTER determining configured limit:
   * effectiveLimit = min(configuredLimit, globalCeiling)
   */
  globalCeiling?: bigint;
}

/**
 * Credit Limit Violation Interface
 *
 * Describes a credit limit violation for logging and error reporting.
 * Returned by checkCreditLimit() when a proposed transfer would exceed
 * the configured credit limit for a peer.
 *
 * @property peerId - Peer that would exceed limit
 * @property tokenId - Token type being transferred
 * @property currentBalance - Current account balance (peer's debt to us)
 * @property requestedAmount - Amount being requested
 * @property creditLimit - Configured credit limit
 * @property wouldExceedBy - Amount over limit
 *
 * @example
 * ```typescript
 * const violation: CreditLimitViolation = {
 *   peerId: 'connector-a',
 *   tokenId: 'ILP',
 *   currentBalance: 4500n,
 *   requestedAmount: 600n,
 *   creditLimit: 5000n,
 *   wouldExceedBy: 100n  // (4500 + 600) - 5000 = 100
 * };
 * ```
 */
export interface CreditLimitViolation {
  /**
   * Peer ID that would exceed credit limit
   * References peer.id from configuration
   */
  peerId: string;

  /**
   * Token type being transferred
   * Examples: 'ILP' (default), 'USDC', 'BTC', 'ETH'
   * Used for token-specific limit lookup
   */
  tokenId: string;

  /**
   * Current account balance (peer's debt to us)
   * Format: bigint (creditBalance from TigerBeetle account)
   * Represents accounts receivable from this peer
   */
  currentBalance: bigint;

  /**
   * Amount being requested for this packet/transfer
   * Format: bigint (from ILP packet amount)
   */
  requestedAmount: bigint;

  /**
   * Configured credit limit for this peer/token
   * Format: bigint (effective limit after hierarchy and ceiling applied)
   */
  creditLimit: bigint;

  /**
   * Amount over limit
   * Calculation: (currentBalance + requestedAmount) - creditLimit
   * Format: bigint
   * Used for logging/debugging to show extent of violation
   */
  wouldExceedBy: bigint;
}

/**
 * Settlement Configuration Interface
 *
 * Configures TigerBeetle settlement integration for recording
 * double-entry transfers during packet forwarding.
 *
 * @property connectorFeePercentage - Connector fee as percentage (e.g., 0.1 = 0.1%)
 * @property enableSettlement - Feature flag to enable/disable settlement recording
 * @property tigerBeetleClusterId - TigerBeetle cluster ID for transfers
 * @property tigerBeetleReplicas - TigerBeetle replica addresses
 *
 * @example
 * ```typescript
 * const settlement: SettlementConfig = {
 *   connectorFeePercentage: 0.1,
 *   enableSettlement: true,
 *   tigerBeetleClusterId: 0,
 *   tigerBeetleReplicas: ['localhost:3000']
 * };
 * ```
 */
export interface SettlementConfig {
  /**
   * Connector fee as percentage of packet amount
   * Format: Decimal percentage (0.1 = 0.1%, 1.0 = 1.0%)
   * Default: 0.1 (0.1% fee)
   *
   * Fee is deducted from forwarded packet amount:
   * - Original packet: 1000 units
   * - Fee (0.1%): 1 unit
   * - Forwarded amount: 999 units
   *
   * Fee calculation uses integer arithmetic to avoid floating-point precision issues.
   * See calculateConnectorFee() implementation for basis point conversion details.
   */
  connectorFeePercentage: number;

  /**
   * Feature flag to enable/disable settlement recording
   * Default: true
   *
   * When enabled:
   * - All packet forwards record double-entry transfers in TigerBeetle
   * - Failed settlement recording rejects packets with T00_INTERNAL_ERROR
   *
   * When disabled:
   * - Packets forward normally without settlement recording
   * - Backward compatible with pre-settlement connector behavior
   */
  enableSettlement: boolean;

  /**
   * TigerBeetle cluster ID for all transfers
   * Format: 32-bit unsigned integer
   * Must match cluster ID used during TigerBeetle initialization
   *
   * See Story 6.1/6.2 for TigerBeetle deployment configuration
   */
  tigerBeetleClusterId: number;

  /**
   * TigerBeetle replica addresses
   * Format: Array of "hostname:port" strings
   * Examples:
   * - ['localhost:3000'] (single replica for local development)
   * - ['tb-1:3000', 'tb-2:3000', 'tb-3:3000'] (3-replica cluster for production)
   *
   * TigerBeetle client will connect to all replicas for high availability
   */
  tigerBeetleReplicas: string[];

  /**
   * Optional credit limit configuration for managing counterparty risk
   * When provided, enforces limits on how much peers can owe the connector
   * Defaults to unlimited credit (no enforcement) if not specified
   */
  creditLimits?: CreditLimitConfig;

  /**
   * Optional settlement threshold configuration for proactive settlement triggers
   * When provided, enables monitoring of account balances to trigger settlements
   * BEFORE credit limits are reached (prevents packet rejections)
   * Defaults to threshold monitoring disabled if not specified
   */
  thresholds?: SettlementThresholdConfig;
}

/**
 * Settlement Transfer Metadata Interface
 *
 * Metadata attached to TigerBeetle transfers for packet forwarding events.
 * Enables correlation between ILP packets and settlement records.
 *
 * @property packetId - Execution condition hash as hex string (unique packet ID)
 * @property timestamp - Transfer recording timestamp
 * @property incomingPeerId - Peer who sent us the packet
 * @property outgoingPeerId - Peer we're forwarding to
 * @property originalAmount - Original packet amount (before fee)
 * @property forwardedAmount - Amount forwarded after fee deduction
 * @property connectorFee - Connector fee amount collected
 *
 * @example
 * ```typescript
 * const metadata: SettlementTransferMetadata = {
 *   packetId: 'a3c5f9...',
 *   timestamp: new Date(),
 *   incomingPeerId: 'connector-a',
 *   outgoingPeerId: 'connector-c',
 *   originalAmount: 1000n,
 *   forwardedAmount: 999n,
 *   connectorFee: 1n
 * };
 * ```
 */
export interface SettlementTransferMetadata {
  /**
   * Packet ID derived from execution condition
   * Format: Hex-encoded SHA-256 hash (64 characters)
   * Uniquely identifies the ILP packet across the network
   *
   * Used to correlate settlement transfers with packet flow logs
   */
  packetId: string;

  /**
   * Timestamp when transfer was recorded
   * Used for settlement event chronology and audit trails
   */
  timestamp: Date;

  /**
   * Peer ID who sent us the packet
   * References peer.id from configuration
   * Identifies source of incoming value transfer
   */
  incomingPeerId: string;

  /**
   * Peer ID we're forwarding packet to
   * References peer.id from configuration
   * Identifies destination of outgoing value transfer
   */
  outgoingPeerId: string;

  /**
   * Original packet amount before fee deduction
   * Format: bigint (64-bit unsigned integer from ILP packet)
   * Represents value received from incoming peer
   */
  originalAmount: bigint;

  /**
   * Amount forwarded to next-hop peer after fee deduction
   * Format: bigint
   * Calculation: originalAmount - connectorFee
   */
  forwardedAmount: bigint;

  /**
   * Connector fee collected for this packet forward
   * Format: bigint
   * Calculation: (originalAmount * connectorFeePercentage) using integer arithmetic
   *
   * Fee stays in connector's pocket (not recorded as separate TigerBeetle account in MVP)
   */
  connectorFee: bigint;
}

/**
 * Settlement Threshold Configuration Interface
 *
 * Configures settlement threshold monitoring for proactive settlement triggers.
 * Settlement thresholds trigger settlements BEFORE credit limits are reached,
 * preventing packet rejections due to credit limit violations.
 *
 * **Settlement Threshold Semantics:**
 * - Threshold applies to creditBalance (how much peer owes us)
 * - Threshold is LOWER than credit limit (soft trigger vs hard ceiling)
 * - Threshold crossing emits event but does NOT reject packets
 * - Recommended: Threshold = 80% of credit limit (e.g., threshold 800, limit 1000)
 *
 * **Threshold Hierarchy (highest priority first):**
 * 1. Token-specific threshold: perTokenThresholds[peerId][tokenId]
 * 2. Per-peer threshold: perPeerThresholds[peerId]
 * 3. Default threshold: defaultThreshold
 * 4. No threshold: undefined (monitoring disabled for this peer)
 *
 * **Polling Interval Trade-offs:**
 * - Shorter intervals (5-10s): Faster detection, higher CPU usage
 * - Longer intervals (30-60s): Slower detection, lower overhead
 * - Default: 30 seconds (good balance for MVP)
 *
 * @property defaultThreshold - Default settlement threshold for all peers (undefined = no monitoring)
 * @property perPeerThresholds - Per-peer threshold overrides
 * @property perTokenThresholds - Token-specific thresholds per peer
 * @property pollingInterval - Balance polling interval in milliseconds (default: 30000)
 *
 * @example
 * ```typescript
 * const thresholds: SettlementThresholdConfig = {
 *   defaultThreshold: 500000n,           // 500K units default
 *   pollingInterval: 30000,              // 30 seconds
 *   perPeerThresholds: new Map([
 *     ['trusted-peer', 5000000n],        // 5M units for trusted peer
 *     ['new-peer', 50000n]               // 50K units for new peer
 *   ]),
 *   perTokenThresholds: new Map([
 *     ['high-value-peer', new Map([
 *       ['BTC', 50n],                    // 50 satoshis threshold for BTC
 *       ['ETH', 500n]                    // 500 wei threshold for ETH
 *     ])]
 *   ])
 * };
 * ```
 */
export interface SettlementThresholdConfig {
  /**
   * Default settlement threshold for all peers
   * Applied when no per-peer or token-specific threshold is configured
   * Format: bigint (matches ILP packet amount type)
   * undefined = no threshold monitoring (disabled)
   *
   * Recommended: 80% of defaultLimit (if credit limits configured)
   * Example: defaultLimit = 1000000n → defaultThreshold = 800000n
   */
  defaultThreshold?: bigint;

  /**
   * Per-peer settlement threshold overrides
   * Key: peerId (from peer configuration)
   * Value: settlement threshold as bigint
   * Overrides defaultThreshold for specified peers
   *
   * Use case: Different thresholds based on peer trust level
   * Example: Higher thresholds for established, trusted peers
   */
  perPeerThresholds?: Map<string, bigint>;

  /**
   * Token-specific settlement thresholds per peer
   * Key: peerId (from peer configuration)
   * Value: Map of tokenId to settlement threshold
   * Highest priority in threshold hierarchy
   *
   * Use case: Different thresholds for different currencies/tokens
   * Example: Lower thresholds for volatile assets (BTC, ETH) vs stablecoins (USDC)
   */
  perTokenThresholds?: Map<string, Map<string, bigint>>;

  /**
   * Balance polling interval in milliseconds
   * Controls how frequently settlement monitor checks account balances
   * Default: 30000 (30 seconds)
   *
   * Trade-offs:
   * - Shorter intervals: Faster threshold detection, higher CPU usage, more TigerBeetle queries
   * - Longer intervals: Slower detection, lower overhead
   *
   * Polling overhead calculation example (10 peers, 1 token, 30s interval):
   * - 10 balance queries / 30 seconds = 0.33 queries/second
   * - Each query: ~1-5ms TigerBeetle latency
   * - Total overhead: <1% CPU usage
   */
  pollingInterval?: number;
}

/**
 * Settlement State Enum
 *
 * Tracks the settlement state for each peer-token pair.
 * State machine prevents duplicate settlement triggers and coordinates
 * with settlement API execution (Story 6.7).
 *
 * **State Transitions:**
 * - IDLE → SETTLEMENT_PENDING: Balance exceeds threshold (first crossing)
 * - SETTLEMENT_PENDING → SETTLEMENT_IN_PROGRESS: Settlement API starts execution
 * - SETTLEMENT_IN_PROGRESS → IDLE: Settlement completes and balance reduced
 * - SETTLEMENT_PENDING → IDLE: Balance drops below threshold naturally
 *
 * **Invalid Transitions (logged as warnings):**
 * - IDLE → SETTLEMENT_IN_PROGRESS: Must go through PENDING first
 * - SETTLEMENT_IN_PROGRESS → SETTLEMENT_PENDING: Cannot restart while in progress
 *
 * @example
 * ```typescript
 * const stateMap = new Map<string, SettlementState>();
 * const stateKey = `${peerId}:${tokenId}`;
 *
 * // Threshold crossed
 * stateMap.set(stateKey, SettlementState.SETTLEMENT_PENDING);
 *
 * // Settlement API starts execution
 * stateMap.set(stateKey, SettlementState.SETTLEMENT_IN_PROGRESS);
 *
 * // Settlement completes
 * stateMap.set(stateKey, SettlementState.IDLE);
 * ```
 */
export enum SettlementState {
  /**
   * IDLE: No settlement needed, balance below threshold
   * Default state for all peer-token pairs
   * Threshold detection active, ready to trigger if balance exceeds threshold
   */
  IDLE = 'IDLE',

  /**
   * SETTLEMENT_PENDING: Threshold crossed, settlement should be triggered soon
   * SETTLEMENT_REQUIRED event emitted, waiting for settlement API to start
   * Prevents duplicate threshold crossing events during polling cycles
   */
  SETTLEMENT_PENDING = 'SETTLEMENT_PENDING',

  /**
   * SETTLEMENT_IN_PROGRESS: Settlement API call in progress
   * Story 6.7 integration point: Settlement API marks state when executing
   * Prevents new settlement triggers while settlement is executing
   * Transitions to IDLE when settlement completes and balance reduced
   */
  SETTLEMENT_IN_PROGRESS = 'SETTLEMENT_IN_PROGRESS',
}

/**
 * Settlement Trigger Event Interface
 *
 * Event data emitted when a peer's balance exceeds settlement threshold.
 * Emitted by SettlementMonitor, consumed by SettlementAPI (Story 6.7)
 * and telemetry dashboard (Story 6.8).
 *
 * @property peerId - Peer requiring settlement
 * @property tokenId - Token type
 * @property currentBalance - Current account balance (peer's debt to us)
 * @property threshold - Configured threshold that was exceeded
 * @property exceedsBy - Amount over threshold
 * @property timestamp - When threshold was detected
 *
 * @example
 * ```typescript
 * const event: SettlementTriggerEvent = {
 *   peerId: 'connector-a',
 *   tokenId: 'ILP',
 *   currentBalance: 1200n,
 *   threshold: 1000n,
 *   exceedsBy: 200n,
 *   timestamp: new Date()
 * };
 *
 * // Story 6.7 SettlementAPI will listen:
 * settlementMonitor.on('SETTLEMENT_REQUIRED', async (event: SettlementTriggerEvent) => {
 *   await settlementAPI.executeMockSettlement(event.peerId, event.tokenId);
 * });
 * ```
 */
export interface SettlementTriggerEvent {
  /**
   * Peer ID requiring settlement
   * References peer.id from configuration
   * Identifies which peer has exceeded their settlement threshold
   */
  peerId: string;

  /**
   * Token type being settled
   * Examples: 'ILP' (default), 'USDC', 'BTC', 'ETH'
   * Used for token-specific threshold lookup and settlement execution
   */
  tokenId: string;

  /**
   * Current account balance (peer's debt to us)
   * Format: bigint (creditBalance from TigerBeetle account)
   * Represents accounts receivable from this peer
   * This is the balance that exceeded the threshold
   */
  currentBalance: bigint;

  /**
   * Configured settlement threshold that was exceeded
   * Format: bigint (effective threshold after hierarchy applied)
   * Could be default, per-peer, or token-specific threshold
   */
  threshold: bigint;

  /**
   * Amount over threshold
   * Calculation: currentBalance - threshold
   * Format: bigint
   * Used for logging/debugging and settlement prioritization (future)
   *
   * Example: currentBalance=1200n, threshold=1000n → exceedsBy=200n
   */
  exceedsBy: bigint;

  /**
   * Timestamp when threshold was detected
   * Used for settlement event chronology and audit trails
   * Enables tracking time between threshold detection and settlement completion
   */
  timestamp: Date;
}
