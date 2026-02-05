# ILP Business Logic Server - TypeScript Boilerplate

This is a starter template for building custom payment handlers that integrate with the ILP Agent Runtime.

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Or build and run in production
npm run build
npm start
```

The server will start on port 8080 (configurable via `PORT` environment variable).

## Project Structure

```
.
├── src/
│   ├── server.ts    # Main server with handler implementations
│   └── types.ts     # TypeScript type definitions
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

## Implementing Your Business Logic

Edit `src/server.ts` and implement the `handlePayment` function:

```typescript
async function handlePayment(request: PaymentRequest): Promise<PaymentResponse> {
  const { paymentId, amount, destination, metadata } = request;

  // Your business logic here:
  // - Validate the payment
  // - Check inventory/balance
  // - Record to database
  // - Trigger side effects

  // Accept the payment
  return { accept: true };

  // Or reject with a reason
  return {
    accept: false,
    rejectReason: {
      code: 'insufficient_funds',
      message: 'Account balance too low',
    },
  };
}
```

## API Endpoints

### POST /handle-payment

Called for each incoming ILP payment.

**Request:**

```json
{
  "paymentId": "abc123",
  "destination": "g.connector.agent.abc123",
  "amount": "1000000",
  "expiresAt": "2024-01-15T12:00:00.000Z",
  "metadata": { "productId": "prod-456" }
}
```

**Response:**

```json
{ "accept": true }
```

### POST /payment-setup (Optional)

Called when SPSP endpoint is queried.

**Request:**

```json
{
  "paymentId": "custom-id",
  "queryParams": { "product": "premium" }
}
```

**Response:**

```json
{
  "allow": true,
  "metadata": { "productId": "premium" }
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{ "status": "healthy" }
```

## Reject Codes

| Code                 | ILP Error | Use Case                         |
| -------------------- | --------- | -------------------------------- |
| `insufficient_funds` | T04       | User doesn't have enough balance |
| `expired`            | R00       | Payment or offer expired         |
| `invalid_request`    | F00       | Malformed request                |
| `invalid_amount`     | F03       | Amount out of acceptable range   |
| `unexpected_payment` | F06       | Not expecting this payment       |
| `application_error`  | F99       | Generic business logic error     |
| `internal_error`     | T00       | Temporary server error           |

## Docker Deployment

```bash
# Build the image
docker build -t my-business-logic .

# Run the container
docker run -p 8080:8080 my-business-logic
```

## Environment Variables

| Variable | Description      | Default |
| -------- | ---------------- | ------- |
| `PORT`   | HTTP server port | `8080`  |

## Integration with Agent Runtime

Configure the Agent Runtime to point to your server:

```bash
# Environment variables for Agent Runtime
BUSINESS_LOGIC_URL=http://my-business-logic:8080
BUSINESS_LOGIC_TIMEOUT=5000
```

Or in Docker Compose:

```yaml
services:
  agent-runtime:
    image: agent-runtime
    environment:
      BUSINESS_LOGIC_URL: http://business-logic:8080

  business-logic:
    build: .
    ports:
      - '8080:8080'
```

## License

MIT
