/**
 * TigerBeetle Deployment Integration Tests
 * Tests that TigerBeetle container deploys correctly and accepts client connections
 *
 * Prerequisites:
 * - Docker installed and daemon running
 * - Docker Compose 2.x installed
 * - TigerBeetle image available: ghcr.io/tigerbeetle/tigerbeetle:latest
 * - Run from repository root: npm test --workspace=packages/connector -- tigerbeetle-deployment.test.ts
 *
 * Note: These tests are skipped if Docker or Docker Compose are not available
 */

import { execSync } from 'child_process';
import path from 'path';

const COMPOSE_FILE = 'docker-compose.yml';
const TIGERBEETLE_CONTAINER = 'tigerbeetle';
const CONNECTOR_A_CONTAINER = 'connector-a';

// Increase timeout for Docker Compose operations (2 minutes for TigerBeetle initialization)
jest.setTimeout(120000);

/**
 * Check if Docker is available and daemon is running
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Docker Compose is available
 */
function isDockerComposeAvailable(): boolean {
  try {
    execSync('docker-compose --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get repository root directory
 */
function getRepoRoot(): string {
  const cwd = process.cwd();
  // If we're in packages/connector, go up two levels
  if (cwd.endsWith('/packages/connector')) {
    return path.join(cwd, '../..');
  }
  return cwd;
}

/**
 * Execute shell command with proper error handling
 */
function executeCommand(
  cmd: string,
  options: { cwd?: string; ignoreError?: boolean } = {}
): string {
  const cwd = options.cwd || getRepoRoot();

  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return output;
  } catch (error: any) {
    if (options.ignoreError) {
      return error.stdout || '';
    }
    throw error;
  }
}

/**
 * Cleanup Docker Compose resources
 */
function cleanupDockerCompose(): void {
  try {
    executeCommand(`docker-compose -f ${COMPOSE_FILE} down -v --remove-orphans`, {
      ignoreError: true,
    });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Wait for a specific container to be healthy
 */
async function waitForHealthy(containerName: string, timeoutMs: number = 60000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const healthStatus = executeCommand(
        `docker inspect ${containerName} --format '{{.State.Health.Status}}'`,
        { ignoreError: true }
      ).trim();

      if (healthStatus === 'healthy') {
        return;
      }

      // Check if container is running but has no health check
      const runningStatus = executeCommand(
        `docker inspect ${containerName} --format '{{.State.Running}}'`,
        { ignoreError: true }
      ).trim();

      if (runningStatus === 'true' && healthStatus === '') {
        // Container is running but has no health check
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return;
      }
    } catch {
      // Ignore errors, keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Container ${containerName} did not become healthy within ${timeoutMs}ms`);
}

/**
 * Wait for a specific container to be running
 */
async function waitForRunning(containerName: string, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const runningStatus = executeCommand(
        `docker inspect ${containerName} --format '{{.State.Running}}'`,
        { ignoreError: true }
      ).trim();

      if (runningStatus === 'true') {
        return;
      }
    } catch {
      // Ignore errors, keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Container ${containerName} did not start within ${timeoutMs}ms`);
}

// Check if Docker and Docker Compose are available
const dockerAvailable = isDockerAvailable();
const composeAvailable = isDockerComposeAvailable();
const e2eEnabled = process.env.E2E_TESTS === 'true';

// Skip tests if Docker/Compose not available or E2E tests not enabled
const describeIfDockerCompose =
  dockerAvailable && composeAvailable && e2eEnabled ? describe : describe.skip;

describeIfDockerCompose('TigerBeetle Deployment Integration Tests', () => {
  // Cleanup before starting tests
  beforeAll(() => {
    cleanupDockerCompose();
  });

  // Cleanup after each test
  afterEach(() => {
    if (isDockerAvailable() && isDockerComposeAvailable()) {
      cleanupDockerCompose();
    }
  });

  describe('TigerBeetle Container Deployment', () => {
    it('should deploy TigerBeetle container successfully', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start TigerBeetle service only
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d ${TIGERBEETLE_CONTAINER}`);

      // Wait for container to be healthy
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // Verify container status
      const healthStatus = executeCommand(
        `docker inspect ${TIGERBEETLE_CONTAINER} --format '{{.State.Health.Status}}'`
      ).trim();

      expect(healthStatus).toBe('healthy');
    });

    it('should have TigerBeetle container running with correct configuration', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start TigerBeetle service
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d ${TIGERBEETLE_CONTAINER}`);
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // Check container is running
      const isRunning = executeCommand(
        `docker inspect ${TIGERBEETLE_CONTAINER} --format '{{.State.Running}}'`
      ).trim();
      expect(isRunning).toBe('true');

      // Check container has the correct image
      const image = executeCommand(
        `docker inspect ${TIGERBEETLE_CONTAINER} --format '{{.Config.Image}}'`
      ).trim();
      expect(image).toContain('tigerbeetle');

      // Check container has data volume mounted
      const mounts = executeCommand(
        `docker inspect ${TIGERBEETLE_CONTAINER} --format '{{json .Mounts}}'`
      ).trim();
      expect(mounts).toContain('tigerbeetle-data');
      expect(mounts).toContain('/data');
    });

    it('should initialize TigerBeetle data file on first startup', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start TigerBeetle service
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d ${TIGERBEETLE_CONTAINER}`);
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // Check logs for initialization message
      const logs = executeCommand(`docker logs ${TIGERBEETLE_CONTAINER}`);

      // Should see initialization or data file exists message
      const hasInitMessage =
        logs.includes('TigerBeetle cluster formatted successfully') ||
        logs.includes('TigerBeetle data file already exists');

      expect(hasInitMessage).toBe(true);
    });
  });

  describe('TigerBeetle Network Connectivity', () => {
    it('should accept client connections from connector network', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start TigerBeetle and connector-a
      executeCommand(
        `docker-compose -f ${COMPOSE_FILE} up -d ${TIGERBEETLE_CONTAINER} ${CONNECTOR_A_CONTAINER}`
      );

      // Wait for both containers
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);
      await waitForRunning(CONNECTOR_A_CONTAINER, 30000);

      // Test TCP connection from connector-a to tigerbeetle:3000
      // Note: We need netcat (nc) available in the connector container
      const connectionTest = executeCommand(
        `docker exec ${CONNECTOR_A_CONTAINER} nc -zv tigerbeetle 3000`,
        { ignoreError: true }
      );

      // Connection should succeed (exit code 0 or "succeeded" in output)
      const isConnected =
        connectionTest.includes('succeeded') ||
        connectionTest.includes('open') ||
        connectionTest.includes('Connected');

      expect(isConnected).toBe(true);
    });

    it('should have TigerBeetle port accessible only within Docker network', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start TigerBeetle service
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d ${TIGERBEETLE_CONTAINER}`);
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // Check that port 3000 is NOT exposed to host
      const ports = executeCommand(
        `docker inspect ${TIGERBEETLE_CONTAINER} --format '{{json .NetworkSettings.Ports}}'`
      ).trim();

      // Port 3000 should not have host bindings (internal only)
      // The ports JSON should be empty or not contain host port mappings
      expect(ports).toBe('{}');
    });
  });

  describe('TigerBeetle Data Persistence', () => {
    it('should persist data across container restarts', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start TigerBeetle service
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d ${TIGERBEETLE_CONTAINER}`);
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // Restart container
      executeCommand(`docker-compose -f ${COMPOSE_FILE} restart ${TIGERBEETLE_CONTAINER}`);
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // Get logs after restart
      const logsAfterRestart = executeCommand(`docker logs ${TIGERBEETLE_CONTAINER}`);

      // After restart, should see "data file already exists" not "formatted successfully"
      // This confirms the data file persisted
      expect(logsAfterRestart).toContain('TigerBeetle data file already exists');

      // Verify volume still exists
      const volumeList = executeCommand('docker volume ls');
      expect(volumeList).toContain('tigerbeetle-data');
    });
  });

  describe('TigerBeetle Connector Dependencies', () => {
    it('should start connectors only after TigerBeetle is healthy', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start all services
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d`);

      // Wait for TigerBeetle to be healthy first
      await waitForHealthy(TIGERBEETLE_CONTAINER, 60000);

      // TigerBeetle should be healthy before connectors start
      const tigerBeetleHealth = executeCommand(
        `docker inspect ${TIGERBEETLE_CONTAINER} --format '{{.State.Health.Status}}'`
      ).trim();
      expect(tigerBeetleHealth).toBe('healthy');

      // Now wait for connector-a
      await waitForRunning(CONNECTOR_A_CONTAINER, 30000);

      // Verify connector is running
      const connectorRunning = executeCommand(
        `docker inspect ${CONNECTOR_A_CONTAINER} --format '{{.State.Running}}'`
      ).trim();
      expect(connectorRunning).toBe('true');
    });
  });
});
