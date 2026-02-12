/**
 * OpenTelemetry Distributed Tracing - Trace packet flow across connectors
 * @packageDocumentation
 * @remarks
 * Provides distributed tracing integration using OpenTelemetry.
 * Traces ILP packet processing, settlement operations, and channel events.
 */

import { Logger } from 'pino';
import type { Span, Tracer, Context } from '@opentelemetry/api';
import type { NodeSDK as NodeSDKType } from '@opentelemetry/sdk-node';
import { OpenTelemetryConfig } from './types';
import { requireOptional } from '../utils/optional-require';

/**
 * Default OpenTelemetry configuration
 */
const DEFAULT_CONFIG: OpenTelemetryConfig = {
  enabled: false,
  serviceName: 'agent-runtime',
  exporterEndpoint: 'http://localhost:4318/v1/traces',
  samplingRatio: 1.0,
};

/**
 * Span attributes for ILP packet tracing
 */
export interface PacketSpanAttributes {
  'ilp.destination'?: string;
  'ilp.amount'?: string;
  'ilp.type'?: string;
  'peer.source'?: string;
  'peer.destination'?: string;
}

/**
 * Span attributes for settlement tracing
 */
export interface SettlementSpanAttributes {
  'settlement.method'?: string;
  'settlement.amount'?: string;
  'settlement.token'?: string;
  'peer.id'?: string;
  'channel.id'?: string;
}

/**
 * Span status type
 */
export type SpanStatus = 'ok' | 'error';

/**
 * OpenTelemetryTracer provides distributed tracing for ILP Connector
 *
 * @example
 * ```typescript
 * const tracer = new OpenTelemetryTracer(logger, { enabled: true, serviceName: 'my-connector' });
 * await tracer.initialize();
 *
 * const span = tracer.startSpan('packet.process', { 'ilp.destination': 'g.example' });
 * try {
 *   // Process packet
 *   tracer.endSpan(span, 'ok');
 * } catch (error) {
 *   tracer.endSpan(span, 'error', error.message);
 * }
 * ```
 */
export class OpenTelemetryTracer {
  private readonly _logger: Logger;
  private readonly _config: OpenTelemetryConfig;
  private _sdk: NodeSDKType | null = null;
  private _tracer: Tracer | null = null;
  private _initialized: boolean = false;
  private _otelApi: typeof import('@opentelemetry/api') | null = null;

  /**
   * Create a new OpenTelemetryTracer instance
   *
   * @param logger - Pino logger instance
   * @param config - OpenTelemetry configuration
   */
  constructor(logger: Logger, config?: Partial<OpenTelemetryConfig>) {
    this._logger = logger.child({ component: 'otel-tracer' });
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Lazily loads the OpenTelemetry API module
   */
  private async _getOtelApi(): Promise<typeof import('@opentelemetry/api')> {
    if (!this._otelApi) {
      this._otelApi = await requireOptional<typeof import('@opentelemetry/api')>(
        '@opentelemetry/api',
        'OpenTelemetry distributed tracing'
      );
    }
    return this._otelApi;
  }

  /**
   * Initialize the OpenTelemetry SDK
   * Must be called before using tracing methods
   */
  async initialize(): Promise<void> {
    if (!this._config.enabled) {
      this._logger.info('OpenTelemetry tracing is disabled');
      return;
    }

    if (this._initialized) {
      this._logger.warn('OpenTelemetry tracer already initialized');
      return;
    }

    try {
      const otelApi = await this._getOtelApi();
      const { NodeSDK } = await requireOptional<typeof import('@opentelemetry/sdk-node')>(
        '@opentelemetry/sdk-node',
        'OpenTelemetry SDK for Node.js'
      );
      const { OTLPTraceExporter } = await requireOptional<
        typeof import('@opentelemetry/exporter-trace-otlp-http')
      >('@opentelemetry/exporter-trace-otlp-http', 'OpenTelemetry OTLP trace exporter');
      const { Resource } = await requireOptional<typeof import('@opentelemetry/resources')>(
        '@opentelemetry/resources',
        'OpenTelemetry resources'
      );
      const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await requireOptional<
        typeof import('@opentelemetry/semantic-conventions')
      >('@opentelemetry/semantic-conventions', 'OpenTelemetry semantic conventions');

      // Create OTLP HTTP exporter
      const exporter = new OTLPTraceExporter({
        url: this._config.exporterEndpoint,
      });

      // Create resource with service information
      const resource = new Resource({
        [ATTR_SERVICE_NAME]: this._config.serviceName,
        [ATTR_SERVICE_VERSION]: '1.0.0',
      });

      // Initialize NodeSDK
      this._sdk = new NodeSDK({
        resource,
        traceExporter: exporter,
        // Note: Sampling configuration is handled differently in newer versions
      });

      await this._sdk.start();

      // Get tracer from the global tracer provider
      this._tracer = otelApi.trace.getTracer(this._config.serviceName, '1.0.0');
      this._initialized = true;

      this._logger.info(
        {
          serviceName: this._config.serviceName,
          endpoint: this._config.exporterEndpoint,
        },
        'OpenTelemetry tracer initialized'
      );
    } catch (error) {
      this._logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to initialize OpenTelemetry tracer'
      );
      throw error;
    }
  }

