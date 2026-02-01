import { GiftwrapRouter } from './giftwrap-router';
import { BTPClient } from '../btp/btp-client';
import { PacketType, ILPFulfillPacket, ILPRejectPacket, ILPErrorCode } from '@m2m/shared';
import { Logger } from 'pino';
import { NostrEvent } from 'nostr-tools';

describe('GiftwrapRouter', () => {
  let router: GiftwrapRouter;
  let mockBTPClient: jest.Mocked<BTPClient>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockBTPClient = {
      sendPacket: jest.fn(),
    } as unknown as jest.Mocked<BTPClient>;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Logger>;

    router = new GiftwrapRouter(mockBTPClient, mockLogger);
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

  it('should TOON encode giftwrap before routing', async () => {
    const giftwrap = createTestGiftwrap();
    const recipient = 'g.agent.bob.private';
    const amount = 300n;

    // Mock BTP response (ILP Fulfill)
    const fulfillPacket: ILPFulfillPacket = {
      type: PacketType.FULFILL,
      fulfillment: Buffer.from('secret'),
      data: Buffer.from(''),
    };
    mockBTPClient.sendPacket.mockResolvedValue(fulfillPacket);

    await router.route(giftwrap, recipient, amount);

    // Verify TOON encoding happened
    expect(mockBTPClient.sendPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PacketType.PREPARE,
        amount: 300n,
        destination: recipient,
        data: expect.any(Buffer), // TOON-encoded
      })
    );

    // Verify data is smaller than JSON (TOON compression)
    const sentPacket = (mockBTPClient.sendPacket as jest.Mock).mock.calls[0][0];
    const jsonSize = JSON.stringify(giftwrap).length;
    expect(sentPacket.data.length).toBeLessThan(jsonSize);
  });

  it('should create ILP Prepare packet with correct fields', async () => {
    const giftwrap = createTestGiftwrap();
    const recipient = 'g.agent.bob.private';
    const amount = 300n;

    const fulfillPacket: ILPFulfillPacket = {
      type: PacketType.FULFILL,
      fulfillment: Buffer.from('secret'),
      data: Buffer.from(''),
    };
    mockBTPClient.sendPacket.mockResolvedValue(fulfillPacket);

    await router.route(giftwrap, recipient, amount);

    const sentPacket = (mockBTPClient.sendPacket as jest.Mock).mock.calls[0][0];

    // Verify ILP packet structure
    expect(sentPacket).toEqual(
      expect.objectContaining({
        type: PacketType.PREPARE,
        amount: 300n,
        destination: 'g.agent.bob.private',
        executionCondition: expect.any(Buffer), // 32-byte hash
        expiresAt: expect.any(Date),
        data: expect.any(Buffer), // TOON payload
      })
    );

    // Verify condition is 32 bytes (SHA-256)
    expect(sentPacket.executionCondition.length).toBe(32);
  });

  it('should return fulfillment on successful routing', async () => {
    const giftwrap = createTestGiftwrap();
    const fulfillmentBuffer = Buffer.from('secret123');

    const fulfillPacket: ILPFulfillPacket = {
      type: PacketType.FULFILL,
      fulfillment: fulfillmentBuffer,
      data: Buffer.from(''),
    };
    mockBTPClient.sendPacket.mockResolvedValue(fulfillPacket);

    const result = await router.route(giftwrap, 'g.agent.bob.private', 300n);

    expect(result.fulfillment).toEqual(fulfillmentBuffer);
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('should throw error on ILP Reject', async () => {
    const giftwrap = createTestGiftwrap();

    const rejectPacket: ILPRejectPacket = {
      type: PacketType.REJECT,
      code: ILPErrorCode.F02_UNREACHABLE,
      message: 'No route to destination',
      triggeredBy: 'g.connector1',
      data: Buffer.from(''),
    };
    mockBTPClient.sendPacket.mockResolvedValue(rejectPacket);

    await expect(router.route(giftwrap, 'g.agent.bob.private', 300n)).rejects.toThrow(
      'Routing failure'
    );
  });

  it('should throw "Insufficient funds" error for T04 insufficient liquidity', async () => {
    const giftwrap = createTestGiftwrap();

    const rejectPacket: ILPRejectPacket = {
      type: PacketType.REJECT,
      code: ILPErrorCode.T04_INSUFFICIENT_LIQUIDITY,
      message: 'Insufficient Liquidity',
      triggeredBy: 'g.connector1',
      data: Buffer.from(''),
    };
    mockBTPClient.sendPacket.mockResolvedValue(rejectPacket);

    await expect(router.route(giftwrap, 'g.agent.bob.private', 300n)).rejects.toThrow(
      'Insufficient funds'
    );
  });

  it('should throw error for invalid giftwrap kind', async () => {
    const giftwrap = createTestGiftwrap();
    giftwrap.kind = 1; // Wrong kind

    await expect(router.route(giftwrap, 'g.agent.bob.private', 300n)).rejects.toThrow(
      'Invalid giftwrap kind (expected 1059)'
    );
  });

  it('should throw error for invalid recipient address format', async () => {
    const giftwrap = createTestGiftwrap();

    await expect(router.route(giftwrap, 'invalid-address', 300n)).rejects.toThrow(
      'Invalid recipient address format'
    );
  });

  it('should throw error for amount out of range (too small)', async () => {
    const giftwrap = createTestGiftwrap();

    await expect(router.route(giftwrap, 'g.agent.bob.private', 0n)).rejects.toThrow(
      'Amount out of range (1 - 1000000 msat)'
    );
  });

  it('should throw error for amount out of range (too large)', async () => {
    const giftwrap = createTestGiftwrap();

    await expect(router.route(giftwrap, 'g.agent.bob.private', 2000000n)).rejects.toThrow(
      'Amount out of range (1 - 1000000 msat)'
    );
  });

  it('should timeout if BTP client throws timeout error', async () => {
    const giftwrap = createTestGiftwrap();

    mockBTPClient.sendPacket.mockRejectedValue(new Error('Packet send timeout'));

    await expect(router.route(giftwrap, 'g.agent.bob.private', 300n)).rejects.toThrow(
      'Request timeout'
    );
  });
});
