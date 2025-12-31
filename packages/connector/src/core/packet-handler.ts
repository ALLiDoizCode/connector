/**
 * ILP Packet Handler - Core forwarding logic for ILPv4 packets
 * @packageDocumentation
 * @see {@link https://github.com/interledger/rfcs/blob/master/0027-interledger-protocol-4/0027-interledger-protocol-4.md|RFC-0027: Interledger Protocol v4}
 */

import {
  ILPPreparePacket,
  ILPFulfillPacket,
  ILPRejectPacket,
  ILPErrorCode,
  PacketType,
  isValidILPAddress,
} from '@m2m/shared';
import { RoutingTable } from '../routing/routing-table';
import { Logger, generateCorrelationId } from '../utils/logger';
import { BTPClientManager } from '../btp/btp-client-manager';
import { BTPServer } from '../btp/btp-server';
import { BTPConnectionError, BTPAuthenticationError } from '../btp/btp-client';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';

/**
 * Packet validation result
 */
interface ValidationResult {
  /** Whether packet passed validation */
  isValid: boolean;
  /** Error code if validation failed */
  errorCode?: ILPErrorCode;
  /** Human-readable error message if validation failed */
  errorMessage?: string;
}

/**
 * Expiry safety margin in milliseconds
 * @remarks
 * Per RFC-0027, connectors must decrement packet expiry to prevent timeout during forwarding.
 * Default safety margin of 1000ms (1 second) provides buffer for network latency.
 */
const EXPIRY_SAFETY_MARGIN_MS = 1000;

/**
 * PacketHandler - Implements ILPv4 packet forwarding logic
 * @remarks
 * Handles ILP Prepare packets by:
 * 1. Validating packet structure and expiration time per RFC-0027
 * 2. Looking up next-hop peer using routing table
 * 3. Decrementing packet expiry by safety margin
 * 4. Forwarding to next-hop peer (integration point for Epic 2)
 * 5. Generating ILP Reject packets for errors
 *
 * @see {@link https://github.com/interledger/rfcs/blob/master/0027-interledger-protocol-4/0027-interledger-protocol-4.md|RFC-0027: Interledger Protocol v4}
 */
export class PacketHandler {
  /**
   * Routing table for next-hop lookups
   */
  private readonly routingTable: RoutingTable;

  /**
   * BTP client manager for packet forwarding to outbound peers
   */
  private readonly btpClientManager: BTPClientManager;

  /**
   * BTP server for packet forwarding to incoming authenticated peers
   */
  private btpServer: BTPServer | null;

  /**
   * Logger instance for structured logging
   * @remarks
   * Pino logger for structured JSON logging with correlation IDs
   */
  private readonly logger: Logger;

  /**
   * Connector node ID for triggeredBy field in reject packets
   */
  private readonly nodeId: string;

  /**
   * Telemetry emitter for sending telemetry to dashboard (optional)
   */
  private readonly telemetryEmitter: TelemetryEmitter | null;

  /**
   * Creates a new PacketHandler instance
   * @param routingTable - Routing table for next-hop lookups
   * @param btpClientManager - BTP client manager for forwarding packets to outbound peers
   * @param nodeId - Connector node ID for reject packet triggeredBy field
   * @param logger - Pino logger instance for structured logging
   * @param telemetryEmitter - Optional telemetry emitter for dashboard reporting
   * @param btpServer - Optional BTP server for forwarding to incoming authenticated peers
   */
  constructor(
    routingTable: RoutingTable,
    btpClientManager: BTPClientManager,
    nodeId: string,
    logger: Logger,
    telemetryEmitter: TelemetryEmitter | null = null,
    btpServer: BTPServer | null = null
  ) {
    this.routingTable = routingTable;
    this.btpClientManager = btpClientManager;
    this.btpServer = btpServer;
    this.nodeId = nodeId;
    this.logger = logger;
    this.telemetryEmitter = telemetryEmitter;
  }

  /**
   * Set BTPServer reference (to resolve circular dependency during initialization)
   * @param btpServer - BTP server instance for incoming peer forwarding
   */
  setBTPServer(btpServer: BTPServer): void {
    this.btpServer = btpServer;
  }

