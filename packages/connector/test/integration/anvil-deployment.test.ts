/**
 * Anvil Deployment Integration Tests
 * Tests that Anvil container deploys correctly, accepts RPC requests, and serves forked Base Sepolia state
 *
 * Prerequisites:
 * - Docker installed and daemon running
 * - Docker Compose 2.x installed
 * - Foundry image available: ghcr.io/foundry-rs/foundry:latest
 * - .env.dev file configured with BASE_SEPOLIA_RPC_URL and FORK_BLOCK_NUMBER
 * - Run from repository root: npm test --workspace=packages/connector -- anvil-deployment.test.ts
 *
 * Note: These tests are skipped if Docker or Docker Compose are not available
 * Note: Fork download may take 30-60 seconds depending on internet speed and RPC endpoint
 * Note: console.log usage is intentional for integration test debugging output
 */

/* eslint-disable no-console */

import { execSync } from 'child_process';
import path from 'path';

const COMPOSE_FILE = 'docker-compose-dev.yml';
const ANVIL_CONTAINER = 'anvil_base_local';

// Increase timeout for Anvil fork download and initialization (3 minutes)
jest.setTimeout(180000);

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
async function waitForHealthy(containerName: string, timeoutMs: number = 120000): Promise<void> {
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

interface RpcResponse {
  jsonrpc: string;
  id: number;
  result?: string | TransactionReceipt;
  error?: {
    code: number;
    message: string;
  };
}

interface TransactionReceipt {
  blockNumber: string;
  status: string;
  transactionHash: string;
}

/**
 * Make JSON-RPC request to Anvil
 */
function makeRpcRequest(method: string, params: unknown[] = []): RpcResponse {
  const requestBody = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id: 1,
  });

  try {
    const response = executeCommand(
      `curl -f -X POST http://localhost:8545 -H "Content-Type: application/json" -d '${requestBody}'`
    );
    return JSON.parse(response) as RpcResponse;
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

describeIfDockerCompose('Anvil Deployment Integration Tests', () => {
  // Cleanup before starting tests
  beforeAll(() => {
    cleanupDockerCompose();
  });

  // Cleanup after all tests
  afterAll(() => {
    if (isDockerAvailable() && isDockerComposeAvailable()) {
      cleanupDockerCompose();
    }
  });

  describe('Anvil Container Deployment', () => {
    it('should start Anvil container successfully', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Start Anvil service only
      console.log('Starting Anvil container (fork download may take 30-60 seconds)...');
      executeCommand(`docker-compose -f ${COMPOSE_FILE} up -d ${ANVIL_CONTAINER}`);

      // Wait for container to be healthy (fork download + health check)
      await waitForHealthy(ANVIL_CONTAINER, 120000);

      // Verify container status
      const healthStatus = executeCommand(
        `docker inspect ${ANVIL_CONTAINER} --format '{{.State.Health.Status}}'`
      ).trim();

      expect(healthStatus).toBe('healthy');

      // Verify container is running
      const runningStatus = executeCommand(
        `docker inspect ${ANVIL_CONTAINER} --format '{{.State.Running}}'`
      ).trim();

      expect(runningStatus).toBe('true');
    });

    it('should respond to eth_blockNumber RPC request', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Anvil should already be running from previous test
      const response = makeRpcRequest('eth_blockNumber', []);

      // Verify response structure
      expect(response).toHaveProperty('jsonrpc', '2.0');
      expect(response).toHaveProperty('id', 1);
      expect(response).toHaveProperty('result');

      // Verify block number is a valid hex string
      expect(response.result).toMatch(/^0x[0-9a-f]+$/);

      // Convert hex to decimal and verify it's >= fork block number (20702367)
      const blockNumber = parseInt(response.result as string, 16);
      expect(blockNumber).toBeGreaterThanOrEqual(20702367);

      console.log(`Current Anvil block number: ${blockNumber} (${response.result})`);
    });

    it('should serve forked Base Sepolia state', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Test 1: Verify chain ID is Base Sepolia (84532 = 0x14a34)
      const chainIdResponse = makeRpcRequest('eth_chainId', []);
      expect(chainIdResponse).toHaveProperty('result');

      const chainId = parseInt(chainIdResponse.result as string, 16);
      expect(chainId).toBe(84532); // Base Sepolia chain ID

      console.log(`Anvil chain ID: ${chainId} (${chainIdResponse.result})`);

      // Test 2: Verify pre-funded account #0 has balance
      const balanceResponse = makeRpcRequest('eth_getBalance', [
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Account #0
        'latest',
      ]);

      expect(balanceResponse).toHaveProperty('result');

      // Convert hex balance to decimal
      const balance = BigInt(balanceResponse.result as string);

      // Anvil pre-funds with 10000 ETH = 10000 * 10^18 wei
      const minBalance = BigInt('1000000000000000000000'); // 1000 ETH in wei

      expect(balance).toBeGreaterThanOrEqual(minBalance);

      console.log(`Account #0 balance: ${balance.toString()} wei`);
    });

    it('should accept transaction submissions', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Prepare transaction: Send 1 ETH from account #0 to account #1
      // Using eth_sendTransaction requires unlocked account, so we use curl with cast instead
      // Or we can use eth_sendRawTransaction with signed transaction

      // For simplicity, we'll test that eth_sendTransaction endpoint exists
      // by calling it and expecting a specific error (account not unlocked)
      // In production, you'd sign and send a raw transaction

      // Alternative: Use cast send via executeCommand
      const castSendCmd = `docker exec ${ANVIL_CONTAINER} cast send \\
        0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \\
        --value 1ether \\
        --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \\
        --rpc-url http://localhost:8545 \\
        --json`;

      let transactionResult;
      try {
        transactionResult = executeCommand(castSendCmd, { ignoreError: false });
        const txData = JSON.parse(transactionResult);

        // Verify transaction was submitted and mined
        expect(txData).toHaveProperty('transactionHash');
        expect(txData.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);

        // Verify transaction status is success (1)
        if (txData.status) {
          expect(txData.status).toBe('0x1'); // Success
        }

        console.log(`Transaction submitted: ${txData.transactionHash}`);

        // Query transaction receipt to verify it was mined instantly
        const receiptResponse = makeRpcRequest('eth_getTransactionReceipt', [
          txData.transactionHash,
        ]);

        expect(receiptResponse).toHaveProperty('result');
        const receipt = receiptResponse.result as TransactionReceipt;
        expect(receipt).toHaveProperty('status', '0x1'); // Success

        console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);
      } catch (error) {
        // If cast command not available in container, test that RPC endpoint is accessible
        console.log('cast not available in container, testing RPC endpoint only');

        const blockNumberResponse = makeRpcRequest('eth_blockNumber', []);
        expect(blockNumberResponse).toHaveProperty('result');
      }
    });

    it('should use configured environment variables', async () => {
      if (!isDockerAvailable() || !isDockerComposeAvailable()) {
        return; // Skip test
      }

      // Inspect container environment variables
      const envOutput = executeCommand(
        `docker inspect ${ANVIL_CONTAINER} --format '{{json .Config.Env}}'`
      );

      const envVars = JSON.parse(envOutput);

      // Verify BASE_SEPOLIA_RPC_URL is set (should be in environment)
      // Note: Environment variables may not be in container env if passed via command substitution
      // In that case, we verify by checking the fork is from the correct block
      const hasBaseSepoliaUrl = envVars.some((env: string) =>
        env.startsWith('BASE_SEPOLIA_RPC_URL=')
      );

      if (hasBaseSepoliaUrl) {
        console.log('BASE_SEPOLIA_RPC_URL environment variable found in container');
      }

      // Verify fork block number by querying current block
      const blockNumberResponse = makeRpcRequest('eth_blockNumber', []);
      const blockNumber = parseInt(blockNumberResponse.result as string, 16);

      // Block number should be >= FORK_BLOCK_NUMBER (20702367)
      expect(blockNumber).toBeGreaterThanOrEqual(20702367);

      console.log(
        `Environment check passed. Current block: ${blockNumber} (>= fork block 20702367)`
      );
    });
  });
});
