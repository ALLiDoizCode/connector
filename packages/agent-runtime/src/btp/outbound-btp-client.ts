/**
 * Outbound BTP Client
 *
 * WebSocket-based BTP client that injects ILP PREPARE packets into the local
 * connector. Implements the IPacketSender interface so it can be wired into
 * the agent-runtime HTTP server for POST /ilp/send.
 *
 * Features:
 * - BTP AUTH handshake on connect
 * - Request/response correlation by requestId
 * - Per-packet send timeout
 * - Exponential-backoff reconnection on unexpected close
 * - Keep-alive ping/pong
 * - Graceful shutdown
 */

import WebSocket from 'ws';
import { Logger } from 'pino';
import {
  ILPPreparePacket,
  ILPFulfillPacket,
  ILPRejectPacket,
  serializePacket,
  deserializePacket,
} from '@agent-runtime/shared';
import type { IPacketSender } from '../types';
import {
  BTPMessageType,
  BTP_CONTENT_TYPE_APPLICATION_OCTET_STREAM,
  parseBTPMessage,
  serializeBTPMessage,
  isBTPErrorData,
} from './btp-protocol';
import type { BTPData } from './btp-protocol';

/**
 * Configuration for OutboundBTPClient.
 */
export interface OutboundBTPClientConfig {
  /** WebSocket URL of the local connector BTP endpoint */
  url: string;
  /** Shared secret for BTP authentication */
  authToken: string;
  /** Peer ID used during BTP AUTH handshake */
  peerId?: string;
  /** Maximum reconnection attempts (default: 5) */
  maxRetries?: number;
  /** Base retry delay in ms (default: 1000) */
  retryBaseMs?: number;
  /** Maximum retry delay cap in ms (default: 16000) */
  retryCapMs?: number;
  /** Per-packet send timeout in ms (default: 10000) */
  packetTimeoutMs?: number;
  /** Auth handshake timeout in ms (default: 5000) */
  authTimeoutMs?: number;
  /** Keep-alive ping interval in ms (default: 30000) */
  pingIntervalMs?: number;
  /** Pong response timeout in ms (default: 10000) */
  pongTimeoutMs?: number;
}

/** BTP connection error */
export class BTPConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BTPConnectionError';
  }
}

/** BTP authentication error */
export class BTPAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BTPAuthenticationError';
  }
}

/** Pending request entry */
interface PendingRequest {
  resolve: (packet: ILPFulfillPacket | ILPRejectPacket) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

/**
 * Outbound BTP client implementing IPacketSender.
 *
 * Connects to the local connector via BTP WebSocket, authenticates,
 * and forwards ILP PREPARE packets. Handles reconnection and keep-alive.
 */
export class OutboundBTPClient implements IPacketSender {
  private readonly _config: Required<Omit<OutboundBTPClientConfig, 'authToken'>> & {
    authToken: string;
  };
  private readonly _logger: Logger;
  private _ws: WebSocket | null = null;
  private _connected = false;
  private _explicitDisconnect = false;
  private _requestIdCounter = 0;
  private _retryCount = 0;
  private _retryTimer: NodeJS.Timeout | null = null;
  private _pingInterval: NodeJS.Timeout | null = null;
  private _pongTimeout: NodeJS.Timeout | null = null;
  private readonly _pendingRequests: Map<number, PendingRequest> = new Map();

  // Bound event handlers (stored for proper cleanup)
  private readonly _boundHandleMessage: (data: Buffer) => void;
  private readonly _boundHandleClose: () => void;
  private readonly _boundHandleError: (err: Error) => void;
  private readonly _boundHandlePong: () => void;

  constructor(config: OutboundBTPClientConfig, logger: Logger) {
    this._config = {
      url: config.url,
      authToken: config.authToken,
      peerId: config.peerId ?? 'agent-runtime',
      maxRetries: config.maxRetries ?? 5,
      retryBaseMs: config.retryBaseMs ?? 1000,
      retryCapMs: config.retryCapMs ?? 16000,
      packetTimeoutMs: config.packetTimeoutMs ?? 10000,
      authTimeoutMs: config.authTimeoutMs ?? 5000,
      pingIntervalMs: config.pingIntervalMs ?? 30000,
      pongTimeoutMs: config.pongTimeoutMs ?? 10000,
    };

    this._logger = logger.child({ component: 'OutboundBTPClient' });

    // Bind event handlers once in constructor
    this._boundHandleMessage = this._handleMessage.bind(this);
    this._boundHandleClose = this._handleClose.bind(this);
    this._boundHandleError = this._handleError.bind(this);
    this._boundHandlePong = this._handlePong.bind(this);
  }

