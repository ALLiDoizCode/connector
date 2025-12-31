/**
 * Unit tests for useTelemetry hook
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useTelemetry } from './useTelemetry';

// Mock WebSocket
class MockWebSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  close(): void {
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  send(_data: string): void {
    // Mock send
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

describe('useTelemetry', () => {
  let mockWebSocket: MockWebSocket;

  beforeEach(() => {
    // Mock WebSocket globally
    mockWebSocket = new MockWebSocket('ws://localhost:9000');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = jest.fn(() => mockWebSocket);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('connects to WebSocket on mount with correct URL', () => {
    renderHook(() => useTelemetry());

    expect(globalThis.WebSocket).toHaveBeenCalledWith('ws://localhost:9000');
  });

  test('sets connected state to true on WebSocket open', async () => {
    const { result } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
  });

  test('parses incoming telemetry messages as JSON', async () => {
    const { result } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    const testEvent = {
      type: 'NODE_STATUS',
      nodeId: 'connector-a',
      timestamp: '2025-12-27T10:00:00.000Z',
      data: { health: 'healthy', peers: [], routes: [] },
    };

    mockWebSocket.simulateMessage(testEvent);

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0]).toEqual(testEvent);
    });
  });

  test('appends events to events array on message received', async () => {
    const { result } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    const event1 = {
      type: 'NODE_STATUS',
      nodeId: 'connector-a',
      timestamp: '2025-12-27T10:00:00.000Z',
      data: {},
    };

    const event2 = {
      type: 'NODE_STATUS',
      nodeId: 'connector-b',
      timestamp: '2025-12-27T10:00:01.000Z',
      data: {},
    };

    mockWebSocket.simulateMessage(event1);
    mockWebSocket.simulateMessage(event2);

    await waitFor(() => {
      expect(result.current.events).toHaveLength(2);
    });
  });

  test('sets error state on WebSocket error', async () => {
    const { result } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    mockWebSocket.simulateError();

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });

  test('sets connected to false on WebSocket close', async () => {
    const { result } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    mockWebSocket.close();

    await waitFor(() => {
      expect(result.current.connected).toBe(false);
    });
  });

  test('closes WebSocket connection on unmount', async () => {
    const closeSpy = jest.spyOn(mockWebSocket, 'close');

    const { unmount } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(mockWebSocket.onopen).not.toBeNull();
    });

    unmount();

    expect(closeSpy).toHaveBeenCalled();
  });

  test('ignores malformed JSON messages', async () => {
    const { result } = renderHook(() => useTelemetry());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate malformed message
    if (mockWebSocket.onmessage) {
      mockWebSocket.onmessage(new MessageEvent('message', { data: 'invalid json' }));
    }

    // Events array should remain empty
    expect(result.current.events).toHaveLength(0);
  });
});
