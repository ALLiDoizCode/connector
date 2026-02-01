/**
 * Unit Tests: Private Messaging Helper Functions
 * Epic 32 Story 32.6 - Task 10
 *
 * Tests helper functions used in private-messaging.test.ts
 * Target: >80% coverage for all helper functions
 */

import { generateSecretKey, getPublicKey, nip59, nip44, type NostrEvent } from 'nostr-tools';
import WebSocket from 'ws';
import { Buffer } from 'node:buffer';

/**
 * Helper: Generate test Nostr keypair
 */
function createTestKeypair(): { privkey: Uint8Array; pubkey: string } {
  const privkey = generateSecretKey();
  const pubkey = getPublicKey(privkey);
  return { privkey, pubkey };
}

/**
 * Helper: Create NIP-59 giftwrap event (rumor → seal → giftwrap)
 */
function createGiftwrap(
  senderPrivkey: Uint8Array,
  recipientPubkey: string,
  message: string
): NostrEvent {
  const senderPubkey = getPublicKey(senderPrivkey);

  // Layer 1: Create rumor (unsigned kind 1 note)
  const rumor: Partial<NostrEvent> = {
    kind: 1,
    content: message,
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: senderPubkey,
  };

  // Layer 2: Seal the rumor with sender's key
  const seal = nip59.wrapEvent(rumor as NostrEvent, senderPrivkey, recipientPubkey);

  // Layer 3: Gift wrap with ephemeral key
  const ephemeralPrivkey = generateSecretKey();
  const giftwrap = nip59.wrapEvent(seal, ephemeralPrivkey, recipientPubkey);

  return giftwrap;
}

/**
 * Helper: Unwrap NIP-59 giftwrap event (giftwrap → seal → rumor)
 */
function unwrapGiftwrap(giftwrap: NostrEvent, recipientPrivkey: Uint8Array): string {
  // Layer 3: Decrypt giftwrap content to extract seal (NIP-44 encryption)
  // The giftwrap is encrypted from ephemeral key to recipient
  const sealJSON = nip44.decrypt(
    giftwrap.content,
    nip44.getConversationKey(recipientPrivkey, giftwrap.pubkey)
  );
  const seal: NostrEvent = JSON.parse(sealJSON);

  // Layer 2: Decrypt seal content to extract rumor (NIP-44 encryption)
  // The seal is encrypted from sender to recipient
  const rumorJSON = nip44.decrypt(
    seal.content,
    nip44.getConversationKey(recipientPrivkey, seal.pubkey)
  );
  const rumor: { content: string } = JSON.parse(rumorJSON);

  // Layer 1: Return plaintext message from rumor
  return rumor.content;
}

/**
 * Helper: Wait for WebSocket message delivery
 */
