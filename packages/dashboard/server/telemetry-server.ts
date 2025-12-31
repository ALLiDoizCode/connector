/**
 * WebSocket Telemetry Server
 * Receives telemetry from connector nodes and broadcasts to dashboard clients
 * @packageDocumentation
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Logger } from 'pino';
import { TelemetryMessage, isTelemetryMessage } from './types.js';

interface WebSocketWithMetadata extends WebSocket {
  nodeId?: string;
  isClient?: boolean;
}

export class TelemetryServer {
  private wss: WebSocketServer | null = null;
  private connectorConnections: Map<string, WebSocketWithMetadata> = new Map();
  private clientConnections: Set<WebSocketWithMetadata> = new Set();
  private pendingConnections: Set<WebSocketWithMetadata> = new Set();
  private port: number;
  private logger: Logger;

  constructor(port: number, logger: Logger) {
    this.port = port;
    this.logger = logger;
  }

  /**
   * Start the WebSocket telemetry server
   */
  start(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws: WebSocketWithMetadata) => {
      this.logger.info('WebSocket connection established');
      this.pendingConnections.add(ws);

      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data);
      });

      ws.on('close', () => {
        this.handleClose(ws);
      });

      ws.on('error', (error: Error) => {
        this.logger.error('WebSocket connection error', { error: error.message });
      });
    });

    this.logger.info(`Telemetry WebSocket server listening on port ${this.port}`);
  }

  /**
   * Stop the WebSocket server and close all connections
   */
  stop(): void {
    if (!this.wss) {
      return;
    }

    // Close all connections
    this.connectorConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    this.clientConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    this.pendingConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    // Close server
    this.wss.close();
    this.logger.info('Telemetry server stopped');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(ws: WebSocketWithMetadata, data: Buffer): void {
    let message: any;

    // Level 1: Parse JSON
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      this.logger.warn('Received malformed telemetry message - invalid JSON', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    // Level 2: Validate required fields
    if (!isTelemetryMessage(message)) {
      this.logger.warn('Telemetry message missing required fields', { message });
      return;
    }

    // Handle CLIENT_CONNECT message
    if (message.type === 'CLIENT_CONNECT') {
      this.registerClient(ws);
      return;
    }

    // Handle telemetry events from connectors
    if (this.isTelemetryEvent(message.type)) {
      // Register connector if not already registered
      if (!ws.nodeId && message.nodeId) {
        this.registerConnector(ws, message.nodeId);
      }

      // Broadcast to all clients
      this.broadcast(message);
    }
  }

  /**
   * Check if message type is a telemetry event
   */
  private isTelemetryEvent(type: string): boolean {
    return ['NODE_STATUS', 'PACKET_SENT', 'PACKET_RECEIVED', 'ROUTE_LOOKUP', 'LOG'].includes(type);
  }

  /**
   * Register a WebSocket as a connector
   */
  private registerConnector(ws: WebSocketWithMetadata, nodeId: string): void {
    this.pendingConnections.delete(ws);
    ws.nodeId = nodeId;
    ws.isClient = false;
    this.connectorConnections.set(nodeId, ws);
    this.logger.info('Connector registered', { nodeId });
  }

  /**
   * Register a WebSocket as a browser client
   */
  private registerClient(ws: WebSocketWithMetadata): void {
    this.pendingConnections.delete(ws);
    ws.isClient = true;
    this.clientConnections.add(ws);
    this.logger.info('Dashboard client connected');
  }

  /**
   * Handle WebSocket connection close
   */
  private handleClose(ws: WebSocketWithMetadata): void {
    // Remove from pending connections
    this.pendingConnections.delete(ws);

    // Check if it's a connector
    if (ws.nodeId) {
      this.connectorConnections.delete(ws.nodeId);
      this.logger.info('Connector disconnected', { nodeId: ws.nodeId });
      return;
    }

    // Check if it's a client
    if (ws.isClient) {
      this.clientConnections.delete(ws);
      this.logger.info('Dashboard client disconnected');
      return;
    }

    // Unidentified connection closed
    this.logger.debug('Unidentified WebSocket connection closed');
  }

  /**
   * Broadcast telemetry message to all connected clients
   */
  broadcast(message: TelemetryMessage): void {
    const jsonMessage = JSON.stringify(message);

    this.clientConnections.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(jsonMessage);
        } catch (error) {
          this.logger.debug('Failed to send message to client', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Remove disconnected client
          this.clientConnections.delete(client);
        }
      }
    });

    this.logger.debug('Broadcasting telemetry event', {
      type: message.type,
      nodeId: message.nodeId,
    });
  }
}
