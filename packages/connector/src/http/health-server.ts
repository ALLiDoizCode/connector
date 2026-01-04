/**
 * Health Check HTTP Server - Express endpoint for Docker health checks and monitoring
 * @packageDocumentation
 * @remarks
 * Provides lightweight HTTP health check endpoint separate from BTP WebSocket server.
 * Compliant with Docker HEALTHCHECK and external monitoring tool requirements.
 */

import express, { Express, Request, Response, Router } from 'express';
import { Server } from 'http';
import { Logger } from '../utils/logger';
import { HealthStatus, HealthStatusProvider } from './types';

/**
 * Health Server Configuration
 *
 * Optional configuration for additional routers to mount on the health server.
 *
 * @property settlementRouter - Optional settlement API router (Story 6.7)
 */
export interface HealthServerConfig {
  /**
   * Optional settlement API router
   * If provided, mounts settlement endpoints on the health server
   * Enables settlement API to share port with health check endpoint
   */
  settlementRouter?: Router;
}

/**
 * Health check HTTP server using Express
 * @description
 * Provides GET /health endpoint returning connector operational status.
 * Returns 200 OK when healthy, 503 Service Unavailable when unhealthy/starting.
 *
 * **Settlement API Integration (Story 6.7):**
 * - Accepts optional settlement router in configuration
 * - Mounts settlement router on same Express app (shares port)
 * - Settlement API endpoints: POST /settlement/execute, GET /settlement/status/:peerId
 *
 * @example
 * ```typescript
 * const healthServer = new HealthServer(logger, connectorNode);
 * await healthServer.start(8080);
 * // Server now responding to GET http://localhost:8080/health
 * ```
 *
 * @example
 * ```typescript
 * // With settlement API
 * const settlementRouter = createSettlementRouter(settlementAPIConfig);
 * const healthServer = new HealthServer(logger, connectorNode, { settlementRouter });
 * await healthServer.start(8080);
 * // Server now responding to:
 * // GET http://localhost:8080/health
 * // POST http://localhost:8080/settlement/execute
 * // GET http://localhost:8080/settlement/status/:peerId
 * ```
 *
 * @remarks
 * - Logs health check requests at DEBUG level to avoid log noise
 * - Queries HealthStatusProvider for current status on each request
 * - Port configurable via HEALTH_CHECK_PORT environment variable
 * - Separate from BTP server for isolation and simplicity
 */
export class HealthServer {
  private _app: Express;
  private _server: Server | null = null;
  private readonly _logger: Logger;
  private readonly _healthStatusProvider: HealthStatusProvider;

  /**
   * Create health check server instance
   * @param logger - Pino logger instance for structured logging
   * @param healthStatusProvider - Component providing current health status (typically ConnectorNode)
   * @param config - Optional configuration (e.g., settlement router)
   */
  constructor(
    logger: Logger,
    healthStatusProvider: HealthStatusProvider,
    config?: HealthServerConfig
  ) {
    this._logger = logger.child({ component: 'HealthServer' });
    this._healthStatusProvider = healthStatusProvider;
    this._app = express();

    // Configure health check endpoint
    this._setupRoutes();

    // Mount settlement router if provided
    if (config?.settlementRouter) {
      this._app.use(config.settlementRouter);
      this._logger.info('Settlement API mounted on health server');
    }
  }

  /**
   * Configure Express routes (only /health endpoint)
   * @private
   */
  private _setupRoutes(): void {
    // GET /health - Returns current health status
    this._app.get('/health', (req: Request, res: Response) => {
      try {
        // Get current health status from provider
        const healthStatus: HealthStatus = this._healthStatusProvider.getHealthStatus();

        // Log health check request at DEBUG level (avoid log noise)
        this._logger.debug({
          event: 'health_check',
          status: healthStatus.status,
          ip: req.ip,
        });

        // Set HTTP status code based on health status
        const statusCode = healthStatus.status === 'healthy' ? 200 : 503;

        // Return JSON response
        res.status(statusCode).json(healthStatus);
      } catch (error) {
        // Handle errors in health status retrieval
        this._logger.error({
          event: 'health_check_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Return 503 Service Unavailable on error
        res.status(503).json({
          status: 'unhealthy',
          error: 'Failed to retrieve health status',
        });
      }
    });
  }

  /**
   * Start health check HTTP server
   * @param port - Port to listen on (default: 8080)
   * @returns Promise that resolves when server is listening
   * @throws Error if port is already in use or server fails to start
   *
   * @example
   * ```typescript
   * await healthServer.start(8080);
   * console.log('Health server listening on port 8080');
   * ```
   */
  async start(port: number = 8080): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this._server = this._app.listen(port, () => {
          this._logger.info({
            event: 'health_server_started',
            port,
          });
          resolve();
        });

        // Handle server errors (e.g., port already in use)
        this._server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            const errorMessage = `Health check port ${port} is already in use`;
            this._logger.error({
              event: 'health_server_start_failed',
              port,
              error: errorMessage,
            });
            reject(new Error(errorMessage));
          } else {
            this._logger.error({
              event: 'health_server_error',
              error: error.message,
            });
            reject(error);
          }
        });
      } catch (error) {
        this._logger.error({
          event: 'health_server_start_exception',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        reject(error);
      }
    });
  }

  /**
   * Stop health check HTTP server gracefully
   * @returns Promise that resolves when server is closed
   *
   * @example
   * ```typescript
   * await healthServer.stop();
   * console.log('Health server stopped');
   * ```
   */
  async stop(): Promise<void> {
    if (!this._server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this._server!.close((error) => {
        if (error) {
          this._logger.error({
            event: 'health_server_stop_failed',
            error: error.message,
          });
          reject(error);
        } else {
          this._logger.info({
            event: 'health_server_stopped',
          });
          this._server = null;
          resolve();
        }
      });
    });
  }
}
