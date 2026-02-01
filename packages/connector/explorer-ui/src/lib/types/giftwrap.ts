import { type Event as NostrEvent } from 'nostr-tools/pure';

/** NIP-59 Gift Wrap event (kind 1059) */
export interface GiftwrapEvent extends NostrEvent {
  kind: 1059;
  pubkey: string; // Ephemeral pubkey (NOT sender's real key)
  created_at: number; // Randomized timestamp ±2 days
  tags: [['p', string]]; // Recipient pubkey
  content: string; // Encrypted seal (Layer 2)
}

/** NIP-59 Seal event (kind 13) */
export interface SealEvent extends NostrEvent {
  kind: 13;
  pubkey: string; // Sender's real pubkey
  content: string; // Encrypted rumor (Layer 1)
  sig: string; // Signature proving sender identity
}

/** NIP-59 Rumor event (kind 14, unsigned) */
export interface RumorEvent {
  kind: 14;
  created_at: number;
  tags: [['p', string]]; // Recipient pubkey
  content: string; // Plaintext message
  pubkey: string; // Sender's pubkey (from seal)
  // NO signature - deniable message
}

/** Encryption layer metadata for UI visualization */
export interface EncryptionLayers {
  layer1: {
    kind: 14;
    content: string;
    signature: null;
    isUnsigned: true;
  };
  layer2: {
    kind: 13;
    pubkey: string;
    signature: string;
    isSigned: true;
  };
  layer3: {
    kind: 1059;
    pubkey: string; // Ephemeral
    timestamp: number; // Randomized
    isEphemeral: true;
  };
}

/** Encryption status for real-time UI updates */
export type EncryptionStatus =
  | 'idle'
  | 'creating-rumor'
  | 'sealing'
  | 'wrapping'
  | 'unwrapping'
  | 'unsealing'
  | 'complete'
  | 'error';
