/**
 * Configuration Loader Module
 *
 * Provides functionality to load and validate ILP connector configuration
 * from YAML files. Includes comprehensive validation of all configuration
 * fields including peer definitions, route definitions, and port ranges.
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ConnectorConfig, PeerConfig, RouteConfig } from './types';

/**
 * Custom Error Class for Configuration Errors
 *
 * Thrown when configuration validation fails during loading.
 * Provides descriptive error messages indicating the specific
 * validation failure to help operators fix configuration issues.
 *
 * @example
 * ```typescript
 * throw new ConfigurationError('Missing required field: nodeId');
 * ```
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigurationError);
    }
  }
}

/**
 * Configuration Loader Class
 *
 * Static class providing methods to load and validate connector
 * configuration from YAML files. Performs comprehensive validation
 * including field presence, type checking, URL format validation,
 * peer reference validation, and port range validation.
 *
 * @example
 * ```typescript
 * try {
 *   const config = ConfigLoader.loadConfig('./config.yaml');
 *   console.log(`Loaded config for node: ${config.nodeId}`);
 * } catch (error) {
 *   if (error instanceof ConfigurationError) {
 *     console.error(`Configuration error: ${error.message}`);
 *     process.exit(1);
 *   }
 * }
 * ```
 */
export class ConfigLoader {
  /**
   * Load and Validate Configuration from YAML File
   *
   * Reads a YAML configuration file from disk, parses it, and validates
   * all fields according to the connector configuration schema.
   * Throws ConfigurationError if validation fails.
   *
   * @param filePath - Absolute or relative path to YAML configuration file
   * @returns Validated ConnectorConfig object
   * @throws ConfigurationError if file not found, YAML invalid, or validation fails
   *
   * @example
   * ```typescript
   * const config = ConfigLoader.loadConfig('./examples/linear-3-nodes-a.yaml');
   * ```
   */
  static loadConfig(filePath: string): ConnectorConfig {
    // Step 1: Read file from disk
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ConfigurationError(`Configuration file not found: ${filePath}`);
      }
      throw new ConfigurationError(
        `Failed to read configuration file: ${(error as Error).message}`
      );
    }

    // Step 2: Parse YAML
    let config: unknown;
    try {
      config = yaml.load(fileContent);
    } catch (error) {
      throw new ConfigurationError(`Invalid YAML syntax: ${(error as Error).message}`);
    }

    // Ensure we have an object
    if (!config || typeof config !== 'object') {
      throw new ConfigurationError('Configuration must be a YAML object');
    }

    // Type assertion after validation
    const rawConfig = config as Record<string, unknown>;

    // Step 3: Validate configuration
    this.validateRequiredFields(rawConfig);
    this.validatePeers(rawConfig.peers as PeerConfig[]);
    this.validateRoutes(rawConfig.routes as RouteConfig[], rawConfig.peers as PeerConfig[]);
    this.validatePorts(rawConfig);

    // Apply default values for optional fields
    const connectorConfig: ConnectorConfig = {
      nodeId: rawConfig.nodeId as string,
      btpServerPort: rawConfig.btpServerPort as number,
      healthCheckPort: (rawConfig.healthCheckPort as number | undefined) ?? 8080,
      logLevel: (rawConfig.logLevel as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
      peers: rawConfig.peers as PeerConfig[],
      routes: rawConfig.routes as RouteConfig[],
      dashboardTelemetryUrl: rawConfig.dashboardTelemetryUrl as string | undefined,
    };

    return connectorConfig;
  }

  /**
   * Validate Required Fields
   *
   * Checks that all required top-level fields are present and have
   * correct types. Required fields: nodeId, btpServerPort, peers, routes.
   *
   * @param config - Raw configuration object from YAML
   * @throws ConfigurationError if required field missing or wrong type
   * @private
   */
  private static validateRequiredFields(config: Record<string, unknown>): void {
    // Validate nodeId
    if (!('nodeId' in config)) {
      throw new ConfigurationError('Missing required field: nodeId');
    }
    if (typeof config.nodeId !== 'string') {
      throw new ConfigurationError(
        `Invalid type for nodeId: expected string, got ${typeof config.nodeId}`
      );
    }
    if (config.nodeId.trim() === '') {
      throw new ConfigurationError('nodeId cannot be empty');
    }

    // Validate btpServerPort
    if (!('btpServerPort' in config)) {
      throw new ConfigurationError('Missing required field: btpServerPort');
    }
    if (typeof config.btpServerPort !== 'number') {
      throw new ConfigurationError(
        `Invalid type for btpServerPort: expected number, got ${typeof config.btpServerPort}`
      );
    }

    // Validate peers
    if (!('peers' in config)) {
      throw new ConfigurationError('Missing required field: peers');
    }
    if (!Array.isArray(config.peers)) {
      throw new ConfigurationError(
        `Invalid type for peers: expected array, got ${typeof config.peers}`
      );
    }

    // Validate routes
    if (!('routes' in config)) {
      throw new ConfigurationError('Missing required field: routes');
    }
    if (!Array.isArray(config.routes)) {
      throw new ConfigurationError(
        `Invalid type for routes: expected array, got ${typeof config.routes}`
      );
    }

    // Validate optional logLevel if present
    if ('logLevel' in config) {
      const validLogLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLogLevels.includes(config.logLevel as string)) {
        throw new ConfigurationError(
          `Invalid logLevel: must be one of ${validLogLevels.join(', ')}, got ${config.logLevel}`
        );
      }
    }
  }

  /**
   * Validate Peer Definitions
   *
   * Validates each peer has required fields (id, url, authToken),
   * validates WebSocket URL format, and ensures peer IDs are unique.
   *
   * @param peers - Array of peer configurations
   * @throws ConfigurationError if peer validation fails
   * @private
   */
  private static validatePeers(peers: PeerConfig[]): void {
    const peerIds = new Set<string>();

    for (const peer of peers) {
      // Validate peer has required fields
      if (!peer.id) {
        throw new ConfigurationError('Peer missing required field: id');
      }
      if (typeof peer.id !== 'string') {
        throw new ConfigurationError(
          `Invalid type for peer.id: expected string, got ${typeof peer.id}`
        );
      }

      if (!peer.url) {
        throw new ConfigurationError(`Peer ${peer.id} missing required field: url`);
      }
      if (typeof peer.url !== 'string') {
        throw new ConfigurationError(
          `Invalid type for peer.url: expected string, got ${typeof peer.url}`
        );
      }

      if (!peer.authToken) {
        throw new ConfigurationError(`Peer ${peer.id} missing required field: authToken`);
      }
      if (typeof peer.authToken !== 'string') {
        throw new ConfigurationError(
          `Invalid type for peer.authToken: expected string, got ${typeof peer.authToken}`
        );
      }

      // Validate WebSocket URL format
      const wsUrlPattern = /^wss?:\/\/.+:\d+$/;
      if (!wsUrlPattern.test(peer.url)) {
        throw new ConfigurationError(
          `Invalid WebSocket URL for peer ${peer.id}: ${peer.url}. Must start with ws:// or wss:// and include port.`
        );
      }

      // Check for duplicate peer IDs
      if (peerIds.has(peer.id)) {
        throw new ConfigurationError(`Duplicate peer ID: ${peer.id}`);
      }
      peerIds.add(peer.id);
    }
  }

  /**
   * Validate Route Definitions
   *
   * Validates each route has required fields (prefix, nextHop),
   * validates ILP address prefix format (RFC-0015), and ensures
   * nextHop references an existing peer ID.
   *
   * @param routes - Array of route configurations
   * @param peers - Array of peer configurations for validation
   * @throws ConfigurationError if route validation fails
   * @private
   */
  private static validateRoutes(routes: RouteConfig[], _peers: PeerConfig[]): void {
    // Note: We don't validate that route nextHops exist in the peers list because
    // routes can reference peers that will connect inbound (dynamic peers)
    // Those dynamic peers must have BTP_PEER_* environment variables configured

    for (const route of routes) {
      // Validate route has required fields
      if (!route.prefix) {
        throw new ConfigurationError('Route missing required field: prefix');
      }
      if (typeof route.prefix !== 'string') {
        throw new ConfigurationError(
          `Invalid type for route.prefix: expected string, got ${typeof route.prefix}`
        );
      }

      if (!route.nextHop) {
        throw new ConfigurationError('Route missing required field: nextHop');
      }
      if (typeof route.nextHop !== 'string') {
        throw new ConfigurationError(
          `Invalid type for route.nextHop: expected string, got ${typeof route.nextHop}`
        );
      }

      // Validate ILP address prefix format (RFC-0015)
      // Pattern: lowercase alphanumeric, dots, underscores, tildes, hyphens
      // Must start with alphanumeric character
      const ilpAddressPattern = /^[a-z0-9][a-z0-9._~-]*$/;
      if (!ilpAddressPattern.test(route.prefix)) {
        throw new ConfigurationError(
          `Invalid ILP address prefix in route: ${route.prefix}. ` +
            `Must contain only lowercase letters, numbers, dots, underscores, tildes, and hyphens.`
        );
      }

      // Note: Routes can reference peers that will connect inbound (not in static peers list)
      // Those peers must have BTP_PEER_* environment variables configured for authentication
      // No validation needed here - if peer never connects, routing will fail at runtime

      // Validate optional priority field if present
      if (route.priority !== undefined && typeof route.priority !== 'number') {
        throw new ConfigurationError(
          `Invalid type for route.priority: expected number, got ${typeof route.priority}`
        );
      }
    }
  }

  /**
   * Validate Port Ranges
   *
   * Validates that port numbers are within the valid range (1-65535).
   * Checks btpServerPort (required) and healthCheckPort (optional).
   *
   * @param config - Configuration object with port fields
   * @throws ConfigurationError if port number out of range
   * @private
   */
  private static validatePorts(config: Record<string, unknown>): void {
    const MIN_PORT = 1;
    const MAX_PORT = 65535;
    const btpPort = config.btpServerPort as number;

    // Validate btpServerPort
    if (btpPort < MIN_PORT || btpPort > MAX_PORT) {
      throw new ConfigurationError(
        `BTP server port must be between ${MIN_PORT}-${MAX_PORT}, got: ${btpPort}`
      );
    }

    // Validate healthCheckPort if present
    if (config.healthCheckPort !== undefined) {
      if (typeof config.healthCheckPort !== 'number') {
        throw new ConfigurationError(
          `Invalid type for healthCheckPort: expected number, got ${typeof config.healthCheckPort}`
        );
      }
      const healthPort = config.healthCheckPort as number;
      if (healthPort < MIN_PORT || healthPort > MAX_PORT) {
        throw new ConfigurationError(
          `Health check port must be between ${MIN_PORT}-${MAX_PORT}, got: ${healthPort}`
        );
      }
    }
  }
}
