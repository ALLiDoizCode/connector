/**
 * Settlement Account Types and Interfaces
 *
 * This module defines the core types for TigerBeetle-based double-entry accounting
 * in the settlement layer. Each peer connection requires TWO accounts (duplex channel):
 * - DEBIT account: Tracks amounts peer owes us (accounts receivable)
 * - CREDIT account: Tracks amounts we owe peer (accounts payable)
 *
 * Example flow (Connector B in A→B→C topology):
 * - Receive packet from A (amount 1000): Debit A's debit account +1000
 * - Forward packet to C (amount 990): Credit C's credit account +990
 * - Net: B earned 10 as forwarding fee
 *
 * @module settlement/types
 */

import type { Logger } from 'pino';

/**
 * Canonical Admin API channel status values shared between agent-runtime and agent-society.
 * Named AdminChannelStatus to avoid collision with the on-chain ChannelStatus
 * ('opened' | 'closed' | 'settled') exported from @agent-runtime/shared.
 */
export type AdminChannelStatus = 'opening' | 'open' | 'closing' | 'closed' | 'settling' | 'settled';

const CANONICAL_STATUSES: readonly string[] = [
  'opening',
  'open',
  'closing',
  'closed',
  'settling',
  'settled',
];

/**
 * Normalize any channel status string to the canonical AdminChannelStatus.
 * Handles aliases from two sources:
 * - ChannelMetadata (internal): 'active' → 'open'
 * - PaymentChannelSDK (on-chain): 'opened' → 'open'
 */
export function normalizeChannelStatus(status: string, logger?: Logger): AdminChannelStatus {
  if (status === 'active' || status === 'opened') return 'open';
  if (CANONICAL_STATUSES.includes(status)) {
    return status as AdminChannelStatus;
  }
  logger?.warn({ status }, 'Unknown channel status, defaulting to opening');
  return 'opening';
}

/**
 * Account type enum defining the two sides of a double-entry account pair.
 *
 * In double-entry accounting, each peer connection has two accounts:
 * - DEBIT: Debited when we RECEIVE packets from peer (peer is sending value to us)
 * - CREDIT: Credited when we FORWARD packets to peer (we are sending value to peer)
 *
 * @example
 * // When peer A sends us a packet for 1000:
 * // We debit A's DEBIT account by 1000 (A owes us more)
 *
 * // When we forward a packet to peer C for 990:
 * // We credit C's CREDIT account by 990 (we owe C more)
 */
export enum AccountType {
  /**
   * Debit account - debited when receiving packets from peer.
   * Balance increases when peer sends packets through us.
   * Represents amount peer owes us (accounts receivable).
   */
  DEBIT = 'debit',

  /**
   * Credit account - credited when forwarding packets to peer.
   * Balance increases when we send packets to peer.
   * Represents amount we owe peer (accounts payable).
   */
  CREDIT = 'credit',
}

/**
 * Metadata associated with a TigerBeetle account for peer settlement.
 *
 * This metadata is encoded into TigerBeetle's user_data fields for:
 * - Future reverse lookups (account ID → peer/token information)
 * - Debugging and analytics
 * - Settlement engine integration
 *
 * Note: Metadata encoding uses one-way hashing, so reverse lookup
 * requires maintaining a separate mapping table (future enhancement).
 *
 * @interface PeerAccountMetadata
 */
export interface PeerAccountMetadata {
  /**
   * Our connector node ID (e.g., "connector-a").
   * Used to namespace account IDs for multi-node deployments.
   */
  nodeId: string;

  /**
   * Peer connector ID (e.g., "connector-b").
   * Identifies which peer this account tracks.
   */
  peerId: string;

  /**
   * Currency or token identifier (e.g., "USD", "ETH", "BTC").
   * Each peer-token combination requires a separate account pair.
   */
  tokenId: string;

  /**
   * Type of account (DEBIT or CREDIT).
   * Each peer-token pair has both a debit and credit account.
   */
  accountType: AccountType;
}

/**
 * A pair of TigerBeetle accounts (debit + credit) for a single peer-token combination.
 *
 * This represents the complete accounting state for one peer connection with one token.
 * Both account IDs are deterministically generated from the peer ID and token ID,
 * enabling idempotent account creation without database lookups.
 *
 * @interface PeerAccountPair
 * @example
 * const peerAccounts: PeerAccountPair = {
 *   debitAccountId: 123456789012345678901234567890n,
 *   creditAccountId: 987654321098765432109876543210n,
 *   peerId: 'connector-b',
 *   tokenId: 'USD'
 * };
 */
