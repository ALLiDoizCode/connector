/**
 * Configuration Module Exports
 *
 * Re-exports configuration loading utilities for ILP connector
 * and Agent Society Protocol configuration.
 *
 * @packageDocumentation
 */

// Connector Configuration (existing)
export { ConfigLoader, ConfigurationError } from './config-loader';

// Agent Configuration (Story 13.7)
export {
  AgentConfigLoader,
  AgentConfigurationError,
  // Type exports
  type AgentYamlConfig,
  type AgentIdentityConfig,
  type AgentDatabaseConfig,
  type AgentPricingConfig,
  type AgentFollowConfig,
  type AgentHandlersConfig,
  type AgentSubscriptionsConfig,
  type ParsedPricing,
} from './agent-config';
