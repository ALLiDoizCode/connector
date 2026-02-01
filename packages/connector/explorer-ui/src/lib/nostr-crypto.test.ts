// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import {
  createGiftwrap,
  unwrapGiftwrap,
  extractGiftwrapLayers,
  getRandomTimestamp,
} from './nostr-crypto';

describe('getRandomTimestamp', () => {
  it('should generate timestamp within ±N days', () => {
    const offsetDays = 2;
    const now = Math.floor(Date.now() / 1000);
    const twoDaysInSeconds = offsetDays * 24 * 60 * 60;

    const timestamp = getRandomTimestamp(offsetDays);

    // Verify timestamp within ±2 days
    expect(timestamp).toBeGreaterThan(now - twoDaysInSeconds);
    expect(timestamp).toBeLessThan(now + twoDaysInSeconds);
  });

  it('should generate different timestamps on subsequent calls', () => {
    const ts1 = getRandomTimestamp(2);
    const ts2 = getRandomTimestamp(2);

    // While theoretically possible to match, practically very unlikely
    expect(ts1).not.toBe(ts2);
  });
});

describe('createGiftwrap', () => {
  it('should create valid NIP-59 giftwrap event', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(generateSecretKey());
    const message = 'Secret message';

    const giftwrap = createGiftwrap(message, recipientPublicKey, senderPrivateKey);

    // Verify kind 1059
    expect(giftwrap.kind).toBe(1059);

    // Verify ephemeral pubkey (different from sender's real pubkey)
    const senderRealPubkey = getPublicKey(senderPrivateKey);
    expect(giftwrap.pubkey).not.toBe(senderRealPubkey);

    // Verify signature valid
    expect(verifyEvent(giftwrap)).toBe(true);

    // Verify recipient tag
    expect(giftwrap.tags).toContainEqual(['p', recipientPublicKey]);

    // Verify content is encrypted (not plaintext)
    expect(giftwrap.content).not.toBe(message);
    expect(giftwrap.content.length).toBeGreaterThan(0);
  });

  it('should randomize timestamp ±2 days', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(generateSecretKey());
    const message = 'Test message';

    const giftwrap = createGiftwrap(message, recipientPublicKey, senderPrivateKey);

    const now = Math.floor(Date.now() / 1000);
    const twoDays = 2 * 24 * 60 * 60;

    // Verify timestamp within ±2 days
    expect(giftwrap.created_at).toBeGreaterThan(now - twoDays);
    expect(giftwrap.created_at).toBeLessThan(now + twoDays);
  });

  it('should use different ephemeral keys for each message', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(generateSecretKey());

    const giftwrap1 = createGiftwrap('Message 1', recipientPublicKey, senderPrivateKey);
    const giftwrap2 = createGiftwrap('Message 2', recipientPublicKey, senderPrivateKey);

    // Ephemeral pubkeys should be different
    expect(giftwrap1.pubkey).not.toBe(giftwrap2.pubkey);
  });

  it('should handle empty message', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(generateSecretKey());

    const giftwrap = createGiftwrap('', recipientPublicKey, senderPrivateKey);

    expect(giftwrap.kind).toBe(1059);
    expect(verifyEvent(giftwrap)).toBe(true);
  });
});

describe('unwrapGiftwrap', () => {
  it('should decrypt giftwrap and return original message', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);
    const message = 'Secret message';

    // Encrypt
    const giftwrap = createGiftwrap(message, recipientPubkey, senderKey);

    // Decrypt
    const decrypted = unwrapGiftwrap(giftwrap, recipientKey);

    expect(decrypted).toBe(message);
  });

  it('should handle empty message roundtrip', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);
    const message = '';

    const giftwrap = createGiftwrap(message, recipientPubkey, senderKey);
    const decrypted = unwrapGiftwrap(giftwrap, recipientKey);

    expect(decrypted).toBe(message);
  });

  it('should handle long message roundtrip', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);
    const message = 'A'.repeat(10000); // 10KB message

    const giftwrap = createGiftwrap(message, recipientPubkey, senderKey);
    const decrypted = unwrapGiftwrap(giftwrap, recipientKey);

    expect(decrypted).toBe(message);
  });

  it('should throw error on invalid decryption key', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);
    const wrongKey = generateSecretKey(); // Different recipient

    const giftwrap = createGiftwrap('msg', recipientPubkey, senderKey);

    expect(() => unwrapGiftwrap(giftwrap, wrongKey)).toThrow(
      /Failed to unwrap giftwrap/
    );
  });

  it('should throw error on malformed giftwrap event', () => {
    const recipientKey = generateSecretKey();
    const malformedGiftwrap = {
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', 'invalid']],
      content: 'not-encrypted-content',
      pubkey: 'invalid-pubkey',
      id: 'invalid-id',
      sig: 'invalid-sig',
    };

    expect(() => unwrapGiftwrap(malformedGiftwrap as NostrEvent, recipientKey)).toThrow(
      /Failed to unwrap giftwrap/
    );
  });
});

describe('extractGiftwrapLayers', () => {
  it('should extract all 3 layers with correct metadata', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);
    const message = 'Test message';

    const giftwrap = createGiftwrap(message, recipientPubkey, senderKey);
    const layers = extractGiftwrapLayers(giftwrap, recipientKey);

    // Layer 3: Gift wrap
    expect(layers.layer3.kind).toBe(1059);
    expect(layers.layer3.isEphemeral).toBe(true);
    expect(layers.layer3.pubkey).toBe(giftwrap.pubkey);
    expect(layers.layer3.timestamp).toBe(giftwrap.created_at);

    // Layer 2: Seal
    expect(layers.layer2.kind).toBe(13);
    expect(layers.layer2.isSigned).toBe(true);
    expect(layers.layer2.pubkey).toBe(getPublicKey(senderKey)); // Real sender
    expect(layers.layer2.signature).toBeTruthy();

    // Layer 1: Rumor
    expect(layers.layer1.kind).toBe(14);
    expect(layers.layer1.isUnsigned).toBe(true);
    expect(layers.layer1.content).toBe(message);
    expect(layers.layer1.signature).toBeNull();
  });

  it('should verify ephemeral key is different from sender key', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);

    const giftwrap = createGiftwrap('msg', recipientPubkey, senderKey);
    const layers = extractGiftwrapLayers(giftwrap, recipientKey);

    const senderPubkey = getPublicKey(senderKey);

    // Layer 3 pubkey (ephemeral) should differ from Layer 2 pubkey (real sender)
    expect(layers.layer3.pubkey).not.toBe(senderPubkey);
    expect(layers.layer2.pubkey).toBe(senderPubkey);
  });

  it('should throw error with wrong decryption key', () => {
    const senderKey = generateSecretKey();
    const recipientKey = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientKey);
    const wrongKey = generateSecretKey();

    const giftwrap = createGiftwrap('msg', recipientPubkey, senderKey);

    expect(() => extractGiftwrapLayers(giftwrap, wrongKey)).toThrow();
  });
});