  /**
   * Check whether the client is connected and authenticated.
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the connector BTP endpoint and authenticate.
   *
   * If already connected, this is a no-op.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      this._logger.debug('Already connected, skipping');
      return;
    }

    this._explicitDisconnect = false;

    this._logger.info(
      { url: this._config.url, peerId: this._config.peerId },
      'Connecting to connector BTP endpoint'
    );

    return new Promise<void>((resolve, reject) => {
      try {
        this._ws = new WebSocket(this._config.url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!this._explicitDisconnect) {
          this._scheduleReconnect();
        }
        reject(new BTPConnectionError(`Failed to create WebSocket: ${msg}`));
        return;
      }

      const onOpen = async (): Promise<void> => {
        try {
          await this._authenticate();

          // Remove temp connect handlers before wiring permanent ones
          cleanup();

          // Auth succeeded — wire up permanent handlers
          this._ws?.on('message', this._boundHandleMessage);
          this._ws?.on('close', this._boundHandleClose);
          this._ws?.on('error', this._boundHandleError);
          this._ws?.on('pong', this._boundHandlePong);

          this._connected = true;
          this._retryCount = 0;

          this._startKeepAlive();

          this._logger.info(
            { url: this._config.url, peerId: this._config.peerId },
            'Connected and authenticated'
          );
          resolve();
        } catch (err) {
          // Auth failed — close the WebSocket and schedule reconnection
          this._ws?.removeAllListeners();
          this._ws?.close();
          if (!this._explicitDisconnect) {
            this._scheduleReconnect();
          }
          reject(err);
        }
      };

      const onError = (error: Error): void => {
        cleanup();
        this._logger.error(
          { error: error.message, url: this._config.url },
          'WebSocket connection error'
        );
        if (!this._explicitDisconnect) {
          this._scheduleReconnect();
        }
        reject(new BTPConnectionError(`WebSocket error: ${error.message}`));
      };

      const onClose = (): void => {
        cleanup();
        if (!this._explicitDisconnect) {
          this._scheduleReconnect();
        }
        reject(new BTPConnectionError('WebSocket closed before auth completed'));
      };

      const cleanup = (): void => {
        this._ws?.removeListener('open', onOpen);
        this._ws?.removeListener('error', onError);
        this._ws?.removeListener('close', onClose);
      };

      this._ws.on('open', onOpen);
      this._ws.on('error', onError);
      this._ws.on('close', onClose);
    });
  }

  /**
   * Send an ILP Prepare packet through the BTP connection.
   *
   * Returns the Fulfill or Reject response from the connector.
   * Throws BTPConnectionError if not connected.
   */
  async sendPacket(prepare: ILPPreparePacket): Promise<ILPFulfillPacket | ILPRejectPacket> {
    if (!this._connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new BTPConnectionError('Not connected to connector');
    }

    const serializedPacket = serializePacket(prepare);
    const requestId = this._generateRequestId();

    const btpBuffer = serializeBTPMessage({
      type: BTPMessageType.MESSAGE,
      requestId,
      data: {
        protocolData: [],
        ilpPacket: serializedPacket,
      },
    });

    this._logger.debug(
      { requestId, destination: prepare.destination, amount: prepare.amount.toString() },
      'Sending ILP packet via BTP'
    );

    this._ws.send(btpBuffer);

    // Derive timeout from the ILP packet's expiresAt — the protocol-level timeout.
    // This ensures the BTP layer waits as long as the packet is valid,
    // regardless of how many hops remain in the path.
    let timeoutMs: number;
    if (prepare.expiresAt) {
      const remaining = prepare.expiresAt.getTime() - Date.now();
      timeoutMs = Math.max(remaining - 500, 1000);
    } else {
      timeoutMs = this._config.packetTimeoutMs;
    }

    return new Promise<ILPFulfillPacket | ILPRejectPacket>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new BTPConnectionError(`Packet send timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      this._pendingRequests.set(requestId, { resolve, reject, timeoutId });
    });
  }

  /**
   * Gracefully disconnect from the connector.
   *
   * Rejects all pending requests, stops reconnection and keep-alive.
   */
  async disconnect(): Promise<void> {
    this._explicitDisconnect = true;
    this._connected = false;

    this._stopKeepAlive();
    this._clearRetryTimer();

    if (this._ws) {
      this._ws.removeAllListeners();
      if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
        this._ws.close();
      }
      this._ws = null;
    }

    this._rejectAllPending(new BTPConnectionError('Disconnected'));
    this._logger.info('Disconnected from connector');
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Perform the BTP AUTH handshake.
   */
  private async _authenticate(): Promise<void> {
    this._logger.debug({ peerId: this._config.peerId }, 'Starting BTP authentication');

    const authData = Buffer.from(
      JSON.stringify({ peerId: this._config.peerId, secret: this._config.authToken }),
      'utf8'
    );

    const requestId = this._generateRequestId();

    const authBuffer = serializeBTPMessage({
      type: BTPMessageType.MESSAGE,
      requestId,
      data: {
        protocolData: [
          {
            protocolName: 'auth',
            contentType: BTP_CONTENT_TYPE_APPLICATION_OCTET_STREAM,
            data: authData,
          },
        ],
        ilpPacket: Buffer.alloc(0),
      },
    });

    if (!this._ws) {
      throw new BTPAuthenticationError('WebSocket not available');
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._ws?.removeListener('message', authHandler);
        reject(new BTPAuthenticationError('Authentication timeout'));
      }, this._config.authTimeoutMs);

      const authHandler = (data: Buffer): void => {
        try {
          const message = parseBTPMessage(data);

          if (message.requestId === requestId) {
            clearTimeout(timeout);
            this._ws?.removeListener('message', authHandler);

            if (message.type === BTPMessageType.ERROR) {
              const errData = isBTPErrorData(message)
                ? message.data
                : { code: 'UNKNOWN', name: 'Unknown error' };
              reject(new BTPAuthenticationError(`Authentication failed: ${errData.code}`));
            } else if (message.type === BTPMessageType.RESPONSE) {
              this._logger.debug('BTP authentication successful');
              resolve();
            }
          }
        } catch (err) {
          clearTimeout(timeout);
          this._ws?.removeListener('message', authHandler);
          const msg = err instanceof Error ? err.message : String(err);
          reject(new BTPAuthenticationError(msg));
        }
      };

      this._ws?.on('message', authHandler);
      this._ws?.send(authBuffer);
    });
  }

  /**
   * Handle incoming BTP message (RESPONSE or ERROR for a pending request).
   */
  private _handleMessage(data: Buffer): void {
    try {
      const message = parseBTPMessage(data);

      if (message.type === BTPMessageType.RESPONSE || message.type === BTPMessageType.ERROR) {
        const pending = this._pendingRequests.get(message.requestId);
        if (!pending) {
          this._logger.debug(
            { requestId: message.requestId },
            'Received response for unknown requestId'
          );
          return;
        }

        clearTimeout(pending.timeoutId);
        this._pendingRequests.delete(message.requestId);

        if (message.type === BTPMessageType.ERROR) {
          const errData = isBTPErrorData(message)
            ? message.data
            : { code: 'UNKNOWN', name: 'Unknown error', data: Buffer.alloc(0) };
          this._logger.debug(
            { requestId: message.requestId, errorCode: errData.code },
            'Received BTP ERROR'
          );
          pending.reject(new BTPConnectionError(`BTP Error: ${errData.code} - ${errData.name}`));
        } else {
          const ilpPacket = (message.data as BTPData).ilpPacket;
          if (ilpPacket) {
            const responsePacket = deserializePacket(ilpPacket);
            this._logger.debug(
              { requestId: message.requestId, packetType: responsePacket.type },
              'Received ILP response'
            );
            pending.resolve(responsePacket as ILPFulfillPacket | ILPRejectPacket);
          } else {
            pending.reject(new BTPConnectionError('No ILP packet in BTP RESPONSE'));
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._logger.error({ error: msg }, 'Failed to handle BTP message');
    }
  }

  /**
   * Handle WebSocket close — trigger reconnection if not explicit.
   */
  private _handleClose(): void {
    this._logger.info('BTP WebSocket closed');
    this._connected = false;
    this._stopKeepAlive();
    this._rejectAllPending(new BTPConnectionError('Connection closed'));

    if (!this._explicitDisconnect) {
      this._scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error.
   */
  private _handleError(err: Error): void {
    this._logger.error({ error: err.message }, 'BTP WebSocket error');
  }

  /**
   * Handle pong response — clear pong timeout.
   */
  private _handlePong(): void {
    this._logger.debug('Received pong');
    if (this._pongTimeout) {
      clearTimeout(this._pongTimeout);
      this._pongTimeout = null;
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private _scheduleReconnect(): void {
    if (this._retryCount >= this._config.maxRetries) {
      this._logger.error(
        { retryCount: this._retryCount, maxRetries: this._config.maxRetries },
        'Max reconnection retries exceeded'
      );
      return;
    }

    this._retryCount++;
    const backoffMs = Math.min(
      this._config.retryBaseMs * Math.pow(2, this._retryCount - 1),
      this._config.retryCapMs
    );

    this._logger.info({ retryCount: this._retryCount, backoffMs }, 'Scheduling reconnection');

    this._retryTimer = setTimeout(async () => {
      this._retryTimer = null;
      try {
        await this.connect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._logger.error({ error: msg }, 'Reconnection attempt failed');
        // connect() schedules the next reconnect attempt on failure
      }
    }, backoffMs);
  }

  /**
   * Start keep-alive ping/pong.
   */
  private _startKeepAlive(): void {
    this._stopKeepAlive();

    this._pingInterval = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._logger.debug('Sending ping');
        this._ws.ping();

        this._pongTimeout = setTimeout(() => {
          this._logger.warn('Pong timeout — closing WebSocket');
          this._ws?.close();
        }, this._config.pongTimeoutMs);
      }
    }, this._config.pingIntervalMs);
  }

  /**
   * Stop keep-alive ping/pong.
   */
  private _stopKeepAlive(): void {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this._pongTimeout) {
      clearTimeout(this._pongTimeout);
      this._pongTimeout = null;
    }
  }

  /**
   * Clear the reconnection retry timer.
   */
  private _clearRetryTimer(): void {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  /**
   * Generate a unique uint32 request ID (wrapping counter).
   */
  private _generateRequestId(): number {
    this._requestIdCounter = (this._requestIdCounter + 1) & 0xffffffff;
    return this._requestIdCounter;
  }

  /**
   * Reject all pending requests with the given error.
   */
  private _rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this._pendingRequests.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      this._pendingRequests.delete(requestId);
    }
  }
}
