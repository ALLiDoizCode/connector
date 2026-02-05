/**
 * ConnectorNode - Core ILP connector orchestrator
 * Manages all connector components and lifecycle
 */

import { Logger } from '../utils/logger';
import { RoutingTable } from '../routing/routing-table';
import { BTPClientManager } from '../btp/btp-client-manager';
import { BTPServer } from '../btp/btp-server';
import { PacketHandler } from './packet-handler';
import { Peer } from '../btp/btp-client';
import { RoutingTableEntry, ILPAddress } from '@m2m/shared';
import { ConnectorConfig, SettlementConfig } from '../config/types';
import { ConfigLoader, ConfigurationError } from '../config/config-loader';
import { HealthServer } from '../http/health-server';
import { AdminServer } from '../http/admin-server';
import { HealthStatus, HealthStatusProvider } from '../http/types';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter';
import { PeerStatus } from '../telemetry/types';
import { EventStore, ExplorerServer } from '../explorer';
import { validateAptosEnvironment } from '../config/aptos-env-validator';
import type { IAptosChannelSDK } from '../settlement/aptos-channel-sdk';
import { createAptosChannelSDKFromEnv } from '../settlement/aptos-channel-sdk';
import { PaymentChannelSDK } from '../settlement/payment-channel-sdk';
import { ChannelManager } from '../settlement/channel-manager';
import { SettlementExecutor } from '../settlement/settlement-executor';
import { AccountManager } from '../settlement/account-manager';
import { SettlementMonitor } from '../settlement/settlement-monitor';
import { KeyManager } from '../security/key-manager';
import { ethers } from 'ethers';
import { TigerBeetleClient } from '../settlement/tigerbeetle-client';
import { promises as dns } from 'dns';
// Import package.json for version information
import packageJson from '../../package.json';

/**
 * ConnectorNode - Main connector orchestrator
 * Coordinates RoutingTable, BTPClientManager, PacketHandler, and BTPServer
 * Implements connector startup, shutdown, and health monitoring
 */
export class ConnectorNode implements HealthStatusProvider {
  private readonly _config: ConnectorConfig;
  private readonly _logger: Logger;
  private readonly _routingTable: RoutingTable;
  private readonly _btpClientManager: BTPClientManager;
  private readonly _packetHandler: PacketHandler;
  private readonly _btpServer: BTPServer;
  private readonly _healthServer: HealthServer;
  private _adminServer: AdminServer | null = null;
  private readonly _telemetryEmitter: TelemetryEmitter | null;
  private _eventStore: EventStore | null = null;
  private _explorerServer: ExplorerServer | null = null;
  private _aptosChannelSDK: IAptosChannelSDK | null = null;
  private _paymentChannelSDK: PaymentChannelSDK | null = null;
  private _channelManager: ChannelManager | null = null;
  private _accountManager: AccountManager | null = null;
  private _settlementExecutor: SettlementExecutor | null = null;
  private _healthStatus: 'healthy' | 'unhealthy' | 'starting' = 'starting';
  private readonly _startTime: Date = new Date();
  private _btpServerStarted: boolean = false;

  /**
   * Create ConnectorNode instance
   * @param configFilePath - Path to YAML configuration file
   * @param logger - Pino logger instance
   * @throws ConfigurationError if configuration is invalid
   */
  constructor(configFilePath: string, logger: Logger) {
    // Load and validate configuration from YAML file
    let config: ConnectorConfig;
    try {
      config = ConfigLoader.loadConfig(configFilePath);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.error(
          {
            event: 'config_load_failed',
            filePath: configFilePath,
            error: error.message,
          },
          'Failed to load configuration'
        );
        throw error;
      }
      throw error;
    }

    this._config = config;
    this._logger = logger.child({ component: 'ConnectorNode', nodeId: config.nodeId });

    this._logger.info(
      {
        event: 'config_loaded',
        filePath: configFilePath,
        nodeId: config.nodeId,
      },
      'Configuration loaded successfully'
    );

    // Convert RouteConfig[] to RoutingTableEntry[]
    const routingTableEntries: RoutingTableEntry[] = config.routes.map((route) => ({
      prefix: route.prefix as ILPAddress,
      nextHop: route.nextHop,
      priority: route.priority,
    }));

    // Initialize routing table
    this._routingTable = new RoutingTable(
      routingTableEntries,
      logger.child({ component: 'RoutingTable' })
    );

    // Initialize BTP client manager
    this._btpClientManager = new BTPClientManager(
      config.nodeId,
      logger.child({ component: 'BTPClientManager' })
    );

