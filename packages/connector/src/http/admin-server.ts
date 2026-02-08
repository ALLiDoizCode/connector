/**
 * Admin API HTTP Server
 * @packageDocumentation
 * @remarks
 * Provides HTTP server for admin API endpoints.
 * Manages dynamic peer and route configuration at runtime.
 *
 * **Security:**
 * - Bind to internal network only (Docker Compose, Kubernetes)
 * - Optional API key authentication
 * - Should NOT be exposed to public internet
 */

import express, { Express } from 'express';
import { Server } from 'http';
import { Logger } from '../utils/logger';
import { RoutingTable } from '../routing/routing-table';
import { BTPClientManager } from '../btp/btp-client-manager';
import { createAdminRouter } from './admin-api';
import { AdminApiConfig } from '../config/types';
import { PeerConfig as SettlementPeerConfig } from '../settlement/types';

/**
 * Admin API HTTP Server
 *
 * Wraps Express app with admin API router and provides start/stop lifecycle.
 *
 * @example
 * ```typescript
 * const adminServer = new AdminServer({
 *   routingTable,
 *   btpClientManager,
 *   nodeId: 'connector-1',
 *   config: { enabled: true, port: 8081 },
 *   logger
 * });
 *
 * await adminServer.start();
 * // Server now accepting requests at http://localhost:8081/admin/*
 *
 * await adminServer.stop();
 * ```
 */
export class AdminServer {
  private _app: Express;
  private _server: Server | null = null;
  private readonly _logger: Logger;
  private readonly _config: AdminApiConfig;
  private readonly _nodeId: string;

  /**
   * Create AdminServer instance
   *
   * @param options - Server configuration
   * @param options.routingTable - Routing table instance for route management
   * @param options.btpClientManager - BTP client manager for peer management
   * @param options.nodeId - Node identifier for logging
   * @param options.config - Admin API configuration
   * @param options.logger - Logger instance
   */
  constructor(options: {
    routingTable: RoutingTable;
    btpClientManager: BTPClientManager;
    nodeId: string;
    config: AdminApiConfig;
    logger: Logger;
    settlementPeers?: Map<string, SettlementPeerConfig>;
  }) {
    const { routingTable, btpClientManager, nodeId, config, logger, settlementPeers } = options;

    this._nodeId = nodeId;
    this._config = config;
    this._logger = logger.child({ component: 'AdminServer' });
    this._app = express();

    // Create and mount admin router
    const adminRouter = createAdminRouter({
      routingTable,
      btpClientManager,
      nodeId,
      apiKey: config.apiKey,
      logger: this._logger,
      settlementPeers,
    });

    this._app.use('/admin', adminRouter);

    // Health endpoint for the admin server itself
    this._app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        service: 'admin-api',
        nodeId: this._nodeId,
        timestamp: new Date().toISOString(),
      });
    });

    this._logger.info(
      {
        event: 'admin_server_initialized',
        port: config.port ?? 8081,
        apiKeyConfigured: !!config.apiKey,
      },
      'Admin server initialized'
    );
  }

  /**
   * Start admin API HTTP server
   *
   * @returns Promise that resolves when server is listening
   * @throws Error if port is already in use
   *
   * @example
   * ```typescript
   * await adminServer.start();
   * console.log('Admin API listening on port 8081');
   * ```
   */
  async start(): Promise<void> {
    const port = this._config.port ?? 8081;
    const host = this._config.host ?? '0.0.0.0';

    return new Promise((resolve, reject) => {
      try {
        this._server = this._app.listen(port, host, () => {
          this._logger.info(
            {
              event: 'admin_server_started',
              port,
              host,
              endpoints: [
                'GET /admin/peers',
                'POST /admin/peers',
                'DELETE /admin/peers/:peerId',
                'GET /admin/routes',
                'POST /admin/routes',
                'DELETE /admin/routes/:prefix',
              ],
            },
            `Admin API server started on ${host}:${port}`
          );
          resolve();
        });

        this._server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            const errorMessage = `Admin API port ${port} is already in use`;
            this._logger.error(
              {
                event: 'admin_server_start_failed',
                port,
                error: errorMessage,
              },
              errorMessage
            );
            reject(new Error(errorMessage));
          } else {
            this._logger.error(
              {
                event: 'admin_server_error',
                error: error.message,
              },
              'Admin server error'
            );
            reject(error);
          }
        });
      } catch (error) {
        this._logger.error(
          {
            event: 'admin_server_start_exception',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Failed to start admin server'
        );
        reject(error);
      }
    });
  }

  /**
   * Stop admin API HTTP server gracefully
   *
   * @returns Promise that resolves when server is closed
   *
   * @example
   * ```typescript
   * await adminServer.stop();
   * console.log('Admin API server stopped');
   * ```
   */
  async stop(): Promise<void> {
    if (!this._server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this._server!.close((error) => {
        if (error) {
          this._logger.error(
            {
              event: 'admin_server_stop_failed',
              error: error.message,
            },
            'Failed to stop admin server'
          );
          reject(error);
        } else {
          this._logger.info(
            {
              event: 'admin_server_stopped',
            },
            'Admin API server stopped'
          );
          this._server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the configured port
   * @returns Admin API port number
   */
  getPort(): number {
    return this._config.port ?? 8081;
  }

  /**
   * Check if server is running
   * @returns true if server is listening
   */
  isRunning(): boolean {
    return this._server !== null && this._server.listening;
  }
}
