import type { Logger } from 'pino';
import {
  ILPPreparePacket,
  ILPRejectPacket,
  ILPErrorCode,
  PacketType,
  ILPAddress,
} from '@m2m/shared';
import type { NostrEvent } from './toon-codec';
import type { AgentEventDatabase } from './event-database';

// ============================================
// Core Types and Interfaces (Task 1)
// ============================================

/**
 * Handler execution context providing all necessary information for event processing.
 * Handlers are stateless - all state is provided via context.
 */
export interface EventHandlerContext {
  /** The incoming Nostr event being handled */
  event: NostrEvent;
  /** Original ILP packet for access to amount, destination, etc. */
  packet: ILPPreparePacket;
  /** Payment amount from packet (convenience accessor) */
  amount: bigint;
  /** Source peer/connection identifier for routing responses */
  source: string;
  /** This agent's Nostr public key for signing responses */
  agentPubkey: string;
  /** Database reference for storage operations */
  database: AgentEventDatabase;
}

/**
 * Result returned by event handlers.
 */
export interface EventHandlerResult {
  /** Whether the handler executed successfully */
  success: boolean;
  /** Optional response event (for queries returning single result) */
  responseEvent?: NostrEvent;
  /** Optional multiple response events (for queries returning many results) */
  responseEvents?: NostrEvent[];
  /** Error details if handler failed */
  error?: {
    /** ILP error code (e.g., 'F99', 'T00') */
    code: string;
    /** Human-readable error message */
    message: string;
  };
}

/**
 * Event handler function type.
 */
export type EventHandler = (context: EventHandlerContext) => Promise<EventHandlerResult>;

/**
 * Configuration for registering an event handler.
 */
export interface HandlerConfig {
  /** Nostr event kind to handle (0, 1, 3, 5, 10000, etc.) */
  kind: number;
  /** Async handler function */
  handler: EventHandler;
  /** Minimum payment required (0n for free handlers) */
  requiredPayment: bigint;
  /** Human-readable description (e.g., "Note storage", "Query service") */
  description?: string;
}

// ============================================
// AgentEventHandler Configuration (Task 2)
// ============================================

/**
 * Configuration for AgentEventHandler.
 */
export interface AgentEventHandlerConfig {
  /** Agent's Nostr public key */
  agentPubkey: string;
  /** Event database instance for handler storage operations */
  database: AgentEventDatabase;
  /** Default payment for unregistered kinds (0 = free, undefined = reject) */
  defaultPayment?: bigint;
  /** Pino logger instance */
  logger?: Logger;
}

// ============================================
// Payment Validation Error (Task 4)
// ============================================

/**
 * Error thrown when payment is insufficient for a service.
 */
export class InsufficientPaymentError extends Error {
  public readonly code = 'F03';
  public readonly required: bigint;
  public readonly received: bigint;

  constructor(required: bigint, received: bigint) {
    super(`Insufficient payment: required ${required}, received ${received}`);
    this.name = 'InsufficientPaymentError';
    this.required = required;
    this.received = received;
  }
}

// ============================================
// AgentEventHandler Class (Tasks 2-6)
// ============================================

/**
 * AgentEventHandler routes incoming Nostr events to registered handlers
 * while enforcing payment requirements for each service.
 *
 * Key features:
 * - Kind-based event routing with O(1) lookup
 * - Payment validation before handler execution
 * - Extensible handler registration API
 * - ILP rejection packet creation helpers
 */
export class AgentEventHandler {
  private readonly _handlers: Map<number, HandlerConfig>;
  private readonly _config: AgentEventHandlerConfig;
  private readonly _logger: Logger;

