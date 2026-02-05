/**
 * Agent Runtime
 *
 * Main orchestrator class that brings together all components:
 * - Session management
 * - SPSP server
 * - Packet handling
 * - Business logic client
 * - HTTP server
 */

import pino, { Logger } from 'pino';
import { SessionManager } from './session/session-manager';
import { SPSPServer } from './spsp/spsp-server';
import { PacketHandler } from './packet/packet-handler';
import { BusinessClient } from './business/business-client';
import { HttpServer } from './http/http-server';
import { AgentRuntimeConfig, ResolvedAgentRuntimeConfig, DEFAULT_CONFIG } from './types';

/**
 * Main Agent Runtime class.
 *
 * Handles ILP/SPSP/STREAM protocol complexity, allowing users to build
 * custom business logic agents without understanding the underlying protocols.
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
  private readonly sessionManager: SessionManager;
  private readonly businessClient: BusinessClient;
  private readonly spspServer: SPSPServer;
  private readonly packetHandler: PacketHandler;
  private readonly httpServer: HttpServer;
  private started = false;

  constructor(config: AgentRuntimeConfig) {
    // Resolve config with defaults
    this.config = this.resolveConfig(config);

    // Create logger
    this.logger = pino({
      name: this.config.nodeId,
      level: this.config.logLevel,
    });

    this.logger.info({ config: this.sanitizeConfig(this.config) }, 'Initializing Agent Runtime');

    // Create components
    this.sessionManager = new SessionManager(
      {
        baseAddress: this.config.baseAddress,
        sessionTtlMs: this.config.sessionTtlMs,
      },
      this.logger
    );

    this.businessClient = new BusinessClient(
      {
        businessLogicUrl: this.config.businessLogicUrl,
        timeout: this.config.businessLogicTimeout,
      },
      this.logger
    );

    this.spspServer = new SPSPServer(
      {
        enabled: this.config.spspEnabled,
      },
      this.sessionManager,
      this.businessClient,
      this.logger
    );

    this.packetHandler = new PacketHandler(
      {
        baseAddress: this.config.baseAddress,
      },
      this.sessionManager,
      this.businessClient,
      this.logger
    );

    this.httpServer = new HttpServer(
      {
        port: this.config.port,
        nodeId: this.config.nodeId,
      },
      this.spspServer,
      this.packetHandler,
      this.sessionManager,
      this.logger
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

    this.logger.info(
      {
        port: this.config.port,
        baseAddress: this.config.baseAddress,
        spspEnabled: this.config.spspEnabled,
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

    await this.httpServer.stop();
    this.sessionManager.shutdown();
    this.started = false;

    this.logger.info('Agent Runtime stopped');
  }

  /**
   * Get the session manager (for advanced use cases).
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
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
      spspEnabled: config.spspEnabled ?? DEFAULT_CONFIG.spspEnabled!,
      sessionTtlMs: config.sessionTtlMs ?? DEFAULT_CONFIG.sessionTtlMs!,
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
      spspEnabled: config.spspEnabled,
      sessionTtlMs: config.sessionTtlMs,
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
 * - SPSP_ENABLED: Enable SPSP endpoint (default: true)
 * - SESSION_TTL_MS: Session TTL in ms (default: 3600000)
 * - LOG_LEVEL: Log level (default: info)
 * - NODE_ID: Node ID for logging (default: agent-runtime)
 */
export async function startFromEnv(): Promise<AgentRuntime> {
  const config: AgentRuntimeConfig = {
    port: parseInt(process.env['PORT'] ?? '3100', 10),
    baseAddress: process.env['BASE_ADDRESS'] ?? '',
    businessLogicUrl: process.env['BUSINESS_LOGIC_URL'] ?? '',
    businessLogicTimeout: process.env['BUSINESS_LOGIC_TIMEOUT']
      ? parseInt(process.env['BUSINESS_LOGIC_TIMEOUT'], 10)
      : undefined,
    spspEnabled: process.env['SPSP_ENABLED'] !== 'false',
    sessionTtlMs: process.env['SESSION_TTL_MS']
      ? parseInt(process.env['SESSION_TTL_MS'], 10)
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

  const runtime = new AgentRuntime(config);
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
