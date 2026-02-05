/**
 * STREAM Fulfillment Computation Tests
 *
 * Tests for RFC-0029 STREAM fulfillment and condition computation.
 */

import {
  computeFulfillment,
  computeCondition,
  computeExpectedCondition,
  verifyCondition,
  deriveFulfillmentKey,
  generateSharedSecret,
  generatePaymentId,
} from './fulfillment';
import * as crypto from 'crypto';

describe('STREAM Fulfillment', () => {
  describe('generateSharedSecret', () => {
    it('should generate a 32-byte buffer', () => {
      const secret = generateSharedSecret();
      expect(Buffer.isBuffer(secret)).toBe(true);
      expect(secret.length).toBe(32);
    });

    it('should generate unique secrets', () => {
      const secret1 = generateSharedSecret();
      const secret2 = generateSharedSecret();
      expect(secret1.equals(secret2)).toBe(false);
    });
  });

  describe('generatePaymentId', () => {
    it('should generate URL-safe base64 string by default', () => {
      const paymentId = generatePaymentId();
      expect(typeof paymentId).toBe('string');
      expect(paymentId.length).toBeGreaterThan(0);
      // URL-safe base64 should not contain + or /
      expect(paymentId).not.toMatch(/[+/]/);
    });

    it('should respect custom length', () => {
      const paymentId8 = generatePaymentId(8);
      const paymentId32 = generatePaymentId(32);
      // base64url encoding: 4 chars per 3 bytes
      expect(paymentId8.length).toBeLessThan(paymentId32.length);
    });
  });

  describe('deriveFulfillmentKey', () => {
    it('should derive key using HMAC-SHA256 with ILP_STREAM_FULFILLMENT', () => {
      const sharedSecret = Buffer.alloc(32, 0x01);
      const key = deriveFulfillmentKey(sharedSecret);

      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);

      // Verify derivation is deterministic
      const key2 = deriveFulfillmentKey(sharedSecret);
      expect(key.equals(key2)).toBe(true);
    });

    it('should produce different keys for different secrets', () => {
      const secret1 = Buffer.alloc(32, 0x01);
      const secret2 = Buffer.alloc(32, 0x02);

      const key1 = deriveFulfillmentKey(secret1);
      const key2 = deriveFulfillmentKey(secret2);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('computeFulfillment', () => {
    it('should compute deterministic fulfillment', () => {
      const sharedSecret = Buffer.alloc(32, 0xaa);
      const prepareData = Buffer.from('test packet data');

      const fulfillment1 = computeFulfillment(sharedSecret, prepareData);
      const fulfillment2 = computeFulfillment(sharedSecret, prepareData);

      expect(fulfillment1.length).toBe(32);
      expect(fulfillment1.equals(fulfillment2)).toBe(true);
    });

    it('should produce different fulfillments for different data', () => {
      const sharedSecret = Buffer.alloc(32, 0xaa);
      const data1 = Buffer.from('packet 1');
      const data2 = Buffer.from('packet 2');

      const fulfillment1 = computeFulfillment(sharedSecret, data1);
      const fulfillment2 = computeFulfillment(sharedSecret, data2);

      expect(fulfillment1.equals(fulfillment2)).toBe(false);
    });

    it('should match RFC-0029 algorithm', () => {
      // Per RFC-0029:
      // hmac_key = HMAC-SHA256(shared_secret, "ilp_stream_fulfillment")
      // fulfillment = HMAC-SHA256(hmac_key, prepare.data)

      const sharedSecret = Buffer.alloc(32, 0x55);
      const prepareData = Buffer.from('test');

      const hmacKey = crypto
        .createHmac('sha256', sharedSecret)
        .update('ilp_stream_fulfillment')
        .digest();
      const expectedFulfillment = crypto.createHmac('sha256', hmacKey).update(prepareData).digest();

      const fulfillment = computeFulfillment(sharedSecret, prepareData);
      expect(fulfillment.equals(expectedFulfillment)).toBe(true);
    });
  });

  describe('computeCondition', () => {
    it('should compute SHA-256 hash of fulfillment', () => {
      const fulfillment = Buffer.alloc(32, 0xbb);
      const condition = computeCondition(fulfillment);

      expect(condition.length).toBe(32);

      const expectedCondition = crypto.createHash('sha256').update(fulfillment).digest();
      expect(condition.equals(expectedCondition)).toBe(true);
    });
  });

  describe('computeExpectedCondition', () => {
    it('should compute condition from shared secret and data', () => {
      const sharedSecret = Buffer.alloc(32, 0xcc);
      const prepareData = Buffer.from('test data');

      const condition = computeExpectedCondition(sharedSecret, prepareData);

      // Should equal SHA256(computeFulfillment(...))
      const fulfillment = computeFulfillment(sharedSecret, prepareData);
      const expectedCondition = computeCondition(fulfillment);

      expect(condition.equals(expectedCondition)).toBe(true);
    });
  });

  describe('verifyCondition', () => {
    it('should return true for matching condition', () => {
      const sharedSecret = Buffer.alloc(32, 0xdd);
      const prepareData = Buffer.from('payment data');

      const fulfillment = computeFulfillment(sharedSecret, prepareData);
      const condition = computeCondition(fulfillment);

      const result = verifyCondition(sharedSecret, prepareData, condition);
      expect(result).toBe(true);
    });

    it('should return false for non-matching condition', () => {
      const sharedSecret = Buffer.alloc(32, 0xdd);
      const prepareData = Buffer.from('payment data');

      const wrongCondition = Buffer.alloc(32, 0xff);

      const result = verifyCondition(sharedSecret, prepareData, wrongCondition);
      expect(result).toBe(false);
    });

    it('should return false for tampered data', () => {
      const sharedSecret = Buffer.alloc(32, 0xee);
      const originalData = Buffer.from('original');

      const fulfillment = computeFulfillment(sharedSecret, originalData);
      const condition = computeCondition(fulfillment);

      const tamperedData = Buffer.from('tampered');
      const result = verifyCondition(sharedSecret, tamperedData, condition);
      expect(result).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      // This test ensures we're using timingSafeEqual
      // We can't easily test timing, but we verify correctness
      const sharedSecret = generateSharedSecret();
      const prepareData = Buffer.from('test');

      const condition = computeExpectedCondition(sharedSecret, prepareData);

      // Create a condition that differs only in the last byte
      const almostMatchingCondition = Buffer.from(condition);
      const lastByte = almostMatchingCondition[31];
      if (lastByte !== undefined) {
        almostMatchingCondition[31] = lastByte ^ 0x01;
      }

      expect(verifyCondition(sharedSecret, prepareData, condition)).toBe(true);
      expect(verifyCondition(sharedSecret, prepareData, almostMatchingCondition)).toBe(false);
    });
  });
});
