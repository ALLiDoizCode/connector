/**
 * Test script to send mock telemetry data to the dashboard
 */
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9000');

ws.on('open', () => {
  console.log('Connected to telemetry server');

  // Send connector registration
  ws.send(
    JSON.stringify({
      type: 'REGISTER',
      nodeId: 'connector-a',
    })
  );

  // Send NODE_STATUS telemetry event
  setTimeout(() => {
    const nodeStatus = {
      type: 'NODE_STATUS',
      nodeId: 'connector-a',
      timestamp: new Date().toISOString(),
      data: {
        health: 'healthy',
        uptime: 7200000, // 2 hours
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
            lastSeen: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
          },
          {
            peerId: 'peer-bob',
            url: 'ws://connector-bob:3000',
            connected: false,
            lastSeen: new Date(Date.now() - 900000).toISOString(), // 15 minutes ago
          },
          {
            peerId: 'peer-charlie',
            url: 'ws://connector-charlie:3000',
            connected: true,
            lastSeen: new Date(Date.now() - 2000).toISOString(), // 2 seconds ago
          },
        ],
      },
    };

    console.log('Sending NODE_STATUS event:', JSON.stringify(nodeStatus, null, 2));
    ws.send(JSON.stringify(nodeStatus));

    // Send some packet events for statistics
    setTimeout(() => {
      // PACKET_RECEIVED events
      for (let i = 0; i < 5; i++) {
        ws.send(
          JSON.stringify({
            type: 'PACKET_RECEIVED',
            nodeId: 'connector-a',
            timestamp: new Date().toISOString(),
            data: {
              packetId: `packet-${i}`,
              from: 'peer-alice',
              amount: '1000',
            },
          })
        );
      }

      // PACKET_SENT events (forwarded)
      for (let i = 0; i < 4; i++) {
        ws.send(
          JSON.stringify({
            type: 'PACKET_SENT',
            nodeId: 'connector-a',
            timestamp: new Date().toISOString(),
            data: {
              packetId: `packet-${i}`,
              to: 'peer-bob',
              amount: '1000',
            },
          })
        );
      }

      // PACKET_REJECT event
      ws.send(
        JSON.stringify({
          type: 'PACKET_REJECT',
          nodeId: 'connector-a',
          timestamp: new Date().toISOString(),
          data: {
            packetId: 'packet-4',
            reason: 'Insufficient liquidity',
          },
        })
      );

      console.log('Sent packet statistics events (5 received, 4 forwarded, 1 rejected)');
      console.log('\nMock telemetry data sent successfully!');
      console.log(
        'Dashboard should now show connector-a. Click on the node to test the inspection panel.'
      );
    }, 1000);
  }, 500);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('Disconnected from telemetry server');
  process.exit(0);
});
