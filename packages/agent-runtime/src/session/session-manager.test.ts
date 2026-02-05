/**
 * Session Manager Tests
 */

import { SessionManager } from './session-manager';
import pino from 'pino';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let logger: pino.Logger;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    sessionManager = new SessionManager(
      {
        baseAddress: 'g.test.agent',
        sessionTtlMs: 60000, // 1 minute for testing
        cleanupIntervalMs: 10000, // 10 seconds for testing
      },
      logger
    );
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  describe('createSession', () => {
    it('should create a session with unique payment ID', () => {
      const session = sessionManager.createSession();

      expect(session.paymentId).toBeDefined();
      expect(typeof session.paymentId).toBe('string');
      expect(session.paymentId.length).toBeGreaterThan(0);
    });

    it('should create a session with 32-byte shared secret', () => {
      const session = sessionManager.createSession();

      expect(Buffer.isBuffer(session.sharedSecret)).toBe(true);
      expect(session.sharedSecret.length).toBe(32);
    });

    it('should generate correct destination address', () => {
      const session = sessionManager.createSession();

      expect(session.destinationAddress).toBe(`g.test.agent.${session.paymentId}`);
    });

    it('should set expiration time', () => {
      const beforeCreate = new Date();
      const session = sessionManager.createSession();
      const afterCreate = new Date();

      expect(session.createdAt).toBeDefined();
      expect(session.expiresAt).toBeDefined();
      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
      expect(session.expiresAt!.getTime()).toBe(session.createdAt.getTime() + 60000);
    });

    it('should accept custom metadata', () => {
      const metadata = { userId: 'user123', productId: 'prod456' };
      const session = sessionManager.createSession(metadata);

      expect(session.metadata).toEqual(metadata);
    });

    it('should accept custom payment ID', () => {
      const customId = 'my-custom-payment-id';
      const session = sessionManager.createSession(undefined, customId);

      expect(session.paymentId).toBe(customId);
      expect(session.destinationAddress).toBe(`g.test.agent.${customId}`);
    });

    it('should increment session count', () => {
      expect(sessionManager.sessionCount).toBe(0);

      sessionManager.createSession();
      expect(sessionManager.sessionCount).toBe(1);

      sessionManager.createSession();
      expect(sessionManager.sessionCount).toBe(2);
    });
  });

  describe('getSession', () => {
    it('should retrieve existing session by payment ID', () => {
      const created = sessionManager.createSession();
      const retrieved = sessionManager.getSession(created.paymentId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.paymentId).toBe(created.paymentId);
      expect(retrieved?.sharedSecret.equals(created.sharedSecret)).toBe(true);
    });

    it('should return undefined for non-existent session', () => {
      const result = sessionManager.getSession('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined for expired session', () => {
      // Create a session manager with very short TTL
      const shortTtlManager = new SessionManager(
        {
          baseAddress: 'g.test.agent',
          sessionTtlMs: 1, // 1ms TTL
        },
        logger
      );

      const session = shortTtlManager.createSession();

      // Wait for expiry
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortTtlManager.getSession(session.paymentId);
          expect(result).toBeUndefined();
          shortTtlManager.shutdown();
          resolve();
        }, 10);
      });
    });
  });

  describe('getSessionByAddress', () => {
    it('should retrieve session by full destination address', () => {
      const created = sessionManager.createSession();
      const retrieved = sessionManager.getSessionByAddress(created.destinationAddress);

      expect(retrieved).toBeDefined();
      expect(retrieved?.paymentId).toBe(created.paymentId);
    });

    it('should return undefined for non-matching base address', () => {
      const created = sessionManager.createSession();
      const result = sessionManager.getSessionByAddress(`g.other.prefix.${created.paymentId}`);

      expect(result).toBeUndefined();
    });

    it('should return undefined for malformed address', () => {
      sessionManager.createSession();

      expect(sessionManager.getSessionByAddress('')).toBeUndefined();
      expect(sessionManager.getSessionByAddress('invalid')).toBeUndefined();
      expect(sessionManager.getSessionByAddress('g.test.agent')).toBeUndefined();
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', () => {
      const session = sessionManager.createSession();
      expect(sessionManager.sessionCount).toBe(1);

      const deleted = sessionManager.deleteSession(session.paymentId);

      expect(deleted).toBe(true);
      expect(sessionManager.sessionCount).toBe(0);
      expect(sessionManager.getSession(session.paymentId)).toBeUndefined();
    });

    it('should return false for non-existent session', () => {
      const deleted = sessionManager.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('updateSessionMetadata', () => {
    it('should merge new metadata with existing', () => {
      const session = sessionManager.createSession({ key1: 'value1' });
      const updated = sessionManager.updateSessionMetadata(session.paymentId, {
        key2: 'value2',
      });

      expect(updated).toBeDefined();
      expect(updated?.metadata).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should override existing keys', () => {
      const session = sessionManager.createSession({ key1: 'old' });
      const updated = sessionManager.updateSessionMetadata(session.paymentId, {
        key1: 'new',
      });

      expect(updated?.metadata?.key1).toBe('new');
    });

    it('should return undefined for non-existent session', () => {
      const result = sessionManager.updateSessionMetadata('non-existent', { key: 'value' });
      expect(result).toBeUndefined();
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should remove expired sessions', () => {
      // Create manager with 1ms TTL
      const shortTtlManager = new SessionManager(
        {
          baseAddress: 'g.test.agent',
          sessionTtlMs: 1,
          cleanupIntervalMs: 1000000, // Long interval to avoid auto-cleanup
        },
        logger
      );

      shortTtlManager.createSession();
      shortTtlManager.createSession();
      expect(shortTtlManager.sessionCount).toBe(2);

      // Wait for expiry then cleanup
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cleaned = shortTtlManager.cleanupExpiredSessions();
          expect(cleaned).toBe(2);
          expect(shortTtlManager.sessionCount).toBe(0);
          shortTtlManager.shutdown();
          resolve();
        }, 10);
      });
    });
  });

  describe('shutdown', () => {
    it('should clear all sessions', () => {
      sessionManager.createSession();
      sessionManager.createSession();
      expect(sessionManager.sessionCount).toBe(2);

      sessionManager.shutdown();

      expect(sessionManager.sessionCount).toBe(0);
    });
  });
});
