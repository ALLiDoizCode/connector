import type {
  Aptos,
  Network,
  Account,
  InputViewFunctionData,
  MoveValue,
  EntryFunctionArgumentTypes,
  SimpleEntryFunctionArgumentTypes,
} from '@aptos-labs/ts-sdk';
import { Logger } from 'pino';
import { requireOptional } from '../utils/optional-require';

/**
 * Aptos Client Configuration
 *
 * Loaded from environment variables at connector startup.
 * Supports Aptos testnet (development) and mainnet (production).
 */
export interface AptosClientConfig {
  /**
   * Aptos fullnode REST API URL
   * - Testnet: https://fullnode.testnet.aptoslabs.com/v1
   * - Mainnet: https://fullnode.mainnet.aptoslabs.com/v1
   */
  nodeUrl: string;

  /**
   * Fallback Aptos RPC URL (optional)
   * Used when primary fails after retries
   * Example: https://aptos-testnet.nodereal.io/v1
   */
  fallbackNodeUrl?: string;

  /**
   * Aptos account private key (ed25519)
   * - Format: 64-character hex string (32 bytes)
   * - MUST be stored in environment variable (APTOS_PRIVATE_KEY)
   * - NEVER hardcode in source code
   */
  privateKey: string;

  /**
   * Aptos account address (public)
   * - Format: 0x-prefixed 64-character hex (e.g., "0x1234...abcd")
   * - Derived from privateKey, but stored for validation
   */
  accountAddress: string;

  /**
   * Request timeout in milliseconds
   * Default: 30000ms (30 seconds)
   */
  requestTimeoutMs?: number;

  /**
   * Maximum retry attempts for failed requests
   * Default: 3
   */
  maxRetryAttempts?: number;

  /**
   * Connection health check interval in milliseconds
   * Default: 30000ms (30 seconds)
   */
  healthCheckIntervalMs?: number;
}

/**
 * Application-level Aptos error types
 *
 * Maps Aptos API error codes to domain-specific errors for consistent handling.
 */
export enum AptosErrorCode {
  // Connection errors
  CONNECTION_FAILED = 'APTOS_CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'APTOS_CONNECTION_TIMEOUT',
  RATE_LIMITED = 'APTOS_RATE_LIMITED',

  // Account errors
  ACCOUNT_NOT_FOUND = 'APTOS_ACCOUNT_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'APTOS_INSUFFICIENT_BALANCE',
  SEQUENCE_NUMBER_TOO_OLD = 'APTOS_SEQUENCE_TOO_OLD',

  // Transaction errors
  TRANSACTION_FAILED = 'APTOS_TRANSACTION_FAILED',
  INVALID_TRANSACTION = 'APTOS_INVALID_TRANSACTION',
  TRANSACTION_EXPIRED = 'APTOS_TRANSACTION_EXPIRED',
  SIMULATION_FAILED = 'APTOS_SIMULATION_FAILED',

  // Module/Resource errors
  MODULE_NOT_FOUND = 'APTOS_MODULE_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'APTOS_RESOURCE_NOT_FOUND',

  // General errors
  UNKNOWN_ERROR = 'APTOS_UNKNOWN_ERROR',
}

/**
 * Aptos Error Class
 */
export class AptosError extends Error {
  constructor(
    public readonly code: AptosErrorCode,
    message: string,
    public readonly originalError?: Error | unknown
  ) {
    super(message);
    this.name = 'AptosError';
  }
}

/**
 * Aptos Client Interface
 *
 * TypeScript client for interacting with Aptos blockchain via REST API.
 * Wraps @aptos-labs/ts-sdk library with application-specific error handling and logging.
 */
export interface IAptosClient {
  /**
   * Initialize connection to Aptos node
   *
   * Validates account credentials and returns account information.
   * Starts health check polling if configured.
   *
   * @throws AptosError with code CONNECTION_FAILED if connection fails
   * @throws AptosError with code ACCOUNT_NOT_FOUND if account does not exist
   */
  connect(): Promise<void>;

