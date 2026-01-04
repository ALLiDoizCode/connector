/**
 * Environment Validation Module
 *
 * Provides functionality to validate connector configuration based on
 * deployment environment (development/staging/production). Enforces
 * production safety rules to prevent accidental mainnet deployments
 * with development credentials or localhost RPC endpoints.
 *
 * @packageDocumentation
 */

import { ConnectorConfig } from './types';
import { ConfigurationError } from './config-loader';
import { createLogger } from '../utils/logger';

// Create logger for validation warnings
const logger = createLogger('environment-validator');

/**
 * Known Development Private Keys
 *
 * List of private keys that are publicly known from development tools.
 * These keys MUST NOT be used in production environments as they are
 * included in documentation and GitHub repositories.
 *
 * Sources:
 * - Anvil (Foundry): Default pre-funded accounts with deterministic private keys
 */
const KNOWN_DEV_PRIVATE_KEYS = [
  // Anvil Account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  // Anvil Account #1 (0x70997970C51812dc3A010C7d01b50e0d17dc79C8)
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  // Anvil Account #2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC)
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
];

/**
 * Validate Environment Configuration
 *
 * Main validation function that enforces environment-specific rules.
 * - Production: Strict validation (errors on misconfiguration)
 * - Development: Warning logs only (allows flexible configuration)
 * - Staging: Moderate validation (warnings for common issues)
 *
 * Production validation rules:
 * - Rejects known development private keys
 * - Rejects localhost RPC URLs
 * - Requires mainnet chain IDs and networks
 * - Requires HTTPS for RPC endpoints
 *
 * Development warnings:
 * - Logs development mode banner
 * - Logs active blockchain endpoints for visibility
 *
 * @param config - Connector configuration to validate
 * @throws ConfigurationError if production validation fails
 *
 * @example
 * ```typescript
 * const config = ConfigLoader.loadConfig('./config.yaml');
 * validateEnvironment(config);  // Throws if production misconfigured
 * // Safe to proceed with validated config
 * ```
 */
export function validateEnvironment(config: ConnectorConfig): void {
  if (config.environment === 'production') {
    validateProductionEnvironment(config);
  } else if (config.environment === 'development') {
    logDevelopmentWarnings(config);
  }
  // Staging uses development-like warnings (no strict validation)
  else if (config.environment === 'staging') {
    logStagingWarnings(config);
  }
}

/**
 * Validate Production Environment Configuration
 *
 * Enforces strict validation rules for production deployments.
 * All validations are HARD ERRORS (throw ConfigurationError).
 *
 * Base blockchain validations:
 * - Chain ID must be Base mainnet (8453)
 * - RPC URL must not contain localhost or 127.0.0.1
 * - RPC URL must use HTTPS (not HTTP)
 * - Private key must not be a known development key
 *
 * XRPL blockchain validations:
 * - Network must be 'mainnet'
 * - RPC URL must not contain localhost or 127.0.0.1
 * - RPC URL must use HTTPS (not HTTP)
 *
 * @param config - Connector configuration
 * @throws ConfigurationError if any production validation rule fails
 * @private
 */
function validateProductionEnvironment(config: ConnectorConfig): void {
  // Validate Base blockchain if enabled
  if (config.blockchain?.base?.enabled) {
    const base = config.blockchain.base;

    // Chain ID must be Base mainnet (8453)
    if (base.chainId !== 8453) {
      throw new ConfigurationError(
        `Production must use Base mainnet (chainId 8453), got chainId ${base.chainId}`
      );
    }

    // RPC URL must not contain localhost
    if (base.rpcUrl.includes('localhost') || base.rpcUrl.includes('127.0.0.1')) {
      throw new ConfigurationError(
        'Cannot use localhost RPC in production. Use public mainnet endpoint.'
      );
    }

    // RPC URL must use HTTPS
    if (!base.rpcUrl.startsWith('https://') && !base.rpcUrl.startsWith('wss://')) {
      throw new ConfigurationError('Production RPC URL must use HTTPS for security');
    }

    // Private key must not be a known development key
    if (base.privateKey && KNOWN_DEV_PRIVATE_KEYS.includes(base.privateKey)) {
      throw new ConfigurationError(
        'Cannot use development private key in production. Use secure key from KMS/HSM.'
      );
    }
  }

  // Validate XRPL blockchain if enabled
  if (config.blockchain?.xrpl?.enabled) {
    const xrpl = config.blockchain.xrpl;

    // Network must be mainnet
    if (xrpl.network !== 'mainnet') {
      throw new ConfigurationError(
        `Production must use XRPL mainnet, got network '${xrpl.network}'`
      );
    }

    // RPC URL must not contain localhost
    if (xrpl.rpcUrl.includes('localhost') || xrpl.rpcUrl.includes('127.0.0.1')) {
      throw new ConfigurationError(
        'Cannot use localhost rippled in production. Use public mainnet endpoint.'
      );
    }

    // RPC URL must use HTTPS (if using HTTP transport, not WebSocket)
    if (
      xrpl.rpcUrl.startsWith('http://') ||
      xrpl.rpcUrl.startsWith('ws://') ||
      xrpl.rpcUrl.includes('localhost')
    ) {
      throw new ConfigurationError('Production XRPL RPC URL must use HTTPS for security');
    }
  }
}

