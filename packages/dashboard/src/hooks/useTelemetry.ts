/**
 * Custom React hook for WebSocket telemetry connection
 */

import { useState, useEffect, useRef } from 'react';

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
        // eslint-disable-next-line no-console
        console.debug(`[useTelemetry] Connecting to telemetry server: ${telemetryUrl}`);
        const ws = new WebSocket(telemetryUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          // eslint-disable-next-line no-console
          console.debug('[useTelemetry] WebSocket connection established');
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
          // eslint-disable-next-line no-console
          console.debug('[useTelemetry] Sent CLIENT_CONNECT message');
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as TelemetryEvent;
            // eslint-disable-next-line no-console
            console.debug('[useTelemetry] Received telemetry event:', message);
            setEvents((prev) => [...prev, message]);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[useTelemetry] Failed to parse telemetry message:', err);
            // Ignore malformed messages, continue processing
          }
        };

        ws.onerror = (event) => {
          // eslint-disable-next-line no-console
          console.error('[useTelemetry] WebSocket error:', event);
          setError(new Error('WebSocket connection error'));
        };

        ws.onclose = () => {
          // eslint-disable-next-line no-console
          console.debug('[useTelemetry] WebSocket connection closed');
          setConnected(false);

          // Attempt reconnection with exponential backoff
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            const delay = reconnectDelayRef.current;
            // eslint-disable-next-line no-console
            console.debug(
              `[useTelemetry] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
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
            // eslint-disable-next-line no-console
            console.error('[useTelemetry] Max reconnection attempts reached. Connection failed.');
            setError(new Error('Connection Failed: Max reconnection attempts reached'));
          }
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useTelemetry] Failed to create WebSocket:', err);
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