  /**
   * Disconnect from Aptos node
   *
   * Stops health check polling and cleans up resources.
   */
  disconnect(): void;

  /**
   * Get account information
   *
   * Queries chain for account details: sequence number, authentication key.
   *
   * @param address - Aptos address (0x-prefixed hex)
   * @returns Account information including sequence number
   * @throws AptosError with code ACCOUNT_NOT_FOUND if account does not exist
   */
  getAccountInfo(address: string): Promise<{
    sequenceNumber: string;
    authenticationKey: string;
  }>;

  /**
   * Get account APT balance
   *
   * Queries the CoinStore resource for APT balance.
   *
   * @param address - Aptos address (0x-prefixed hex)
   * @returns Balance in octas (1 APT = 100,000,000 octas)
   * @throws AptosError with code ACCOUNT_NOT_FOUND if account does not exist
   */
  getBalance(address: string): Promise<bigint>;

  /**
   * Submit signed transaction
   *
   * Submits transaction and waits for confirmation.
   * Implements retry logic with exponential backoff.
   *
   * @param transaction - Signed transaction payload
   * @returns Transaction result including hash and version
   * @throws AptosError with code TRANSACTION_FAILED if submission fails
   * @throws AptosError with code TRANSACTION_EXPIRED if confirmation times out
   */
  submitTransaction(transaction: unknown): Promise<{
    hash: string;
    version: string;
    success: boolean;
    vmStatus: string;
  }>;

  /**
   * Simulate transaction before submission
   *
   * Simulates transaction to check for errors and gas estimation.
   *
   * @param transaction - Transaction payload to simulate
   * @returns Simulation result with gas estimate and potential errors
   * @throws AptosError with code SIMULATION_FAILED if simulation fails
   */
  simulateTransaction(transaction: unknown): Promise<{
    success: boolean;
    gasUsed: string;
    vmStatus: string;
  }>;

  /**
   * Call view function on module
   *
   * Calls a read-only function to query on-chain state.
   * Does not require transaction signing.
   *
   * @param moduleAddress - Address where module is deployed
   * @param moduleName - Name of the Move module
   * @param functionName - Name of the view function
   * @param typeArgs - Optional type arguments
   * @param args - Function arguments
   * @returns Decoded return values from view function
   * @throws AptosError with code MODULE_NOT_FOUND if module doesn't exist
   */
  view<T = MoveValue[]>(
    moduleAddress: string,
    moduleName: string,
    functionName: string,
    typeArgs?: string[],
    args?: Array<EntryFunctionArgumentTypes | SimpleEntryFunctionArgumentTypes>
  ): Promise<T>;

  /**
   * Get account resource
   *
   * Retrieves a specific resource from an account.
   *
   * @param address - Account address
   * @param resourceType - Fully qualified resource type (e.g., "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>")
   * @returns Resource data
   * @throws AptosError with code RESOURCE_NOT_FOUND if resource doesn't exist
   */
  getAccountResource<T = unknown>(address: string, resourceType: string): Promise<T>;

  /**
   * Check connection status
   *
   * Note: Named `isConnected()` for consistency with XRPLClient pattern.
   * Returns true if connected and healthy, false otherwise.
   *
   * @returns true if connected and healthy, false otherwise
   */
  isConnected(): boolean;

  /**
   * Get current account address
   */
  getAddress(): string;

  /**
   * Fund account via Aptos testnet faucet
   *
   * Only available on testnet. Uses @aptos-labs/ts-sdk faucet client.
   * May be rate-limited by Aptos faucet service.
   *
   * @param address - Aptos address to fund (0x-prefixed hex)
   * @param amount - Amount in octas to fund (1 APT = 100,000,000 octas)
   * @throws AptosError with code CONNECTION_FAILED if faucet unavailable
   * @throws AptosError with code RATE_LIMITED if faucet rate-limited
   */
  fundWithFaucet(address: string, amount: number): Promise<void>;
}

