/**
 * STREAM Fulfillment Computation
 *
 * Implements STREAM protocol fulfillment and condition computation per RFC-0029.
 * The fulfillment is computed as HMAC-SHA256 of the prepare data using a derived key.
 *
 * @see https://interledger.org/rfcs/0029-stream/
 */

import * as crypto from 'crypto';

/** STREAM fulfillment derivation constant */
const FULFILLMENT_DERIVATION_STRING = 'ilp_stream_fulfillment';

/**
 * Compute the HMAC key for fulfillment derivation.
 *
 * Per RFC-0029, the fulfillment key is derived from the shared secret:
 * hmac_key = HMAC-SHA256(shared_secret, "ilp_stream_fulfillment")
 *
 * @param sharedSecret - 32-byte STREAM shared secret
 * @returns 32-byte HMAC key for fulfillment computation
 */
export function deriveFulfillmentKey(sharedSecret: Buffer): Buffer {
  return crypto.createHmac('sha256', sharedSecret).update(FULFILLMENT_DERIVATION_STRING).digest();
}

/**
 * Compute the fulfillment for a STREAM packet.
 *
 * Per RFC-0029:
 * hmac_key = HMAC-SHA256(shared_secret, "ilp_stream_fulfillment")
 * fulfillment = HMAC-SHA256(hmac_key, prepare.data)
 *
 * @param sharedSecret - 32-byte STREAM shared secret
 * @param prepareData - ILP Prepare packet data field
 * @returns 32-byte fulfillment preimage
 */
export function computeFulfillment(sharedSecret: Buffer, prepareData: Buffer): Buffer {
  const hmacKey = deriveFulfillmentKey(sharedSecret);
  return crypto.createHmac('sha256', hmacKey).update(prepareData).digest();
}

/**
 * Compute the execution condition from a fulfillment.
 *
 * Per ILP protocol, condition = SHA256(fulfillment)
 *
 * @param fulfillment - 32-byte fulfillment preimage
 * @returns 32-byte SHA-256 hash (execution condition)
 */
export function computeCondition(fulfillment: Buffer): Buffer {
  return crypto.createHash('sha256').update(fulfillment).digest();
}

/**
 * Compute the expected condition for a STREAM packet.
 *
 * Convenience function that computes fulfillment then condition.
 *
 * @param sharedSecret - 32-byte STREAM shared secret
 * @param prepareData - ILP Prepare packet data field
 * @returns 32-byte execution condition
 */
export function computeExpectedCondition(sharedSecret: Buffer, prepareData: Buffer): Buffer {
  const fulfillment = computeFulfillment(sharedSecret, prepareData);
  return computeCondition(fulfillment);
}

/**
 * Verify that a condition matches the expected value.
 *
 * Used to sanity-check incoming packets before computing fulfillment.
 *
 * @param sharedSecret - 32-byte STREAM shared secret
 * @param prepareData - ILP Prepare packet data field
 * @param condition - Execution condition from the Prepare packet
 * @returns true if the condition matches, false otherwise
 */
export function verifyCondition(
  sharedSecret: Buffer,
  prepareData: Buffer,
  condition: Buffer
): boolean {
  const expectedCondition = computeExpectedCondition(sharedSecret, prepareData);
  return crypto.timingSafeEqual(expectedCondition, condition);
}

/**
 * Generate a random 32-byte shared secret.
 *
 * Used when creating new payment sessions.
 *
 * @returns Cryptographically random 32-byte buffer
 */
export function generateSharedSecret(): Buffer {
  return crypto.randomBytes(32);
}

/**
 * Generate a random payment ID.
 *
 * Creates a URL-safe base64 string for use as payment identifier.
 *
 * @param length - Number of random bytes (default: 16)
 * @returns URL-safe base64 string
 */
export function generatePaymentId(length: number = 16): string {
  return crypto.randomBytes(length).toString('base64url');
}
