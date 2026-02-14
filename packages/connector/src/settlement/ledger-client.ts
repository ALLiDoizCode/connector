/**
 * Common interface for accounting ledger backends.
 *
 * Implemented by TigerBeetleClient (high-performance external DB) and
 * InMemoryLedgerClient (zero-dependency default).
 *
 * @module settlement/ledger-client
 */

import type { AccountBalance } from './tigerbeetle-client';

// Re-export AccountBalance so consumers can import from this file
export type { AccountBalance } from './tigerbeetle-client';

/**
 * Common interface for accounting ledger backends.
 * Implemented by TigerBeetleClient and InMemoryLedgerClient.
 */
export interface ILedgerClient {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createAccountsBatch(
    accounts: Array<{ id: bigint; ledger: number; code: number; flags?: number }>
  ): Promise<void>;
  createTransfersBatch(
    transfers: Array<{
      id: bigint;
      debit_account_id: bigint;
      credit_account_id: bigint;
      amount: bigint;
      [key: string]: unknown;
    }>
  ): Promise<void>;
  getAccountBalance(accountId: bigint): Promise<AccountBalance>;
  getAccountsBatch(accountIds: bigint[]): Promise<Map<bigint, AccountBalance>>;
}