/**
 * AptosClient Implementation using @aptos-labs/ts-sdk
 *
 * Provides a consistent interface for interacting with Aptos blockchain,
 * with error handling, retry logic, and structured logging.
 */
export class AptosClient implements IAptosClient {
  private aptos: Aptos;
  private fallbackAptos: Aptos | null = null;
  private account: Account;
  private readonly logger: Logger;
  private readonly config: AptosClientConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private _connectionHealthy: boolean = false;
  private static _sdk: typeof import('@aptos-labs/ts-sdk') | null = null;

  private static async loadSdk(): Promise<typeof import('@aptos-labs/ts-sdk')> {
    if (!AptosClient._sdk) {
      AptosClient._sdk = await requireOptional<typeof import('@aptos-labs/ts-sdk')>(
        '@aptos-labs/ts-sdk',
        'Aptos settlement'
      );
    }
    return AptosClient._sdk;
  }

  private constructor(
    config: AptosClientConfig,
    logger: Logger,
    aptos: Aptos,
    fallbackAptos: Aptos | null,
    account: Account
  ) {
    this.config = config;
    this.logger = logger;
    this.aptos = aptos;
    this.fallbackAptos = fallbackAptos;
    this.account = account;
  }

  static async create(config: AptosClientConfig, logger: Logger): Promise<AptosClient> {
    const sdk = await AptosClient.loadSdk();

    // Determine network from URL
    const getNetworkFromUrl = (url: string): Network => {
      if (url.includes('testnet')) return sdk.Network.TESTNET;
      if (url.includes('devnet')) return sdk.Network.DEVNET;
      if (url.includes('mainnet')) return sdk.Network.MAINNET;
      if (url.includes('localhost') || url.includes('127.0.0.1')) return sdk.Network.LOCAL;
      return sdk.Network.CUSTOM;
    };

    const network = getNetworkFromUrl(config.nodeUrl);

    // Initialize Aptos SDK client
    const aptosConfig = new sdk.AptosConfig({
      network,
      fullnode: config.nodeUrl,
    });
    const aptos = new sdk.Aptos(aptosConfig);

    // Initialize fallback client if configured
    let fallbackAptos: Aptos | null = null;
    if (config.fallbackNodeUrl) {
      const fallbackNetwork = getNetworkFromUrl(config.fallbackNodeUrl);
      const fallbackConfig = new sdk.AptosConfig({
        network: fallbackNetwork,
        fullnode: config.fallbackNodeUrl,
      });
      fallbackAptos = new sdk.Aptos(fallbackConfig);
    }

    // Initialize account from private key
    const privateKey = new sdk.Ed25519PrivateKey(config.privateKey);
    const account = sdk.Account.fromPrivateKey({ privateKey });

    // Normalize addresses for comparison (both to lowercase, ensure 0x prefix)
    const derivedAddress = account.accountAddress.toString().toLowerCase();
    const configAddress = config.accountAddress.toLowerCase();

    // Validate address matches derived account
    if (derivedAddress !== configAddress) {
      throw new Error(
        `Account address mismatch: expected ${config.accountAddress}, got ${account.accountAddress.toString()}`
      );
    }

    return new AptosClient(config, logger, aptos, fallbackAptos, account);
  }

