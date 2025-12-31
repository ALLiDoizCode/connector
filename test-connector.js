/**
 * Test connector that stays connected and sends telemetry
 */
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9000');

let intervalId;

ws.on('open', () => {
  console.log('✅ Connected to telemetry server as connector-a');

  // Send connector registration
  ws.send(
    JSON.stringify({
      type: 'REGISTER',
      nodeId: 'connector-a',
    })
  );

  // Send NODE_STATUS telemetry event every 5 seconds
  intervalId = setInterval(() => {
    const nodeStatus = {
      type: 'NODE_STATUS',
      nodeId: 'connector-a',
      timestamp: new Date().toISOString(),
      data: {
        health: 'healthy',
        uptime: Date.now() - startTime,
        routes: [
          { prefix: 'g.alice', nextHop: 'peer-alice', priority: 0 },
          { prefix: 'g.bob', nextHop: 'peer-bob', priority: 0 },
          { prefix: 'g.charlie', nextHop: 'peer-charlie', priority: 1 },
        ],
        peers: [
          {
            peerId: 'peer-alice',
            url: 'ws://connector-alice:3000',
            connected: true,
            lastSeen: new Date(Date.now() - 5000).toISOString(),
          },
          {
            peerId: 'peer-bob',
            url: 'ws://connector-bob:3000',
            connected: false,
            lastSeen: new Date(Date.now() - 900000).toISOString(),
          },
          {
            peerId: 'peer-charlie',
            url: 'ws://connector-charlie:3000',
            connected: true,
            lastSeen: new Date(Date.now() - 2000).toISOString(),
          },
        ],
      },
    };

    console.log('📤 Sending NODE_STATUS telemetry...');
    ws.send(JSON.stringify(nodeStatus));

    // Send some packet events
    ws.send(
      JSON.stringify({
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: `packet-${Math.random().toString(36).substr(2, 9)}`,
          from: 'peer-alice',
          amount: '1000',
        },
      })
    );

    ws.send(
      JSON.stringify({
        type: 'PACKET_SENT',
        nodeId: 'connector-a',
        timestamp: new Date().toISOString(),
        data: {
          packetId: `packet-${Math.random().toString(36).substr(2, 9)}`,
          to: 'peer-bob',
          amount: '1000',
        },
      })
    );
  }, 5000);

  // Send initial NODE_STATUS immediately
  const initialStatus = {
    type: 'NODE_STATUS',
    nodeId: 'connector-a',
    timestamp: new Date().toISOString(),
    data: {
      health: 'healthy',
      uptime: 0,
      routes: [
        { prefix: 'g.alice', nextHop: 'peer-alice', priority: 0 },
        { prefix: 'g.bob', nextHop: 'peer-bob', priority: 0 },
        { prefix: 'g.charlie', nextHop: 'peer-charlie', priority: 1 },
      ],
      peers: [
        {
          peerId: 'peer-alice',
          url: 'ws://connector-alice:3000',
          connected: true,
          lastSeen: new Date().toISOString(),
        },
        {
          peerId: 'peer-bob',
          url: 'ws://connector-bob:3000',
          connected: false,
          lastSeen: new Date(Date.now() - 900000).toISOString(),
        },
        {
          peerId: 'peer-charlie',
          url: 'ws://connector-charlie:3000',
          connected: true,
          lastSeen: new Date().toISOString(),
        },
      ],
    },
  };

  console.log('📤 Sending initial NODE_STATUS...');
  ws.send(JSON.stringify(initialStatus));

  console.log('\n🔄 Connector is running. Sending telemetry every 5 seconds.');
  console.log(
    '📊 Dashboard should now show connector-a. Click on it to test the inspection panel!'
  );
  console.log('Press Ctrl+C to stop.\n');
});

const startTime = Date.now();

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('🔌 Disconnected from telemetry server');
  if (intervalId) {
    clearInterval(intervalId);
  }
  process.exit(0);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down...');
  ws.close();
});
