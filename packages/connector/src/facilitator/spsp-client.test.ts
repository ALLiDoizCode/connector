import { SPSPClient } from './spsp-client';
import pino from 'pino';

describe('SPSPClient', () => {
  let client: SPSPClient;
  let logger: pino.Logger;
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    client = new SPSPClient(logger, 5000);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('resolvePaymentPointer', () => {
    it('should resolve payment pointer to ILP address', async () => {
      // Arrange
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          destination_account: 'g.workflow.resize.watermark.optimize',
          shared_secret: Buffer.from('secret-value').toString('base64'),
        }),
      });
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act
      const response = await client.resolvePaymentPointer('$workflow-peer/workflow');

      // Assert
      expect(response.destination_account).toBe('g.workflow.resize.watermark.optimize');
      expect(response.shared_secret).toBeInstanceOf(Buffer);
      expect(response.shared_secret.toString('utf-8')).toBe('secret-value');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://workflow-peer/.well-known/pay/workflow',
        expect.objectContaining({
          headers: { Accept: 'application/spsp4+json' },
        })
      );
    });

    it('should throw error when payment pointer is invalid (404)', async () => {
      // Arrange
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act & Assert
      await expect(client.resolvePaymentPointer('$invalid/pointer')).rejects.toThrow(
        'Invalid payment pointer'
      );
    });

    it('should throw error on SPSP timeout', async () => {
      // Arrange
      const abortError = new Error('The operation was aborted') as NodeJS.ErrnoException;
      abortError.name = 'AbortError';
      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError);
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act & Assert
      await expect(client.resolvePaymentPointer('$slow-peer/workflow')).rejects.toThrow(
        'SPSP timeout'
      );
    });

    it('should retry on failure and succeed on third attempt', async () => {
      // Arrange
      jest.useFakeTimers();
      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            destination_account: 'g.workflow.test',
            shared_secret: Buffer.from('final-secret').toString('base64'),
          }),
        });
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act
      const promise = client.resolvePaymentPointer('$retry-test/workflow');

      // Fast-forward through retry delays
      await jest.runAllTimersAsync();

      const response = await promise;

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(response.destination_account).toBe('g.workflow.test');

      jest.useRealTimers();
    }, 10000);

    it('should convert payment pointer to correct URL', async () => {
      // Arrange
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          destination_account: 'g.test',
          shared_secret: Buffer.from('test').toString('base64'),
        }),
      });
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act
      await client.resolvePaymentPointer('$example.com/path/to/endpoint');

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/.well-known/pay/path/to/endpoint',
        expect.any(Object)
      );
    });

    it('should throw error on DNS resolution failure', async () => {
      // Arrange
      const dnsError = new Error('DNS lookup failed') as NodeJS.ErrnoException;
      dnsError.code = 'ENOTFOUND';
      const mockFetch = jest.fn().mockRejectedValue(dnsError);
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act & Assert
      await expect(
        client.resolvePaymentPointer('$nonexistent-domain.invalid/workflow')
      ).rejects.toThrow('Peer unreachable');
    });

    it('should throw error on invalid SPSP response (missing fields)', async () => {
      // Arrange
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          // Missing destination_account and shared_secret
          invalid: 'response',
        }),
      });
      global.fetch = mockFetch as unknown as typeof global.fetch;

      // Act & Assert
      await expect(client.resolvePaymentPointer('$invalid-response/workflow')).rejects.toThrow(
        'Invalid SPSP response'
      );
    });

    it('should throw error on invalid payment pointer format (no $)', async () => {
      // Act & Assert
      await expect(client.resolvePaymentPointer('invalid-pointer')).rejects.toThrow(
        'Invalid payment pointer format'
      );
    });
  });
});