  async connect(): Promise<void> {
    try {
      this.logger.info({ nodeUrl: this.config.nodeUrl }, 'Connecting to Aptos node...');

      // Validate account exists on chain
      const accountInfo = await this.getAccountInfo(this.config.accountAddress);
      this.logger.info(
        { address: this.config.accountAddress, sequenceNumber: accountInfo.sequenceNumber },
        'Aptos account validated'
      );

      // Get and log balance
      const balance = await this.getBalance(this.config.accountAddress);
      this.logger.info(
        { address: this.config.accountAddress, balanceOctas: balance.toString() },
        'Aptos account balance retrieved'
      );

      this._connectionHealthy = true;

      // Start health check polling
      if (this.config.healthCheckIntervalMs && this.config.healthCheckIntervalMs > 0) {
        this.startHealthCheck();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      this.logger.error({ error, nodeUrl: this.config.nodeUrl }, 'Failed to connect to Aptos');

      // Check if it's already an AptosError
      if (error instanceof AptosError) {
        throw error;
      }

      throw new AptosError(
        AptosErrorCode.CONNECTION_FAILED,
        `Failed to connect to Aptos: ${errorMessage}`,
        error
      );
    }
  }

  disconnect(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this._connectionHealthy = false;
    this.logger.info('Disconnected from Aptos');
  }

  async getAccountInfo(address: string): Promise<{
    sequenceNumber: string;
    authenticationKey: string;
  }> {
    return this.withRetry(async () => {
      try {
        const accountInfo = await this.aptos.account.getAccountInfo({
          accountAddress: address,
        });
        return {
          sequenceNumber: accountInfo.sequence_number,
          authenticationKey: accountInfo.authentication_key,
        };
      } catch (error: unknown) {
        throw this.mapError(error, `Failed to get account info for ${address}`);
      }
    });
  }

  async getBalance(address: string): Promise<bigint> {
    return this.withRetry(async () => {
      try {
        const balance = await this.aptos.account.getAccountAPTAmount({
          accountAddress: address,
        });
        return BigInt(balance);
      } catch (error: unknown) {
        throw this.mapError(error, `Failed to get balance for ${address}`);
      }
    });
  }

  async submitTransaction(transaction: unknown): Promise<{
    hash: string;
    version: string;
    success: boolean;
    vmStatus: string;
  }> {
    return this.withRetry(async () => {
      try {
        this.logger.info({ transaction }, 'Submitting transaction to Aptos...');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txnInput = transaction as any;

        // Check if this is a raw payload (from SDK) or a built SimpleTransaction
        // Raw payloads have a 'function' property; built transactions have 'bcsToBytes'
        let builtTxn;
        if (txnInput.function && typeof txnInput.bcsToBytes !== 'function') {
          // Raw payload - need to build the transaction first
          this.logger.debug({ function: txnInput.function }, 'Building transaction from payload');
          builtTxn = await this.aptos.transaction.build.simple({
            sender: this.account.accountAddress,
            data: {
              function: txnInput.function,
              typeArguments: txnInput.typeArguments || [],
              functionArguments: txnInput.functionArguments || [],
            },
          });
        } else {
          // Already a built SimpleTransaction
          builtTxn = txnInput;
        }

        // Sign and submit the transaction
        const pendingTxn = await this.aptos.signAndSubmitTransaction({
          signer: this.account,
          transaction: builtTxn,
        });

        // Wait for confirmation
        const committedTxn = await this.aptos.waitForTransaction({
          transactionHash: pendingTxn.hash,
        });

        this.logger.info(
          { hash: committedTxn.hash, version: committedTxn.version },
          'Transaction confirmed on Aptos'
        );

        return {
          hash: committedTxn.hash,
          version: committedTxn.version,
          success: committedTxn.success,
          vmStatus: committedTxn.vm_status,
        };
      } catch (error: unknown) {
        // Extract detailed error message from Aptos SDK errors
        let errorDetail = '';
        if (error instanceof Error) {
          errorDetail = error.message;
          // Try to extract more details from Aptos API errors
          const errorWithResponse = error as Error & {
            response?: { data?: { message?: string; error_code?: string; vm_error_code?: string } };
          };
          if (errorWithResponse.response && typeof errorWithResponse.response === 'object') {
            const response = errorWithResponse.response;
            if (response.data?.message) {
              errorDetail = response.data.message;
            } else if (response.data?.error_code) {
              errorDetail = `${response.data.error_code}: ${response.data.vm_error_code || response.data.message || 'unknown'}`;
            }
          }
        }
        this.logger.error({ error, transaction, errorDetail }, 'Transaction submission failed');
        throw this.mapError(error, `Failed to submit transaction: ${errorDetail}`);
      }
    });
  }

  async simulateTransaction(transaction: unknown): Promise<{
    success: boolean;
    gasUsed: string;
    vmStatus: string;
  }> {
    try {
      this.logger.info({ transaction }, 'Simulating transaction...');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txnInput = transaction as any;

      // Check if this is a raw payload or a built SimpleTransaction
      let builtTxn;
      if (txnInput.function && typeof txnInput.bcsToBytes !== 'function') {
        // Raw payload - need to build the transaction first
        this.logger.debug({ function: txnInput.function }, 'Building transaction for simulation');
        builtTxn = await this.aptos.transaction.build.simple({
          sender: this.account.accountAddress,
          data: {
            function: txnInput.function,
            typeArguments: txnInput.typeArguments || [],
            functionArguments: txnInput.functionArguments || [],
          },
        });
      } else {
        builtTxn = txnInput;
      }

      const simulationResults = await this.aptos.transaction.simulate.simple({
        signerPublicKey: this.account.publicKey,
        transaction: builtTxn,
      });

      const simulationResult = simulationResults[0];
      if (!simulationResult) {
        throw new AptosError(AptosErrorCode.SIMULATION_FAILED, 'Simulation returned no results');
      }

      return {
        success: simulationResult.success,
        gasUsed: simulationResult.gas_used,
        vmStatus: simulationResult.vm_status,
      };
    } catch (error: unknown) {
      this.logger.error({ error }, 'Transaction simulation failed');
      throw new AptosError(
        AptosErrorCode.SIMULATION_FAILED,
        'Transaction simulation failed',
        error
      );
    }
  }

  async view<T = MoveValue[]>(
    moduleAddress: string,
    moduleName: string,
    functionName: string,
    typeArgs?: string[],
    args?: Array<EntryFunctionArgumentTypes | SimpleEntryFunctionArgumentTypes>
  ): Promise<T> {
    return this.withRetry(async () => {
      try {
        const payload: InputViewFunctionData = {
          function: `${moduleAddress}::${moduleName}::${functionName}`,
          typeArguments: typeArgs ?? [],
          functionArguments: args ?? [],
        };

        const result = await this.aptos.view({ payload });
        return result as T;
      } catch (error: unknown) {
        this.logger.error(
          { error, moduleAddress, moduleName, functionName },
          'View function call failed'
        );
        throw this.mapError(
          error,
          `Failed to call view function ${moduleAddress}::${moduleName}::${functionName}`
        );
      }
    });
  }

  async getAccountResource<T = unknown>(address: string, resourceType: string): Promise<T> {
    return this.withRetry(async () => {
      try {
        const resource = await this.aptos.account.getAccountResource({
          accountAddress: address,
          resourceType: resourceType as `${string}::${string}::${string}`,
        });
        return resource as T;
      } catch (error: unknown) {
        throw this.mapError(error, `Failed to get resource ${resourceType} for ${address}`);
      }
    });
  }

  isConnected(): boolean {
    return this._connectionHealthy;
  }

  getAddress(): string {
    return this.account.accountAddress.toString();
  }

  async fundWithFaucet(address: string, amount: number): Promise<void> {
    try {
      this.logger.info({ address, amount }, 'Funding account via Aptos testnet faucet...');

      const sdk = await AptosClient.loadSdk();

      // Check if this is testnet/devnet
      const network = this.getNetworkFromUrl(this.config.nodeUrl);
      if (network !== sdk.Network.TESTNET && network !== sdk.Network.DEVNET) {
        throw new AptosError(
          AptosErrorCode.INVALID_TRANSACTION,
          'Faucet is only available on testnet and devnet'
        );
      }

      await this.aptos.fundAccount({
        accountAddress: sdk.AccountAddress.from(address),
        amount,
      });

      this.logger.info({ address, amount }, 'Account funded successfully');
    } catch (error: unknown) {
      if (error instanceof AptosError) {
        throw error;
      }

      // Check for rate limiting
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate')) {
        throw new AptosError(
          AptosErrorCode.RATE_LIMITED,
          'Faucet rate-limited, try again later',
          error
        );
      }

      this.logger.error({ error, address }, 'Failed to fund account via faucet');
      throw new AptosError(AptosErrorCode.CONNECTION_FAILED, 'Faucet unavailable', error);
    }
  }

