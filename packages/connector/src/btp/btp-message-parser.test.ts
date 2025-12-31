/**
 * Unit tests for BTP Message Parser
 * Tests encoding/decoding of BTP protocol messages per RFC-0023
 */

import { parseBTPMessage, serializeBTPMessage } from './btp-message-parser';
import { BTPMessage, BTPMessageType, BTPData, BTPErrorData, BTPError } from './btp-types';

describe('BTP Message Parser', () => {
  describe('parseBTPMessage', () => {
    it('should parse valid BTP MESSAGE frame with ILP packet', () => {
      // Arrange
      const ilpPacket = Buffer.from('test-ilp-packet', 'utf8');
      const message: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 12345,
        data: {
          protocolData: [
            {
              protocolName: 'ilp',
              contentType: 1,
              data: Buffer.from('test-data', 'utf8'),
            },
          ],
          ilpPacket,
        },
      };

      const buffer = serializeBTPMessage(message);

      // Act
      const parsed = parseBTPMessage(buffer);

      // Assert
      expect(parsed.type).toBe(BTPMessageType.MESSAGE);
      expect(parsed.requestId).toBe(12345);
      expect((parsed.data as BTPData).protocolData).toHaveLength(1);
      expect((parsed.data as BTPData).protocolData[0]?.protocolName).toBe('ilp');
      expect((parsed.data as BTPData).ilpPacket).toEqual(ilpPacket);
    });

    it('should parse valid BTP RESPONSE frame', () => {
      // Arrange
      const message: BTPMessage = {
        type: BTPMessageType.RESPONSE,
        requestId: 99999,
        data: {
          protocolData: [],
          ilpPacket: Buffer.from('response-packet', 'utf8'),
        },
      };

      const buffer = serializeBTPMessage(message);

      // Act
      const parsed = parseBTPMessage(buffer);

      // Assert
      expect(parsed.type).toBe(BTPMessageType.RESPONSE);
      expect(parsed.requestId).toBe(99999);
      expect((parsed.data as BTPData).protocolData).toHaveLength(0);
      expect((parsed.data as BTPData).ilpPacket).toEqual(Buffer.from('response-packet', 'utf8'));
    });

    it('should parse valid BTP ERROR frame', () => {
      // Arrange
      const errorData: BTPErrorData = {
        code: 'F00',
        name: 'BadRequestError',
        triggeredAt: '2025-12-27T10:00:00.000Z',
        data: Buffer.from('error-details', 'utf8'),
      };

      const message: BTPMessage = {
        type: BTPMessageType.ERROR,
        requestId: 54321,
        data: errorData,
      };

      const buffer = serializeBTPMessage(message);

      // Act
      const parsed = parseBTPMessage(buffer);

      // Assert
      expect(parsed.type).toBe(BTPMessageType.ERROR);
      expect(parsed.requestId).toBe(54321);
      expect((parsed.data as BTPErrorData).code).toBe('F00');
      expect((parsed.data as BTPErrorData).name).toBe('BadRequestError');
      expect((parsed.data as BTPErrorData).triggeredAt).toBe('2025-12-27T10:00:00.000Z');
      expect((parsed.data as BTPErrorData).data).toEqual(Buffer.from('error-details', 'utf8'));
    });

    it('should reject message that is too short', () => {
      // Arrange
      const buffer = Buffer.from([1, 2, 3]); // Only 3 bytes, minimum is 5

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('too short');
    });

    it('should reject message with invalid type byte', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(5);
      buffer.writeUInt8(99, 0); // Invalid type
      buffer.writeUInt32BE(12345, 1);

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('Invalid BTP message type');
    });

    it('should reject truncated BTP MESSAGE (missing protocol data count)', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(5);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      // Missing protocol data count byte

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('Truncated');
    });

    it('should reject truncated BTP ERROR (missing code)', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(6);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length = 3
      // Missing actual code bytes

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('Truncated');
    });

    it('should reject BTP ERROR with missing name length', () => {
      // Arrange - create ERROR message with code but truncated before name length
      const buffer = Buffer.allocUnsafe(9);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length = 3
      buffer.write('F00', 6, 'utf8'); // Code = 'F00'
      // Missing name length byte

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing name length');
    });

    it('should reject BTP ERROR with truncated name', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(11);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length
      buffer.write('F00', 6, 'utf8'); // Code
      buffer.writeUInt8(10, 9); // Name length = 10
      buffer.write('Te', 10, 'utf8'); // Only 2 bytes of name (need 10)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing name');
    });

    it('should reject BTP ERROR with missing triggeredAt length', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(15);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length
      buffer.write('F00', 6, 'utf8');
      buffer.writeUInt8(5, 9); // Name length
      buffer.write('Error', 10, 'utf8');
      // Missing triggeredAt length byte

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing triggeredAt length');
    });

    it('should reject BTP ERROR with truncated triggeredAt', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(18);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length
      buffer.write('F00', 6, 'utf8');
      buffer.writeUInt8(5, 9); // Name length
      buffer.write('Error', 10, 'utf8');
      buffer.writeUInt8(20, 15); // TriggeredAt length = 20
      buffer.write('2025', 16, 'utf8'); // Only 4 bytes (need 20)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing triggeredAt');
    });

    it('should reject BTP ERROR with missing data length', () => {
      // Arrange
      const timestamp = '2025-12-27T10:00:00.000Z';
      // Need: type(1) + requestId(4) + codeLen(1) + code(3) + nameLen(1) + name(5) + tsLen(1) + ts(24) = 40 bytes
      // Allocate exactly enough for everything except the 4-byte data length
      const buffer = Buffer.allocUnsafe(40);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length
      buffer.write('F00', 6, 'utf8');
      buffer.writeUInt8(5, 9); // Name length
      buffer.write('Error', 10, 'utf8');
      buffer.writeUInt8(timestamp.length, 15); // TriggeredAt length = 24
      buffer.write(timestamp, 16, 'utf8');
      // Missing 4-byte data length at offset 40

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing data length');
    });

    it('should reject BTP ERROR with truncated data', () => {
      // Arrange
      const timestamp = '2025-12-27T10:00:00.000Z';
      const buffer = Buffer.allocUnsafe(20 + timestamp.length);
      buffer.writeUInt8(BTPMessageType.ERROR, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(3, 5); // Code length
      buffer.write('F00', 6, 'utf8');
      buffer.writeUInt8(5, 9); // Name length
      buffer.write('Error', 10, 'utf8');
      buffer.writeUInt8(timestamp.length, 15); // TriggeredAt length
      buffer.write(timestamp, 16, 'utf8');
      const offset = 16 + timestamp.length;
      buffer.writeUInt32BE(100, offset); // Data length = 100 bytes
      // Only allocated 20 + timestamp.length, so missing data

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing data');
    });

    it('should reject MESSAGE with missing required fields', () => {
      // Arrange - manually construct malformed message (truncated before ILP packet length)
      const buffer = Buffer.allocUnsafe(6);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(0, 5); // 0 protocol data entries
      // Missing ILP packet length (need 4 more bytes)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('Truncated');
    });

    it('should reject MESSAGE with truncated ILP packet', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(10);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(0, 5); // 0 protocol data entries
      buffer.writeUInt32BE(50, 6); // ILP packet length = 50 bytes
      // Missing ILP packet data (only have 10 bytes total)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing ILP packet');
    });

    it('should reject MESSAGE with missing protocol name length', () => {
      // Arrange - MESSAGE with 1 protocol data entry but truncated
      const buffer = Buffer.allocUnsafe(6);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(1, 5); // 1 protocol data entry
      // Missing protocol name length byte

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing protocol name length');
    });

    it('should reject MESSAGE with truncated protocol name', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(9);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(1, 5); // 1 protocol data entry
      buffer.writeUInt8(10, 6); // Protocol name length = 10
      buffer.write('il', 7, 'utf8'); // Only 2 bytes (need 10)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing protocol name');
    });

    it('should reject MESSAGE with missing protocol content type', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(10);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(1, 5); // 1 protocol data entry
      buffer.writeUInt8(3, 6); // Protocol name length = 3
      buffer.write('ilp', 7, 'utf8');
      // Missing content type (2 bytes)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing content type');
    });

    it('should reject MESSAGE with missing protocol data length', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(12);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(1, 5); // 1 protocol data entry
      buffer.writeUInt8(3, 6); // Protocol name length = 3
      buffer.write('ilp', 7, 'utf8');
      buffer.writeUInt16BE(1, 10); // Content type = 1
      // Missing data length (4 bytes)

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing data length');
    });

    it('should reject MESSAGE with truncated protocol data', () => {
      // Arrange
      const buffer = Buffer.allocUnsafe(20);
      buffer.writeUInt8(BTPMessageType.MESSAGE, 0);
      buffer.writeUInt32BE(12345, 1);
      buffer.writeUInt8(1, 5); // 1 protocol data entry
      buffer.writeUInt8(3, 6); // Protocol name length = 3
      buffer.write('ilp', 7, 'utf8');
      buffer.writeUInt16BE(1, 10); // Content type = 1
      buffer.writeUInt32BE(100, 12); // Data length = 100 bytes
      // Only have 20 bytes total, missing protocol data

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
      expect(() => parseBTPMessage(buffer)).toThrow('missing data');
    });
  });

  describe('serializeBTPMessage', () => {
    it('should encode BTP MESSAGE correctly with ILP packet', () => {
      // Arrange
      const message: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 12345,
        data: {
          protocolData: [
            {
              protocolName: 'ilp',
              contentType: 1,
              data: Buffer.from('test', 'utf8'),
            },
          ],
          ilpPacket: Buffer.from('packet-data', 'utf8'),
        },
      };

      // Act
      const buffer = serializeBTPMessage(message);

      // Assert
      expect(buffer.length).toBeGreaterThan(5);
      expect(buffer.readUInt8(0)).toBe(BTPMessageType.MESSAGE);
      expect(buffer.readUInt32BE(1)).toBe(12345);
    });

    it('should encode BTP RESPONSE correctly', () => {
      // Arrange
      const message: BTPMessage = {
        type: BTPMessageType.RESPONSE,
        requestId: 99999,
        data: {
          protocolData: [],
        },
      };

      // Act
      const buffer = serializeBTPMessage(message);

      // Assert
      expect(buffer.readUInt8(0)).toBe(BTPMessageType.RESPONSE);
      expect(buffer.readUInt32BE(1)).toBe(99999);
    });

    it('should encode BTP ERROR correctly', () => {
      // Arrange
      const message: BTPMessage = {
        type: BTPMessageType.ERROR,
        requestId: 54321,
        data: {
          code: 'F01',
          name: 'TestError',
          triggeredAt: '2025-12-27T10:00:00.000Z',
          data: Buffer.from('error-info', 'utf8'),
        },
      };

      // Act
      const buffer = serializeBTPMessage(message);

      // Assert
      expect(buffer.readUInt8(0)).toBe(BTPMessageType.ERROR);
      expect(buffer.readUInt32BE(1)).toBe(54321);
    });

    it('should handle empty protocol data array', () => {
      // Arrange
      const message: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 1,
        data: {
          protocolData: [],
          ilpPacket: Buffer.from('test', 'utf8'),
        },
      };

      // Act
      const buffer = serializeBTPMessage(message);

      // Assert
      expect(buffer.readUInt8(5)).toBe(0); // Protocol data count = 0
    });

    it('should handle missing ILP packet (undefined)', () => {
      // Arrange
      const message: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 1,
        data: {
          protocolData: [],
        },
      };

      // Act
      const buffer = serializeBTPMessage(message);

      // Assert - ILP packet length should be 0
      const ilpLengthOffset = 6; // After type (1) + requestId (4) + protocol data count (1)
      expect(buffer.readUInt32BE(ilpLengthOffset)).toBe(0);
    });
  });

  describe('Round-trip serialization', () => {
    it('should preserve MESSAGE through serialize -> parse cycle', () => {
      // Arrange
      const original: BTPMessage = {
        type: BTPMessageType.MESSAGE,
        requestId: 12345,
        data: {
          protocolData: [
            {
              protocolName: 'ilp',
              contentType: 1,
              data: Buffer.from('test-data', 'utf8'),
            },
          ],
          ilpPacket: Buffer.from('packet-data', 'utf8'),
        },
      };

      // Act
      const buffer = serializeBTPMessage(original);
      const parsed = parseBTPMessage(buffer);

      // Assert
      expect(parsed.type).toBe(original.type);
      expect(parsed.requestId).toBe(original.requestId);
      expect((parsed.data as BTPData).protocolData).toHaveLength(1);
      expect((parsed.data as BTPData).protocolData[0]?.protocolName).toBe('ilp');
      expect((parsed.data as BTPData).ilpPacket).toEqual((original.data as BTPData).ilpPacket);
    });

    it('should preserve ERROR through serialize -> parse cycle', () => {
      // Arrange
      const original: BTPMessage = {
        type: BTPMessageType.ERROR,
        requestId: 54321,
        data: {
          code: 'F02',
          name: 'UnreachableError',
          triggeredAt: '2025-12-27T10:00:00.000Z',
          data: Buffer.from('error-details', 'utf8'),
        },
      };

      // Act
      const buffer = serializeBTPMessage(original);
      const parsed = parseBTPMessage(buffer);

      // Assert
      expect(parsed.type).toBe(original.type);
      expect(parsed.requestId).toBe(original.requestId);
      expect((parsed.data as BTPErrorData).code).toBe((original.data as BTPErrorData).code);
      expect((parsed.data as BTPErrorData).name).toBe((original.data as BTPErrorData).name);
      expect((parsed.data as BTPErrorData).triggeredAt).toBe(
        (original.data as BTPErrorData).triggeredAt
      );
    });
  });

  describe('BTPError exception', () => {
    it('should throw BTPError for invalid message structure', () => {
      // Arrange
      const buffer = Buffer.from([1, 2]); // Too short

      // Act & Assert
      expect(() => parseBTPMessage(buffer)).toThrow(BTPError);
    });

    it('should create BTPError with correct properties', () => {
      // Arrange & Act
      const error = new BTPError('F00', 'Test error', Buffer.from('test-data', 'utf8'));

      // Assert
      expect(error.code).toBe('F00');
      expect(error.message).toBe('Test error');
      expect(error.btpData).toEqual(Buffer.from('test-data', 'utf8'));
      expect(error.triggeredAt).toBeDefined();
      expect(error.name).toBe('BTPError');
    });

    it('should convert BTPError to BTPErrorData', () => {
      // Arrange
      const error = new BTPError('F01', 'Invalid packet', Buffer.from('details', 'utf8'));

      // Act
      const errorData = error.toBTPErrorData();

      // Assert
      expect(errorData.code).toBe('F01');
      expect(errorData.name).toBe('BTPError');
      expect(errorData.data).toEqual(Buffer.from('details', 'utf8'));
      expect(errorData.triggeredAt).toBeDefined();
    });
  });
});
