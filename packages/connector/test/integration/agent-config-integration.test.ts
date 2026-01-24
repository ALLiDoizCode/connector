/**
 * Integration tests for Agent Configuration Flow
 *
 * Tests the end-to-end flow from YAML configuration file
 * to AgentNode initialization with all components.
 */

// Mock the ESM-only @toon-format/toon package
jest.mock('@toon-format/toon', () => ({
  encode: (input: unknown) => JSON.stringify(input),
  decode: (input: string) => JSON.parse(input),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { getPublicKey } from 'nostr-tools';
import {
  AgentConfigLoader,
  AgentConfigurationError,
  AgentYamlConfig,
} from '../../src/config/agent-config';
import { AgentNode } from '../../src/agent/agent-node';

// Test fixtures
const TEST_PRIVATE_KEY = 'a'.repeat(64);
const TEST_PUBLIC_KEY = getPublicKey(Buffer.from(TEST_PRIVATE_KEY, 'hex'));
const FOLLOW_PUBKEY_1 = 'b'.repeat(64);
const FOLLOW_PUBKEY_2 = 'c'.repeat(64);

describe('Agent Configuration Integration', () => {
  let tempDir: string;
  let configPath: string;

  beforeAll(() => {
    // Create temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
    configPath = path.join(tempDir, 'agent-config.yaml');
  });

  afterAll(() => {
    // Clean up temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to write a YAML config to the temp file
   */
  function writeConfig(config: AgentYamlConfig): void {
    fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
  }

  /**
   * Helper to create a valid test configuration
   */
  function createTestConfig(overrides: Partial<AgentYamlConfig> = {}): AgentYamlConfig {
    return {
      agent: {
        privateKey: TEST_PRIVATE_KEY,
        ...overrides.agent,
      },
      database: {
        path: ':memory:',
        maxSizeBytes: 10 * 1024 * 1024, // 10MB for testing
        ...overrides.database,
      },
      pricing: {
        noteStorage: '100',
        followUpdate: '50',
        deletion: '10',
        queryBase: '200',
        queryPerResult: '5',
        ...overrides.pricing,
      },
      follows: overrides.follows ?? [
        {
          pubkey: FOLLOW_PUBKEY_1,
          ilpAddress: 'g.agent.alice',
          petname: 'alice',
        },
        {
          pubkey: FOLLOW_PUBKEY_2,
          ilpAddress: 'g.agent.bob',
          petname: 'bob',
        },
      ],
      handlers: {
        enableNoteHandler: true,
        enableFollowHandler: true,
        enableDeleteHandler: true,
        enableQueryHandler: true,
        ...overrides.handlers,
      },
      subscriptions: {
        maxPerPeer: 5,
        ...overrides.subscriptions,
      },
    };
  }

  // ==========================================================================
  // End-to-End Flow Tests
  // ==========================================================================
  describe('Full Configuration Flow', () => {
    it('should load config file and create AgentNode successfully', async () => {
      // Step 1: Write test config to file
      const config = createTestConfig();
      writeConfig(config);

      // Step 2: Load config from file
      const yamlConfig = AgentConfigLoader.loadConfig(configPath);

      // Step 3: Convert to AgentNodeConfig
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      // Step 4: Create AgentNode
      const node = new AgentNode(nodeConfig);

      // Step 5: Verify AgentNode initializes correctly
      expect(node.isInitialized).toBe(false);
      await node.initialize();
      expect(node.isInitialized).toBe(true);

      // Step 6: Verify agent pubkey
      expect(node.agentPubkey).toBe(TEST_PUBLIC_KEY);

      // Cleanup
      await node.shutdown();
    });

    it('should load follows into FollowGraphRouter', async () => {
      // Create config with follows
      const config = createTestConfig({
        follows: [
          { pubkey: FOLLOW_PUBKEY_1, ilpAddress: 'g.agent.alice', petname: 'alice' },
          { pubkey: FOLLOW_PUBKEY_2, ilpAddress: 'g.agent.bob.query' },
        ],
      });
      writeConfig(config);

      // Load and convert config
      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      // Create and initialize AgentNode
      const node = new AgentNode(nodeConfig);
      await node.initialize();

      // Load follows into router
      AgentConfigLoader.loadFollowsToRouter(yamlConfig.follows, node.followGraphRouter);

      // Verify follows loaded
      const router = node.followGraphRouter;
      expect(router.getFollowCount()).toBe(2);

      // Verify individual follows
      const aliceFollow = router.getFollowByPubkey(FOLLOW_PUBKEY_1);
      expect(aliceFollow).toBeDefined();
      expect(aliceFollow?.ilpAddress).toBe('g.agent.alice');
      expect(aliceFollow?.petname).toBe('alice');

      const bobFollow = router.getFollowByPubkey(FOLLOW_PUBKEY_2);
      expect(bobFollow).toBeDefined();
      expect(bobFollow?.ilpAddress).toBe('g.agent.bob.query');

      // Verify routing works
      expect(router.hasRouteTo('g.agent.alice')).toBe(true);
      expect(router.hasRouteTo('g.agent.alice.sub')).toBe(true);
      expect(router.hasRouteTo('g.agent.bob.query')).toBe(true);
      expect(router.getNextHop('g.agent.alice')).toBe(FOLLOW_PUBKEY_1);

      await node.shutdown();
    });

    it('should apply pricing configuration correctly', async () => {
      // Create config with specific pricing
      const config = createTestConfig({
        pricing: {
          noteStorage: '1000',
          followUpdate: '500',
          deletion: '100',
          queryBase: '2000',
          queryPerResult: '50',
        },
      });
      writeConfig(config);

      // Load and convert config
      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      // Verify pricing converted to bigint
      expect(nodeConfig.pricing.noteStorage).toBe(1000n);
      expect(nodeConfig.pricing.followUpdate).toBe(500n);
      expect(nodeConfig.pricing.deletion).toBe(100n);
      expect(nodeConfig.pricing.queryBase).toBe(2000n);
      expect(nodeConfig.pricing.queryPerResult).toBe(50n);

      // Create and initialize AgentNode
      const node = new AgentNode(nodeConfig);
      await node.initialize();

      // AgentNode should have initialized with pricing
      expect(node.isInitialized).toBe(true);

      await node.shutdown();
    });

    it('should handle handler configuration correctly', async () => {
      // Create config with some handlers disabled
      const config = createTestConfig({
        handlers: {
          enableNoteHandler: true,
          enableFollowHandler: false,
          enableDeleteHandler: true,
          enableQueryHandler: false,
        },
      });
      writeConfig(config);

      // Load and convert config
      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      // enableBuiltInHandlers should be true since at least one handler is enabled
      expect(nodeConfig.enableBuiltInHandlers).toBe(true);

      // Get granular handler config
      const handlerConfig = AgentConfigLoader.getHandlerConfig(yamlConfig);
      expect(handlerConfig.enableNoteHandler).toBe(true);
      expect(handlerConfig.enableFollowHandler).toBe(false);
      expect(handlerConfig.enableDeleteHandler).toBe(true);
      expect(handlerConfig.enableQueryHandler).toBe(false);
    });

    it('should disable all handlers when all set to false', async () => {
      // Create config with all handlers disabled
      const config = createTestConfig({
        handlers: {
          enableNoteHandler: false,
          enableFollowHandler: false,
          enableDeleteHandler: false,
          enableQueryHandler: false,
        },
      });
      writeConfig(config);

      // Load and convert config
      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      // enableBuiltInHandlers should be false when ALL handlers disabled
      expect(nodeConfig.enableBuiltInHandlers).toBe(false);
    });
  });

  // ==========================================================================
  // Database Configuration Tests
  // ==========================================================================
  describe('Database Configuration', () => {
    it('should create AgentNode with in-memory database', async () => {
      const config = createTestConfig({
        database: { path: ':memory:' },
      });
      writeConfig(config);

      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      expect(nodeConfig.databasePath).toBe(':memory:');

      const node = new AgentNode(nodeConfig);
      await node.initialize();
      expect(node.isInitialized).toBe(true);
      await node.shutdown();
    });

    it('should create AgentNode with file-based database', async () => {
      const dbPath = path.join(tempDir, 'test-events.db');
      const config = createTestConfig({
        database: { path: `file:${dbPath}` },
      });
      writeConfig(config);

      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      expect(nodeConfig.databasePath).toBe(`file:${dbPath}`);

      const node = new AgentNode(nodeConfig);
      await node.initialize();
      expect(node.isInitialized).toBe(true);
      await node.shutdown();
    });

    it('should apply database size limit', async () => {
      const config = createTestConfig({
        database: {
          path: ':memory:',
          maxSizeBytes: 50 * 1024 * 1024, // 50MB
        },
      });
      writeConfig(config);

      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      expect(nodeConfig.databaseMaxSize).toBe(50 * 1024 * 1024);
    });
  });

  // ==========================================================================
  // Key File Loading Tests
  // ==========================================================================
  describe('Key File Loading', () => {
    it('should load raw hex key from file', async () => {
      // Write key file
      const keyPath = path.join(tempDir, 'raw-key.txt');
      fs.writeFileSync(keyPath, TEST_PRIVATE_KEY, 'utf8');

      // Create config with keyFilePath
      const config = createTestConfig({
        agent: { keyFilePath: keyPath },
      });
      writeConfig(config);

      // Load and convert
      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      expect(nodeConfig.agentPrivkey).toBe(TEST_PRIVATE_KEY);
      expect(nodeConfig.agentPubkey).toBe(TEST_PUBLIC_KEY);
    });

    it('should throw for non-existent key file', () => {
      // Create config without privateKey - only keyFilePath
      const config: AgentYamlConfig = {
        agent: { keyFilePath: '/non/existent/key.txt' },
        database: { path: ':memory:' },
        pricing: {
          noteStorage: '100',
          followUpdate: '50',
          deletion: '10',
          queryBase: '200',
        },
      };
      writeConfig(config);

      const yamlConfig = AgentConfigLoader.loadConfig(configPath);

      expect(() => AgentConfigLoader.toAgentNodeConfig(yamlConfig)).toThrow(
        AgentConfigurationError
      );
    });
  });

  // ==========================================================================
  // Subscription Configuration Tests
  // ==========================================================================
  describe('Subscription Configuration', () => {
    it('should apply maxSubscriptionsPerPeer setting', async () => {
      const config = createTestConfig({
        subscriptions: { maxPerPeer: 25 },
      });
      writeConfig(config);

      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      expect(nodeConfig.maxSubscriptionsPerPeer).toBe(25);
    });

    it('should use default maxSubscriptionsPerPeer when not specified', async () => {
      const config = createTestConfig();
      // Create config without subscriptions
      const configWithoutSubs: AgentYamlConfig = {
        agent: config.agent,
        database: config.database,
        pricing: config.pricing,
        follows: config.follows,
        handlers: config.handlers,
      };
      writeConfig(configWithoutSubs);

      const yamlConfig = AgentConfigLoader.loadConfig(configPath);
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(yamlConfig);

      // Default is 10
      expect(nodeConfig.maxSubscriptionsPerPeer).toBe(10);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================
  describe('Error Handling', () => {
    it('should throw meaningful error for invalid config', () => {
      // Write invalid config (missing required fields)
      fs.writeFileSync(
        configPath,
        yaml.dump({
          agent: {},
          database: {},
          pricing: {},
        }),
        'utf8'
      );

      expect(() => AgentConfigLoader.loadConfig(configPath)).toThrow(AgentConfigurationError);
    });

    it('should throw for invalid YAML syntax', () => {
      fs.writeFileSync(configPath, 'invalid: yaml: [', 'utf8');

      expect(() => AgentConfigLoader.loadConfig(configPath)).toThrow(AgentConfigurationError);
    });

    it('should throw for invalid ILP address in follows', () => {
      const config = createTestConfig({
        follows: [{ pubkey: FOLLOW_PUBKEY_1, ilpAddress: 'invalid address!' }],
      });
      writeConfig(config);

      expect(() => AgentConfigLoader.loadConfig(configPath)).toThrow(AgentConfigurationError);
    });

    it('should throw for invalid pubkey in follows', () => {
      const config = createTestConfig({
        follows: [{ pubkey: 'too-short', ilpAddress: 'g.agent.alice' }],
      });
      writeConfig(config);

      expect(() => AgentConfigLoader.loadConfig(configPath)).toThrow(AgentConfigurationError);
    });
  });

  // ==========================================================================
  // Round-Trip Tests
  // ==========================================================================
  describe('Configuration Round-Trip', () => {
    it('should preserve all configuration values through load/convert cycle', async () => {
      const originalConfig = createTestConfig({
        agent: { privateKey: TEST_PRIVATE_KEY },
        database: { path: ':memory:', maxSizeBytes: 25 * 1024 * 1024 },
        pricing: {
          noteStorage: '1234',
          followUpdate: '5678',
          deletion: '9012',
          queryBase: '3456',
          queryPerResult: '789',
        },
        follows: [{ pubkey: FOLLOW_PUBKEY_1, ilpAddress: 'g.agent.test1', petname: 'test1' }],
        handlers: {
          enableNoteHandler: true,
          enableFollowHandler: false,
          enableDeleteHandler: true,
          enableQueryHandler: false,
        },
        subscriptions: { maxPerPeer: 15 },
      });
      writeConfig(originalConfig);

      // Load config
      const loadedConfig = AgentConfigLoader.loadConfig(configPath);

      // Verify loaded config matches original
      expect(loadedConfig.agent.privateKey).toBe(originalConfig.agent.privateKey);
      expect(loadedConfig.database.path).toBe(originalConfig.database.path);
      expect(loadedConfig.database.maxSizeBytes).toBe(originalConfig.database.maxSizeBytes);
      expect(loadedConfig.pricing.noteStorage).toBe(originalConfig.pricing.noteStorage);
      expect(loadedConfig.pricing.queryPerResult).toBe(originalConfig.pricing.queryPerResult);
      expect(loadedConfig.follows).toHaveLength(1);
      expect(loadedConfig.follows).toBeDefined();
      expect(loadedConfig.follows).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const firstFollow = loadedConfig.follows![0]!;
      expect(firstFollow.pubkey).toBe(FOLLOW_PUBKEY_1);
      expect(loadedConfig.handlers?.enableFollowHandler).toBe(false);
      expect(loadedConfig.subscriptions?.maxPerPeer).toBe(15);

      // Convert to AgentNodeConfig
      const nodeConfig = AgentConfigLoader.toAgentNodeConfig(loadedConfig);

      // Verify conversion
      expect(nodeConfig.agentPubkey).toBe(TEST_PUBLIC_KEY);
      expect(nodeConfig.agentPrivkey).toBe(TEST_PRIVATE_KEY);
      expect(nodeConfig.databasePath).toBe(':memory:');
      expect(nodeConfig.databaseMaxSize).toBe(25 * 1024 * 1024);
      expect(nodeConfig.pricing.noteStorage).toBe(1234n);
      expect(nodeConfig.pricing.queryPerResult).toBe(789n);
      expect(nodeConfig.maxSubscriptionsPerPeer).toBe(15);
      expect(nodeConfig.enableBuiltInHandlers).toBe(true); // At least one handler enabled

      // Create AgentNode and verify it works
      const node = new AgentNode(nodeConfig);
      await node.initialize();
      expect(node.isInitialized).toBe(true);
      expect(node.agentPubkey).toBe(TEST_PUBLIC_KEY);
      await node.shutdown();
    });
  });
});