  /**
   * Determine network type from URL
   *
   * Note: SDK must be loaded before calling this method (always true after create()).
   */
  private getNetworkFromUrl(url: string): Network {
    const sdk = AptosClient._sdk!;
    if (url.includes('testnet')) {
      return sdk.Network.TESTNET;
    } else if (url.includes('devnet')) {
      return sdk.Network.DEVNET;
    } else if (url.includes('mainnet')) {
      return sdk.Network.MAINNET;
    } else if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return sdk.Network.LOCAL;
    }
    return sdk.Network.CUSTOM;
  }

  /**
   * Start health check polling
   */
  private startHealthCheck(): void {
    const intervalMs = this.config.healthCheckIntervalMs ?? 30000;
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.aptos.getLedgerInfo();
        this._connectionHealthy = true;
      } catch (error) {
        this.logger.warn({ error }, 'Aptos health check failed');
        this._connectionHealthy = false;
      }
    }, intervalMs);
  }

  /**
   * Execute operation with retry logic and exponential backoff
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = this.config.maxRetryAttempts ?? 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;

        // Don't retry if it's an account/resource not found error
        if (error instanceof AptosError) {
          if (
            error.code === AptosErrorCode.ACCOUNT_NOT_FOUND ||
            error.code === AptosErrorCode.RESOURCE_NOT_FOUND ||
            error.code === AptosErrorCode.MODULE_NOT_FOUND
          ) {
            throw error;
          }
        }

        // Check if we should retry
        const isRetryable = this.isRetryableError(error);
        if (!isRetryable || attempt >= maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        this.logger.warn(
          { attempt, maxRetries, backoffMs, error },
          'Retrying after transient failure...'
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));

        // Try fallback if available and primary failed
        if (this.fallbackAptos && attempt === 2) {
          this.logger.info('Switching to fallback Aptos node...');
          const temp = this.aptos;
          this.aptos = this.fallbackAptos;
          this.fallbackAptos = temp;
        }
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError;
  }

  /**
   * Check if error is retryable (transient network errors)
   */
  private isRetryableError(error: unknown): boolean {
    if (!error) return false;

    // Check original error if this is an AptosError
    let errorMessage = error instanceof Error ? error.message : String(error);
    if (error instanceof AptosError && error.originalError) {
      const originalMessage =
        error.originalError instanceof Error
          ? error.originalError.message
          : String(error.originalError);
      errorMessage = `${errorMessage} ${originalMessage}`;
    }

    const lowerMessage = errorMessage.toLowerCase();

    // Network/connection errors are retryable
    if (
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('etimedout') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('socket hang up') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('timeout')
    ) {
      return true;
    }

    // 5xx errors are retryable
    if (
      lowerMessage.includes('500') ||
      lowerMessage.includes('502') ||
      lowerMessage.includes('503') ||
      lowerMessage.includes('504')
    ) {
      return true;
    }

    // Rate limiting is retryable
    if (lowerMessage.includes('429') || lowerMessage.includes('rate')) {
      return true;
    }

    return false;
  }

  /**
   * Map Aptos API errors to AptosError codes
   */
  private mapError(error: unknown, context: string): AptosError {
    if (error instanceof AptosError) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = errorMessage.toLowerCase();

    // Account not found
    if (
      errorString.includes('account not found') ||
      errorString.includes('resource not found') ||
      errorString.includes('404')
    ) {
      // Determine if it's account or resource based on context
      if (context.includes('resource')) {
        return new AptosError(AptosErrorCode.RESOURCE_NOT_FOUND, context, error);
      }
      return new AptosError(AptosErrorCode.ACCOUNT_NOT_FOUND, context, error);
    }

    // Module not found
    if (errorString.includes('module') && errorString.includes('not found')) {
      return new AptosError(AptosErrorCode.MODULE_NOT_FOUND, context, error);
    }

    // Rate limiting
    if (errorString.includes('429') || errorString.includes('rate')) {
      return new AptosError(AptosErrorCode.RATE_LIMITED, context, error);
    }

    // Connection timeout
    if (errorString.includes('timeout') || errorString.includes('etimedout')) {
      return new AptosError(AptosErrorCode.CONNECTION_TIMEOUT, context, error);
    }

    // Connection failed
    if (
      errorString.includes('econnrefused') ||
      errorString.includes('enotfound') ||
      errorString.includes('network')
    ) {
      return new AptosError(AptosErrorCode.CONNECTION_FAILED, context, error);
    }

    // Sequence number errors
    if (errorString.includes('sequence') && errorString.includes('old')) {
      return new AptosError(AptosErrorCode.SEQUENCE_NUMBER_TOO_OLD, context, error);
    }

    // Insufficient balance
    if (
      errorString.includes('insufficient') ||
      errorString.includes('balance') ||
      errorString.includes('gas')
    ) {
      return new AptosError(AptosErrorCode.INSUFFICIENT_BALANCE, context, error);
    }

    // Transaction expired
    if (errorString.includes('expired') || errorString.includes('deadline')) {
      return new AptosError(AptosErrorCode.TRANSACTION_EXPIRED, context, error);
    }

    // Transaction failed (generic)
    if (errorString.includes('transaction') && errorString.includes('failed')) {
      return new AptosError(AptosErrorCode.TRANSACTION_FAILED, context, error);
    }

    // Default to unknown error
    return new AptosError(AptosErrorCode.UNKNOWN_ERROR, `${context}: ${errorMessage}`, error);
  }
}

