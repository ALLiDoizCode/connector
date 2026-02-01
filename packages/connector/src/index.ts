/**
 * ILP Connector Entry Point
 * Initializes connector node, handles lifecycle management and graceful shutdown
 * @packageDocumentation
 */

import { ConnectorNode } from './core/connector-node';
import { ConfigurationError, ConfigLoader } from './config/config-loader';
import { createLogger } from './utils/logger';
import { MessagingGateway } from './messaging/messaging-gateway';
import { GiftwrapRouter } from './messaging/giftwrap-router';
import { GiftwrapWebSocketServer } from './messaging/giftwrap-websocket-server';
import { BTPClient } from './btp/btp-client';
import type { Logger } from 'pino';

interface GatewayConfig {
  mode: string;
  firstHopUrl: string;
  btpAuthToken: string;
  wsPort?: number;
  httpPort?: number;
}

/**
 * Main entry point
 * Initializes connector or gateway and handles startup
 */
async function main(): Promise<void> {
  // Get configuration file path from environment variable
  const configFile = process.env.CONFIG_FILE || './config.yaml';
  const logLevel = process.env.LOG_LEVEL || 'info';

  // Create temporary logger for startup (without telemetry)
  const tempLogger = createLogger('connector-startup', logLevel);

  // Load configuration to check mode
  let config;
  try {
    config = ConfigLoader.loadConfig(configFile);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      tempLogger.error(
        {
          event: 'configuration_error',
          filePath: configFile,
          error: error.message,
        },
        'Configuration error'
      );
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const logger = tempLogger;

  // Check if running in gateway mode
  if (config.mode === 'gateway') {
    await startGatewayMode(config, logger);
  } else {
    await startConnectorMode(configFile, logger);
  }
}

/**
 * Start in standard connector mode
 */
async function startConnectorMode(configFile: string, logger: Logger): Promise<void> {
  // Create connector instance (configuration loaded inside constructor)
  let connectorNode: ConnectorNode;
  try {
    connectorNode = new ConnectorNode(configFile, logger);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logger.error(
        {
          event: 'configuration_error',
          filePath: configFile,
          error: error.message,
        },
        'Configuration error'
      );
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  /**
   * Graceful shutdown handler
   * Stops connector and exits process
   */
  async function shutdown(signal: string): Promise<void> {
    logger.info({ event: 'connector_shutdown_initiated', signal }, 'Shutdown signal received');
    try {
      await connectorNode.stop();
      logger.info({ event: 'connector_shutdown' }, 'Connector stopped');
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ event: 'connector_shutdown_failed', error: errorMessage }, 'Shutdown failed');
      process.exit(1);
    }
  }

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error(
      {
        event: 'uncaught_exception',
        error: error.message,
        stack: error.stack,
      },
      'Uncaught exception'
    );
    void shutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    logger.error(
      {
        event: 'unhandled_rejection',
        reason: errorMessage,
      },
      'Unhandled promise rejection'
    );
    void shutdown('unhandledRejection');
  });

  // Start connector
  try {
    await connectorNode.start();
    logger.info(
      {
        event: 'connector_started',
      },
      'Connector started successfully'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        event: 'connector_start_failed',
        error: errorMessage,
      },
      'Failed to start connector'
    );
    process.exit(1);
  }
}

/**
 * Start in messaging gateway mode
 */
async function startGatewayMode(config: GatewayConfig, logger: Logger): Promise<void> {
  // Validate gateway-specific config
  if (!config.firstHopUrl) {
    logger.error('Gateway mode requires firstHopUrl configuration');
    process.exit(1);
  }
  if (!config.btpAuthToken) {
    logger.error('Gateway mode requires btpAuthToken configuration');
    process.exit(1);
  }

  // Create BTP client connection to first-hop connector
  const peer = {
    id: 'first-hop',
    url: config.firstHopUrl,
    authToken: config.btpAuthToken,
    connected: false,
    lastSeen: new Date(),
  };
  const btpClient = new BTPClient(peer, config.nodeId || 'gateway', logger);

  // Create giftwrap router
  const giftwrapRouter = new GiftwrapRouter(btpClient, logger);

  // Create WebSocket server
  const wsServer = new GiftwrapWebSocketServer({ wsPort: 3003 }, logger);

  // Create HTTP gateway
  const gateway = new MessagingGateway(
    { httpPort: 3002, wsPort: 3003, btpConnectionUrl: config.firstHopUrl },
    giftwrapRouter,
    logger
  );

  /**
   * Graceful shutdown handler for gateway mode
   */
  async function shutdown(signal: string): Promise<void> {
    logger.info({ event: 'gateway_shutdown_initiated', signal }, 'Shutdown signal received');
    try {
      await gateway.stop();
      await wsServer.stop();
      await btpClient.disconnect();
      logger.info({ event: 'gateway_shutdown' }, 'Gateway stopped');
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ event: 'gateway_shutdown_failed', error: errorMessage }, 'Shutdown failed');
      process.exit(1);
    }
  }

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error(
      {
        event: 'uncaught_exception',
        error: error.message,
        stack: error.stack,
      },
      'Uncaught exception'
    );
    void shutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    logger.error(
      {
        event: 'unhandled_rejection',
        reason: errorMessage,
      },
      'Unhandled promise rejection'
    );
    void shutdown('unhandledRejection');
  });

  // Start gateway components
  try {
    // Connect to first-hop connector
    await btpClient.connect();
    logger.info({ firstHopUrl: config.firstHopUrl }, 'Connected to first-hop connector');

    // Start WebSocket server
    await wsServer.start();

    // Start HTTP gateway
    await gateway.start();

    logger.info(
      {
        event: 'gateway_started',
        httpPort: 3002,
        wsPort: 3003,
      },
      'Messaging gateway started successfully'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        event: 'gateway_start_failed',
        error: errorMessage,
      },
      'Failed to start gateway'
    );
    process.exit(1);
  }
}

// Execute main function if this is the entry point
if (require.main === module) {
  void main();
}

// Export for testing
export { main };

// Re-export core types and classes for library usage
export { ConnectorNode } from './core/connector-node';
export { ConnectorConfig } from './config/types';
export { ConfigLoader, ConfigurationError } from './config/config-loader';
export { RoutingTable } from './routing/routing-table';
export { PacketHandler } from './core/packet-handler';
export { BTPServer } from './btp/btp-server';
export { BTPClient } from './btp/btp-client';
export { createLogger } from './utils/logger';
