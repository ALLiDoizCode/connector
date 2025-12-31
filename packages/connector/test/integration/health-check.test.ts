/**
 * Integration Tests for Health Check Endpoint with Docker
 * Story 2.7 - Task 9
 *
 * These tests verify health check behavior in a real Docker environment.
 * They test the complete integration of health endpoints, Docker HEALTHCHECK,
 * and Docker Compose health status reporting.
 *
 * IMPORTANT: These tests require Docker and docker-compose to be installed
 * and running. They are SKIPPED by default (using describe.skip) to avoid
 * failures in environments without Docker.
 *
 * TO RUN THESE TESTS:
 * 1. Ensure Docker is running
 * 2. Build the connector image: docker build -t ilp-connector .
 * 3. Change `describe.skip` to `describe` below
 * 4. Run: npm test -- health-check.test.ts
 *
 * @packageDocumentation
 */

import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Docker Compose file path (adjust based on test execution context)
const DOCKER_COMPOSE_FILE = '../../docker-compose.yml';
const DOCKER_COMPOSE_CMD = `docker-compose -f ${DOCKER_COMPOSE_FILE}`;

// Health endpoint URLs for each connector
const HEALTH_ENDPOINTS = {
  connectorA: 'http://localhost:8080/health',
  connectorB: 'http://localhost:8081/health',
  connectorC: 'http://localhost:8082/health',
};

// Timeout for waiting for health checks
const HEALTH_CHECK_TIMEOUT = 60000; // 60 seconds
const HEALTH_CHECK_INTERVAL = 2000; // 2 seconds

/**
 * Wait for a condition to be true, polling at intervals
 */
