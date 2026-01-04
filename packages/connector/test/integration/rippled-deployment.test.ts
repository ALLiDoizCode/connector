/**
 * rippled Deployment Integration Tests
 * Tests that rippled container deploys correctly, accepts RPC requests, and operates in standalone mode
 *
 * Prerequisites:
 * - Docker installed and daemon running
 * - Docker Compose 2.x installed
 * - rippled image available: xrpllabsofficial/xrpld:latest
 * - Run from repository root: npm test --workspace=packages/connector -- rippled-deployment.test.ts
 *
 * Note: These tests are skipped if Docker or Docker Compose are not available
 * Note: rippled initialization takes ~10-15 seconds
 * Note: console.log usage is intentional for integration test debugging output
 */

/* eslint-disable no-console */

import { execSync } from 'child_process';
import path from 'path';

const COMPOSE_FILE = 'docker-compose-dev.yml';
const RIPPLED_CONTAINER = 'rippled_standalone';

// Increase timeout for rippled initialization (2 minutes)
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
  } catch (error: unknown) {
    if (options.ignoreError) {
      const execError = error as { stdout?: string };
      return execError.stdout || '';
    }
    throw error;
  }
}

/**
 * Cleanup Docker Compose resources
 */
function cleanupDockerCompose(): void {
  try {
    executeCommand(`docker-compose -f ${COMPOSE_FILE} stop rippled`, {
      ignoreError: true,
    });
    // Note: Do NOT remove volume to preserve ledger state for subsequent test runs
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
        console.log(`Container ${containerName} is healthy (took ${Date.now() - startTime}ms)`);
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

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // If timeout reached, get container logs for debugging
  try {
    const logs = executeCommand(`docker logs ${containerName}`, { ignoreError: true });
    console.error(`Container ${containerName} logs:\n${logs}`);
  } catch {
    // Ignore log retrieval errors
  }

  throw new Error(`Container ${containerName} did not become healthy within ${timeoutMs}ms`);
}

// TypeScript interfaces for rippled RPC responses
interface RpcResponse<T = unknown> {
  result: T;
  status?: string;
  error?: {
    error: string;
    error_code: number;
    error_message: string;
  };
}

interface ServerInfoResult {
  info: {
    build_version: string;
    complete_ledgers: string;
    validated_ledger?: {
      seq: number;
      hash: string;
      base_fee_xrp: number;
    };
    server_state: string;
  };
  status: string;
}

interface WalletProposeResult {
  account_id: string;
  master_seed: string;
  public_key: string;
  status: string;
}

interface LedgerAcceptResult {
  ledger_current_index: number;
  status: string;
}

/**
 * Make JSON-RPC request to rippled
 */
function makeRpcRequest<T = unknown>(method: string, params: unknown[] = []): RpcResponse<T> {
  const requestBody = JSON.stringify({
    method,
    params,
  });

  try {
    const response = executeCommand(
      `curl -f -X POST http://localhost:5005 -H "Content-Type: application/json" -d '${requestBody}'`
    );
    return JSON.parse(response) as RpcResponse<T>;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`RPC request failed: ${errorMessage}`);
  }
}

// Check if Docker and Docker Compose are available
const dockerAvailable = isDockerAvailable();
const composeAvailable = isDockerComposeAvailable();
const e2eEnabled = process.env.E2E_TESTS === 'true';

// Skip tests if Docker/Compose not available or E2E tests not enabled
const describeIfDockerCompose =
  dockerAvailable && composeAvailable && e2eEnabled ? describe : describe.skip;

