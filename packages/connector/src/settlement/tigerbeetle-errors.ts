/**
 * Custom error classes for TigerBeetle operations
 *
 * These error types map TigerBeetle-specific errors to application-level error types,
 * providing user-friendly error messages while preserving original error details for debugging.
 */

/**
 * Base error class for all TigerBeetle-related errors
 */
export class TigerBeetleError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'TigerBeetleError';
    Object.setPrototypeOf(this, TigerBeetleError.prototype);
  }
}

/**
 * Error thrown when TigerBeetle client fails to initialize or connect
 */
export class TigerBeetleConnectionError extends TigerBeetleError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'connection', originalError);
    this.name = 'TigerBeetleConnectionError';
    Object.setPrototypeOf(this, TigerBeetleConnectionError.prototype);
  }
}

/**
 * Error thrown when account creation or lookup fails
 */
export class TigerBeetleAccountError extends TigerBeetleError {
  constructor(
    message: string,
    public readonly accountId?: bigint,
    originalError?: unknown
  ) {
    super(message, 'account', originalError);
    this.name = 'TigerBeetleAccountError';
    Object.setPrototypeOf(this, TigerBeetleAccountError.prototype);
  }
}

/**
 * Error thrown when transfer creation fails
 */
export class TigerBeetleTransferError extends TigerBeetleError {
  constructor(
    message: string,
    public readonly transferId?: bigint,
    public readonly debitAccountId?: bigint,
    public readonly creditAccountId?: bigint,
    originalError?: unknown
  ) {
    super(message, 'transfer', originalError);
    this.name = 'TigerBeetleTransferError';
    Object.setPrototypeOf(this, TigerBeetleTransferError.prototype);
  }
}

/**
 * Error thrown when a TigerBeetle operation times out
 */
export class TigerBeetleTimeoutError extends TigerBeetleError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    operation: string
  ) {
    super(message, operation);
    this.name = 'TigerBeetleTimeoutError';
    Object.setPrototypeOf(this, TigerBeetleTimeoutError.prototype);
  }
}
