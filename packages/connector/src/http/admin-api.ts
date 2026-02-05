/**
 * Admin API - HTTP endpoints for dynamic peer and route management
 * @packageDocumentation
 * @remarks
 * Provides REST API for runtime configuration of the connector:
 * - Peer management (add/remove BTP connections)
 * - Route management (add/remove routing table entries)
 *
 * **Security:**
 * - Designed for internal Docker Compose network access only
 * - Optional API key authentication
 * - Should NOT be exposed to public internet
 *
 * @example
 * ```typescript
 * const adminRouter = createAdminRouter({
 *   routingTable,
 *   btpClientManager,
 *   logger,
 *   apiKey: 'optional-secret-key'
 * });
 * app.use('/admin', adminRouter);
 * ```
 */

import express, { Router, Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';
import { RoutingTable } from '../routing/routing-table';
import { BTPClientManager } from '../btp/btp-client-manager';
import { Peer } from '../btp/btp-client';
import { ILPAddress, isValidILPAddress } from '@agent-runtime/shared';

/**
 * Admin API Configuration
 */
export interface AdminAPIConfig {
  /** Routing table instance for route management */
  routingTable: RoutingTable;

  /** BTP client manager for peer management */
  btpClientManager: BTPClientManager;

  /** Logger instance */
  logger: Logger;

  /** Optional API key for authentication (if not set, no auth required) */
  apiKey?: string;

  /** Node ID for logging context */
  nodeId: string;
}

/**
 * Request body for adding a peer
 */
export interface AddPeerRequest {
  /** Unique peer identifier */
  id: string;

  /** WebSocket URL for BTP connection (e.g., ws://peer:3000) */
  url: string;

  /** Authentication token for BTP handshake */
  authToken: string;

  /** Optional routes to add for this peer */
  routes?: Array<{
    /** ILP address prefix */
    prefix: string;
    /** Route priority (higher wins, default: 0) */
    priority?: number;
  }>;
}

/**
 * Request body for adding a route
 */
export interface AddRouteRequest {
  /** ILP address prefix (e.g., g.agent.alice) */
  prefix: string;

  /** Peer ID to forward packets to */
  nextHop: string;

  /** Route priority (higher wins, default: 0) */
  priority?: number;
}

/**
 * Create Admin API Express router
 *
 * @param config - Admin API configuration
 * @returns Express router with admin endpoints
 *
 * @remarks
 * Endpoints:
 * - GET /admin/peers - List all peers with connection status
 * - POST /admin/peers - Add a new peer (and optionally routes)
 * - DELETE /admin/peers/:peerId - Remove a peer (and optionally its routes)
 * - GET /admin/routes - List all routes
 * - POST /admin/routes - Add a new route
 * - DELETE /admin/routes/:prefix - Remove a route
 */
export function createAdminRouter(config: AdminAPIConfig): Router {
  const router = Router();
  const { routingTable, btpClientManager, logger, apiKey, nodeId } = config;
  const log = logger.child({ component: 'AdminAPI' });

  // JSON body parser
  router.use(express.json());

  // Optional API key authentication middleware
  if (apiKey) {
    router.use((req: Request, res: Response, next: NextFunction) => {
      const providedKey = req.headers['x-api-key'] || req.query.apiKey;

      if (providedKey !== apiKey) {
        log.warn(
          {
            event: 'admin_api_auth_failed',
            ip: req.ip,
            path: req.path,
          },
          'Admin API authentication failed'
        );
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or missing API key',
        });
        return;
      }

      next();
    });
  }

  // Request logging middleware
  router.use((req: Request, _res: Response, next: NextFunction) => {
    log.info(
      {
        event: 'admin_api_request',
        method: req.method,
        path: req.path,
        ip: req.ip,
      },
      `Admin API: ${req.method} ${req.path}`
    );
    next();
  });

  /**
   * GET /admin/peers
   * List all peers with their connection status
   */
  router.get('/peers', (_req: Request, res: Response) => {
    try {
      const peerIds = btpClientManager.getPeerIds();
      const peerStatus = btpClientManager.getPeerStatus();
      const routes = routingTable.getAllRoutes();

      // Build peer response with ILP addresses from routes
      const peers = peerIds.map((peerId) => {
        // Find routes that use this peer as nextHop
        const peerRoutes = routes.filter((r) => r.nextHop === peerId);
        const ilpAddresses = peerRoutes.map((r) => r.prefix);

        return {
          id: peerId,
          connected: peerStatus.get(peerId) ?? false,
          ilpAddresses,
          routeCount: peerRoutes.length,
        };
      });

      res.json({
        nodeId,
        peerCount: peers.length,
        connectedCount: peers.filter((p) => p.connected).length,
        peers,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ event: 'admin_api_error', error: errorMessage }, 'Failed to list peers');
      res.status(500).json({ error: 'Internal server error', message: errorMessage });
    }
  });

  /**
   * POST /admin/peers
   * Add a new peer with optional routes
   */
  router.post('/peers', async (req: Request, res: Response) => {
    try {
      const body = req.body as AddPeerRequest;

      // Validate required fields
      if (!body.id || typeof body.id !== 'string') {
        res.status(400).json({ error: 'Bad request', message: 'Missing or invalid peer id' });
        return;
      }
      if (!body.url || typeof body.url !== 'string') {
        res.status(400).json({ error: 'Bad request', message: 'Missing or invalid peer url' });
        return;
      }
      if (!body.authToken || typeof body.authToken !== 'string') {
        res.status(400).json({ error: 'Bad request', message: 'Missing or invalid authToken' });
        return;
      }

      // Validate URL format
      if (!body.url.startsWith('ws://') && !body.url.startsWith('wss://')) {
        res.status(400).json({
          error: 'Bad request',
          message: 'URL must start with ws:// or wss://',
        });
        return;
      }

      // Check if peer already exists
      const existingPeers = btpClientManager.getPeerIds();
      if (existingPeers.includes(body.id)) {
        res.status(409).json({
          error: 'Conflict',
          message: `Peer with id '${body.id}' already exists`,
        });
        return;
      }

      // Validate routes if provided
      if (body.routes) {
        for (const route of body.routes) {
          if (!route.prefix || typeof route.prefix !== 'string') {
            res.status(400).json({
              error: 'Bad request',
              message: 'Invalid route: missing prefix',
            });
            return;
          }
          if (!isValidILPAddress(route.prefix)) {
            res.status(400).json({
              error: 'Bad request',
              message: `Invalid ILP address prefix: ${route.prefix}`,
            });
            return;
          }
        }
      }

      // Create peer object
      const peer: Peer = {
        id: body.id,
        url: body.url,
        authToken: body.authToken,
        connected: false,
        lastSeen: new Date(),
      };

      // Add peer to BTP client manager
      await btpClientManager.addPeer(peer);

      log.info(
        { event: 'admin_peer_added', peerId: body.id, url: body.url },
        `Added peer: ${body.id}`
      );

      // Add routes if provided
      const addedRoutes: string[] = [];
      if (body.routes) {
        for (const route of body.routes) {
          routingTable.addRoute(route.prefix as ILPAddress, body.id, route.priority ?? 0);
          addedRoutes.push(route.prefix);
          log.info(
            { event: 'admin_route_added', prefix: route.prefix, nextHop: body.id },
            `Added route: ${route.prefix} -> ${body.id}`
          );
        }
      }

      // Check connection status after a brief delay
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const connected = btpClientManager.isConnected(body.id);

      res.status(201).json({
        success: true,
        peer: {
          id: body.id,
          url: body.url,
          connected,
        },
        routes: addedRoutes,
        message: connected
          ? `Peer '${body.id}' added and connected`
          : `Peer '${body.id}' added (connection pending)`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ event: 'admin_api_error', error: errorMessage }, 'Failed to add peer');
      res.status(500).json({ error: 'Internal server error', message: errorMessage });
    }
  });

  /**
   * DELETE /admin/peers/:peerId
   * Remove a peer and optionally its routes
   */
  router.delete('/peers/:peerId', async (req: Request, res: Response) => {
    try {
      const peerId = req.params.peerId;
      if (!peerId) {
        res.status(400).json({ error: 'Bad request', message: 'Missing peerId parameter' });
        return;
      }
      const removeRoutes = req.query.removeRoutes !== 'false'; // Default: true

      // Check if peer exists
      const existingPeers = btpClientManager.getPeerIds();
      if (!existingPeers.includes(peerId)) {
        res.status(404).json({
          error: 'Not found',
          message: `Peer '${peerId}' not found`,
        });
        return;
      }

      // Remove peer
      await btpClientManager.removePeer(peerId);
      log.info({ event: 'admin_peer_removed', peerId }, `Removed peer: ${peerId}`);

      // Remove routes if requested
      const removedRoutes: string[] = [];
      if (removeRoutes) {
        const routes = routingTable.getAllRoutes();
        for (const route of routes) {
          if (route.nextHop === peerId) {
            routingTable.removeRoute(route.prefix);
            removedRoutes.push(route.prefix);
            log.info(
              { event: 'admin_route_removed', prefix: route.prefix },
              `Removed route: ${route.prefix}`
            );
          }
        }
      }

      res.json({
        success: true,
        peerId,
        removedRoutes,
        message: `Peer '${peerId}' removed${removedRoutes.length > 0 ? ` with ${removedRoutes.length} routes` : ''}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ event: 'admin_api_error', error: errorMessage }, 'Failed to remove peer');
      res.status(500).json({ error: 'Internal server error', message: errorMessage });
    }
  });

  /**
   * GET /admin/routes
   * List all routes in the routing table
   */
  router.get('/routes', (_req: Request, res: Response) => {
    try {
      const routes = routingTable.getAllRoutes();

      res.json({
        nodeId,
        routeCount: routes.length,
        routes: routes.map((r) => ({
          prefix: r.prefix,
          nextHop: r.nextHop,
          priority: r.priority ?? 0,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ event: 'admin_api_error', error: errorMessage }, 'Failed to list routes');
      res.status(500).json({ error: 'Internal server error', message: errorMessage });
    }
  });

  /**
   * POST /admin/routes
   * Add a new route to the routing table
   */
  router.post('/routes', (req: Request, res: Response) => {
    try {
      const body = req.body as AddRouteRequest;

      // Validate required fields
      if (!body.prefix || typeof body.prefix !== 'string') {
        res.status(400).json({ error: 'Bad request', message: 'Missing or invalid prefix' });
        return;
      }
      if (!body.nextHop || typeof body.nextHop !== 'string') {
        res.status(400).json({ error: 'Bad request', message: 'Missing or invalid nextHop' });
        return;
      }

      // Validate ILP address format
      if (!isValidILPAddress(body.prefix)) {
        res.status(400).json({
          error: 'Bad request',
          message: `Invalid ILP address prefix: ${body.prefix}`,
        });
        return;
      }

      // Check if nextHop peer exists (warning only, don't block)
      const existingPeers = btpClientManager.getPeerIds();
      const peerExists = existingPeers.includes(body.nextHop);

      // Add route
      const priority = body.priority ?? 0;
      routingTable.addRoute(body.prefix as ILPAddress, body.nextHop, priority);

      log.info(
        { event: 'admin_route_added', prefix: body.prefix, nextHop: body.nextHop, priority },
        `Added route: ${body.prefix} -> ${body.nextHop}`
      );

      res.status(201).json({
        success: true,
        route: {
          prefix: body.prefix,
          nextHop: body.nextHop,
          priority,
        },
        warning: peerExists ? undefined : `Peer '${body.nextHop}' does not exist yet`,
        message: `Route '${body.prefix}' -> '${body.nextHop}' added`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ event: 'admin_api_error', error: errorMessage }, 'Failed to add route');
      res.status(500).json({ error: 'Internal server error', message: errorMessage });
    }
  });

  /**
   * DELETE /admin/routes/:prefix
   * Remove a route from the routing table
   *
   * Note: prefix is URL-encoded (e.g., g.agent.alice becomes g.agent.alice)
   * Use encodeURIComponent for prefixes with special characters
   */
  router.delete('/routes/:prefix(*)', (req: Request, res: Response) => {
    try {
      const rawPrefix = req.params.prefix;
      if (!rawPrefix) {
        res.status(400).json({ error: 'Bad request', message: 'Missing prefix parameter' });
        return;
      }
      const prefix = decodeURIComponent(rawPrefix);

      // Check if route exists
      const routes = routingTable.getAllRoutes();
      const existingRoute = routes.find((r) => r.prefix === prefix);

      if (!existingRoute) {
        res.status(404).json({
          error: 'Not found',
          message: `Route with prefix '${prefix}' not found`,
        });
        return;
      }

      // Remove route
      routingTable.removeRoute(prefix);

      log.info({ event: 'admin_route_removed', prefix }, `Removed route: ${prefix}`);

      res.json({
        success: true,
        prefix,
        message: `Route '${prefix}' removed`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ event: 'admin_api_error', error: errorMessage }, 'Failed to remove route');
      res.status(500).json({ error: 'Internal server error', message: errorMessage });
    }
  });

  return router;
}

/**
 * Admin API Server Configuration
 */
export interface AdminServerConfig {
  /** Port to listen on (default: 8081) */
  port?: number;

  /** Host to bind to (default: '0.0.0.0' for Docker, '127.0.0.1' for local) */
  host?: string;

  /** Optional API key for authentication */
  apiKey?: string;

  /** Enable/disable admin API (default: false) */
  enabled?: boolean;
}
