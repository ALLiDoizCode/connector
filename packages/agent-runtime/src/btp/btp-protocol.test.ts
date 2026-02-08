/**
 * BTP Protocol Serialization Tests
 *
 * Tests for parseBTPMessage() and serializeBTPMessage() round-trip correctness.
 */

import {
  BTPMessageType,
  BTP_CONTENT_TYPE_APPLICATION_OCTET_STREAM,
  parseBTPMessage,
  serializeBTPMessage,
  isBTPErrorData,
} from './btp-protocol';
import type { BTPMessage, BTPData } from './btp-protocol';

describe('BTP Protocol', () => {
  describe('parseBTPMessage / serializeBTPMessage round-trip', () => {
    it('should round-trip a RESPONSE message with ILP packet', () => {
      const ilpPacket = Buffer.from([0x0c, 0x01, 0x02, 0x03]);
      const original: BTPMessage = {
        type: BTPMessageType.RESPONSE,
        requestId: 42,
        data: {
          protocolData: [],
          ilpPacket,
        },
      };

      const serialized = serializeBTPMessage(original);
      const parsed = parseBTPMessage(serialized);

      expect(parsed.type).toBe(BTPMessageType.RESPONSE);
      expect(parsed.requestId).toBe(42);
      const data = parsed.data as BTPData;
      expect(data.protocolData).toHaveLength(0);
      expect(data.ilpPacket).toBeDefined();
      expect(data.ilpPacket!.equals(ilpPacket)).toBe(true);
    });

    it('should round-trip a MESSAGE with auth protocol data', () => {
      const authPayload = Buffer.from(
        JSON.stringify({ peerId: 'test-peer', secret: 'token123' }),
        'utf8'
      );
      const original: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 1,
        data: {
          protocolData: [
            {
              protocolName: 'auth',
              contentType: BTP_CONTENT_TYPE_APPLICATION_OCTET_STREAM,
              data: authPayload,
            },
          ],
          ilpPacket: Buffer.alloc(0),
        },
      };

      const serialized = serializeBTPMessage(original);
      const parsed = parseBTPMessage(serialized);

      expect(parsed.type).toBe(BTPMessageType.MESSAGE);
      expect(parsed.requestId).toBe(1);
      const data = parsed.data as BTPData;
      expect(data.protocolData).toHaveLength(1);
      expect(data.protocolData[0]!.protocolName).toBe('auth');
      expect(data.protocolData[0]!.contentType).toBe(BTP_CONTENT_TYPE_APPLICATION_OCTET_STREAM);
      expect(data.protocolData[0]!.data.equals(authPayload)).toBe(true);
    });

    it('should round-trip a MESSAGE with ILP packet', () => {
      const ilpPacket = Buffer.alloc(64, 0xab);
      const original: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 9999,
        data: {
          protocolData: [],
          ilpPacket,
        },
      };

      const serialized = serializeBTPMessage(original);
      const parsed = parseBTPMessage(serialized);

      expect(parsed.type).toBe(BTPMessageType.MESSAGE);
      expect(parsed.requestId).toBe(9999);
      const data = parsed.data as BTPData;
      expect(data.ilpPacket).toBeDefined();
      expect(data.ilpPacket!.equals(ilpPacket)).toBe(true);
    });

    it('should round-trip an ERROR message', () => {
      const original: BTPMessage = {
        type: BTPMessageType.ERROR,
        requestId: 7,
        data: {
          code: 'F00',
          name: 'NotAcceptedError',
          triggeredAt: '2026-02-08T00:00:00.000Z',
          data: Buffer.from('error details'),
        },
      };

      const serialized = serializeBTPMessage(original);
      const parsed = parseBTPMessage(serialized);

      expect(parsed.type).toBe(BTPMessageType.ERROR);
      expect(parsed.requestId).toBe(7);
      expect(isBTPErrorData(parsed)).toBe(true);
      if (isBTPErrorData(parsed)) {
        expect(parsed.data.code).toBe('F00');
        expect(parsed.data.name).toBe('NotAcceptedError');
        expect(parsed.data.triggeredAt).toBe('2026-02-08T00:00:00.000Z');
        expect(parsed.data.data.equals(Buffer.from('error details'))).toBe(true);
      }
    });

    it('should round-trip a RESPONSE with no ILP packet', () => {
      const original: BTPMessage = {
        type: BTPMessageType.RESPONSE,
        requestId: 100,
        data: {
          protocolData: [],
        },
      };

      const serialized = serializeBTPMessage(original);
      const parsed = parseBTPMessage(serialized);

      expect(parsed.type).toBe(BTPMessageType.RESPONSE);
      const data = parsed.data as BTPData;
      expect(data.ilpPacket).toBeUndefined();
    });
  });

  describe('parseBTPMessage error handling', () => {
    it('should throw on truncated buffer (less than 5 bytes)', () => {
      expect(() => parseBTPMessage(Buffer.alloc(4))).toThrow('BTP message too short');
    });

    it('should throw on empty buffer', () => {
      expect(() => parseBTPMessage(Buffer.alloc(0))).toThrow('BTP message too short');
    });

    it('should throw on malformed message payload', () => {
      // Valid header (type=MESSAGE, requestId=1) but truncated payload
      const buf = Buffer.alloc(5);
      buf.writeUInt8(BTPMessageType.MESSAGE, 0);
      buf.writeUInt32BE(1, 1);
      // Missing protocolDataCount byte — should throw when reading past end
      expect(() => parseBTPMessage(buf)).toThrow();
    });
  });

  describe('isBTPErrorData', () => {
    it('should return true for ERROR type messages', () => {
      const msg: BTPMessage = {
        type: BTPMessageType.ERROR,
        requestId: 1,
        data: { code: 'E', name: 'err', triggeredAt: '', data: Buffer.alloc(0) },
      };
      expect(isBTPErrorData(msg)).toBe(true);
    });

    it('should return false for MESSAGE type messages', () => {
      const msg: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 1,
        data: { protocolData: [] },
      };
      expect(isBTPErrorData(msg)).toBe(false);
    });

    it('should return false for RESPONSE type messages', () => {
      const msg: BTPMessage = {
        type: BTPMessageType.RESPONSE,
        requestId: 1,
        data: { protocolData: [] },
      };
      expect(isBTPErrorData(msg)).toBe(false);
    });
  });

  describe('large requestId values', () => {
    it('should handle max uint32 requestId', () => {
      const original: BTPMessage = {
        type: BTPMessageType.RESPONSE,
        requestId: 0xffffffff,
        data: { protocolData: [] },
      };

      const serialized = serializeBTPMessage(original);
      const parsed = parseBTPMessage(serialized);
      expect(parsed.requestId).toBe(0xffffffff);
    });
  });
});
