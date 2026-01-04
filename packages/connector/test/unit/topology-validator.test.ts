/**
 * Unit Tests for TopologyValidator
 * Tests graph algorithms: disconnected nodes, reachability, circular dependencies
 */

import { TopologyValidator } from '../../src/config/topology-validator';
import { ConnectorConfig } from '../../src/config/types';

describe('TopologyValidator', () => {
  describe('detectDisconnectedNodes', () => {
    it('should return empty array for fully connected graph', () => {
      const configs = new Map<string, ConnectorConfig>([
        [
          'node-a',
          {
            nodeId: 'node-a',
            btpServerPort: 3000,
            environment: 'development',
            peers: [{ id: 'node-b', url: 'ws://node-b:3001', authToken: 'secret' }],
            routes: [],
          },
        ],
        [
          'node-b',
          {
            nodeId: 'node-b',
            btpServerPort: 3001,
            environment: 'development',
            peers: [{ id: 'node-a', url: 'ws://node-a:3000', authToken: 'secret' }],
            routes: [],
          },
        ],
      ]);

      const result = TopologyValidator.detectDisconnectedNodes(configs);
      expect(result).toEqual([]);
    });

    it('should detect isolated node', () => {
      const configs = new Map<string, ConnectorConfig>([
        [
          'node-a',
          {
            nodeId: 'node-a',
            btpServerPort: 3000,
            environment: 'development',
            peers: [{ id: 'node-b', url: 'ws://node-b:3001', authToken: 'secret' }],
            routes: [],
          },
        ],
        [
          'node-b',
          {
            nodeId: 'node-b',
            btpServerPort: 3001,
            environment: 'development',
            peers: [{ id: 'node-a', url: 'ws://node-a:3000', authToken: 'secret' }],
            routes: [],
          },
        ],
        [
          'node-c',
          {
            nodeId: 'node-c',
            btpServerPort: 3002,
            environment: 'development',
            peers: [],
            routes: [],
          },
        ],
      ]);

      const result = TopologyValidator.detectDisconnectedNodes(configs);
      expect(result).toContain('node-c');
    });
  });

  describe('detectInvalidPeerReferences', () => {
    it('should detect peer referencing non-existent node', () => {
      const config: ConnectorConfig = {
        nodeId: 'node-a',
        btpServerPort: 3000,
        environment: 'development',
        peers: [{ id: 'ghost-node', url: 'ws://ghost:3000', authToken: 'secret' }],
        routes: [],
      };

      const allNodeIds = new Set(['node-a', 'node-b']);
      const result = TopologyValidator.detectInvalidPeerReferences(config, allNodeIds);

      expect(result).toContain('ghost-node');
    });

    it('should return empty array for valid peer references', () => {
      const config: ConnectorConfig = {
        nodeId: 'node-a',
        btpServerPort: 3000,
        environment: 'development',
        peers: [{ id: 'node-b', url: 'ws://node-b:3001', authToken: 'secret' }],
        routes: [],
      };

      const allNodeIds = new Set(['node-a', 'node-b']);
      const result = TopologyValidator.detectInvalidPeerReferences(config, allNodeIds);

      expect(result).toEqual([]);
    });
  });

  describe('validateReachability', () => {
    it('should warn about unreachable route', () => {
      const configs = new Map<string, ConnectorConfig>([
        [
          'node-a',
          {
            nodeId: 'node-a',
            btpServerPort: 3000,
            environment: 'development',
            peers: [],
            routes: [{ prefix: 'g.dest', nextHop: 'node-b' }],
          },
        ],
      ]);

      const warnings = TopologyValidator.validateReachability(configs);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('unreachable');
    });
  });

  describe('validateTopology', () => {
    it('should validate hub-and-spoke topology successfully', () => {
      const configs = new Map<string, ConnectorConfig>([
        [
          'hub',
          {
            nodeId: 'hub',
            btpServerPort: 3000,
            environment: 'development',
            peers: [],
            routes: [
              { prefix: 'g.spoke1', nextHop: 'spoke-1' },
              { prefix: 'g.spoke2', nextHop: 'spoke-2' },
            ],
          },
        ],
        [
          'spoke-1',
          {
            nodeId: 'spoke-1',
            btpServerPort: 3001,
            environment: 'development',
            peers: [{ id: 'hub', url: 'ws://hub:3000', authToken: 'secret' }],
            routes: [{ prefix: 'g.spoke2', nextHop: 'hub' }],
          },
        ],
        [
          'spoke-2',
          {
            nodeId: 'spoke-2',
            btpServerPort: 3002,
            environment: 'development',
            peers: [{ id: 'hub', url: 'ws://hub:3000', authToken: 'secret' }],
            routes: [{ prefix: 'g.spoke1', nextHop: 'hub' }],
          },
        ],
      ]);

      const result = TopologyValidator.validateTopology(configs);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
