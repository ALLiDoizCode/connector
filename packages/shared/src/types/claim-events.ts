/**
 * Claim Event Kind Definitions & Types (Epic 30 Story 30.1)
 *
 * This module defines Nostr event kinds 30001-30003 for balance proof exchange
 * across payment channels on EVM, XRP, and Aptos chains.
 *
 * Event kinds are in the NIP-01 "Replaceable Parameterized" range (30000-39999),
 * making claims replaceable by channel identifier (using the 'd' tag).
 */

// ============================================================================
// Event Kind Constants (Task 1)
// ============================================================================

/** EVM claim event kind (EIP-712 signatures) */
export const CLAIM_EVENT_EVM = 30001;

/** XRP claim event kind (ed25519 signatures) */
export const CLAIM_EVENT_XRP = 30002;

/** Aptos claim event kind (ed25519/BCS signatures) */
export const CLAIM_EVENT_APTOS = 30003;

/** All claim event kinds */
export const CLAIM_EVENT_KINDS = [CLAIM_EVENT_EVM, CLAIM_EVENT_XRP, CLAIM_EVENT_APTOS] as const;

/** Claim chain type */
export type ClaimChain = 'evm' | 'xrp' | 'aptos';

// ============================================================================
// EVM Claim Interfaces (Task 2)
// ============================================================================

/**
 * EVM signed claim extracted from Nostr event tags
 * Uses EIP-712 typed data signature format
 */
export interface EVMSignedClaim {
  chain: 'evm';
  /** bytes32 channel identifier */
  channelId: string;
  /** Cumulative amount transferred to counterparty (token units) */
  transferredAmount: bigint;
  /** Monotonically increasing nonce (REQUIRED for EVM) */
  nonce: number;
  /** Amount locked in pending conditional transfers */
  lockedAmount: bigint;
  /** bytes32 Merkle root of hash-locked transfers */
  locksRoot: string;
  /** EIP-712 signature (hex with 0x prefix) */
  signature: string;
  /** Ethereum address of signer (hex with 0x prefix) */
  signer: string;
}

/**
 * Unsigned EVM claim request for peer to sign
 */
export interface EVMClaimRequest {
  chain: 'evm';
  channelId: string;
  amount: bigint;
  nonce: number;
}

// ============================================================================
// XRP Claim Interfaces (Task 3)
// ============================================================================

/**
 * XRP signed claim extracted from Nostr event tags
 * Uses ed25519 signatures per XRP Ledger spec
 *
 * Note: XRP payment channels do NOT use nonces.
 * The amount field is cumulative and must increase monotonically.
 */
export interface XRPSignedClaim {
  chain: 'xrp';
  /** 64-character hex channel ID */
  channelId: string;
  /** Cumulative amount in drops (monotonically increasing) */
  amount: bigint;
  /** ed25519 signature (128 hex characters) */
  signature: string;
  /** ed25519 public key (66 hex chars, ED prefix) */
  signer: string;
}

/**
 * Unsigned XRP claim request for peer to sign
 * Note: No nonce field - XRP uses amount for monotonicity
 */
export interface XRPClaimRequest {
  chain: 'xrp';
  channelId: string;
  amount: bigint;
}

// ============================================================================
// Aptos Claim Interfaces (Task 4)
// ============================================================================

/**
 * Aptos signed claim extracted from Nostr event tags
 * Uses ed25519 signatures with BCS encoding
 */
export interface AptosSignedClaim {
  chain: 'aptos';
  /** Channel owner address (0x-prefixed, identifies channel) */
  channelOwner: string;
  /** Amount in octas (1 APT = 100,000,000 octas) */
  amount: bigint;
  /** Monotonically increasing nonce (REQUIRED for Aptos) */
  nonce: number;
  /** ed25519 signature (128 hex characters) */
  signature: string;
  /** ed25519 public key (64 hex characters) */
  signer: string;
}

/**
 * Unsigned Aptos claim request for peer to sign
 */
export interface AptosClaimRequest {
  chain: 'aptos';
  channelOwner: string;
  amount: bigint;
  nonce: number;
}

// ============================================================================
// Union Types (Task 5)
// ============================================================================

/** Union of all chain-specific signed claims */
export type SignedClaim = EVMSignedClaim | XRPSignedClaim | AptosSignedClaim;

/** Union of all chain-specific claim requests */
export type ClaimRequest = EVMClaimRequest | XRPClaimRequest | AptosClaimRequest;

