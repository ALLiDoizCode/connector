/**
 * Mock for WebSocket API
 * Provides mock implementation of WebSocket for testing telemetry connections
 */

export type WebSocketEventHandler = ((event: Event) => void) | null;
export type MessageEventHandler = ((event: MessageEvent) => void) | null;
export type ErrorEventHandler = ((event: Event) => void) | null;
export type CloseEventHandler = ((event: CloseEvent) => void) | null;

// Store for mock WebSocket instances (for testing utilities)
const mockWebSocketInstances: MockWebSocket[] = [];

export class MockWebSocket implements WebSocket {
  // Static constants from WebSocket API
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  // Instance constants
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  // WebSocket properties
  public url: string;
  public readyState: number = MockWebSocket.CONNECTING;
  public bufferedAmount: number = 0;
  public extensions: string = '';
  public protocol: string = '';
  public binaryType: BinaryType = 'blob';

  // Event handlers
  public onopen: WebSocketEventHandler = null;
  public onmessage: MessageEventHandler = null;
  public onerror: ErrorEventHandler = null;
  public onclose: CloseEventHandler = null;

  // Mock-specific properties
  public sentMessages: unknown[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    if (typeof protocols === 'string') {
      this.protocol = protocols;
    } else if (Array.isArray(protocols) && protocols.length > 0 && protocols[0]) {
      this.protocol = protocols[0];
    }

    // Add to instances list
    mockWebSocketInstances.push(this);

    // Simulate connection opening asynchronously
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.simulateOpen();
      }
    }, 0);
  }

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open: readyState ' + this.readyState);
    }
    this.sentMessages.push(data);
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED || this.readyState === MockWebSocket.CLOSING) {
      return;
    }
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.simulateClose(code, reason);
    }, 0);
  }

  // Mock-specific methods for simulating events
  public simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      const event = new Event('open');
      this.onopen(event);
    }
    this.dispatchEvent(new Event('open'));
  }

  public simulateMessage(data: unknown): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      console.warn('Attempting to simulate message on non-open WebSocket');
      return;
    }
    if (this.onmessage) {
      const messageEvent = new MessageEvent('message', { data });
      this.onmessage(messageEvent);
    }
  }

  public simulateError(error?: string): void {
    if (this.onerror) {
      const errorEvent = new Event('error');
      if (error) {
        Object.defineProperty(errorEvent, 'message', { value: error });
      }
      this.onerror(errorEvent);
    }
  }

  public simulateClose(code = 1000, reason = 'Normal closure'): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      const closeEvent = new CloseEvent('close', { code, reason, wasClean: code === 1000 });
      this.onclose(closeEvent);
    }
  }

  // EventTarget implementation (minimal for testing)
  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | AddEventListenerOptions
  ): void {
    // Store listeners by type (simplified implementation for testing)
    if (!listener) return;

    const handler = typeof listener === 'function' ? listener : listener.handleEvent;

    switch (type) {
      case 'open':
        this.onopen = handler as WebSocketEventHandler;
        break;
      case 'message':
        this.onmessage = handler as MessageEventHandler;
        break;
      case 'error':
        this.onerror = handler as ErrorEventHandler;
        break;
      case 'close':
        this.onclose = handler as CloseEventHandler;
        break;
    }
  }

  public removeEventListener(
    type: string,
    _listener: EventListenerOrEventListenerObject | null,
    _options?: boolean | EventListenerOptions
  ): void {
    // Simplified implementation
    switch (type) {
      case 'open':
        this.onopen = null;
        break;
      case 'message':
        this.onmessage = null;
        break;
      case 'error':
        this.onerror = null;
        break;
      case 'close':
        this.onclose = null;
        break;
    }
  }

  public dispatchEvent(_event: Event): boolean {
    // Simplified - events are dispatched via on* handlers
    return true;
  }
}

// Test utilities
export const getMockWebSocketInstances = (): MockWebSocket[] => [...mockWebSocketInstances];

export const getLastMockWebSocket = (): MockWebSocket | undefined => {
  return mockWebSocketInstances[mockWebSocketInstances.length - 1];
};

export const clearMockWebSocketInstances = (): void => {
  mockWebSocketInstances.length = 0;
};

export const triggerWebSocketMessage = (data: unknown, instance?: MockWebSocket): void => {
  const ws = instance || getLastMockWebSocket();
  if (!ws) {
    throw new Error('No WebSocket instance available to trigger message');
  }
  ws.simulateMessage(data);
};

export const triggerWebSocketError = (error?: string, instance?: MockWebSocket): void => {
  const ws = instance || getLastMockWebSocket();
  if (!ws) {
    throw new Error('No WebSocket instance available to trigger error');
  }
  ws.simulateError(error);
};

export const triggerWebSocketClose = (
  code = 1000,
  reason = 'Normal closure',
  instance?: MockWebSocket
): void => {
  const ws = instance || getLastMockWebSocket();
  if (!ws) {
    throw new Error('No WebSocket instance available to trigger close');
  }
  ws.simulateClose(code, reason);
};

export default MockWebSocket;
