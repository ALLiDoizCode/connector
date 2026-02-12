/**
 * Pino Transport for LOG Telemetry Emission
 * @packageDocumentation
 * @remarks
 * Custom Pino transport that sends log entries to dashboard via telemetry.
 * Implements non-blocking emission to prevent logging failures from breaking connector.
 */

import { Transform } from 'stream';
import { requireOptional } from '../utils/optional-require';

/**
 * Log level type matching Pino levels
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * LogEntry structure for telemetry emission
 * @remarks
 * Matches the LogEntry interface from packages/dashboard/src/types/log.ts
 */
interface LogEntry {
  level: LogLevel;
  timestamp: string;
  nodeId: string;
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

/**
 * Pino log object structure received by transport
 * @remarks
 * Pino sends log objects with numeric level, time, msg, and custom fields
 */
interface PinoLogObject {
  level: number;
  time: number;
  msg: string;
  nodeId: string;
  [key: string]: unknown;
}

/**
 * Emit function type for LOG telemetry
 */
export type EmitLogFunction = (logEntry: LogEntry) => void;

/**
 * Map Pino numeric log level to string log level
 * @param pinoLevel - Pino numeric log level
 * @returns String log level (debug, info, warn, error) or null if level should be skipped
 * @remarks
 * Pino levels: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal
 * We skip trace (10) and map fatal (60) to error
 */
function mapPinoLevel(pinoLevel: number): LogLevel | null {
  if (pinoLevel < 20) {
    // Skip trace level (not supported)
    return null;
  } else if (pinoLevel < 30) {
    return 'debug';
  } else if (pinoLevel < 40) {
    return 'info';
  } else if (pinoLevel < 50) {
    return 'warn';
  } else {
    // Error and fatal both map to 'error'
    return 'error';
  }
}

/**
 * Transform Pino log object to LogEntry for telemetry
 * @param pinoLog - Pino log object from stream
 * @returns LogEntry object ready for telemetry emission
 * @remarks
 * Extracts standard fields (level, time, msg, nodeId) and additional context
 * fields into the LogEntry structure. Handles missing fields gracefully.
 */
function transformLogObject(pinoLog: PinoLogObject): LogEntry | null {
  // Map numeric level to string level
  const level = mapPinoLevel(pinoLog.level);
  if (!level) {
    // Skip this log entry (e.g., trace level)
    return null;
  }

  // Convert Pino timestamp (milliseconds since epoch) to ISO 8601 string
  const timestamp = new Date(pinoLog.time).toISOString();

  // Extract nodeId (should always be present from child logger)
  const nodeId = pinoLog.nodeId as string;

  // Extract message
  const message = pinoLog.msg || '';

  // Extract optional correlationId if present
  const correlationId = pinoLog.correlationId ? (pinoLog.correlationId as string) : undefined;

  // Extract additional context fields
  // Exclude standard Pino fields and our known fields
  const standardFields = new Set([
    'level',
    'time',
    'msg',
    'nodeId',
    'correlationId',
    'pid',
    'hostname',
  ]);

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pinoLog)) {
    if (!standardFields.has(key)) {
      context[key] = value;
    }
  }

  // Only include context if it has fields
  const contextOrUndefined = Object.keys(context).length > 0 ? context : undefined;

  return {
    level,
    timestamp,
    nodeId,
    message,
    correlationId,
    context: contextOrUndefined,
  };
}

/**
 * Create Pino transport for LOG telemetry emission
 * @param emitLog - Function to emit LOG telemetry events
 * @returns Pino transport stream
 * @remarks
 * This transport receives Pino log objects, transforms them to LogEntry format,
 * and emits them via the provided emitLog function. All errors are caught to
 * prevent logging failures from breaking the connector.
 *
 * @example
 * ```typescript
 * const transport = await createTelemetryTransport((logEntry) => {
 *   telemetryEmitter.emitLog(logEntry);
 * });
 * const logger = pino(transport);
 * logger.info({ correlationId: 'pkt_123' }, 'Packet received');
 * ```
 */
export async function createTelemetryTransport(emitLog: EmitLogFunction): Promise<Transform> {
  // pino-abstract-transport uses `export = build` (CJS), so dynamic import yields { default: build }
  const mod = await requireOptional<{ default: (fn: (source: Transform) => void) => Transform }>(
    'pino-abstract-transport',
    'Pino telemetry transport'
  );
  const build = mod.default;
  return build((source: Transform) => {
    source.on('data', (obj) => {
      try {
        // Transform Pino log object to LogEntry
        const logEntry = transformLogObject(obj as PinoLogObject);

        if (logEntry) {
          // Emit LOG telemetry (wrapped in try-catch for non-blocking)
          try {
            emitLog(logEntry);
          } catch (error) {
            // Silently ignore telemetry emission errors
            // Critical: Do not let telemetry failures break logging
            // Error will be logged to stderr by emitLog if needed
          }
        }
      } catch (error) {
        // Silently ignore log transformation errors
        // Prevents malformed log entries from breaking transport
      }
    });
  });
}
