# Creating Your Own ILP Agent

This guide explains how to create your own ILP payment agent using the Agent Runtime.

## Overview

An ILP agent consists of three components:

```
┌─────────────┐      ┌─────────────────┐      ┌──────────────────┐
│  Connector  │      │  Agent Runtime  │      │  Your Business   │
│  (pre-built)│─────►│   (pre-built)   │─────►│     Logic        │
│             │      │                 │      │  (you implement) │
└─────────────┘      └─────────────────┘      └──────────────────┘
```

**You only need to implement the Business Logic** - the Connector and Agent Runtime are provided.

---

## Approach 1: Separate Repository (Recommended)

**Best for:** Production deployments, keeping your code separate from the framework.

### Step 1: Create Your Business Logic Repository

```bash
# Create a new directory for your agent
mkdir my-ilp-agent
cd my-ilp-agent

# Copy the TypeScript boilerplate from the m2m repo
# (You can download just the examples folder or clone and copy)
cp -r /path/to/m2m/examples/business-logic-typescript/* .

# Or start from scratch with the simple example
cp -r /path/to/m2m/examples/business-logic-example/* .

# Initialize git
git init
git add .
git commit -m "Initial commit: ILP agent boilerplate"
```

### Step 2: Implement Your Business Logic

Edit `src/server.ts` (TypeScript) or `server.js` (JavaScript):

```typescript
async function handlePayment(request: PaymentRequest): Promise<PaymentResponse> {
  const { paymentId, amount, data, metadata } = request;

  // Your business logic here:
  // - Connect to your database
  // - Check inventory
  // - Validate user access
  // - Record the payment

  // Example: E-commerce order fulfillment
  const { productId, userId } = metadata || {};

  const product = await db.products.findById(productId);
  if (!product || product.stock <= 0) {
    return {
      accept: false,
      rejectReason: { code: 'invalid_request', message: 'Out of stock' },
    };
  }

  await db.orders.create({
    paymentId,
    productId,
    userId,
    amount,
  });

  return { accept: true };
}
```

### Step 3: Create Deployment Configuration

Create `docker-compose.yml` in your repository:

```yaml
version: '3.8'

services:
  # Your business logic (this is what you built)
  business-logic:
    build: .
    environment:
      PORT: '8080'
      DATABASE_URL: ${DATABASE_URL}
    ports:
      - '8080:8080'
    networks:
      - ilp-network

  # Agent Runtime (pre-built from m2m repo)
  agent-runtime:
    image: ghcr.io/yourusername/m2m-agent-runtime:latest
    environment:
      BASE_ADDRESS: g.connector.myagent
      BUSINESS_LOGIC_URL: http://business-logic:8080
    ports:
      - '3100:3100'
    depends_on:
      - business-logic
    networks:
      - ilp-network

  # Connector (pre-built from m2m repo)
  connector:
    image: ghcr.io/yourusername/m2m-connector:latest
    environment:
      NODE_ID: myagent-connector
      LOCAL_DELIVERY_ENABLED: 'true'
      LOCAL_DELIVERY_URL: http://agent-runtime:3100
    volumes:
      - ./connector-config.yaml:/app/config.yaml:ro
    ports:
      - '3000:3000'
      - '8080:8080'
    depends_on:
      - agent-runtime
    networks:
      - ilp-network

  # TigerBeetle (for settlement)
  tigerbeetle:
    image: ghcr.io/tigerbeetle/tigerbeetle:latest
    security_opt:
      - seccomp=unconfined
    volumes:
      - tigerbeetle-data:/data
    networks:
      - ilp-network

networks:
  ilp-network:

volumes:
  tigerbeetle-data:
```

### Step 4: Deploy

```bash
# Build and start your agent
docker-compose up -d

# View logs
docker-compose logs -f business-logic

# Test your agent
curl http://localhost:3100/.well-known/pay
```

---

## Approach 2: Fork and Extend

