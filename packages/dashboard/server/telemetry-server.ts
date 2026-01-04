/**
 * WebSocket Telemetry Server
 * Receives telemetry from connector nodes and broadcasts to dashboard clients
 * @packageDocumentation
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Logger } from 'pino';
import { TelemetryMessage, isTelemetryMessage } from './types.js';
import {
  AccountBalanceEvent,
  SettlementTriggeredEvent,
  SettlementCompletedEvent,
  SettlementState,
} from '@m2m/shared';

interface WebSocketWithMetadata extends WebSocket {
  nodeId?: string;
  isClient?: boolean;
}

/**
 * Balance State Storage (Story 6.8)
 * Stores current account balances for dashboard visualization
 */
export interface BalanceState {
  peerId: string;
  tokenId: string;
  debitBalance: string;
  creditBalance: string;
  netBalance: string;
  creditLimit?: string;
  settlementThreshold?: string;
  settlementState: SettlementState;
  lastUpdated: string;
}

export class TelemetryServer {
  private wss: WebSocketServer | null = null;
  private connectorConnections: Map<string, WebSocketWithMetadata> = new Map();
  private clientConnections: Set<WebSocketWithMetadata> = new Set();
  private pendingConnections: Set<WebSocketWithMetadata> = new Set();
  private lastNodeStatus: Map<string, TelemetryMessage> = new Map(); // Cache latest NODE_STATUS per connector

  // Settlement telemetry storage (Story 6.8)
  private accountBalances: Map<string, BalanceState> = new Map(); // Key: nodeId:peerId:tokenId
  private settlementEvents: (SettlementTriggeredEvent | SettlementCompletedEvent)[] = [];
  private readonly MAX_SETTLEMENT_EVENTS = 100; // Limit to last 100 events

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

      // Cache NODE_STATUS messages for replay to new clients
      if (message.type === 'NODE_STATUS' && message.nodeId) {
        this.lastNodeStatus.set(message.nodeId, message);
      }

      // Handle settlement telemetry events (Story 6.8)
      this.handleSettlementTelemetry(message);

      // Broadcast to all clients
      this.broadcast(message);
    }
  }

  /**
   * Check if message type is a telemetry event
   */
  private isTelemetryEvent(type: string): boolean {
    return [
      'NODE_STATUS',
      'PACKET_SENT',
      'PACKET_RECEIVED',
      'ROUTE_LOOKUP',
      'LOG',
      'ACCOUNT_BALANCE',
      'SETTLEMENT_TRIGGERED',
      'SETTLEMENT_COMPLETED',
    ].includes(type);
  }

  /**
   * Handle settlement telemetry events (Story 6.8)
   * Stores balance state and settlement events in memory for dashboard visualization
   */
  private handleSettlementTelemetry(message: any): void {
    try {
      if (message.type === 'ACCOUNT_BALANCE') {
        const event = message as AccountBalanceEvent;
        const key = `${event.nodeId}:${event.peerId}:${event.tokenId}`;

        const balanceState: BalanceState = {
          peerId: event.peerId,
          tokenId: event.tokenId,
          debitBalance: event.debitBalance,
          creditBalance: event.creditBalance,
          netBalance: event.netBalance,
          creditLimit: event.creditLimit,
          settlementThreshold: event.settlementThreshold,
          settlementState: event.settlementState,
          lastUpdated: event.timestamp,
        };

        this.accountBalances.set(key, balanceState);
        this.logger.debug('Account balance updated', {
          nodeId: event.nodeId,
          peerId: event.peerId,
          tokenId: event.tokenId,
          creditBalance: event.creditBalance,
        });
      } else if (message.type === 'SETTLEMENT_TRIGGERED') {
        const event = message as SettlementTriggeredEvent;
        this.settlementEvents.push(event);

        // Limit array to last 100 events
        if (this.settlementEvents.length > this.MAX_SETTLEMENT_EVENTS) {
          this.settlementEvents.shift();
        }

        this.logger.info('Settlement triggered event stored', {
          nodeId: event.nodeId,
          peerId: event.peerId,
          tokenId: event.tokenId,
          threshold: event.threshold,
        });
      } else if (message.type === 'SETTLEMENT_COMPLETED') {
        const event = message as SettlementCompletedEvent;
        this.settlementEvents.push(event);

        // Limit array to last 100 events
        if (this.settlementEvents.length > this.MAX_SETTLEMENT_EVENTS) {
          this.settlementEvents.shift();
        }

        this.logger.info('Settlement completed event stored', {
          nodeId: event.nodeId,
          peerId: event.peerId,
          tokenId: event.tokenId,
          success: event.success,
          settledAmount: event.settledAmount,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to process settlement telemetry', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageType: message.type,
      });
    }
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
    this.logger.info('Dashboard client connected', {
      cachedNodeStatusCount: this.lastNodeStatus.size,
    });

    // Replay all cached NODE_STATUS messages to the new client
    this.lastNodeStatus.forEach((nodeStatus, nodeId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(nodeStatus));
        this.logger.info('Replayed cached NODE_STATUS to client', { nodeId });
      }
    });
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

  /**
   * Get all current account balances (Story 6.8)
   * Used by REST API endpoint for initial dashboard state load
   * @returns Array of all balance states
   */
  getAccountBalances(): BalanceState[] {
    return Array.from(this.accountBalances.values());
  }

  /**
   * Get recent settlement events (Story 6.8)
   * Returns last 100 settlement events (both triggered and completed)
   * Used by REST API endpoint for initial dashboard state load
   * @returns Array of settlement events, sorted by timestamp descending (newest first)
   */
  getSettlementEvents(): (SettlementTriggeredEvent | SettlementCompletedEvent)[] {
    // Return copy sorted by timestamp descending (newest first)
    return [...this.settlementEvents].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });
  }
}