/**
 * Log Development Environment Warnings
 *
 * Emits warning logs to clearly indicate development mode.
 * Logs active blockchain endpoints for visibility during local development.
 *
 * All logs are WARNINGS (not errors), allowing startup to proceed.
 *
 * @param config - Connector configuration
 * @private
 */
function logDevelopmentWarnings(config: ConnectorConfig): void {
  logger.warn('⚠️  DEVELOPMENT MODE - Using local blockchain nodes');
  logger.warn('⚠️  This is NOT production configuration');

  // Log Base blockchain config if enabled
  if (config.blockchain?.base?.enabled) {
    logger.warn(`⚠️  Base RPC: ${config.blockchain.base.rpcUrl}`);
    logger.warn(`⚠️  Base Chain ID: ${config.blockchain.base.chainId}`);
  }

  // Log XRPL blockchain config if enabled
  if (config.blockchain?.xrpl?.enabled) {
    logger.warn(`⚠️  XRPL RPC: ${config.blockchain.xrpl.rpcUrl}`);
    logger.warn(`⚠️  XRPL Network: ${config.blockchain.xrpl.network}`);
  }
}

/**
 * Log Staging Environment Warnings
 *
 * Emits warning logs to indicate staging/testnet mode.
 * Similar to development warnings but for public testnets.
 *
 * @param config - Connector configuration
 * @private
 */
function logStagingWarnings(config: ConnectorConfig): void {
  logger.warn('⚠️  STAGING MODE - Using public testnets');
  logger.warn('⚠️  This is NOT production configuration');

  // Log Base blockchain config if enabled
  if (config.blockchain?.base?.enabled) {
    logger.warn(`⚠️  Base RPC: ${config.blockchain.base.rpcUrl}`);
    logger.warn(`⚠️  Base Chain ID: ${config.blockchain.base.chainId}`);
  }

  // Log XRPL blockchain config if enabled
  if (config.blockchain?.xrpl?.enabled) {
    logger.warn(`⚠️  XRPL RPC: ${config.blockchain.xrpl.rpcUrl}`);
    logger.warn(`⚠️  XRPL Network: ${config.blockchain.xrpl.network}`);
  }
}

/**
 * Validate Chain ID Against RPC Endpoint (Runtime Validation)
 *
 * Queries the RPC endpoint to get actual chain ID and compares it
 * with the configured chain ID. Logs a warning if mismatch detected.
 *
 * This validation is performed asynchronously and does NOT block
 * connector startup (logs warning only, no error thrown).
 *
 * @param config - Connector configuration
 * @returns Promise that resolves when validation complete
 *
 * @example
 * ```typescript
 * // Start validation asynchronously (don't await)
 * validateChainId(config).catch(err => {
 *   logger.warn(`Chain ID validation failed: ${err.message}`);
 * });
 * ```
 */
export async function validateChainId(config: ConnectorConfig): Promise<void> {
  // Only validate Base chain ID if enabled
  if (!config.blockchain?.base?.enabled) {
    return;
  }

  const base = config.blockchain.base;

  try {
    // Query RPC endpoint for actual chain ID
    const response = await fetch(base.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      logger.warn(`Chain ID validation failed: RPC endpoint returned HTTP ${response.status}`);
      return;
    }

    const data = (await response.json()) as { result?: string; error?: { message: string } };

    if (data.error) {
      logger.warn(`Chain ID validation failed: ${data.error.message}`);
      return;
    }

    if (!data.result) {
      logger.warn('Chain ID validation failed: No result from RPC endpoint');
      return;
    }

    // Parse hex chain ID from RPC response
    const actualChainId = parseInt(data.result, 16);

    // Compare with configured chain ID
    if (actualChainId !== base.chainId) {
      logger.warn(
        `⚠️  Chain ID mismatch: config expects ${base.chainId}, RPC returned ${actualChainId}`
      );
      logger.warn('⚠️  Verify BASE_RPC_URL points to correct network');
    }
  } catch (error) {
    // Don't fail startup on validation error, just log warning
    logger.warn(`Chain ID validation failed: ${(error as Error).message}`);
  }
}