export interface PeerAccountPair {
  /**
   * TigerBeetle account ID for the debit account (peer owes us).
   * This is a 128-bit unsigned integer (bigint in TypeScript).
   */
  debitAccountId: bigint;

  /**
   * TigerBeetle account ID for the credit account (we owe peer).
   * This is a 128-bit unsigned integer (bigint in TypeScript).
   */
  creditAccountId: bigint;

  /**
   * Peer connector ID this account pair tracks.
   */
  peerId: string;

  /**
   * Token identifier this account pair tracks.
   */
  tokenId: string;
}

/**
 * TigerBeetle ledger and account code constants for ILP settlement.
 *
 * These constants define the ledger structure in TigerBeetle:
 * - Ledger: Groups related accounts (all ILP settlement uses ledger 1)
 * - Account Code: Categorizes accounts within a ledger (debit vs credit)
 *
 * Account codes enable:
 * - Balance sheet reporting (sum all debit accounts vs all credit accounts)
 * - Account type filtering in queries
 * - Future multi-ledger support (different tokens on different ledgers)
 *
 * @constant
 */
export const AccountLedgerCodes = {
  /**
   * Default ledger ID for all ILP settlement accounts.
   * Groups all peer settlement accounts together in TigerBeetle.
   * Future: May use different ledgers for different token types.
   */
  DEFAULT_LEDGER: 1,

  /**
   * Account code for peer debit accounts (accounts receivable).
   * All debit accounts use code 100 for consistent categorization.
   */
  ACCOUNT_CODE_PEER_DEBIT: 100,

  /**
   * Account code for peer credit accounts (accounts payable).
   * All credit accounts use code 200 for consistent categorization.
   */
  ACCOUNT_CODE_PEER_CREDIT: 200,
} as const;

/**
 * Balance information for a peer-token account pair.
 *
 * Returned by balance query methods to provide complete accounting view.
 *
 * @interface PeerAccountBalance
 * @example
 * const balance: PeerAccountBalance = {
 *   debitBalance: 5000n,   // Peer owes us 5000
 *   creditBalance: 3000n,  // We owe peer 3000
 *   netBalance: -2000n     // Net: peer owes us 2000 (needs to settle to us)
 * };
 */
export interface PeerAccountBalance {
  /**
   * Current debit account balance (peer owes us).
   * Calculated as: debits_posted - credits_posted
   */
  debitBalance: bigint;

  /**
   * Current credit account balance (we owe peer).
   * Calculated as: credits_posted - debits_posted
   */
  creditBalance: bigint;

  /**
   * Net balance (positive = we owe peer, negative = peer owes us).
   * Calculated as: creditBalance - debitBalance
   *
   * Interpretation:
   * - Positive: We need to settle TO peer
   * - Negative: Peer needs to settle TO us
   * - Zero: Balanced, no settlement needed
   */
  netBalance: bigint;
}

/**
 * Peer Configuration with Tri-Chain Settlement Preferences
 *
 * Extends base peer configuration with tri-chain settlement capabilities.
 * Connectors use this configuration to determine settlement method per peer.
 *
 * @interface PeerConfig
 * @example
 * const triChainPeer: PeerConfig = {
 *   peerId: 'peer-alice',
 *   address: 'g.alice',
 *   settlementPreference: 'any',
 *   settlementTokens: ['USDC', 'XRP', 'APT'],
 *   evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *   xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
 *   aptosAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
 *   aptosPubkey: 'abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
 * };
 */
export interface PeerConfig {
  /**
   * Unique peer identifier
   * Format: kebab-case string (e.g., 'peer-alice', 'peer-bob')
   */
  peerId: string;

  /**
   * Peer address (ILP address)
   * Format: ILP hierarchical address (e.g., 'g.alice', 'g.bob')
   */
  address: string;

  /**
   * Settlement preference for this peer
   * - 'evm': Only settle via EVM payment channels (Epic 8)
   * - 'xrp': Only settle via XRP payment channels (Epic 9)
   * - 'aptos': Only settle via Aptos payment channels (Epic 27)
   * - 'any': Support all methods (auto-select based on token)
   *
   * Note: 'both' is deprecated in favor of 'any' for tri-chain support
   */
  settlementPreference: 'evm' | 'xrp' | 'aptos' | 'any' | 'both';

