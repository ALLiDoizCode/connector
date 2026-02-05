/**
 * Example Business Logic Server
 *
 * This is a simple example of a business logic server that handles
 * payment requests from the Agent Runtime.
 *
 * Replace this with your own business logic implementation.
 */

const http = require('http');

const PORT = process.env.PORT || 8080;

// Track payments for demo purposes
const payments = new Map();

/**
 * Handle incoming HTTP requests
 */
function handleRequest(req, res) {
  // Set CORS headers
  res.setHeader('Content-Type', 'application/json');

  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  // Payment setup hook (optional - called when SPSP endpoint is queried)
  if (req.method === 'POST' && req.url === '/payment-setup') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        console.log('Payment setup request:', request);

        // Allow all payment setups in this example
        // In production, you might validate the request or add metadata
        res.writeHead(200);
        res.end(
          JSON.stringify({
            allow: true,
            metadata: {
              receivedAt: new Date().toISOString(),
            },
          })
        );
      } catch (error) {
        console.error('Error parsing payment setup:', error);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Payment handler (called for each ILP packet)
  if (req.method === 'POST' && req.url === '/handle-payment') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        console.log('Payment request:', {
          paymentId: request.paymentId,
          amount: request.amount,
          destination: request.destination,
        });

        // Simple acceptance logic - accept all payments
        // In production, implement your business rules here:
        // - Check inventory
        // - Verify user accounts
        // - Apply rate limits
        // - etc.

        const amount = BigInt(request.amount);

        // Example: Reject payments over 1 million units
        if (amount > 1000000n) {
          console.log('Rejecting large payment:', request.paymentId);
          res.writeHead(200);
          res.end(
            JSON.stringify({
              accept: false,
              rejectReason: {
                code: 'invalid_amount',
                message: 'Payment amount exceeds maximum allowed',
              },
            })
          );
          return;
        }

        // Track the payment
        const existingAmount = payments.get(request.paymentId) || 0n;
        payments.set(request.paymentId, existingAmount + amount);

        console.log(
          'Accepting payment:',
          request.paymentId,
          'total:',
          payments.get(request.paymentId).toString()
        );

        res.writeHead(200);
        res.end(
          JSON.stringify({
            accept: true,
            // Optional: return data in the fulfill packet
            // data: Buffer.from('Thank you!').toString('base64'),
          })
        );
      } catch (error) {
        console.error('Error handling payment:', error);
        res.writeHead(500);
        res.end(
          JSON.stringify({
            accept: false,
            rejectReason: {
              code: 'internal_error',
              message: error.message,
            },
          })
        );
      }
    });
    return;
  }

  // List payments (for debugging)
  if (req.method === 'GET' && req.url === '/payments') {
    const paymentList = [];
    for (const [id, amount] of payments) {
      paymentList.push({ paymentId: id, totalAmount: amount.toString() });
    }
    res.writeHead(200);
    res.end(JSON.stringify({ payments: paymentList }));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Business logic server listening on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health         - Health check');
  console.log('  POST /payment-setup  - SPSP setup hook');
  console.log('  POST /handle-payment - Payment handler');
  console.log('  GET  /payments       - List received payments');
});