  /**
   * Validate ILP Prepare packet structure and expiration
   * @param packet - ILP Prepare packet to validate
   * @returns Validation result with isValid flag and optional error details
   * @remarks
   * Validates per RFC-0027:
   * - All required fields present (amount, destination, executionCondition, expiresAt, data)
   * - Destination is valid ILP address format per RFC-0015
   * - Packet has not expired (current time < expiresAt)
   * - executionCondition is exactly 32 bytes
   */
  validatePacket(packet: ILPPreparePacket): ValidationResult {
    // Check all required fields present
    if (
      packet.amount === undefined ||
      !packet.destination ||
      !packet.executionCondition ||
      !packet.expiresAt ||
      !packet.data
    ) {
      this.logger.error(
        {
          packetType: packet.type,
          hasAmount: packet.amount !== undefined,
          hasDestination: !!packet.destination,
          hasExecutionCondition: !!packet.executionCondition,
          hasExpiresAt: !!packet.expiresAt,
          hasData: !!packet.data,
          errorCode: ILPErrorCode.F01_INVALID_PACKET,
        },
        'Packet validation failed: missing required fields'
      );
      return {
        isValid: false,
        errorCode: ILPErrorCode.F01_INVALID_PACKET,
        errorMessage: 'Missing required packet fields',
      };
    }

    // Validate destination ILP address format
    if (!isValidILPAddress(packet.destination)) {
      this.logger.error(
        {
          destination: packet.destination,
          errorCode: ILPErrorCode.F01_INVALID_PACKET,
        },
        'Packet validation failed: invalid ILP address format'
      );
      return {
        isValid: false,
        errorCode: ILPErrorCode.F01_INVALID_PACKET,
        errorMessage: `Invalid ILP address format: ${packet.destination}`,
      };
    }

    // Validate executionCondition is 32 bytes
    if (packet.executionCondition.length !== 32) {
      this.logger.error(
        {
          executionConditionLength: packet.executionCondition.length,
          errorCode: ILPErrorCode.F01_INVALID_PACKET,
        },
        'Packet validation failed: executionCondition must be 32 bytes'
      );
      return {
        isValid: false,
        errorCode: ILPErrorCode.F01_INVALID_PACKET,
        errorMessage: 'executionCondition must be exactly 32 bytes',
      };
    }

    // Check if packet has expired
    const currentTime = new Date();
    if (packet.expiresAt <= currentTime) {
      this.logger.error(
        {
          expiresAt: packet.expiresAt.toISOString(),
          currentTime: currentTime.toISOString(),
          errorCode: ILPErrorCode.R00_TRANSFER_TIMED_OUT,
        },
        'Packet validation failed: packet has expired'
      );
      return {
        isValid: false,
        errorCode: ILPErrorCode.R00_TRANSFER_TIMED_OUT,
        errorMessage: 'Packet has expired',
      };
    }

    return { isValid: true };
  }

  /**
   * Decrement packet expiry by safety margin
   * @param expiresAt - Original expiration timestamp
   * @param safetyMargin - Safety margin in milliseconds to subtract
   * @returns New expiration timestamp with safety margin applied
   * @remarks
   * Per RFC-0027, connectors must decrement expiry to prevent timeout during forwarding.
   * Returns null if decremented expiry would be in the past.
   */
  decrementExpiry(expiresAt: Date, safetyMargin: number): Date | null {
    const newExpiry = new Date(expiresAt.getTime() - safetyMargin);
    const currentTime = new Date();

    if (newExpiry <= currentTime) {
      this.logger.debug(
        {
          originalExpiry: expiresAt.toISOString(),
          decrementedExpiry: newExpiry.toISOString(),
          currentTime: currentTime.toISOString(),
          safetyMargin,
        },
        'Expiry decrement would create past timestamp'
      );
      return null;
    }

    this.logger.debug(
      {
        originalExpiry: expiresAt.toISOString(),
        newExpiry: newExpiry.toISOString(),
        safetyMargin,
      },
      'Decremented packet expiry'
    );

    return newExpiry;
  }

  /**
   * Generate ILP Reject packet
   * @param code - ILP error code per RFC-0027
   * @param message - Human-readable error description
   * @param triggeredBy - Address of connector that generated error
   * @returns ILP Reject packet
   * @remarks
   * Generates reject packet per RFC-0027 Section 3.3 with standard error codes:
   * - R00: Transfer Timed Out (packet expired)
   * - F02: Unreachable (no route to destination)
   * - F01: Invalid Packet (malformed packet)
   */
  generateReject(code: ILPErrorCode, message: string, triggeredBy: string): ILPRejectPacket {
    this.logger.info(
      {
        errorCode: code,
        message,
        triggeredBy,
      },
      'Generated reject packet'
    );

    return {
      type: PacketType.REJECT,
      code,
      triggeredBy,
      message,
      data: Buffer.alloc(0),
    };
  }