    // Initialize telemetry emitter if DASHBOARD_TELEMETRY_URL is set
    const dashboardUrl = process.env.DASHBOARD_TELEMETRY_URL;
    if (dashboardUrl) {
      this._telemetryEmitter = new TelemetryEmitter(
        dashboardUrl,
        config.nodeId,
        logger.child({ component: 'TelemetryEmitter' })
      );
      this._logger.info(
        { event: 'telemetry_enabled', dashboardUrl },
        'Telemetry emitter initialized'
      );
    } else {
      this._telemetryEmitter = null;
      this._logger.info(
        { event: 'telemetry_disabled' },
        'Telemetry disabled (DASHBOARD_TELEMETRY_URL not set)'
      );
    }

    // Initialize packet handler (pass telemetryEmitter for telemetry integration)
    this._packetHandler = new PacketHandler(
      this._routingTable,
      this._btpClientManager,
      config.nodeId,
      logger.child({ component: 'PacketHandler' }),
      this._telemetryEmitter
    );

    // Initialize BTP server
    this._btpServer = new BTPServer(logger.child({ component: 'BTPServer' }), this._packetHandler);

    // Link BTPServer to PacketHandler for bidirectional forwarding (resolves circular dependency)
    this._packetHandler.setBTPServer(this._btpServer);

    // Configure local delivery if enabled (forwards local packets to agent runtime)
    const localDeliveryEnabled =
      config.localDelivery?.enabled || process.env.LOCAL_DELIVERY_ENABLED === 'true';
    if (localDeliveryEnabled) {
      const localDeliveryConfig = {
        enabled: true,
        handlerUrl: config.localDelivery?.handlerUrl || process.env.LOCAL_DELIVERY_URL || '',
        timeout:
          config.localDelivery?.timeout ||
          parseInt(process.env.LOCAL_DELIVERY_TIMEOUT || '30000', 10),
      };
      this._packetHandler.setLocalDelivery(localDeliveryConfig);
    }

    // Link PacketHandler to BTPClientManager for incoming packet handling (resolves circular dependency)
    this._btpClientManager.setPacketHandler(this._packetHandler);

    // Initialize health server
    this._healthServer = new HealthServer(logger.child({ component: 'HealthServer' }), this);

