/**
 * Packet Handler Tests
 *
 * Tests for the simplified PacketHandler with SHA256(data) fulfillment.
 */

import { PacketHandler, PacketHandlerConfig, validateIlpResponseData } from './packet-handler';
import { BusinessClient } from '../business/business-client';
import { computeFulfillmentFromData } from '../stream/fulfillment';
import { computeConditionFromData } from '../http/ilp-send-handler';
import { LocalDeliveryRequest, PaymentResponse } from '../types';
import * as crypto from 'crypto';
import pino from 'pino';

// Create a silent logger for tests
const logger = pino({ level: 'silent' });

// Create a logger that captures warnings for validation tests
function createSpyLogger(): { spyLogger: pino.Logger; warnSpy: jest.Mock } {
  const warnSpy = jest.fn();
  const spyLogger = {
    warn: warnSpy,
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: () => spyLogger,
  } as unknown as pino.Logger;
  return { spyLogger, warnSpy };
}

function createMockBusinessClient(): jest.Mocked<BusinessClient> {
  return {
    handlePayment: jest.fn(),
    mapRejectCode: jest.fn().mockReturnValue('F99'),
    healthCheck: jest.fn(),
  } as unknown as jest.Mocked<BusinessClient>;
}

function createValidRequest(overrides?: Partial<LocalDeliveryRequest>): LocalDeliveryRequest {
  const data = Buffer.from('test packet data');
  return {
    destination: 'g.connector.agent.payment123',
    amount: '1000',
    executionCondition: crypto
      .createHash('sha256')
      .update(crypto.createHash('sha256').update(data).digest())
      .digest()
      .toString('base64'),
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    data: data.toString('base64'),
    sourcePeer: 'peer-alice',
    ...overrides,
  };
}

describe('PacketHandler', () => {
  let handler: PacketHandler;
  let mockBusinessClient: jest.Mocked<BusinessClient>;
  const config: PacketHandlerConfig = { baseAddress: 'g.connector.agent' };

  beforeEach(() => {
    mockBusinessClient = createMockBusinessClient();
    handler = new PacketHandler(config, mockBusinessClient, logger);
  });

  describe('constructor', () => {
    it('should take (config, businessClient, logger) — no SessionManager', () => {
      const h = new PacketHandler(config, mockBusinessClient, logger);
      expect(h.baseAddress).toBe('g.connector.agent');
    });
  });

  describe('handlePacket', () => {
    it('should fulfill with SHA256(data) when BLS accepts', async () => {
      const request = createValidRequest();
      const blsResponse: PaymentResponse = { accept: true, data: 'response-data' };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      const result = await handler.handlePacket(request);

      expect(result.fulfill).toBeDefined();
      expect(result.reject).toBeUndefined();

      // Verify fulfillment is base64-encoded SHA256 of decoded data
      const rawData = Buffer.from(request.data, 'base64');
      const expectedFulfillment = computeFulfillmentFromData(rawData);
      expect(result.fulfill!.fulfillment).toBe(expectedFulfillment.toString('base64'));
    });

    it('should include BLS data in FULFILL response', async () => {
      const request = createValidRequest();
      const validBase64Data = Buffer.from('bls-fulfill-data').toString('base64');
      const blsResponse: PaymentResponse = { accept: true, data: validBase64Data };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      const result = await handler.handlePacket(request);

      expect(result.fulfill!.data).toBe(validBase64Data);
    });

    it('should reject with mapped ILP error code when BLS rejects', async () => {
      const request = createValidRequest();
      const blsResponse: PaymentResponse = {
        accept: false,
        rejectReason: { code: 'insufficient_funds', message: 'Not enough balance' },
      };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);
      mockBusinessClient.mapRejectCode.mockReturnValue('F04');

      const result = await handler.handlePacket(request);

      expect(result.reject).toBeDefined();
      expect(result.fulfill).toBeUndefined();
      expect(result.reject!.code).toBe('F04');
      expect(result.reject!.message).toBe('Not enough balance');
      expect(mockBusinessClient.mapRejectCode).toHaveBeenCalledWith('insufficient_funds');
    });

    it('should include BLS data in REJECT response (AC: 5)', async () => {
      const request = createValidRequest();
      const validBase64Data = Buffer.from('rejection-details').toString('base64');
      const blsResponse: PaymentResponse = {
        accept: false,
        data: validBase64Data,
        rejectReason: { code: 'policy', message: 'Rejected by policy' },
      };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);
      mockBusinessClient.mapRejectCode.mockReturnValue('F99');

      const result = await handler.handlePacket(request);

      expect(result.reject).toBeDefined();
      expect(result.reject!.data).toBe(validBase64Data);
    });

    it('should reject R00 for expired packet without calling BLS', async () => {
      const request = createValidRequest({
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      });

      const result = await handler.handlePacket(request);

      expect(result.reject).toBeDefined();
      expect(result.reject!.code).toBe('R00');
      expect(result.reject!.message).toBe('Payment has expired');
      expect(mockBusinessClient.handlePayment).not.toHaveBeenCalled();
    });

    it('should handle empty string data — computes SHA256 of empty buffer, passes undefined to BLS', async () => {
      const request = createValidRequest({ data: '' });
      const blsResponse: PaymentResponse = { accept: true };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      const result = await handler.handlePacket(request);

      expect(result.fulfill).toBeDefined();

      // Verify BLS received undefined for data (empty string coerced)
      const calls = mockBusinessClient.handlePayment.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const paymentRequest = calls[0]![0];
      expect(paymentRequest.data).toBeUndefined();

      // Fulfillment is SHA256 of empty buffer (base64 decode of '' is empty buffer)
      const expectedFulfillment = computeFulfillmentFromData(Buffer.from('', 'base64'));
      expect(result.fulfill!.fulfillment).toBe(expectedFulfillment.toString('base64'));
    });

    it('should accept any destination starting with config.baseAddress (AC: 2)', async () => {
      const blsResponse: PaymentResponse = { accept: true };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      // Test with various destinations under base address
      const destinations = [
        'g.connector.agent.payment1',
        'g.connector.agent.sub.path',
        'g.connector.agent',
      ];

      for (const destination of destinations) {
        const request = createValidRequest({ destination });
        const result = await handler.handlePacket(request);
        expect(result.fulfill).toBeDefined();
      }
    });

    it('should cross-verify fulfillment matches outbound condition', async () => {
      const rawData = Buffer.from('cross-verification data');
      const request = createValidRequest({
        data: rawData.toString('base64'),
      });
      const blsResponse: PaymentResponse = { accept: true };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      const result = await handler.handlePacket(request);

      // The outbound sender computes condition = SHA256(SHA256(data))
      const { condition } = computeConditionFromData(rawData);

      // The inbound handler computes fulfillment = SHA256(data)
      // Verify: SHA256(fulfillment) == condition
      const fulfillmentBuf = Buffer.from(result.fulfill!.fulfillment, 'base64');
      const conditionFromFulfillment = crypto.createHash('sha256').update(fulfillmentBuf).digest();

      expect(conditionFromFulfillment.equals(condition)).toBe(true);
    });

    it('should use F99 when BLS rejects without rejectReason', async () => {
      const request = createValidRequest();
      const blsResponse: PaymentResponse = { accept: false };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      const result = await handler.handlePacket(request);

      expect(result.reject).toBeDefined();
      expect(result.reject!.code).toBe('F99');
      expect(result.reject!.message).toBe('Payment rejected');
    });

    it('should return T00 when BLS call throws an error', async () => {
      const request = createValidRequest();
      mockBusinessClient.handlePayment.mockRejectedValue(new Error('BLS unavailable'));

      const result = await handler.handlePacket(request);

      expect(result.reject).toBeDefined();
      expect(result.reject!.code).toBe('T00');
      expect(result.reject!.message).toBe('Internal error processing payment');
    });

    it('should validate BLS response data in FULFILL path (omits invalid base64)', async () => {
      const request = createValidRequest();
      const blsResponse: PaymentResponse = { accept: true, data: 'not-valid-!!!base64' };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);

      const result = await handler.handlePacket(request);

      expect(result.fulfill).toBeDefined();
      expect(result.fulfill!.data).toBeUndefined();
    });

    it('should validate BLS response data in REJECT path (omits invalid base64)', async () => {
      const request = createValidRequest();
      const blsResponse: PaymentResponse = {
        accept: false,
        data: 'not-valid-!!!base64',
        rejectReason: { code: 'policy', message: 'Rejected' },
      };
      mockBusinessClient.handlePayment.mockResolvedValue(blsResponse);
      mockBusinessClient.mapRejectCode.mockReturnValue('F99');

      const result = await handler.handlePacket(request);

      expect(result.reject).toBeDefined();
      expect(result.reject!.data).toBeUndefined();
    });
  });
});

