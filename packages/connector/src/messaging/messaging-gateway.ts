import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { Logger } from 'pino';
import * as http from 'http';
import { GiftwrapRouter } from './giftwrap-router';
import { MessagingGatewayConfig } from './types';

export class MessagingGateway {
  private readonly _app: Express;
  private _httpServer: http.Server | null = null;
  private readonly _logger: Logger;

  constructor(
    private readonly _config: MessagingGatewayConfig,
    private readonly _giftwrapRouter: GiftwrapRouter,
    logger: Logger
  ) {
    this._app = express();
    this._app.use(cors()); // Enable CORS for browser clients
    this._app.use(express.json({ limit: '10mb' })); // Support large giftwrap events
    this._logger = logger.child({ component: 'MessagingGateway' });
  }

  start(): Promise<void> {
    // POST /api/route-giftwrap endpoint
    this._app.post('/api/route-giftwrap', this._handleRouteGiftwrap.bind(this));

    // Health check endpoint
    this._app.get('/health', (_req, res) => res.json({ status: 'ok' }));

    // Start HTTP server
    return new Promise((resolve) => {
      this._httpServer = this._app.listen(this._config.httpPort, () => {
        this._logger.info({ port: this._config.httpPort }, 'MessagingGateway HTTP server started');
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._httpServer) {
        resolve();
        return;
      }

      this._httpServer.close(() => {
        this._logger.info('MessagingGateway HTTP server stopped');
        resolve();
      });
    });
  }

  private async _handleRouteGiftwrap(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate request body
      const { giftwrap, recipient, amount } = req.body;

      if (!giftwrap || !recipient || !amount) {
        res.status(400).json({
          error: 'Missing required fields: giftwrap, recipient, amount',
        });
        return;
      }

      // Route giftwrap through ILP network
      const result = await this._giftwrapRouter.route(giftwrap, recipient, BigInt(amount));

      // Return success response
      const latency = Date.now() - startTime;
      res.json({
        success: true,
        fulfill: result.fulfillment.toString('base64'),
        latency,
      });
    } catch (error) {
      this._logger.error({ error }, 'Failed to route giftwrap');

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Error handling (AC 9)
      if (
        errorMessage.includes('Insufficient funds') ||
        errorMessage.includes('insufficient funds')
      ) {
        res.status(402).json({ error: 'Insufficient funds' });
        return;
      }
      if (errorMessage.includes('Routing failure') || errorMessage.includes('routing failure')) {
        res.status(503).json({ error: 'Routing failure' });
        return;
      }
      if (errorMessage.includes('timeout') || errorMessage.includes('Request timeout')) {
        res.status(504).json({ error: 'Request timeout' });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
