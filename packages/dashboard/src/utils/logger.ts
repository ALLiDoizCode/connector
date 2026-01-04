/**
 * Browser-compatible Pino logger for dashboard frontend
 * @packageDocumentation
 * @remarks
 * Provides structured logging in the browser using Pino.
 * Outputs to browser console with proper formatting.
 */

import pino from 'pino';

/**
 * Logger type interface - wraps Pino logger
 */
export type Logger = pino.Logger;

/**
 * Valid log levels for the logger
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Default log level when VITE_LOG_LEVEL environment variable not set
 */
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Validate and normalize log level from environment variable
 * @param envLevel - Log level from environment variable (case-insensitive)
 * @returns Normalized log level or default if invalid
 */
function getValidLogLevel(envLevel?: string): LogLevel {
  if (!envLevel) {
    return DEFAULT_LOG_LEVEL;
  }

  const normalized = envLevel.toLowerCase();
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

  if (validLevels.includes(normalized as LogLevel)) {
    return normalized as LogLevel;
  }

  return DEFAULT_LOG_LEVEL;
}

/**
 * Create configured Pino logger instance for browser
 * @param componentName - Component or module name to include in all log entries
 * @param logLevel - Optional log level override (defaults to VITE_LOG_LEVEL env var or 'info')
 * @returns Configured Pino logger instance with componentName as base context
 *
 * @example
 * ```typescript
 * const logger = createLogger('useTelemetry');
 * logger.info({ url: 'ws://localhost:9000' }, 'Connecting to telemetry server');
 * // Output: [useTelemetry] Connecting to telemetry server {url: 'ws://localhost:9000'}
 * ```
 *
 * @remarks
 * - Uses browser console for output (formatted for readability)
 * - Log level configurable via VITE_LOG_LEVEL environment variable
 * - Default level: INFO if VITE_LOG_LEVEL not set
 * - All log entries include componentName field for differentiation
 */
export function createLogger(componentName: string, logLevel?: string): Logger {
  // Read from Vite environment variable with defensive access for Jest compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envLogLevel = (globalThis as any).import?.meta?.env?.VITE_LOG_LEVEL;

  // Get log level from parameter, environment variable, or default
  const level = logLevel ? getValidLogLevel(logLevel) : getValidLogLevel(envLogLevel);

  // Create Pino logger configured for browser
  const baseLogger = pino({
    level,
    browser: {
      asObject: true, // Format logs as objects in console
    },
  });

  // Return child logger with component context
  // All logs from this logger will include component field
  return baseLogger.child({ component: componentName });
}