describe('validateIlpResponseData', () => {
  it('should pass through valid base64 data unchanged', () => {
    const { spyLogger } = createSpyLogger();
    const validData = Buffer.from('hello world').toString('base64');

    const result = validateIlpResponseData(validData, spyLogger);

    expect(result).toBe(validData);
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  it('should return undefined and warn for invalid base64 data', () => {
    const { spyLogger, warnSpy } = createSpyLogger();

    const result = validateIlpResponseData('not-valid-!!!base64', spyLogger);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'BLS response data is not valid base64, omitting from ILP response'
    );
  });

  it('should return undefined and warn for oversized data (> 32KB decoded)', () => {
    const { spyLogger, warnSpy } = createSpyLogger();
    const oversizedData = Buffer.alloc(32769).toString('base64');

    const result = validateIlpResponseData(oversizedData, spyLogger);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      { size: 32769, limit: 32768 },
      'BLS response data exceeds 32KB ILP limit, omitting from ILP response'
    );
  });

  it('should return undefined for undefined data (no validation)', () => {
    const { spyLogger } = createSpyLogger();

    const result = validateIlpResponseData(undefined, spyLogger);

    expect(result).toBeUndefined();
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  it('should return null for null data (no validation, runtime safety)', () => {
    const { spyLogger } = createSpyLogger();

    // At runtime BLS may return null even though types say string | undefined
    const result = validateIlpResponseData(null as unknown as string | undefined, spyLogger);

    expect(result).toBeNull();
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  it('should return empty string for empty string data (falsy short-circuit)', () => {
    const { spyLogger } = createSpyLogger();

    const result = validateIlpResponseData('', spyLogger);

    expect(result).toBe('');
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  it('should pass through exactly 32KB data (boundary)', () => {
    const { spyLogger } = createSpyLogger();
    const exactData = Buffer.alloc(32768).toString('base64');

    const result = validateIlpResponseData(exactData, spyLogger);

    expect(result).toBe(exactData);
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  it('should omit 32KB + 1 byte data (boundary)', () => {
    const { spyLogger, warnSpy } = createSpyLogger();
    const overByOneData = Buffer.alloc(32769).toString('base64');

    const result = validateIlpResponseData(overByOneData, spyLogger);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
