/**
 * ClaimStore - SQLite-backed storage for received payment channel claims
 * Epic 30 Story 30.3: Claim Store with SQLite Persistence
 *
 * This module provides persistent storage for verified balance proof claims
 * with chain-specific monotonic sequence tracking to prevent replay attacks.
 */

import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import type { Logger } from 'pino';
import type { SignedClaim, EVMSignedClaim, XRPSignedClaim, AptosSignedClaim } from '@m2m/shared';

// ============================================================================
// Database Schema (Task 1)
// ============================================================================

/**
 * Database schema for received_claims table
 *
 * Stores the latest verified claim per (peer_id, chain, channel_identifier).
 * UNIQUE constraint ensures only the most recent claim is stored.
 *
 * Monotonicity Enforcement:
 * - EVM: nonce must be strictly increasing
 * - XRP: amount must be strictly increasing (cumulative balance)
 * - Aptos: nonce must be strictly increasing
 */
const RECEIVED_CLAIMS_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS received_claims (
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
`;

/**
 * Indexes for efficient claim queries
 */
const RECEIVED_CLAIMS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_claims_peer_chain ON received_claims(peer_id, chain);',
  'CREATE INDEX IF NOT EXISTS idx_claims_settlement ON received_claims(chain, channel_identifier);',
];

// ============================================================================
// ClaimStore Class (Task 1)
// ============================================================================

/**
 * SQLite-backed claim storage with monotonic sequence enforcement
 */
export class ClaimStore {
  private db: Database.Database;
  private logger: Logger;

  /**
   * Initialize ClaimStore with SQLite database
   *
   * @param databasePath - Path to SQLite database file (default: data/claims/claims.db)
   * @param logger - Pino logger instance
   */
  constructor(databasePath: string = 'data/claims/claims.db', logger: Logger) {
    this.logger = logger;

    // Create parent directory if not exists
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    // Initialize database
    this.db = new Database(databasePath);

    // Create table and indexes
    this.db.exec(RECEIVED_CLAIMS_TABLE_SCHEMA);
    RECEIVED_CLAIMS_INDEXES.forEach((indexSQL) => this.db.exec(indexSQL));

    this.logger.info({ databasePath }, 'ClaimStore initialized');
  }

  /**
   * Close database connection
   * Idempotent (safe to call multiple times)
   */
  close(): void {
    if (this.db.open) {
      this.db.close();
      this.logger.info('ClaimStore database closed');
    }
  }

  /**
   * Delete all claims for a specific peer
   * Used for testing and peer removal scenarios
   *
   * @param peerId - Nostr pubkey of peer
   * @returns Number of claims deleted
   */
  deleteAllClaimsForPeer(peerId: string): number {
    const stmt = this.db.prepare('DELETE FROM received_claims WHERE peer_id = ?');
    const result = stmt.run(peerId);
    return result.changes;
  }

  /**
   * Get storage statistics
   * Used for monitoring and debugging
   *
   * @returns Statistics object with total claims and breakdown by chain
   */
  getStorageStats(): { totalClaims: number; claimsByChain: Record<string, number> } {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM received_claims').get() as {
      count: number;
    };

    const chainRows = this.db
      .prepare('SELECT chain, COUNT(*) as count FROM received_claims GROUP BY chain')
      .all() as Array<{ chain: string; count: number }>;

    const claimsByChain: Record<string, number> = {};
    chainRows.forEach((row) => {
      claimsByChain[row.chain] = row.count;
    });

    return {
      totalClaims: totalRow.count,
      claimsByChain,
    };
  }

  // ============================================================================
  // Chain-Specific Store Methods (Task 2)
  // ============================================================================

  /**
   * Store EVM claim with monotonic nonce enforcement
   *
   * @param peerId - Nostr pubkey of peer sending the claim
   * @param claim - EVM signed claim to store
   * @returns true if stored successfully, false if stale nonce or error
   */
  storeEVMClaim(peerId: string, claim: EVMSignedClaim): boolean {
    try {
      // Query existing claim nonce
      const existingRow = this.db
        .prepare(
          'SELECT sequence_value FROM received_claims WHERE peer_id = ? AND chain = ? AND channel_identifier = ?'
        )
        .get(peerId, 'evm', claim.channelId) as { sequence_value: number } | undefined;

      // Monotonic nonce check: reject if existing nonce >= new nonce
      if (existingRow && existingRow.sequence_value >= claim.nonce) {
        this.logger.info(
          {
            peerId,
            chain: 'evm',
            existingNonce: existingRow.sequence_value,
            newNonce: claim.nonce,
          },
          'Stale EVM nonce rejected'
        );
        return false;
      }

      // Build extra_data JSON for EVM-specific fields
      const extraData = JSON.stringify({
        lockedAmount: claim.lockedAmount.toString(),
        locksRoot: claim.locksRoot,
      });

      // INSERT OR REPLACE (UNIQUE constraint ensures latest claim stored)
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO received_claims (
          peer_id, chain, channel_identifier, sequence_value, amount, signature, signer_key, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        peerId,
        'evm',
        claim.channelId,
        claim.nonce,
        claim.transferredAmount.toString(),
        claim.signature,
        claim.signer,
        extraData
      );

      this.logger.info(
        { peerId, chain: 'evm', channelId: claim.channelId, nonce: claim.nonce },
        'EVM claim stored'
      );
      return true;
    } catch (error) {
      this.logger.error({ peerId, chain: 'evm', error }, 'Failed to store EVM claim');
      return false;
    }
  }

  /**
   * Store XRP claim with monotonic amount enforcement
   *
   * Note: XRP payment channels do NOT use nonces.
   * The amount field is cumulative and must increase monotonically.
   *
   * @param peerId - Nostr pubkey of peer sending the claim
   * @param claim - XRP signed claim to store
   * @returns true if stored successfully, false if stale amount or error
   */
  storeXRPClaim(peerId: string, claim: XRPSignedClaim): boolean {
    try {
      // Query existing claim amount
      const existingRow = this.db
        .prepare(
          'SELECT amount FROM received_claims WHERE peer_id = ? AND chain = ? AND channel_identifier = ?'
        )
        .get(peerId, 'xrp', claim.channelId) as { amount: string } | undefined;

      // Monotonic amount check: reject if existing amount >= new amount
      if (existingRow && BigInt(existingRow.amount) >= claim.amount) {
        this.logger.info(
          {
            peerId,
            chain: 'xrp',
            existingAmount: existingRow.amount,
            newAmount: claim.amount.toString(),
          },
          'Stale XRP amount rejected'
        );
        return false;
      }

      // INSERT OR REPLACE with sequence_value=NULL (XRP uses amount for monotonicity)
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO received_claims (
          peer_id, chain, channel_identifier, sequence_value, amount, signature, signer_key, extra_data
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)
      `);

      stmt.run(
        peerId,
        'xrp',
        claim.channelId,
        claim.amount.toString(),
        claim.signature,
        claim.signer
      );

      this.logger.info(
        { peerId, chain: 'xrp', channelId: claim.channelId, amount: claim.amount.toString() },
        'XRP claim stored'
      );
      return true;
    } catch (error) {
      this.logger.error({ peerId, chain: 'xrp', error }, 'Failed to store XRP claim');
      return false;
    }
  }

  /**
   * Store Aptos claim with monotonic nonce enforcement
   *
   * @param peerId - Nostr pubkey of peer sending the claim
   * @param claim - Aptos signed claim to store
   * @returns true if stored successfully, false if stale nonce or error
   */
  storeAptosClaim(peerId: string, claim: AptosSignedClaim): boolean {
    try {
      // Query existing claim nonce
      const existingRow = this.db
        .prepare(
          'SELECT sequence_value FROM received_claims WHERE peer_id = ? AND chain = ? AND channel_identifier = ?'
        )
        .get(peerId, 'aptos', claim.channelOwner) as { sequence_value: number } | undefined;

      // Monotonic nonce check: reject if existing nonce >= new nonce
      if (existingRow && existingRow.sequence_value >= claim.nonce) {
        this.logger.info(
          {
            peerId,
            chain: 'aptos',
            existingNonce: existingRow.sequence_value,
            newNonce: claim.nonce,
          },
          'Stale Aptos nonce rejected'
        );
        return false;
      }

      // INSERT OR REPLACE (channel_identifier = channelOwner for Aptos)
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO received_claims (
          peer_id, chain, channel_identifier, sequence_value, amount, signature, signer_key, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `);

      stmt.run(
        peerId,
        'aptos',
        claim.channelOwner,
        claim.nonce,
        claim.amount.toString(),
        claim.signature,
        claim.signer
      );

      this.logger.info(
        { peerId, chain: 'aptos', channelOwner: claim.channelOwner, nonce: claim.nonce },
        'Aptos claim stored'
      );
      return true;
    } catch (error) {
      this.logger.error({ peerId, chain: 'aptos', error }, 'Failed to store Aptos claim');
      return false;
    }
  }

  // ============================================================================
  // Claim Retrieval Methods (Task 3)
  // ============================================================================

  /**
   * Get latest claim for a specific peer, chain, and channel
   *
   * @param peerId - Nostr pubkey of peer
   * @param chain - Chain type ('evm', 'xrp', 'aptos')
   * @param channelId - Channel identifier
   * @returns SignedClaim or null if not found
   */
  getLatestClaim(peerId: string, chain: string, channelId: string): SignedClaim | null {
    try {
      const row = this.db
        .prepare(
          'SELECT * FROM received_claims WHERE peer_id = ? AND chain = ? AND channel_identifier = ?'
        )
        .get(peerId, chain, channelId) as
        | {
            chain: string;
            channel_identifier: string;
            sequence_value: number | null;
            amount: string;
            signature: string;
            signer_key: string;
            extra_data: string | null;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return this.parseRowToClaim(row);
    } catch (error) {
      this.logger.error({ peerId, chain, channelId, error }, 'Failed to retrieve latest claim');
      return null;
    }
  }

  /**
   * Get all claims for a specific peer and chain
   * Used by settlement executor to retrieve claims for on-chain submission
   *
   * @param peerId - Nostr pubkey of peer
   * @param chain - Chain type ('evm', 'xrp', 'aptos')
   * @returns Array of SignedClaims (empty array if none found)
   */
  getClaimsForSettlement(peerId: string, chain: string): SignedClaim[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM received_claims WHERE peer_id = ? AND chain = ?')
        .all(peerId, chain) as Array<{
        chain: string;
        channel_identifier: string;
        sequence_value: number | null;
        amount: string;
        signature: string;
        signer_key: string;
        extra_data: string | null;
      }>;

      return rows.map((row) => this.parseRowToClaim(row));
    } catch (error) {
      this.logger.error({ peerId, chain, error }, 'Failed to retrieve claims for settlement');
      return [];
    }
  }

  /**
   * Get all claims for a specific peer across all chains
   * Used for multi-chain settlement scenarios
   *
   * @param peerId - Nostr pubkey of peer
   * @returns Map of chain type to array of SignedClaims
   */
  getAllClaimsByPeer(peerId: string): Map<string, SignedClaim[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM received_claims WHERE peer_id = ?')
        .all(peerId) as Array<{
        chain: string;
        channel_identifier: string;
        sequence_value: number | null;
        amount: string;
        signature: string;
        signer_key: string;
        extra_data: string | null;
      }>;

      // Group by chain
      const claimsByChain = new Map<string, SignedClaim[]>();
      rows.forEach((row) => {
        const claim = this.parseRowToClaim(row);
        const existing = claimsByChain.get(row.chain) || [];
        existing.push(claim);
        claimsByChain.set(row.chain, existing);
      });

      return claimsByChain;
    } catch (error) {
      this.logger.error({ peerId, error }, 'Failed to retrieve all claims by peer');
      return new Map();
    }
  }

  /**
   * Parse database row into typed SignedClaim based on chain discriminator
   *
   * @param row - Database row from received_claims table
   * @returns Typed SignedClaim (EVM, XRP, or Aptos)
   */
  /**
   * Get total count of stored claims
   *
   * @returns Total number of claims stored
   */
  getClaimCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM received_claims').get() as {
      count: number;
    };
    return result.count;
  }

  /**
   * Get timestamp of most recently received claim
   *
   * @returns Unix timestamp of last claim, or null if no claims stored
   */
  getLastClaimTimestamp(): number | null {
    const result = this.db
      .prepare('SELECT MAX(created_at) as last_timestamp FROM received_claims')
      .get() as { last_timestamp: number | null };
    return result.last_timestamp;
  }

  private parseRowToClaim(row: {
    chain: string;
    channel_identifier: string;
    sequence_value: number | null;
    amount: string;
    signature: string;
    signer_key: string;
    extra_data: string | null;
  }): SignedClaim {
    switch (row.chain) {
      case 'evm': {
        const extraData = row.extra_data ? JSON.parse(row.extra_data) : {};
        return {
          chain: 'evm',
          channelId: row.channel_identifier,
          transferredAmount: BigInt(row.amount),
          nonce: row.sequence_value!,
          lockedAmount: BigInt(extraData.lockedAmount || '0'),
          locksRoot:
            extraData.locksRoot ||
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          signature: row.signature,
          signer: row.signer_key,
        };
      }

      case 'xrp':
        return {
          chain: 'xrp',
          channelId: row.channel_identifier,
          amount: BigInt(row.amount),
          signature: row.signature,
          signer: row.signer_key,
        };

      case 'aptos':
        return {
          chain: 'aptos',
          channelOwner: row.channel_identifier,
          amount: BigInt(row.amount),
          nonce: row.sequence_value!,
          signature: row.signature,
          signer: row.signer_key,
        };

      default:
        throw new Error(`Unknown chain type: ${row.chain}`);
    }
  }
}