// ============================================================================
// Type Guards (Task 5)
// ============================================================================

/**
 * Check if event kind is a claim event kind
 */
export function isClaimEventKind(kind: number): kind is (typeof CLAIM_EVENT_KINDS)[number] {
  return CLAIM_EVENT_KINDS.includes(kind as (typeof CLAIM_EVENT_KINDS)[number]);
}

/**
 * Get chain type from event kind
 */
export function getChainFromEventKind(kind: number): ClaimChain | null {
  switch (kind) {
    case CLAIM_EVENT_EVM:
      return 'evm';
    case CLAIM_EVENT_XRP:
      return 'xrp';
    case CLAIM_EVENT_APTOS:
      return 'aptos';
    default:
      return null;
  }
}

/**
 * Get event kind from chain type
 */
export function getEventKindFromChain(chain: ClaimChain): number {
  switch (chain) {
    case 'evm':
      return CLAIM_EVENT_EVM;
    case 'xrp':
      return CLAIM_EVENT_XRP;
    case 'aptos':
      return CLAIM_EVENT_APTOS;
  }
}

/** Type guard for EVM signed claim */
export function isEVMSignedClaim(claim: SignedClaim): claim is EVMSignedClaim {
  return claim.chain === 'evm';
}

/** Type guard for XRP signed claim */
export function isXRPSignedClaim(claim: SignedClaim): claim is XRPSignedClaim {
  return claim.chain === 'xrp';
}

/** Type guard for Aptos signed claim */
export function isAptosSignedClaim(claim: SignedClaim): claim is AptosSignedClaim {
  return claim.chain === 'aptos';
}

// ============================================================================
// Nostr Event Structure (Task 6)
// ============================================================================

/**
 * Standard Nostr event structure (NIP-01)
 * Extended with claim-specific tag structure
 */
export interface NostrClaimEvent {
  /** Event ID (32-byte SHA256 hash, 64-character hex) */
  id: string;
  /** Author public key (32-byte Schnorr pubkey, 64-character hex) */
  pubkey: string;
  /** Event kind: 30001 (EVM), 30002 (XRP), or 30003 (Aptos) */
  kind: (typeof CLAIM_EVENT_KINDS)[number];
  /** Unix timestamp (seconds since epoch) */
  created_at: number;
  /** Wrapped message content (original text or nested event JSON) */
  content: string;
  /** Claim tags following chain-specific schema */
  tags: string[][];
  /** Schnorr signature (64-byte, 128-character hex) */
  sig: string;
}

/** Claim event tag names */
export const CLAIM_TAG = {
  /** Replaceable event identifier (d tag per NIP-01) */
  IDENTIFIER: 'd',
  /** Chain type (evm, xrp, aptos) */
  CHAIN: 'claim-chain',
  /** Channel identifier (format varies by chain) */
  CHANNEL: 'channel',
  /** Transfer/claim amount */
  AMOUNT: 'amount',
  /** Nonce for EVM/Aptos (not used for XRP) */
  NONCE: 'nonce',
  /** Locked amount (EVM only) */
  LOCKED: 'locked',
  /** Locks merkle root (EVM only) */
  LOCKS_ROOT: 'locks-root',
  /** Chain-specific signature */
  SIGNATURE: 'chain-sig',
  /** Signer address/pubkey */
  SIGNER: 'signer',
  /** Request chain (for unsigned requests) */
  REQUEST_CHAIN: 'request-chain',
  /** Request channel (for unsigned requests) */
  REQUEST_CHANNEL: 'request-channel',
  /** Request amount (for unsigned requests) */
  REQUEST_AMOUNT: 'request-amount',
  /** Request nonce (for unsigned requests, EVM/Aptos only) */
  REQUEST_NONCE: 'request-nonce',
} as const;

// ============================================================================
// Chain-Specific Monotonicity Documentation (Task 9)
// ============================================================================

/**
 * Chain-Specific Monotonicity Rules
 *
 * | Chain | Monotonic Field | Enforcement Rule |
 * |-------|-----------------|------------------|
 * | EVM   | nonce           | New nonce must be > stored nonce |
 * | XRP   | amount          | New amount must be > stored amount (cumulative balance) |
 * | Aptos | nonce           | New nonce must be > stored nonce |
 *
 * These rules MUST be enforced by ClaimStore (Story 30.3) when storing claims.
 */
