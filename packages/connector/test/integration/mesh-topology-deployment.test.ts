/**
 * Mesh Topology Deployment Integration Tests
 * Tests that the 4-node full mesh topology deploys correctly and all BTP connections establish
 *
 * Prerequisites:
 * - Docker installed and daemon running
 * - Docker Compose 2.x installed
 * - Mesh configuration files in examples/mesh-4-nodes-*.yaml
 * - docker-compose-mesh.yml in project root
 *
 * Run: npm test --workspace=packages/connector -- mesh-topology-deployment.test.ts
 *
 * Note: These tests are skipped if Docker or Docker Compose are not available
 */

import { execSync } from 'child_process';
import path from 'path';

const COMPOSE_FILE = 'docker-compose-mesh.yml';
const IMAGE_NAME = 'agent-runtime';

// Increase timeout for Docker Compose operations (120 seconds for mesh deployment)
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
 * Wait for all containers to be healthy
 */
async function waitForHealthy(timeoutMs: number = 45000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const psOutput = executeCommand(`docker-compose -f ${COMPOSE_FILE} ps --format json`, {
        ignoreError: true,
      });

      if (!psOutput) {
        // No containers yet
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // Parse JSON output
      const lines = psOutput
        .trim()
        .split('\n')
        .filter((line) => line.trim());
      if (lines.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const containers = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // Check if all containers are running (4 connectors + 1 dashboard)
      const allRunning = containers.every((c: any) => c.State === 'running');

      if (allRunning && containers.length === 5) {
        // Give more time for BTP connections to establish in mesh topology
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return;
      }
    } catch {
      // Ignore errors, keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Timeout waiting for containers to become healthy');
}

/**
 * Build Docker image
 */
function buildDockerImage(): void {
  const repoRoot = getRepoRoot();
  executeCommand(`docker build -t ${IMAGE_NAME} -f packages/connector/Dockerfile .`, {
    cwd: repoRoot,
  });
}

/**
 * Build dashboard image
 */
function buildDashboardImage(): void {
  const repoRoot = getRepoRoot();
  executeCommand(`docker build -t ilp-dashboard -f packages/dashboard/Dockerfile .`, {
    cwd: repoRoot,
  });
}

// Skip all tests if Docker or Docker Compose are not available
// Also skip by default unless E2E_TESTS environment variable is set
const dockerAvailable = isDockerAvailable();
const composeAvailable = isDockerComposeAvailable();
const e2eEnabled = process.env.E2E_TESTS === 'true';
const describeIfDockerCompose =
  dockerAvailable && composeAvailable && e2eEnabled ? describe : describe.skip;

describeIfDockerCompose('Mesh Topology Deployment', () => {
  // Build images before all tests
  beforeAll(() => {
    // Ensure clean state
    cleanupDockerCompose();

    // Build the connector and dashboard images
    buildDockerImage();
    buildDashboardImage();
  });

  // Cleanup before each test
  beforeEach(() => {
    cleanupDockerCompose();
  });

  // Cleanup after each test
  afterEach(() => {
    cleanupDockerCompose();
  });

  describe('Mesh Topology Deployment', () => {
    it('should deploy all 5 containers successfully (4 connectors + dashboard)', async () => {
      // Act: Start mesh topology
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d`);

      // Wait for containers to start
      await waitForHealthy();

      // Act: Get container status
      const psOutput = executeCommand(`docker-compose -f ${COMPOSE_FILE} ps --format json`);

      // Assert: Verify all containers are present
      expect(psOutput).toContain('connector-a');
      expect(psOutput).toContain('connector-b');
      expect(psOutput).toContain('connector-c');
      expect(psOutput).toContain('connector-d');
      expect(psOutput).toContain('ilp-dashboard');

      // Parse and verify running state
      const lines = psOutput
        .trim()
        .split('\n')
        .filter((line) => line.trim());
      expect(lines.length).toBe(5);

      const containers = lines.map((line) => JSON.parse(line));
      const runningCount = containers.filter((c: any) => c.State === 'running').length;
      expect(runningCount).toBe(5);
    });

    it('should establish all BTP connections in mesh topology', async () => {
      // Arrange: Start mesh network
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d`);
      await waitForHealthy();

      // Wait for BTP connections to establish (45 seconds as per story requirements)
      await new Promise((resolve) => setTimeout(resolve, 45000));

      // Act: Get logs from all connectors
      const logsA = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-a`);
      const logsB = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-b`);
      const logsC = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-c`);
      const logsD = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-d`);

      // Assert: Connector A should have BTP connections to B, C, D (3 connections)
      expect(logsA).toContain('connector-b');
      expect(logsA).toContain('connector-c');
      expect(logsA).toContain('connector-d');

      // Assert: Connector B should have BTP connections to A, C, D
      expect(logsB).toContain('connector-a');
      expect(logsB).toContain('connector-c');
      expect(logsB).toContain('connector-d');

      // Assert: Connector C should have BTP connections to A, B, D
      expect(logsC).toContain('connector-a');
      expect(logsC).toContain('connector-b');
      expect(logsC).toContain('connector-d');

      // Assert: Connector D should have BTP connections to A, B, C
      expect(logsD).toContain('connector-a');
      expect(logsD).toContain('connector-b');
      expect(logsD).toContain('connector-c');
    });

    it('should pass health checks for all 4 connectors', async () => {
      // Arrange: Start mesh network
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d`);
      await waitForHealthy();

      // Wait for health checks to stabilize
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Act: Query health endpoints for all connectors
      const healthA = executeCommand('curl -s http://localhost:9080/health', { ignoreError: true });
      const healthB = executeCommand('curl -s http://localhost:9081/health', { ignoreError: true });
      const healthC = executeCommand('curl -s http://localhost:9082/health', { ignoreError: true });
      const healthD = executeCommand('curl -s http://localhost:9083/health', { ignoreError: true });

      // Assert: All health endpoints should return 200 OK with JSON
      expect(healthA).toContain('status');
      expect(healthB).toContain('status');
      expect(healthC).toContain('status');
      expect(healthD).toContain('status');

      // Parse JSON and verify healthy status
      const healthDataA = JSON.parse(healthA);
      const healthDataB = JSON.parse(healthB);
      const healthDataC = JSON.parse(healthC);
      const healthDataD = JSON.parse(healthD);

      expect(['healthy', 'starting']).toContain(healthDataA.status);
      expect(['healthy', 'starting']).toContain(healthDataB.status);
      expect(['healthy', 'starting']).toContain(healthDataC.status);
      expect(['healthy', 'starting']).toContain(healthDataD.status);
    });

    it('should show correct nodeId in logs for each connector', async () => {
      // Arrange: Start mesh network
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d`);
      await waitForHealthy();

      // Wait for startup logs
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Act: Get logs from each connector
      const logsA = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-a`);
      const logsB = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-b`);
      const logsC = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-c`);
      const logsD = executeCommand(`docker-compose -f ${COMPOSE_FILE} logs connector-d`);

      // Assert: Verify correct nodeId and btpServerPort in logs
      expect(logsA).toContain('"nodeId":"connector-a"');
      expect(logsA).toContain('"btpServerPort":3000');

      expect(logsB).toContain('"nodeId":"connector-b"');
      expect(logsB).toContain('"btpServerPort":3001');

      expect(logsC).toContain('"nodeId":"connector-c"');
      expect(logsC).toContain('"btpServerPort":3002');

      expect(logsD).toContain('"nodeId":"connector-d"');
      expect(logsD).toContain('"btpServerPort":3003');
    });

    it('should use correct configuration files from examples/', async () => {
      // Arrange: Start mesh network
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d`);
      await waitForHealthy();

      // Act: Inspect volume mounts for each connector
      const inspectA = executeCommand('docker inspect connector-a');
      const inspectB = executeCommand('docker inspect connector-b');
      const inspectC = executeCommand('docker inspect connector-c');
      const inspectD = executeCommand('docker inspect connector-d');

      // Assert: Verify correct config files mounted
      expect(inspectA).toContain('mesh-4-nodes-a.yaml');
      expect(inspectB).toContain('mesh-4-nodes-b.yaml');
      expect(inspectC).toContain('mesh-4-nodes-c.yaml');
      expect(inspectD).toContain('mesh-4-nodes-d.yaml');
    });
  });
});

// If Docker or Docker Compose are not available, provide helpful message
if (!dockerAvailable || !composeAvailable || !e2eEnabled) {
  console.log('\n⚠️  Mesh Topology integration tests skipped');

  if (!dockerAvailable) {
    console.log('   Docker is not available');
    console.log('   Install Docker: https://docs.docker.com/get-docker/');
  }

  if (!composeAvailable) {
    console.log('   Docker Compose is not available');
    console.log('   Install Docker Compose: https://docs.docker.com/compose/install/');
  }

  if (!e2eEnabled) {
    console.log('   E2E tests not enabled (set E2E_TESTS=true to run)');
  }

  console.log('\nTo run these tests:');
  console.log('  1. Install Docker and Docker Compose');
  console.log('  2. Start Docker daemon');
  console.log(
    '  3. Run: E2E_TESTS=true npm test --workspace=packages/connector -- mesh-topology-deployment.test.ts\n'
  );
}