  /**
   * Forward packet to next-hop peer via BTP
   * @param packet - ILP Prepare packet to forward
   * @param nextHop - Peer identifier to forward to
   * @param correlationId - Correlation ID for tracking packet across logs
   * @returns ILP response packet (Fulfill or Reject) from next-hop peer
   * @throws BTPConnectionError if BTP connection fails
   * @throws BTPAuthenticationError if BTP authentication fails
   * @remarks
   * Forwards packet to next-hop peer using BTPClientManager.
   * Maps BTP errors to ILP error codes:
   * - BTPConnectionError → T01 (Ledger Unreachable)
   * - BTPAuthenticationError → T01 (Ledger Unreachable)
   * - BTP timeout → T00 (Transfer Timed Out)
   */
  private async forwardToNextHop(
    packet: ILPPreparePacket,
    nextHop: string,
    correlationId: string
  ): Promise<ILPFulfillPacket | ILPRejectPacket> {
    this.logger.info(
      {
        correlationId,
        event: 'btp_forward',
        destination: packet.destination,
        amount: packet.amount.toString(),
        peerId: nextHop,
      },
      'Forwarding packet to peer via BTP'
    );

    try {
      // Try forwarding via outbound peer connection first (BTPClientManager)
      // If that fails, try incoming peer connection (BTPServer)
      let response: ILPFulfillPacket | ILPRejectPacket;

      try {
        response = await this.btpClientManager.sendToPeer(nextHop, packet);
        this.logger.debug(
          { correlationId, peerId: nextHop },
          'Forwarded via outbound peer connection'
        );
      } catch (outboundError) {
        // If outbound failed, try incoming peer if BTPServer is available
        if (this.btpServer && this.btpServer.hasPeer(nextHop)) {
          this.logger.debug(
            { correlationId, peerId: nextHop },
            'Outbound peer not available, trying incoming peer connection'
          );
          response = await this.btpServer.sendPacketToPeer(nextHop, packet);
          this.logger.debug(
            { correlationId, peerId: nextHop },
            'Forwarded via incoming peer connection'
          );
        } else {
          // Neither outbound nor incoming peer available
          throw outboundError;
        }
      }

      this.logger.info(
        {
          correlationId,
          event: 'btp_forward_success',
          peerId: nextHop,
          responseType: response.type,
        },
        'Received response from peer via BTP'
      );

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Map BTP errors to ILP error codes
      if (error instanceof BTPConnectionError) {
        this.logger.error(
          {
            correlationId,
            event: 'btp_connection_error',
            peerId: nextHop,
            error: errorMessage,
          },
          'BTP connection failed'
        );
        return this.generateReject(
          ILPErrorCode.T01_PEER_UNREACHABLE,
          `BTP connection to ${nextHop} failed: ${errorMessage}`,
          this.nodeId
        );
      }

      if (error instanceof BTPAuthenticationError) {
        this.logger.error(
          {
            correlationId,
            event: 'btp_auth_error',
            peerId: nextHop,
            error: errorMessage,
          },
          'BTP authentication failed'
        );
        return this.generateReject(
          ILPErrorCode.T01_PEER_UNREACHABLE,
          `BTP authentication to ${nextHop} failed: ${errorMessage}`,
          this.nodeId
        );
      }

      // Check if timeout error
      if (errorMessage.includes('timeout')) {
        this.logger.error(
          {
            correlationId,
            event: 'btp_timeout',
            peerId: nextHop,
            error: errorMessage,
          },
          'BTP packet send timeout'
        );
        return this.generateReject(
          ILPErrorCode.R00_TRANSFER_TIMED_OUT,
          `BTP timeout to ${nextHop}: ${errorMessage}`,
          this.nodeId
        );
      }

      // Unknown error - log and rethrow
      this.logger.error(
        {
          correlationId,
          event: 'btp_forward_error',
          peerId: nextHop,
          error: errorMessage,
        },
        'Unexpected error forwarding packet via BTP'
      );
      throw error;
    }
  }

