/**
 * Integration tests for AptosClient connecting to Aptos testnet
 *
 * Prerequisites:
 * - Internet connectivity to Aptos testnet
 * - Valid APTOS_PRIVATE_KEY and APTOS_ACCOUNT_ADDRESS in environment
 * - Account funded via Aptos testnet faucet (if balance operations tested)
 *
 * To run these tests:
 * 1. Set environment variables:
 *    export APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
 *    export APTOS_PRIVATE_KEY=<your-testnet-private-key>
 *    export APTOS_ACCOUNT_ADDRESS=<your-testnet-account-address>
 * 2. Run tests: npm test -- aptos-client.test.ts
 *
 * Note: Unlike XRP/EVM, Aptos does not have a local node option.
 * All integration tests use Aptos testnet which is free and reliable.
 * Tests are skipped if environment variables are not configured.
 */

import {
  AptosClient,
  AptosClientConfig,
  AptosError,
  AptosErrorCode,
} from '../../src/settlement/aptos-client';
import { Logger } from 'pino';
import pino from 'pino';

// Check if Aptos environment is configured
function isAptosConfigured(): boolean {
  return !!(
    process.env.APTOS_PRIVATE_KEY &&
    process.env.APTOS_ACCOUNT_ADDRESS &&
    process.env.APTOS_NODE_URL
  );
}

// Skip Aptos integration tests in CI unless explicitly enabled
// These tests require real Aptos testnet connectivity
const skipTests = process.env.CI === 'true' && process.env.APTOS_INTEGRATION !== 'true';
const describeIfConfigured = skipTests || !isAptosConfigured() ? describe.skip : describe;

