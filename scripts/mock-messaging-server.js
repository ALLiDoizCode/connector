#!/usr/bin/env node
/**
 * Mock Messaging Server for Epic 32 UI Testing
 *
 * Provides mock endpoints for:
 * - HTTP POST /api/route-giftwrap (port 3002)
 * - WebSocket for message delivery (port 3003)
 *
 * Usage:
 *   node scripts/mock-messaging-server.js
 */

const http = require('http');
const { WebSocketServer } = require('ws');

// Configuration
const HTTP_PORT = 3002;
const WS_PORT = 3003;

// Store connected WebSocket clients
const clients = new Map();

// Create HTTP server for POST /api/route-giftwrap
const httpServer = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', mock: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/route-giftwrap') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { giftwrap, recipient, amount } = JSON.parse(body);

        console.log('\n--- Received Giftwrap ---');
        console.log('Recipient:', recipient);
        console.log('Amount:', amount, 'msat');
        console.log('Giftwrap Kind:', giftwrap?.kind);
        console.log('Giftwrap Pubkey:', giftwrap?.pubkey?.substring(0, 16) + '...');

        // Simulate routing delay (1-3 seconds)
        const delay = 1000 + Math.random() * 2000;

        setTimeout(() => {
          // Generate mock fulfillment
          const fulfillment = Buffer.from(
            Array(32)
              .fill(0)
              .map(() => Math.floor(Math.random() * 256))
          ).toString('base64');

          console.log('Routing complete! Latency:', Math.round(delay), 'ms');

          // Send to any connected WebSocket clients (simulating Bob receiving)
          clients.forEach((ws, clientId) => {
            console.log('Forwarding to WebSocket client:', clientId);
            ws.send(
              JSON.stringify({
                type: 'giftwrap',
                data: giftwrap,
                amount: amount.toString(),
              })
            );
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              fulfill: fulfillment,
              latency: Math.round(delay),
            })
          );
        }, delay);
      } catch (error) {
        console.error('Error processing request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Create WebSocket server for message delivery
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', 'ws://localhost');
  const clientId = url.searchParams.get('clientId') || `client-${Date.now()}`;

  console.log('\nWebSocket client connected:', clientId);
  clients.set(clientId, ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected:', clientId);
    clients.delete(clientId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error for', clientId, ':', error);
  });
});

// Start servers
httpServer.listen(HTTP_PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       Epic 32 Mock Messaging Server                        ║
╠════════════════════════════════════════════════════════════╣
║  HTTP API:    http://localhost:${HTTP_PORT}/api/route-giftwrap     ║
║  WebSocket:   ws://localhost:${WS_PORT}                            ║
║  Health:      http://localhost:${HTTP_PORT}/health                 ║
╠════════════════════════════════════════════════════════════╣
║  This is a MOCK server for UI testing only.                ║
║  No actual ILP routing or Aptos settlement occurs.         ║
╚════════════════════════════════════════════════════════════╝
`);
});

wss.on('listening', () => {
  console.log('WebSocket server listening on port', WS_PORT);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  httpServer.close();
  wss.close();
  process.exit(0);
});
