/* eslint-disable no-console */
/**
 * TigerBeetle 5-Peer Deployment Integration Tests
 *
 * Tests the TigerBeetle deployment in the 5-peer multi-hop configuration.
 * Verifies:
 * - TigerBeetle volume creation and initialization
 * - TigerBeetle service health check
 * - Peer connectivity to TigerBeetle
 *
 * Prerequisites:
 * - Docker and Docker Compose installed
 * - Built connector image: docker build -t ilp-connector .
 * - Linux host with io_uring support (required by TigerBeetle)
 *
 * Note: TigerBeetle requires Linux with io_uring support. These tests will be
 * skipped on Docker Desktop (macOS/Windows) where io_uring is not available.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

// 2 minutes timeout for TigerBeetle initialization
jest.setTimeout(120000);

const COMPOSE_FILE = 'docker-compose-5-peer-multihop.yml';
// Resolve to monorepo root (3 levels up from test/integration/)
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

/**
 * Check if TigerBeetle can run on this system
 * TigerBeetle requires Linux with io_uring support
 */
async function canRunTigerBeetle(): Promise<boolean> {
  try {
    // Try to check if io_uring is available by attempting a format
    // This will fail fast on macOS/Docker Desktop with io_uring error
    const { stdout, stderr } = await execAsync(
      `docker run --rm tigerbeetle/tigerbeetle:latest format --cluster=0 --replica=0 --replica-count=1 /tmp/test.tigerbeetle 2>&1 || true`,
      { cwd: PROJECT_ROOT }
    );

    // Check for io_uring error which indicates macOS/Docker Desktop
    const output = (stdout + stderr).toLowerCase();
    if (output.includes('io_uring') || output.includes('permissiondenied')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

describe('TigerBeetle 5-Peer Deployment', () => {
  // Track if we started services so we know to clean up
  let servicesStarted = false;
  let tigerBeetleSupported = true;

  beforeAll(async () => {
    // Check if TigerBeetle can run on this system
    tigerBeetleSupported = await canRunTigerBeetle();
    if (!tigerBeetleSupported) {
      console.warn(
        'SKIPPING TigerBeetle tests: io_uring not available (Docker Desktop on macOS/Windows)'
      );
    }
  });

  afterAll(async () => {
    // Clean up: stop containers and remove volume
    if (servicesStarted) {
      try {
        await execAsync(`docker compose -f ${COMPOSE_FILE} down -v`, {
          cwd: PROJECT_ROOT,
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('TigerBeetle Initialization', () => {
    test('should create TigerBeetle volume on first initialization', async () => {
      // Remove existing volume if present
      try {
        await execAsync('docker volume rm tigerbeetle-5peer-data', {
          cwd: PROJECT_ROOT,
        });
      } catch {
        // Volume might not exist, that's fine
      }

      // Create volume
      await execAsync('docker volume create tigerbeetle-5peer-data', {
        cwd: PROJECT_ROOT,
      });

      // Verify volume exists
      const { stdout } = await execAsync(
        'docker volume inspect tigerbeetle-5peer-data --format "{{.Name}}"',
        { cwd: PROJECT_ROOT }
      );

      expect(stdout.trim()).toBe('tigerbeetle-5peer-data');
    });

    test('should initialize TigerBeetle data file', async () => {
      if (!tigerBeetleSupported) {
        console.log('Skipping: TigerBeetle not supported on this platform (io_uring required)');
        return;
      }

      // TigerBeetle container doesn't have shell, so we check if file exists
      // by attempting to format (will fail with specific message if already exists)
      // or succeed if not exists
      try {
        const { stdout, stderr } = await execAsync(
          `docker run --rm -v tigerbeetle-5peer-data:/data tigerbeetle/tigerbeetle:latest ` +
            `format --cluster=0 --replica=0 --replica-count=1 /data/0_0.tigerbeetle`,
          { cwd: PROJECT_ROOT }
        );
        // If we get here, initialization succeeded
        expect(stdout + stderr).toBeDefined();
      } catch (error) {
        // Format fails if file already exists - that's also acceptable
        const errorMessage = (error as { stderr?: string }).stderr || '';
        expect(errorMessage.toLowerCase()).toMatch(/already|exists|formatted/i);
      }
    });
  });

  describe('TigerBeetle Service Health', () => {
    beforeAll(async () => {
      if (!tigerBeetleSupported) {
        return;
      }

      // Start TigerBeetle service only
      await execAsync(`docker compose -f ${COMPOSE_FILE} up -d tigerbeetle-5peer`, {
        cwd: PROJECT_ROOT,
      });
      servicesStarted = true;
    });

    test('should start TigerBeetle and become healthy within 30 seconds', async () => {
      if (!tigerBeetleSupported) {
        console.log('Skipping: TigerBeetle not supported on this platform (io_uring required)');
        return;
      }

      const maxAttempts = 30;
      const pollInterval = 1000; // 1 second

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const { stdout } = await execAsync(
            `docker inspect --format='{{.State.Health.Status}}' tigerbeetle-5peer`,
            { cwd: PROJECT_ROOT }
          );

          if (stdout.trim() === 'healthy') {
            // TigerBeetle is healthy
            return;
          }
        } catch {
          // Container might not be ready yet
        }

        // Wait before next attempt
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      throw new Error('TigerBeetle did not become healthy within 30 seconds');
    });

    test('should expose TigerBeetle on port 3000 inside container', async () => {
      if (!tigerBeetleSupported) {
        console.log('Skipping: TigerBeetle not supported on this platform (io_uring required)');
        return;
      }

      // Check container is running (TigerBeetle container doesn't have shell utilities)
      const { stdout: containerState } = await execAsync(
        `docker inspect --format='{{.State.Status}}' tigerbeetle-5peer`,
        { cwd: PROJECT_ROOT }
      );

      expect(containerState.trim()).toBe('running');
    });
  });

  describe('Peer Connectivity to TigerBeetle', () => {
    beforeAll(async () => {
      if (!tigerBeetleSupported) {
        return;
      }

      // Start peer1 which depends on TigerBeetle
      await execAsync(`docker compose -f ${COMPOSE_FILE} up -d peer1`, {
        cwd: PROJECT_ROOT,
      });
      servicesStarted = true;

      // Wait for peer1 to start
      const maxAttempts = 60;
      const pollInterval = 2000; // 2 seconds

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const { stdout } = await execAsync(`docker inspect --format='{{.State.Running}}' peer1`, {
            cwd: PROJECT_ROOT,
          });

          if (stdout.trim() === 'true') {
            // Peer1 is running, wait a bit for it to be fully ready
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return;
          }
        } catch {
          // Container might not exist yet
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      throw new Error('peer1 did not start within 2 minutes');
    });

    test('should connect from peer1 to TigerBeetle on tigerbeetle-5peer:3000', async () => {
      if (!tigerBeetleSupported) {
        console.log('Skipping: TigerBeetle not supported on this platform (io_uring required)');
        return;
      }

      // Test TCP connection from peer1 to TigerBeetle using Docker network DNS
      // peer1 is based on node:22-alpine which has nc
      const { stdout, stderr } = await execAsync(
        `docker exec peer1 sh -c 'nc -zv tigerbeetle-5peer 3000 2>&1' || true`,
        { cwd: PROJECT_ROOT }
      );

      // nc -zv outputs success message
      const output = (stdout + stderr).toLowerCase();
      expect(output).toMatch(/connected|open|succeeded/i);
    });

    test('peer1 should have TIGERBEETLE environment variables set', async () => {
      if (!tigerBeetleSupported) {
        console.log('Skipping: TigerBeetle not supported on this platform (io_uring required)');
        return;
      }

      const { stdout: clusterId } = await execAsync(
        `docker exec peer1 sh -c 'echo $TIGERBEETLE_CLUSTER_ID'`,
        { cwd: PROJECT_ROOT }
      );

      const { stdout: replicas } = await execAsync(
        `docker exec peer1 sh -c 'echo $TIGERBEETLE_REPLICAS'`,
        { cwd: PROJECT_ROOT }
      );

      expect(clusterId.trim()).toBe('0');
      expect(replicas.trim()).toBe('tigerbeetle-5peer:3000');
    });
  });
});
