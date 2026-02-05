/**
 * Agent Runtime Package
 *
 * Handles ILP/SPSP/STREAM protocol complexity, allowing users to build
 * custom business logic agents without understanding the underlying protocols.
 *
 * @packageDocumentation
 */

// Main runtime class
export { AgentRuntime, startFromEnv } from './agent-runtime';

// Type definitions
export {
  // Payment types
  PaymentSession,
  PaymentRequest,
  PaymentResponse,
  // Local delivery types (connector <-> runtime)
  LocalDeliveryRequest,
  LocalDeliveryResponse,
  // SPSP types
  SPSPResponse,
  PaymentSetupRequest,
  PaymentSetupResponse,
  // Configuration
  AgentRuntimeConfig,
  ResolvedAgentRuntimeConfig,
  DEFAULT_CONFIG,
  REJECT_CODE_MAP,
} from './types';

// Components (for advanced use cases)
export { SessionManager, SessionManagerConfig } from './session/session-manager';
export { BusinessClient, BusinessClientConfig } from './business/business-client';
export { PacketHandler, PacketHandlerConfig } from './packet/packet-handler';
export { SPSPServer, SPSPServerConfig } from './spsp/spsp-server';
export { HttpServer, HttpServerConfig } from './http/http-server';

// STREAM crypto utilities
export {
  computeFulfillment,
  computeCondition,
  computeExpectedCondition,
  verifyCondition,
  deriveFulfillmentKey,
  generateSharedSecret,
  generatePaymentId,
} from './stream/fulfillment';

// CLI entry point
import { startFromEnv as startCli } from './agent-runtime';

if (require.main === module) {
  startCli().catch((error: Error) => {
    console.error('Failed to start agent runtime:', error);
    process.exit(1);
  });
}
