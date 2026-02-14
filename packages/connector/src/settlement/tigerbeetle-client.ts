/**
 * TigerBeetle Client Wrapper
 *
 * Provides a type-safe TypeScript interface to the TigerBeetle accounting database,
 * with error handling, structured logging, and timeout support.
 *
 * TigerBeetle is a high-performance distributed accounting database that provides
 * ACID guarantees for double-entry bookkeeping operations.
 *
 * @see https://docs.tigerbeetle.com/
 */

import type {
  Client,
  Account,
  Transfer,
  CreateAccountError,
  CreateTransferError,
} from 'tigerbeetle-node';
import { Logger } from 'pino';
import { requireOptional } from '../utils/optional-require';
import type { ILedgerClient } from './ledger-client';
import {
  TigerBeetleError,
  TigerBeetleConnectionError,
  TigerBeetleAccountError,
  TigerBeetleTransferError,
  TigerBeetleTimeoutError,
} from './tigerbeetle-errors';

/**
 * Configuration for TigerBeetle client initialization
 */
export interface TigerBeetleConfig {
  /**
   * Immutable cluster identifier (must match TigerBeetle server initialization)
   * Default: 0 (development cluster)
   */
  clusterId: number;

  /**
   * Array of replica addresses in format "host:port"
   * Example: ["tigerbeetle:3000"] for Docker network hostname
   * Example: ["localhost:3000"] for local testing
   */
  replicaAddresses: string[];

  /**
   * Connection timeout in milliseconds
   * Default: 5000ms
   */
  connectionTimeout?: number;

  /**
   * Operation timeout in milliseconds
   * Recommended: 5000ms for development, 10000ms for production multi-replica clusters
   * Default: 10000ms (production-safe default)
   */
  operationTimeout?: number;
}

/**
 * Account balance result with debits, credits, and net balance
 */
export interface AccountBalance {
  debits: bigint;
  credits: bigint;
  balance: bigint; // Net balance: credits - debits
}

/**
 * TigerBeetle Client
 *
 * Wraps the official tigerbeetle-node client library to provide:
 * - Type-safe TypeScript APIs
 * - Error handling and mapping to application-level error types
 * - Structured logging for all operations
 * - Timeout handling for resilience
 * - Batch operation support
 */
export class TigerBeetleClient implements ILedgerClient {
  private _client?: Client;
  private _config: Required<TigerBeetleConfig>;
  private _initialized = false;
  private _sdk: typeof import('tigerbeetle-node') | null = null;

  constructor(
    config: TigerBeetleConfig,
    private readonly _logger: Logger
  ) {
    // Apply defaults for optional configuration
    // Using 10000ms as production-safe default for multi-replica consensus
    this._config = {
      clusterId: config.clusterId,
      replicaAddresses: config.replicaAddresses,
      connectionTimeout: config.connectionTimeout ?? 5000,
      operationTimeout: config.operationTimeout ?? 10000,
    };
  }

  /**
   * Initialize connection to TigerBeetle cluster
   *
   * Must be called before any operations. Establishes connection pool to all replicas.
   *
   * @throws {TigerBeetleConnectionError} if initialization fails
   */
  async initialize(): Promise<void> {
    try {
      this._logger.info(
        {
          clusterId: this._config.clusterId,
          replicaAddresses: this._config.replicaAddresses,
          replicaCount: this._config.replicaAddresses.length,
        },
        'Initializing TigerBeetle client'
      );

      // Dynamically load tigerbeetle-node
      this._sdk = await requireOptional<typeof import('tigerbeetle-node')>(
        'tigerbeetle-node',
        'TigerBeetle accounting'
      );

      // createClient is synchronous but we wrap in Promise for consistency
      this._client = this._sdk.createClient({
        cluster_id: BigInt(this._config.clusterId),
        replica_addresses: this._config.replicaAddresses,
      });

      this._initialized = true;

      this._logger.info(
        {
          clusterId: this._config.clusterId,
          replicaCount: this._config.replicaAddresses.length,
        },
        'TigerBeetle client initialized successfully'
      );
    } catch (error) {
      this._logger.error(
        {
          error,
          clusterId: this._config.clusterId,
          replicaAddresses: this._config.replicaAddresses,
        },
        'Failed to initialize TigerBeetle client'
      );
      throw new TigerBeetleConnectionError('Failed to initialize TigerBeetle client', error);
    }
  }

  /**
   * Close TigerBeetle client connection
   *
   * Gracefully shuts down connection pool. Client cannot be reused after closing.
   */
  async close(): Promise<void> {
    if (this._client) {
      this._logger.info('Closing TigerBeetle client connection');
      // TigerBeetle client does not have explicit close method
      // Connection is cleaned up when client is garbage collected
      this._client = undefined;
      this._initialized = false;
      this._logger.info('TigerBeetle client connection closed');
    }
  }

