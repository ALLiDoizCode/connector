/**
 * BTP Protocol Types and Serialization
 *
 * Self-contained BTP message types and parse/serialize functions for
 * the agent-runtime OutboundBTPClient. Adapted from tools/send-packet/src/btp-sender.ts.
 *
 * Agent-runtime does not depend on @agent-runtime/connector, so BTP types
 * are defined locally here.
 */

/** BTP message types used in the wire protocol */
export enum BTPMessageType {
  RESPONSE = 1,
  ERROR = 2,
  MESSAGE = 6,
}

/** BTP content types */
export const BTP_CONTENT_TYPE_APPLICATION_OCTET_STREAM = 0;

/** Single protocol data entry within a BTP message */
export interface BTPProtocolData {
  protocolName: string;
  contentType: number;
  data: Buffer;
}

/** Data payload for BTP MESSAGE and RESPONSE types */
export interface BTPData {
  protocolData: BTPProtocolData[];
  ilpPacket?: Buffer;
}

/** Data payload for BTP ERROR type */
export interface BTPErrorData {
  code: string;
  name: string;
  triggeredAt: string;
  data: Buffer;
}

/** A parsed BTP message */
export interface BTPMessage {
  type: BTPMessageType;
  requestId: number;
  data: BTPData | BTPErrorData;
}

/**
 * Type guard: returns true when the message carries BTPErrorData.
 */
export function isBTPErrorData(
  message: BTPMessage
): message is BTPMessage & { data: BTPErrorData } {
  return message.type === BTPMessageType.ERROR;
}

/**
 * Parse a BTP message from a raw buffer.
 *
 * Wire format:
 *   [type:1][requestId:4][payload...]
 *
 * Payload for MESSAGE/RESPONSE:
 *   [protocolDataCount:1]
 *     for each: [nameLen:1][name][contentType:2][dataLen:4][data]
 *   [ilpPacketLen:4][ilpPacket?]
 *
 * Payload for ERROR:
 *   [codeLen:1][code][nameLen:1][name][triggeredAtLen:1][triggeredAt][dataLen:4][data]
 */
export function parseBTPMessage(buffer: Buffer): BTPMessage {
  if (buffer.length < 5) {
    throw new Error('BTP message too short');
  }

  let offset = 0;

  const type = buffer.readUInt8(offset);
  offset += 1;

  const requestId = buffer.readUInt32BE(offset);
  offset += 4;

  let data: BTPData | BTPErrorData;

  if (type === BTPMessageType.ERROR) {
    const codeLength = buffer.readUInt8(offset);
    offset += 1;
    const code = buffer.subarray(offset, offset + codeLength).toString('utf8');
    offset += codeLength;

    const nameLength = buffer.readUInt8(offset);
    offset += 1;
    const name = buffer.subarray(offset, offset + nameLength).toString('utf8');
    offset += nameLength;

    const triggeredAtLength = buffer.readUInt8(offset);
    offset += 1;
    const triggeredAt = buffer.subarray(offset, offset + triggeredAtLength).toString('utf8');
    offset += triggeredAtLength;

    const dataLength = buffer.readUInt32BE(offset);
    offset += 4;
    const errorData = buffer.subarray(offset, offset + dataLength);

    data = { code, name, triggeredAt, data: errorData };
  } else {
    const protocolDataCount = buffer.readUInt8(offset);
    offset += 1;

    const protocolData: BTPProtocolData[] = [];
    for (let i = 0; i < protocolDataCount; i++) {
      const protocolNameLength = buffer.readUInt8(offset);
      offset += 1;
      const protocolName = buffer.subarray(offset, offset + protocolNameLength).toString('utf8');
      offset += protocolNameLength;

      const contentType = buffer.readUInt16BE(offset);
      offset += 2;

      const dataLength = buffer.readUInt32BE(offset);
      offset += 4;
      const protoData = buffer.subarray(offset, offset + dataLength);
      offset += dataLength;

      protocolData.push({ protocolName, contentType, data: protoData });
    }

    const ilpPacketLength = buffer.readUInt32BE(offset);
    offset += 4;

    let ilpPacket: Buffer | undefined;
    if (ilpPacketLength > 0) {
      ilpPacket = buffer.subarray(offset, offset + ilpPacketLength);
    }

    data = { protocolData, ilpPacket };
  }

  return { type: type as BTPMessageType, requestId, data };
}

/**
 * Serialize a BTP message to a raw buffer.
 */
export function serializeBTPMessage(message: BTPMessage): Buffer {
  const buffers: Buffer[] = [];

  const typeBuffer = Buffer.allocUnsafe(1);
  typeBuffer.writeUInt8(message.type, 0);
  buffers.push(typeBuffer);

  const requestIdBuffer = Buffer.allocUnsafe(4);
  requestIdBuffer.writeUInt32BE(message.requestId, 0);
  buffers.push(requestIdBuffer);

  if (isBTPErrorData(message)) {
    const { code, name, triggeredAt, data } = message.data;

    buffers.push(Buffer.from([code.length]));
    buffers.push(Buffer.from(code, 'utf8'));

    buffers.push(Buffer.from([name.length]));
    buffers.push(Buffer.from(name, 'utf8'));

    buffers.push(Buffer.from([triggeredAt.length]));
    buffers.push(Buffer.from(triggeredAt, 'utf8'));

    const dataLengthBuffer = Buffer.allocUnsafe(4);
    dataLengthBuffer.writeUInt32BE(data.length, 0);
    buffers.push(dataLengthBuffer);
    buffers.push(data);
  } else {
    const { protocolData, ilpPacket } = message.data as BTPData;

    buffers.push(Buffer.from([protocolData.length]));

    for (const proto of protocolData) {
      buffers.push(Buffer.from([proto.protocolName.length]));
      buffers.push(Buffer.from(proto.protocolName, 'utf8'));

      const contentTypeBuffer = Buffer.allocUnsafe(2);
      contentTypeBuffer.writeUInt16BE(proto.contentType, 0);
      buffers.push(contentTypeBuffer);

      const dataLengthBuffer = Buffer.allocUnsafe(4);
      dataLengthBuffer.writeUInt32BE(proto.data.length, 0);
      buffers.push(dataLengthBuffer);
      buffers.push(proto.data);
    }

    const ilpPacketBuffer = ilpPacket ?? Buffer.alloc(0);
    const ilpLengthBuffer = Buffer.allocUnsafe(4);
    ilpLengthBuffer.writeUInt32BE(ilpPacketBuffer.length, 0);
    buffers.push(ilpLengthBuffer);
    if (ilpPacketBuffer.length > 0) {
      buffers.push(ilpPacketBuffer);
    }
  }

  return Buffer.concat(buffers);
}