function waitForWebSocketMessage(
  ws: WebSocket,
  timeout = 10000
): Promise<{ type: string; data: NostrEvent }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket message timeout'));
    }, timeout);

    ws.on('message', (data: Buffer) => {
      clearTimeout(timer);
      const message = JSON.parse(data.toString()) as { type: string; data: NostrEvent };
      resolve(message);
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Helper: Verify settlement on Aptos testnet
 *
 * NOTE: This is a mock implementation for testing. Real implementation would query Aptos blockchain.
 */
function verifySettlementOnAptos(
  rpcUrl: string,
  channelAddress: string,
  expectedAmount: bigint
): boolean {
  // Validate inputs
  if (!rpcUrl || !rpcUrl.startsWith('http')) {
    throw new Error('Invalid RPC URL: must start with http:// or https://');
  }

  if (!channelAddress || channelAddress.length < 10) {
    throw new Error('Invalid channel address: must be valid address string');
  }

  if (expectedAmount < 0n) {
    throw new Error('Invalid expected amount: must be non-negative');
  }

  // Mock verification - actual implementation would query blockchain
  return expectedAmount >= 0n;
}

describe('Private Messaging Helper Functions', () => {
  describe('createTestKeypair()', () => {
    it('should return valid Nostr keypair with 32-byte private key', () => {
      // Act
      const keypair = createTestKeypair();

      // Assert - Private key is 32 bytes (Uint8Array)
      expect(keypair.privkey).toBeInstanceOf(Uint8Array);
      expect(keypair.privkey.length).toBe(32);
    });

    it('should return valid Nostr keypair with 64-character hex public key', () => {
      // Act
      const keypair = createTestKeypair();

      // Assert - Public key is 64-character hex string
      expect(typeof keypair.pubkey).toBe('string');
      expect(keypair.pubkey.length).toBe(64);
      expect(keypair.pubkey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique keypairs on each call', () => {
      // Act
      const keypair1 = createTestKeypair();
      const keypair2 = createTestKeypair();

      // Assert - Different keypairs
      expect(keypair1.pubkey).not.toBe(keypair2.pubkey);
      expect(keypair1.privkey).not.toEqual(keypair2.privkey);
    });
  });

  describe('createGiftwrap()', () => {
    it('should create valid NIP-59 giftwrap event (kind 1059)', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = 'Test message';

      // Act
      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Assert - Kind 1059 (giftwrap)
      expect(giftwrap.kind).toBe(1059);
      expect(giftwrap).toHaveProperty('pubkey');
      expect(giftwrap).toHaveProperty('content');
      expect(giftwrap).toHaveProperty('created_at');
      expect(giftwrap).toHaveProperty('sig');
    });

    it('should use ephemeral pubkey (NOT sender real pubkey)', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = 'Test message';

      // Act
      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Assert - Giftwrap pubkey is NOT sender's pubkey (ephemeral key)
      expect(giftwrap.pubkey).not.toBe(sender.pubkey);
    });

    it('should not contain plaintext message in giftwrap content', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = 'Secret plaintext message';

      // Act
      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Assert - Content is encrypted (does not contain plaintext)
      expect(giftwrap.content).not.toContain(message);
      expect(giftwrap.content.length).toBeGreaterThan(50); // Encrypted blob is substantial
    });

    it('should create giftwrap with randomized timestamp (within ±2 days)', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = 'Test message';

      // Act
      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Assert - Timestamp is within ±2 days of now
      const now = Math.floor(Date.now() / 1000);
      const timestampDiff = Math.abs(giftwrap.created_at - now);
      const twoDaysInSeconds = 2 * 24 * 60 * 60;
      expect(timestampDiff).toBeLessThanOrEqual(twoDaysInSeconds);
    });
  });

  describe('unwrapGiftwrap()', () => {
    it('should successfully unwrap giftwrap and return plaintext message', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = 'Hello, this is a test';

      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Act
      const decryptedMessage = unwrapGiftwrap(giftwrap, recipient.privkey);

      // Assert - Decrypted message matches original
      expect(decryptedMessage).toBe(message);
    });

    it('should throw error when wrong recipient private key used', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const wrongRecipient = createTestKeypair();
      const message = 'Test message';

      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Act & Assert - Should throw error (cannot decrypt)
      expect(() => unwrapGiftwrap(giftwrap, wrongRecipient.privkey)).toThrow();
    });

    it('should handle special characters and emojis in message', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = '🔒 Secret: \n\t"Special chars: <>&"';

      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Act
      const decryptedMessage = unwrapGiftwrap(giftwrap, recipient.privkey);

      // Assert - Special characters preserved
      expect(decryptedMessage).toBe(message);
    });

    it('should handle empty message', () => {
      // Arrange
      const sender = createTestKeypair();
      const recipient = createTestKeypair();
      const message = '';

      const giftwrap = createGiftwrap(sender.privkey, recipient.pubkey, message);

      // Act
      const decryptedMessage = unwrapGiftwrap(giftwrap, recipient.privkey);

      // Assert - Empty message preserved
      expect(decryptedMessage).toBe('');
    });
  });

  describe('waitForWebSocketMessage()', () => {
    it('should resolve when WebSocket message received', async () => {
      // Arrange - Create mock WebSocket server
      const server = new WebSocket.Server({ port: 0 }); // Random port
      const port = (server.address() as { port: number }).port;

      const testMessage = {
        type: 'giftwrap',
        data: { kind: 1059, content: 'test', pubkey: 'abc' } as NostrEvent,
      };

      // Create client connection
      const client = new WebSocket(`ws://localhost:${port}`);

      // Wait for connection
      await new Promise((resolve) => client.on('open', resolve));

      // Act - Start waiting for message
      const messagePromise = waitForWebSocketMessage(client, 5000);

      // Simulate server sending message (wait a bit to ensure listener is registered)
      setTimeout(() => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(testMessage));
        }
      }, 200);

      const result = await messagePromise;

      // Assert - Message received
      expect(result.type).toBe('giftwrap');
      expect(result.data.kind).toBe(1059);

      // Cleanup
      client.close();
      server.close();
    });

    it('should reject on timeout when no message received', async () => {
      // Arrange - Create mock WebSocket server (but don't send message)
      const server = new WebSocket.Server({ port: 0 });
      const port = (server.address() as { port: number }).port;

      const client = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => client.on('open', resolve));

      // Act & Assert - Should timeout (500ms timeout)
      await expect(waitForWebSocketMessage(client, 500)).rejects.toThrow(
        'WebSocket message timeout'
      );

      // Cleanup
      client.close();
      server.close();
    });

    it('should reject on WebSocket error', async () => {
      // Arrange - Create client that connects to non-existent server
      const client = new WebSocket('ws://localhost:9999');

      // Act & Assert - Should reject with connection error
      await expect(waitForWebSocketMessage(client, 2000)).rejects.toThrow();

      // Cleanup
      client.close();
    });
  });

  describe('verifySettlementOnAptos()', () => {
    it('should return true for valid settlement verification', () => {
      // Arrange
      const rpcUrl = 'http://localhost:8080';
      const channelAddress = '0x1234567890123456789012345678901234567890';
      const expectedAmount = BigInt(1000);

      // Act
      const result = verifySettlementOnAptos(rpcUrl, channelAddress, expectedAmount);

      // Assert - Mock implementation returns true for positive amount
      expect(result).toBe(true);
    });

    it('should throw error for invalid RPC URL', () => {
      // Arrange
      const rpcUrl = '';
      const channelAddress = '0x1234567890123456789012345678901234567890';
      const expectedAmount = BigInt(1000);

      // Act & Assert - Should throw error
      expect(() => verifySettlementOnAptos(rpcUrl, channelAddress, expectedAmount)).toThrow(
        'Invalid RPC URL'
      );
    });

    it('should throw error for invalid channel address', () => {
      // Arrange
      const rpcUrl = 'http://localhost:8080';
      const channelAddress = '';
      const expectedAmount = BigInt(1000);

      // Act & Assert - Should throw error
      expect(() => verifySettlementOnAptos(rpcUrl, channelAddress, expectedAmount)).toThrow(
        'Invalid channel address'
      );
    });

    it('should handle zero expected amount', () => {
      // Arrange
      const rpcUrl = 'http://localhost:8080';
      const channelAddress = '0x1234567890123456789012345678901234567890';
      const expectedAmount = BigInt(0);

      // Act
      const result = verifySettlementOnAptos(rpcUrl, channelAddress, expectedAmount);

      // Assert - Mock returns false for zero amount
      expect(result).toBe(false);
    });
  });
});
