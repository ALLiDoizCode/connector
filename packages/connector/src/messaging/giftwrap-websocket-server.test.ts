import { GiftwrapWebSocketServer } from './giftwrap-websocket-server';
import { PacketType, ILPPreparePacket } from '@m2m/shared';
import { Logger } from 'pino';
import { NostrEvent } from 'nostr-tools';
import { WebSocket } from 'ws';
import { ToonCodec } from '../agent/toon-codec';

describe('GiftwrapWebSocketServer', () => {
  let server: GiftwrapWebSocketServer;
  let mockLogger: jest.Mocked<Logger>;
  const testPort = 3099; // Use non-standard port for tests

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Logger>;

    server = new GiftwrapWebSocketServer({ wsPort: testPort }, mockLogger);
  });

  afterEach(async () => {
    await server.stop();
  });

  function createTestGiftwrap(): NostrEvent {
    return {
      kind: 1059,
      pubkey: 'a'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', 'b'.repeat(64)]],
      content: 'encrypted...',
      id: 'c'.repeat(64),
      sig: 'd'.repeat(128),
    };
  }

  function createTestPreparePacket(giftwrap: NostrEvent, amount = 50n): ILPPreparePacket {
    const toonCodec = new ToonCodec();
    const toonBuffer = toonCodec.encode(giftwrap);

    return {
      type: PacketType.PREPARE,
      amount,
      destination: 'g.agent.alice.private',
      executionCondition: Buffer.alloc(32),
      expiresAt: new Date(Date.now() + 30000),
      data: toonBuffer,
    };
  }

  describe('Connection Lifecycle', () => {
    it('should start WebSocket server on configured port', async () => {
      await server.start();

      // Verify server started
      expect(mockLogger.info).toHaveBeenCalledWith({ port: testPort }, 'WebSocket server started');
    });

    it('should accept client connection with valid clientId', async () => {
      await server.start();

      // Connect client with clientId
      const client = new WebSocket(`ws://localhost:${testPort}?clientId=alice`);

      // Wait for connection to open
      await new Promise((resolve) => {
        client.on('open', resolve);
      });

      // Verify connection accepted
      expect(mockLogger.info).toHaveBeenCalledWith(
        { clientId: 'alice' },
        'WebSocket client connected'
      );

      client.close();
    });

    it('should reject client connection without clientId', async () => {
      await server.start();

      // Connect client without clientId
      const client = new WebSocket(`ws://localhost:${testPort}`);

      // Wait for close event
      const closePromise = new Promise((resolve) => {
        client.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      const closeEvent = (await closePromise) as { code: number; reason: string };

      // Verify connection rejected
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toBe('Missing clientId');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WebSocket connection rejected: missing clientId'
      );
    });

    it('should handle client disconnect and remove from clients map', async () => {
      await server.start();

      // Connect client
      const client = new WebSocket(`ws://localhost:${testPort}?clientId=bob`);

      await new Promise((resolve) => {
        client.on('open', resolve);
      });

      // Disconnect client and wait for server to process the close event
      const closePromise = new Promise((resolve) => {
        client.on('close', resolve);
      });

      client.close();
      await closePromise;

      // Give server time to process close event
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify disconnect logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        { clientId: 'bob' },
        'WebSocket client disconnected'
      );
    });

    // Note: WebSocket error event testing is difficult in unit tests because
    // the server's error handler is on the server-side WebSocket instance,
    // not the client. Error logging is verified through manual testing and
    // integration tests where network errors naturally occur.

    it('should stop server gracefully', async () => {
      await server.start();

      await server.stop();

      // Verify server stopped
      expect(mockLogger.info).toHaveBeenCalledWith('WebSocket server stopped');
    });

    it('should handle stop when server not started', async () => {
      // Should not throw
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  describe('Incoming Packet Handling (AC7/AC8)', () => {
    it('should TOON-decode giftwrap and forward to connected client', async () => {
      await server.start();

      // Connect client
      const client = new WebSocket(`ws://localhost:${testPort}?clientId=alice`);

      await new Promise((resolve) => {
        client.on('open', resolve);
      });

      // Create test packet
      const giftwrap = createTestGiftwrap();
      const packet = createTestPreparePacket(giftwrap, 300n);

      // Listen for WebSocket message
      const messagePromise = new Promise((resolve) => {
        client.once('message', (data) => {
          const message = JSON.parse(data.toString());
          resolve(message);
        });
      });

      // Trigger incoming packet
      server.handleIncomingPacket(packet, 'alice');

      // Verify WebSocket message received
      const message = (await messagePromise) as {
        type: string;
        data: NostrEvent;
        amount: string;
      };

      expect(message).toEqual({
        type: 'giftwrap',
        data: expect.objectContaining({
          kind: 1059,
          pubkey: giftwrap.pubkey,
          content: giftwrap.content,
        }),
        amount: '300',
      });

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        { clientId: 'alice', giftwrapKind: 1059 },
        'Forwarding giftwrap to client'
      );

      client.close();
    });

    it('should drop packet if client not connected', () => {
      const giftwrap = createTestGiftwrap();
      const packet = createTestPreparePacket(giftwrap);

      // Call handleIncomingPacket for non-existent client
      server.handleIncomingPacket(packet, 'nonexistent');

      // Verify warning logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { clientId: 'nonexistent' },
        'Client not connected, dropping packet'
      );
    });

    it('should drop packet if client connection is closed', async () => {
      await server.start();

      // Connect client
      const client = new WebSocket(`ws://localhost:${testPort}?clientId=alice`);

      await new Promise((resolve) => {
        client.on('open', resolve);
      });

      // Close client connection
      client.close();

      await new Promise((resolve) => {
        client.on('close', resolve);
      });

      // Create test packet
      const giftwrap = createTestGiftwrap();
      const packet = createTestPreparePacket(giftwrap);

      // Try to send to closed client
      server.handleIncomingPacket(packet, 'alice');

      // Verify warning logged (client removed from map on disconnect)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { clientId: 'alice' },
        'Client not connected, dropping packet'
      );
    });

    it('should preserve all giftwrap fields during TOON decode', async () => {
      await server.start();

      // Connect client
      const client = new WebSocket(`ws://localhost:${testPort}?clientId=alice`);

      await new Promise((resolve) => {
        client.on('open', resolve);
      });

      // Create test packet with specific fields
      const giftwrap: NostrEvent = {
        kind: 1059,
        pubkey: '1234567890abcdef'.repeat(4), // 64 chars
        created_at: 1234567890,
        tags: [
          ['p', 'recipient'.repeat(8)], // 64 chars
          ['custom', 'value'],
        ],
        content: 'encrypted content data',
        id: 'fedcba0987654321'.repeat(4), // 64 chars
        sig: 'signature'.repeat(16), // 128 chars
      };
      const packet = createTestPreparePacket(giftwrap, 500n);

      // Listen for WebSocket message
      const messagePromise = new Promise((resolve) => {
        client.once('message', (data) => {
          const message = JSON.parse(data.toString());
          resolve(message);
        });
      });

      // Trigger incoming packet
      server.handleIncomingPacket(packet, 'alice');

      // Verify all fields preserved
      const message = (await messagePromise) as {
        type: string;
        data: NostrEvent;
        amount: string;
      };

      expect(message.data).toEqual({
        kind: 1059,
        pubkey: giftwrap.pubkey,
        created_at: giftwrap.created_at,
        tags: giftwrap.tags,
        content: giftwrap.content,
        id: giftwrap.id,
        sig: giftwrap.sig,
      });

      expect(message.amount).toBe('500');

      client.close();
    });
  });
});
