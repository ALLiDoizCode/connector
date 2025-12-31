/**
 * Test connector B that stays connected and sends telemetry
 */
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9000');

let intervalId;
const startTime = Date.now();

ws.on('open', () => {
  console.log('✅ Connected to telemetry server as connector-b');

  ws.send(
    JSON.stringify({
      type: 'REGISTER',
      nodeId: 'connector-b',
    })
  );

  intervalId = setInterval(() => {
    const nodeStatus = {
      type: 'NODE_STATUS',
      nodeId: 'connector-b',
      timestamp: new Date().toISOString(),
      data: {
        health: 'healthy',
        uptime: Date.now() - startTime,
        routes: [
          { prefix: 'g.alice', nextHop: 'peer-alice', priority: 1 },
          { prefix: 'g.dave', nextHop: 'peer-dave', priority: 0 },
          { prefix: 'g.eve', nextHop: 'peer-eve', priority: 0 },
        ],
        peers: [
          {
            peerId: 'peer-alice',
            url: 'ws://connector-alice:3000',
            connected: true,
            lastSeen: new Date(Date.now() - 3000).toISOString(),
          },
          {
            peerId: 'peer-dave',
            url: 'ws://connector-dave:3000',
            connected: true,
            lastSeen: new Date(Date.now() - 1000).toISOString(),
          },
          {
            peerId: 'peer-eve',
            url: 'ws://connector-eve:3000',
            connected: false,
            lastSeen: new Date(Date.now() - 1800000).toISOString(),
          },
        ],
      },
    };

    console.log('📤 Sending NODE_STATUS telemetry...');
    ws.send(JSON.stringify(nodeStatus));

    ws.send(
      JSON.stringify({
        type: 'PACKET_RECEIVED',
        nodeId: 'connector-b',
        timestamp: new Date().toISOString(),
        data: {
          packetId: `packet-${Math.random().toString(36).substr(2, 9)}`,
          from: 'peer-dave',
          amount: '2500',
        },
      })
    );

    ws.send(
      JSON.stringify({
        type: 'PACKET_SENT',
        nodeId: 'connector-b',
        timestamp: new Date().toISOString(),
        data: {
          packetId: `packet-${Math.random().toString(36).substr(2, 9)}`,
          to: 'peer-alice',
          amount: '2500',
        },
      })
    );
  }, 4000);

  const initialStatus = {
    type: 'NODE_STATUS',
    nodeId: 'connector-b',
    timestamp: new Date().toISOString(),
    data: {
      health: 'healthy',
      uptime: 0,
      routes: [
        { prefix: 'g.alice', nextHop: 'peer-alice', priority: 1 },
        { prefix: 'g.dave', nextHop: 'peer-dave', priority: 0 },
        { prefix: 'g.eve', nextHop: 'peer-eve', priority: 0 },
      ],
      peers: [
        {
          peerId: 'peer-alice',
          url: 'ws://connector-alice:3000',
          connected: true,
          lastSeen: new Date().toISOString(),
        },
        {
          peerId: 'peer-dave',
          url: 'ws://connector-dave:3000',
          connected: true,
          lastSeen: new Date().toISOString(),
        },
        {
          peerId: 'peer-eve',
          url: 'ws://connector-eve:3000',
          connected: false,
          lastSeen: new Date(Date.now() - 1800000).toISOString(),
        },
      ],
    },
  };

  console.log('📤 Sending initial NODE_STATUS...');
  ws.send(JSON.stringify(initialStatus));

  console.log('\n🔄 Connector B is running. Sending telemetry every 4 seconds.');
  console.log('Press Ctrl+C to stop.\n');
});

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

process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down...');
  ws.close();
});