    this._logger.info(
      {
        event: 'connector_initialized',
        nodeId: config.nodeId,
        peersCount: config.peers.length,
        routesCount: config.routes.length,
      },
      'Connector node initialized'
    );
  }

  /**
   * Start connector and establish peer connections
   * Starts BTP server and connects to all configured peers
   */
  async start(): Promise<void> {
    this._logger.info(
      {
        event: 'connector_starting',
        nodeId: this._config.nodeId,
        peersCount: this._config.peers.length,
        routesCount: this._config.routes.length,
      },
      'Starting connector node'
    );

    try {
      // Initialize Aptos Channel SDK if enabled
      const aptosValidation = validateAptosEnvironment(this._logger);
      if (aptosValidation.enabled && aptosValidation.valid) {
        try {
          this._aptosChannelSDK = createAptosChannelSDKFromEnv(this._logger);
          this._aptosChannelSDK.startAutoRefresh();
          this._logger.info(
            { event: 'aptos_sdk_initialized' },
            'AptosChannelSDK initialized with auto-refresh'
          );
        } catch (error) {
          // Log error but continue without Aptos (graceful degradation)
          const errorMessage = error instanceof Error ? error.message : String(error);
          this._logger.error(
            { event: 'aptos_sdk_init_failed', error: errorMessage },
            'Failed to initialize AptosChannelSDK (connector continues without Aptos)'
          );
        }
      } else if (aptosValidation.enabled && !aptosValidation.valid) {
        this._logger.warn(
          { event: 'aptos_disabled_missing_env', missing: aptosValidation.missing },
          'Aptos settlement disabled due to missing environment variables'
        );
      }

      // Initialize Base L2 Payment Channel infrastructure if enabled
      const settlementEnabled = process.env.SETTLEMENT_ENABLED === 'true';
      const baseRpcUrl = process.env.BASE_L2_RPC_URL;
      const registryAddress = process.env.TOKEN_NETWORK_REGISTRY;
      const m2mTokenAddress = process.env.M2M_TOKEN_ADDRESS;
      const treasuryPrivateKey = process.env.TREASURY_EVM_PRIVATE_KEY;

      if (
        settlementEnabled &&
        baseRpcUrl &&
        registryAddress &&
        m2mTokenAddress &&
        treasuryPrivateKey
      ) {
        try {
          // Initialize KeyManager with Environment backend (using TREASURY_EVM_PRIVATE_KEY)
          // Temporarily set EVM_PRIVATE_KEY for EnvironmentVariableBackend
          const originalEvmKey = process.env.EVM_PRIVATE_KEY;
          process.env.EVM_PRIVATE_KEY = treasuryPrivateKey;

          const keyManager = new KeyManager(
            {
              backend: 'env',
              nodeId: this._config.nodeId,
            },
            this._logger
          );

          // Restore original EVM_PRIVATE_KEY
          if (originalEvmKey) {
            process.env.EVM_PRIVATE_KEY = originalEvmKey;
          } else {
            delete process.env.EVM_PRIVATE_KEY;
          }

          // Use 'evm' as key ID (EnvironmentVariableBackend detects type from keyId)
          const evmKeyId = 'evm';

          // Initialize PaymentChannelSDK
          const provider = new ethers.JsonRpcProvider(baseRpcUrl);
          this._paymentChannelSDK = new PaymentChannelSDK(
            provider,
            keyManager,
            evmKeyId,
            registryAddress,
            this._logger
          );

          // Build peer ID to EVM address mapping from environment
          const peerIdToAddressMap = new Map<string, string>();
          for (let i = 1; i <= 5; i++) {
            const peerAddress = process.env[`PEER${i}_EVM_ADDRESS`];
            if (peerAddress) {
              peerIdToAddressMap.set(`peer${i}`, peerAddress);
              this._logger.debug(
                { peerId: `peer${i}`, address: peerAddress },
                'Loaded peer EVM address'
              );
            }
          }

          // Build token address map (M2M token for test deployment)
          const tokenAddressMap = new Map<string, string>();
          tokenAddressMap.set('M2M', m2mTokenAddress);
          tokenAddressMap.set('ILP', m2mTokenAddress); // ILP token maps to M2M for settlement

          // Initialize ChannelManager with TigerBeetle accounting if configured
          const defaultSettlementTimeout = 86400; // 24 hours
          const initialDepositMultiplier = 10;

          // Initialize TigerBeetle AccountManager if configured (Story 19.1-19.2)
          // When TigerBeetle is unavailable, falls back to mock AccountManager (graceful degradation)
          let accountManager: AccountManager;
          const tigerBeetleClusterId = process.env.TIGERBEETLE_CLUSTER_ID;
          const tigerBeetleReplicas = process.env.TIGERBEETLE_REPLICAS;

          if (tigerBeetleClusterId && tigerBeetleReplicas) {
            try {
              // Resolve hostnames to IP addresses (TigerBeetle client requires IP addresses)
              const rawAddresses = tigerBeetleReplicas.split(',').map((s) => s.trim());
              const resolvedAddresses = await Promise.all(
                rawAddresses.map(async (addr) => {
                  const parts = addr.split(':');
                  const hostOrIp = parts[0] || addr;
                  const port = parts[1] || '3000';
                  // Check if already an IP address
                  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostOrIp)) {
                    return addr;
                  }
                  // Resolve hostname to IP
                  try {
                    const result = await dns.lookup(hostOrIp);
                    this._logger.debug(
                      { hostname: hostOrIp, ip: result.address },
                      'Resolved TigerBeetle hostname to IP'
                    );
                    return `${result.address}:${port}`;
                  } catch (dnsError) {
                    this._logger.warn(
                      { hostname: hostOrIp, error: dnsError },
                      'Failed to resolve TigerBeetle hostname, using as-is'
                    );
                    return addr;
                  }
                })
              );

              // Create TigerBeetle client
              const tigerBeetleClient = new TigerBeetleClient(
                {
                  clusterId: parseInt(tigerBeetleClusterId, 10),
                  replicaAddresses: resolvedAddresses,
                  connectionTimeout: 5000,
                  operationTimeout: 5000,
                },
                this._logger
              );

              // Initialize TigerBeetle connection
              await tigerBeetleClient.initialize();

              // Create AccountManager with telemetry
              accountManager = new AccountManager(
                {
                  nodeId: this._config.nodeId,
                  telemetryEmitter: this._telemetryEmitter || undefined,
                },
                tigerBeetleClient,
                this._logger
              );

              // Store accountManager for later wiring to EventStore/EventBroadcaster (Story 19.3)
              this._accountManager = accountManager;

              this._logger.info(
                {
                  event: 'tigerbeetle_account_manager_initialized',
                  clusterId: tigerBeetleClusterId,
                  replicas: tigerBeetleReplicas,
                },
                'TigerBeetle AccountManager initialized for balance tracking'
              );
            } catch (error) {
              // Fall back to mock if TigerBeetle initialization fails
              const errorMessage = error instanceof Error ? error.message : String(error);
              this._logger.warn(
                {
                  event: 'tigerbeetle_init_failed',
                  error: errorMessage,
                  clusterId: tigerBeetleClusterId,
                  replicas: tigerBeetleReplicas,
                },
                'TigerBeetle initialization failed, using mock AccountManager (balance tracking disabled)'
              );
              // Create a NoOp AccountManager with stub methods
              accountManager = this._createNoOpAccountManager();
            }
          } else {
            this._logger.info(
              { event: 'tigerbeetle_disabled' },
              'TigerBeetle accounting disabled (TIGERBEETLE_CLUSTER_ID or TIGERBEETLE_REPLICAS not set)'
            );
            // Create a NoOp AccountManager with stub methods
            accountManager = this._createNoOpAccountManager();
          }

          // Initialize SettlementMonitor for threshold-based settlement triggering
          // Extract peer IDs from peerIdToAddressMap (includes all known peers in the network)
          const peerIds = Array.from(peerIdToAddressMap.keys());

          // Build settlement threshold configuration
          // Use settlementThreshold from config or default to 1M (1,000,000)
          const settlementThreshold = BigInt(process.env.SETTLEMENT_THRESHOLD || '1000000');

          this._logger.info(
            {
              event: 'settlement_monitor_config',
              peerIds,
              threshold: settlementThreshold.toString(),
              pollingInterval: 30000,
            },
            'Initializing settlement monitor with peer list'
          );

          const settlementMonitor = new SettlementMonitor(
            {
              thresholds: {
                defaultThreshold: settlementThreshold,
                pollingInterval: 30000, // 30 seconds
              },
              peers: peerIds,
              tokenIds: ['ILP'], // MVP: single token ID
              telemetryEmitter: this._telemetryEmitter || undefined,
              nodeId: this._config.nodeId,
            },
            accountManager,
            this._logger
          );

          this._settlementExecutor = new SettlementExecutor(
            {
              nodeId: this._config.nodeId,
              defaultSettlementTimeout,
              initialDepositMultiplier,
              minDepositThreshold: 0.5,
              maxRetries: 3,
              retryDelayMs: 5000,
              tokenAddressMap,
              peerIdToAddressMap,
              registryAddress,
              rpcUrl: baseRpcUrl,
              privateKey: treasuryPrivateKey,
            },
            accountManager,
            this._paymentChannelSDK,
            settlementMonitor,
            this._logger,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this._telemetryEmitter as any
          );

          // Start automatic settlement execution
          this._settlementExecutor.start();
          this._logger.info(
            { event: 'settlement_executor_started' },
            'Automatic settlement execution enabled'
          );

          // Start monitoring after a short delay to ensure AccountManager is fully initialized
          setTimeout(async () => {
            try {
              await settlementMonitor.start();
              this._logger.info(
                {
                  event: 'settlement_monitor_started',
                  threshold: settlementThreshold.toString(),
                  peerCount: peerIds.length,
                  pollingInterval: 30000,
                },
                'Settlement threshold monitoring started'
              );
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              this._logger.error(
                { event: 'settlement_monitor_start_failed', error: errorMessage },
                'Failed to start settlement monitor'
              );
            }
          }, 5000); // 5 second delay

          this._channelManager = new ChannelManager(
            {
              nodeId: this._config.nodeId,
              defaultSettlementTimeout,
              initialDepositMultiplier,
              idleChannelThreshold: 86400,
              minDepositThreshold: 0.5,
              idleCheckInterval: 3600,
              tokenAddressMap,
              peerIdToAddressMap,
              registryAddress,
              rpcUrl: baseRpcUrl,
              privateKey: treasuryPrivateKey,
            },
            this._paymentChannelSDK,
            this._settlementExecutor,
            this._logger,
            this._telemetryEmitter || undefined
          );

          this._logger.info(
            {
              event: 'payment_channel_sdk_initialized',
              registryAddress,
              tokenAddress: m2mTokenAddress,
              peerCount: peerIdToAddressMap.size,
            },
            'Payment channel infrastructure initialized'
          );

          // Wire AccountManager into PacketHandler for settlement recording
          if (tigerBeetleClusterId && tigerBeetleReplicas && accountManager) {
            const settlementConfig: SettlementConfig = {
              connectorFeePercentage: 0.1, // 0.1% default fee
              enableSettlement: true,
              tigerBeetleClusterId: parseInt(tigerBeetleClusterId, 10),
              tigerBeetleReplicas: tigerBeetleReplicas.split(',').map((s) => s.trim()),
            };

            this._packetHandler.setSettlement(accountManager, settlementConfig);
          }
        } catch (error) {
          // Log error but continue without payment channels (graceful degradation)
          const errorMessage = error instanceof Error ? error.message : String(error);
          this._logger.error(
            { event: 'payment_channel_init_failed', error: errorMessage },
            'Failed to initialize payment channel infrastructure (connector continues without channels)'
          );
        }
      } else {
        this._logger.info(
          { event: 'payment_channels_disabled' },
          'Payment channel infrastructure disabled (missing configuration)'
        );
      }

      // Start BTP server to accept incoming connections
      await this._btpServer.start(this._config.btpServerPort);
      this._btpServerStarted = true;
      this._logger.info(
        {
          event: 'btp_server_started',
          port: this._config.btpServerPort,
        },
        'BTP server started'
      );

      // Start health server
      const healthCheckPort = this._config.healthCheckPort || 8080;
      await this._healthServer.start(healthCheckPort);
      this._logger.info(
        {
          event: 'health_server_started',
          port: healthCheckPort,
        },
        'Health server started'
      );

      // Start admin API server if enabled
      const adminApiEnabled =
        this._config.adminApi?.enabled || process.env.ADMIN_API_ENABLED === 'true';
      if (adminApiEnabled) {
        const adminConfig = {
          enabled: true,
          port: this._config.adminApi?.port ?? parseInt(process.env.ADMIN_API_PORT || '8081', 10),
          host: this._config.adminApi?.host ?? process.env.ADMIN_API_HOST ?? '0.0.0.0',
          apiKey: this._config.adminApi?.apiKey ?? process.env.ADMIN_API_KEY,
        };

        this._adminServer = new AdminServer({
          routingTable: this._routingTable,
          btpClientManager: this._btpClientManager,
          nodeId: this._config.nodeId,
          config: adminConfig,
          logger: this._logger,
        });

        await this._adminServer.start();
        this._logger.info(
          {
            event: 'admin_server_started',
            port: adminConfig.port,
            host: adminConfig.host,
            apiKeyConfigured: !!adminConfig.apiKey,
          },
          'Admin API server started'
        );
      } else {
        this._logger.debug(
          { event: 'admin_api_disabled' },
          'Admin API disabled (set ADMIN_API_ENABLED=true or adminApi.enabled=true to enable)'
        );
      }

      // Start explorer if enabled (default: true)
      if (this._config.explorer?.enabled !== false) {
        try {
          const explorerConfig = this._config.explorer || {};
          const explorerPort = explorerConfig.port ?? 3001;
          const retentionDays = explorerConfig.retentionDays ?? 7;
          const maxEvents = explorerConfig.maxEvents ?? 1000000;

          // Initialize EventStore
          this._eventStore = new EventStore(
            {
              path: `./data/explorer-${this._config.nodeId}.db`,
              maxEventCount: maxEvents,
              maxAgeMs: retentionDays * 24 * 60 * 60 * 1000,
            },
            this._logger.child({ component: 'EventStore' })
          );
          await this._eventStore.initialize();

          // Wire TelemetryEmitter to EventStore for persistence (if available)
          if (this._telemetryEmitter) {
            this._telemetryEmitter.onEvent((event) => {
              this._eventStore?.storeEvent(event).catch((err) => {
                this._logger.warn({ error: err.message }, 'Failed to store telemetry event');
              });
            });
          } else {
            // Standalone mode: Wire PacketHandler events directly to EventStore
            this._logger.info(
              { event: 'explorer_standalone_mode' },
              'Explorer running in standalone mode - PacketHandler will emit events directly to EventStore'
            );
            // Pass EventStore to PacketHandler for direct event emission
            this._packetHandler.setEventStore(this._eventStore);
            // Note: EventBroadcaster will be wired after ExplorerServer starts
          }

          // Initialize ExplorerServer (works with or without telemetryEmitter)
          this._explorerServer = new ExplorerServer(
            {
              port: explorerPort,
              staticPath: './packages/connector/dist/explorer-ui', // Correct path in Docker container
              nodeId: this._config.nodeId,
              routesFetcher: () => Promise.resolve(this.getRoutingTable()),
              peersFetcher: () => {
                const peerIds = this._btpClientManager.getPeerIds();
                const peerStatus = this._btpClientManager.getPeerStatus();
                const routes = this._routingTable.getAllRoutes();

                // Build a map from peerId to ILP address by finding routes that use this peer as nextHop
                const peerToIlpAddress = new Map<string, string>();
                for (const route of routes) {
                  if (!peerToIlpAddress.has(route.nextHop)) {
                    // Use the route prefix as the ILP address for this peer
                    peerToIlpAddress.set(route.nextHop, route.prefix);
                  }
                }

                return Promise.resolve(
                  peerIds.map((id) => ({
                    peerId: id,
                    ilpAddress: peerToIlpAddress.get(id) || '',
                    connected: peerStatus.get(id) ?? false,
                  }))
                );
              },
            },
            this._eventStore,
            this._telemetryEmitter,
            this._logger
          );
          await this._explorerServer.start();

          // Wire EventBroadcaster to PacketHandler for real-time event streaming
          if (!this._telemetryEmitter) {
            // In standalone mode, pass the EventBroadcaster to PacketHandler
            const broadcaster = this._explorerServer.getBroadcaster();
            this._packetHandler.setEventBroadcaster(broadcaster);
            this._logger.info(
              { event: 'event_broadcaster_wired' },
              'EventBroadcaster wired to PacketHandler for live event streaming'
            );

            // Wire AccountManager to EventStore and EventBroadcaster (Story 19.3)
            if (this._accountManager) {
              this._accountManager.setEventStore(this._eventStore);
              this._accountManager.setEventBroadcaster(broadcaster);
              this._logger.info(
                { event: 'account_manager_standalone_wired' },
                'AccountManager wired to EventStore and EventBroadcaster for ACCOUNT_BALANCE events'
              );
            }

            // Wire SettlementExecutor to EventStore and EventBroadcaster for settlement events
            this._logger.debug(
              { hasSettlementExecutor: this._settlementExecutor !== null },
              'Checking SettlementExecutor for EventStore wiring'
            );
            if (this._settlementExecutor) {
              this._settlementExecutor.setEventStore(this._eventStore);
              this._settlementExecutor.setEventBroadcaster(broadcaster);
              this._logger.info(
                { event: 'settlement_executor_standalone_wired' },
                'SettlementExecutor wired to EventStore and EventBroadcaster for settlement events'
              );
            } else {
              this._logger.warn(
                { event: 'settlement_executor_not_available' },
                'SettlementExecutor not initialized - settlement events will not be stored'
              );
            }
          }

          const mode = this._telemetryEmitter
            ? 'connected to telemetry dashboard'
            : 'standalone mode';
          this._logger.info(
            {
              event: 'explorer_server_started',
              port: explorerPort,
              retentionDays,
              maxEvents,
              mode,
            },
            `Explorer server started in ${mode}`
          );
        } catch (error) {
          // Explorer failures should not prevent connector startup
          const errorMessage = error instanceof Error ? error.message : String(error);
          this._logger.warn(
            { event: 'explorer_start_failed', error: errorMessage },
            'Failed to start explorer (connector continues running)'
          );
        }
      } else {
        this._logger.info({ event: 'explorer_disabled' }, 'Explorer UI disabled by configuration');
      }

      // Connect BTP clients to all configured peers
      // Convert PeerConfig to Peer format
      const peerConnections: Promise<void>[] = [];
      for (const peerConfig of this._config.peers) {
        const peer: Peer = {
          id: peerConfig.id,
          url: peerConfig.url,
          authToken: peerConfig.authToken,
          connected: false,
          lastSeen: new Date(),
        };
        peerConnections.push(this._btpClientManager.addPeer(peer));
      }

      // Wait for all peer connection attempts (don't fail if some connections fail)
      // BTPClient will automatically retry failed connections in the background
      const peerResults = await Promise.allSettled(peerConnections);
      const failedPeers = peerResults.filter((r) => r.status === 'rejected');
      if (failedPeers.length > 0) {
        this._logger.warn(
          {
            event: 'peer_connection_failures',
            failedCount: failedPeers.length,
            totalPeers: this._config.peers.length,
          },
          'Some peer connections failed during startup (will retry in background)'
        );
      }

      const connectedPeers = this._btpClientManager.getPeerStatus();
      const connectedCount = Array.from(connectedPeers.values()).filter(Boolean).length;

      // Create payment channels for connected peers (if channel infrastructure is enabled)
      if (this._channelManager && this._paymentChannelSDK) {
        this._logger.info(
          { event: 'creating_payment_channels', connectedCount },
          'Creating payment channels for connected peers'
        );

        const channelCreationPromises: Promise<void>[] = [];
        for (const [peerId, connected] of connectedPeers.entries()) {
          if (!connected) {
            continue; // Skip disconnected peers
          }

          // Create channel creation promise (don't await - run in parallel)
          const channelPromise = (async () => {
            try {
              const tokenId = 'M2M'; // Use M2M token for test deployment
              const channelId = await this._channelManager!.ensureChannelExists(peerId, tokenId);
              this._logger.info(
                { event: 'payment_channel_ready', peerId, channelId },
                'Payment channel ready for peer'
              );
            } catch (error) {
              // Don't fail startup if channel creation fails
              const errorMessage = error instanceof Error ? error.message : String(error);
              this._logger.warn(
                { event: 'payment_channel_creation_failed', peerId, error: errorMessage },
                'Failed to create payment channel for peer (will retry on-demand)'
              );
            }
          })();

          channelCreationPromises.push(channelPromise);
        }

        // Wait for all channel creation attempts (but don't fail if some fail)
        await Promise.allSettled(channelCreationPromises);
        this._logger.info(
          { event: 'payment_channels_initialized' },
          'Payment channel creation completed'
        );
      }

      // Update health status to healthy after all components started
      this._updateHealthStatus();

      // Connect telemetry emitter and emit NODE_STATUS if enabled
      if (this._telemetryEmitter) {
        try {
          await this._telemetryEmitter.connect();
          this._logger.info({ event: 'telemetry_connected' }, 'Telemetry connected to dashboard');

          // Emit NODE_STATUS telemetry after successful connection
          this._logger.info({ event: 'preparing_node_status' }, 'Preparing NODE_STATUS telemetry');
          const routes = this._routingTable.getAllRoutes();
          const peers: PeerStatus[] = this._config.peers.map((peerConfig) => ({
            id: peerConfig.id,
            url: peerConfig.url,
            connected: connectedPeers.get(peerConfig.id) || false,
          }));

          this._logger.info(
            {
              event: 'emitting_node_status',
              routes: routes.length,
              peers: peers.length,
              health: this._healthStatus,
            },
            'Emitting NODE_STATUS telemetry'
          );
          this._telemetryEmitter.emitNodeStatus(routes, peers, this._healthStatus);
          this._logger.info(
            { event: 'telemetry_node_status_emitted', routes: routes.length, peers: peers.length },
            'NODE_STATUS telemetry emitted'
          );
        } catch (error) {
          // Telemetry failures should not prevent connector startup
          const errorMessage = error instanceof Error ? error.message : String(error);
          this._logger.warn(
            { event: 'telemetry_connect_failed', error: errorMessage },
            'Failed to connect telemetry (connector continues running)'
          );
        }
      }

      this._logger.info(
        {
          event: 'connector_ready',
          nodeId: this._config.nodeId,
          connectedPeers: connectedCount,
          totalPeers: this._config.peers.length,
          healthStatus: this._healthStatus,
        },
        'Connector node ready'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._logger.error(
        {
          event: 'connector_start_failed',
          nodeId: this._config.nodeId,
          error: errorMessage,
        },
        'Failed to start connector node'
      );
      this._healthStatus = 'unhealthy';
      throw error;
    }
  }

  /**
   * Stop connector and disconnect all peers
   * Gracefully shuts down all components
   */
  async stop(): Promise<void> {
    this._logger.info(
      {
        event: 'connector_stopping',
        nodeId: this._config.nodeId,
      },
      'Stopping connector node'
    );

    try {
      // Stop Aptos SDK auto-refresh if running
      if (this._aptosChannelSDK) {
        this._aptosChannelSDK.stopAutoRefresh();
        this._logger.info({ event: 'aptos_sdk_stopped' }, 'AptosChannelSDK auto-refresh stopped');
        this._aptosChannelSDK = null;
      }

      // Stop channel manager if running
      if (this._channelManager) {
        this._channelManager.stop();
        this._logger.info({ event: 'channel_manager_stopped' }, 'Channel manager stopped');
        this._channelManager = null;
      }

      // Clean up payment channel SDK
      if (this._paymentChannelSDK) {
        this._paymentChannelSDK.removeAllListeners();
        this._logger.info({ event: 'payment_channel_sdk_stopped' }, 'Payment channel SDK stopped');
        this._paymentChannelSDK = null;
      }

      // Stop explorer server if running (before health server)
      if (this._explorerServer) {
        await this._explorerServer.stop();
        this._logger.info({ event: 'explorer_server_stopped' }, 'Explorer server stopped');
        this._explorerServer = null;
      }

      // Close event store if initialized
      if (this._eventStore) {
        await this._eventStore.close();
        this._logger.info({ event: 'event_store_closed' }, 'Event store closed');
        this._eventStore = null;
      }

      // Disconnect telemetry emitter if enabled
      if (this._telemetryEmitter) {
        await this._telemetryEmitter.disconnect();
        this._logger.info({ event: 'telemetry_disconnected' }, 'Telemetry disconnected');
      }

      // Disconnect all BTP clients
      const peerIds = this._btpClientManager.getPeerIds();
      for (const peerId of peerIds) {
        await this._btpClientManager.removePeer(peerId);
      }

      // Stop admin server if running
      if (this._adminServer) {
        await this._adminServer.stop();
        this._logger.info({ event: 'admin_server_stopped' }, 'Admin API server stopped');
        this._adminServer = null;
      }

      // Stop health server
      await this._healthServer.stop();

      // Stop BTP server
      await this._btpServer.stop();

      this._logger.info(
        {
          event: 'connector_stopped',
          nodeId: this._config.nodeId,
        },
        'Connector node stopped'
      );

      this._healthStatus = 'starting'; // Reset to initial state
      this._btpServerStarted = false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._logger.error(
        {
          event: 'connector_stop_failed',
          nodeId: this._config.nodeId,
          error: errorMessage,
        },
        'Failed to stop connector node gracefully'
      );
      throw error;
    }
  }

  /**
   * Get connector health status (implements HealthStatusProvider interface)
   * @returns Current health status including connected peers and uptime
   */
  getHealthStatus(): HealthStatus {
    const peerStatus = this._btpClientManager.getPeerStatus();
    const peersConnected = Array.from(peerStatus.values()).filter(Boolean).length;
    const totalPeers = this._config.peers.length;
    const uptime = Math.floor((Date.now() - this._startTime.getTime()) / 1000);

    const healthStatus: HealthStatus = {
      status: this._healthStatus,
      uptime,
      peersConnected,
      totalPeers,
      timestamp: new Date().toISOString(),
      nodeId: this._config.nodeId,
      version: packageJson.version,
    };

    // Add explorer status if enabled
    if (this._explorerServer && this._eventStore) {
      healthStatus.explorer = {
        enabled: true,
        port: this._explorerServer.getPort(),
        eventCount: 0, // Will be fetched asynchronously if needed
        wsConnections: this._explorerServer.getBroadcaster().getClientCount(),
      };
    }

    return healthStatus;
  }

  /**
   * Update health status based on current peer connections
   * Called internally when connection state changes
   * @private
   */
  /**
   * Creates a NoOp AccountManager with stub methods for when TigerBeetle is unavailable.
   * All methods are no-ops that allow packets to flow without balance tracking.
   */
  private _createNoOpAccountManager(): AccountManager {
    const noOpAccountManager = {
      // Credit limit check - always allow (return null = no violation)
      checkCreditLimit: async () => null,
      wouldExceedCreditLimit: async () => false,

      // Balance operations - return zero balances
      getAccountBalance: async () => ({
        debitBalance: 0n,
        creditBalance: 0n,
        netBalance: 0n,
      }),

      // Account creation - no-op
      createPeerAccounts: async () => ({
        debitAccountId: 0n,
        creditAccountId: 0n,
      }),

      // Settlement recording - no-op
      recordSettlement: async () => {},
      recordPacketSettlement: async () => {},
      recordPacketTransfers: async () => {},

      // Event store/broadcaster wiring - no-op
      setEventStore: () => {},
      setEventBroadcaster: () => {},

      // Config getters
      get nodeId() {
        return 'noop';
      },
    };

    return noOpAccountManager as unknown as AccountManager;
  }

  private _updateHealthStatus(): void {
    // During startup phase (BTP server not listening yet)
    if (!this._btpServerStarted) {
      if (this._healthStatus !== 'starting') {
        this._logger.info(
          {
            event: 'health_status_changed',
            oldStatus: this._healthStatus,
            newStatus: 'starting',
            reason: 'BTP server not started',
          },
          'Health status changed'
        );
        this._healthStatus = 'starting';
      }
      return;
    }

    // If no peers configured, connector is healthy (standalone mode)
    const totalPeers = this._config.peers.length;
    if (totalPeers === 0) {
      if (this._healthStatus !== 'healthy') {
        this._logger.info(
          {
            event: 'health_status_changed',
            oldStatus: this._healthStatus,
            newStatus: 'healthy',
            reason: 'No peers configured (standalone mode)',
          },
          'Health status changed'
        );
        this._healthStatus = 'healthy';
      }
      return;
    }

    // Calculate connection percentage
    const peerStatus = this._btpClientManager.getPeerStatus();
    const connectedCount = Array.from(peerStatus.values()).filter(Boolean).length;
    const connectionPercentage = (connectedCount / totalPeers) * 100;

    // Determine new health status
    let newStatus: 'healthy' | 'unhealthy' | 'starting';
    let reason: string;

    if (connectionPercentage < 50) {
      newStatus = 'unhealthy';
      reason = `Only ${connectedCount}/${totalPeers} peers connected (<50%)`;
    } else {
      newStatus = 'healthy';
      reason = `${connectedCount}/${totalPeers} peers connected (≥50%)`;
    }

    // Log status changes
    if (this._healthStatus !== newStatus) {
      this._logger.info(
        { event: 'health_status_changed', oldStatus: this._healthStatus, newStatus, reason },
        'Health status changed'
      );
      this._healthStatus = newStatus;
    }
  }

  /**
   * Get routing table entries
   * @returns Array of current routing table entries
   */
  getRoutingTable(): RoutingTableEntry[] {
    return this._routingTable.getAllRoutes();
  }

  /**
   * Get Aptos Channel SDK instance
   * @returns IAptosChannelSDK if initialized, null otherwise
   */
  getAptosChannelSDK(): IAptosChannelSDK | null {
    return this._aptosChannelSDK;
  }
}
