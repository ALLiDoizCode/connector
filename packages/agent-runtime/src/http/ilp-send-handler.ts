/**
 * ILP Send Handler
 *
 * Handles `POST /ilp/send` requests from the BLS to initiate outbound ILP packets.
 * Validates the request, computes the execution condition using SHA256(SHA256(data)),
 * constructs an ILP Prepare packet, sends it via the injected `IPacketSender`,
 * and maps the response back to HTTP.
 *
 * @example
 * ```typescript
 * // Register the handler on an Express app
 * const handler = new IlpSendHandler(sender, logger);
 * app.post('/ilp/send', handler.handle.bind(handler));
 * ```
 *
 * HTTP Response Codes:
 * - 200: Both FULFILL and REJECT ILP responses (distinguished by `accepted` boolean)
 * - 400: Validation failure (invalid ILP address, negative amount, non-base64 data, data > 64KB)
 * - 408: No response within timeoutMs
 * - 503: BTP sender not connected or not configured
 */

import * as crypto from 'crypto';
import { Request, Response } from 'express';
import { Logger } from 'pino';
import { PacketType, isValidILPAddress } from '@agent-runtime/shared';
import type { ILPPreparePacket, ILPAddress } from '@agent-runtime/shared';
import type { IlpSendRequest, IlpSendResponse, IPacketSender } from '../types';

/** Default timeout for outbound ILP packets in milliseconds */
const DEFAULT_TIMEOUT_MS = 30000;

/** Maximum decoded data size in bytes (64KB) */
const MAX_DATA_SIZE = 65536;

/**
 * Compute the execution condition and fulfillment from raw data bytes.
 *
 * Uses the simplified fulfillment scheme (not STREAM-based):
 * - `fulfillment = SHA256(data)`
 * - `condition = SHA256(fulfillment)`
 *
 * @param data - Raw data bytes
 * @returns Object with 32-byte condition and fulfillment Buffers
 */
export function computeConditionFromData(data: Buffer): { condition: Buffer; fulfillment: Buffer } {
  const fulfillment = crypto.createHash('sha256').update(data).digest();
  const condition = crypto.createHash('sha256').update(fulfillment).digest();
  return { condition, fulfillment };
}

/**
 * Validate an ILP send request body.
 *
 * @param body - The raw request body
 * @returns An error message string if validation fails, or null if valid
 */
export function validateIlpSendRequest(body: Record<string, unknown>): string | null {
  // Validate destination
  if (!body.destination || typeof body.destination !== 'string') {
    return 'Missing required field: destination';
  }
  if (!isValidILPAddress(body.destination)) {
    return `Invalid ILP address: ${body.destination}`;
  }

  // Validate amount
  if (body.amount === undefined || body.amount === null || typeof body.amount !== 'string') {
    return 'Missing required field: amount';
  }
  if (!/^\d+$/.test(body.amount)) {
    return 'Amount must be a non-negative integer string';
  }

  // Validate data
  if (body.data === undefined || body.data === null || typeof body.data !== 'string') {
    return 'Missing required field: data';
  }

  // Validate base64 encoding by checking round-trip
  let decodedData: Buffer;
  try {
    decodedData = Buffer.from(body.data, 'base64');
    if (decodedData.toString('base64') !== body.data) {
      return 'Data must be valid base64';
    }
  } catch {
    return 'Data must be valid base64';
  }

  // Validate data size
  if (decodedData.length > MAX_DATA_SIZE) {
    return `Data exceeds maximum size of ${MAX_DATA_SIZE} bytes`;
  }

  // Validate optional timeoutMs
  if (body.timeoutMs !== undefined) {
    if (
      typeof body.timeoutMs !== 'number' ||
      !Number.isInteger(body.timeoutMs) ||
      body.timeoutMs <= 0
    ) {
      return 'timeoutMs must be a positive integer';
    }
  }

  return null;
}

/**
 * Handler for `POST /ilp/send`.
 */
export class IlpSendHandler {
  private readonly _sender: IPacketSender | null;
  private readonly _logger: Logger;

  constructor(sender: IPacketSender | null, logger: Logger) {
    this._sender = sender;
    this._logger = logger.child({ component: 'IlpSendHandler' });
  }

  /**
   * Handle an incoming `POST /ilp/send` request.
   *
   * Validates the request, checks sender connectivity, computes the execution
   * condition, constructs an ILP Prepare packet, sends it, and maps the
   * response back to HTTP.
   *
   * @param req - Express request
   * @param res - Express response
   */
  async handle(req: Request, res: Response): Promise<void> {
    this._logger.info({ path: req.path }, 'Received ILP send request');

    try {
      // Check sender configured
      if (!this._sender) {
        this._logger.warn('Outbound sender not configured');
        res.status(503).json({
          error: 'Service unavailable',
          message: 'Outbound sender not configured',
        });
        return;
      }

      // Check sender connected
      if (!this._sender.isConnected()) {
        this._logger.warn('Outbound sender not connected');
        res.status(503).json({
          error: 'Service unavailable',
          message: 'Outbound sender not connected',
        });
        return;
      }

      // Validate request
      const body = req.body as Record<string, unknown>;
      const validationError = validateIlpSendRequest(body);
      if (validationError) {
        this._logger.debug({ error: validationError }, 'Request validation failed');
        res.status(400).json({
          error: 'Bad request',
          message: validationError,
        });
        return;
      }

      const request = body as unknown as IlpSendRequest;
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const rawDataBytes = Buffer.from(request.data, 'base64');

      // Compute condition
      const { condition } = computeConditionFromData(rawDataBytes);

      // Construct ILP Prepare packet
      const preparePacket: ILPPreparePacket = {
        type: PacketType.PREPARE,
        amount: BigInt(request.amount),
        destination: request.destination as ILPAddress,
        executionCondition: condition,
        expiresAt: new Date(Date.now() + timeoutMs),
        data: rawDataBytes,
      };

      // Send packet with timeout
      let timeoutHandle: NodeJS.Timeout | undefined;
      const response = await Promise.race([
        this._sender.sendPacket(preparePacket),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
        }),
      ]).finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      });

      // Map response
      if (response.type === PacketType.FULFILL) {
        const fulfillResponse: IlpSendResponse = {
          accepted: true,
          fulfilled: true,
          fulfillment: response.fulfillment.toString('base64'),
          data: response.data.length > 0 ? response.data.toString('base64') : undefined,
        };
        this._logger.info(
          { destination: request.destination, amount: request.amount },
          'ILP packet fulfilled'
        );
        res.status(200).json(fulfillResponse);
      } else {
        const rejectResponse: IlpSendResponse = {
          accepted: false,
          fulfilled: false,
          code: response.code,
          message: response.message,
          data: response.data.length > 0 ? response.data.toString('base64') : undefined,
        };
        this._logger.info(
          { destination: request.destination, code: response.code, message: response.message },
          'ILP packet rejected'
        );
        res.status(200).json(rejectResponse);
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        this._logger.warn({ timeoutMs: error.timeoutMs }, 'ILP send request timed out');
        res.status(408).json({
          error: 'Request timeout',
          message: `No response received within ${error.timeoutMs}ms`,
        });
        return;
      }

      this._logger.error({ error }, 'Error handling ILP send request');
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Custom error class for timeout handling.
 */
class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timeout after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