  /**
   * Check if tracing is enabled and initialized
   */
  isEnabled(): boolean {
    return this._config.enabled && this._initialized;
  }

  /**
   * Create a minimal no-op span when OTel API is not loaded
   */
  private _createNoopSpan(name: string): Span {
    if (this._otelApi) {
      return this._otelApi.trace.getTracer('noop').startSpan(name);
    }
    // Minimal no-op span implementation when API is not loaded
    return {
      spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
      setAttribute: () => ({}),
      setAttributes: () => ({}),
      addEvent: () => ({}),
      addLink: () => ({}),
      setStatus: () => ({}),
      updateName: () => ({}),
      end: () => {},
      isRecording: () => false,
      recordException: () => {},
    } as unknown as Span;
  }

  /**
   * Start a new span for tracing an operation
   *
   * @param name - Span name (e.g., 'packet.process', 'settlement.execute')
   * @param attributes - Optional span attributes
   * @param parentContext - Optional parent context for linking spans
   * @returns The created span, or a no-op span if tracing is disabled
   */
  startSpan(
    name: string,
    attributes?: PacketSpanAttributes | SettlementSpanAttributes,
    parentContext?: Context
  ): Span {
    if (!this.isEnabled() || !this._tracer || !this._otelApi) {
      return this._createNoopSpan(name);
    }

    const ctx = parentContext || this._otelApi.context.active();

    const span = this._tracer.startSpan(
      name,
      {
        kind: this._otelApi.SpanKind.INTERNAL,
        attributes: attributes as Record<string, string | undefined>,
      },
      ctx
    );

    this._logger.trace({ spanName: name, traceId: span.spanContext().traceId }, 'Span started');

    return span;
  }

  /**
   * Start a server span (for incoming requests)
   *
   * @param name - Span name
   * @param attributes - Optional span attributes
   * @param parentContext - Optional parent context
   * @returns The created span
   */
  startServerSpan(
    name: string,
    attributes?: PacketSpanAttributes | SettlementSpanAttributes,
    parentContext?: Context
  ): Span {
    if (!this.isEnabled() || !this._tracer || !this._otelApi) {
      return this._createNoopSpan(name);
    }

    const ctx = parentContext || this._otelApi.context.active();

    return this._tracer.startSpan(
      name,
      {
        kind: this._otelApi.SpanKind.SERVER,
        attributes: attributes as Record<string, string | undefined>,
      },
      ctx
    );
  }

