/**
 * BTP (Bilateral Transfer Protocol) Type Definitions
 * RFC-0023: https://interledger.org/rfcs/0023-bilateral-transfer-protocol/
 */

/**
 * BTP Message Types per RFC-0023 Section 3
 */
export enum BTPMessageType {
  RESPONSE = 1,
  ERROR = 2,
  PREPARE = 3,
  FULFILL = 4,
  REJECT = 5,
  MESSAGE = 6,
  TRANSFER = 7,
}

/**
 * BTP Protocol Data
 * Sub-protocol data included in BTP messages
 */
export interface BTPProtocolData {
  protocolName: string; // e.g., "ilp", "auth"
  contentType: number; // Content type identifier
  data: Buffer; // Protocol-specific data
}

/**
 * BTP Error Data
 * Error information included in BTP ERROR messages
 */
export interface BTPErrorData {
  code: string; // Error code (e.g., "F00")
  name: string; // Error name (e.g., "BadRequestError")
  triggeredAt: string; // ISO 8601 timestamp when error occurred
  data: Buffer; // Additional error data
}

/**
 * BTP Message Data (non-error messages)
 */
export interface BTPData {
  protocolData: BTPProtocolData[];
  ilpPacket?: Buffer; // OER-encoded ILP packet (optional for some message types)
}

/**
 * BTP Message
 * Complete BTP protocol message per RFC-0023
 */
export interface BTPMessage {
  type: BTPMessageType;
  requestId: number; // uint32 correlation ID
  data: BTPData | BTPErrorData; // Discriminated by type field
}

/**
 * Type guard to check if BTPMessage data is BTPErrorData
 */
export function isBTPErrorData(
  message: BTPMessage
): message is BTPMessage & { data: BTPErrorData } {
  return message.type === BTPMessageType.ERROR;
}

/**
 * Type guard to check if BTPMessage data is BTPData
 */
export function isBTPData(message: BTPMessage): message is BTPMessage & { data: BTPData } {
  return message.type !== BTPMessageType.ERROR;
}

/**
 * BTP Error Custom Exception
 * Thrown when BTP protocol errors occur
 */
export class BTPError extends Error {
  public readonly code: string;
  public readonly triggeredAt: string;
  public readonly btpData: Buffer;

  constructor(code: string, message: string, data: Buffer = Buffer.alloc(0)) {
    super(message);
    this.name = 'BTPError';
    this.code = code;
    this.triggeredAt = new Date().toISOString();
    this.btpData = data;
    Error.captureStackTrace(this, BTPError);
  }

  /**
   * Convert BTPError to BTPErrorData for wire format
   */
  toBTPErrorData(): BTPErrorData {
    return {
      code: this.code,
      name: this.name,
      triggeredAt: this.triggeredAt,
      data: this.btpData,
    };
  }
}