**Best for:** Contributing back to the project, heavy customization.

### Step 1: Fork the Repository

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/yourusername/m2m.git
cd m2m
```

### Step 2: Add Your Business Logic

Create a new directory in the root:

```bash
mkdir business-logic
cd business-logic
```

Copy the boilerplate:

```bash
cp -r ../examples/business-logic-typescript/* .
```

Or create your own structure:

```
m2m/
├── packages/
│   ├── connector/
│   ├── agent-runtime/
│   └── shared/
├── business-logic/          # Your code here
│   ├── src/
│   │   ├── server.ts
│   │   ├── database.ts
│   │   ├── handlers/
│   │   └── types.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
└── docker-compose.yml
```

### Step 3: Update Docker Compose

Edit `docker-compose-agent-runtime.yml`:

```yaml
services:
  business-logic:
    build: ./business-logic # Point to your directory
    environment:
      PORT: '8080'
      # Your custom env vars
      DATABASE_URL: postgresql://...
      REDIS_URL: redis://...
    ports:
      - '8080:8080'
```

### Step 4: Deploy

```bash
# Build all images
docker-compose -f docker-compose-agent-runtime.yml build

# Start services
docker-compose -f docker-compose-agent-runtime.yml up -d
```

---

## Approach 3: Monorepo Workspace

**Best for:** Multiple agents in one repository, shared code.

### Step 1: Add to Workspace

```bash
cd /path/to/m2m

# Create your agent package
mkdir -p packages/my-agent
cd packages/my-agent
```

### Step 2: Create package.json

```json
{
  "name": "@m2m/my-agent",
  "version": "1.0.0",
  "dependencies": {
    "@m2m/shared": "*",
    "express": "^4.18.2"
  }
}
```

### Step 3: Update Root package.json

The workspace glob `packages/*` already includes your new package.

### Step 4: Build

```bash
# From repo root
npm install
npm run build
```

---

## Quick Start Examples

### Example 1: E-commerce Agent

```typescript
// business-logic/src/server.ts
import { PaymentRequest, PaymentResponse } from './types';
import { db } from './database';

async function handlePayment(req: PaymentRequest): Promise<PaymentResponse> {
  const { productId } = req.metadata || {};
  const amount = BigInt(req.amount);

  // Check product and inventory
  const product = await db.products.findById(productId);
  if (!product) {
    return {
      accept: false,
      rejectReason: {
        code: 'invalid_request',
        message: 'Product not found',
      },
    };
  }

  if (product.price !== amount) {
    return {
      accept: false,
      rejectReason: {
        code: 'invalid_amount',
        message: 'Incorrect payment amount',
      },
    };
  }

  if (product.stock <= 0) {
    return {
      accept: false,
      rejectReason: {
        code: 'application_error',
        message: 'Out of stock',
      },
    };
  }

  // Create order and decrement stock
  await db.orders.create({ paymentId: req.paymentId, productId, amount: amount.toString() });
  await db.products.decrementStock(productId);

  return { accept: true };
}
```

### Example 2: API Access Agent

```typescript
async function handlePayment(req: PaymentRequest): Promise<PaymentResponse> {
  const { apiKey } = req.metadata || {};
  const amount = BigInt(req.amount);

  // Validate API key
  const user = await db.users.findByApiKey(apiKey);
  if (!user) {
    return {
      accept: false,
      rejectReason: {
        code: 'invalid_request',
        message: 'Invalid API key',
      },
    };
  }

  // Credit user's prepaid balance
  await db.users.creditBalance(user.id, amount);

  // Log the top-up
  await db.transactions.create({
    userId: user.id,
    paymentId: req.paymentId,
    amount: amount.toString(),
    type: 'balance_topup',
  });

  return {
    accept: true,
    data: Buffer.from(
      JSON.stringify({
        newBalance: user.balance + amount,
      })
    ).toString('base64'),
  };
}
```

### Example 3: Streaming Content Agent

```typescript
const activeSessions = new Map();

async function handlePayment(req: PaymentRequest): Promise<PaymentResponse> {
  const { userId, contentId } = req.metadata || {};
  const amount = BigInt(req.amount);

  // Track cumulative payment for this session
  const sessionKey = `${userId}:${contentId}`;
  const session = activeSessions.get(sessionKey) || { total: 0n, startedAt: Date.now() };
  session.total += amount;
  activeSessions.set(sessionKey, session);

  // Calculate minutes of access based on payment
  const COST_PER_MINUTE = 1000n; // 1000 units per minute
  const minutesPaid = session.total / COST_PER_MINUTE;

  // Always accept streaming chunks
  return {
    accept: true,
    data: Buffer.from(
      JSON.stringify({
        totalPaid: session.total.toString(),
        minutesAccess: minutesPaid.toString(),
      })
    ).toString('base64'),
  };
}
```

---

## Directory Structure Options

### Option A: Root-Level (Simple)

```
my-ilp-agent/
├── src/
│   └── server.ts
├── package.json
├── Dockerfile
└── docker-compose.yml
```

### Option B: Inside Forked Repo

```
m2m/                         # Forked repo
├── packages/
│   ├── connector/
│   ├── agent-runtime/
│   └── shared/
├── business-logic/          # Your code
│   ├── src/
│   └── package.json
└── docker-compose.yml       # Updated to build ./business-logic
```

### Option C: Monorepo Workspace

```
m2m/
├── packages/
│   ├── connector/
│   ├── agent-runtime/
│   ├── shared/
│   └── my-agent/            # Your code as workspace package
│       ├── src/
│       └── package.json
```

---

## Deployment Configuration

### Docker Compose Paths

In `docker-compose.yml`, the `build:` path is **relative to the docker-compose.yml file**:

```yaml
# If docker-compose.yml is in repo root:
services:
  business-logic:
    build: ./business-logic        # builds from m2m/business-logic/

# If docker-compose.yml is in a subdirectory:
services:
  business-logic:
    build: ../my-payment-handler   # relative path

# Absolute path (not recommended):
services:
  business-logic:
    build: /home/user/my-agent
```

---

## Recommended Workflow

**For Most Users:**

1. **Create separate repository** for your business logic
2. **Copy the boilerplate** (`examples/business-logic-typescript/`)
3. **Implement your logic** in `src/server.ts`
4. **Create docker-compose.yml** that references pre-built images:

```yaml
services:
  business-logic:
    build: . # Current directory

  agent-runtime:
    image: ghcr.io/yourusername/m2m-agent-runtime:latest

  connector:
    image: ghcr.io/yourusername/m2m-connector:latest
```

5. **Deploy:** `docker-compose up -d`

This keeps your code separate and makes updates easier.

---

## Getting Pre-built Images

If the m2m project publishes Docker images to GitHub Container Registry:

```bash
# Pull pre-built images
docker pull ghcr.io/yourusername/m2m-connector:latest
docker pull ghcr.io/yourusername/m2m-agent-runtime:latest

# Use in your docker-compose.yml (no need to fork)
```

If images aren't published yet, you can build them once:

```bash
# Clone m2m repo (temporary)
git clone https://github.com/ALLiDoizCode/m2m.git
cd m2m

# Build and tag images
docker build -t my-connector .
docker build -t my-agent-runtime -f packages/agent-runtime/Dockerfile .

# Now use these images in your separate project
cd ../my-ilp-agent
# Reference my-connector and my-agent-runtime in docker-compose.yml
```

---

## Example: Complete Separate Project

**Directory structure:**

```
my-payment-agent/
├── src/
│   ├── server.ts           # Your payment handler
│   ├── database.ts         # Database connection
│   └── types.ts            # Type definitions
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml      # Full stack deployment
└── README.md
```

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  # Your business logic
  business-logic:
    build: .
    environment:
      PORT: '8080'
      DATABASE_URL: postgresql://user:pass@db:5432/mydb
    depends_on:
      - db
    networks:
      - ilp-network

  # Pre-built agent runtime
  agent-runtime:
    image: ghcr.io/allidoizcode/m2m-agent-runtime:latest
    environment:
      BASE_ADDRESS: g.connector.myagent
      BUSINESS_LOGIC_URL: http://business-logic:8080
    depends_on:
      - business-logic
    networks:
      - ilp-network

  # Pre-built connector
  connector:
    image: ghcr.io/allidoizcode/m2m-connector:latest
    environment:
      NODE_ID: myagent
      LOCAL_DELIVERY_ENABLED: 'true'
      LOCAL_DELIVERY_URL: http://agent-runtime:3100
    volumes:
      - ./connector-config.yaml:/app/config.yaml:ro
    ports:
      - '3000:3000'
      - '8080:8080'
      - '3001:3001'
    networks:
      - ilp-network

  # TigerBeetle
  tigerbeetle:
    image: ghcr.io/tigerbeetle/tigerbeetle:latest
    # ... standard config ...

  # Your database
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - ilp-network

networks:
  ilp-network:

volumes:
  db-data:
```

**Deploy:**

```bash
docker-compose up -d
```

---

## Connecting to Other Connectors

### Option 1: Connect to Public ILP Connector

Add the peer to your `connector-config.yaml`:

```yaml
peers:
  - id: public-connector
    url: wss://ilp.example.com:3000
    authToken: your-auth-token

routes:
  - prefix: g
    nextHop: public-connector
    priority: 0
```

### Option 2: Deploy Multiple Agents

Each agent needs:

- Its own business logic container
- Its own agent runtime container
- Its own connector (or shared connector with multiple agent runtimes)

**Example: Two agents on one connector:**

```yaml
services:
  # Agent 1
  business-logic-1:
    build: ./agent-1
  agent-runtime-1:
    image: agent-runtime
    environment:
      BASE_ADDRESS: g.connector.agent1
      BUSINESS_LOGIC_URL: http://business-logic-1:8080

  # Agent 2
  business-logic-2:
    build: ./agent-2
  agent-runtime-2:
    image: agent-runtime
    environment:
      BASE_ADDRESS: g.connector.agent2
      BUSINESS_LOGIC_URL: http://business-logic-2:8080

  # Shared connector
  connector:
    image: connector
    environment:
      LOCAL_DELIVERY_ENABLED: 'true'
      # Route to both agent runtimes (need multiple local delivery configs)
      # Or use Admin API to add routes dynamically
```

---

## Testing Your Agent Locally

### Without Docker (Development)

```bash
# Terminal 1: Start TigerBeetle
npm run tigerbeetle:start

# Terminal 2: Start your business logic
cd my-agent
npm run dev

# Terminal 3: Start agent runtime
cd packages/agent-runtime
BASE_ADDRESS=g.test.agent \
BUSINESS_LOGIC_URL=http://localhost:8080 \
npm start

# Terminal 4: Test SPSP endpoint
curl http://localhost:3100/.well-known/pay
```

### With Docker Compose (Integration)

```bash
# Build and start
docker-compose up --build

# Send test payment
curl -X POST http://localhost:3100/.well-known/pay
```

---

## Summary: Where Does Your Code Go?

| Approach          | Your Code Location       | docker-compose.yml           | Pros                            |
| ----------------- | ------------------------ | ---------------------------- | ------------------------------- |
| **Separate Repo** | `my-agent/src/`          | `build: .`                   | Clean separation, easy updates  |
| **Fork m2m**      | `m2m/business-logic/`    | `build: ./business-logic`    | Everything in one repo          |
| **Monorepo**      | `m2m/packages/my-agent/` | `build: ./packages/my-agent` | Shared code, workspace benefits |

**Recommendation:** Start with **Separate Repo** for simplicity. You can always move to a fork later if needed.