  /**
   * Start a client span (for outgoing requests)
   *
   * @param name - Span name
   * @param attributes - Optional span attributes
   * @param parentContext - Optional parent context
   * @returns The created span
   */
  startClientSpan(
    name: string,
    attributes?: PacketSpanAttributes | SettlementSpanAttributes,
    parentContext?: Context
  ): Span {
    if (!this.isEnabled() || !this._tracer || !this._otelApi) {
      return this._createNoopSpan(name);
    }

    const ctx = parentContext || this._otelApi.context.active();

    return this._tracer.startSpan(
      name,
      {
        kind: this._otelApi.SpanKind.CLIENT,
        attributes: attributes as Record<string, string | undefined>,
      },
      ctx
    );
  }

  /**
   * End a span with status
   *
   * @param span - The span to end
   * @param status - Span status ('ok' or 'error')
   * @param errorMessage - Optional error message if status is 'error'
   */
  endSpan(span: Span, status: SpanStatus = 'ok', errorMessage?: string): void {
    if (status === 'error') {
      span.setStatus({
        code: this._otelApi?.SpanStatusCode.ERROR ?? 2,
        message: errorMessage,
      });
      if (errorMessage) {
        span.recordException(new Error(errorMessage));
      }
    } else {
      span.setStatus({ code: this._otelApi?.SpanStatusCode.OK ?? 1 });
    }

    span.end();

    this._logger.trace({ status, errorMessage }, 'Span ended');
  }

  /**
   * Add attributes to an existing span
   *
   * @param span - The span to update
   * @param attributes - Attributes to add
   */
  addSpanAttributes(span: Span, attributes: PacketSpanAttributes | SettlementSpanAttributes): void {
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined) {
        span.setAttribute(key, value);
      }
    });
  }

  /**
   * Record an event on a span
   *
   * @param span - The span to record the event on
   * @param name - Event name
   * @param attributes - Optional event attributes
   */
  recordSpanEvent(
    span: Span,
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    span.addEvent(name, attributes);
  }

  /**
   * Inject trace context into headers for propagation to other services
   *
   * @param headers - Headers object to inject context into
   * @returns Headers with trace context
   */
  injectContext(headers: Record<string, string>): Record<string, string> {
    if (!this.isEnabled() || !this._otelApi) {
      return headers;
    }

    this._otelApi.propagation.inject(this._otelApi.context.active(), headers);

    this._logger.trace({ headers }, 'Trace context injected');

    return headers;
  }

  /**
   * Extract trace context from incoming headers
   *
   * @param headers - Headers containing trace context
   * @returns Extracted context
   */
  extractContext(headers: Record<string, string>): Context {
    if (!this.isEnabled() || !this._otelApi) {
      return this._otelApi?.context.active() ?? ({} as Context);
    }

    const extractedContext = this._otelApi.propagation.extract(
      this._otelApi.context.active(),
      headers
    );

    this._logger.trace('Trace context extracted');

    return extractedContext;
  }

  /**
   * Run a function within a span context
   *
   * @param span - The span to use as context
   * @param fn - Function to run within the span context
   * @returns Result of the function
   */
  withSpan<T>(span: Span, fn: () => T): T {
    if (!this._otelApi) {
      return fn();
    }
    return this._otelApi.context.with(
      this._otelApi.trace.setSpan(this._otelApi.context.active(), span),
      fn
    );
  }

  /**
   * Get the current trace ID
   *
   * @returns Current trace ID or undefined if no active span
   */
  getCurrentTraceId(): string | undefined {
    const activeSpan = this._otelApi?.trace.getActiveSpan();
    return activeSpan?.spanContext().traceId;
  }

  /**
   * Get the current span ID
   *
   * @returns Current span ID or undefined if no active span
   */
  getCurrentSpanId(): string | undefined {
    const activeSpan = this._otelApi?.trace.getActiveSpan();
    return activeSpan?.spanContext().spanId;
  }

  /**
   * Shutdown the OpenTelemetry SDK gracefully
   */
  async shutdown(): Promise<void> {
    if (this._sdk) {
      try {
        await this._sdk.shutdown();
        this._initialized = false;
        this._tracer = null;
        this._logger.info('OpenTelemetry tracer shutdown complete');
      } catch (error) {
        this._logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Error during OpenTelemetry tracer shutdown'
        );
      }
    }
  }
}
