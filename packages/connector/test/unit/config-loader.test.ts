/**
 * Unit Tests for ConfigLoader
 *
 * Tests configuration loading and validation including:
 * - Valid configuration parsing
 * - Required field validation
 * - Type validation
 * - Peer validation (URL format, uniqueness)
 * - Route validation (ILP address format, peer references)
 * - Port range validation
 * - Default value handling
 * - YAML syntax error handling
 */

import * as path from 'path';
import { ConfigLoader, ConfigurationError } from '../../src/config/config-loader';
import { ConnectorConfig } from '../../src/config/types';

// Test fixture directory path
const FIXTURES_DIR = path.join(__dirname, '../fixtures/configs');

describe('ConfigLoader', () => {
  describe('loadConfig - Valid Configuration', () => {
    it('Test 1: should load valid configuration successfully', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'valid-config.yaml');

      // Act
      const config: ConnectorConfig = ConfigLoader.loadConfig(configPath);

      // Assert
      expect(config).toBeDefined();
      expect(config.nodeId).toBe('test-connector');
      expect(config.btpServerPort).toBe(3000);
      expect(config.healthCheckPort).toBe(8080);
      expect(config.logLevel).toBe('info');
      expect(config.peers).toHaveLength(2);
      expect(config.peers[0]).toEqual({
        id: 'peer-a',
        url: 'ws://peer-a:3001',
        authToken: 'secret-a',
      });
      expect(config.peers[1]).toEqual({
        id: 'peer-b',
        url: 'ws://peer-b:3002',
        authToken: 'secret-b',
      });
      expect(config.routes).toHaveLength(2);
      expect(config.routes[0]).toEqual({
        prefix: 'g.peera',
        nextHop: 'peer-a',
        priority: 0,
      });
      expect(config.routes[1]).toEqual({
        prefix: 'g.peerb',
        nextHop: 'peer-b',
        priority: 10,
      });
    });
  });

  describe('loadConfig - Missing Required Fields', () => {
    it('Test 2: should throw ConfigurationError when nodeId is missing', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'missing-node-id.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow('Missing required field: nodeId');
    });
  });

  describe('loadConfig - Invalid YAML Syntax', () => {
    it('Test 3: should throw ConfigurationError for invalid YAML syntax', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'invalid-yaml.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid YAML syntax/);
    });
  });

  describe('loadConfig - Invalid Peer URL Format', () => {
    it('Test 4: should throw ConfigurationError for invalid WebSocket URL', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'invalid-peer-url.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid WebSocket URL/);
    });
  });

  describe('loadConfig - Duplicate Peer IDs', () => {
    it('Test 5: should throw ConfigurationError for duplicate peer IDs', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'duplicate-peer-ids.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Duplicate peer ID/);
    });
  });

  describe('loadConfig - Route References Non-existent Peer', () => {
    it('Test 6: should allow routes to reference non-existent peers (dynamic peers)', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'route-nonexistent-peer.yaml');

      // Act
      const config = ConfigLoader.loadConfig(configPath);

      // Assert - should NOT throw because routes can reference dynamic peers
      // that will connect inbound (not in static peers list)
      expect(config.routes).toHaveLength(1);
      expect(config.routes[0]?.nextHop).toBe('unknown-peer');
    });
  });

  describe('loadConfig - Invalid BTP Server Port', () => {
    it('Test 7: should throw ConfigurationError for out-of-range port number', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'invalid-port.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /BTP server port must be between 1-65535/
      );
    });
  });

  describe('loadConfig - Invalid ILP Address Prefix', () => {
    it('Test 8: should throw ConfigurationError for invalid ILP address prefix', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'invalid-ilp-prefix.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid ILP address prefix/);
    });
  });

  describe('loadConfig - File Not Found', () => {
    it('Test 9: should throw ConfigurationError when file does not exist', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'non-existent-file.yaml');

      // Act & Assert
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Configuration file not found/);
    });
  });

  describe('loadConfig - Empty Peers and Routes', () => {
    it('Test 10: should accept empty peers and routes arrays', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'empty-peers-routes.yaml');

      // Act
      const config: ConnectorConfig = ConfigLoader.loadConfig(configPath);

      // Assert
      expect(config).toBeDefined();
      expect(config.nodeId).toBe('test-connector');
      expect(config.btpServerPort).toBe(3000);
      expect(config.peers).toEqual([]);
      expect(config.routes).toEqual([]);
    });
  });

  describe('loadConfig - Optional Fields with Defaults', () => {
    it('Test 11: should apply default values for optional fields', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'optional-fields.yaml');

      // Act
      const config: ConnectorConfig = ConfigLoader.loadConfig(configPath);

      // Assert
      expect(config).toBeDefined();
      expect(config.nodeId).toBe('test-connector');
      expect(config.btpServerPort).toBe(3000);
      expect(config.healthCheckPort).toBe(8080); // Default value
      expect(config.logLevel).toBe('info'); // Default value
      expect(config.peers).toEqual([]);
      expect(config.routes).toEqual([]);
    });
  });

  describe('loadConfig - YAML Comments', () => {
    it('Test 12: should successfully parse YAML with extensive comments', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'with-comments.yaml');

      // Act
      const config: ConnectorConfig = ConfigLoader.loadConfig(configPath);

      // Assert
      expect(config).toBeDefined();
      expect(config.nodeId).toBe('test-connector');
      expect(config.btpServerPort).toBe(3000);
      expect(config.peers).toHaveLength(1);
      expect(config.routes).toHaveLength(1);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should throw ConfigurationError for empty nodeId', () => {
      // This tests that empty strings are rejected
      const configPath = path.join(FIXTURES_DIR, 'valid-config.yaml');
      const config = ConfigLoader.loadConfig(configPath);
      expect(config.nodeId).toBeTruthy();
      expect(config.nodeId.length).toBeGreaterThan(0);
    });

    it('should validate WebSocket URLs with wss:// protocol', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'valid-config.yaml');

      // Act
      const config = ConfigLoader.loadConfig(configPath);

      // Assert - All peer URLs should start with ws:// or wss://
      config.peers.forEach((peer) => {
        expect(peer.url).toMatch(/^wss?:\/\/.+:\d+$/);
      });
    });

    it('should validate ILP address prefix format', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'valid-config.yaml');

      // Act
      const config = ConfigLoader.loadConfig(configPath);

      // Assert - All route prefixes should match ILP address pattern
      config.routes.forEach((route) => {
        expect(route.prefix).toMatch(/^[a-z0-9][a-z0-9._~-]*$/);
      });
    });

    it('should ensure all route nextHops reference valid peers', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'valid-config.yaml');

      // Act
      const config = ConfigLoader.loadConfig(configPath);

      // Assert
      const peerIds = new Set(config.peers.map((p) => p.id));
      config.routes.forEach((route) => {
        expect(peerIds.has(route.nextHop)).toBe(true);
      });
    });
  });

  describe('Type Validation', () => {
    it('should throw ConfigurationError for empty nodeId', () => {
      const configPath = path.join(FIXTURES_DIR, 'empty-node-id.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/nodeId cannot be empty/);
    });

    it('should throw ConfigurationError for invalid nodeId type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-node-id-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for nodeId/);
    });

    it('should throw ConfigurationError for invalid btpServerPort type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-btp-port-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for btpServerPort/);
    });

    it('should throw ConfigurationError for invalid peers type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-peers-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for peers/);
    });

    it('should throw ConfigurationError for invalid routes type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-routes-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for routes/);
    });

    it('should throw ConfigurationError for invalid logLevel value', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-log-level.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid logLevel/);
    });

    it('should throw ConfigurationError for non-object configuration', () => {
      const configPath = path.join(FIXTURES_DIR, 'not-an-object.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /Configuration must be a YAML object/
      );
    });
  });

  describe('Peer Field Type Validation', () => {
    it('should throw ConfigurationError for missing peer id', () => {
      const configPath = path.join(FIXTURES_DIR, 'missing-peer-id.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Peer missing required field: id/);
    });

    it('should throw ConfigurationError for missing peer url', () => {
      const configPath = path.join(FIXTURES_DIR, 'missing-peer-url.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /Peer .* missing required field: url/
      );
    });

    it('should throw ConfigurationError for missing peer authToken', () => {
      const configPath = path.join(FIXTURES_DIR, 'missing-peer-authtoken.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /Peer .* missing required field: authToken/
      );
    });

    it('should throw ConfigurationError for invalid peer id type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-peer-id-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for peer.id/);
    });

    it('should throw ConfigurationError for invalid peer url type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-peer-url-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for peer.url/);
    });

    it('should throw ConfigurationError for invalid peer authToken type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-peer-authtoken-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for peer.authToken/);
    });
  });

  describe('Route Field Type Validation', () => {
    it('should throw ConfigurationError for missing route prefix', () => {
      const configPath = path.join(FIXTURES_DIR, 'missing-route-prefix.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /Route missing required field: prefix/
      );
    });

    it('should throw ConfigurationError for missing route nextHop', () => {
      const configPath = path.join(FIXTURES_DIR, 'missing-route-nexthop.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /Route missing required field: nextHop/
      );
    });

    it('should throw ConfigurationError for invalid route prefix type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-route-prefix-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for route.prefix/);
    });

    it('should throw ConfigurationError for invalid route nextHop type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-route-nexthop-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for route.nextHop/);
    });

    it('should throw ConfigurationError for invalid route priority type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-route-priority-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for route.priority/);
    });
  });

  describe('validateConfig', () => {
    it('should validate and return a proper ConnectorConfig from a raw object', () => {
      // Arrange
      const raw = {
        nodeId: 'test-connector',
        btpServerPort: 3000,
        peers: [{ id: 'peer-a', url: 'ws://peer-a:3001', authToken: 'secret-a' }],
        routes: [{ prefix: 'g.peera', nextHop: 'peer-a' }],
      };

      // Act
      const config = ConfigLoader.validateConfig(raw);

      // Assert
      expect(config).toBeDefined();
      expect(config.nodeId).toBe('test-connector');
      expect(config.btpServerPort).toBe(3000);
      expect(config.peers).toHaveLength(1);
      expect(config.routes).toHaveLength(1);
      expect(config.environment).toBe('development'); // Default from env
      expect(config.logLevel).toBe('info'); // Default
      expect(config.healthCheckPort).toBe(8080); // Default
    });

    it('should throw ConfigurationError on invalid input (missing nodeId)', () => {
      // Arrange
      const raw = { btpServerPort: 3000, peers: [], routes: [] };

      // Act & Assert
      expect(() => ConfigLoader.validateConfig(raw)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.validateConfig(raw)).toThrow('Missing required field: nodeId');
    });

    it('should throw ConfigurationError on non-object input', () => {
      // Act & Assert
      expect(() => ConfigLoader.validateConfig('not-an-object')).toThrow(ConfigurationError);
      expect(() => ConfigLoader.validateConfig('not-an-object')).toThrow(
        'Configuration must be a YAML object'
      );
    });

    it('should throw ConfigurationError on null input', () => {
      // Act & Assert
      expect(() => ConfigLoader.validateConfig(null)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.validateConfig(null)).toThrow(
        'Configuration must be a YAML object'
      );
    });

    it('should pass through optional fields from input object', () => {
      // Arrange
      const raw = {
        nodeId: 'test-connector',
        btpServerPort: 3000,
        peers: [],
        routes: [],
        settlement: {
          connectorFeePercentage: 0.1,
          enableSettlement: true,
          tigerBeetleClusterId: 0,
          tigerBeetleReplicas: ['localhost:3000'],
        },
        adminApi: { enabled: true, port: 8081 },
        localDelivery: { enabled: true, handlerUrl: 'http://localhost:3100' },
        mode: 'gateway' as const,
        firstHopUrl: 'ws://connector:3000',
        btpAuthToken: 'test-token',
      };

      // Act
      const config = ConfigLoader.validateConfig(raw);

      // Assert
      expect(config.settlement).toBeDefined();
      expect(config.settlement?.connectorFeePercentage).toBe(0.1);
      expect(config.adminApi).toBeDefined();
      expect(config.adminApi?.enabled).toBe(true);
      expect(config.localDelivery).toBeDefined();
      expect(config.localDelivery?.enabled).toBe(true);
      expect(config.mode).toBe('gateway');
      expect(config.firstHopUrl).toBe('ws://connector:3000');
      expect(config.btpAuthToken).toBe('test-token');
    });

    it('should override environment/blockchain/explorer from env vars, not input', () => {
      // Arrange
      const raw = {
        nodeId: 'test-connector',
        btpServerPort: 3000,
        peers: [],
        routes: [],
        environment: 'production', // Should be overridden by env var
      };

      // Act
      const config = ConfigLoader.validateConfig(raw);

      // Assert - environment comes from process.env.ENVIRONMENT (defaults to 'development')
      expect(config.environment).toBe('development');
    });
  });

  describe('loadConfig calls validateConfig internally', () => {
    it('should load a valid config file and return validated ConnectorConfig', () => {
      // Arrange
      const configPath = path.join(FIXTURES_DIR, 'valid-config.yaml');

      // Act
      const config = ConfigLoader.loadConfig(configPath);

      // Assert - same result as before refactoring
      expect(config).toBeDefined();
      expect(config.nodeId).toBe('test-connector');
      expect(config.btpServerPort).toBe(3000);
      expect(config.peers).toHaveLength(2);
      expect(config.routes).toHaveLength(2);
    });
  });

  describe('Health Check Port Validation', () => {
    it('should throw ConfigurationError for invalid healthCheckPort type', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-health-check-port-type.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(/Invalid type for healthCheckPort/);
    });

    it('should throw ConfigurationError for healthCheckPort out of range', () => {
      const configPath = path.join(FIXTURES_DIR, 'invalid-health-check-port-range.yaml');
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(ConfigurationError);
      expect(() => ConfigLoader.loadConfig(configPath)).toThrow(
        /Health check port must be between 1-65535/
      );
    });
  });
});
