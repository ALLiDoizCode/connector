#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Network Setup Script for ILP Workflow Demo
 *
 * Configures payment channels and routing between:
 *   Facilitator → Connector1 → Connector2 → Workflow Peer
 *
 * Usage:
 *   node dist/workflow/setup-network.js
 */

interface PeerConfig {
  name: string;
  httpUrl: string;
  btpUrl: string;
  ilpAddress: string;
}

const peers: PeerConfig[] = [
  {
    name: 'Facilitator',
    httpUrl: 'http://localhost:8200',
    btpUrl: 'ws://localhost:3200',
    ilpAddress: 'g.facilitator',
  },
  {
    name: 'Connector 1',
    httpUrl: 'http://localhost:8201',
    btpUrl: 'ws://localhost:3201',
    ilpAddress: 'g.connector1',
  },
  {
    name: 'Connector 2',
    httpUrl: 'http://localhost:8202',
    btpUrl: 'ws://localhost:3202',
    ilpAddress: 'g.connector2',
  },
  {
    name: 'Workflow Peer',
    httpUrl: 'http://localhost:8203',
    btpUrl: 'ws://localhost:3203',
    ilpAddress: 'g.workflow',
  },
];

async function setupPaymentChannel(
  fromPeer: PeerConfig,
  toPeer: PeerConfig,
  initialBalance: number
): Promise<void> {
  console.log(`  ${fromPeer.name} → ${toPeer.name}`);

  try {
    const response = await fetch(`${fromPeer.httpUrl}/api/channels/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerHttpUrl: toPeer.httpUrl,
        peerBtpUrl: toPeer.btpUrl,
        peerIlpAddress: toPeer.ilpAddress,
        initialBalance: initialBalance.toString(),
        assetCode: 'USD',
        assetScale: 9, // millisatoshis
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to open channel: ${error}`);
    }

    const result = (await response.json()) as { channelId: string };
    console.log(`    ✓ Channel ID: ${result.channelId}`);
    console.log(`    ✓ Balance: ${initialBalance} msat`);
  } catch (error) {
    console.error(`    ✗ Error: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function setupRoute(
  onPeer: PeerConfig,
  destinationPrefix: string,
  nextHop: PeerConfig
): Promise<void> {
  console.log(`  ${onPeer.name}: ${destinationPrefix} → ${nextHop.name}`);

  try {
    const response = await fetch(`${onPeer.httpUrl}/api/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationPrefix,
        nextHopIlpAddress: nextHop.ilpAddress,
        nextHopHttpUrl: nextHop.httpUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to add route: ${error}`);
    }

    console.log(`    ✓ Route added`);
  } catch (error) {
    console.error(`    ✗ Error: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function registerWorkflowService(
  facilitator: PeerConfig,
  workflowPeer: PeerConfig
): Promise<void> {
  console.log(`  Registering image processing service...`);

  try {
    const response = await fetch(`${facilitator.httpUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Image Processing Pipeline',
        description: 'Resize, watermark, and optimize images',
        paymentPointer: '$workflow.local/image-processing',
        ilpAddress: 'g.workflow.resize.watermark.optimize',
        providerName: 'M2M Workflow Demo',
        providerIlpAddress: workflowPeer.ilpAddress,
        pricing: {
          steps: [
            { name: 'resize', costMsat: 100 },
            { name: 'watermark', costMsat: 200 },
            { name: 'optimize', costMsat: 150 },
          ],
          totalCost: 450,
        },
        capabilities: {
          maxImageSize: 10485760,
          supportedFormats: ['image/jpeg', 'image/png', 'image/webp'],
          estimatedProcessingTimeMs: 2000,
          availability: 99.9,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register service: ${error}`);
    }

    const result = (await response.json()) as { serviceId: string };
    console.log(`    ✓ Service registered: ${result.serviceId}`);
  } catch (error) {
    console.error(`    ✗ Error: ${error instanceof Error ? error.message : String(error)}`);
    // Don't throw - service registration is optional
  }
}

async function verifyPeerHealth(peer: PeerConfig): Promise<void> {
  try {
    const response = await fetch(`${peer.httpUrl}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `${peer.name} is not healthy: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('========================================');
  console.log('ILP Workflow Demo - Network Setup');
  console.log('========================================');
  console.log('');

  // Step 1: Verify all peers are healthy
  console.log('[Step 1/4] Verifying peer health...');
  for (const peer of peers) {
    process.stdout.write(`  ${peer.name}: `);
    try {
      await verifyPeerHealth(peer);
      console.log('✓');
    } catch (error) {
      console.log('✗');
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  console.log('');

  // Step 2: Setup payment channels
  console.log('[Step 2/4] Opening payment channels...');

  const facilitator = peers[0]!;
  const connector1 = peers[1]!;
  const connector2 = peers[2]!;
  const workflowPeer = peers[3]!;

  // Facilitator → Connector 1
  await setupPaymentChannel(facilitator, connector1, 1000000); // 1M msat

  // Connector 1 → Connector 2
  await setupPaymentChannel(connector1, connector2, 1000000);

  // Connector 2 → Workflow Peer
  await setupPaymentChannel(connector2, workflowPeer, 1000000);

  console.log('');

  // Step 3: Configure routes
  console.log('[Step 3/4] Configuring routes...');

  // Facilitator routes everything to Connector 1
  await setupRoute(facilitator, 'g.workflow', connector1);
  await setupRoute(facilitator, 'g.connector1', connector1);
  await setupRoute(facilitator, 'g.connector2', connector1);

  // Connector 1 routes workflow traffic to Connector 2
  await setupRoute(connector1, 'g.workflow', connector2);
  await setupRoute(connector1, 'g.connector2', connector2);

  // Connector 2 routes workflow traffic to Workflow Peer
  await setupRoute(connector2, 'g.workflow', workflowPeer);

  console.log('');

  // Step 4: Register workflow service with facilitator
  console.log('[Step 4/4] Registering workflow service...');
  await registerWorkflowService(facilitator, workflowPeer);

  console.log('');
  console.log('========================================');
  console.log('Network Setup Complete!');
  console.log('========================================');
  console.log('');
  console.log('Payment Channels:');
  console.log('  Facilitator → Connector 1: 1,000,000 msat');
  console.log('  Connector 1 → Connector 2: 1,000,000 msat');
  console.log('  Connector 2 → Workflow Peer: 1,000,000 msat');
  console.log('');
  console.log('Routing Table:');
  console.log('  Facilitator:');
  console.log('    g.workflow.* → Connector 1');
  console.log('  Connector 1:');
  console.log('    g.workflow.* → Connector 2');
  console.log('  Connector 2:');
  console.log('    g.workflow.* → Workflow Peer');
  console.log('');
  console.log('The network is ready for workflow requests!');
  console.log('');
}

main().catch((error) => {
  console.error('');
  console.error('Setup failed:', error.message);
  console.error('');
  process.exit(1);
});
