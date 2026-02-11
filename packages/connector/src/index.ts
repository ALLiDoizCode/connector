/**
 * ILP Connector Entry Point
 * Initializes connector node, handles lifecycle management and graceful shutdown
 * @packageDocumentation
 */

import { ConnectorNode } from './core/connector-node';
import { ConfigLoader, ConfigurationError, ConnectorNotStartedError } from './config/config-loader';
import { createLogger } from './utils/logger';
import { RoutingTable } from './routing/routing-table';
import { PacketHandler } from './core/packet-handler';
import { BTPServer } from './btp/btp-server';
import { BTPClient } from './btp/btp-client';
import { LocalDeliveryClient } from './core/local-delivery-client';
import type { Logger } from 'pino';

// Export public API
export {
  ConnectorNode,
  ConfigLoader,
  ConfigurationError,
  ConnectorNotStartedError,
  RoutingTable,
  PacketHandler,
  BTPServer,
  BTPClient,
  LocalDeliveryClient,
  createLogger,
};

// Export configuration types
export type {
  ConnectorConfig,
  LocalDeliveryConfig,
  LocalDeliveryHandler,
  LocalDeliveryRequest,
  LocalDeliveryResponse,
  SendPacketParams,
  PeerRegistrationRequest,
  PeerInfo,
  PeerAccountBalance,
  RouteInfo,
  RemovePeerResult,
} from './config/types';

// Re-export settlement types for library consumers
export type { AdminSettlementConfig } from './settlement/types';

// Re-export ILP packet types for library consumers
export type { ILPFulfillPacket, ILPRejectPacket } from '@agent-runtime/shared';

// Export main function for testing
export { main };

/**
 * Main entry point
 * Initializes connector and handles startup
 */
async function main(): Promise<void> {
  // Get configuration file path from environment variable
  const configFile = process.env.CONFIG_FILE || './config.yaml';
  const logLevel = process.env.LOG_LEVEL || 'info';

  // Create temporary logger for startup (without telemetry)
  const logger = createLogger('connector-startup', logLevel);

  await startConnectorMode(configFile, logger);
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

// Run main entry point only when executed directly (not imported)
// Check if this file is the entry point (running as main script)
const isMainModule = require.main === module || process.argv[1]?.includes('connector');
if (isMainModule) {
  void main();
}
