/**
 * ILP Connector Entry Point
 * Initializes connector node, handles lifecycle management and graceful shutdown
 * @packageDocumentation
 */

import { ConnectorNode } from './core/connector-node';
import { ConfigurationError } from './config/config-loader';
import { createLogger } from './utils/logger';

/**
 * Main entry point
 * Initializes connector and handles startup
 */
async function main(): Promise<void> {
  // Get configuration file path from environment variable
  const configFile = process.env.CONFIG_FILE || './config.yaml';
  const logLevel = process.env.LOG_LEVEL || 'info';

  // Create temporary logger for startup (without telemetry)
  const tempLogger = createLogger('connector-startup', logLevel);

  // Create connector instance (configuration loaded inside constructor)
  let connectorNode: ConnectorNode;
  try {
    connectorNode = new ConnectorNode(configFile, tempLogger);
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

  // Get nodeId from loaded config for logging
  const logger = tempLogger;

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
