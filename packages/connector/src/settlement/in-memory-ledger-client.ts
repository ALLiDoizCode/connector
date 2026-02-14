/**
 * In-Memory Ledger Client
 *
 * A pure TypeScript in-memory ledger that implements the same interface as TigerBeetleClient.
 * Provides balance tracking, transfer processing, and periodic disk persistence via JSON snapshots.
 * Zero runtime dependency on tigerbeetle-node — only uses Node.js built-ins and pino.
 *
 * @see packages/connector/src/settlement/tigerbeetle-client.ts for the interface contract
 */

import { Logger } from 'pino';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ILedgerClient } from './ledger-client';
import {
  TigerBeetleConnectionError,
  TigerBeetleAccountError,
  TigerBeetleTransferError,
} from './tigerbeetle-errors';

// Re-export AccountBalance from the canonical source
export type { AccountBalance } from './tigerbeetle-client';
import type { AccountBalance } from './tigerbeetle-client';

/**
 * Minimal Transfer interface covering the fields used by the in-memory ledger.
 * Structurally compatible with the full tigerbeetle-node Transfer type.
 */
export interface InMemoryTransfer {
  id: bigint;
  debit_account_id: bigint;
  credit_account_id: bigint;
  amount: bigint;
  [key: string]: unknown;
}

/**
 * Internal account representation
 */
interface InMemoryAccount {
  debits_posted: bigint;
  credits_posted: bigint;
}

/**
 * Configuration for InMemoryLedgerClient
 */
export interface InMemoryLedgerConfig {
  /** Path to the snapshot file for persistence */
  snapshotPath: string;
  /** Interval in ms between persistence flushes (default: 30000) */
  persistIntervalMs?: number;
}

/** Default persistence interval: 30 seconds */
const DEFAULT_PERSIST_INTERVAL_MS = 30_000;

/**
 * In-Memory Ledger Client
 *
 * Drop-in replacement for TigerBeetleClient that stores all account/transfer data
 * in memory with periodic JSON snapshot persistence to disk.
 */
export class InMemoryLedgerClient implements ILedgerClient {
  private _accounts: Map<bigint, InMemoryAccount> = new Map();
  private _dirty = false;
  private _persistTimer: ReturnType<typeof setInterval> | null = null;
  private _initialized = false;
  private readonly _snapshotPath: string;
  private readonly _persistIntervalMs: number;

  constructor(
    config: InMemoryLedgerConfig,
    private readonly _logger: Logger
  ) {
    this._snapshotPath = config.snapshotPath;
    this._persistIntervalMs = config.persistIntervalMs ?? DEFAULT_PERSIST_INTERVAL_MS;
  }

  /**
   * Initialize the ledger: restore from snapshot if available, start persistence timer.
   * Double-call is a no-op (prevents duplicate timers).
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      this._logger.warn('InMemoryLedgerClient already initialized, skipping');
      return;
    }

    this._logger.info(
      { snapshotPath: this._snapshotPath, persistIntervalMs: this._persistIntervalMs },
      'Initializing InMemoryLedgerClient'
    );

    // Ensure snapshot directory exists
    await fs.mkdir(path.dirname(this._snapshotPath), { recursive: true });

    await this._restoreSnapshot();

    this._persistTimer = setInterval(() => {
      this._persistSnapshot().catch((err) => {
        this._logger.error({ err }, 'Unexpected error in persistence timer callback');
      });
    }, this._persistIntervalMs);

    // Prevent the timer from keeping the process alive
    if (this._persistTimer.unref) {
      this._persistTimer.unref();
    }

    this._initialized = true;

    this._logger.info({ accountCount: this._accounts.size }, 'InMemoryLedgerClient initialized');
  }

  /**
   * Close the ledger: persist final snapshot if dirty, clear timer.
   */
  async close(): Promise<void> {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }

    await this._persistSnapshot();

