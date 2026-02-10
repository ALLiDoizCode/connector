/**
 * Agent Runtime
 *
 * Main orchestrator class that brings together all components:
 * - Packet handling (stateless SHA-256 fulfillment)
 * - Business logic client
 * - HTTP server
 */

import pino, { Logger } from 'pino';
import { PacketHandler } from './packet/packet-handler';
import { BusinessClient } from './business/business-client';
import { HttpServer } from './http/http-server';
import {
  AgentRuntimeConfig,
  ResolvedAgentRuntimeConfig,
  DEFAULT_CONFIG,
  IPacketSender,
} from './types';
import { OutboundBTPClient } from './btp/outbound-btp-client';

/**
 * Main Agent Runtime class.
 *
 * ILP middleware that forwards packets between the connector and a user-defined
 * business logic service. Uses stateless SHA-256 fulfillment.
 *
 * @example
 * ```typescript
 * const runtime = new AgentRuntime({
 *   port: 3100,
 *   baseAddress: 'g.connector.agent',
 *   businessLogicUrl: 'http://localhost:8080',
 * });
 *
 * await runtime.start();
 * ```
 */
export class AgentRuntime {
  private readonly config: ResolvedAgentRuntimeConfig;
  private readonly logger: Logger;
  private readonly businessClient: BusinessClient;
  private readonly packetHandler: PacketHandler;
  private readonly httpServer: HttpServer;
  private readonly sender: IPacketSender | null;
  private started = false;

  constructor(config: AgentRuntimeConfig, sender?: IPacketSender | null) {
    // Resolve config with defaults
    this.config = this.resolveConfig(config);

    // Create logger
    this.logger = pino({
      name: this.config.nodeId,
      level: this.config.logLevel,
    });

    this.logger.info({ config: this.sanitizeConfig(this.config) }, 'Initializing Agent Runtime');

    // Create components
    this.businessClient = new BusinessClient(
      {
        businessLogicUrl: this.config.businessLogicUrl,
        timeout: this.config.businessLogicTimeout,
      },
      this.logger
    );

    this.packetHandler = new PacketHandler(
      {
        baseAddress: this.config.baseAddress,
      },
      this.businessClient,
      this.logger
    );

    this.sender = sender ?? null;

    this.httpServer = new HttpServer(
      {
        port: this.config.port,
        nodeId: this.config.nodeId,
      },
      this.packetHandler,
      this.logger,
      this.sender
    );
  }

  /**
   * Start the agent runtime.
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('Agent runtime already started');
      return;
    }

    this.logger.info('Starting Agent Runtime');

    await this.httpServer.start();
    this.started = true;

    // Connect BTP client after HTTP server is up (non-fatal on failure — reconnection will retry)
    if (this.sender && this.sender instanceof OutboundBTPClient) {
      try {
        await this.sender.connect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn({ error: msg }, 'BTP client initial connect failed — will retry');
      }
    }

    this.logger.info(
      {
        port: this.config.port,
        baseAddress: this.config.baseAddress,
      },
      'Agent Runtime started'
    );
  }

  /**
   * Stop the agent runtime.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.logger.info('Stopping Agent Runtime');

    // Disconnect BTP client before stopping HTTP server
    if (this.sender && this.sender instanceof OutboundBTPClient) {
      try {
        await this.sender.disconnect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error({ error: msg }, 'Error disconnecting BTP client');
      }
    }

    await this.httpServer.stop();
    this.started = false;

    this.logger.info('Agent Runtime stopped');
  }

  /**
   * Get the business client (for advanced use cases).
   */
  getBusinessClient(): BusinessClient {
    return this.businessClient;
  }

  /**
   * Get whether the runtime is started.
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Get the resolved configuration.
   */
  getConfig(): ResolvedAgentRuntimeConfig {
    return this.config;
  }

  /**
   * Resolve configuration with defaults.
   */
  private resolveConfig(config: AgentRuntimeConfig): ResolvedAgentRuntimeConfig {
    return {
      port: config.port ?? DEFAULT_CONFIG.port!,
      baseAddress: config.baseAddress,
      businessLogicUrl: config.businessLogicUrl,
      businessLogicTimeout: config.businessLogicTimeout ?? DEFAULT_CONFIG.businessLogicTimeout!,
      connectorBtpUrl: config.connectorBtpUrl ?? '',
      logLevel: config.logLevel ?? DEFAULT_CONFIG.logLevel!,
      nodeId: config.nodeId ?? DEFAULT_CONFIG.nodeId!,
    };
  }