  /**
   * Supported settlement tokens
   * Format: Array of token identifiers
   * - ERC20 tokens: Contract address (e.g., '0x...')
   * - XRP: Literal string 'XRP'
   * - APT: Literal string 'APT'
   * Example: ['USDC', 'XRP', 'APT', 'DAI']
   */
  settlementTokens: string[];

  /**
   * Optional: Ethereum address for EVM settlement
   * Required if settlementPreference is 'evm' or 'any' with EVM tokens
   * Format: Ethereum checksummed address (0x prefixed)
   */
  evmAddress?: string;

  /**
   * Optional: XRP Ledger address for XRP settlement
   * Required if settlementPreference is 'xrp' or 'any' with XRP token
   * Format: XRP Ledger r-address
   */
  xrpAddress?: string;

  /**
   * Optional: Aptos address for Aptos settlement
   * Required if settlementPreference is 'aptos' or 'any' with APT token
   * Format: 0x-prefixed 64-character hex (Aptos account address)
   */
  aptosAddress?: string;

  /**
   * Optional: Aptos public key for claim verification
   * Required if settlementPreference is 'aptos' or 'any' with APT token
   * Format: 64-character hex (ed25519 public key)
   */
  aptosPubkey?: string;

  /**
   * Optional: ERC20 token contract address for settlement
   * Format: 0x-prefixed 40-character hex (EVM address)
   * @example '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   */
  tokenAddress?: string;

  /**
   * Optional: TokenNetwork contract address for payment channels
   * Format: 0x-prefixed 40-character hex (EVM address)
   * @example '0x1234567890abcdef1234567890abcdef12345678'
   */
  tokenNetworkAddress?: string;

  /**
   * Optional: EVM chain ID (e.g., 8453 for Base, 84532 for Base Sepolia)
   * Must be a positive integer
   */
  chainId?: number;

  /**
   * Optional: Payment channel ID for claim exchange
   * Used to reference an existing payment channel between peers
   */
  channelId?: string;

  /**
   * Optional: Initial deposit amount for payment channel
   * Format: String representation of a non-negative integer (for bigint)
   * @example '1000000'
   */
  initialDeposit?: string;
}

/**
 * Settlement configuration request DTO for the Admin API
 *
 * Sent as part of the AddPeerRequest body to configure settlement
 * parameters for a peer at runtime via POST /admin/peers.
 *
 * @interface AdminSettlementConfig
 * @example
 * ```json
 * {
 *   "preference": "evm",
 *   "evmAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28",
 *   "tokenAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *   "chainId": 8453
 * }
 * ```
 */
export interface AdminSettlementConfig {
  /** Settlement method preference */
  preference: 'evm' | 'xrp' | 'aptos' | 'any';

  /** 0x-prefixed EVM address (42 chars) */
  evmAddress?: string;

  /** r-prefixed XRP address (25-35 chars) */
  xrpAddress?: string;

  /** 0x-prefixed Aptos address (66 chars) */
  aptosAddress?: string;

  /** Hex-encoded Ed25519 public key (64 chars) */
  aptosPubkey?: string;

  /** ERC20 token contract address (0x-prefixed, 42 chars) */
  tokenAddress?: string;

  /** TokenNetwork contract address (0x-prefixed, 42 chars) */
  tokenNetworkAddress?: string;

  /** EVM chain ID (positive integer) */
  chainId?: number;

  /** Existing payment channel ID */
  channelId?: string;

  /** Initial deposit amount (non-negative integer string) */
  initialDeposit?: string;
}

/** Regex pattern for valid EVM addresses (0x + 40 hex chars) */
const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/** Regex pattern for valid Aptos addresses (0x + 64 hex chars) */
const APTOS_ADDRESS_REGEX = /^0x[0-9a-fA-F]{64}$/;

/** Regex pattern for non-negative integer strings */
const NON_NEGATIVE_INTEGER_REGEX = /^\d+$/;

/**
 * Validate an EVM address format
 * @param address - Address to validate
 * @returns true if address matches 0x-prefixed 40-char hex pattern
 */
export function isValidEvmAddress(address: string): boolean {
  return EVM_ADDRESS_REGEX.test(address);
}

/**
 * Validate an XRP address format
 * @param address - Address to validate
 * @returns true if address starts with 'r' and is 25-35 characters
 */
export function isValidXrpAddress(address: string): boolean {
  return address.startsWith('r') && address.length >= 25 && address.length <= 35;
}

