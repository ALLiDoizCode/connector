/**
 * Session Manager
 *
 * Manages payment sessions with shared secrets for STREAM fulfillment computation.
 * Sessions are stored in-memory with optional TTL expiration.
 */

import { Logger } from 'pino';
import { PaymentSession } from '../types';
import { generateSharedSecret, generatePaymentId } from '../stream/fulfillment';

export interface SessionManagerConfig {
  /** ILP address prefix for payment destinations */
  baseAddress: string;
  /** Session TTL in milliseconds (default: 1 hour) */
  sessionTtlMs: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs?: number;
}

/**
 * In-memory session storage with TTL expiration.
 */
export class SessionManager {
  private sessions: Map<string, PaymentSession> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly config: Required<SessionManagerConfig>;
  private readonly logger: Logger;

  constructor(config: SessionManagerConfig, logger: Logger) {
    this.config = {
      ...config,
      cleanupIntervalMs: config.cleanupIntervalMs ?? 300000, // 5 minutes
    };
    this.logger = logger.child({ component: 'SessionManager' });

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Create a new payment session.
   *
   * @param metadata - Optional metadata to attach to the session
   * @param customPaymentId - Optional custom payment ID
   * @returns The created payment session
   */
  createSession(metadata?: Record<string, string>, customPaymentId?: string): PaymentSession {
    const paymentId = customPaymentId ?? generatePaymentId();
    const sharedSecret = generateSharedSecret();
    const destinationAddress = `${this.config.baseAddress}.${paymentId}`;

    const now = new Date();
    const session: PaymentSession = {
      paymentId,
      sharedSecret,
      destinationAddress,
      metadata,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlMs),
    };

    this.sessions.set(paymentId, session);

    this.logger.debug(
      { paymentId, destinationAddress, expiresAt: session.expiresAt },
      'Created payment session'
    );

    return session;
  }

  /**
   * Get a session by payment ID.
   *
   * @param paymentId - The payment ID to look up
   * @returns The session if found and not expired, undefined otherwise
   */
  getSession(paymentId: string): PaymentSession | undefined {
    const session = this.sessions.get(paymentId);

    if (!session) {
      return undefined;
    }

    // Check if expired
    if (session.expiresAt && session.expiresAt < new Date()) {
      this.logger.debug({ paymentId }, 'Session expired');
      this.sessions.delete(paymentId);
      return undefined;
    }

    return session;
  }

  /**
   * Get a session by destination address.
   *
   * Extracts the payment ID from the address suffix and looks up the session.
   *
   * @param destinationAddress - Full ILP destination address
   * @returns The session if found, undefined otherwise
   */
  getSessionByAddress(destinationAddress: string): PaymentSession | undefined {
    // Extract payment ID from address (last segment after base address)
    if (!destinationAddress.startsWith(this.config.baseAddress + '.')) {
      return undefined;
    }

    const paymentId = destinationAddress.slice(this.config.baseAddress.length + 1);
    return this.getSession(paymentId);
  }

  /**
   * Delete a session by payment ID.
   *
   * @param paymentId - The payment ID to delete
   * @returns true if the session was deleted, false if not found
   */
  deleteSession(paymentId: string): boolean {
    const deleted = this.sessions.delete(paymentId);
    if (deleted) {
      this.logger.debug({ paymentId }, 'Deleted payment session');
    }
    return deleted;
  }

  /**
   * Update session metadata.
   *
   * @param paymentId - The payment ID to update
   * @param metadata - New metadata to merge with existing
   * @returns The updated session if found, undefined otherwise
   */
  updateSessionMetadata(
    paymentId: string,
    metadata: Record<string, string>
  ): PaymentSession | undefined {
    const session = this.getSession(paymentId);
    if (!session) {
      return undefined;
    }

    session.metadata = { ...session.metadata, ...metadata };
    return session;
  }

  /**
   * Get the number of active sessions.
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up expired sessions.
   *
   * @returns Number of sessions cleaned up
   */
  cleanupExpiredSessions(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [paymentId, session] of this.sessions) {
      if (session.expiresAt && session.expiresAt < now) {
        this.sessions.delete(paymentId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned up expired sessions');
    }

    return cleaned;
  }

  /**
   * Start the periodic cleanup timer.
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.config.cleanupIntervalMs);

    // Don't keep process alive just for cleanup
    this.cleanupTimer.unref();
  }

  /**
   * Stop the cleanup timer and clear all sessions.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
    this.logger.debug('Session manager shut down');
  }
}