  /**
   * Handle ILP Prepare packet - main packet processing method
   * @param packet - ILP Prepare packet to process
   * @returns Promise resolving to ILP Fulfill or Reject packet
   * @remarks
   * Complete packet handling flow per RFC-0027:
   * 1. Validate packet structure and expiration
   * 2. Look up next-hop peer using routing table
   * 3. Decrement packet expiry by safety margin
   * 4. Forward to next-hop peer (stub for Epic 1)
   * 5. Return fulfill/reject based on processing result
   *
   * Generates correlation ID for packet tracking across logs.
   */
  async handlePreparePacket(packet: ILPPreparePacket): Promise<ILPFulfillPacket | ILPRejectPacket> {
    const correlationId = generateCorrelationId();

    this.logger.info(
      {
        correlationId,
        packetType: 'PREPARE',
        destination: packet.destination,
        amount: packet.amount.toString(),
        timestamp: Date.now(),
      },
      'Packet received'
    );

    // Emit PACKET_RECEIVED telemetry
    if (this.telemetryEmitter) {
      this.telemetryEmitter.emitPacketReceived(packet, 'unknown');
    }

    // Validate packet
    const validation = this.validatePacket(packet);
    if (!validation.isValid) {
      this.logger.error(
        {
          correlationId,
          packetType: 'REJECT',
          destination: packet.destination,
          errorCode: validation.errorCode,
          reason: validation.errorMessage,
          timestamp: Date.now(),
        },
        'Packet rejected'
      );
      return this.generateReject(validation.errorCode!, validation.errorMessage!, this.nodeId);
    }

    // Look up next-hop peer
    const nextHop = this.routingTable.getNextHop(packet.destination);
    if (nextHop === null) {
      this.logger.info(
        {
          correlationId,
          destination: packet.destination,
          selectedPeer: null,
          reason: 'no route found',
        },
        'Routing decision'
      );

      // Emit ROUTE_LOOKUP telemetry for failed lookup
      if (this.telemetryEmitter) {
        this.telemetryEmitter.emitRouteLookup(packet.destination, null, 'no route found');
      }

      this.logger.error(
        {
          correlationId,
          packetType: 'REJECT',
          destination: packet.destination,
          errorCode: ILPErrorCode.F02_UNREACHABLE,
          reason: 'no route found',
          timestamp: Date.now(),
        },
        'Packet rejected'
      );
      return this.generateReject(
        ILPErrorCode.F02_UNREACHABLE,
        `No route to destination: ${packet.destination}`,
        this.nodeId
      );
    }

    this.logger.info(
      {
        correlationId,
        destination: packet.destination,
        selectedPeer: nextHop,
        reason: 'longest-prefix match',
      },
      'Routing decision'
    );

    // Emit ROUTE_LOOKUP telemetry for successful lookup
    if (this.telemetryEmitter) {
      this.telemetryEmitter.emitRouteLookup(packet.destination, nextHop, 'longest prefix match');
    }

    // Check for local delivery (destination handled by this connector)
    if (nextHop === this.nodeId || nextHop === 'local') {
      this.logger.info(
        {
          correlationId,
          destination: packet.destination,
          reason: 'local delivery',
        },
        'Delivering packet locally'
      );

      // For educational/testing purposes, auto-fulfill local packets
      // In a real implementation, this would be handled by a local account/application
      const fulfillPacket: ILPFulfillPacket = {
        type: PacketType.FULFILL,
        fulfillment: packet.executionCondition, // Educational implementation - using condition as fulfillment
        data: Buffer.from('Local delivery - educational implementation'),
      };

      this.logger.info(
        {
          correlationId,
          event: 'packet_response',
          packetType: PacketType.FULFILL,
          destination: packet.destination,
          timestamp: Date.now(),
        },
        'Returning local fulfillment'
      );

      return fulfillPacket;
    }

    // Decrement expiry
    const newExpiry = this.decrementExpiry(packet.expiresAt, EXPIRY_SAFETY_MARGIN_MS);
    if (newExpiry === null) {
      this.logger.error(
        {
          correlationId,
          packetType: 'REJECT',
          destination: packet.destination,
          errorCode: ILPErrorCode.R00_TRANSFER_TIMED_OUT,
          expiresAt: packet.expiresAt.toISOString(),
          reason: 'Insufficient time remaining for forwarding',
          timestamp: Date.now(),
        },
        'Packet rejected'
      );
      return this.generateReject(
        ILPErrorCode.R00_TRANSFER_TIMED_OUT,
        'Insufficient time remaining for forwarding',
        this.nodeId
      );
    }

    // Create forwarding packet with decremented expiry
    const forwardingPacket: ILPPreparePacket = {
      ...packet,
      expiresAt: newExpiry,
    };

    // Forward to next hop via BTP and return response
    const response = await this.forwardToNextHop(forwardingPacket, nextHop, correlationId);

    // Emit PACKET_SENT telemetry after successful forward
    if (this.telemetryEmitter) {
      const packetId = packet.executionCondition.toString('hex');
      this.telemetryEmitter.emitPacketSent(packetId, nextHop);
    }

    this.logger.info(
      {
        correlationId,
        event: 'packet_response',
        packetType: response.type,
        destination: packet.destination,
        code: response.type === PacketType.REJECT ? response.code : undefined,
        timestamp: Date.now(),
      },
      'Returning packet response'
    );

    return response;
  }
}
