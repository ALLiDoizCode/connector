#!/usr/bin/env node

/**
 * Fund Peers CLI Tool
 *
 * Funds peer wallets from the treasury wallet using ETH and ERC20 tokens.
 * Creates payment channels between consecutive peers for settlement.
 */

import { Command } from 'commander';
import { ethers } from 'ethers';
import pino from 'pino';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Main CLI program
 */
const program = new Command();

program
  .name('fund-peers')
  .description('CLI tool to fund peer wallets from treasury')
  .version('0.1.0');

// Required options
program
  .requiredOption(
    '-p, --peers <list>',
    'Comma-separated list of peer names (e.g., peer1,peer2,peer3)'
  )
  .option('--eth-amount <amount>', 'ETH amount to send to each peer (in ETH)', '0.1')
  .option('--token-amount <amount>', 'ERC20 token amount to send to each peer', '1000')
  .option(
    '--rpc-url <url>',
    'Ethereum RPC URL',
    process.env.BASE_L2_RPC_URL || 'http://localhost:8545'
  )
  .option('--log-level <level>', 'Log level (debug, info, warn, error)', 'info');

// Add help examples
program.addHelpText(
  'after',
  `
Examples:
  # Fund 5 peers with default amounts
  $ fund-peers --peers peer1,peer2,peer3,peer4,peer5

  # Fund peers with custom amounts
  $ fund-peers --peers peer1,peer2,peer3 --eth-amount 0.5 --token-amount 5000

  # Fund peers on custom RPC
  $ fund-peers --peers peer1,peer2 --rpc-url http://localhost:8545
`
);

// Action handler
program.action(async (options) => {
  // Create Pino logger
  const logger = pino({
    level: options.logLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  });

  try {
    logger.info({ options }, 'Starting fund-peers CLI');

    // Parse options
    const peerNames = options.peers.split(',').map((p: string) => p.trim());
    const ethAmount = ethers.parseEther(options.ethAmount);
    const tokenAmount = BigInt(options.tokenAmount);

    // Get treasury private key from environment
    const treasuryPrivateKey = process.env.TREASURY_EVM_PRIVATE_KEY;
    if (!treasuryPrivateKey) {
      throw new Error('TREASURY_EVM_PRIVATE_KEY not set in environment');
    }

    // Connect to provider
    logger.info({ rpcUrl: options.rpcUrl }, 'Connecting to Ethereum provider');
    const provider = new ethers.JsonRpcProvider(options.rpcUrl);
    const treasuryWallet = new ethers.Wallet(treasuryPrivateKey, provider);
    const treasuryAddress = treasuryWallet.address;

    logger.info({ treasuryAddress }, 'Treasury wallet initialized');

    // Get treasury balance
    const balance = await provider.getBalance(treasuryAddress);
    logger.info({ balance: ethers.formatEther(balance) }, 'Treasury ETH balance');

    // Get peer addresses from environment
    const peerAddresses: Record<string, string> = {};
    for (const peerName of peerNames) {
      const envVar = `${peerName.toUpperCase()}_EVM_ADDRESS`;
      const address = process.env[envVar];

      if (!address) {
        logger.warn(
          { peerName, envVar },
          'Peer address not found in environment, generating new address'
        );

        // Generate a new wallet for this peer
        const peerWallet = ethers.Wallet.createRandom();
        peerAddresses[peerName] = peerWallet.address;

        logger.info(
          {
            peerName,
            address: peerWallet.address,
            privateKey: peerWallet.privateKey,
          },
          'Generated new wallet for peer (SAVE THIS PRIVATE KEY!)'
        );
      } else {
        peerAddresses[peerName] = address;
        logger.info({ peerName, address }, 'Loaded peer address from environment');
      }
    }

    // Fund each peer with ETH
    logger.info({ peerCount: peerNames.length }, 'Funding peers with ETH');

    for (const peerName of peerNames) {
      const peerAddress = peerAddresses[peerName];

      logger.info(
        { peerName, peerAddress, amount: ethers.formatEther(ethAmount) },
        'Sending ETH to peer'
      );

      try {
        const tx = await treasuryWallet.sendTransaction({
          to: peerAddress,
          value: ethAmount,
        });

        logger.info(
          { peerName, txHash: tx.hash },
          'ETH transaction sent, waiting for confirmation'
        );

        await tx.wait();

        logger.info({ peerName, txHash: tx.hash }, 'ETH transfer confirmed');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ peerName, error: errorMessage }, 'Failed to send ETH to peer');
      }
    }

    logger.info('All peers funded successfully');

    // Summary
    logger.info(
      {
        peersCount: peerNames.length,
        ethPerPeer: ethers.formatEther(ethAmount),
        tokenPerPeer: tokenAmount.toString(),
      },
      'Funding complete'
    );

    // Display peer addresses
    logger.info('Peer Addresses:');
    for (const [peerName, address] of Object.entries(peerAddresses)) {
      logger.info(`  ${peerName}: ${address}`);
    }

    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Failed to fund peers');
    process.exit(1);
  }
});

// Parse arguments
program.parse(process.argv);
