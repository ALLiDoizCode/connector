/**
 * ILP Send Handler Tests
 *
 * Unit tests for the POST /ilp/send endpoint handler.
 * Tests condition computation, request validation, response mapping,
 * timeout handling, and sender connectivity checks.
 */

import * as crypto from 'crypto';
import express, { Express } from 'express';
import request from 'supertest';
import pino from 'pino';
import { PacketType, ILPErrorCode } from '@agent-runtime/shared';
import type { ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@agent-runtime/shared';
import {
  IlpSendHandler,
  computeConditionFromData,
  validateIlpSendRequest,
} from './ilp-send-handler';
import type { IPacketSender } from '../types';

/** Silent logger for tests */
const logger = pino({ level: 'silent' });

/** Helper to create a mock IPacketSender */
function createMockSender(overrides: Partial<IPacketSender> = {}): jest.Mocked<IPacketSender> {
  return {
    sendPacket: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
    ...overrides,
  } as jest.Mocked<IPacketSender>;
}

/** Helper to build a valid request body */
function validRequestBody(): Record<string, unknown> {
  return {
    destination: 'g.connector.peer1',
    amount: '1500000',
    data: Buffer.from('Hello World').toString('base64'),
  };
}

/** Helper to create an Express app with the handler */
function createApp(sender: IPacketSender | null): Express {
  const app = express();
  app.use(express.json());
  const handler = new IlpSendHandler(sender, logger);
  app.post('/ilp/send', handler.handle.bind(handler));
  return app;
}

describe('computeConditionFromData', () => {
  it('should compute condition = SHA256(SHA256(data)) for known test vector', () => {
    const data = Buffer.from('Hello World');
    const { condition, fulfillment } = computeConditionFromData(data);

    // Verify fulfillment = SHA256(data)
    const expectedFulfillment = crypto.createHash('sha256').update(data).digest();
    expect(fulfillment.equals(expectedFulfillment)).toBe(true);

    // Verify condition = SHA256(fulfillment)
    const expectedCondition = crypto.createHash('sha256').update(expectedFulfillment).digest();
    expect(condition.equals(expectedCondition)).toBe(true);
  });

  it('should produce valid 32-byte buffers for empty data', () => {
    const data = Buffer.alloc(0);
    const { condition, fulfillment } = computeConditionFromData(data);

    expect(condition.length).toBe(32);
    expect(fulfillment.length).toBe(32);
  });

  it('should produce different conditions for different data', () => {
    const { condition: c1 } = computeConditionFromData(Buffer.from('data1'));
    const { condition: c2 } = computeConditionFromData(Buffer.from('data2'));

    expect(c1.equals(c2)).toBe(false);
  });

  it('should be deterministic', () => {
    const data = Buffer.from('deterministic test');
    const result1 = computeConditionFromData(data);
    const result2 = computeConditionFromData(data);

    expect(result1.condition.equals(result2.condition)).toBe(true);
    expect(result1.fulfillment.equals(result2.fulfillment)).toBe(true);
  });
});

describe('validateIlpSendRequest', () => {
  it('should accept a valid request with all fields', () => {
    expect(validateIlpSendRequest(validRequestBody())).toBeNull();
  });

  it('should accept a request without optional timeoutMs (defaults to 30000)', () => {
    const body = validRequestBody();
    delete body.timeoutMs;
    expect(validateIlpSendRequest(body)).toBeNull();
  });

  it('should accept a valid request with timeoutMs', () => {
    const body = { ...validRequestBody(), timeoutMs: 5000 };
    expect(validateIlpSendRequest(body)).toBeNull();
  });

  describe('destination validation', () => {
    it('should reject missing destination', () => {
      const body = validRequestBody();
      delete body.destination;
      expect(validateIlpSendRequest(body)).toBe('Missing required field: destination');
    });

    it('should reject empty destination', () => {
      const body = { ...validRequestBody(), destination: '' };
      expect(validateIlpSendRequest(body)).toBe('Missing required field: destination');
    });

    it('should reject invalid ILP address', () => {
      const body = { ...validRequestBody(), destination: '..invalid..address' };
      expect(validateIlpSendRequest(body)).toBe('Invalid ILP address: ..invalid..address');
    });

    it('should reject non-string destination', () => {
      const body = { ...validRequestBody(), destination: 123 };
      expect(validateIlpSendRequest(body)).toBe('Missing required field: destination');
    });
  });

  describe('amount validation', () => {
    it('should reject missing amount', () => {
      const body = validRequestBody();
      delete body.amount;
      expect(validateIlpSendRequest(body)).toBe('Missing required field: amount');
    });

    it('should reject negative amount', () => {
      const body = { ...validRequestBody(), amount: '-100' };
      expect(validateIlpSendRequest(body)).toBe('Amount must be a non-negative integer string');
    });

    it('should reject float amount', () => {
      const body = { ...validRequestBody(), amount: '12.5' };
      expect(validateIlpSendRequest(body)).toBe('Amount must be a non-negative integer string');
    });

    it('should reject empty string amount', () => {
      const body = { ...validRequestBody(), amount: '' };
      expect(validateIlpSendRequest(body)).toBe('Amount must be a non-negative integer string');
    });

    it('should accept zero amount', () => {
      const body = { ...validRequestBody(), amount: '0' };
      expect(validateIlpSendRequest(body)).toBeNull();
    });

    it('should reject non-string amount', () => {
      const body = { ...validRequestBody(), amount: 100 };
      expect(validateIlpSendRequest(body)).toBe('Missing required field: amount');
    });
  });

  describe('data validation', () => {
    it('should reject missing data field', () => {
      const body = validRequestBody();
      delete body.data;
      expect(validateIlpSendRequest(body)).toBe('Missing required field: data');
    });

    it('should reject non-base64 data', () => {
      const body = { ...validRequestBody(), data: '!!!not-base64!!!' };
      expect(validateIlpSendRequest(body)).toBe('Data must be valid base64');
    });

    it('should accept empty base64 data', () => {
      const body = { ...validRequestBody(), data: '' };
      // Empty string decodes to empty buffer and re-encodes to empty string
      expect(validateIlpSendRequest(body)).toBeNull();
    });

    it('should reject data exceeding 64KB decoded', () => {
      const largeData = Buffer.alloc(65537); // 1 byte over 64KB
      const body = { ...validRequestBody(), data: largeData.toString('base64') };
      expect(validateIlpSendRequest(body)).toBe('Data exceeds maximum size of 65536 bytes');
    });

    it('should accept data exactly at 64KB decoded', () => {
      const exactData = Buffer.alloc(65536); // Exactly 64KB
      const body = { ...validRequestBody(), data: exactData.toString('base64') };
      expect(validateIlpSendRequest(body)).toBeNull();
    });
  });

  describe('timeoutMs validation', () => {
    it('should reject negative timeoutMs', () => {
      const body = { ...validRequestBody(), timeoutMs: -1 };
      expect(validateIlpSendRequest(body)).toBe('timeoutMs must be a positive integer');
    });

    it('should reject zero timeoutMs', () => {
      const body = { ...validRequestBody(), timeoutMs: 0 };
      expect(validateIlpSendRequest(body)).toBe('timeoutMs must be a positive integer');
    });

    it('should reject float timeoutMs', () => {
      const body = { ...validRequestBody(), timeoutMs: 1.5 };
      expect(validateIlpSendRequest(body)).toBe('timeoutMs must be a positive integer');
    });

    it('should reject string timeoutMs', () => {
      const body = { ...validRequestBody(), timeoutMs: '5000' };
      expect(validateIlpSendRequest(body)).toBe('timeoutMs must be a positive integer');
    });
  });
});

describe('IlpSendHandler', () => {
  let mockSender: jest.Mocked<IPacketSender>;
  let app: Express;
  const pendingTimers: NodeJS.Timeout[] = [];

  beforeEach(() => {
    mockSender = createMockSender();
    app = createApp(mockSender);
  });

  afterEach(() => {
    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.length = 0;
  });

  describe('sender not configured', () => {
    it('should return 503 when sender is null', async () => {
      const nullApp = createApp(null);

      const res = await request(nullApp).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: 'Service unavailable',
        message: 'Outbound sender not configured',
      });
    });
  });

  describe('sender not connected', () => {
    it('should return 503 when sender.isConnected() returns false', async () => {
      mockSender.isConnected.mockReturnValue(false);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: 'Service unavailable',
        message: 'Outbound sender not connected',
      });
    });
  });

  describe('request validation (HTTP integration)', () => {
    it('should return 400 for missing destination', async () => {
      const body = validRequestBody();
      delete body.destination;

      const res = await request(app).post('/ilp/send').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad request');
    });

    it('should return 400 for invalid ILP address', async () => {
      const res = await request(app)
        .post('/ilp/send')
        .send({ ...validRequestBody(), destination: '..bad' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid ILP address');
    });
  });

  describe('FULFILL response mapping', () => {
    it('should return accepted: true on FULFILL response', async () => {
      const responseData = Buffer.from('response data');
      const fulfillmentBuf = Buffer.alloc(32, 0xaa);

      const fulfillPacket: ILPFulfillPacket = {
        type: PacketType.FULFILL,
        fulfillment: fulfillmentBuf,
        data: responseData,
      };
      mockSender.sendPacket.mockResolvedValue(fulfillPacket);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.fulfillment).toBe(fulfillmentBuf.toString('base64'));
      expect(res.body.data).toBe(responseData.toString('base64'));
    });

    it('should return accepted: false on REJECT response', async () => {
      const rejectPacket: ILPRejectPacket = {
        type: PacketType.REJECT,
        code: ILPErrorCode.F02_UNREACHABLE,
        triggeredBy: 'g.connector',
        message: 'No route to destination',
        data: Buffer.from('error details'),
      };
      mockSender.sendPacket.mockResolvedValue(rejectPacket);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(false);
      expect(res.body.code).toBe('F02');
      expect(res.body.message).toBe('No route to destination');
      expect(res.body.data).toBe(Buffer.from('error details').toString('base64'));
    });

    it('should include deprecated fulfilled field matching accepted value', async () => {
      const fulfillPacket: ILPFulfillPacket = {
        type: PacketType.FULFILL,
        fulfillment: Buffer.alloc(32, 0xaa),
        data: Buffer.alloc(0),
      };
      mockSender.sendPacket.mockResolvedValue(fulfillPacket);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.body.accepted).toBe(true);
      expect(res.body.fulfilled).toBe(true);
      expect(res.body.accepted).toBe(res.body.fulfilled);

      // Also verify on reject
      const rejectPacket: ILPRejectPacket = {
        type: PacketType.REJECT,
        code: ILPErrorCode.F02_UNREACHABLE,
        triggeredBy: 'g.connector',
        message: 'No route',
        data: Buffer.alloc(0),
      };
      mockSender.sendPacket.mockResolvedValue(rejectPacket);

      const res2 = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res2.body.accepted).toBe(false);
      expect(res2.body.fulfilled).toBe(false);
      expect(res2.body.accepted).toBe(res2.body.fulfilled);
    });

    it('should omit data field when response data is empty', async () => {
      const fulfillPacket: ILPFulfillPacket = {
        type: PacketType.FULFILL,
        fulfillment: Buffer.alloc(32, 0xbb),
        data: Buffer.alloc(0),
      };
      mockSender.sendPacket.mockResolvedValue(fulfillPacket);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('REJECT response mapping', () => {
    it('should omit data field when reject data is empty', async () => {
      const rejectPacket: ILPRejectPacket = {
        type: PacketType.REJECT,
        code: ILPErrorCode.T00_INTERNAL_ERROR,
        triggeredBy: 'g.connector',
        message: 'Internal error',
        data: Buffer.alloc(0),
      };
      mockSender.sendPacket.mockResolvedValue(rejectPacket);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(false);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('timeout handling', () => {
    it('should return 408 when sender times out', async () => {
      // Mock sender that resolves after the timeout
      mockSender.sendPacket.mockImplementation(
        () =>
          new Promise((resolve) => {
            const timer = setTimeout(
              () =>
                resolve({
                  type: PacketType.FULFILL,
                  fulfillment: Buffer.alloc(32),
                  data: Buffer.alloc(0),
                } as ILPFulfillPacket),
              500
            );
            pendingTimers.push(timer);
          })
      );

      const res = await request(app)
        .post('/ilp/send')
        .send({ ...validRequestBody(), timeoutMs: 50 });

      expect(res.status).toBe(408);
      expect(res.body.error).toBe('Request timeout');
      expect(res.body.message).toContain('50ms');
    }, 10000);

    it('should use default timeout of 30000ms when timeoutMs not specified', async () => {
      const fulfillPacket: ILPFulfillPacket = {
        type: PacketType.FULFILL,
        fulfillment: Buffer.alloc(32, 0xcc),
        data: Buffer.alloc(0),
      };
      mockSender.sendPacket.mockResolvedValue(fulfillPacket);

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(200);

      // Verify the Prepare packet was constructed with correct expiresAt
      const prepareArg = mockSender.sendPacket.mock.calls[0]![0] as ILPPreparePacket;
      const expectedExpiry = Date.now() + 30000;
      // Allow 2 second tolerance
      expect(Math.abs(prepareArg.expiresAt.getTime() - expectedExpiry)).toBeLessThan(2000);
    });
  });

  describe('packet construction', () => {
    it('should construct ILP Prepare packet with correct fields', async () => {
      const fulfillPacket: ILPFulfillPacket = {
        type: PacketType.FULFILL,
        fulfillment: Buffer.alloc(32, 0xdd),
        data: Buffer.alloc(0),
      };
      mockSender.sendPacket.mockResolvedValue(fulfillPacket);

      const body = validRequestBody();
      await request(app).post('/ilp/send').send(body);

      expect(mockSender.sendPacket).toHaveBeenCalledTimes(1);
      const prepareArg = mockSender.sendPacket.mock.calls[0]![0] as ILPPreparePacket;

      expect(prepareArg.type).toBe(PacketType.PREPARE);
      expect(prepareArg.amount).toBe(BigInt('1500000'));
      expect(prepareArg.destination).toBe('g.connector.peer1');
      expect(prepareArg.executionCondition.length).toBe(32);
      expect(prepareArg.data.equals(Buffer.from('Hello World'))).toBe(true);

      // Verify condition matches SHA256(SHA256(data))
      const rawData = Buffer.from(body.data as string, 'base64');
      const { condition: expectedCondition } = computeConditionFromData(rawData);
      expect(prepareArg.executionCondition.equals(expectedCondition)).toBe(true);
    });
  });

  describe('internal error handling', () => {
    it('should return 500 when sender throws an unexpected error', async () => {
      mockSender.sendPacket.mockRejectedValue(new Error('BTP connection reset'));

      const res = await request(app).post('/ilp/send').send(validRequestBody());

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(res.body.message).toBe('BTP connection reset');
    });
  });
});
