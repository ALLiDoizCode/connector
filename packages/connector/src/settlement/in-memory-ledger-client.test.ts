/**
 * Unit tests for InMemoryLedgerClient
 *
 * Covers: account creation, transfers, balance queries, persistence,
 * initialization guard, and lifecycle management.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import pino from 'pino';
import { InMemoryLedgerClient } from './in-memory-ledger-client';
import {
  TigerBeetleConnectionError,
  TigerBeetleAccountError,
  TigerBeetleTransferError,
} from './tigerbeetle-errors';

const logger = pino({ level: 'silent' });

function tmpSnapshotPath(): string {
  return path.join(os.tmpdir(), `iml-test-${crypto.randomUUID()}.json`);
}

async function cleanupFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
  try {
    await fs.unlink(`${filePath}.tmp`);
  } catch {
    // ignore
  }
}

function makeClient(snapshotPath: string, persistIntervalMs = 60_000): InMemoryLedgerClient {
  return new InMemoryLedgerClient({ snapshotPath, persistIntervalMs }, logger);
}

function makeTransfer(
  id: bigint,
  debitAccountId: bigint,
  creditAccountId: bigint,
  amount: bigint
): { id: bigint; debit_account_id: bigint; credit_account_id: bigint; amount: bigint } {
  return { id, debit_account_id: debitAccountId, credit_account_id: creditAccountId, amount };
}

describe('InMemoryLedgerClient', () => {
  let snapshotPath: string;
  let client: InMemoryLedgerClient;

  beforeEach(async () => {
    snapshotPath = tmpSnapshotPath();
    client = makeClient(snapshotPath);
    await client.initialize();
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      // client may already be closed
    }
    await cleanupFile(snapshotPath);
  });

  // ───────────────────────────────────────────
  // Account Creation Tests
  // ───────────────────────────────────────────

  describe('createAccountsBatch', () => {
    it('should create a single account', async () => {
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);
      const balance = await client.getAccountBalance(1n);
      expect(balance).toEqual({ debits: 0n, credits: 0n, balance: 0n });
    });

    it('should create multiple accounts in a batch', async () => {
      await client.createAccountsBatch([
        { id: 1n, ledger: 1, code: 1 },
        { id: 2n, ledger: 1, code: 1 },
        { id: 3n, ledger: 1, code: 2 },
      ]);

      const balances = await client.getAccountsBatch([1n, 2n, 3n]);
      expect(balances.size).toBe(3);
    });

    it('should be idempotent — duplicate ID is a no-op', async () => {
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);

      // Create a transfer to give account 1 some balance
      await client.createAccountsBatch([{ id: 2n, ledger: 1, code: 1 }]);
      await client.createTransfersBatch([makeTransfer(1n, 2n, 1n, 100n)]);

      // Re-create account 1 — should NOT reset balance
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);

      const balance = await client.getAccountBalance(1n);
      expect(balance.credits).toBe(100n);
    });

    it('should set dirty flag after creating new accounts', async () => {
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);
      await client.close();

      // If dirty flag was set, snapshot file should exist
      const data = await fs.readFile(snapshotPath, 'utf-8');
      const entries = JSON.parse(data);
      expect(entries.length).toBe(1);
    });
  });

  // ───────────────────────────────────────────
  // Transfer Tests
  // ───────────────────────────────────────────

  describe('createTransfersBatch', () => {
    beforeEach(async () => {
      await client.createAccountsBatch([
        { id: 10n, ledger: 1, code: 1 },
        { id: 20n, ledger: 1, code: 1 },
      ]);
    });

    it('should apply a valid transfer — debit and credit updated', async () => {
      await client.createTransfersBatch([makeTransfer(1n, 10n, 20n, 500n)]);

      const debit = await client.getAccountBalance(10n);
      const credit = await client.getAccountBalance(20n);

      expect(debit.debits).toBe(500n);
      expect(debit.credits).toBe(0n);
      expect(debit.balance).toBe(-500n);

      expect(credit.debits).toBe(0n);
      expect(credit.credits).toBe(500n);
      expect(credit.balance).toBe(500n);
    });

    it('should throw TigerBeetleTransferError for non-existent debit account', async () => {
      await expect(
        client.createTransfersBatch([makeTransfer(1n, 999n, 20n, 100n)])
      ).rejects.toThrow(TigerBeetleTransferError);
    });

    it('should throw TigerBeetleTransferError for non-existent credit account', async () => {
      await expect(
        client.createTransfersBatch([makeTransfer(1n, 10n, 999n, 100n)])
      ).rejects.toThrow(TigerBeetleTransferError);
    });

    it('should throw TigerBeetleTransferError for zero amount', async () => {
      await expect(client.createTransfersBatch([makeTransfer(1n, 10n, 20n, 0n)])).rejects.toThrow(
        TigerBeetleTransferError
      );
    });

    it('should throw TigerBeetleTransferError for negative amount', async () => {
      await expect(client.createTransfersBatch([makeTransfer(1n, 10n, 20n, -5n)])).rejects.toThrow(
        TigerBeetleTransferError
      );
    });

    it('should apply multiple transfers in a single batch', async () => {
      await client.createTransfersBatch([
        makeTransfer(1n, 10n, 20n, 100n),
        makeTransfer(2n, 10n, 20n, 200n),
        makeTransfer(3n, 20n, 10n, 50n),
      ]);

      const acc10 = await client.getAccountBalance(10n);
      const acc20 = await client.getAccountBalance(20n);

      // Account 10: debited 100+200=300, credited 50
      expect(acc10.debits).toBe(300n);
      expect(acc10.credits).toBe(50n);
      expect(acc10.balance).toBe(-250n);

      // Account 20: debited 50, credited 100+200=300
      expect(acc20.debits).toBe(50n);
      expect(acc20.credits).toBe(300n);
      expect(acc20.balance).toBe(250n);
    });

    it('should not apply any transfers if validation fails mid-batch', async () => {
      // Second transfer references non-existent account
      await expect(
        client.createTransfersBatch([
          makeTransfer(1n, 10n, 20n, 100n),
          makeTransfer(2n, 10n, 999n, 200n),
        ])
      ).rejects.toThrow(TigerBeetleTransferError);

      // First transfer should NOT have been applied (validate-all-first)
      const acc10 = await client.getAccountBalance(10n);
      expect(acc10.debits).toBe(0n);
    });
  });

  // ───────────────────────────────────────────
  // Balance Query Tests
  // ───────────────────────────────────────────

  describe('getAccountBalance', () => {
    it('should return correct balance after transfers', async () => {
      await client.createAccountsBatch([
        { id: 1n, ledger: 1, code: 1 },
        { id: 2n, ledger: 1, code: 1 },
      ]);
      await client.createTransfersBatch([makeTransfer(1n, 1n, 2n, 1000n)]);

      const balance = await client.getAccountBalance(2n);
      expect(balance).toEqual({ debits: 0n, credits: 1000n, balance: 1000n });
    });

    it('should throw TigerBeetleAccountError for non-existent account', async () => {
      await expect(client.getAccountBalance(999n)).rejects.toThrow(TigerBeetleAccountError);
    });

    it('should compute balance as credits - debits', async () => {
      await client.createAccountsBatch([
        { id: 1n, ledger: 1, code: 1 },
        { id: 2n, ledger: 1, code: 1 },
      ]);
      await client.createTransfersBatch([
        makeTransfer(1n, 1n, 2n, 300n),
        makeTransfer(2n, 2n, 1n, 100n),
      ]);

      const balance = await client.getAccountBalance(1n);
      expect(balance.debits).toBe(300n);
      expect(balance.credits).toBe(100n);
      expect(balance.balance).toBe(-200n);
    });
  });

  describe('getAccountsBatch', () => {
    it('should return Map of found accounts, skipping missing', async () => {
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);

      const balances = await client.getAccountsBatch([1n, 999n]);
      expect(balances.size).toBe(1);
      expect(balances.has(1n)).toBe(true);
      expect(balances.has(999n)).toBe(false);
    });
  });

  // ───────────────────────────────────────────
  // Persistence Tests
  // ───────────────────────────────────────────

  describe('persistence', () => {
    it('should write snapshot file with correct format', async () => {
      await client.createAccountsBatch([
        { id: 100n, ledger: 1, code: 1 },
        { id: 200n, ledger: 1, code: 1 },
      ]);
      await client.createTransfersBatch([makeTransfer(1n, 100n, 200n, 50n)]);
      await client.close();

      const data = await fs.readFile(snapshotPath, 'utf-8');
      const entries: Array<[string, { debits_posted: string; credits_posted: string }]> =
        JSON.parse(data);

      expect(entries.length).toBe(2);

      // Verify string serialization format
      for (const [idStr, balances] of entries) {
        expect(typeof idStr).toBe('string');
        expect(typeof balances.debits_posted).toBe('string');
        expect(typeof balances.credits_posted).toBe('string');
      }
    });

    it('should restore state from existing snapshot on initialize', async () => {
      // Setup: create accounts, transfer, close
      await client.createAccountsBatch([
        { id: 1n, ledger: 1, code: 1 },
        { id: 2n, ledger: 1, code: 1 },
      ]);
      await client.createTransfersBatch([makeTransfer(1n, 1n, 2n, 750n)]);
      await client.close();

      // New instance should restore
      const client2 = makeClient(snapshotPath);
      await client2.initialize();

      const balance = await client2.getAccountBalance(2n);
      expect(balance.credits).toBe(750n);
      expect(balance.balance).toBe(750n);

      await client2.close();
    });

    it('should not write snapshot when not dirty', async () => {
      // Initialize with no changes — close should not create a snapshot file
      await client.close();

      let exists = true;
      try {
        await fs.access(snapshotPath);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    it('should clean up .tmp file after successful write', async () => {
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);
      await client.close();

      let tmpExists = true;
      try {
        await fs.access(`${snapshotPath}.tmp`);
      } catch {
        tmpExists = false;
      }
      expect(tmpExists).toBe(false);
    });

    it('should start fresh when no snapshot exists', async () => {
      const freshPath = tmpSnapshotPath();
      const freshClient = makeClient(freshPath);
      await freshClient.initialize();

      const balances = await freshClient.getAccountsBatch([1n]);
      expect(balances.size).toBe(0);

      await freshClient.close();
      await cleanupFile(freshPath);
    });

    it('should persist final state on close', async () => {
      await client.createAccountsBatch([
        { id: 1n, ledger: 1, code: 1 },
        { id: 2n, ledger: 1, code: 1 },
      ]);
      await client.createTransfersBatch([makeTransfer(1n, 1n, 2n, 333n)]);
      await client.close();

      // Verify file has content
      const data = await fs.readFile(snapshotPath, 'utf-8');
      const entries = JSON.parse(data);
      expect(entries.length).toBe(2);
    });

    it('should handle persistence error gracefully (keeps dirty flag)', async () => {
      // Use a path inside a non-existent deeply nested directory that we'll block
      const badPath = path.join(
        os.tmpdir(),
        `iml-test-${crypto.randomUUID()}`,
        'nested',
        'snapshot.json'
      );
      const badClient = makeClient(badPath);
      await badClient.initialize();
      await badClient.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);

      // Make the directory read-only to cause write failure
      const dir = path.dirname(badPath);
      await fs.chmod(dir, 0o444);

      // close() calls _persistSnapshot which should not throw
      // but should keep dirty = true (we can't check the private field directly,
      // but we verify close() doesn't throw)
      try {
        await badClient.close();
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(dir, 0o755);
        await fs.rm(path.join(os.tmpdir(), path.basename(path.dirname(dir))), {
          recursive: true,
          force: true,
        });
      }
    });
  });

  // ───────────────────────────────────────────
  // Initialization Guard Tests
  // ───────────────────────────────────────────

  describe('initialization guard', () => {
    let uninitClient: InMemoryLedgerClient;

    beforeEach(() => {
      uninitClient = makeClient(tmpSnapshotPath());
      // Deliberately NOT calling initialize()
    });

    it('createAccountsBatch throws TigerBeetleConnectionError before initialize()', async () => {
      await expect(
        uninitClient.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }])
      ).rejects.toThrow(TigerBeetleConnectionError);
    });

    it('createTransfersBatch throws TigerBeetleConnectionError before initialize()', async () => {
      await expect(
        uninitClient.createTransfersBatch([makeTransfer(1n, 1n, 2n, 100n)])
      ).rejects.toThrow(TigerBeetleConnectionError);
    });

    it('getAccountBalance throws TigerBeetleConnectionError before initialize()', async () => {
      await expect(uninitClient.getAccountBalance(1n)).rejects.toThrow(TigerBeetleConnectionError);
    });

    it('getAccountsBatch throws TigerBeetleConnectionError before initialize()', async () => {
      await expect(uninitClient.getAccountsBatch([1n])).rejects.toThrow(TigerBeetleConnectionError);
    });
  });

  // ───────────────────────────────────────────
  // Lifecycle Tests
  // ───────────────────────────────────────────

  describe('lifecycle', () => {
    it('should round-trip: init → create → close → new init → verify', async () => {
      await client.createAccountsBatch([
        { id: 1n, ledger: 1, code: 1 },
        { id: 2n, ledger: 1, code: 1 },
      ]);
      await client.createTransfersBatch([makeTransfer(1n, 1n, 2n, 500n)]);
      await client.close();

      const client2 = makeClient(snapshotPath);
      await client2.initialize();

      const acc1 = await client2.getAccountBalance(1n);
      const acc2 = await client2.getAccountBalance(2n);
      expect(acc1.debits).toBe(500n);
      expect(acc2.credits).toBe(500n);

      await client2.close();
    });

    it('double initialize() is a no-op', async () => {
      // client is already initialized in beforeEach
      // Second call should not throw and not create duplicate timers
      await client.initialize();

      // Verify still works normally
      await client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }]);
      const balance = await client.getAccountBalance(1n);
      expect(balance.balance).toBe(0n);
    });

    it('close clears persistence timer', async () => {
      await client.close();
      // After close, _initialized is false — further ops should throw
      await expect(client.createAccountsBatch([{ id: 1n, ledger: 1, code: 1 }])).rejects.toThrow(
        TigerBeetleConnectionError
      );
    });
  });
});