  /**
   * Create a single account in TigerBeetle
   *
   * @param accountId - Unique 128-bit account identifier (must be non-zero)
   * @param ledger - Ledger identifier (groups related accounts, uint32)
   * @param code - Account code/type (uint16)
   * @param flags - Account flags (optional, defaults to AccountFlags.none)
   * @throws {TigerBeetleAccountError} if account creation fails
   */
  async createAccount(
    accountId: bigint,
    ledger: number,
    code: number,
    flags?: number
  ): Promise<void> {
    this.ensureConnected();

    // Validate inputs before sending to TigerBeetle
    if (accountId === 0n) {
      throw new TigerBeetleAccountError('Account ID must be non-zero', accountId);
    }

    const effectiveFlags = flags ?? this._sdk!.AccountFlags.none;

    const account: Account = {
      id: accountId,
      debits_pending: 0n,
      debits_posted: 0n,
      credits_pending: 0n,
      credits_posted: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      reserved: 0,
      ledger,
      code,
      flags: effectiveFlags,
      timestamp: 0n, // TigerBeetle auto-assigns timestamp
    };

    try {
      this._logger.debug({ accountId, ledger, code, flags }, 'Creating account in TigerBeetle');

      const errors = await this.withTimeout(
        this._client!.createAccounts([account]),
        this._config.operationTimeout,
        'createAccount'
      );

      if (errors.length > 0) {
        const error = errors[0]!;
        throw this.mapAccountError(error, accountId);
      }

      this._logger.info({ accountId, ledger, code }, 'Account created successfully');
    } catch (error) {
      if (error instanceof TigerBeetleError) {
        throw error;
      }

      this._logger.error({ error, accountId, ledger, code }, 'Failed to create account');
      throw new TigerBeetleAccountError('Failed to create account', accountId, error);
    }
  }

  /**
   * Create multiple accounts in a single atomic batch operation
   *
   * @param accounts - Array of account specifications
   * @throws {TigerBeetleAccountError} if any account creation fails
   */
  async createAccountsBatch(
    accounts: Array<{ id: bigint; ledger: number; code: number; flags?: number }>
  ): Promise<void> {
    this.ensureConnected();

    const accountObjects: Account[] = accounts.map((spec) => ({
      id: spec.id,
      debits_pending: 0n,
      debits_posted: 0n,
      credits_pending: 0n,
      credits_posted: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      reserved: 0,
      ledger: spec.ledger,
      code: spec.code,
      flags: spec.flags ?? this._sdk!.AccountFlags.none,
      timestamp: 0n,
    }));

    try {
      this._logger.debug(
        { accountCount: accounts.length },
        'Creating account batch in TigerBeetle'
      );

      const errors = await this.withTimeout(
        this._client!.createAccounts(accountObjects),
        this._config.operationTimeout,
        'createAccountsBatch'
      );

      if (errors.length > 0) {
        const errorMessages = errors.map(
          (err) => `Account ${err.index}: ${this._sdk!.CreateAccountError[err.result]}`
        );
        this._logger.error(
          { errors: errorMessages, accountCount: accounts.length },
          'Failed to create account batch'
        );
        throw new TigerBeetleAccountError(
          `Failed to create ${errors.length} accounts: ${errorMessages.join(', ')}`
        );
      }

      this._logger.info({ accountCount: accounts.length }, 'Account batch created successfully');
    } catch (error) {
      if (error instanceof TigerBeetleError) {
        throw error;
      }

      this._logger.error(
        { error, accountCount: accounts.length },
        'Failed to create account batch'
      );
      throw new TigerBeetleAccountError('Failed to create account batch', undefined, error);
    }
  }