    this._initialized = false;
    this._logger.info('InMemoryLedgerClient closed');
  }

  /**
   * Create accounts in batch. Idempotent — existing account IDs are silently skipped.
   */
  async createAccountsBatch(
    accounts: Array<{ id: bigint; ledger: number; code: number; flags?: number }>
  ): Promise<void> {
    this._ensureInitialized();

    let created = 0;
    for (const spec of accounts) {
      if (!this._accounts.has(spec.id)) {
        this._accounts.set(spec.id, { debits_posted: 0n, credits_posted: 0n });
        created++;
      }
    }

    if (created > 0) {
      this._dirty = true;
      this._logger.debug(
        { created, total: accounts.length },
        'Accounts created in in-memory ledger'
      );
    }
  }

  /**
   * Create transfers in batch. Validates accounts exist and amounts are positive.
   * Updates debit/credit balances atomically per transfer.
   */
  async createTransfersBatch(transfers: InMemoryTransfer[]): Promise<void> {
    this._ensureInitialized();

    // Validate all transfers before applying any
    for (const transfer of transfers) {
      if (transfer.amount <= 0n) {
        throw new TigerBeetleTransferError(
          `Transfer amount must be positive, got ${transfer.amount}`,
          transfer.id,
          transfer.debit_account_id,
          transfer.credit_account_id
        );
      }
      if (!this._accounts.has(transfer.debit_account_id)) {
        throw new TigerBeetleTransferError(
          `Debit account not found: ${transfer.debit_account_id}`,
          transfer.id,
          transfer.debit_account_id,
          transfer.credit_account_id
        );
      }
      if (!this._accounts.has(transfer.credit_account_id)) {
        throw new TigerBeetleTransferError(
          `Credit account not found: ${transfer.credit_account_id}`,
          transfer.id,
          transfer.debit_account_id,
          transfer.credit_account_id
        );
      }
    }

    // Apply all transfers
    for (const transfer of transfers) {
      const debitAccount = this._accounts.get(transfer.debit_account_id)!;
      const creditAccount = this._accounts.get(transfer.credit_account_id)!;
      debitAccount.debits_posted += transfer.amount;
      creditAccount.credits_posted += transfer.amount;
    }

    this._dirty = true;
    this._logger.debug(
      { transferCount: transfers.length },
      'Transfers applied in in-memory ledger'
    );
  }

  /**
   * Get balance for a single account.
   * @throws TigerBeetleAccountError if account not found
   */
  async getAccountBalance(accountId: bigint): Promise<AccountBalance> {
    this._ensureInitialized();

    const account = this._accounts.get(accountId);
    if (!account) {
      throw new TigerBeetleAccountError(`Account not found: ${accountId}`, accountId);
    }

    return {
      debits: account.debits_posted,
      credits: account.credits_posted,
      balance: account.credits_posted - account.debits_posted,
    };
  }

  /**
   * Get balances for multiple accounts. Missing accounts are silently skipped.
   */
  async getAccountsBatch(accountIds: bigint[]): Promise<Map<bigint, AccountBalance>> {
    this._ensureInitialized();

    const balances = new Map<bigint, AccountBalance>();
    for (const id of accountIds) {
      const account = this._accounts.get(id);
      if (account) {
        balances.set(id, {
          debits: account.debits_posted,
          credits: account.credits_posted,
          balance: account.credits_posted - account.debits_posted,
        });
      }
    }

    return balances;
  }

  /**
   * Persist snapshot to disk if dirty. Uses write-rename pattern for atomicity.
   * On failure: logs error, keeps dirty flag true for retry. Does NOT throw.
   */
  private async _persistSnapshot(): Promise<void> {
    if (!this._dirty) {
      return;
    }

    const tmpPath = `${this._snapshotPath}.tmp`;

    try {
      const snapshot: Array<[string, { debits_posted: string; credits_posted: string }]> = [];
      for (const [id, account] of this._accounts) {
        snapshot.push([
          id.toString(),
          {
            debits_posted: account.debits_posted.toString(),
            credits_posted: account.credits_posted.toString(),
          },
        ]);
      }

      await fs.writeFile(tmpPath, JSON.stringify(snapshot), 'utf-8');
      await fs.rename(tmpPath, this._snapshotPath);
      this._dirty = false;

      this._logger.debug(
        { accountCount: this._accounts.size, path: this._snapshotPath },
        'Snapshot persisted'
      );
    } catch (err) {
      this._logger.error(
        { err, path: this._snapshotPath },
        'Failed to persist snapshot, will retry on next interval'
      );
      // Keep _dirty = true so next interval retries
    }
  }

  /**
   * Restore state from snapshot file if it exists.
   * If only .tmp file exists (crashed mid-write), logs warning and starts fresh.
   */
  private async _restoreSnapshot(): Promise<void> {
    try {
      await fs.access(this._snapshotPath);
    } catch {
      // Main file does not exist — check for orphaned .tmp
      const tmpPath = `${this._snapshotPath}.tmp`;
      try {
        await fs.access(tmpPath);
        this._logger.warn(
          { tmpPath },
          'Found orphaned .tmp snapshot without main file, starting fresh'
        );
      } catch {
        // Neither file exists — fresh start
      }
      this._logger.info('No existing snapshot found, starting with empty ledger');
      return;
    }

    try {
      const data = await fs.readFile(this._snapshotPath, 'utf-8');
      const entries: Array<[string, { debits_posted: string; credits_posted: string }]> =
        JSON.parse(data);

      this._accounts = new Map();
      for (const [idStr, balances] of entries) {
        this._accounts.set(BigInt(idStr), {
          debits_posted: BigInt(balances.debits_posted),
          credits_posted: BigInt(balances.credits_posted),
        });
      }

      this._logger.info(
        { accountCount: this._accounts.size, path: this._snapshotPath },
        'Snapshot restored'
      );
    } catch (err) {
      this._logger.error(
        { err, path: this._snapshotPath },
        'Failed to restore snapshot, starting with empty ledger'
      );
      this._accounts = new Map();
    }
  }

  /**
   * Guard: throw if not initialized.
   * Mirrors TigerBeetleClient.ensureConnected() behavior.
   */
  private _ensureInitialized(): void {
    if (!this._initialized) {
      throw new TigerBeetleConnectionError(
        'InMemoryLedgerClient not initialized. Call initialize() first.'
      );
    }
  }
}