/**
 * Validate an Aptos address format
 * @param address - Address to validate
 * @returns true if address matches 0x-prefixed 64-char hex pattern
 */
export function isValidAptosAddress(address: string): boolean {
  return APTOS_ADDRESS_REGEX.test(address);
}

/**
 * Validate a non-negative integer string (for bigint amounts)
 * @param value - String to validate
 * @returns true if value is a non-negative integer string
 */
export function isValidNonNegativeIntegerString(value: string): boolean {
  return NON_NEGATIVE_INTEGER_REGEX.test(value);
}

/**
 * Settlement Required Event
 *
 * Emitted by SettlementMonitor when TigerBeetle account balance exceeds threshold.
 * UnifiedSettlementExecutor listens for this event and routes to appropriate settlement method.
 *
 * @interface SettlementRequiredEvent
 * @example
 * const event: SettlementRequiredEvent = {
 *   peerId: 'peer-alice',
 *   balance: '1000000000',
 *   tokenId: '0xUSDCAddress',
 *   timestamp: Date.now()
 * };
 */
export interface SettlementRequiredEvent {
  /**
   * Peer identifier (matches PeerConfig.peerId)
   */
  peerId: string;

  /**
   * Balance requiring settlement (drops or wei)
   * Format: String for bigint precision
   */
  balance: string;

  /**
   * Token identifier
   * - XRP: 'XRP'
   * - ERC20: Contract address (0x prefixed)
   */
  tokenId: string;

  /**
   * Timestamp of event emission
   */
  timestamp: number;
}

/**
 * XRP Payment Channel Claim
 *
 * Off-chain signed claim authorizing XRP transfer from payment channel.
 * Created by ClaimSigner, sent to peer for on-ledger submission.
 *
 * @interface XRPClaim
 * @example
 * const claim: XRPClaim = {
 *   channelId: 'A'.repeat(64),
 *   amount: '5000000000', // 5000 XRP in drops
 *   signature: 'B'.repeat(128),
 *   publicKey: 'ED' + 'C'.repeat(64)
 * };
 */
export interface XRPClaim {
  /**
   * Channel identifier (transaction hash from PaymentChannelCreate)
   * Format: 64-character hex string (256-bit hash)
   * Example: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
   */
  channelId: string;

  /**
   * Cumulative XRP amount to claim from channel (drops)
   * Format: String for bigint precision (1 XRP = 1,000,000 drops)
   * Must be greater than all previous claims (monotonically increasing)
   * Example: '5000000000' = 5000 XRP
   */
  amount: string;

  /**
   * ed25519 signature of claim message
   * Format: 128-character hex string (64-byte signature)
   * Signature covers: CLM\0 + channelId + amount (uint64 big-endian)
   * Generated by ClaimSigner using xrpl.js signPaymentChannelClaim()
   */
  signature: string;

  /**
   * ed25519 public key for signature verification
   * Format: 66-character hex string (ED prefix + 64 hex characters)
   * Must match the public key registered in PaymentChannelCreate transaction
   * Example: 'ED0123456789ABCDEF...'
   */
  publicKey: string;
}

/**
 * Unified Settlement Executor Configuration
 *
 * Configuration for tri-chain settlement routing.
 *
 * @interface UnifiedSettlementExecutorConfig
 * @example
 * const config: UnifiedSettlementExecutorConfig = {
 *   peers: new Map([
 *     ['peer-alice', {
 *       peerId: 'peer-alice',
 *       address: 'g.alice',
 *       settlementPreference: 'any',
 *       settlementTokens: ['USDC', 'XRP', 'APT'],
 *       evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
 *       xrpAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXEEW',
 *       aptosAddress: '0x1234...',
 *       aptosPubkey: 'abcd...'
 *     }]
 *   ]),
 *   defaultPreference: 'any',
 *   enabled: true
 * };
 */
export interface UnifiedSettlementExecutorConfig {
  /**
   * Peer configuration map
   * Key: peerId (string)
   * Value: PeerConfig with settlement preferences
   */
  peers: Map<string, PeerConfig>;

  /**
   * Default settlement preference (fallback)
   * Used when peer not found in peers map
   */
  defaultPreference: 'evm' | 'xrp' | 'aptos' | 'any' | 'both';

  /**
   * Enable settlement execution
   * Set to false to disable settlement (testing mode)
   */
  enabled: boolean;
}
