/**
 * Packet Handler
 *
 * Handles incoming ILP packets from the connector.
 * Verifies conditions, calls business logic, and computes fulfillments.
 */

import { Logger } from 'pino';
import { SessionManager } from '../session/session-manager';
import { BusinessClient } from '../business/business-client';
import { LocalDeliveryRequest, LocalDeliveryResponse, PaymentRequest } from '../types';
import { computeFulfillment, verifyCondition } from '../stream/fulfillment';

export interface PacketHandlerConfig {
  /** ILP address for this agent (used in reject responses) */
  baseAddress: string;
}

/**
 * Handles ILP packets destined for this agent.
 */
export class PacketHandler {
  private readonly sessionManager: SessionManager;
  private readonly businessClient: BusinessClient;
  private readonly logger: Logger;
  /** Base address for this agent (reserved for future use) */
  readonly baseAddress: string;

  constructor(
    config: PacketHandlerConfig,
    sessionManager: SessionManager,
    businessClient: BusinessClient,
    logger: Logger
  ) {
    this.baseAddress = config.baseAddress;
    this.sessionManager = sessionManager;
    this.businessClient = businessClient;
    this.logger = logger.child({ component: 'PacketHandler' });
  }

  /**
   * Handle an incoming ILP Prepare packet.
   *
   * Flow:
   * 1. Look up session by destination address
   * 2. Verify the execution condition
   * 3. Call business logic handler
   * 4. Compute fulfillment if accepted
   *
   * @param request - Local delivery request from connector
   * @returns Local delivery response (fulfill or reject)
   */
  async handlePacket(request: LocalDeliveryRequest): Promise<LocalDeliveryResponse> {
    const { destination, amount, executionCondition, expiresAt, data, sourcePeer } = request;

    this.logger.debug({ destination, amount, sourcePeer }, 'Handling incoming packet');

    // 1. Look up session by destination address
    const session = this.sessionManager.getSessionByAddress(destination);

    if (!session) {
      this.logger.warn({ destination }, 'No session found for destination');
      return this.reject('F02', 'No payment session found for this destination');
    }

    // 2. Decode the prepare data and condition
    const prepareData = Buffer.from(data, 'base64');
    const condition = Buffer.from(executionCondition, 'base64');

    // 3. Verify the execution condition (sanity check)
    if (!verifyCondition(session.sharedSecret, prepareData, condition)) {
      this.logger.warn({ paymentId: session.paymentId }, 'Condition verification failed');
      return this.reject('F01', 'Invalid execution condition');
    }

    // 4. Check if payment has expired
    const expiresAtDate = new Date(expiresAt);
    if (expiresAtDate < new Date()) {
      this.logger.warn({ paymentId: session.paymentId, expiresAt }, 'Payment expired');
      return this.reject('R00', 'Payment has expired');
    }

    // 5. Build payment request for business logic
    const paymentRequest: PaymentRequest = {
      paymentId: session.paymentId,
      destination,
      amount,
      expiresAt,
      data: data || undefined,
      metadata: session.metadata,
    };

    // 6. Call business logic handler
    const response = await this.businessClient.handlePayment(paymentRequest);

    // 7. Process response
    if (response.accept) {
      // Compute fulfillment
      const fulfillment = computeFulfillment(session.sharedSecret, prepareData);

      this.logger.info({ paymentId: session.paymentId, amount }, 'Payment fulfilled');

      return {
        fulfill: {
          fulfillment: fulfillment.toString('base64'),
          data: response.data,
        },
      };
    } else {
      // Map reject code and return rejection
      const ilpCode = response.rejectReason
        ? this.businessClient.mapRejectCode(response.rejectReason.code)
        : 'F99';
      const message = response.rejectReason?.message ?? 'Payment rejected';

      this.logger.info(
        { paymentId: session.paymentId, code: ilpCode, message },
        'Payment rejected'
      );

      return this.reject(ilpCode, message);
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
