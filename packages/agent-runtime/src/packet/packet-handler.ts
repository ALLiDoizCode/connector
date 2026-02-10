/**
 * Packet Handler
 *
 * Handles incoming ILP packets from the connector.
 * Computes fulfillment as SHA256(data) — no session lookup required.
 * Forwards all packets destined for this agent's base address to the BLS.
 */

import { Logger } from 'pino';
import { BusinessClient } from '../business/business-client';
import { LocalDeliveryRequest, LocalDeliveryResponse, PaymentRequest } from '../types';
import { computeFulfillmentFromData, generatePaymentId } from '../stream/fulfillment';

/** Maximum ILP data field size per RFC-0027 (32KB) */
const ILP_MAX_DATA_BYTES = 32768;

/**
 * Validate BLS response data before inclusion in ILP FULFILL/REJECT packets.
 *
 * - Returns data unchanged if valid base64 and within 32KB limit
 * - Returns undefined (with warning log) if invalid base64 or oversized
 * - Passes through falsy values (null/undefined/empty) without validation
 */
export function validateIlpResponseData(
  data: string | undefined,
  logger: Logger
): string | undefined {
  if (!data) return data;

  // Validate base64
  try {
    const decoded = Buffer.from(data, 'base64');
    // Verify round-trip (catches non-base64 strings that Buffer.from silently decodes)
    if (decoded.toString('base64') !== data) {
      logger.warn('BLS response data is not valid base64, omitting from ILP response');
      return undefined;
    }
    // Validate size
    if (decoded.length > ILP_MAX_DATA_BYTES) {
      logger.warn(
        { size: decoded.length, limit: ILP_MAX_DATA_BYTES },
        'BLS response data exceeds 32KB ILP limit, omitting from ILP response'
      );
      return undefined;
    }
    return data;
  } catch {
    logger.warn('BLS response data failed base64 decode, omitting from ILP response');
    return undefined;
  }
}

export interface PacketHandlerConfig {
  /** ILP address for this agent (used in reject responses) */
  baseAddress: string;
}

/**
 * Handles ILP packets destined for this agent.
 *
 * Stateless handler — no session manager dependency.
 * Fulfillment is SHA256(data), matching the outbound condition SHA256(SHA256(data)).
 */
export class PacketHandler {
  private readonly businessClient: BusinessClient;
  private readonly logger: Logger;
  /** Base address for this agent */
  readonly baseAddress: string;

  constructor(config: PacketHandlerConfig, businessClient: BusinessClient, logger: Logger) {
    this.baseAddress = config.baseAddress;
    this.businessClient = businessClient;
    this.logger = logger.child({ component: 'PacketHandler' });
  }

  /**
   * Handle an incoming ILP Prepare packet.
   *
   * Flow:
   * 1. Check expiry
   * 2. Build payment request for BLS
   * 3. Call business logic handler
   * 4. Compute SHA256(data) fulfillment if accepted
   *
   * @param request - Local delivery request from connector
   * @returns Local delivery response (fulfill or reject)
   */
  async handlePacket(request: LocalDeliveryRequest): Promise<LocalDeliveryResponse> {
    const { destination, amount, expiresAt, data, sourcePeer } = request;

    this.logger.debug({ destination, amount, sourcePeer }, 'Handling incoming packet');

    // 1. Check if payment has expired
    const expiresAtDate = new Date(expiresAt);
    if (expiresAtDate < new Date()) {
      this.logger.warn({ expiresAt }, 'Payment expired');
      return this.reject('R00', 'Payment has expired');
    }

    // 2. Generate payment ID and build payment request for BLS
    const paymentId = generatePaymentId();

    const paymentRequest: PaymentRequest = {
      paymentId,
      destination,
      amount,
      expiresAt,
      data: data || undefined,
    };

    // 3. Call business logic handler
    try {
      const response = await this.businessClient.handlePayment(paymentRequest);

      // 4. Process response
      if (response.accept) {
        // Compute fulfillment as SHA256(data)
        const fulfillment = computeFulfillmentFromData(Buffer.from(request.data, 'base64'));

        this.logger.info({ paymentId, amount }, 'Payment fulfilled');

        return {
          fulfill: {
            fulfillment: fulfillment.toString('base64'),
            data: validateIlpResponseData(response.data, this.logger),
          },
        };
      } else {
        // Map reject code and return rejection with BLS data pass-through
        const ilpCode = response.rejectReason
          ? this.businessClient.mapRejectCode(response.rejectReason.code)
          : 'F99';
        const message = response.rejectReason?.message ?? 'Payment rejected';

        this.logger.info({ paymentId, code: ilpCode, message }, 'Payment rejected');

        return this.reject(ilpCode, message, validateIlpResponseData(response.data, this.logger));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error({ paymentId, error: msg }, 'Error handling payment');
      return this.reject('T00', 'Internal error processing payment');
    }
  }

  /**
   * Create a reject response.
   *
   * @param code - ILP error code
   * @param message - Human-readable error message
   * @param data - Optional error data
   * @returns Local delivery response with rejection
   */
  private reject(code: string, message: string, data?: string): LocalDeliveryResponse {
    return {
      reject: {
        code,
        message,
        data,
      },
    };
  }
}