  constructor(config: AgentEventHandlerConfig) {
    this._config = config;
    this._handlers = new Map();

    // Use provided logger or create a no-op logger
    if (config.logger) {
      this._logger = config.logger.child({ component: 'AgentEventHandler' });
    } else {
      // Create minimal no-op logger for testing without pino dependency
      this._logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => this._logger,
      } as unknown as Logger;
    }
  }

  // ============================================
  // Handler Registration API (Task 3)
  // ============================================

  /**
   * Register a handler for a specific event kind.
   *
   * @param config - Handler configuration
   * @throws Error if kind is invalid or handler is not a function
   */
  registerHandler(config: HandlerConfig): void {
    // Validate kind is a non-negative integer
    if (typeof config.kind !== 'number' || !Number.isInteger(config.kind) || config.kind < 0) {
      throw new Error(`Invalid kind: must be a non-negative integer, got ${config.kind}`);
    }

    // Validate handler is a function
    if (typeof config.handler !== 'function') {
      throw new Error('Invalid handler: must be a function');
    }

    // Validate requiredPayment is non-negative bigint
    if (typeof config.requiredPayment !== 'bigint' || config.requiredPayment < 0n) {
      throw new Error('Invalid requiredPayment: must be a non-negative bigint');
    }

    this._handlers.set(config.kind, config);
    this._logger.info({ kind: config.kind, description: config.description }, 'Handler registered');
  }

  /**
   * Unregister a handler for a specific event kind.
   *
   * @param kind - Event kind to unregister
   * @returns true if handler was removed, false if not found
   */
  unregisterHandler(kind: number): boolean {
    const existed = this._handlers.delete(kind);
    if (existed) {
      this._logger.info({ kind }, 'Handler unregistered');
    }
    return existed;
  }

  /**
   * Get all registered event kinds.
   *
   * @returns Array of registered kind numbers
   */
  getRegisteredKinds(): number[] {
    return Array.from(this._handlers.keys());
  }

  /**
   * Check if a handler is registered for a specific kind.
   *
   * @param kind - Event kind to check
   * @returns true if handler is registered
   */
  hasHandler(kind: number): boolean {
    return this._handlers.has(kind);
  }

  /**
   * Get handler configuration for debugging/inspection.
   *
   * @param kind - Event kind to look up
   * @returns Handler config or undefined if not found
   */
  getHandlerConfig(kind: number): HandlerConfig | undefined {
    return this._handlers.get(kind);
  }

  // ============================================
  // Payment Validation (Task 4)
  // ============================================

  /**
   * Validate payment amount for a specific event kind.
   *
   * @param kind - Event kind being handled
   * @param amount - Payment amount from ILP packet
   * @throws InsufficientPaymentError if amount < required
   */
  private _validatePayment(kind: number, amount: bigint): void {
    const handlerConfig = this._handlers.get(kind);

    let requiredPayment: bigint;

    if (handlerConfig) {
      requiredPayment = handlerConfig.requiredPayment;
    } else if (this._config.defaultPayment !== undefined) {
      requiredPayment = this._config.defaultPayment;
    } else {
      // No handler and no default payment - allow (free)
      requiredPayment = 0n;
    }

    if (amount < requiredPayment) {
      throw new InsufficientPaymentError(requiredPayment, amount);
    }

    this._logger.debug(
      { kind, required: requiredPayment.toString(), received: amount.toString() },
      'Payment validated'
    );
  }

  // ============================================
  // Event Dispatch Logic (Task 5)
  // ============================================

  /**
   * Handle an incoming event by routing to the appropriate handler.
   *
   * @param context - Event handler context
   * @returns Handler result (never throws - errors returned in result)
   * @throws InsufficientPaymentError if payment validation fails
   */
  async handleEvent(context: EventHandlerContext): Promise<EventHandlerResult> {
    const kind = context.event.kind;

    // Validate payment first (throws InsufficientPaymentError if insufficient)
    this._validatePayment(kind, context.amount);

    // Look up handler
    const handlerConfig = this._handlers.get(kind);

    if (!handlerConfig) {
      this._logger.warn({ kind }, 'No handler registered for event kind');
      return {
        success: false,
        error: {
          code: 'F99',
          message: 'Unsupported event kind',
        },
      };
    }

    // Execute handler with error handling
    try {
      const result = await handlerConfig.handler(context);

      // Validate result
      if (!result || typeof result.success !== 'boolean') {
        this._logger.error({ kind }, 'Handler returned invalid result');
        return {
          success: false,
          error: {
            code: 'T00',
            message: 'Handler execution failed',
          },
        };
      }

      this._logger.info({ kind, success: result.success }, 'Event handled');
      return result;
    } catch (err) {
      this._logger.error({ err, kind }, 'Handler execution failed');
      return {
        success: false,
        error: {
          code: 'T00',
          message: 'Handler execution failed',
        },
      };
    }
  }

  // ============================================
  // ILP Rejection Helpers (Task 6)
  // ============================================

  /**
   * Create an ILP reject packet for insufficient payment errors.
   *
   * @param error - The InsufficientPaymentError
   * @param triggeredBy - Address of connector generating the error
   * @returns ILP reject packet with F03 error code
   */
  createPaymentReject(error: InsufficientPaymentError, triggeredBy: ILPAddress): ILPRejectPacket {
    return {
      type: PacketType.REJECT,
      code: ILPErrorCode.F03_INVALID_AMOUNT,
      triggeredBy,
      message: error.message,
      data: Buffer.from(
        JSON.stringify({
          required: error.required.toString(),
          received: error.received.toString(),
        })
      ),
    };
  }

  /**
   * Create a generic ILP reject packet.
   *
   * @param code - ILP error code
   * @param message - Human-readable error message
   * @param triggeredBy - Address of connector generating the error
   * @returns ILP reject packet
   */
  createErrorReject(code: ILPErrorCode, message: string, triggeredBy: ILPAddress): ILPRejectPacket {
    return {
      type: PacketType.REJECT,
      code,
      triggeredBy,
      message,
      data: Buffer.alloc(0),
    };
  }
}
