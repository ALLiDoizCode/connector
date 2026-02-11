/**
 * ILP Connector Library Exports
 * Side-effect-free entry point for library consumers
 * @packageDocumentation
 */

import { ConnectorNode } from './core/connector-node';
import { ConfigLoader, ConfigurationError, ConnectorNotStartedError } from './config/config-loader';
import { createLogger } from './utils/logger';
import { RoutingTable } from './routing/routing-table';
import { PacketHandler } from './core/packet-handler';
import { BTPServer } from './btp/btp-server';
import { BTPClient } from './btp/btp-client';
import { BTPClientManager } from './btp/btp-client-manager';
import { LocalDeliveryClient } from './core/local-delivery-client';
import { AdminServer } from './http/admin-server';
import { AccountManager } from './settlement/account-manager';
import { SettlementMonitor } from './settlement/settlement-monitor';
import { UnifiedSettlementExecutor } from './settlement/unified-settlement-executor';

// Export public API
export {
  ConnectorNode,
  ConfigLoader,
  ConfigurationError,
  ConnectorNotStartedError,
  RoutingTable,
  PacketHandler,
  BTPServer,
  BTPClient,
  BTPClientManager,
  LocalDeliveryClient,
  AdminServer,
  AccountManager,
  SettlementMonitor,
  UnifiedSettlementExecutor,
  createLogger,
};

// Export configuration types
export type {
  ConnectorConfig,
  PeerConfig,
  RouteConfig,
  SettlementConfig,
  LocalDeliveryConfig,
  LocalDeliveryHandler,
  LocalDeliveryRequest,
  LocalDeliveryResponse,
  SendPacketParams,
  PeerRegistrationRequest,
  PeerInfo,
  PeerAccountBalance,
  RouteInfo,
  RemovePeerResult,
} from './config/types';

// Re-export settlement types for library consumers
export type { AdminSettlementConfig } from './settlement/types';

// Re-export ILP packet types for library consumers
export type { ILPPreparePacket, ILPFulfillPacket, ILPRejectPacket } from '@agent-runtime/shared';
