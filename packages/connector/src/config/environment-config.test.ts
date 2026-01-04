/**
 * Integration Tests for Environment Configuration
 *
 * Tests environment-based blockchain configuration loading, validation,
 * and environment-specific defaults. Validates that production safety
 * rules are enforced to prevent accidental mainnet deployment with
 * development credentials.
 *
 * @packageDocumentation
 */

import { ConfigLoader } from './config-loader';
import * as fs from 'fs';
import * as path from 'path';

describe('Environment Configuration Integration Tests', () => {
  // Test config file path
  const testConfigPath = path.join(__dirname, '__test-fixtures__', 'test-config.yaml');

  // Store original environment variables to restore after tests
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Create test config directory if it doesn't exist
    const fixturesDir = path.join(__dirname, '__test-fixtures__');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    // Create minimal test config file
    const testConfig = `
nodeId: test-connector
btpServerPort: 3000
healthCheckPort: 8080
logLevel: info
peers: []
routes: []
`;
    fs.writeFileSync(testConfigPath, testConfig);
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = { ...originalEnv };

    // Clean up test config file
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  afterAll(() => {
    // Clean up test fixtures directory
    const fixturesDir = path.join(__dirname, '__test-fixtures__');
    if (fs.existsSync(fixturesDir)) {
      fs.rmdirSync(fixturesDir);
    }
  });

  describe('Development Environment Configuration', () => {
    test('should load development configuration from environment variables', () => {
      // Set development environment variables
      process.env.ENVIRONMENT = 'development';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'http://anvil:8545';
      process.env.BASE_CHAIN_ID = '84532';
      process.env.XRPL_ENABLED = 'true';
      process.env.XRPL_RPC_URL = 'http://rippled:5005';
      process.env.XRPL_NETWORK = 'standalone';

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify environment
      expect(config.environment).toBe('development');

      // Verify Base blockchain config
      expect(config.blockchain?.base?.enabled).toBe(true);
      expect(config.blockchain?.base?.rpcUrl).toBe('http://anvil:8545');
      expect(config.blockchain?.base?.chainId).toBe(84532);

      // Verify XRPL blockchain config
      expect(config.blockchain?.xrpl?.enabled).toBe(true);
      expect(config.blockchain?.xrpl?.rpcUrl).toBe('http://rippled:5005');
      expect(config.blockchain?.xrpl?.network).toBe('standalone');
    });

    test('should apply development defaults when ENVIRONMENT=development', () => {
      // Set development environment with minimal variables
      process.env.ENVIRONMENT = 'development';
      process.env.BASE_ENABLED = 'true';
      process.env.XRPL_ENABLED = 'true';
      // Do NOT set RPC URLs or chain IDs - should use defaults

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify Base defaults
      expect(config.blockchain?.base?.rpcUrl).toBe('http://anvil:8545');
      expect(config.blockchain?.base?.chainId).toBe(84532);

      // Verify XRPL defaults
      expect(config.blockchain?.xrpl?.rpcUrl).toBe('http://rippled:5005');
      expect(config.blockchain?.xrpl?.network).toBe('standalone');
    });
  });

  describe('Production Environment Configuration', () => {
    test('should load production configuration from environment variables', () => {
      // Set production environment variables
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'https://mainnet.base.org';
      process.env.BASE_CHAIN_ID = '8453';
      process.env.BASE_PRIVATE_KEY =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.XRPL_ENABLED = 'true';
      process.env.XRPL_RPC_URL = 'https://xrplcluster.com';
      process.env.XRPL_NETWORK = 'mainnet';

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify environment
      expect(config.environment).toBe('production');

      // Verify Base blockchain config
      expect(config.blockchain?.base?.enabled).toBe(true);
      expect(config.blockchain?.base?.rpcUrl).toBe('https://mainnet.base.org');
      expect(config.blockchain?.base?.chainId).toBe(8453);

      // Verify XRPL blockchain config
      expect(config.blockchain?.xrpl?.enabled).toBe(true);
      expect(config.blockchain?.xrpl?.rpcUrl).toBe('https://xrplcluster.com');
      expect(config.blockchain?.xrpl?.network).toBe('mainnet');
    });

    test('should apply production defaults when ENVIRONMENT=production', () => {
      // Set production environment with minimal variables
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_PRIVATE_KEY =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.XRPL_ENABLED = 'true';
      // Do NOT set RPC URLs or chain IDs - should use defaults

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify Base defaults
      expect(config.blockchain?.base?.rpcUrl).toBe('https://mainnet.base.org');
      expect(config.blockchain?.base?.chainId).toBe(8453);

      // Verify XRPL defaults
      expect(config.blockchain?.xrpl?.rpcUrl).toBe('https://xrplcluster.com');
      expect(config.blockchain?.xrpl?.network).toBe('mainnet');
    });
  });

  describe('Production Environment Validation', () => {
    test('should reject development private key in production environment', () => {
      // Set production environment with Anvil development private key
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'https://mainnet.base.org';
      process.env.BASE_CHAIN_ID = '8453';
      process.env.BASE_PRIVATE_KEY =
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Cannot use development private key in production');
    });

    test('should reject localhost RPC URL in production environment', () => {
      // Set production environment with localhost RPC
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'http://localhost:8545';
      process.env.BASE_CHAIN_ID = '8453';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Cannot use localhost RPC in production');
    });

    test('should reject non-mainnet chain ID in production environment', () => {
      // Set production environment with Base Sepolia chain ID
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'https://sepolia.base.org';
      process.env.BASE_CHAIN_ID = '84532'; // Base Sepolia, not mainnet

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Production must use Base mainnet (chainId 8453)');
    });

    test('should reject 127.0.0.1 RPC URL in production environment', () => {
      // Set production environment with 127.0.0.1 RPC
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'http://127.0.0.1:8545';
      process.env.BASE_CHAIN_ID = '8453';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Cannot use localhost RPC in production');
    });

    test('should reject HTTP RPC URL in production environment', () => {
      // Set production environment with HTTP (not HTTPS) RPC
      process.env.ENVIRONMENT = 'production';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_RPC_URL = 'http://mainnet.base.org'; // HTTP instead of HTTPS
      process.env.BASE_CHAIN_ID = '8453';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Production RPC URL must use HTTPS for security');
    });

    test('should reject non-mainnet XRPL network in production', () => {
      // Set production environment with XRPL testnet
      process.env.ENVIRONMENT = 'production';
      process.env.XRPL_ENABLED = 'true';
      process.env.XRPL_RPC_URL = 'https://s.altnet.rippletest.net:51234';
      process.env.XRPL_NETWORK = 'testnet';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow("Production must use XRPL mainnet, got network 'testnet'");
    });

    test('should reject localhost XRPL RPC in production', () => {
      // Set production environment with localhost rippled
      process.env.ENVIRONMENT = 'production';
      process.env.XRPL_ENABLED = 'true';
      process.env.XRPL_RPC_URL = 'http://localhost:5005';
      process.env.XRPL_NETWORK = 'mainnet';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Cannot use localhost rippled in production');
    });
  });

  describe('Default Environment Behavior', () => {
    test('should default to development environment when ENVIRONMENT not set', () => {
      // Do NOT set ENVIRONMENT variable
      delete process.env.ENVIRONMENT;

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify defaults to development
      expect(config.environment).toBe('development');
    });

    test('should return undefined blockchain config when no blockchain enabled', () => {
      // Do NOT set BASE_ENABLED or XRPL_ENABLED
      delete process.env.BASE_ENABLED;
      delete process.env.XRPL_ENABLED;

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify blockchain config is undefined
      expect(config.blockchain).toBeUndefined();
    });
  });

  describe('Staging Environment Configuration', () => {
    test('should load staging configuration with testnet defaults', () => {
      // Set staging environment
      process.env.ENVIRONMENT = 'staging';
      process.env.BASE_ENABLED = 'true';
      process.env.XRPL_ENABLED = 'true';
      // Do NOT set RPC URLs - should use staging defaults

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify environment
      expect(config.environment).toBe('staging');

      // Verify Base staging defaults
      expect(config.blockchain?.base?.rpcUrl).toBe('https://sepolia.base.org');
      expect(config.blockchain?.base?.chainId).toBe(84532);

      // Verify XRPL staging defaults
      expect(config.blockchain?.xrpl?.rpcUrl).toBe('https://s.altnet.rippletest.net:51234');
      expect(config.blockchain?.xrpl?.network).toBe('testnet');
    });
  });

  describe('Private Key Handling', () => {
    test('should load optional private keys when provided', () => {
      process.env.ENVIRONMENT = 'development';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_PRIVATE_KEY =
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      process.env.XRPL_ENABLED = 'true';
      process.env.XRPL_PRIVATE_KEY = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify private keys loaded
      expect(config.blockchain?.base?.privateKey).toBe(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      );
      expect(config.blockchain?.xrpl?.privateKey).toBe('snoPBrXtMeMyMHUVTgbuqAfg1SUTb');
    });

    test('should allow undefined private keys (optional)', () => {
      process.env.ENVIRONMENT = 'development';
      process.env.BASE_ENABLED = 'true';
      process.env.XRPL_ENABLED = 'true';
      // Do NOT set private keys

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify private keys are undefined
      expect(config.blockchain?.base?.privateKey).toBeUndefined();
      expect(config.blockchain?.xrpl?.privateKey).toBeUndefined();
    });
  });

  describe('Registry Address Configuration', () => {
    test('should load optional registry address when provided', () => {
      process.env.ENVIRONMENT = 'development';
      process.env.BASE_ENABLED = 'true';
      process.env.BASE_REGISTRY_ADDRESS = '0x1234567890123456789012345678901234567890';

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify registry address loaded
      expect(config.blockchain?.base?.registryAddress).toBe(
        '0x1234567890123456789012345678901234567890'
      );
    });

    test('should allow undefined registry address (optional)', () => {
      process.env.ENVIRONMENT = 'development';
      process.env.BASE_ENABLED = 'true';
      // Do NOT set registry address

      const config = ConfigLoader.loadConfig(testConfigPath);

      // Verify registry address is undefined
      expect(config.blockchain?.base?.registryAddress).toBeUndefined();
    });
  });

  describe('Invalid Environment Values', () => {
    test('should reject invalid ENVIRONMENT value', () => {
      process.env.ENVIRONMENT = 'invalid-environment';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Invalid ENVIRONMENT');
    });

    test('should reject invalid XRPL_NETWORK value', () => {
      process.env.ENVIRONMENT = 'development';
      process.env.XRPL_ENABLED = 'true';
      process.env.XRPL_NETWORK = 'invalid-network';

      // Expect ConfigLoader to throw error
      expect(() => {
        ConfigLoader.loadConfig(testConfigPath);
      }).toThrow('Invalid XRPL_NETWORK');
    });
  });
});
