/**
 * Configuration Module Exports
 *
 * Re-exports configuration loading utilities for ILP connector.
 *
 * @packageDocumentation
 */

// Connector Configuration
export { ConfigLoader, ConfigurationError } from './config-loader';

// Aptos Environment Validation (Story 28.5)
export { validateAptosEnvironment, type AptosEnvValidation } from './aptos-env-validator';
