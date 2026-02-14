/** @type {import('jest').Config} */
const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  displayName: 'connector-performance',
  testMatch: [
    '<rootDir>/test/performance/**/*.test.ts',
    '<rootDir>/test/unit/performance/**/*.test.ts',
    '<rootDir>/src/**/*.perf.test.ts',
  ],
  // Override to allow performance tests to run (base config excludes them)
  // NOTE: testPathIgnorePatterns replaces (not merges) the base config array,
  // so we must duplicate all base patterns except the ones we want to include.
  testPathIgnorePatterns: [
    '/node_modules/',
    'aws-kms-backend\\.test\\.ts$',
    'azure-kv-backend\\.test\\.ts$',
    'gcp-kms-backend\\.test\\.ts$',
    'wallet-disaster-recovery\\.test\\.ts$',
    'connector-aptos-settlement\\.test\\.ts$',
    'production-acceptance\\.test\\.ts$',
    'agent-wallet-integration\\.doc\\.test\\.ts$',
    'tri-chain-settlement\\.test\\.ts$',
    'aptos-local-testnet\\.test\\.ts$',
    'tigerbeetle-5peer-deployment\\.test\\.ts$',
    'test/acceptance/', // Still exclude acceptance tests
    'wallet-derivation\\.test\\.ts$', // Still exclude slow tests
    'xrp-channel-manager\\.test\\.ts$',
    'xrp-channel-lifecycle\\.test\\.ts$',
  ],
  testTimeout: 300000, // 5 minutes for performance benchmarks
  coveragePathIgnorePatterns: ['.*'], // Disable coverage for perf tests
  maxWorkers: 2, // Reduce interference between benchmarks
};
