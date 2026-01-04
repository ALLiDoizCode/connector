/**
 * Account Metadata Encoding for TigerBeetle user_data Fields
 *
 * TigerBeetle provides three user_data fields for application-specific metadata:
 * - user_data_128: 128-bit field (bigint)
 * - user_data_64: 64-bit field (bigint)
 * - user_data_32: 32-bit field (number)
 *
 * This module encodes peer account metadata into these fields for:
 * - Future reverse lookups (account ID → peer/token information)
 * - Debugging and analytics
 * - Settlement engine integration
 *
 * Encoding strategy:
 * - user_data_128: nodeId hash (upper 64 bits) + peerId hash (lower 64 bits)
 * - user_data_64: tokenId hash (64 bits)
 * - user_data_32: accountType enum (0 = debit, 1 = credit)
 *
 * Note: Hashing is one-way, so reverse lookup (hash → original string) requires
 * maintaining a separate mapping table (future enhancement).
 *
 * @module settlement/account-metadata
 */

import { createHash } from 'crypto';
import { Account } from 'tigerbeetle-node';
import { AccountType, PeerAccountMetadata } from './types';

/**
 * Encoded metadata for TigerBeetle user_data fields
 */
export interface EncodedAccountMetadata {
  /**
   * user_data_128: nodeId hash (upper 64 bits) + peerId hash (lower 64 bits)
   */
  user_data_128: bigint;

  /**
   * user_data_64: tokenId hash (64 bits)
   */
  user_data_64: bigint;

  /**
   * user_data_32: accountType enum (0 = debit, 1 = credit)
   */
  user_data_32: number;
}

/**
 * Encode peer account metadata into TigerBeetle user_data fields
 *
 * Uses SHA-256 hashing to create deterministic numeric encodings of string metadata.
 * This enables storage of peer/token/account information within TigerBeetle accounts
 * for future reverse lookups or analytics.
 *
 * Encoding details:
 * - nodeId: SHA-256 hash → first 64 bits → upper half of user_data_128
 * - peerId: SHA-256 hash → first 64 bits → lower half of user_data_128
 * - tokenId: SHA-256 hash → first 64 bits → user_data_64
 * - accountType: Direct numeric encoding (0 or 1) → user_data_32
 *
 * Note: Since hashing is one-way, you cannot decode the original strings from
 * the encoded values. For reverse lookup, maintain a separate mapping table.
 *
 * @param metadata - Peer account metadata to encode
 * @returns Encoded metadata for TigerBeetle user_data fields
 *
 * @example
 * const metadata: PeerAccountMetadata = {
 *   nodeId: 'connector-a',
 *   peerId: 'connector-b',
 *   tokenId: 'USD',
 *   accountType: AccountType.DEBIT
 * };
 *
 * const encoded = encodeAccountMetadata(metadata);
 * console.log(encoded);
 * // {
 * //   user_data_128: 123456789012345678901234567890n,
 * //   user_data_64: 987654321098765432n,
 * //   user_data_32: 0
 * // }
 */
export function encodeAccountMetadata(metadata: PeerAccountMetadata): EncodedAccountMetadata {
  // Hash nodeId to 64-bit integer (upper half of user_data_128)
  const nodeIdHash = hashStringTo64Bit(metadata.nodeId);

  // Hash peerId to 64-bit integer (lower half of user_data_128)
  const peerIdHash = hashStringTo64Bit(metadata.peerId);

  // Combine nodeId and peerId hashes into 128-bit field
  // nodeIdHash in upper 64 bits, peerIdHash in lower 64 bits
  const user_data_128 = (nodeIdHash << 64n) | peerIdHash;

  // Hash tokenId to 64-bit integer
  const user_data_64 = hashStringTo64Bit(metadata.tokenId);

  // Encode accountType as numeric enum
  // 0 = DEBIT, 1 = CREDIT
  const user_data_32 = metadata.accountType === AccountType.DEBIT ? 0 : 1;

  return {
    user_data_128,
    user_data_64,
    user_data_32,
  };
}

/**
 * Decode account type from TigerBeetle account user_data fields
 *
 * Extracts the account type from user_data_32 field.
 * Note: Cannot decode nodeId, peerId, or tokenId because hashing is one-way.
 *
 * This partial decoding is useful for:
 * - Filtering accounts by type in analytics queries
 * - Debugging account structure
 * - Validation during account lookups
 *
 * @param account - TigerBeetle account object
 * @returns Account type (DEBIT or CREDIT), or null if not encoded
 *
 * @example
 * const accountType = decodeAccountType(account);
 * console.log(accountType);  // AccountType.DEBIT or AccountType.CREDIT
 */
export function decodeAccountType(account: Account): AccountType | null {
  // Decode accountType from user_data_32
  // 0 = DEBIT, 1 = CREDIT
  if (account.user_data_32 === 0) {
    return AccountType.DEBIT;
  } else if (account.user_data_32 === 1) {
    return AccountType.CREDIT;
  }

  // Not encoded or invalid value
  return null;
}

/**
 * Hash a string to a 64-bit integer using SHA-256
 *
 * Takes first 8 bytes (64 bits) of SHA-256 hash and converts to bigint.
 * This provides deterministic numeric encoding of strings for storage in
 * TigerBeetle user_data fields.
 *
 * @param value - String to hash
 * @returns 64-bit unsigned integer hash
 *
 * @internal
 */
function hashStringTo64Bit(value: string): bigint {
  // Hash string using SHA-256
  const hash = createHash('sha256').update(value).digest();

  // Extract first 8 bytes (64 bits)
  const hash64Bits = hash.subarray(0, 8);

  // Convert to bigint
  const hash64 = BigInt('0x' + hash64Bits.toString('hex'));

  return hash64;
}

/**
 * Validate that encoded metadata values are deterministic
 *
 * Useful for testing to ensure same inputs always produce same encodings.
 *
 * @param encoded1 - First encoded metadata
 * @param encoded2 - Second encoded metadata
 * @returns True if encodings match, false otherwise
 *
 * @example
 * const metadata = { nodeId: 'a', peerId: 'b', tokenId: 'USD', accountType: AccountType.DEBIT };
 * const encoded1 = encodeAccountMetadata(metadata);
 * const encoded2 = encodeAccountMetadata(metadata);
 * console.log(isEncodingDeterministic(encoded1, encoded2));  // true
 */
export function isEncodingDeterministic(
  encoded1: EncodedAccountMetadata,
  encoded2: EncodedAccountMetadata
): boolean {
  return (
    encoded1.user_data_128 === encoded2.user_data_128 &&
    encoded1.user_data_64 === encoded2.user_data_64 &&
    encoded1.user_data_32 === encoded2.user_data_32
  );
}
