import pino from 'pino';

export interface SPSPResponse {
  destination_account: string;
  shared_secret: Buffer;
}

export class SPSPError extends Error {
  public code: string;
  public statusCode?: number;

  constructor(message: string, code?: string, statusCode?: number) {
    super(message);
    this.name = 'SPSPError';
    this.code = code || 'SPSP_ERROR';
    this.statusCode = statusCode;
  }
}

export class SPSPClient {
  private logger: pino.Logger;
  private timeout: number;

  constructor(logger: pino.Logger, timeout: number = 5000) {
    this.logger = logger;
    this.timeout = timeout;
  }

  private paymentPointerToUrl(paymentPointer: string): string {
    // Payment pointer format: $domain/path -> https://domain/.well-known/pay/path
    if (!paymentPointer.startsWith('$')) {
      throw new SPSPError('Invalid payment pointer format', 'INVALID_POINTER');
    }

    const withoutDollar = paymentPointer.substring(1);
    const parts = withoutDollar.split('/');
    const domain = parts[0];
    const path = parts.slice(1).join('/');

    return `https://${domain}/.well-known/pay${path ? '/' + path : ''}`;
  }

  async resolvePaymentPointer(paymentPointer: string): Promise<SPSPResponse> {
    const startTime = Date.now();
    const url = this.paymentPointerToUrl(paymentPointer);

    // Retry logic with exponential backoff
    const maxRetries = 3;
    const backoffDelays = [100, 200, 400];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          headers: { Accept: 'application/spsp4+json' },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 404) {
            throw new SPSPError('Invalid payment pointer', 'INVALID_PAYMENT_POINTER', 404);
          }
          throw new SPSPError(
            `SPSP handshake failed: ${response.status}`,
            'SPSP_ERROR',
            response.status
          );
        }

        interface SPSPResponseData {
          destination_account: string;
          shared_secret: string;
        }
        const data = (await response.json()) as SPSPResponseData;

        if (!data.destination_account || !data.shared_secret) {
          throw new SPSPError('Invalid SPSP response', 'INVALID_RESPONSE');
        }

        const handshakeDuration = Date.now() - startTime;
        this.logger.info(
          {
            paymentPointer,
            destination: data.destination_account,
            duration: handshakeDuration,
          },
          'SPSP handshake complete'
        );

        return {
          destination_account: data.destination_account,
          shared_secret: Buffer.from(data.shared_secret, 'base64'),
        };
      } catch (error: unknown) {
        // Don't retry on certain errors
        if (error instanceof SPSPError) {
          throw error;
        }

        const err = error as NodeJS.ErrnoException;

        // DNS errors
        if (err.code === 'ENOTFOUND') {
          throw new SPSPError('Peer unreachable', 'PEER_UNREACHABLE');
        }

        // Timeout errors
        if (err.name === 'AbortError') {
          if (attempt === maxRetries - 1) {
            throw new SPSPError('SPSP timeout', 'SPSP_TIMEOUT');
          }
          // Retry with backoff
          this.logger.warn(
            { attempt: attempt + 1, delay: backoffDelays[attempt] },
            'SPSP timeout, retrying'
          );
          await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
          continue;
        }

        // Other network errors - retry
        if (attempt === maxRetries - 1) {
          const errorMessage = err.message || 'Unknown error';
          throw new SPSPError(`SPSP handshake failed: ${errorMessage}`, 'SPSP_ERROR');
        }

        this.logger.warn(
          { attempt: attempt + 1, delay: backoffDelays[attempt], err: error },
          'SPSP error, retrying'
        );
        await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
      }
    }

    throw new SPSPError('SPSP handshake failed after retries', 'SPSP_ERROR');
  }
}
