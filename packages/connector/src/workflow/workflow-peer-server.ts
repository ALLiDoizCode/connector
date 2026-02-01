/**
 * Workflow Peer Server
 * Epic 31 Story 31.1 - Workflow Peer Server with Image Processing
 * Tasks 2, 5, 6, 7: Server entry point, cost calculation, packet processing, logging
 */

import type { Logger } from 'pino';
import * as crypto from 'crypto';
import type { ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@m2m/shared';
import { ILPErrorCode, PacketType } from '@m2m/shared';
import { WorkflowHandler } from './workflow-handler';

/**
 * Environment configuration for workflow peer.
 */
export interface WorkflowPeerConfig {
  /** HTTP health endpoint port */
  httpPort?: number;
  /** BTP WebSocket port */
  btpPort?: number;
  /** Maximum image size in bytes */
  maxImageSize?: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  httpPort: 8203,
  btpPort: 3203,
  maxImageSize: 10 * 1024 * 1024, // 10MB
};

/**
 * Workflow peer server for ILP packet-based image processing.
 *
 * This server:
 * - Receives ILP Prepare packets addressed to g.workflow.* addresses
 * - Parses workflow addresses to extract pipeline steps
 * - Validates payment amounts
 * - Executes image processing pipelines (resize, watermark, optimize)
 * - Returns processed images in ILP Fulfill packets
 * - Logs all workflow execution with structured Pino logging
 *
 * @example
 * ```typescript
 * const server = new WorkflowPeerServer({
 *   httpPort: 8203,
 *   btpPort: 3203,
 * }, logger);
 *
 * // Process ILP packet
 * const response = await server.handleILPPacket(packet);
 * ```
 */
export class WorkflowPeerServer {
  private readonly _config: Required<WorkflowPeerConfig>;
  private readonly _logger: Logger;
  private readonly _workflowHandler: WorkflowHandler;

  /**
   * Static fulfillment for workflow packets (deterministic).
   */
  static readonly AGENT_FULFILLMENT = Buffer.alloc(32, 0);

  /**
   * Static condition for workflow packets (SHA-256 of fulfillment).
   */
  static readonly AGENT_CONDITION = crypto
    .createHash('sha256')
    .update(WorkflowPeerServer.AGENT_FULFILLMENT)
    .digest();

  constructor(config: WorkflowPeerConfig, logger: Logger) {
    this._config = {
      httpPort: config.httpPort ?? DEFAULT_CONFIG.httpPort,
      btpPort: config.btpPort ?? DEFAULT_CONFIG.btpPort,
      maxImageSize: config.maxImageSize ?? DEFAULT_CONFIG.maxImageSize,
    };

    this._logger = logger.child({ component: 'WorkflowPeerServer' });
    this._workflowHandler = new WorkflowHandler(this._logger);
  }

  /**
   * Start the workflow peer server.
   */
  async start(): Promise<void> {
    this._logger.info(
      {
        port: this._config.httpPort,
        btpPort: this._config.btpPort,
        maxImageSize: this._config.maxImageSize,
      },
      'Workflow peer started'
    );
  }

  /**
   * Handle incoming ILP packet.
   * @param packet - ILP Prepare packet
   * @returns ILP Fulfill or Reject packet
   */
  async handleILPPacket(packet: ILPPreparePacket): Promise<ILPFulfillPacket | ILPRejectPacket> {
    const address = packet.destination;

    // Check if workflow address
    if (!address.startsWith('g.workflow.')) {
      return this._createReject(packet, ILPErrorCode.F02_UNREACHABLE, 'Destination unreachable');
    }

    const requestId = this._generateRequestId();

    try {
      // Parse workflow pipeline
      const steps = this._workflowHandler.parseWorkflowAddress(address);

      // Validate payment
      const requiredCost = this._workflowHandler.calculateWorkflowCost(
        steps.map((s) => s.stepName)
      );

      if (packet.amount < requiredCost) {
        this._logger.warn(
          {
            requestId,
            required: requiredCost.toString(),
            provided: packet.amount,
          },
          'Insufficient payment'
        );
        return this._createReject(
          packet,
          ILPErrorCode.T04_INSUFFICIENT_LIQUIDITY,
          `Required ${requiredCost} msat, got ${packet.amount}`
        );
      }

      // Decode image from packet data
      const imageBuffer = this._decodeImageData(packet.data);

      // Log workflow execution started
      this._logger.info(
        {
          requestId,
          workflowAddress: packet.destination,
          imageSize: imageBuffer.length,
          steps: steps.length,
          paymentAmount: packet.amount,
        },
        'Workflow execution started'
      );

      // Execute workflow
      const result = await this._workflowHandler.executeWorkflow(steps, imageBuffer);

      // Log workflow completion
      this._logger.info(
        {
          requestId,
          totalDuration: result.totalDuration,
          resultSize: result.processedImage.length,
          stepsCompleted: result.steps.length,
        },
        'Workflow completed'
      );

      // Return fulfillment with processed image
      return this._fulfillPacket(packet, result.processedImage);
    } catch (error) {
      this._logger.error({ err: error, requestId }, 'Workflow execution failed');

      if (error instanceof Error) {
        if (error.message.includes('exceeds maximum')) {
          this._logger.warn({ requestId, error: error.message }, 'Image too large');
          return this._createReject(
            packet,
            ILPErrorCode.T00_INTERNAL_ERROR,
            'Image exceeds maximum size'
          );
        }
        if (error.message.includes('Invalid image')) {
          this._logger.warn({ requestId, error: error.message }, 'Invalid image format');
          return this._createReject(
            packet,
            ILPErrorCode.T00_INTERNAL_ERROR,
            'Invalid image format'
          );
        }
      }

      return this._createReject(
        packet,
        ILPErrorCode.T00_INTERNAL_ERROR,
        'Workflow execution failed'
      );
    }
  }

  /**
   * Decode image data from ILP packet data field.
   * @param data - Packet data buffer
   * @returns Decoded image buffer
   */
  private _decodeImageData(data: Buffer): Buffer {
    // For MVP, packet data is the raw image bytes
    // In production, this might use base64 encoding
    if (data.length === 0) {
      throw new Error('Empty packet data');
    }

    // Check if data is base64 encoded (starts with common base64 patterns)
    const dataStr = data.toString('utf8', 0, Math.min(20, data.length));
    if (dataStr.match(/^[A-Za-z0-9+/]/)) {
      try {
        return Buffer.from(data.toString('utf8'), 'base64');
      } catch {
        // Not base64, treat as raw bytes
        return data;
      }
    }

    return data;
  }

  /**
   * Create ILP Fulfill packet with processed image.
   * @param _prepare - Original prepare packet (unused but kept for signature compatibility)
   * @param imageData - Processed image buffer
   * @returns ILP Fulfill packet
   */
  private _fulfillPacket(_prepare: ILPPreparePacket, imageData: Buffer): ILPFulfillPacket {
    return {
      type: PacketType.FULFILL,
      fulfillment: WorkflowPeerServer.AGENT_FULFILLMENT,
      data: Buffer.from(imageData.toString('base64')),
    };
  }

  /**
   * Create ILP Reject packet.
   * @param prepare - Original prepare packet
   * @param code - ILP error code
   * @param message - Error message
   * @returns ILP Reject packet
   */
  private _createReject(
    prepare: ILPPreparePacket,
    code: ILPErrorCode,
    message: string
  ): ILPRejectPacket {
    return {
      type: PacketType.REJECT,
      code,
      triggeredBy: prepare.destination,
      message,
      data: Buffer.alloc(0),
    };
  }

  /**
   * Generate unique request ID for logging correlation.
   * @returns Request ID string
   */
  private _generateRequestId(): string {
    return crypto.randomBytes(8).toString('hex');
  }
}