  /**
   * Create a transfer between two accounts
   *
   * @param transferId - Unique 128-bit transfer identifier (must be non-zero)
   * @param debitAccountId - Account to debit (source)
   * @param creditAccountId - Account to credit (destination)
   * @param amount - Transfer amount (must be positive)
   * @param ledger - Ledger identifier (must match accounts)
   * @param code - Transfer code/type (uint16)
   * @throws {TigerBeetleTransferError} if transfer creation fails
   */
  async createTransfer(
    transferId: bigint,
    debitAccountId: bigint,
    creditAccountId: bigint,
    amount: bigint,
    ledger: number,
    code: number
  ): Promise<void> {
    this.ensureConnected();

    // Validate inputs
    if (transferId === 0n) {
      throw new TigerBeetleTransferError('Transfer ID must be non-zero', transferId);
    }
    if (amount <= 0n) {
      throw new TigerBeetleTransferError(
        'Transfer amount must be positive',
        transferId,
        debitAccountId,
        creditAccountId
      );
    }

    const transfer: Transfer = {
      id: transferId,
      debit_account_id: debitAccountId,
      credit_account_id: creditAccountId,
      amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger,
      code,
      flags: this._sdk!.TransferFlags.none,
      timestamp: 0n,
    };

    try {
      this._logger.debug(
        { transferId, debitAccountId, creditAccountId, amount, ledger, code },
        'Creating transfer in TigerBeetle'
      );

      const errors = await this.withTimeout(
        this._client!.createTransfers([transfer]),
        this._config.operationTimeout,
        'createTransfer'
      );

      if (errors.length > 0) {
        const error = errors[0]!;
        throw this.mapTransferError(error, transferId, debitAccountId, creditAccountId);
      }

      this._logger.info(
        { transferId, debitAccountId, creditAccountId, amount },
        'Transfer created successfully'
      );
    } catch (error) {
      if (error instanceof TigerBeetleError) {
        throw error;
      }

      this._logger.error(
        { error, transferId, debitAccountId, creditAccountId, amount },
        'Failed to create transfer'
      );
      throw new TigerBeetleTransferError(
        'Failed to create transfer',
        transferId,
        debitAccountId,
        creditAccountId,
        error
      );
    }
  }

  /**
   * Create multiple transfers atomically in a single batch operation
   *
   * All transfers in the batch are posted atomically - either all succeed or all fail.
   * This is critical for double-entry accounting where both legs of a transaction
   * must be posted together to maintain consistency.
   *
   * @param transfers - Array of transfer objects to create
   * @throws {TigerBeetleTransferError} if any transfer in the batch fails
   *
   * @example
   * // Create dual-leg transfer for ILP packet forwarding
   * const transfers = [
   *   {
   *     id: transferId1,
   *     debit_account_id: fromPeerCreditAccountId,
   *     credit_account_id: connectorAccountId,
   *     amount: 1000n,
   *     ledger: 1,
   *     code: 1,
   *     flags: TransferFlags.none,
   *     pending_id: 0n,
   *     user_data_128: 0n,
   *     user_data_64: 0n,
   *     user_data_32: 0,
   *     timeout: 0,
   *     timestamp: 0n,
   *   },
   *   {
   *     id: transferId2,
   *     debit_account_id: connectorAccountId,
   *     credit_account_id: toPeerDebitAccountId,
   *     amount: 999n,
   *     ledger: 1,
   *     code: 1,
   *     flags: TransferFlags.none,
   *     pending_id: 0n,
   *     user_data_128: 0n,
   *     user_data_64: 0n,
   *     user_data_32: 0,
   *     timeout: 0,
   *     timestamp: 0n,
   *   },
   * ];
   * await client.createTransfersBatch(transfers);
   */
  async createTransfersBatch(transfers: Transfer[]): Promise<void> {
    this.ensureConnected();

    // Validate all transfers before posting
    for (const transfer of transfers) {
      if (transfer.id === 0n) {
        throw new TigerBeetleTransferError('Transfer ID must be non-zero', transfer.id);
      }
      if (transfer.amount <= 0n) {
        throw new TigerBeetleTransferError(
          'Transfer amount must be positive',
          transfer.id,
          transfer.debit_account_id,
          transfer.credit_account_id
        );
      }
    }

    try {
      this._logger.debug(
        { transferCount: transfers.length },
        'Creating transfer batch in TigerBeetle'
      );

      const errors = await this.withTimeout(
        this._client!.createTransfers(transfers),
        this._config.operationTimeout,
        'createTransfersBatch'
      );

      if (errors.length > 0) {
        // Map all errors for detailed logging
        const errorDetails = errors.map((err) => ({
          index: err.index,
          result: err.result,
          transferId: transfers[err.index]?.id.toString(),
        }));

        this._logger.error(
          { errors: errorDetails, transferCount: transfers.length },
          'Transfer batch creation failed'
        );

        // Throw error for first failed transfer
        const firstError = errors[0]!;
        const failedTransfer = transfers[firstError.index];
        throw this.mapTransferError(
          firstError,
          failedTransfer!.id,
          failedTransfer!.debit_account_id,
          failedTransfer!.credit_account_id
        );
      }

      this._logger.info({ transferCount: transfers.length }, 'Transfer batch created successfully');
    } catch (error) {
      if (error instanceof TigerBeetleError) {
        throw error;
      }

      this._logger.error(
        { error, transferCount: transfers.length },
        'Failed to create transfer batch'
      );
      throw new TigerBeetleTransferError(
        'Failed to create transfer batch',
        undefined,
        undefined,
        undefined,
        error
      );
    }
  }

