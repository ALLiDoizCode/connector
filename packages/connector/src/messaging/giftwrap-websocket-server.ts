import { WebSocketServer, WebSocket } from 'ws';
import { ToonCodec } from '../agent/toon-codec';
import { ILPPreparePacket } from '@m2m/shared';
import { Logger } from 'pino';
import { NostrEvent } from 'nostr-tools';

export class GiftwrapWebSocketServer {
  private _wss: WebSocketServer | null = null;
  private readonly _toonCodec: ToonCodec;
  private readonly _clients: Map<string, WebSocket>; // clientId -> WebSocket
  private readonly _logger: Logger;

  constructor(
    private readonly _config: { wsPort: number },
    logger: Logger
  ) {
    this._clients = new Map();
    this._toonCodec = new ToonCodec();
    this._logger = logger.child({ component: 'GiftwrapWebSocketServer' });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this._wss = new WebSocketServer({ port: this._config.wsPort });

      this._wss.on('connection', (ws: WebSocket, req) => {
        // Extract client ID from query param or header
        // NOTE: Query parameter authentication is not cryptographically secure for production.
        // TODO: Upgrade to JWT/OAuth token-based authentication in future epic.
        const url = new URL(req.url || '', 'ws://localhost');
        const clientId = url.searchParams.get('clientId');

        if (!clientId) {
          this._logger.warn('WebSocket connection rejected: missing clientId');
          ws.close(1008, 'Missing clientId');
          return;
        }

        this._logger.info({ clientId }, 'WebSocket client connected');
        this._clients.set(clientId, ws);

        ws.on('close', () => {
          this._logger.info({ clientId }, 'WebSocket client disconnected');
          this._clients.delete(clientId);
        });

        ws.on('error', (error) => {
          this._logger.error({ clientId, error }, 'WebSocket error');
        });
      });

      this._wss.on('listening', () => {
        this._logger.info({ port: this._config.wsPort }, 'WebSocket server started');
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._wss) {
        resolve();
        return;
      }

      this._wss.close(() => {
        this._logger.info('WebSocket server stopped');
        resolve();
      });
    });
  }

  // Called when ILP packet received for client (AC 7, 8)
  handleIncomingPacket(packet: ILPPreparePacket, clientId: string): void {
    const ws = this._clients.get(clientId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this._logger.warn({ clientId }, 'Client not connected, dropping packet');
      return;
    }

    // TOON-decode giftwrap from packet data
    const giftwrap: NostrEvent = this._toonCodec.decode(packet.data);

    this._logger.info({ clientId, giftwrapKind: giftwrap.kind }, 'Forwarding giftwrap to client');

    // Send to client via WebSocket
    ws.send(
      JSON.stringify({
        type: 'giftwrap',
        data: giftwrap,
        amount: packet.amount.toString(),
      })
    );
  }
}
