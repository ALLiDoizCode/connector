/**
 * OutboundBTPClient Unit Tests
 *
 * Tests connection, authentication, packet sending, timeout handling,
 * reconnection, health status, and graceful shutdown.
 *
 * Strategy: mock the 'ws' module to avoid real WebSocket connections.
 * Uses real timers with short timeouts for all tests.
 */

import { EventEmitter } from 'events';
import pino from 'pino';
import { PacketType, ILPErrorCode, serializePacket } from '@agent-runtime/shared';
import type { ILPFulfillPacket, ILPRejectPacket } from '@agent-runtime/shared';
import {
  OutboundBTPClient,
  BTPConnectionError,
  BTPAuthenticationError,
} from './outbound-btp-client';
import type { OutboundBTPClientConfig } from './outbound-btp-client';
import { BTPMessageType, serializeBTPMessage } from './btp-protocol';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter {
  readyState = 0; // CONNECTING

  send = jest.fn();
  close = jest.fn().mockImplementation(() => {
    this.readyState = 3; // CLOSED
  });
  ping = jest.fn();

  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.emit('open');
  }

  simulateMessage(data: Buffer): void {
    this.emit('message', data);
  }

  simulateClose(): void {
    this.readyState = 3;
    this.emit('close');
  }

  simulateError(err: Error): void {
    this.emit('error', err);
  }

  simulatePong(): void {
    this.emit('pong');
  }
}

let mockWsInstances: MockWebSocket[] = [];

