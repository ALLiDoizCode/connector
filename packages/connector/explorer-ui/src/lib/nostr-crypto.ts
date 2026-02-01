import { type Event as NostrEvent, type UnsignedEvent, getEventHash, getPublicKey, generateSecretKey as nostrGenerateSecretKey } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1';
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Generate a random timestamp offset by ±offsetDays for metadata protection per NIP-17
 * @param offsetDays Number of days to randomize (e.g., 2 for ±2 days)
 * @returns Unix timestamp randomized within ±offsetDays
 */
export function getRandomTimestamp(offsetDays: number): number {
  const now = Math.floor(Date.now() / 1000);
  const offsetSeconds = offsetDays * 24 * 60 * 60;
  const randomOffset = Math.floor(Math.random() * (2 * offsetSeconds)) - offsetSeconds;
  return now + randomOffset;
}

/**
 * Create a NIP-59 gift wrap event (3-layer encryption)
 *
 * Layer 1: Rumor (kind 14, unsigned, deniable message)
 * Layer 2: Seal (kind 13, encrypt rumor to recipient's pubkey, signed by sender)
 * Layer 3: Gift wrap (kind 1059, ephemeral key, randomized timestamp)
 *
 * @param message Plaintext message to encrypt
 * @param recipientPubkey Recipient's public key (hex string)
 * @param senderPrivateKey Sender's private key (Uint8Array)
 * @returns Object containing all 3 layers: { giftwrap, seal, rumor }
 */
export function createGiftwrap(
  message: string,
  recipientPubkey: string,
  senderPrivateKey: Uint8Array
): {
  giftwrap: NostrEvent;
  seal: NostrEvent;
  rumor: UnsignedEvent;
} {
  // Layer 1: Create rumor (Kind 14, unsigned, deniable message)
  const rumor: UnsignedEvent = {
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: message,
    pubkey: getPublicKey(senderPrivateKey),
  };

  // Layer 2: Create seal (Kind 13, encrypt rumor to recipient's pubkey)
  const sealConversationKey = getConversationKey(senderPrivateKey, recipientPubkey);
  const sealContent = encrypt(JSON.stringify(rumor), sealConversationKey);
  const seal: UnsignedEvent = {
    kind: 13,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: sealContent,
    pubkey: getPublicKey(senderPrivateKey),
  };

  // Sign seal with sender's real key
  const sealId = getEventHash(seal);
  const sealSig = schnorr.sign(sealId, senderPrivateKey);
  const signedSeal: NostrEvent = {
    ...seal,
    id: sealId,
    sig: bytesToHex(sealSig),
  };

  // Layer 3: Create giftwrap (Kind 1059, ephemeral key, randomized timestamp)
  const ephemeralKey = nostrGenerateSecretKey(); // NEW random key per message
  const randomizedTimestamp = getRandomTimestamp(2); // Randomize ±2 days

  const giftwrapConversationKey = getConversationKey(ephemeralKey, recipientPubkey);
  const giftwrapContent = encrypt(JSON.stringify(signedSeal), giftwrapConversationKey);
  const giftwrap: UnsignedEvent = {
    kind: 1059,
    created_at: randomizedTimestamp,
    tags: [['p', recipientPubkey]],
    content: giftwrapContent,
    pubkey: getPublicKey(ephemeralKey), // Ephemeral pubkey (NOT sender's real key)
  };

  // Sign giftwrap with ephemeral key
  const giftwrapId = getEventHash(giftwrap);
  const giftwrapSig = schnorr.sign(giftwrapId, ephemeralKey);
  const signedGiftwrap: NostrEvent = {
    ...giftwrap,
    id: giftwrapId,
    sig: bytesToHex(giftwrapSig),
  };

  return { giftwrap: signedGiftwrap, seal: signedSeal, rumor };
}

/**
 * Unwrap a NIP-59 gift wrap event to extract the plaintext message
 *
 * @param giftwrap Gift wrap event (kind 1059)
 * @param recipientPrivateKey Recipient's private key (Uint8Array)
 * @returns Plaintext message
 * @throws Error if decryption fails or event is malformed
 */
export function unwrapGiftwrap(giftwrap: NostrEvent, recipientPrivateKey: Uint8Array): string {
  try {
    // Layer 3: Decrypt giftwrap content to extract seal
    const giftwrapConversationKey = getConversationKey(recipientPrivateKey, giftwrap.pubkey);
    const sealEvent: NostrEvent = JSON.parse(
      decrypt(giftwrap.content, giftwrapConversationKey)
    );

    // Layer 2: Decrypt seal content to extract rumor
    const sealConversationKey = getConversationKey(recipientPrivateKey, sealEvent.pubkey);
    const rumorEvent: UnsignedEvent = JSON.parse(
      decrypt(sealEvent.content, sealConversationKey)
    );

    // Layer 1: Extract plaintext message from rumor
    return rumorEvent.content;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to unwrap giftwrap: ${error.message}`);
    }
    throw new Error('Failed to unwrap giftwrap: Unknown error');
  }
}

/**
 * Extract all 3 encryption layers from a giftwrap event for UI visualization
 *
 * @param giftwrap Gift wrap event (kind 1059)
 * @param recipientPrivateKey Recipient's private key (Uint8Array)
 * @returns Full event objects for all 3 layers (giftwrap, seal, rumor)
 */
export function extractGiftwrapLayers(
  giftwrap: NostrEvent,
  recipientPrivateKey: Uint8Array
): {
  giftwrap: NostrEvent;
  seal: NostrEvent;
  rumor: UnsignedEvent;
} {
  // Layer 2: Decrypt to extract seal
  const giftwrapConversationKey = getConversationKey(recipientPrivateKey, giftwrap.pubkey);
  const seal: NostrEvent = JSON.parse(
    decrypt(giftwrap.content, giftwrapConversationKey)
  );

  // Layer 1: Decrypt to extract rumor
  const sealConversationKey = getConversationKey(recipientPrivateKey, seal.pubkey);
  const rumor: UnsignedEvent = JSON.parse(
    decrypt(seal.content, sealConversationKey)
  );

  return { giftwrap, seal, rumor };
}