describeIfDockerCompose('rippled Deployment Integration Tests', () => {
  // Start rippled before tests
  beforeAll(async () => {
    if (!isDockerAvailable() || !isDockerComposeAvailable()) {
      return;
    }

    console.log('Starting rippled container (initialization ~10-15 seconds)...');
    executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d rippled`);

    // Wait for rippled to become healthy
    await waitForHealthy(RIPPLED_CONTAINER, 60000);
  });

  // Cleanup after all tests
  afterAll(() => {
    if (isDockerAvailable() && isDockerComposeAvailable()) {
      cleanupDockerCompose();
    }
  });

  describe('rippled Container Deployment', () => {
    it('should start rippled container successfully', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Verify container status
      const healthStatus = executeCommand(
        `docker inspect ${RIPPLED_CONTAINER} --format '{{.State.Health.Status}}'`
      ).trim();

      expect(healthStatus).toBe('healthy');

      // Verify container is running
      const runningStatus = executeCommand(
        `docker inspect ${RIPPLED_CONTAINER} --format '{{.State.Running}}'`
      ).trim();

      expect(runningStatus).toBe('true');

      console.log('rippled container is running and healthy');
    });

    it('should respond to server_info RPC request', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Make server_info RPC request
      const response = makeRpcRequest<ServerInfoResult>('server_info', []);

      // Verify response structure
      expect(response).toHaveProperty('result');
      expect(response.result).toHaveProperty('info');

      const info = response.result.info;

      // Verify server info contains expected fields
      expect(info).toHaveProperty('build_version');
      expect(info.build_version).toMatch(/^\d+\.\d+\.\d+/); // Version format: 1.12.0

      expect(info).toHaveProperty('complete_ledgers');
      expect(info).toHaveProperty('server_state');

      console.log(`rippled version: ${info.build_version}`);
      console.log(`Server state: ${info.server_state}`);
      console.log(`Complete ledgers: ${info.complete_ledgers}`);

      // Verify validated_ledger exists (ledger is initialized)
      if (info.validated_ledger) {
        expect(info.validated_ledger).toHaveProperty('seq');
        expect(info.validated_ledger.seq).toBeGreaterThanOrEqual(1);
        console.log(`Current ledger index: ${info.validated_ledger.seq}`);
      }
    });

    it('should create new account with wallet_propose', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Create account with deterministic passphrase
      const response = makeRpcRequest<WalletProposeResult>('wallet_propose', [
        { passphrase: 'test-account-1' },
      ]);

      // Verify response structure
      expect(response).toHaveProperty('result');
      expect(response.result).toHaveProperty('status', 'success');

      const result = response.result;

      // Verify account_id (XRP Ledger address)
      expect(result).toHaveProperty('account_id');
      expect(result.account_id).toMatch(/^r[a-zA-Z0-9]{24,34}$/); // XRP address starts with 'r'

      // Verify master_seed (secret key)
      expect(result).toHaveProperty('master_seed');
      expect(result.master_seed).toMatch(/^s[a-zA-Z0-9]{20,30}$/); // Secret starts with 's'

      // Verify public_key
      expect(result).toHaveProperty('public_key');

      console.log(`Created account: ${result.account_id}`);
      console.log(`Master seed: ${result.master_seed}`);
    });

    it('should accept manual ledger advancement', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Get current ledger index
      const serverInfoBefore = makeRpcRequest<ServerInfoResult>('server_info', []);
      const ledgerIndexBefore = serverInfoBefore.result.info.validated_ledger?.seq || 0;

      console.log(`Ledger index before advancement: ${ledgerIndexBefore}`);

      // Advance ledger manually
      const ledgerAcceptResponse = makeRpcRequest<LedgerAcceptResult>('ledger_accept', []);

      // Verify ledger_accept response
      expect(ledgerAcceptResponse).toHaveProperty('result');
      expect(ledgerAcceptResponse.result).toHaveProperty('status', 'success');
      expect(ledgerAcceptResponse.result).toHaveProperty('ledger_current_index');

      const ledgerIndexAfter = ledgerAcceptResponse.result.ledger_current_index;

      console.log(`Ledger index after advancement: ${ledgerIndexAfter}`);

      // Verify ledger advanced by 1
      expect(ledgerIndexAfter).toBe(ledgerIndexBefore + 1);

      // Query server_info again to confirm ledger index increased
      const serverInfoAfter = makeRpcRequest<ServerInfoResult>('server_info', []);
      const validatedLedgerIndex = serverInfoAfter.result.info.validated_ledger?.seq || 0;

      expect(validatedLedgerIndex).toBeGreaterThanOrEqual(ledgerIndexAfter);

      console.log(`Ledger advancement confirmed: ${ledgerIndexBefore} → ${ledgerIndexAfter}`);
    });

    it('should persist ledger data across restarts', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Advance ledger to a known index (e.g., 5)
      console.log('Advancing ledger to index 5...');
      for (let i = 0; i < 5; i++) {
        makeRpcRequest<LedgerAcceptResult>('ledger_accept', []);
      }

      // Get current ledger index
      const serverInfoBefore = makeRpcRequest<ServerInfoResult>('server_info', []);
      const ledgerIndexBefore = serverInfoBefore.result.info.validated_ledger?.seq || 0;

      console.log(`Ledger index before restart: ${ledgerIndexBefore}`);
      expect(ledgerIndexBefore).toBeGreaterThanOrEqual(5);

      // Stop rippled container
      console.log('Stopping rippled container...');
      executeCommand(`docker-compose -f ${COMPOSE_FILE} stop rippled`);

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Restart rippled container
      console.log('Restarting rippled container...');
      executeCommand(`docker-compose -f ${COMPOSE_FILE} start rippled`);

      // Wait for health check to pass
      await waitForHealthy(RIPPLED_CONTAINER, 30000);

      // Get ledger index after restart
      const serverInfoAfter = makeRpcRequest<ServerInfoResult>('server_info', []);
      const ledgerIndexAfter = serverInfoAfter.result.info.validated_ledger?.seq || 0;

      console.log(`Ledger index after restart: ${ledgerIndexAfter}`);

      // Verify ledger state persisted (index >= 5)
      expect(ledgerIndexAfter).toBeGreaterThanOrEqual(5);

      console.log(`Ledger persistence verified: ${ledgerIndexBefore} → ${ledgerIndexAfter}`);
    });
  });
});