// Mock the ws module with proper static constants on the constructor
jest.mock('ws', () => {
  const ctor = jest.fn().mockImplementation(() => {
    const ws = new MockWebSocket();
    mockWsInstances.push(ws);
    return ws;
  });
  // Expose the WebSocket state constants that the real 'ws' module provides
  Object.assign(ctor, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  return { __esModule: true, default: ctor };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const WebSocketMock = require('ws').default as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: 'silent' });

function tick(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultConfig(overrides?: Partial<OutboundBTPClientConfig>): OutboundBTPClientConfig {
  return {
    url: 'ws://localhost:3000',
    authToken: 'test-secret',
    peerId: 'test-peer',
    maxRetries: 3,
    retryBaseMs: 50,
    retryCapMs: 200,
    packetTimeoutMs: 150,
    authTimeoutMs: 150,
    pingIntervalMs: 60000,
    pongTimeoutMs: 100,
    ...overrides,
  };
}

function buildAuthResponse(requestId: number): Buffer {
  return serializeBTPMessage({
    type: BTPMessageType.RESPONSE,
    requestId,
    data: { protocolData: [] },
  });
}

function buildFulfillResponse(requestId: number): Buffer {
  const fulfillPacket: ILPFulfillPacket = {
    type: PacketType.FULFILL,
    fulfillment: Buffer.alloc(32, 0xaa),
    data: Buffer.alloc(0),
  };
  return serializeBTPMessage({
    type: BTPMessageType.RESPONSE,
    requestId,
    data: { protocolData: [], ilpPacket: serializePacket(fulfillPacket) },
  });
}

function buildRejectResponse(requestId: number): Buffer {
  const rejectPacket: ILPRejectPacket = {
    type: PacketType.REJECT,
    code: ILPErrorCode.F02_UNREACHABLE,
    triggeredBy: 'g.connector',
    message: 'Unreachable',
    data: Buffer.alloc(0),
  };
  return serializeBTPMessage({
    type: BTPMessageType.RESPONSE,
    requestId,
    data: { protocolData: [], ilpPacket: serializePacket(rejectPacket) },
  });
}

function buildBTPError(requestId: number): Buffer {
  return serializeBTPMessage({
    type: BTPMessageType.ERROR,
    requestId,
    data: {
      code: 'F00',
      name: 'NotAcceptedError',
      triggeredAt: new Date().toISOString(),
      data: Buffer.alloc(0),
    },
  });
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createTestPrepare(overrides?: { expiresAt?: Date }) {
  return {
    type: PacketType.PREPARE as const,
    amount: BigInt(1000),
    expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 30000),
    executionCondition: Buffer.alloc(32, 0xcc),
    destination: 'g.connector.peer1',
    data: Buffer.from('test'),
  };
}

function extractRequestId(buffer: Buffer): number {
  return buffer.readUInt32BE(1);
}

function latestWs(): MockWebSocket {
  return mockWsInstances[mockWsInstances.length - 1]!;
}

/**
 * Connect a client through full auth handshake.
 */
async function connectClient(client: OutboundBTPClient): Promise<void> {
  const connectPromise = client.connect();
  await tick();

  const ws = latestWs();
  ws.simulateOpen();
  await tick();

  const authRequestId = extractRequestId(ws.send.mock.calls[0]![0] as Buffer);
  ws.simulateMessage(buildAuthResponse(authRequestId));

  await connectPromise;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboundBTPClient', () => {
  let client: OutboundBTPClient;

  beforeEach(() => {
    mockWsInstances = [];
    WebSocketMock.mockClear();
    client = new OutboundBTPClient(defaultConfig(), logger);
  });

  afterEach(async () => {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // Connection & Authentication (AC: 1, 2)
  // -------------------------------------------------------------------------

  describe('Connection & Authentication', () => {
    it('should connect and authenticate successfully', async () => {
      await connectClient(client);
      expect(client.isConnected()).toBe(true);
    });

    it('should reject with BTPAuthenticationError on auth timeout', async () => {
      const connectPromise = client.connect();
      await tick();

      latestWs().simulateOpen();
      // Don't send auth response — let it timeout (authTimeoutMs = 150)

      await expect(connectPromise).rejects.toThrow(BTPAuthenticationError);
      expect(client.isConnected()).toBe(false);
    }, 2000);

    it('should reject with BTPAuthenticationError on BTP ERROR response', async () => {
      const connectPromise = client.connect();
      await tick();

      const ws = latestWs();
      ws.simulateOpen();
      await tick();

      const authRequestId = extractRequestId(ws.send.mock.calls[0]![0] as Buffer);
      ws.simulateMessage(buildBTPError(authRequestId));

      await expect(connectPromise).rejects.toThrow(BTPAuthenticationError);
      expect(client.isConnected()).toBe(false);
    });

    it('should reject with BTPConnectionError on WebSocket error during connect', async () => {
      const connectPromise = client.connect();
      await tick();

      latestWs().simulateError(new Error('ECONNREFUSED'));

      await expect(connectPromise).rejects.toThrow(BTPConnectionError);
      expect(client.isConnected()).toBe(false);
    });

    it('should skip connect when already connected', async () => {
      await connectClient(client);
      const callCount = WebSocketMock.mock.calls.length;

      await client.connect();

      expect(WebSocketMock.mock.calls.length).toBe(callCount);
      expect(client.isConnected()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Packet Sending (AC: 3, 4)
  // -------------------------------------------------------------------------

  describe('Packet Sending', () => {
    it('should send PREPARE and resolve with ILPFulfillPacket', async () => {
      await connectClient(client);

      const sendPromise = client.sendPacket(createTestPrepare());
      await tick();

      const ws = latestWs();
      const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1]![0] as Buffer;
      const requestId = extractRequestId(lastCall);

      ws.simulateMessage(buildFulfillResponse(requestId));

      const result = await sendPromise;
      expect(result.type).toBe(PacketType.FULFILL);
      expect((result as ILPFulfillPacket).fulfillment.length).toBe(32);
    });

    it('should send PREPARE and resolve with ILPRejectPacket', async () => {
      await connectClient(client);

      const sendPromise = client.sendPacket(createTestPrepare());
      await tick();

      const ws = latestWs();
      const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1]![0] as Buffer;
      const requestId = extractRequestId(lastCall);

      ws.simulateMessage(buildRejectResponse(requestId));

      const result = await sendPromise;
      expect(result.type).toBe(PacketType.REJECT);
      expect((result as ILPRejectPacket).code).toBe(ILPErrorCode.F02_UNREACHABLE);
    });

    it('should correlate multiple concurrent sends by requestId', async () => {
      await connectClient(client);

      const send1 = client.sendPacket(createTestPrepare());
      await tick();
      const send2 = client.sendPacket(createTestPrepare());
      await tick();

      const ws = latestWs();
      const calls = ws.send.mock.calls;
      // Auth was call 0; sends are calls 1 and 2
      const rid1 = extractRequestId(calls[calls.length - 2]![0] as Buffer);
      const rid2 = extractRequestId(calls[calls.length - 1]![0] as Buffer);

      expect(rid1).not.toBe(rid2);

      // Respond out of order
      ws.simulateMessage(buildRejectResponse(rid2));
      ws.simulateMessage(buildFulfillResponse(rid1));

      const result1 = await send1;
      const result2 = await send2;

      expect(result1.type).toBe(PacketType.FULFILL);
      expect(result2.type).toBe(PacketType.REJECT);
    });

    it('should throw BTPConnectionError when sending while disconnected', async () => {
      await expect(client.sendPacket(createTestPrepare())).rejects.toThrow(BTPConnectionError);
    });
  });

  // -------------------------------------------------------------------------
  // Timeout Handling (AC: 5)
  // -------------------------------------------------------------------------

  describe('Timeout Handling', () => {
    it('should reject with timeout error when no response arrives', async () => {
      await connectClient(client);

      // Use a short expiresAt so the derived timeout (expiresAt - 500ms, min 1000ms) fires quickly
      const shortExpiry = createTestPrepare({ expiresAt: new Date(Date.now() + 1500) });
      await expect(client.sendPacket(shortExpiry)).rejects.toThrow('timeout');
    }, 5000);

    it('should clean up pending request on timeout', async () => {
      await connectClient(client);

      const shortExpiry = createTestPrepare({ expiresAt: new Date(Date.now() + 1500) });
      const sendPromise = client.sendPacket(shortExpiry).catch(() => {
        // expected timeout
      });
      await tick();

      const ws = latestWs();
      const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1]![0] as Buffer;
      const requestId = extractRequestId(lastCall);

      await sendPromise;

      // Late response should not throw
      expect(() => ws.simulateMessage(buildFulfillResponse(requestId))).not.toThrow();
    }, 5000);
  });

  // -------------------------------------------------------------------------
  // Reconnection (AC: 6)
  // -------------------------------------------------------------------------

  describe('Reconnection', () => {
    it('should attempt reconnect on unexpected close', async () => {
      await connectClient(client);
      const countBefore = WebSocketMock.mock.calls.length;

      latestWs().simulateClose();
      expect(client.isConnected()).toBe(false);

      // Wait for first retry (retryBaseMs = 50ms)
      await tick(80);

      expect(WebSocketMock.mock.calls.length).toBeGreaterThan(countBefore);
    });

    it('should not reconnect on explicit disconnect', async () => {
      await connectClient(client);
      const countBefore = WebSocketMock.mock.calls.length;

      await client.disconnect();

      await tick(200);
      expect(WebSocketMock.mock.calls.length).toBe(countBefore);
    });

    it('should reset retry counter on successful reconnect', async () => {
      await connectClient(client);

      // Close unexpectedly
      latestWs().simulateClose();
      await tick(80);

      // Reconnect succeeds
      const ws = latestWs();
      ws.simulateOpen();
      await tick();
      const authRequestId = extractRequestId(ws.send.mock.calls[0]![0] as Buffer);
      ws.simulateMessage(buildAuthResponse(authRequestId));
      await tick();

      expect(client.isConnected()).toBe(true);

      // Second close should also trigger reconnect (counter was reset)
      const countBefore = WebSocketMock.mock.calls.length;
      latestWs().simulateClose();
      await tick(80);

      expect(WebSocketMock.mock.calls.length).toBeGreaterThan(countBefore);
    });

    it('should stop reconnecting after max retries', async () => {
      const fastClient = new OutboundBTPClient(
        defaultConfig({ maxRetries: 2, retryBaseMs: 10, retryCapMs: 20 }),
        logger
      );

      await connectClient(fastClient);

      // Trigger 2 failed reconnection cycles by closing without a listener
      for (let i = 0; i < 2; i++) {
        latestWs().simulateClose();
        await tick(30);
        // The new WS was created; simulate close immediately (failed reconnect)
        latestWs().simulateClose();
        await tick(10);
      }

      const countAfterMaxRetries = WebSocketMock.mock.calls.length;
      await tick(100);

      expect(WebSocketMock.mock.calls.length).toBe(countAfterMaxRetries);

      await fastClient.disconnect();
    });
  });

  // -------------------------------------------------------------------------
  // Health Status (AC: 7)
  // -------------------------------------------------------------------------

  describe('Health Status', () => {
    it('should return true when connected', async () => {
      await connectClient(client);
      expect(client.isConnected()).toBe(true);
    });

    it('should return false when disconnected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return false during connecting (before auth)', async () => {
      const connectPromise = client.connect();
      await tick();
      expect(client.isConnected()).toBe(false);

      // Complete the handshake for clean teardown
      const ws = latestWs();
      ws.simulateOpen();
      await tick();
      const rid = extractRequestId(ws.send.mock.calls[0]![0] as Buffer);
      ws.simulateMessage(buildAuthResponse(rid));
      await connectPromise;
    });
  });

  // -------------------------------------------------------------------------
  // Graceful Shutdown (AC: 9)
  // -------------------------------------------------------------------------

  describe('Graceful Shutdown', () => {
    it('should close WebSocket on disconnect', async () => {
      await connectClient(client);

      // Hold reference to the connected WS before disconnect replaces it
      const ws = latestWs();
      await client.disconnect();

      expect(ws.close).toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });

    it('should reject all pending requests on disconnect', async () => {
      await connectClient(client);

      const sendPromise = client.sendPacket(createTestPrepare());
      await tick();

      await client.disconnect();

      await expect(sendPromise).rejects.toThrow(BTPConnectionError);
    });

    it('should stop reconnection timer on disconnect', async () => {
      await connectClient(client);

      latestWs().simulateClose();

      // Disconnect before the retry fires
      await client.disconnect();

      const count = WebSocketMock.mock.calls.length;
      await tick(200);

      expect(WebSocketMock.mock.calls.length).toBe(count);
    });

    it('should stop keep-alive ping on disconnect', async () => {
      const fastPingClient = new OutboundBTPClient(
        defaultConfig({ pingIntervalMs: 20, pongTimeoutMs: 20 }),
        logger
      );

      await connectClient(fastPingClient);
      const ws = latestWs();
      ws.ping.mockClear();

      await fastPingClient.disconnect();

      await tick(50);
      expect(ws.ping).not.toHaveBeenCalled();
    });
  });
});