/**
 * Create AptosClient from environment variables
 *
 * Convenience factory function for creating an AptosClient
 * with configuration loaded from environment variables.
 *
 * @param logger - Pino logger instance
 * @returns Configured AptosClient
 * @throws Error if required environment variables are not set
 */
export async function createAptosClientFromEnv(logger: Logger): Promise<AptosClient> {
  const nodeUrl = process.env.APTOS_NODE_URL;
  const privateKey = process.env.APTOS_PRIVATE_KEY;
  const accountAddress = process.env.APTOS_ACCOUNT_ADDRESS;

  if (!nodeUrl) {
    throw new Error('APTOS_NODE_URL environment variable is required');
  }
  if (!privateKey) {
    throw new Error('APTOS_PRIVATE_KEY environment variable is required');
  }
  if (!accountAddress) {
    throw new Error('APTOS_ACCOUNT_ADDRESS environment variable is required');
  }

  const config: AptosClientConfig = {
    nodeUrl,
    privateKey,
    accountAddress,
    fallbackNodeUrl: process.env.APTOS_FALLBACK_NODE_URL,
    requestTimeoutMs: process.env.APTOS_REQUEST_TIMEOUT_MS
      ? parseInt(process.env.APTOS_REQUEST_TIMEOUT_MS, 10)
      : undefined,
    maxRetryAttempts: process.env.APTOS_MAX_RETRY_ATTEMPTS
      ? parseInt(process.env.APTOS_MAX_RETRY_ATTEMPTS, 10)
      : undefined,
    healthCheckIntervalMs: process.env.APTOS_HEALTH_CHECK_INTERVAL_MS
      ? parseInt(process.env.APTOS_HEALTH_CHECK_INTERVAL_MS, 10)
      : undefined,
  };

  return AptosClient.create(config, logger);
}
