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

## Kubernetes Deployment

> **📘 Complete K8s Guide:** See [Kubernetes Agent Deployment with TigerBeetle](k8s-agent-deployment.md) for the full production deployment guide including TigerBeetle replica configuration, kustomize overlays, and monitoring.

Deploying your agent on Kubernetes requires creating manifests for your business logic and configuring the connector and agent runtime.

### Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured
- Docker image registry (Docker Hub, GitHub Container Registry, etc.)

### Step 1: Build and Push Your Business Logic Image

```bash
# Build your business logic image
docker build -t your-registry/my-business-logic:latest .

# Push to registry
docker push your-registry/my-business-logic:latest
```

### Step 2: Create Kubernetes Manifests

Create a `k8s/` directory in your project:

```
my-ilp-agent/
├── k8s/
│   ├── namespace.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── configmap.yaml
├── src/
└── Dockerfile
```

#### namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: my-agent
  labels:
    app: my-ilp-agent
```

#### deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: business-logic
  namespace: my-agent
spec:
  replicas: 2
  selector:
    matchLabels:
      app: business-logic
  template:
    metadata:
      labels:
        app: business-logic
    spec:
      containers:
        - name: business-logic
          image: your-registry/my-business-logic:latest
          ports:
            - containerPort: 8080
          env:
            - name: PORT
              value: '8080'
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: business-logic-secrets
                  key: database-url
          resources:
            requests:
              memory: '128Mi'
              cpu: '100m'
            limits:
              memory: '512Mi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
```

#### service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: business-logic
  namespace: my-agent
spec:
  type: ClusterIP
  ports:
    - port: 8080
      targetPort: 8080
  selector:
    app: business-logic
```

#### configmap.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: business-logic-config
  namespace: my-agent
data:
  PORT: '8080'
  LOG_LEVEL: 'info'
```

### Step 3: Deploy Agent Runtime

The agent runtime connects your business logic to the ILP connector.

#### Update Agent Runtime ConfigMap

```bash
# Create/update the agent-runtime configmap to point to your business logic
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-runtime-config
  namespace: m2m-agent-runtime
data:
  BASE_ADDRESS: "g.connector.myagent"
  BUSINESS_LOGIC_URL: "http://business-logic.my-agent.svc.cluster.local:8080"
  BUSINESS_LOGIC_TIMEOUT: "5000"
  PORT: "3100"
  SPSP_ENABLED: "true"
  SESSION_TTL_MS: "3600000"
  LOG_LEVEL: "info"
EOF
```

#### Deploy Agent Runtime

```bash
# Deploy the agent runtime from the m2m repo
kubectl apply -k /path/to/m2m/k8s/agent-runtime
```

### Step 4: Configure Connector for Local Delivery

Update the connector deployment to enable local delivery:

```bash
# Option A: Using kubectl set env
kubectl -n m2m-connector set env deployment/connector \
  LOCAL_DELIVERY_ENABLED=true \
  LOCAL_DELIVERY_URL=http://agent-runtime.m2m-agent-runtime.svc.cluster.local:3100

# Option B: Patch the deployment
kubectl -n m2m-connector patch deployment connector --type=json -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/env/-",
    "value": {
      "name": "LOCAL_DELIVERY_ENABLED",
      "value": "true"
    }
  },
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/env/-",
    "value": {
      "name": "LOCAL_DELIVERY_URL",
      "value": "http://agent-runtime.m2m-agent-runtime.svc.cluster.local:3100"
    }
  }
]'
```

#### Or Update Connector ConfigMap

```yaml
# k8s/connector/base/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: connector-config
  namespace: m2m-connector
data:
  # ... existing config ...
  LOCAL_DELIVERY_ENABLED: 'true'
  LOCAL_DELIVERY_URL: 'http://agent-runtime.m2m-agent-runtime.svc.cluster.local:3100'
```

Then apply:

```bash
kubectl apply -k k8s/connector/base
```

### Step 5: Deploy Your Business Logic

```bash
# Deploy your business logic
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml

# Or use kustomize
kubectl apply -k k8s/
```

### Step 6: Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n my-agent
kubectl get pods -n m2m-agent-runtime
kubectl get pods -n m2m-connector

# Check logs
kubectl -n my-agent logs -f deployment/business-logic
kubectl -n m2m-agent-runtime logs -f deployment/agent-runtime
kubectl -n m2m-connector logs -f deployment/connector

# Test SPSP endpoint
kubectl -n m2m-agent-runtime port-forward svc/agent-runtime 3100:3100
curl http://localhost:3100/.well-known/pay
```

### Step 7: Add Routes to Connector

Add a route to send packets to your agent:

```yaml
# connector-config.yaml
routes:
  - prefix: g.connector.myagent
    nextHop: local
    priority: 100
```

Or use the Admin API:

```bash
# Port-forward admin API
kubectl -n m2m-connector port-forward svc/connector 8081:8081

# Add route dynamically
curl -X POST http://localhost:8081/routes \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": "g.connector.myagent",
    "nextHop": "local",
    "priority": 100
  }'
