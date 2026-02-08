/**
 * HTTP Server
 *
 * Express server that combines all agent runtime endpoints:
 * - SPSP endpoints for payment setup
 * - ILP packet handling endpoint
 * - Health check endpoint
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import { Logger } from 'pino';
import { SPSPServer } from '../spsp/spsp-server';
import { PacketHandler } from '../packet/packet-handler';
import { SessionManager } from '../session/session-manager';
import { LocalDeliveryRequest, LocalDeliveryResponse, IPacketSender } from '../types';
import { IlpSendHandler } from './ilp-send-handler';

export interface HttpServerConfig {
  /** HTTP server port */
  port: number;
  /** Node ID for logging */
  nodeId: string;
}

/**
 * HTTP server for agent runtime.
 */
export class HttpServer {
  private readonly config: HttpServerConfig;
  private readonly app: Express;
  private readonly spspServer: SPSPServer;
  private readonly packetHandler: PacketHandler;
  private readonly sessionManager: SessionManager;
  private readonly logger: Logger;
  private readonly sender: IPacketSender | null;
  private server: Server | null = null;

  constructor(
    config: HttpServerConfig,
    spspServer: SPSPServer,
    packetHandler: PacketHandler,
    sessionManager: SessionManager,
    logger: Logger,
    sender?: IPacketSender | null
  ) {
    this.config = config;
    this.spspServer = spspServer;
    this.packetHandler = packetHandler;
    this.sessionManager = sessionManager;
    this.logger = logger.child({ component: 'HttpServer' });
    this.sender = sender ?? null;

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Set up Express middleware.
   */
  private setupMiddleware(): void {
    // JSON body parsing
    this.app.use(express.json());

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      this.logger.debug({ method: req.method, path: req.path }, 'Incoming request');
      next();
    });
  }

  /**
   * Set up Express routes.
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      const health: Record<string, unknown> = {
        status: 'healthy',
        nodeId: this.config.nodeId,
        activeSessions: this.sessionManager.sessionCount,
        btpConnected: this.sender ? this.sender.isConnected() : false,
        timestamp: new Date().toISOString(),
      };
      res.json(health);
    });

    // Readiness check (for Kubernetes)
    this.app.get('/ready', (_req: Request, res: Response) => {
      res.json({ ready: true });
    });

    // ILP packet handling endpoint
    this.app.post('/ilp/packets', async (req: Request, res: Response) => {
      try {
        const request = req.body as LocalDeliveryRequest;

        // Validate required fields
        if (!request.destination || !request.amount || !request.executionCondition) {
          res.status(400).json({
            error: 'Missing required fields: destination, amount, executionCondition',
          });
          return;
        }

        const response = await this.packetHandler.handlePacket(request);
        res.json(response);
      } catch (error) {
        this.logger.error({ error }, 'Error handling ILP packet');

        const errorResponse: LocalDeliveryResponse = {
          reject: {
            code: 'T00',
            message: error instanceof Error ? error.message : 'Internal error',
          },
        };
        res.status(500).json(errorResponse);
      }
    });

    // Outbound ILP send endpoint (Epic 20)
    const ilpSendHandler = new IlpSendHandler(this.sender, this.logger);
    this.app.post('/ilp/send', ilpSendHandler.handle.bind(ilpSendHandler));

    // Mount SPSP routes
    this.app.use(this.spspServer.getRouter());

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      this.logger.error({ error: err }, 'Unhandled error');
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          this.logger.info({ port: this.config.port }, 'Agent runtime HTTP server started');
          resolve();
        });

        this.server.on('error', (error) => {
          this.logger.error({ error }, 'HTTP server error');
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.logger.info('Agent runtime HTTP server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Get the Express app instance (for testing).
   */
  getApp(): Express {
    return this.app;
  }
}
