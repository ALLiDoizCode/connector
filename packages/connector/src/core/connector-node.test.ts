/**
 * Unit tests for ConnectorNode
 * @packageDocumentation
 */

import { ConnectorNode } from './connector-node';
import { ConnectorConfig } from '../config/types';
import { RoutingTable } from '../routing/routing-table';
import { BTPClientManager } from '../btp/btp-client-manager';
import { BTPServer } from '../btp/btp-server';
import { PacketHandler } from './packet-handler';
import { Logger } from '../utils/logger';
import { RoutingTableEntry } from '@agent-runtime/shared';
import { ConfigLoader } from '../config/config-loader';
import { HealthServer } from '../http/health-server';

// Mock all dependencies
jest.mock('../routing/routing-table');
jest.mock('../btp/btp-client-manager');
jest.mock('../btp/btp-server');
jest.mock('./packet-handler');
jest.mock('../config/config-loader');
jest.mock('../http/health-server');

/**
 * Mock logger for testing
 */
const createMockLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    trace: jest.fn(),
    silent: jest.fn(),
    level: 'info',
    child: jest.fn().mockReturnThis(),
  }) as unknown as jest.Mocked<Logger>;

/**
 * Create test connector configuration
 */
const createTestConfig = (overrides?: Partial<ConnectorConfig>): ConnectorConfig => {
  const testPeer = {
    id: 'peerA',
    url: 'ws://connector-a:3000',
    authToken: 'secret-a',
  };

  const testRoute: RoutingTableEntry = {
    prefix: 'g.peerA',
    nextHop: 'peerA',
  };

  return {
    nodeId: 'connector-test',
    btpServerPort: 3000,
    environment: 'development',
    peers: [testPeer],
    routes: [testRoute],
    ...overrides,
  };
};