```

---

## Kubernetes Architecture

### Single Agent

```
┌─────────────────────────────────────────────────────┐
│ Namespace: m2m-connector                            │
│                                                     │
│  ┌──────────────────────────────────────┐          │
│  │ Deployment: connector                │          │
│  │ - LOCAL_DELIVERY_ENABLED=true        │          │
│  │ - LOCAL_DELIVERY_URL=http://agent... │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Namespace: m2m-agent-runtime                        │
│                                                     │
│  ┌──────────────────────────────────────┐          │
│  │ Deployment: agent-runtime            │          │
│  │ - BUSINESS_LOGIC_URL=http://...      │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│ Namespace: my-agent (YOUR CODE)                     │
│                                                     │
│  ┌──────────────────────────────────────┐          │
│  │ Deployment: business-logic           │          │
│  │ - Your implementation                │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
```

### Multi-Agent Setup

For multiple agents, deploy multiple instances:

```bash
# Agent 1
kubectl apply -k agent-1/k8s/
kubectl apply -k k8s/agent-runtime-1/

# Agent 2
kubectl apply -k agent-2/k8s/
kubectl apply -k k8s/agent-runtime-2/

# Shared connector
kubectl apply -k k8s/connector/
```

Update connector routes to handle both:

```yaml
routes:
  - prefix: g.connector.agent1
    nextHop: local # Routes to agent-runtime-1
  - prefix: g.connector.agent2
    nextHop: local # Routes to agent-runtime-2
```

---

## Production Considerations

### Resource Limits

Adjust based on your traffic:

```yaml
resources:
  requests:
    memory: '256Mi'
    cpu: '200m'
  limits:
    memory: '1Gi'
    cpu: '1000m'
```

### Horizontal Pod Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: business-logic-hpa
  namespace: my-agent
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: business-logic
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### Network Policies

Restrict traffic between components:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: business-logic-netpol
  namespace: my-agent
spec:
  podSelector:
    matchLabels:
      app: business-logic
  policyTypes:
    - Ingress
  ingress:
    # Only allow agent-runtime to call business logic
    - from:
        - namespaceSelector:
            matchLabels:
              name: m2m-agent-runtime
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: m2m-agent-runtime
      ports:
        - protocol: TCP
          port: 8080
```

### Secrets Management

**Option A: Kubernetes Secrets**

```bash
kubectl -n my-agent create secret generic business-logic-secrets \
  --from-literal=database-url=postgresql://... \
  --from-literal=api-key=...
```

**Option B: External Secrets Operator**

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: business-logic-secrets
  namespace: my-agent
spec:
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: business-logic-secrets
  data:
    - secretKey: database-url
      remoteRef:
        key: my-agent/database-url
```

---

## Complete Kubernetes Example

Here's a complete example for deploying your agent to Kubernetes:

### Directory Structure

```
my-ilp-agent/
├── k8s/
│   ├── namespace.yaml
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── hpa.yaml
│   └── kustomization.yaml
├── src/
│   └── server.ts
├── Dockerfile
└── README.md
```

### kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: my-agent

resources:
  - namespace.yaml
  - configmap.yaml
  - secret.yaml
  - deployment.yaml
  - service.yaml
  - hpa.yaml

images:
  - name: business-logic
    newName: your-registry/my-business-logic
    newTag: latest
```

### Deploy Everything

```bash
# Build and push your image
docker build -t your-registry/my-business-logic:latest .
docker push your-registry/my-business-logic:latest

# Deploy your business logic
kubectl apply -k k8s/

# Deploy agent runtime (if not already deployed)
kubectl apply -k /path/to/m2m/k8s/agent-runtime

# Update agent-runtime to point to your business logic
kubectl -n m2m-agent-runtime patch configmap agent-runtime-config \
  --type merge \
  -p '{"data":{"BUSINESS_LOGIC_URL":"http://business-logic.my-agent.svc.cluster.local:8080"}}'

# Restart agent-runtime to pick up new config
kubectl -n m2m-agent-runtime rollout restart deployment/agent-runtime

# Deploy/update connector (if not already deployed)
kubectl apply -k /path/to/m2m/k8s/connector

# Configure connector for local delivery
kubectl -n m2m-connector set env deployment/connector \
  LOCAL_DELIVERY_ENABLED=true \
  LOCAL_DELIVERY_URL=http://agent-runtime.m2m-agent-runtime.svc.cluster.local:3100

# Verify everything is running
kubectl get pods -n my-agent
kubectl get pods -n m2m-agent-runtime
kubectl get pods -n m2m-connector
```

### Cross-Namespace Service Discovery

Kubernetes DNS format for cross-namespace communication:

```
http://[service-name].[namespace].svc.cluster.local:[port]
```

**Examples:**

- Business Logic → Database: `postgresql://db.my-agent.svc.cluster.local:5432/mydb`
- Agent Runtime → Business Logic: `http://business-logic.my-agent.svc.cluster.local:8080`
- Connector → Agent Runtime: `http://agent-runtime.m2m-agent-runtime.svc.cluster.local:3100`

### Using Helm (Advanced)

Create a Helm chart for easier deployment:

```bash
# Create Helm chart
helm create my-agent

# Edit values.yaml
# Deploy
helm install my-agent ./my-agent \
  --namespace my-agent \
  --create-namespace \
  --set image.repository=your-registry/my-business-logic \
  --set image.tag=latest
```

---

## Summary: Where Does Your Code Go?

| Approach          | Your Code Location       | docker-compose.yml           | Pros                            |
| ----------------- | ------------------------ | ---------------------------- | ------------------------------- |
| **Separate Repo** | `my-agent/src/`          | `build: .`                   | Clean separation, easy updates  |
| **Fork m2m**      | `m2m/business-logic/`    | `build: ./business-logic`    | Everything in one repo          |
| **Monorepo**      | `m2m/packages/my-agent/` | `build: ./packages/my-agent` | Shared code, workspace benefits |

**Recommendation:** Start with **Separate Repo** for simplicity. You can always move to a fork later if needed.
