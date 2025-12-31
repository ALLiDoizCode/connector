/**
 * Test connector C that stays connected and sends telemetry
 */
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9000');

let intervalId;
const startTime = Date.now();

ws.on('open', () => {
  console.log('✅ Connected to telemetry server as connector-c');

  ws.send(
    JSON.stringify({
      type: 'REGISTER',
      nodeId: 'connector-c',
    })
  );

  intervalId = setInterval(() => {
    const nodeStatus = {
      type: 'NODE_STATUS',
      nodeId: 'connector-c',
      timestamp: new Date().toISOString(),
      data: {
        health: Math.random() > 0.8 ? 'degraded' : 'healthy',
        uptime: Date.now() - startTime,
        routes: [
          { prefix: 'g.bob', nextHop: 'peer-bob', priority: 0 },
          { prefix: 'g.frank', nextHop: 'peer-frank', priority: 0 },
        ],
        peers: [
          {
            peerId: 'peer-bob',
            url: 'ws://connector-bob:3000',
            connected: Math.random() > 0.3,
            lastSeen: new Date(Date.now() - Math.random() * 10000).toISOString(),
          },
          {
            peerId: 'peer-frank',
            url: 'ws://connector-frank:3000',
            connected: true,
            lastSeen: new Date(Date.now() - 500).toISOString(),
          },
        ],
      },
    };

    console.log('📤 Sending NODE_STATUS telemetry...');
    ws.send(JSON.stringify(nodeStatus));

    if (Math.random() > 0.3) {
      ws.send(
        JSON.stringify({
          type: 'PACKET_RECEIVED',
          nodeId: 'connector-c',
          timestamp: new Date().toISOString(),
          data: {
            packetId: `packet-${Math.random().toString(36).substr(2, 9)}`,
            from: 'peer-frank',
            amount: '500',
          },
        })
      );
    }

    if (Math.random() > 0.3) {
      ws.send(
        JSON.stringify({
          type: 'PACKET_SENT',
          nodeId: 'connector-c',
          timestamp: new Date().toISOString(),
          data: {
            packetId: `packet-${Math.random().toString(36).substr(2, 9)}`,
            to: 'peer-bob',
            amount: '500',
          },
        })
      );
    }
  }, 6000);

  const initialStatus = {
    type: 'NODE_STATUS',
    nodeId: 'connector-c',
    timestamp: new Date().toISOString(),
    data: {
      health: 'healthy',
      uptime: 0,
      routes: [
        { prefix: 'g.bob', nextHop: 'peer-bob', priority: 0 },
        { prefix: 'g.frank', nextHop: 'peer-frank', priority: 0 },
      ],
      peers: [
        {
          peerId: 'peer-bob',
          url: 'ws://connector-bob:3000',
          connected: true,
          lastSeen: new Date().toISOString(),
        },
        {
          peerId: 'peer-frank',
          url: 'ws://connector-frank:3000',
          connected: true,
          lastSeen: new Date().toISOString(),
        },
      ],
    },
  };

  console.log('📤 Sending initial NODE_STATUS...');
  ws.send(JSON.stringify(initialStatus));

  console.log('\n🔄 Connector C is running. Sending telemetry every 6 seconds.');
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