  /**
   * Query the balance of a single account
   *
   * @param accountId - Account identifier to query
   * @returns Account balance with debits, credits, and net balance
   * @throws {TigerBeetleAccountError} if account not found
   */
  async getAccountBalance(accountId: bigint): Promise<AccountBalance> {
    this.ensureConnected();

    try {
      this._logger.debug({ accountId }, 'Querying account balance');

      const accounts = await this.withTimeout(
        this._client!.lookupAccounts([accountId]),
        this._config.operationTimeout,
        'getAccountBalance'
      );

      if (accounts.length === 0) {
        throw new TigerBeetleAccountError(`Account not found: ${accountId}`, accountId);
      }

      const account = accounts[0]!;
      const balance: AccountBalance = {
        debits: account.debits_posted,
        credits: account.credits_posted,
        balance: account.credits_posted - account.debits_posted,
      };

      this._logger.debug(
        { accountId, debits: balance.debits, credits: balance.credits, balance: balance.balance },
        'Account balance retrieved'
      );

      return balance;
    } catch (error) {
      if (error instanceof TigerBeetleError) {
        throw error;
      }

      this._logger.error({ error, accountId }, 'Failed to query account balance');
      throw new TigerBeetleAccountError('Failed to query account balance', accountId, error);
    }
  }

  /**
   * Query balances for multiple accounts in a single batch operation
   *
   * @param accountIds - Array of account identifiers to query
   * @returns Map of account ID to balance (missing accounts are omitted)
   */
  async getAccountsBatch(accountIds: bigint[]): Promise<Map<bigint, AccountBalance>> {
    this.ensureConnected();

    try {
      this._logger.debug({ accountCount: accountIds.length }, 'Querying account batch balances');

      const accounts = await this.withTimeout(
        this._client!.lookupAccounts(accountIds),
        this._config.operationTimeout,
        'getAccountsBatch'
      );

      const balances = new Map<bigint, AccountBalance>();
      for (const account of accounts) {
        balances.set(account.id, {
          debits: account.debits_posted,
          credits: account.credits_posted,
          balance: account.credits_posted - account.debits_posted,
        });
      }

      this._logger.debug(
        { accountCount: accountIds.length, foundCount: balances.size },
        'Account batch balances retrieved'
      );

      return balances;
    } catch (error) {
      this._logger.error(
        { error, accountCount: accountIds.length },
        'Failed to query account batch balances'
      );
      throw new TigerBeetleAccountError('Failed to query account batch balances', undefined, error);
    }
  }

  /**
   * Ensure client is initialized before operations
   *
   * @throws {TigerBeetleConnectionError} if client not initialized
   */
  private ensureConnected(): void {
    if (!this._initialized || !this._client) {
      throw new TigerBeetleConnectionError(
        'TigerBeetle client not initialized. Call initialize() first.'
      );
    }
  }

  /**
   * Wrap operation with timeout handling
   *
   * @param promise - Operation promise to execute
   * @param timeoutMs - Timeout in milliseconds
   * @param operation - Operation name for error messages
   * @returns Operation result
   * @throws {TigerBeetleTimeoutError} if operation times out
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          this._logger.warn({ operation, timeoutMs }, 'TigerBeetle operation timed out');
          reject(
            new TigerBeetleTimeoutError(
              `TigerBeetle operation '${operation}' timed out after ${timeoutMs}ms`,
              timeoutMs,
              operation
            )
          );
        }, timeoutMs);
      }),
    ]);
  }

  /**
   * Map TigerBeetle account error to application error type
   */
  private mapAccountError(
    error: { index: number; result: CreateAccountError },
    accountId: bigint
  ): TigerBeetleAccountError {
    const errorCode = this._sdk!.CreateAccountError[error.result];
    const message = `Account creation failed: ${errorCode}`;

    this._logger.error({ accountId, errorCode, errorIndex: error.index }, message);

    return new TigerBeetleAccountError(message, accountId, error);
  }

  /**
   * Map TigerBeetle transfer error to application error type
   */
  private mapTransferError(
    error: { index: number; result: CreateTransferError },
    transferId: bigint,
    debitAccountId: bigint,
    creditAccountId: bigint
  ): TigerBeetleTransferError {
    const errorCode = this._sdk!.CreateTransferError[error.result];
    const message = `Transfer creation failed: ${errorCode}`;

    this._logger.error(
      { transferId, debitAccountId, creditAccountId, errorCode, errorIndex: error.index },
      message
    );

    return new TigerBeetleTransferError(
      message,
      transferId,
      debitAccountId,
      creditAccountId,
      error
    );
  }
}
