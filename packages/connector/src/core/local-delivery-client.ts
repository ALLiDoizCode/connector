/**
 * Local Delivery Client
 *
 * HTTP client for forwarding ILP packets to an external agent runtime
 * for local delivery handling. Replaces the built-in auto-fulfill stub
 * when localDelivery is configured.
 */

import { Logger } from 'pino';
import {
  ILPPreparePacket,
  ILPFulfillPacket,
  ILPRejectPacket,
  PacketType,
  ILPErrorCode,
} from '@agent-runtime/shared';
import { LocalDeliveryConfig } from '../config/types';

/**
 * Request sent to agent runtime for local delivery.
 */
export interface LocalDeliveryRequest {
  /** Full ILP destination address */
  destination: string;
  /** Amount in smallest unit (as string for precision) */
  amount: string;
  /** Execution condition (base64-encoded 32-byte hash) */
  executionCondition: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
  /** Prepare packet data (base64) */
  data: string;
  /** Peer that sent this packet */
  sourcePeer: string;
}

/**
 * Response from agent runtime.
 */
export interface LocalDeliveryResponse {
  /** Fulfill response (mutually exclusive with reject) */
  fulfill?: {
    /** Fulfillment preimage (base64-encoded 32-byte value) */
    fulfillment: string;
    /** Optional response data (base64) */
    data?: string;
  };
  /** Reject response (mutually exclusive with fulfill) */
  reject?: {
    /** ILP error code (F00-F99, T00-T99, R00-R99) */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Optional error data (base64) */
    data?: string;
  };
}

/**
 * Default configuration values.
 */
const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Client for forwarding local delivery to agent runtime.
 */
export class LocalDeliveryClient {
  private readonly config: Required<LocalDeliveryConfig>;
  private readonly logger: Logger;

  constructor(config: LocalDeliveryConfig, logger: Logger) {
    this.config = {
      enabled: config.enabled ?? false,
      handlerUrl: config.handlerUrl ?? '',
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    };
    this.logger = logger.child({ component: 'LocalDeliveryClient' });

    if (this.config.enabled && !this.config.handlerUrl) {
      throw new Error('LOCAL_DELIVERY_URL is required when local delivery is enabled');
    }
  }

  /**
   * Check if local delivery is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Forward a packet to the agent runtime for local delivery.
   *
   * @param packet - ILP Prepare packet
   * @param sourcePeer - Peer that sent this packet
   * @returns ILP Fulfill or Reject packet
   */
  async deliver(
    packet: ILPPreparePacket,
    sourcePeer: string
  ): Promise<ILPFulfillPacket | ILPRejectPacket> {
    const url = `${this.config.handlerUrl}/ilp/packets`;

    const request: LocalDeliveryRequest = {
      destination: packet.destination,
      amount: packet.amount.toString(),
      executionCondition: packet.executionCondition.toString('base64'),
      expiresAt: packet.expiresAt.toISOString(),
      data: packet.data.toString('base64'),
      sourcePeer,
    };

    this.logger.debug(
      { destination: request.destination, amount: request.amount, url },
      'Forwarding packet to agent runtime'
    );

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.error(
          { status: response.status, destination: request.destination },
          'Agent runtime returned error status'
        );

        return {
          type: PacketType.REJECT,
          code: ILPErrorCode.T00_INTERNAL_ERROR,
          triggeredBy: '',
          message: `Agent runtime returned status ${response.status}`,
          data: Buffer.alloc(0),
        };
      }

      const result = (await response.json()) as LocalDeliveryResponse;

      if (result.fulfill) {
        this.logger.info(
          { destination: request.destination, amount: request.amount },
          'Packet fulfilled by agent runtime'
        );

        return {
          type: PacketType.FULFILL,
          fulfillment: Buffer.from(result.fulfill.fulfillment, 'base64'),
          data: result.fulfill.data ? Buffer.from(result.fulfill.data, 'base64') : Buffer.alloc(0),
        };
      } else if (result.reject) {
        this.logger.info(
          {
            destination: request.destination,
            code: result.reject.code,
            message: result.reject.message,
          },
          'Packet rejected by agent runtime'
        );

        return {
          type: PacketType.REJECT,
          code: (result.reject.code as ILPErrorCode) || ILPErrorCode.F99_APPLICATION_ERROR,
          triggeredBy: '',
          message: result.reject.message || 'Rejected by agent',
          data: result.reject.data ? Buffer.from(result.reject.data, 'base64') : Buffer.alloc(0),
        };
      } else {
        this.logger.error(
          { destination: request.destination },
          'Agent runtime returned invalid response (no fulfill or reject)'
        );

        return {
          type: PacketType.REJECT,
          code: ILPErrorCode.T00_INTERNAL_ERROR,
          triggeredBy: '',
          message: 'Invalid response from agent runtime',
          data: Buffer.alloc(0),
        };
      }
    } catch (error) {
      this.logger.error(
        { destination: request.destination, error },
        'Failed to forward packet to agent runtime'
      );

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          type: PacketType.REJECT,
          code: ILPErrorCode.R00_TRANSFER_TIMED_OUT,
          triggeredBy: '',
          message: 'Agent runtime request timed out',
          data: Buffer.alloc(0),
        };
      }

      return {
        type: PacketType.REJECT,
        code: ILPErrorCode.T00_INTERNAL_ERROR,
        triggeredBy: '',
        message: error instanceof Error ? error.message : 'Unknown error',
        data: Buffer.alloc(0),
      };
    }
  }

  /**
   * Check if the agent runtime is healthy.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    const url = `${this.config.handlerUrl}/health`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch {
      return false;
    }
  }
}