describe('ConnectorNode', () => {
  let connectorNode: ConnectorNode;
  let mockLogger: jest.Mocked<Logger>;
  let mockRoutingTable: jest.Mocked<RoutingTable>;
  let mockBTPClientManager: jest.Mocked<BTPClientManager>;
  let mockBTPServer: jest.Mocked<BTPServer>;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockHealthServer: jest.Mocked<HealthServer>;
  let config: ConnectorConfig;
  const testConfigPath = '/test/config.yaml';

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    config = createTestConfig();

    // Mock ConfigLoader to return our test config
    (ConfigLoader.loadConfig as jest.Mock) = jest.fn().mockReturnValue(config);

    // Create mocked instances
    mockRoutingTable = {
      lookup: jest.fn(),
      getAllRoutes: jest.fn().mockReturnValue(config.routes),
    } as unknown as jest.Mocked<RoutingTable>;

    mockBTPClientManager = {
      addPeer: jest.fn().mockResolvedValue(undefined),
      removePeer: jest.fn().mockResolvedValue(undefined),
      sendToPeer: jest.fn(),
      getPeerStatus: jest.fn().mockReturnValue(new Map([['peerA', true]])),
      getPeerIds: jest.fn().mockReturnValue(['peerA']),
      getConnectedPeerCount: jest.fn().mockReturnValue(1),
      getTotalPeerCount: jest.fn().mockReturnValue(1),
      getConnectionHealth: jest.fn().mockReturnValue(100),
      setPacketHandler: jest.fn(),
    } as unknown as jest.Mocked<BTPClientManager>;

    mockBTPServer = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BTPServer>;

    mockPacketHandler = {
      processPrepare: jest.fn(),
      setBTPServer: jest.fn(),
    } as unknown as jest.Mocked<PacketHandler>;

    mockHealthServer = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<HealthServer>;

    // Configure mocks to return our mocked instances
    (RoutingTable as jest.MockedClass<typeof RoutingTable>).mockImplementation(
      () => mockRoutingTable
    );
    (BTPClientManager as jest.MockedClass<typeof BTPClientManager>).mockImplementation(
      () => mockBTPClientManager
    );
    (BTPServer as jest.MockedClass<typeof BTPServer>).mockImplementation(() => mockBTPServer);
    (PacketHandler as jest.MockedClass<typeof PacketHandler>).mockImplementation(
      () => mockPacketHandler
    );
    (HealthServer as jest.MockedClass<typeof HealthServer>).mockImplementation(
      () => mockHealthServer
    );
  });

  describe('Constructor', () => {
    it('should create ConnectorNode with all components', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(connectorNode).toBeDefined();
      expect(connectorNode).toBeInstanceOf(ConnectorNode);
      expect(ConfigLoader.loadConfig).toHaveBeenCalledWith(testConfigPath);
      expect(mockLogger.child).toHaveBeenCalledWith({
        component: 'ConnectorNode',
        nodeId: 'connector-test',
      });
    });

    it('should initialize RoutingTable with config routes', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(RoutingTable).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ prefix: 'g.peerA', nextHop: 'peerA' })]),
        expect.anything() // child logger
      );
    });

    it('should initialize BTPClientManager with logger', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(BTPClientManager).toHaveBeenCalledWith(config.nodeId, expect.anything());
    });

    it('should initialize PacketHandler with dependencies', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(PacketHandler).toHaveBeenCalledWith(
        mockRoutingTable,
        mockBTPClientManager,
        config.nodeId,
        expect.anything(), // child logger
        null // telemetryEmitter (null when DASHBOARD_TELEMETRY_URL not set)
      );
    });

    it('should initialize BTPServer with PacketHandler', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(BTPServer).toHaveBeenCalledWith(
        expect.anything(), // child logger
        mockPacketHandler
      );
    });

    it('should initialize HealthServer with logger and provider', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(HealthServer).toHaveBeenCalledWith(
        expect.anything(), // child logger
        connectorNode // ConnectorNode implements HealthStatusProvider
      );
    });

    it('should log config_loaded and connector_initialized events', () => {
      // Arrange & Act
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'config_loaded',
          filePath: testConfigPath,
          nodeId: 'connector-test',
        }),
        expect.any(String)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_initialized',
          nodeId: 'connector-test',
          peersCount: 1,
          routesCount: 1,
        }),
        expect.any(String)
      );
    });
  });

  describe('start()', () => {
    beforeEach(() => {
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);
      jest.clearAllMocks(); // Clear constructor logs
    });

    it('should start BTP server first, then health server, then clients', async () => {
      // Arrange
      const startOrder: string[] = [];
      mockBTPServer.start.mockImplementation(async () => {
        startOrder.push('btp-server');
      });
      mockHealthServer.start.mockImplementation(async () => {
        startOrder.push('health-server');
      });
      mockBTPClientManager.addPeer.mockImplementation(async () => {
        startOrder.push('client');
      });

      // Act
      await connectorNode.start();

      // Assert
      expect(startOrder[0]).toBe('btp-server');
      expect(startOrder[1]).toBe('health-server');
      expect(startOrder[2]).toBe('client');
      expect(mockBTPServer.start).toHaveBeenCalledWith(3000);
      expect(mockHealthServer.start).toHaveBeenCalledWith(8080);
    });

    it('should connect all BTP clients in parallel', async () => {
      // Arrange
      const configWithMultiplePeers = createTestConfig({
        peers: [
          {
            id: 'peerA',
            url: 'ws://connector-a:3000',
            authToken: 'secret-a',
          },
          {
            id: 'peerB',
            url: 'ws://connector-b:3001',
            authToken: 'secret-b',
          },
        ],
      });
      (ConfigLoader.loadConfig as jest.Mock).mockReturnValue(configWithMultiplePeers);
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);
      jest.clearAllMocks();

      // Act
      await connectorNode.start();

      // Assert
      expect(mockBTPClientManager.addPeer).toHaveBeenCalledTimes(2);
      expect(mockBTPClientManager.addPeer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'peerA' })
      );
      expect(mockBTPClientManager.addPeer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'peerB' })
      );
    });

    it('should log connector_starting, btp_server_started, health_server_started, and connector_ready events', async () => {
      // Arrange & Act
      await connectorNode.start();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_starting',
          nodeId: 'connector-test',
        }),
        expect.any(String)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'btp_server_started',
          port: 3000,
        }),
        expect.any(String)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'health_server_started',
          port: 8080,
        }),
        expect.any(String)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_ready',
          nodeId: 'connector-test',
          connectedPeers: 1,
          totalPeers: 1,
        }),
        expect.any(String)
      );
    });

    it('should set status to healthy on successful start with all peers connected', async () => {
      // Arrange & Act
      await connectorNode.start();
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.status).toBe('healthy');
    });

    it('should log error and set status to unhealthy on start failure', async () => {
      // Arrange
      const testError = new Error('BTP server start failed');
      mockBTPServer.start.mockRejectedValue(testError);

      // Act & Assert
      await expect(connectorNode.start()).rejects.toThrow('BTP server start failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_start_failed',
          nodeId: 'connector-test',
          error: 'BTP server start failed',
        }),
        expect.any(String)
      );

      const healthStatus = connectorNode.getHealthStatus();
      expect(healthStatus.status).toBe('unhealthy');
    });
  });

  describe('stop()', () => {
    beforeEach(() => {
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);
      jest.clearAllMocks();
    });

    it('should disconnect all BTP clients', async () => {
      // Arrange
      mockBTPClientManager.getPeerIds.mockReturnValue(['peerA', 'peerB']);

      // Act
      await connectorNode.stop();

      // Assert
      expect(mockBTPClientManager.removePeer).toHaveBeenCalledTimes(2);
      expect(mockBTPClientManager.removePeer).toHaveBeenCalledWith('peerA');
      expect(mockBTPClientManager.removePeer).toHaveBeenCalledWith('peerB');
    });

    it('should stop health server and BTP server after disconnecting clients', async () => {
      // Arrange
      const stopOrder: string[] = [];
      mockBTPClientManager.removePeer.mockImplementation(async () => {
        stopOrder.push('client');
      });
      mockHealthServer.stop.mockImplementation(async () => {
        stopOrder.push('health-server');
      });
      mockBTPServer.stop.mockImplementation(async () => {
        stopOrder.push('btp-server');
      });

      // Act
      await connectorNode.stop();

      // Assert
      expect(stopOrder[0]).toBe('client');
      expect(stopOrder).toContain('health-server');
      expect(stopOrder).toContain('btp-server');
      expect(mockHealthServer.stop).toHaveBeenCalledTimes(1);
      expect(mockBTPServer.stop).toHaveBeenCalledTimes(1);
    });

    it('should log connector_stopping and connector_stopped events', async () => {
      // Arrange & Act
      await connectorNode.stop();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_stopping',
          nodeId: 'connector-test',
        }),
        expect.any(String)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_stopped',
          nodeId: 'connector-test',
        }),
        expect.any(String)
      );
    });

    it('should reset status to starting after successful stop', async () => {
      // Arrange
      await connectorNode.start();
      jest.clearAllMocks();

      // Act
      await connectorNode.stop();
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.status).toBe('starting');
      expect(healthStatus.peersConnected).toBe(1); // BTPClientManager mock still returns 1
    });

    it('should log error on stop failure', async () => {
      // Arrange
      const testError = new Error('Failed to disconnect peer');
      mockBTPClientManager.removePeer.mockRejectedValue(testError);

      // Act & Assert
      await expect(connectorNode.stop()).rejects.toThrow('Failed to disconnect peer');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'connector_stop_failed',
          nodeId: 'connector-test',
          error: 'Failed to disconnect peer',
        }),
        expect.any(String)
      );
    });
  });

  describe('getHealthStatus() - Task 8: Health Integration Tests', () => {
    beforeEach(() => {
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);
      jest.clearAllMocks();
    });

    it('Test 1: ConnectorNode implements HealthStatusProvider interface', () => {
      // Arrange & Act
      const healthStatus = connectorNode.getHealthStatus();

      // Assert - should return HealthStatus object with all required fields
      expect(healthStatus).toBeDefined();
      expect(healthStatus).toHaveProperty('status');
      expect(healthStatus).toHaveProperty('uptime');
      expect(healthStatus).toHaveProperty('peersConnected');
      expect(healthStatus).toHaveProperty('totalPeers');
      expect(healthStatus).toHaveProperty('timestamp');
      expect(healthStatus).toHaveProperty('nodeId');
      expect(healthStatus).toHaveProperty('version');

      // Verify types
      expect(typeof healthStatus.status).toBe('string');
      expect(typeof healthStatus.uptime).toBe('number');
      expect(typeof healthStatus.peersConnected).toBe('number');
      expect(typeof healthStatus.totalPeers).toBe('number');
      expect(typeof healthStatus.timestamp).toBe('string');
      expect(typeof healthStatus.nodeId).toBe('string');
      expect(typeof healthStatus.version).toBe('string');
    });

    it('Test 2: Health status is "starting" during initialization', () => {
      // Arrange & Act - before start() is called
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.status).toBe('starting');
      expect(healthStatus.nodeId).toBe('connector-test');
    });

    it('Test 3: Health status is "healthy" when all peers connected (100%)', async () => {
      // Arrange
      mockBTPClientManager.getPeerStatus.mockReturnValue(new Map([['peerA', true]]));

      // Act
      await connectorNode.start();
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.status).toBe('healthy');
      expect(healthStatus.peersConnected).toBe(1);
      expect(healthStatus.totalPeers).toBe(1);
    });

    it('Test 4: Health status is "unhealthy" when <50% peers connected', async () => {
      // Arrange - Configure 4 peers, only 1 connected (25%)
      const configWithManyPeers = createTestConfig({
        peers: [
          { id: 'peer1', url: 'ws://p1:3000', authToken: 'token1' },
          { id: 'peer2', url: 'ws://p2:3000', authToken: 'token2' },
          { id: 'peer3', url: 'ws://p3:3000', authToken: 'token3' },
          { id: 'peer4', url: 'ws://p4:3000', authToken: 'token4' },
        ],
      });
      (ConfigLoader.loadConfig as jest.Mock).mockReturnValue(configWithManyPeers);
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Mock only 1 out of 4 peers connected
      mockBTPClientManager.getPeerStatus.mockReturnValue(
        new Map([
          ['peer1', true],
          ['peer2', false],
          ['peer3', false],
          ['peer4', false],
        ])
      );

      // Act
      jest.clearAllMocks();
      await connectorNode.start();
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.status).toBe('unhealthy');
      expect(healthStatus.peersConnected).toBe(1);
      expect(healthStatus.totalPeers).toBe(4);
    });

    it('Test 5: Uptime increases over time', async () => {
      // Arrange
      await connectorNode.start();

      // Act - Get initial uptime
      const healthStatus1 = connectorNode.getHealthStatus();
      const uptime1 = healthStatus1.uptime;

      // Wait 1100ms (just over 1 second to ensure uptime counter increases)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Get uptime again
      const healthStatus2 = connectorNode.getHealthStatus();
      const uptime2 = healthStatus2.uptime;

      // Assert - uptime is in seconds, so should increase by at least 1
      expect(uptime2).toBeGreaterThan(uptime1);
      expect(uptime2 - uptime1).toBeGreaterThanOrEqual(1);
    });

    it('Test 6: Health server starts and stops with ConnectorNode', async () => {
      // Arrange & Act - Start
      await connectorNode.start();

      // Assert - Health server should have been started
      expect(mockHealthServer.start).toHaveBeenCalledTimes(1);
      expect(mockHealthServer.start).toHaveBeenCalledWith(8080);

      // Act - Stop
      await connectorNode.stop();

      // Assert - Health server should have been stopped
      expect(mockHealthServer.stop).toHaveBeenCalledTimes(1);
    });

    it('Test 7: Health status changes logged at INFO level', async () => {
      // Arrange - Start with peers disconnected (<50%)
      const configWith2Peers = createTestConfig({
        peers: [
          { id: 'peer1', url: 'ws://p1:3000', authToken: 'token1' },
          { id: 'peer2', url: 'ws://p2:3000', authToken: 'token2' },
        ],
      });
      (ConfigLoader.loadConfig as jest.Mock).mockReturnValue(configWith2Peers);
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      // Mock only 1 out of 2 peers connected (50% - should be healthy at boundary)
      mockBTPClientManager.getPeerStatus.mockReturnValue(
        new Map([
          ['peer1', true],
          ['peer2', false],
        ])
      );
      jest.clearAllMocks();

      // Act - Start connector (should trigger health status change from 'starting' to 'unhealthy')
      await connectorNode.start();

      // Assert - Should log health_status_changed event at INFO level
      const healthStatusChangedLogs = (mockLogger.info as jest.Mock).mock.calls.filter(
        (call) => call[0]?.event === 'health_status_changed'
      );

      expect(healthStatusChangedLogs.length).toBeGreaterThan(0);
    });

    it('Test 8: Health status "healthy" when no peers configured (standalone mode)', async () => {
      // Arrange - Configure connector with no peers
      const configNoPeers = createTestConfig({
        peers: [],
      });
      (ConfigLoader.loadConfig as jest.Mock).mockReturnValue(configNoPeers);
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);

      mockBTPClientManager.getPeerStatus.mockReturnValue(new Map());
      jest.clearAllMocks();

      // Act
      await connectorNode.start();
      const healthStatus = connectorNode.getHealthStatus();

      // Assert - Standalone mode should be healthy
      expect(healthStatus.status).toBe('healthy');
      expect(healthStatus.peersConnected).toBe(0);
      expect(healthStatus.totalPeers).toBe(0);
    });

    it('Test 9: Health status includes nodeId and version from package.json', () => {
      // Arrange & Act
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.nodeId).toBe('connector-test');
      expect(healthStatus.version).toBeDefined();
      expect(typeof healthStatus.version).toBe('string');
    });

    it('Test 10: Timestamp is valid ISO 8601 format', () => {
      // Arrange & Act
      const healthStatus = connectorNode.getHealthStatus();

      // Assert
      expect(healthStatus.timestamp).toBeDefined();
      expect(() => new Date(healthStatus.timestamp)).not.toThrow();

      const timestamp = new Date(healthStatus.timestamp);
      expect(timestamp.toISOString()).toBe(healthStatus.timestamp);
    });
  });

  describe('getRoutingTable()', () => {
    beforeEach(() => {
      connectorNode = new ConnectorNode(testConfigPath, mockLogger);
    });

    it('should return routing table entries', () => {
      // Arrange
      const expectedRoutes: RoutingTableEntry[] = [
        { prefix: 'g.peerA', nextHop: 'peerA' },
        { prefix: 'g.peerB', nextHop: 'peerB' },
      ];
      mockRoutingTable.getAllRoutes.mockReturnValue(expectedRoutes);

      // Act
      const routes = connectorNode.getRoutingTable();

      // Assert
      expect(routes).toEqual(expectedRoutes);
      expect(mockRoutingTable.getAllRoutes).toHaveBeenCalledTimes(1);
    });
  });
});
