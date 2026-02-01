import { NostrEvent } from 'nostr-tools';
import { ToonCodec } from '../agent/toon-codec';
import { BTPClient } from '../btp/btp-client';
import { ILPPreparePacket, PacketType } from '@m2m/shared';
import { randomBytes, createHash } from 'crypto';
import { Logger } from 'pino';

export interface GiftwrapRouteResult {
  fulfillment: Buffer;
  latency: number;
}

export class GiftwrapRouter {
  private readonly _toonCodec: ToonCodec;
  private readonly _logger: Logger;

  constructor(
    private readonly _btpClient: BTPClient,
    logger: Logger
  ) {
    this._toonCodec = new ToonCodec();
    this._logger = logger.child({ component: 'GiftwrapRouter' });
  }

  async route(
    giftwrap: NostrEvent,
    recipient: string,
    amount: bigint
  ): Promise<GiftwrapRouteResult> {
    const startTime = Date.now();

    // Validate giftwrap event
    if (giftwrap.kind !== 1059) {
      throw new Error('Invalid giftwrap kind (expected 1059)');
    }

    // Validate recipient address format (ILP address per RFC-0015)
    if (!recipient.match(/^g\.[a-zA-Z0-9._-]+$/)) {
      throw new Error('Invalid recipient address format');
    }

    // Validate amount (min 1 msat, max 1M msat)
    if (amount < 1n || amount > 1000000n) {
      throw new Error('Amount out of range (1 - 1000000 msat)');
    }

    this._logger.info({ recipient, amount: amount.toString() }, 'Routing giftwrap');

    // TOON encode giftwrap (AC 3)
    const toonBuffer = this._toonCodec.encode(giftwrap);
    this._logger.debug({ toonSize: toonBuffer.length }, 'TOON encoded giftwrap');

    // Validate giftwrap size (max 10 KB after TOON encoding)
    if (toonBuffer.length > 10 * 1024) {
      throw new Error('Giftwrap payload too large (max 10 KB)');
    }

    // Generate HTLC secret and condition
    const secret = randomBytes(32);
    const condition = createHash('sha256').update(secret).digest();

    // Create ILP Prepare packet (AC 4)
    const preparePacket: ILPPreparePacket = {
      type: PacketType.PREPARE,
      amount,
      destination: recipient,
      executionCondition: condition,
      expiresAt: new Date(Date.now() + 30000), // 30-second timeout
      data: toonBuffer, // TOON-encoded giftwrap payload
    };

    this._logger.debug(
      {
        packetType: PacketType[preparePacket.type],
        destination: preparePacket.destination,
        dataSize: preparePacket.data.length,
      },
      'Created ILP Prepare packet'
    );

    // Route packet through BTP connection (AC 5)
    try {
      const response = await this._btpClient.sendPacket(preparePacket);

      // Check response type
      if (response.type === PacketType.FULFILL) {
        const latency = Date.now() - startTime;
        this._logger.info({ latency }, 'Giftwrap routed successfully');

        return {
          fulfillment: response.fulfillment,
          latency,
        };
      } else {
        // ILP Reject packet
        this._logger.error(
          { code: response.code, message: response.message },
          'ILP Reject received'
        );

        // Classify errors for proper HTTP status codes
        if (response.code === 'T04' || response.message.includes('Insufficient Liquidity')) {
          throw new Error('Insufficient funds');
        }
        if (
          response.code === 'F02' ||
          response.message.includes('No path found') ||
          response.message.includes('Unreachable')
        ) {
          throw new Error('Routing failure');
        }

        throw new Error(`ILP Reject: ${response.code} - ${response.message}`);
      }
    } catch (error) {
      this._logger.error({ error }, 'Routing error');

      // Re-classify known error types
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('timeout') || errorMessage.includes('Packet send timeout')) {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }
}
