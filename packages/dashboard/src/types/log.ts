/**
 * Log telemetry event types and interfaces
 * @packageDocumentation
 * @remarks
 * Defines the structure for LOG telemetry events emitted by connectors
 * and consumed by the dashboard log viewer.
 */

/**
 * Log level enumeration matching Pino log levels
 * @remarks
 * Maps to Pino numeric levels:
 * - debug: 20-29
 * - info: 30-39
 * - warn: 40-49
 * - error: 50+
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure for LOG telemetry events
 * @remarks
 * This interface represents the data payload of a LOG telemetry event.
 * It is emitted by connectors via TelemetryEmitter and consumed by
 * the dashboard LogViewer component.
 *
 * @example
 * ```typescript
 * const logEntry: LogEntry = {
 *   level: 'info',
 *   timestamp: '2024-12-29T12:34:56.789Z',
 *   nodeId: 'connector-a',
 *   message: 'Packet received',
 *   correlationId: 'pkt_abc123def4567890',
 *   context: {
 *     destination: 'g.dest',
 *     amount: '1000'
 *   }
 * };
 * ```
 */
export interface LogEntry {
  /**
   * Log level (debug, info, warn, error)
   */
  level: LogLevel;

  /**
   * ISO 8601 timestamp when log entry was created
   * @example "2024-12-29T12:34:56.789Z"
   */
  timestamp: string;

  /**
   * Connector node ID that emitted this log entry
   * @example "connector-a"
   */
  nodeId: string;

  /**
   * Human-readable log message
   * @example "Packet received from peer"
   */
  message: string;

  /**
   * Optional packet correlation ID for tracking packets through multi-hop flows
   * @example "pkt_abc123def4567890"
   */
  correlationId?: string;

  /**
   * Optional additional structured fields from the log entry
   * @remarks
   * Contains extra context fields logged with the message, such as
   * destination addresses, peer information, packet details, etc.
   * @example { destination: "g.dest", peer: "connector-b", amount: "1000" }
   */
  context?: Record<string, unknown>;
}

/**
 * LOG telemetry event structure
 * @remarks
 * This is the complete telemetry event structure when type === "LOG".
 * The data field contains a LogEntry object.
 *
 * @example
 * ```typescript
 * const logTelemetryEvent: LogTelemetryEvent = {
 *   type: 'LOG',
 *   nodeId: 'connector-a',
 *   timestamp: '2024-12-29T12:34:56.789Z',
 *   data: {
 *     level: 'info',
 *     timestamp: '2024-12-29T12:34:56.789Z',
 *     nodeId: 'connector-a',
 *     message: 'Packet received',
 *     correlationId: 'pkt_abc123def4567890',
 *     context: { destination: 'g.dest' }
 *   }
 * };
 * ```
 */
export interface LogTelemetryEvent {
  type: 'LOG';
  nodeId: string;
  timestamp: string;
  data: LogEntry;
}