  /**
   * Sanitize config for logging (remove sensitive values).
   */
  private sanitizeConfig(config: ResolvedAgentRuntimeConfig): Record<string, unknown> {
    return {
      port: config.port,
      baseAddress: config.baseAddress,
      businessLogicUrl: config.businessLogicUrl,
      businessLogicTimeout: config.businessLogicTimeout,
      logLevel: config.logLevel,
      nodeId: config.nodeId,
    };
  }
}

/**
 * Create and start an agent runtime from environment variables.
 *
 * Environment variables:
 * - PORT: HTTP server port (default: 3100)
 * - BASE_ADDRESS: ILP address prefix (required)
 * - BUSINESS_LOGIC_URL: URL to business logic handler (required)
 * - BUSINESS_LOGIC_TIMEOUT: Request timeout in ms (default: 5000)
 * - LOG_LEVEL: Log level (default: info)
 * - NODE_ID: Node ID for logging (default: agent-runtime)
 * - CONNECTOR_BTP_URL: WebSocket URL of local connector BTP endpoint (optional)
 * - CONNECTOR_BTP_AUTH_TOKEN: Shared secret for BTP auth (required if CONNECTOR_BTP_URL is set)
 * - CONNECTOR_BTP_PEER_ID: Peer ID for BTP auth (default: agent-runtime)
 * - CONNECTOR_BTP_MAX_RETRIES: Max reconnection retries (default: 5)
 * - CONNECTOR_BTP_PACKET_TIMEOUT_MS: Per-packet send timeout in ms (default: 10000)
 */
export async function startFromEnv(): Promise<AgentRuntime> {
  const config: AgentRuntimeConfig = {
    port: parseInt(process.env['PORT'] ?? '3100', 10),
    baseAddress: process.env['BASE_ADDRESS'] ?? '',
    businessLogicUrl: process.env['BUSINESS_LOGIC_URL'] ?? '',
    businessLogicTimeout: process.env['BUSINESS_LOGIC_TIMEOUT']
      ? parseInt(process.env['BUSINESS_LOGIC_TIMEOUT'], 10)
      : undefined,
    logLevel: (process.env['LOG_LEVEL'] as AgentRuntimeConfig['logLevel']) ?? 'info',
    nodeId: process.env['NODE_ID'] ?? 'agent-runtime',
  };

  if (!config.baseAddress) {
    throw new Error('BASE_ADDRESS environment variable is required');
  }

  if (!config.businessLogicUrl) {
    throw new Error('BUSINESS_LOGIC_URL environment variable is required');
  }

  // Create OutboundBTPClient if CONNECTOR_BTP_URL is set
  let sender: IPacketSender | null = null;
  const btpUrl = process.env['CONNECTOR_BTP_URL'];
  if (btpUrl) {
    const btpAuthToken = process.env['CONNECTOR_BTP_AUTH_TOKEN'];
    if (!btpAuthToken) {
      throw new Error('CONNECTOR_BTP_AUTH_TOKEN is required when CONNECTOR_BTP_URL is set');
    }

    const btpLogger = pino({
      name: config.nodeId ?? 'agent-runtime',
      level: config.logLevel ?? 'info',
    });

    const maxRetries = parseInt(process.env['CONNECTOR_BTP_MAX_RETRIES'] ?? '', 10);
    const packetTimeoutMs = parseInt(process.env['CONNECTOR_BTP_PACKET_TIMEOUT_MS'] ?? '', 10);

    sender = new OutboundBTPClient(
      {
        url: btpUrl,
        authToken: btpAuthToken,
        peerId: process.env['CONNECTOR_BTP_PEER_ID'] ?? 'agent-runtime',
        ...(Number.isFinite(maxRetries) && maxRetries > 0 ? { maxRetries } : {}),
        ...(Number.isFinite(packetTimeoutMs) && packetTimeoutMs > 0 ? { packetTimeoutMs } : {}),
      },
      btpLogger
    );
  }

  const runtime = new AgentRuntime(config, sender);
  await runtime.start();

  // Handle shutdown signals
  const shutdown = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('\nShutting down...');
    await runtime.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return runtime;
}
