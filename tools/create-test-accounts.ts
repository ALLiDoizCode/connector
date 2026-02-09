/**
 * Create TigerBeetle accounts for testing Story 19.3
 * Run this before sending test packets
 */

import { createLogger } from '../packages/connector/src/utils/logger';
import { TigerBeetleClient } from '../packages/connector/src/settlement/tigerbeetle-client';
import { AccountManager } from '../packages/connector/src/settlement/account-manager';

async function main(): Promise<void> {
  const logger = createLogger('account-creator', 'info');

  // Connect to TigerBeetle
  const client = new TigerBeetleClient(
    {
      clusterId: 0,
      replicaAddresses: ['127.0.0.1:3000'],
      connectionTimeout: 10000,
      operationTimeout: 10000,
    },
    logger
  );

  await client.initialize();
  logger.info('Connected to TigerBeetle');

  // Create AccountManager
  const accountManager = new AccountManager(
    {
      nodeId: 'peer1',
    },
    client,
    logger
  );

  // Create accounts for peer interactions
  const peers = ['unknown', 'send-packet-client', 'peer1', 'peer2'];
  const tokenId = 'ILP';

  for (const peerId of peers) {
    try {
      await accountManager.createPeerAccounts(peerId, tokenId);
      logger.info({ peerId, tokenId }, 'Created peer accounts');
    } catch (error) {
      logger.warn({ peerId, tokenId, error }, 'Failed to create accounts (may already exist)');
    }
  }

  await client.close();
  logger.info('Account creation complete');
}

main().catch(console.error);
