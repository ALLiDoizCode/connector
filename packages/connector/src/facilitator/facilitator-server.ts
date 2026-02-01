import express, { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import cors from 'cors';
import timeout from 'connect-timeout';
import { Server } from 'http';
import pino from 'pino';
import { BTPClient, Peer } from '../btp/btp-client';
import { SPSPClient } from './spsp-client';
import { ServiceRegistry } from './service-registry';
import { handleWorkflowRequest } from './workflow-handler';

export interface FacilitatorConfig {
  nodeId: string;
  httpPort: number;
  btpPort: number;
  connector1BtpUrl: string;
  connector1AuthToken: string;
  maxImageSize: number;
  acceptedFormats: string[];
  spspTimeout: number;
  workflowTimeout: number;
  workflowPeerPaymentPointer: string;
}

export class FacilitatorServer {
  private app: Express;
  private httpServer: Server | null = null;
  private btpClient: BTPClient;
  private spspClient: SPSPClient;
  private serviceRegistry: ServiceRegistry;
  private logger: pino.Logger;
  private config: FacilitatorConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: FacilitatorConfig) {
    this.config = config;
    this.logger = pino({ name: 'facilitator' });
    this.app = express();

    // Create peer configuration for Connector1
    const connector1Peer: Peer = {
      id: 'connector-1',
      url: config.connector1BtpUrl,
      authToken: config.connector1AuthToken,
      connected: false,
      lastSeen: new Date(),
    };

    this.btpClient = new BTPClient(connector1Peer, config.nodeId, this.logger);
    this.spspClient = new SPSPClient(this.logger, config.spspTimeout);
    this.serviceRegistry = new ServiceRegistry(this.logger, this.spspClient);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // CORS middleware (allow localhost:3000 for client UI)
    this.app.use(
      cors({
        origin: ['http://localhost:3000', 'http://localhost:5173'],
        credentials: true,
      })
    );

    // Request timeout middleware (30 seconds)
    this.app.use(timeout(`${this.config.workflowTimeout}ms`));
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.timedout) {
        res.status(504).json({
          error: 'Request timeout',
          message: 'Workflow execution took too long',
          code: 'TIMEOUT',
        });
        return;
      }
      next();
    });

    // JSON body parser
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      const services = this.serviceRegistry.getAllServices();
      const availableServices = services.filter((s) => s.status === 'available');

      res.json({
        status: availableServices.length > 0 ? 'ok' : 'degraded',
        services: Object.fromEntries(services.map((s) => [s.id, s.status])),
      });
    });

    // Workflow processing endpoint
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: this.config.maxImageSize,
      },
      fileFilter: (_req, file, cb) => {
        if (!this.config.acceptedFormats.includes(file.mimetype)) {
          cb(new Error('INVALID_FORMAT'));
          return;
        }
        cb(null, true);
      },
    });

    this.app.post(
      '/api/workflow/process',
      upload.single('image'),
      async (req: Request, res: Response) => {
        await handleWorkflowRequest(
          req,
          res,
          this.serviceRegistry,
          this.spspClient,
          this.btpClient,
          this.logger,
          this.config.maxImageSize,
          this.config.acceptedFormats
        );
      }
    );

    // Service registry endpoints
    this.app.get('/api/services', (_req: Request, res: Response) => {
      const services = this.serviceRegistry.getAllServices();
      res.json(
        services.map((service) => ({
          id: service.id,
          paymentPointer: service.paymentPointer,
          capabilities: service.capabilities,
          status: service.status,
          lastHealthCheck: service.lastHealthCheck,
        }))
      );
    });

    this.app.post('/api/services', (req: Request, res: Response) => {
      const { paymentPointer, capabilities } = req.body;

      if (!paymentPointer || !capabilities) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      const serviceId = this.generateServiceId();
      this.serviceRegistry.register(serviceId, {
        paymentPointer,
        capabilities,
        lastHealthCheck: new Date(),
        status: 'available',
      });

      this.logger.info({ serviceId, paymentPointer }, 'Workflow service registered');

      res.status(201).json({ serviceId });
    });

    // Error handling middleware
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err.message === 'INVALID_FORMAT') {
        res.status(400).json({
          error: 'Invalid image format',
          message: `Supported formats: ${this.config.acceptedFormats.join(', ')}`,
          code: 'INVALID_FORMAT',
        });
        return;
      }

      if (err.message === 'File too large') {
        res.status(400).json({
          error: 'Image too large',
          message: `Maximum size is ${this.config.maxImageSize / 1024 / 1024}MB`,
          code: 'IMAGE_TOO_LARGE',
        });
        return;
      }

      this.logger.error({ err }, 'Unhandled error');
      res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        code: 'INTERNAL_ERROR',
      });
    });
  }

  private generateServiceId(): string {
    return `service-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async start(): Promise<void> {
    try {
      // Connect to Connector1 via BTP
      await this.btpClient.connect();
      this.logger.info('Connected to Connector1 BTP server');

      // Pre-register default workflow peer
      this.serviceRegistry.register('default', {
        paymentPointer: this.config.workflowPeerPaymentPointer,
        capabilities: {
          maxImageSize: 10485760,
          supportedFormats: ['image/jpeg', 'image/png', 'image/webp'],
          availableSteps: ['resize', 'watermark', 'optimize'],
          pricing: { resize: 100, watermark: 200, optimize: 150 },
        },
        lastHealthCheck: new Date(),
        status: 'available',
      });

      // Start periodic health checks (every 60 seconds)
      this.healthCheckInterval = setInterval(() => {
        this.serviceRegistry.performHealthChecks();
      }, 60000);

      // Start HTTP server
      await new Promise<void>((resolve) => {
        this.httpServer = this.app.listen(this.config.httpPort, () => {
          this.logger.info(
            {
              httpPort: this.config.httpPort,
              btpPort: this.config.btpPort,
            },
            'Facilitator started'
          );
          resolve();
        });
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to start facilitator');
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      // Stop health checks
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Disconnect BTP client
      await this.btpClient.disconnect();

      // Close HTTP server
      if (this.httpServer) {
        await new Promise<void>((resolve, reject) => {
          this.httpServer!.close((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        this.httpServer = null;
      }

      this.logger.info('Facilitator stopped');
    } catch (error) {
      this.logger.error({ err: error }, 'Error stopping facilitator');
      throw error;
    }
  }
}
