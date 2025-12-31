/**
 * Integration tests for TelemetryServer
 * Tests real WebSocket connections and message flow
 */

import { TelemetryServer } from './telemetry-server';
import { logger } from './logger';
import WebSocket from 'ws';

describe('TelemetryServer Integration Tests', () => {
  let server: TelemetryServer;
  const TEST_PORT = 9999;
  const TEST_WS_URL = `ws://localhost:${TEST_PORT}`;

  beforeEach(() => {
    server = new TelemetryServer(TEST_PORT, logger);
  });

  afterEach(() => {
    if (server) {
      server.stop();
    }
  });

  describe('Server Startup and Port Binding', () => {
    test('should start server and listen on configured port', (done) => {
      server.start();

      // Attempt to connect to verify server is listening
      const ws = new WebSocket(TEST_WS_URL);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (error) => {
        done(error);
      });
    });

    test('should accept multiple WebSocket connections', (done) => {
      server.start();

      const ws1 = new WebSocket(TEST_WS_URL);
      const ws2 = new WebSocket(TEST_WS_URL);

      let openCount = 0;

      const handleOpen = () => {
        openCount++;
        if (openCount === 2) {
          ws1.close();
          ws2.close();
          done();
        }
      };

      ws1.on('open', handleOpen);
      ws2.on('open', handleOpen);
    });
  });

  describe('Message Reception and Validation', () => {
    test('should accept valid NODE_STATUS telemetry message', (done) => {
      server.start();

      const ws = new WebSocket(TEST_WS_URL);

      ws.on('open', () => {
        const validMessage = {
          type: 'NODE_STATUS',
          nodeId: 'connector-test',
          timestamp: new Date().toISOString(),
          data: {
            routes: [],
            peers: [],
            health: 'healthy',
            uptime: 100,
            peersConnected: 0,
            totalPeers: 0,
          },
        };

        ws.send(JSON.stringify(validMessage));

        // Wait a bit to ensure message is processed
        setTimeout(() => {
          ws.close();
          done();
        }, 100);
      });
    });

    test('should handle malformed JSON gracefully', (done) => {
      server.start();

      const ws = new WebSocket(TEST_WS_URL);

      ws.on('open', () => {
        // Send invalid JSON
        ws.send('{invalid json}');

        // Server should not crash - wait and verify connection still works
        setTimeout(() => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          done();
        }, 100);
      });
    });

    test('should reject message with missing required fields', (done) => {
      server.start();

      const ws = new WebSocket(TEST_WS_URL);

      ws.on('open', () => {
        // Message missing nodeId and timestamp
        const invalidMessage = {
          type: 'NODE_STATUS',
          data: {},
        };

        ws.send(JSON.stringify(invalidMessage));

        // Server should not crash
        setTimeout(() => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          done();
        }, 100);
      });
    });
  });

  describe('Broadcasting Mechanism', () => {
    test('should broadcast telemetry to all connected clients', (done) => {
      server.start();

      // Connect a connector
      const connector = new WebSocket(TEST_WS_URL);

      // Connect two browser clients
      const client1 = new WebSocket(TEST_WS_URL);
      const client2 = new WebSocket(TEST_WS_URL);

      let client1Received = false;
      let client2Received = false;

      client1.on('open', () => {
        // Identify as client
        client1.send(
          JSON.stringify({
            type: 'CLIENT_CONNECT',
            nodeId: 'client1',
            timestamp: new Date().toISOString(),
            data: {},
          })
        );
      });

      client2.on('open', () => {
        // Identify as client
        client2.send(
          JSON.stringify({
            type: 'CLIENT_CONNECT',
            nodeId: 'client2',
            timestamp: new Date().toISOString(),
            data: {},
          })
        );
      });

      client1.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'PACKET_SENT') {
          client1Received = true;
          checkComplete();
        }
      });

      client2.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'PACKET_SENT') {
          client2Received = true;
          checkComplete();
        }
      });

      const checkComplete = () => {
        if (client1Received && client2Received) {
          connector.close();
          client1.close();
          client2.close();
          done();
        }
      };

      // Wait for all connections to establish, then send telemetry
      setTimeout(() => {
        connector.send(
          JSON.stringify({
            type: 'PACKET_SENT',
            nodeId: 'connector-a',
            timestamp: new Date().toISOString(),
            data: {
              packetId: 'test-packet',
              nextHop: 'connector-b',
              timestamp: new Date().toISOString(),
            },
          })
        );
      }, 200);
    }, 10000);
  });

  describe('Connection Lifecycle', () => {
    test('should handle connector disconnection', (done) => {
      server.start();

      const ws = new WebSocket(TEST_WS_URL);

      ws.on('open', () => {
        // Register as connector
        ws.send(
          JSON.stringify({
            type: 'NODE_STATUS',
            nodeId: 'connector-test',
            timestamp: new Date().toISOString(),
            data: {
              routes: [],
              peers: [],
              health: 'healthy',
              uptime: 0,
              peersConnected: 0,
              totalPeers: 0,
            },
          })
        );

        // Disconnect after registration
        setTimeout(() => {
          ws.close();
        }, 100);
      });

      ws.on('close', () => {
        // Verify server still operational by connecting again
        const newWs = new WebSocket(TEST_WS_URL);
        newWs.on('open', () => {
          newWs.close();
          done();
        });
      });
    });

    test('should handle client disconnection gracefully', (done) => {
      server.start();

      const ws = new WebSocket(TEST_WS_URL);

      ws.on('open', () => {
        // Identify as client
        ws.send(
          JSON.stringify({
            type: 'CLIENT_CONNECT',
            nodeId: 'client',
            timestamp: new Date().toISOString(),
            data: {},
          })
        );

        setTimeout(() => {
          ws.close();
        }, 100);
      });

      ws.on('close', () => {
        // Verify server still operational
        const newWs = new WebSocket(TEST_WS_URL);
        newWs.on('open', () => {
          newWs.close();
          done();
        });
      });
    });
  });

  describe('Concurrent Connections', () => {
    test('should handle multiple connectors and clients concurrently', (done) => {
      server.start();

      const connector1 = new WebSocket(TEST_WS_URL);
      const connector2 = new WebSocket(TEST_WS_URL);
      const connector3 = new WebSocket(TEST_WS_URL);
      const client1 = new WebSocket(TEST_WS_URL);
      const client2 = new WebSocket(TEST_WS_URL);

      let connectionsReady = 0;
      const totalConnections = 5;

      const handleReady = () => {
        connectionsReady++;
        if (connectionsReady === totalConnections) {
          // All connections established
          // Send telemetry from connector1
          connector1.send(
            JSON.stringify({
              type: 'NODE_STATUS',
              nodeId: 'connector-1',
              timestamp: new Date().toISOString(),
              data: {
                routes: [],
                peers: [],
                health: 'healthy',
                uptime: 0,
                peersConnected: 0,
                totalPeers: 0,
              },
            })
          );
        }
      };

      let messagesReceived = 0;

      client1.on('message', () => {
        messagesReceived++;
        if (messagesReceived === 2) {
          // Both clients received the message
          connector1.close();
          connector2.close();
          connector3.close();
          client1.close();
          client2.close();
          done();
        }
      });

      client2.on('message', () => {
        messagesReceived++;
        if (messagesReceived === 2) {
          connector1.close();
          connector2.close();
          connector3.close();
          client1.close();
          client2.close();
          done();
        }
      });

      connector1.on('open', handleReady);
      connector2.on('open', handleReady);
      connector3.on('open', handleReady);

      client1.on('open', () => {
        client1.send(
          JSON.stringify({
            type: 'CLIENT_CONNECT',
            nodeId: 'client1',
            timestamp: new Date().toISOString(),
            data: {},
          })
        );
        handleReady();
      });

      client2.on('open', () => {
        client2.send(
          JSON.stringify({
            type: 'CLIENT_CONNECT',
            nodeId: 'client2',
            timestamp: new Date().toISOString(),
            data: {},
          })
        );
        handleReady();
      });
    }, 10000);
  });
});
