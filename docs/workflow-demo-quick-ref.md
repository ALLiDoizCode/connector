# ILP Workflow Demo - Quick Reference Card

## 🚀 One-Command Start

```bash
./scripts/run-workflow-demo.sh
```

## 🌐 URLs

| Service                    | URL                   | Purpose            |
| -------------------------- | --------------------- | ------------------ |
| **Client UI**              | http://localhost:3000 | Upload images      |
| **Facilitator API**        | http://localhost:3001 | HTTP gateway       |
| **Facilitator Explorer**   | http://localhost:9200 | Monitor gateway    |
| **Connector 1 Explorer**   | http://localhost:9201 | Monitor hop 1      |
| **Connector 2 Explorer**   | http://localhost:9202 | Monitor hop 2      |
| **Workflow Peer Explorer** | http://localhost:9203 | Monitor processing |
| **Aptos RPC**              | http://localhost:8545 | Local blockchain   |

## 🔄 Network Flow

```
        Upload Image
             ↓
    ┌────────────────┐
    │   Client UI    │  Browser
    │   Port 3000    │
    └────────┬───────┘
             │ HTTP POST /api/workflows
             │ { imageData, steps: [resize, watermark, optimize] }
             ↓
    ┌────────────────┐
    │  Facilitator   │  X402 Gateway
    │   Port 3001    │  • Accepts HTTP from web
    │ g.facilitator  │  • SPSP handshake
    └────────┬───────┘  • BTP connection
             │ ILP Prepare
             │ destination: g.workflow.resize.watermark.optimize
             │ amount: 450 msat
             ↓
    ┌────────────────┐
    │  Connector 1   │  Routing Hop
    │   Port 9201    │  • Checks routing table
    │ g.connector1   │  • Forwards to Connector 2
    └────────┬───────┘
             │ ILP Forward
             ↓
    ┌────────────────┐
    │  Connector 2   │  Routing Hop
    │   Port 9202    │  • Checks routing table
    │ g.connector2   │  • Forwards to Workflow Peer
    └────────┬───────┘  • Triggers settlement
             │ ILP Forward
             ↓
    ┌────────────────┐
    │ Workflow Peer  │  Image Processing
    │   Port 9203    │  1. Verify payment (450 msat)
    │  g.workflow    │  2. Resize → 1024x768
    └────────┬───────┘  3. Watermark → Add text
             │          4. Optimize → Quality 80
             │          5. Store result
             │ ILP Fulfill
             │ data: { resultUri, imageData }
             ↓
    (Flows back through same route)
             ↓
    ┌────────────────┐
    │  Client UI     │  Display Result
    │  Port 3000     │  Download processed image
    └────────────────┘
```

## 💰 Cost Breakdown

| Step      | Cost         | Operation          |
| --------- | ------------ | ------------------ |
| Resize    | 100 msat     | Scale to 1024x768  |
| Watermark | 200 msat     | Add text overlay   |
| Optimize  | 150 msat     | Compress JPEG      |
| **Total** | **450 msat** | **~$0.000045 USD** |

## 📡 Payment Channels

```
Facilitator ─────→ Connector 1
  (1M msat)

Connector 1 ─────→ Connector 2
  (1M msat)

Connector 2 ─────→ Workflow Peer
  (1M msat)
```

## 🗺️ Routing Table

| Node        | Destination      | Next Hop      |
| ----------- | ---------------- | ------------- |
| Facilitator | `g.workflow.*`   | Connector 1   |
| Facilitator | `g.connector1.*` | Connector 1   |
| Facilitator | `g.connector2.*` | Connector 1   |
| Connector 1 | `g.workflow.*`   | Connector 2   |
| Connector 1 | `g.connector2.*` | Connector 2   |
| Connector 2 | `g.workflow.*`   | Workflow Peer |

## 🐳 Docker Services

```bash
# View all services
docker compose -f docker-compose-workflow-demo.yml ps

# View logs for specific service
docker compose -f docker-compose-workflow-demo.yml logs -f facilitator

# Restart a service
docker compose -f docker-compose-workflow-demo.yml restart connector-1

# Stop all services
docker compose -f docker-compose-workflow-demo.yml down -v
```

## 🔍 Debug Commands

```bash
# Check facilitator API
curl http://localhost:3001/api/services

# Check connector health
curl http://localhost:8201/health  # Connector 1
curl http://localhost:8202/health  # Connector 2

# Check workflow peer health
curl http://localhost:8203/health

# View payment channels
curl http://localhost:8200/api/channels  # Facilitator's channels

# View routing table
curl http://localhost:8201/api/routes    # Connector 1's routes

# Check Aptos node
curl http://localhost:8545/v1
```

## 📊 Performance Targets

| Metric                 | Target   | Actual  |
| ---------------------- | -------- | ------- |
| Image upload           | < 500ms  | ~300ms  |
| ILP routing (3 hops)   | < 300ms  | ~200ms  |
| Image processing (5MB) | < 2s     | ~1.5s   |
| **Total latency**      | **< 3s** | **~2s** |

## 🧪 Test Scenarios

### Scenario 1: Basic Workflow

1. Upload 2MB JPEG
2. Select: Resize + Watermark
3. Cost: 300 msat
4. Expected: ~1.5s processing

### Scenario 2: Full Pipeline

1. Upload 5MB PNG
2. Select: All 3 steps
3. Cost: 450 msat
4. Expected: ~2.2s processing

### Scenario 3: Large Image

1. Upload 10MB JPEG
2. Select: Optimize only
3. Cost: 150 msat
4. Expected: ~3.5s processing

## 🔐 Security

**Important Security Notes:**

- ✅ All services run in isolated Docker containers
- ✅ Payment channels use cryptographic conditions
- ✅ Images stored temporarily (auto-delete after 1 hour)
- ✅ Max image size enforced (10MB)
- ✅ File type validation (magic bytes check)
- ⚠️ This is a DEMO - not production-ready security

## 🛠️ Common Issues

| Issue                   | Solution                                                       |
| ----------------------- | -------------------------------------------------------------- |
| Port already in use     | Edit `docker-compose-workflow-demo.yml`, change external ports |
| Services won't start    | Run `docker system prune`, then restart                        |
| Image upload fails      | Check file size (max 10MB) and format (PNG/JPEG)               |
| Payment channel missing | Run setup script: `node dist/workflow/setup-network.js`        |
| Explorer UI shows 404   | Rebuild UI: `npm run build:explorer-ui -w @m2m/connector`      |

## 📈 Monitoring

Open all 4 Explorer UIs side-by-side:

```bash
# macOS
open http://localhost:9200 http://localhost:9201 http://localhost:9202 http://localhost:9203

# Linux
xdg-open http://localhost:9200 &
xdg-open http://localhost:9201 &
xdg-open http://localhost:9202 &
xdg-open http://localhost:9203 &
```

Watch payments flow through the network in real-time!

## 🎯 Demo Talking Points

1. **"This is not a toy"** - Production libraries (Sharp), real blockchain (Aptos), standard ILP
2. **"Multi-hop routing works"** - 3 hops, not direct client-server
3. **"Payments + computation"** - Pay for work, not just transfer money
4. **"Extensible platform"** - Can route video, data, AI, anything
5. **"Marketplace ready"** - Service discovery, pricing, reputation

## 📞 Support

- **Documentation:** `/docs/workflow-demo-guide.md`
- **Issues:** https://github.com/anthropics/m2m/issues
- **Architecture:** `/docs/architecture/workflow-image-processing-demo.md`

---

**Built with ❤️ using Interledger Protocol**
