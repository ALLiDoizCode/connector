/**
 * ILP Business Logic Server - TypeScript Boilerplate
 *
 * This server handles payment requests from the ILP Agent Runtime.
 * Implement your custom business logic in the handler functions below.
 *
 * Endpoints:
 *   POST /handle-payment  - Process incoming ILP payments
 *   POST /payment-setup   - (Optional) Customize SPSP payment setup
 *   GET  /health          - Health check
 *
 * Usage:
 *   npm install
 *   npm run build
 *   npm start
 *
 * Or for development:
 *   npm run dev
 */

import express, { Request, Response } from 'express';
import {
  PaymentRequest,
  PaymentResponse,
  PaymentSetupRequest,
  PaymentSetupResponse,
} from './types';

const app = express();
const PORT = process.env.PORT || 8080;

// Parse JSON bodies
app.use(express.json());

// ============================================================
// IMPLEMENT YOUR BUSINESS LOGIC HERE
// ============================================================

/**
 * Handle incoming ILP payment.
 *
 * This is the main entry point for your business logic.
 * Called for each ILP payment packet that arrives.
 *
 * @param request - Payment details from Agent Runtime
 * @returns Response indicating accept/reject
 *
 * Example use cases:
 * - E-commerce: Check inventory, create order, fulfill payment
 * - API monetization: Track usage, enforce rate limits
 * - Micropayments: Accumulate small payments, provide access
 * - Streaming: Accept payment chunks for ongoing service
 */
async function handlePayment(request: PaymentRequest): Promise<PaymentResponse> {
  const { paymentId, amount, destination, data, expiresAt, metadata } = request;

  // eslint-disable-next-line no-console
  console.log('Payment received:', {
    paymentId,
    amount,
    destination,
    hasData: !!data,
    expiresAt,
    metadata,
  });

  // --------------------------------------------------------
  // TODO: Implement your business logic here
  // --------------------------------------------------------

  // Optional: Decode the STREAM data if present
  if (data) {
    const streamData = Buffer.from(data, 'base64');
    // Process STREAM protocol data (invoices, receipts, application data, etc.)
    // Example: const invoice = JSON.parse(streamData.toString('utf8'));
    // eslint-disable-next-line no-console
    console.log('Received STREAM data:', streamData.length, 'bytes');
  }

  // Example 1: Accept all payments under a limit
  const amountBigInt = BigInt(amount);
  const maxAmount = BigInt(1_000_000); // 1 million units

  if (amountBigInt > maxAmount) {
    return {
      accept: false,
      rejectReason: {
        code: 'invalid_amount',
        message: `Amount ${amount} exceeds maximum ${maxAmount.toString()}`,
      },
    };
  }

  // Example 2: Check payment metadata
  if (metadata?.productId) {
    // Validate product exists, check inventory, etc.
    // eslint-disable-next-line no-console
    console.log('Payment for product:', metadata.productId);
  }

  // Example 3: Track payments (in production, use a database)
  // await database.recordPayment(paymentId, amount);

  // Accept the payment
  return {
    accept: true,
    // Optional: Include data in the fulfill packet
    // data: Buffer.from('Thank you for your payment!').toString('base64'),
  };
}

/**
 * Handle SPSP payment setup (optional).
 *
 * Called when a sender queries the SPSP endpoint to initiate a payment.
 * Use this to:
 * - Validate payment requests before they start
 * - Attach metadata to the payment session
 * - Generate custom payment IDs
 *
 * If you don't implement this endpoint, all setups are allowed by default.
 *
 * @param request - Setup request with query parameters
 * @returns Response indicating whether to allow the setup
 */
async function handlePaymentSetup(request: PaymentSetupRequest): Promise<PaymentSetupResponse> {
  const { paymentId, queryParams } = request;

  // eslint-disable-next-line no-console
  console.log('Payment setup request:', { paymentId, queryParams });

  // --------------------------------------------------------
  // TODO: Implement your setup logic here (optional)
  // --------------------------------------------------------

  // Example 1: Extract product info from query params
  const productId = queryParams?.product;
  const userId = queryParams?.user;

  // Example 2: Validate the request
  if (productId && !isValidProduct(productId)) {
    return {
      allow: false,
      errorMessage: 'Invalid product ID',
    };
  }

  // Allow the setup with metadata
  return {
    allow: true,
    metadata: {
      ...(productId && { productId }),
      ...(userId && { userId }),
      setupTime: new Date().toISOString(),
    },
  };
}

// Helper function (replace with your actual validation)
function isValidProduct(productId: string): boolean {
  // TODO: Check against your product catalog
  return productId.length > 0;
}

// ============================================================
// HTTP ROUTES (no changes needed below)
// ============================================================

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * Payment handler endpoint
 */
app.post('/handle-payment', async (req: Request, res: Response) => {
  try {
    const request = req.body as PaymentRequest;

    // Validate required fields
    if (!request.paymentId || !request.amount || !request.destination) {
      res.status(400).json({
        accept: false,
        rejectReason: {
          code: 'invalid_request',
          message: 'Missing required fields: paymentId, amount, destination',
        },
      });
      return;
    }

    const response = await handlePayment(request);
    res.json(response);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error handling payment:', error);
    res.status(500).json({
      accept: false,
      rejectReason: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Internal error',
      },
    });
  }
});

/**
 * Payment setup endpoint (optional)
 */
app.post('/payment-setup', async (req: Request, res: Response) => {
  try {
    const request = req.body as PaymentSetupRequest;
    const response = await handlePaymentSetup(request);
    res.json(response);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in payment setup:', error);
    res.status(500).json({
      allow: false,
      errorMessage: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

// Start server
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         ILP Business Logic Server Started                  ║
╠════════════════════════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(46)}║
║                                                            ║
║  Endpoints:                                                ║
║    POST /handle-payment  - Process payments                ║
║    POST /payment-setup   - Setup hook (optional)           ║
║    GET  /health          - Health check                    ║
║                                                            ║
║  Ready to receive payments from Agent Runtime!             ║
╚════════════════════════════════════════════════════════════╝
  `);
});