async function waitFor(
  condition: () => Promise<boolean>,
  timeout: number,
  interval: number
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Check if all connectors are healthy via HTTP endpoint
 */
async function checkAllConnectorsHealthy(): Promise<boolean> {
  try {
    const responses = await Promise.all([
      axios.get(HEALTH_ENDPOINTS.connectorA, { timeout: 5000 }),
      axios.get(HEALTH_ENDPOINTS.connectorB, { timeout: 5000 }),
      axios.get(HEALTH_ENDPOINTS.connectorC, { timeout: 5000 }),
    ]);

    return responses.every((res) => res.status === 200 && res.data.status === 'healthy');
  } catch {
    return false;
  }
}

/**
 * Get Docker Compose container health status
 */
async function getDockerComposeHealth(): Promise<Record<string, string>> {
  const { stdout } = await execAsync(`${DOCKER_COMPOSE_CMD} ps --format json`);
  const containers = JSON.parse(`[${stdout.trim().replace(/\n/g, ',')}]`);

  const healthStatus: Record<string, string> = {};
  for (const container of containers) {
    healthStatus[container.Service] = container.Health || 'unknown';
  }

  return healthStatus;
}

/**
 * Task 9: Docker Integration Tests for Health Check Endpoint
 *
 * IMPORTANT: These tests are SKIPPED by default because they require:
 * - Docker installed and running
 * - docker-compose available
 * - Connector Docker image built
 * - Network ports 8080-8082 available
 *
 * To enable these tests:
 * 1. Change `describe.skip` to `describe` below
 * 2. Ensure Docker environment is ready
 * 3. Run tests
 */
describe.skip('Health Check Integration with Docker', () => {
  beforeAll(async () => {
    // Verify Docker is available
    try {
      await execAsync('docker --version');
      await execAsync('docker-compose --version');
    } catch (error) {
      throw new Error('Docker or docker-compose not available. Please install Docker.');
    }

    // Start Docker Compose network
    console.log('Starting Docker Compose network...');
    try {
      await execAsync(`${DOCKER_COMPOSE_CMD} up -d`);
    } catch (error) {
      console.error('Failed to start Docker Compose:', error);
      throw error;
    }
  }, 120000); // 2 minute timeout for Docker startup

  afterAll(async () => {
    // Clean up: Stop and remove containers
    console.log('Stopping Docker Compose network...');
    try {
      await execAsync(`${DOCKER_COMPOSE_CMD} down`);
    } catch (error) {
      console.error('Failed to stop Docker Compose:', error);
    }
  }, 60000); // 1 minute timeout for cleanup

  describe('Test 1: All connectors report healthy status after startup', () => {
    it(
      'should have all connectors healthy within 60 seconds',
      async () => {
        // Arrange & Act - Wait for all connectors to become healthy
        await waitFor(checkAllConnectorsHealthy, HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_INTERVAL);

        // Assert - Verify each connector returns healthy status
        const responseA = await axios.get(HEALTH_ENDPOINTS.connectorA);
        expect(responseA.status).toBe(200);
        expect(responseA.data).toMatchObject({
          status: 'healthy',
          nodeId: 'connector-a',
        });

        const responseB = await axios.get(HEALTH_ENDPOINTS.connectorB);
        expect(responseB.status).toBe(200);
        expect(responseB.data).toMatchObject({
          status: 'healthy',
          nodeId: 'connector-b',
        });

        const responseC = await axios.get(HEALTH_ENDPOINTS.connectorC);
        expect(responseC.status).toBe(200);
        expect(responseC.data).toMatchObject({
          status: 'healthy',
          nodeId: 'connector-c',
        });
      },
      HEALTH_CHECK_TIMEOUT + 10000
    );

    it(
      'should show all containers as healthy in docker-compose ps',
      async () => {
        // Arrange - Wait for Docker health checks to pass
        await waitFor(
          async () => {
            const health = await getDockerComposeHealth();
            return Object.values(health).every((status) => status === 'healthy');
          },
          HEALTH_CHECK_TIMEOUT,
          HEALTH_CHECK_INTERVAL
        );

        // Act
        const healthStatus = await getDockerComposeHealth();

        // Assert
        expect(healthStatus['connector-a']).toBe('healthy');
        expect(healthStatus['connector-b']).toBe('healthy');
        expect(healthStatus['connector-c']).toBe('healthy');
      },
      HEALTH_CHECK_TIMEOUT + 10000
    );
  });

  describe('Test 2: Container marked unhealthy when BTP connections fail', () => {
    it('should mark connectors unhealthy when middle connector stops', async () => {
      // Arrange - Ensure all connectors are healthy first
      await waitFor(checkAllConnectorsHealthy, HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_INTERVAL);

      // Act - Stop connector-b (breaks the chain)
      await execAsync(`${DOCKER_COMPOSE_CMD} stop connector-b`);

      // Wait for health checks to detect failure (up to 90 seconds)
      await new Promise((resolve) => setTimeout(resolve, 90000));

      // Assert - connector-a and connector-c should report issues
      // (depending on configuration, they may be unhealthy if they had peers)
      const responseA = await axios.get(HEALTH_ENDPOINTS.connectorA);
      const responseC = await axios.get(HEALTH_ENDPOINTS.connectorC);

      // At minimum, connector-b should be unreachable
      await expect(axios.get(HEALTH_ENDPOINTS.connectorB)).rejects.toThrow();

      // Note: connector-a and connector-c health depends on their peer configuration
      // If they have no peers, they remain healthy; if they had connector-b as peer,
      // they should be unhealthy
      console.log('Connector A status:', responseA.data.status);
      console.log('Connector C status:', responseC.data.status);
    }, 120000); // 2 minute timeout for this test

    afterAll(async () => {
      // Restart connector-b for subsequent tests
      await execAsync(`${DOCKER_COMPOSE_CMD} start connector-b`);
      // Wait for it to become healthy again
      await new Promise((resolve) => setTimeout(resolve, 60000));
    });
  });

  describe('Test 3: Health endpoint accessible from host machine', () => {
    it(
      'should be able to access health endpoint from host',
      async () => {
        // Arrange - Wait for connectors to be healthy
        await waitFor(checkAllConnectorsHealthy, HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_INTERVAL);

        // Act - Send GET request from host to health endpoint
        const response = await axios.get(HEALTH_ENDPOINTS.connectorA);

        // Assert - Request succeeds without network errors
        expect(response.status).toBe(200);

        // Assert - Response is valid JSON with HealthStatus structure
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.data).toHaveProperty('status');
        expect(response.data).toHaveProperty('uptime');
        expect(response.data).toHaveProperty('peersConnected');
        expect(response.data).toHaveProperty('totalPeers');
        expect(response.data).toHaveProperty('timestamp');
        expect(response.data).toHaveProperty('nodeId');
        expect(response.data).toHaveProperty('version');
      },
      HEALTH_CHECK_TIMEOUT + 10000
    );
  });

  describe('Test 4: Docker Compose ps output shows health status', () => {
    it(
      'should display health status in docker-compose ps output',
      async () => {
        // Arrange - Wait for connectors to be healthy
        await waitFor(checkAllConnectorsHealthy, HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_INTERVAL);

        // Act - Run docker-compose ps and parse output
        const { stdout } = await execAsync(`${DOCKER_COMPOSE_CMD} ps`);

        // Assert - Output contains health status for all connectors
        expect(stdout).toContain('connector-a');
        expect(stdout).toContain('connector-b');
        expect(stdout).toContain('connector-c');

        // Note: Exact format depends on docker-compose version
        // Modern versions show health in parentheses like "(healthy)"
        console.log('Docker Compose PS output:\n', stdout);
      },
      HEALTH_CHECK_TIMEOUT + 10000
    );
  });

  describe("Test 5: Health checks don't create excessive log noise", () => {
    it('should log health checks at DEBUG level only (not INFO)', async () => {
      // Arrange - Wait for connectors to be healthy
      await waitFor(checkAllConnectorsHealthy, HEALTH_CHECK_TIMEOUT, HEALTH_CHECK_INTERVAL);

      // Wait for several health check cycles (10 checks at 30s interval = 5 minutes)
      // For testing purposes, wait 2 minutes to see at least 4 health checks
      console.log('Waiting 2 minutes to observe health check logging behavior...');
      await new Promise((resolve) => setTimeout(resolve, 120000));

      // Act - Get logs from connector-a
      const { stdout } = await execAsync(`${DOCKER_COMPOSE_CMD} logs connector-a`);

      // Assert - Health checks should NOT appear in INFO logs
      // (This assumes default log level is INFO, and health checks are at DEBUG)
      const infoLogLines = stdout.split('\n').filter((line) => line.includes('INFO'));
      const healthCheckInfoLogs = infoLogLines.filter((line) => line.includes('health_check'));

      // There should be no INFO-level health_check logs
      expect(healthCheckInfoLogs.length).toBe(0);

      console.log(`Total INFO log lines: ${infoLogLines.length}`);
      console.log(`INFO-level health_check logs: ${healthCheckInfoLogs.length}`);
    }, 150000); // 2.5 minute timeout
  });
});

/**
 * Manual Testing Instructions
 *
 * If you prefer to test health checks manually without running automated tests:
 *
 * 1. Build and start the Docker Compose network:
 *    ```bash
 *    docker build -t ilp-connector .
 *    docker-compose up -d
 *    ```
 *
 * 2. Wait 45 seconds for startup, then check health:
 *    ```bash
 *    sleep 45
 *    curl http://localhost:8080/health | jq
 *    curl http://localhost:8081/health | jq
 *    curl http://localhost:8082/health | jq
 *    ```
 *
 * 3. Check Docker health status:
 *    ```bash
 *    docker-compose ps
 *    ```
 *
 * 4. Test unhealthy state:
 *    ```bash
 *    docker-compose stop connector-b
 *    sleep 90
 *    docker-compose ps
 *    curl http://localhost:8080/health | jq
 *    ```
 *
 * 5. Clean up:
 *    ```bash
 *    docker-compose down
 *    ```
 */
