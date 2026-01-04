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