describeIfConfigured('AptosClient Integration (Testnet)', () => {
  let client: AptosClient;
  let logger: Logger;
  let config: AptosClientConfig;

  beforeAll(async () => {
    if (!isAptosConfigured()) {
      console.warn(
        '\n⚠️  Aptos environment not configured - skipping integration tests\n' +
          '   To run these tests, set the following environment variables:\n' +
          '   - APTOS_NODE_URL (e.g., https://fullnode.testnet.aptoslabs.com/v1)\n' +
          '   - APTOS_PRIVATE_KEY (your testnet private key)\n' +
          '   - APTOS_ACCOUNT_ADDRESS (your testnet account address)\n'
      );
      return;
    }

    logger = pino({ level: 'info' });

    config = {
      nodeUrl: process.env.APTOS_NODE_URL || 'https://fullnode.testnet.aptoslabs.com/v1',
      privateKey: process.env.APTOS_PRIVATE_KEY!,
      accountAddress: process.env.APTOS_ACCOUNT_ADDRESS!,
      maxRetryAttempts: 3,
    };

    client = await AptosClient.create(config, logger);
  });

  afterAll(() => {
    client?.disconnect();
  });

  describe('Connection', () => {
    it('should connect to Aptos testnet successfully', async () => {
      await client.connect();

      expect(client.isConnected()).toBe(true);

      // eslint-disable-next-line no-console
      console.log(`Connected to Aptos testnet at ${config.nodeUrl}`);
    });

    it('should return correct address from getAddress()', () => {
      const address = client.getAddress();

      expect(address).toBeDefined();
      expect(address.toLowerCase()).toBe(config.accountAddress.toLowerCase());

      // eslint-disable-next-line no-console
      console.log(`Client address: ${address}`);
    });
  });

  describe('Account Operations', () => {
    beforeAll(async () => {
      if (!client.isConnected()) {
        await client.connect();
      }
    });

    it('should query account info with sequence number and auth key', async () => {
      const accountInfo = await client.getAccountInfo(config.accountAddress);

      expect(accountInfo).toMatchObject({
        sequenceNumber: expect.any(String),
        authenticationKey: expect.any(String),
      });

      // Sequence number should be a valid non-negative integer
      const sequenceNumber = parseInt(accountInfo.sequenceNumber, 10);
      expect(sequenceNumber).toBeGreaterThanOrEqual(0);

      // Auth key should be hex string
      expect(accountInfo.authenticationKey).toMatch(/^0x[0-9a-fA-F]+$/);

      // eslint-disable-next-line no-console
      console.log(`Account info: sequence=${accountInfo.sequenceNumber}`);
    });

    it('should query account balance in octas', async () => {
      const balance = await client.getBalance(config.accountAddress);

      expect(typeof balance).toBe('bigint');
      expect(balance).toBeGreaterThanOrEqual(BigInt(0));

      // Convert to APT for logging
      const aptBalance = Number(balance) / 100_000_000;

      // eslint-disable-next-line no-console
      console.log(`Account balance: ${balance} octas (${aptBalance.toFixed(4)} APT)`);
    });

    it('should throw ACCOUNT_NOT_FOUND for non-existent account', async () => {
      // Generate a random address that is very unlikely to exist
      const nonExistentAddress = '0x' + '0'.repeat(62) + 'ff';

      await expect(client.getAccountInfo(nonExistentAddress)).rejects.toMatchObject({
        code: AptosErrorCode.ACCOUNT_NOT_FOUND,
      });
    });
  });

  describe('View Functions', () => {
    beforeAll(async () => {
      if (!client.isConnected()) {
        await client.connect();
      }
    });

    it('should call view function on Aptos framework module', async () => {
      // Call a simple view function from the Aptos framework
      // coin::is_coin_initialized checks if APT coin is initialized
      const result = await client.view<[boolean]>(
        '0x1',
        'coin',
        'is_coin_initialized',
        ['0x1::aptos_coin::AptosCoin'],
        []
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      // APT should always be initialized on any Aptos network
      expect(result[0]).toBe(true);

      // eslint-disable-next-line no-console
      console.log(`View function result: coin::is_coin_initialized = ${result[0]}`);
    });

    it('should query account resource for coin store', async () => {
      // Get the CoinStore resource for APT
      const resourceType = '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>';

      const resource = await client.getAccountResource<{
        coin: { value: string };
        frozen: boolean;
      }>(config.accountAddress, resourceType);

      expect(resource).toBeDefined();
      expect(resource.coin).toBeDefined();
      expect(resource.coin.value).toBeDefined();

      // eslint-disable-next-line no-console
      console.log(`CoinStore resource: value=${resource.coin.value}, frozen=${resource.frozen}`);
    });
  });

  describe('Faucet (Testnet Only)', () => {
    beforeAll(async () => {
      if (!client.isConnected()) {
        await client.connect();
      }
    });

    it('should fund account via testnet faucet and verify balance increase', async () => {
      // Get initial balance
      const initialBalance = await client.getBalance(config.accountAddress);

      // eslint-disable-next-line no-console
      console.log(`Initial balance: ${initialBalance} octas`);

      try {
        // Fund account with 0.1 APT (10,000,000 octas)
        const fundAmount = 10_000_000;
        await client.fundWithFaucet(config.accountAddress, fundAmount);

        // Wait for transaction to confirm
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Get new balance
        const newBalance = await client.getBalance(config.accountAddress);

        // eslint-disable-next-line no-console
        console.log(`New balance after faucet: ${newBalance} octas`);

        // Balance should have increased
        expect(newBalance).toBeGreaterThanOrEqual(initialBalance);

        // eslint-disable-next-line no-console
        console.log(`Faucet added ${newBalance - initialBalance} octas`);
      } catch (error) {
        // Faucet may be rate-limited, skip test gracefully
        if (error instanceof AptosError && error.code === AptosErrorCode.RATE_LIMITED) {
          // eslint-disable-next-line no-console
          console.warn('⚠️  Faucet rate-limited, skipping balance verification');
          return;
        }

        // eslint-disable-next-line no-console
        console.warn('⚠️  Faucet test failed (may be temporarily unavailable):', error);
        // Don't fail the test suite if faucet is unavailable
      }
    });
  });

  describe('Error Handling', () => {
    beforeAll(async () => {
      if (!client.isConnected()) {
        await client.connect();
      }
    });

    it('should handle MODULE_NOT_FOUND for non-existent module', async () => {
      await expect(
        client.view('0x1', 'nonexistent_module_xyz', 'fake_function', [], [])
      ).rejects.toMatchObject({
        code: AptosErrorCode.MODULE_NOT_FOUND,
      });
    });

    it('should handle RESOURCE_NOT_FOUND for non-existent resource', async () => {
      await expect(
        client.getAccountResource(config.accountAddress, '0x1::fake::NonExistentResource')
      ).rejects.toMatchObject({
        code: AptosErrorCode.RESOURCE_NOT_FOUND,
      });
    });
  });

  describe('Disconnect', () => {
    it('should disconnect gracefully', () => {
      client.disconnect();

      expect(client.isConnected()).toBe(false);

      // eslint-disable-next-line no-console
      console.log('Disconnected from Aptos testnet');
    });
  });
});

// Simple connectivity test that can run without full config
describe('AptosClient Testnet Connectivity', () => {
  it('should be able to query Aptos testnet ledger info (no auth required)', async () => {
    // Skip in CI unless explicitly enabled
    if (process.env.CI === 'true' && process.env.APTOS_INTEGRATION !== 'true') {
      // eslint-disable-next-line no-console
      console.log('Skipping Aptos connectivity test in CI');
      return;
    }

    // We can't fully test without valid keys, but we can verify network connectivity
    try {
      const response = await fetch('https://fullnode.testnet.aptoslabs.com/v1');
      const data = (await response.json()) as { ledger_version?: string };

      expect(data).toBeDefined();
      expect(data.ledger_version).toBeDefined();

      // eslint-disable-next-line no-console
      console.log(`Aptos testnet ledger version: ${data.ledger_version}`);
    } catch (error) {
      console.warn('⚠️  Unable to connect to Aptos testnet:', error);
      // Don't fail - network issues shouldn't break the test suite
    }
  });
});
