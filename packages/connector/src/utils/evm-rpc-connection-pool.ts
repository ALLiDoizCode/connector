import { Logger } from 'pino';
import type { JsonRpcProvider } from 'ethers';
import { ConnectionPool, ConnectionFactory } from './connection-pool';
import { requireOptional } from './optional-require';

/**
 * EVM RPC ConnectionFactory implementation for ethers.js JsonRpcProvider
 */
class EVMRPCConnectionFactory implements ConnectionFactory<JsonRpcProvider> {
  async create(endpoint: string): Promise<JsonRpcProvider> {
    const { ethers } = await requireOptional<typeof import('ethers')>('ethers', 'EVM settlement');
    const provider = new ethers.JsonRpcProvider(endpoint);
    // Verify connectivity by fetching block number
    await provider.getBlockNumber();
    return provider;
  }

  async disconnect(client: JsonRpcProvider): Promise<void> {
    client.destroy();
  }

  async healthCheck(client: JsonRpcProvider): Promise<boolean> {
    try {
      // Verify RPC endpoint is responsive by fetching current block number
      await client.getBlockNumber();
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * EVMRPCConnectionPool manages a pool of ethers.js JsonRpcProvider connections
 * for load balancing across multiple EVM RPC endpoints.
 */
export class EVMRPCConnectionPool extends ConnectionPool<JsonRpcProvider> {
  /**
   * Create an EVM RPC connection pool
   * @param rpcUrls - Array of RPC endpoint URLs (e.g., ["https://mainnet.base.org", "https://base.llamarpc.com"])
   * @param poolSize - Number of connections to create (default: 10)
   * @param logger - Pino logger instance
   */
  constructor(rpcUrls: string[], poolSize: number, logger: Logger) {
    const factory = new EVMRPCConnectionFactory();

    super(
      {
        poolSize,
        endpoints: rpcUrls,
      },
      factory,
      logger
    );
  }

  /**
   * Get an ethers.js JsonRpcProvider from the pool
   * Uses round-robin selection to distribute load across available connections.
   * Automatically reconnects unhealthy connections.
   * @returns ethers.JsonRpcProvider instance or null if no healthy connections available
   */
  getProvider(): JsonRpcProvider | null {
    const connection = this.getConnection();
    return connection ? connection.client : null;
  }
}
