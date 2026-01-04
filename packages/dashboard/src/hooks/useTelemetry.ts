/**
 * Custom React hook for WebSocket telemetry connection
 */

import { useState, useEffect, useRef } from 'react';
import { createLogger } from '../utils/logger';

/**
 * Telemetry event structure received from telemetry server
 */
export interface TelemetryEvent {
  type: string;
  nodeId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Hook interface for telemetry connection
 */
export interface UseTelemetryResult {
  events: TelemetryEvent[];
  connected: boolean;
  error: Error | null;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 60000; // 60 seconds

// Create logger instance for this hook
const logger = createLogger('useTelemetry');

/**
 * Custom hook to connect to dashboard telemetry WebSocket server
 * Handles connection lifecycle, message parsing, and automatic reconnection
 */
export function useTelemetry(): UseTelemetryResult {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  // Read telemetry server URL from environment variable with default
  // Access via globalThis to avoid TypeScript compile errors in Jest
  const telemetryUrl =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).import?.meta?.env?.VITE_TELEMETRY_WS_URL || 'ws://localhost:9000';

  useEffect(() => {
    const connect = (): void => {
      try {
        logger.debug({ url: telemetryUrl }, 'Connecting to telemetry server');
        const ws = new WebSocket(telemetryUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          logger.debug('WebSocket connection established');
          setConnected(true);
          setError(null);
          // Reset reconnection state on successful connection
          reconnectAttemptsRef.current = 0;
          reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;

          // Send CLIENT_CONNECT message to register as a dashboard client
          const clientConnectMessage = {
            type: 'CLIENT_CONNECT',
            nodeId: 'dashboard-client',
            timestamp: new Date().toISOString(),
            data: {},
          };
          ws.send(JSON.stringify(clientConnectMessage));
          logger.debug('Sent CLIENT_CONNECT message');
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as TelemetryEvent;
            logger.debug({ message }, 'Received telemetry event');
            setEvents((prev) => [...prev, message]);
          } catch (err) {
            logger.error({ error: err }, 'Failed to parse telemetry message');
            // Ignore malformed messages, continue processing
          }
        };

        ws.onerror = (event) => {
          logger.error({ error: event }, 'WebSocket error');
          setError(new Error('WebSocket connection error'));
        };

        ws.onclose = () => {
          logger.debug('WebSocket connection closed');
          setConnected(false);

          // Attempt reconnection with exponential backoff
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            const delay = reconnectDelayRef.current;
            logger.debug(
              {
                delay,
                attempt: reconnectAttemptsRef.current,
                maxAttempts: MAX_RECONNECT_ATTEMPTS,
              },
              'Reconnecting to telemetry server'
            );

            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, delay);

            // Exponential backoff: double delay up to max
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY
            );
          } else {
            logger.error('Max reconnection attempts reached. Connection failed.');
            setError(new Error('Connection Failed: Max reconnection attempts reached'));
          }
        };
      } catch (err) {
        logger.error({ error: err }, 'Failed to create WebSocket');
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };

    connect();

    // Cleanup: close WebSocket and clear reconnection timeout on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [telemetryUrl]);

  return { events, connected, error };
}
