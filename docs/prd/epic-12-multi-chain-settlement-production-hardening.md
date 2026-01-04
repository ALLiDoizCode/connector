# Epic 12: Multi-Chain Settlement & Production Hardening

**Epic Number:** 12

**Goal:** Deliver production-ready M2M economy infrastructure with multi-chain settlement coordination, enterprise-grade security hardening, AI agent micropayment performance optimization (10K+ TPS target), and simplified Docker-based deployment for easy peer onboarding. This epic transforms the M2M platform from development prototype to production-ready system capable of powering a global machine-to-machine economy with real cryptocurrency settlement across multiple blockchains (Base L2, XRP Ledger, and future chains). Focus areas include cross-chain settlement coordination, HSM/KMS key management, rate limiting and fraud detection, performance optimization, monitoring and alerting, CI/CD automation, and comprehensive operator documentation.

**Foundation:** This epic builds on all previous epics (1-11) to deliver a complete, production-hardened system ready for real-world deployment with AI agents and M2M micropayments.

**Important:** This epic is the **final integration and hardening phase**. All core functionality is complete from Epics 1-11. This epic adds production-grade reliability, security, performance, and operational tooling required for enterprise deployment.

---

## Story 12.1: Cross-Chain Settlement Coordination and Routing

As a settlement coordinator,
I want intelligent cross-chain settlement routing that optimizes for cost, speed, and availability,
so that the network automatically selects the best settlement method for each peer and token.

### Acceptance Criteria

1. `SettlementCoordinator` class implemented in `packages/connector/src/settlement/settlement-coordinator.ts`
2. Coordinator evaluates settlement options: EVM (Base L2), XRP, future chains
3. Coordinator selects optimal settlement method based on: token type, peer preference, gas costs, network congestion
4. Coordinator implements fallback logic: if primary method fails, try alternative (e.g., EVM→XRP)
5. Coordinator tracks settlement success rates per method and peer
6. Coordinator implements circuit breaker: disable settlement method if failure rate >10%
7. Coordinator exposes metrics: settlements/chain, success rates, average costs, latencies
8. Coordinator logs all routing decisions with structured logging
9. Unit tests verify routing logic for various scenarios (cost optimization, fallback, circuit breaker)
10. Integration test demonstrates multi-chain settlement with automatic routing and fallback

### Settlement Routing Logic

```typescript
// packages/connector/src/settlement/settlement-coordinator.ts

interface SettlementOption {
  method: 'evm' | 'xrp';
  chain?: string; // 'base-l2' | 'ethereum' | 'polygon'
  estimatedCost: bigint; // Gas cost in native token
  estimatedLatency: number; // Seconds
  successRate: number; // 0.0 - 1.0
  available: boolean;
}

class SettlementCoordinator {
  constructor(
    private evmChannelSDK: PaymentChannelSDK,
    private xrpChannelSDK: XRPChannelSDK,
    private metricsCollector: MetricsCollector
  ) {}

  async selectSettlementMethod(
    peerId: string,
    tokenId: string,
    amount: bigint
  ): Promise<SettlementOption> {
    const options = await this.evaluateOptions(peerId, tokenId, amount);

    // Filter unavailable methods (circuit breaker open, network down, etc.)
    const available = options.filter((opt) => opt.available);

    if (available.length === 0) {
      throw new Error('No available settlement methods');
    }

    // Optimize for cost (production priority)
    // Can switch to latency optimization for time-sensitive settlements
    const optimal = available.reduce((best, current) => {
      const bestScore = this.calculateScore(best);
      const currentScore = this.calculateScore(current);
      return currentScore > bestScore ? current : best;
    });

    this.logRoutingDecision(peerId, tokenId, optimal, options);
    return optimal;
  }

  private calculateScore(option: SettlementOption): number {
    // Weighted scoring: cost (50%), success rate (30%), latency (20%)
    const costScore = 1 / Number(option.estimatedCost);
    const successScore = option.successRate;
    const latencyScore = 1 / option.estimatedLatency;

    return costScore * 0.5 + successScore * 0.3 + latencyScore * 0.2;
  }

  private async evaluateOptions(
    peerId: string,
    tokenId: string,
    amount: bigint
  ): Promise<SettlementOption[]> {
    const peerConfig = await this.getPeerConfig(peerId);
    const options: SettlementOption[] = [];

    // EVM option (if peer supports and token is ERC20)
    if (peerConfig.settlementPreference !== 'xrp' && this.isERC20Token(tokenId)) {
      const evmCost = await this.estimateEVMCost(tokenId, amount);
      const evmSuccessRate = this.metricsCollector.getSuccessRate('evm');

      options.push({
        method: 'evm',
        chain: 'base-l2',
        estimatedCost: evmCost,
        estimatedLatency: 3, // ~3 seconds on Base L2
        successRate: evmSuccessRate,
        available: this.circuitBreakerOpen('evm') === false,
      });
    }

    // XRP option (if peer supports and token is XRP)
    if (peerConfig.settlementPreference !== 'evm' && tokenId === 'XRP') {
      const xrpCost = await this.estimateXRPCost();
      const xrpSuccessRate = this.metricsCollector.getSuccessRate('xrp');

      options.push({
        method: 'xrp',
        estimatedCost: xrpCost,
        estimatedLatency: 4, // ~4 seconds on XRPL
        successRate: xrpSuccessRate,
        available: this.circuitBreakerOpen('xrp') === false,
      });
    }

    return options;
  }

  private circuitBreakerOpen(method: string): boolean {
    const recentFailureRate = this.metricsCollector.getRecentFailureRate(method);
    return recentFailureRate > 0.1; // Open if >10% failures in last hour
  }
}
```

### Fallback Logic

```typescript
async executeSettlementWithFallback(
  peerId: string,
  tokenId: string,
  amount: bigint
): Promise<void> {
  const primary = await this.selectSettlementMethod(peerId, tokenId, amount);

  try {
    await this.executeSettlement(primary, peerId, tokenId, amount);
    this.metricsCollector.recordSuccess(primary.method);
  } catch (error) {
    this.logger.warn('Primary settlement failed, trying fallback', { error, primary });
    this.metricsCollector.recordFailure(primary.method);

    // Try fallback method
    const fallback = await this.selectFallbackMethod(peerId, tokenId, primary);
    if (fallback) {
      await this.executeSettlement(fallback, peerId, tokenId, amount);
      this.metricsCollector.recordSuccess(fallback.method);
    } else {
      throw new Error('All settlement methods failed');
    }
  }
}
```

---

## Story 12.2: HSM/KMS Key Management and Secret Security

As a security engineer,
I want enterprise-grade key management using HSM or cloud KMS,
so that private keys for settlement are never exposed in plaintext and meet compliance requirements.

### Acceptance Criteria

1. `KeyManager` abstraction implemented in `packages/connector/src/security/key-manager.ts`
2. Key manager supports multiple backends: environment variables (dev), AWS KMS, GCP KMS, Azure Key Vault, hardware HSM
3. Key manager implements `sign(message, keyId)` method delegating to backend
4. EVM payment channel SDK refactored to use key manager instead of direct private key access
5. XRP payment channel SDK refactored to use key manager for claim signing
6. Key rotation policy implemented: automated key rotation every 90 days with overlap period
7. Audit logging for all key operations: sign, rotate, access attempts
8. Environment variable configuration for key backend selection
9. Unit tests verify key manager with mocked KMS backends
10. Integration test demonstrates signing with AWS KMS (if credentials available)

### Key Manager Architecture

```typescript
// packages/connector/src/security/key-manager.ts

interface KeyManagerBackend {
  sign(message: Buffer, keyId: string): Promise<Buffer>;
  getPublicKey(keyId: string): Promise<Buffer>;
  rotateKey(keyId: string): Promise<string>; // Returns new keyId
}

class KeyManager {
  private backend: KeyManagerBackend;

  constructor(config: KeyManagerConfig) {
    // Select backend based on configuration
    switch (config.backend) {
      case 'env':
        this.backend = new EnvironmentVariableBackend();
        break;
      case 'aws-kms':
        this.backend = new AWSKMSBackend(config.aws);
        break;
      case 'gcp-kms':
        this.backend = new GCPKMSBackend(config.gcp);
        break;
      case 'azure-kv':
        this.backend = new AzureKeyVaultBackend(config.azure);
        break;
      case 'hsm':
        this.backend = new HSMBackend(config.hsm);
        break;
      default:
        throw new Error(`Unknown key backend: ${config.backend}`);
    }
  }

  async sign(message: Buffer, keyId: string): Promise<Buffer> {
    this.auditLog('SIGN_REQUEST', keyId);
    const signature = await this.backend.sign(message, keyId);
    this.auditLog('SIGN_SUCCESS', keyId);
    return signature;
  }

  async getPublicKey(keyId: string): Promise<Buffer> {
    return this.backend.getPublicKey(keyId);
  }

  async rotateKey(keyId: string): Promise<string> {
    this.auditLog('KEY_ROTATION_START', keyId);
    const newKeyId = await this.backend.rotateKey(keyId);
    this.auditLog('KEY_ROTATION_COMPLETE', newKeyId);
    return newKeyId;
  }

  private auditLog(event: string, keyId: string) {
    this.logger.info('Key operation', {
      event,
      keyId,
      timestamp: Date.now(),
      nodeId: this.config.nodeId,
    });
  }
}

// AWS KMS Backend Implementation
class AWSKMSBackend implements KeyManagerBackend {
  private kmsClient: KMSClient;

  constructor(config: AWSConfig) {
    this.kmsClient = new KMSClient({
      region: config.region,
      credentials: config.credentials,
    });
  }

  async sign(message: Buffer, keyId: string): Promise<Buffer> {
    const command = new SignCommand({
      KeyId: keyId,
      Message: message,
      SigningAlgorithm: 'ECDSA_SHA_256', // For EVM
    });

    const response = await this.kmsClient.send(command);
    return Buffer.from(response.Signature);
  }

  async getPublicKey(keyId: string): Promise<Buffer> {
    const command = new GetPublicKeyCommand({ KeyId: keyId });
    const response = await this.kmsClient.send(command);
    return Buffer.from(response.PublicKey);
  }

  async rotateKey(keyId: string): Promise<string> {
    // Create new key with same policy
    const createCommand = new CreateKeyCommand({
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'ECC_SECG_P256K1', // secp256k1 for Ethereum
    });

    const response = await this.kmsClient.send(createCommand);
    return response.KeyMetadata.KeyId;
  }
}
```

### Configuration

```yaml
# Connector key management configuration
security:
  keyManagement:
    backend: aws-kms # env | aws-kms | gcp-kms | azure-kv | hsm

    # AWS KMS configuration
    aws:
      region: us-east-1
      evmKeyId: arn:aws:kms:us-east-1:123456789012:key/evm-signing-key
      xrpKeyId: arn:aws:kms:us-east-1:123456789012:key/xrp-signing-key

    # Key rotation policy
    rotation:
      enabled: true
      intervalDays: 90
      overlapDays: 7 # Both old and new key valid during transition
```

---

## Story 12.3: Rate Limiting and DDoS Protection

As a network operator,
I want rate limiting and DDoS protection on all connector endpoints,
so that the network is resilient against abuse and resource exhaustion attacks.

### Acceptance Criteria

1. `RateLimiter` middleware implemented in `packages/connector/src/security/rate-limiter.ts`
2. Rate limiting applied to: BTP connections, HTTP API endpoints, settlement requests, ILP packet processing
3. Rate limiter supports multiple strategies: token bucket, sliding window, fixed window
4. Rate limits configurable per: peer, IP address, global
5. Rate limiter implements adaptive limits: increase limit for trusted peers, decrease for suspicious activity
6. Rate limiter integrates with circuit breaker: block peer if sustained limit violations
7. Rate limiting metrics exposed: requests/second, throttled requests, blocked peers
8. Rate limiter logs all throttling events with structured logging
9. Unit tests verify rate limiting logic for various traffic patterns
10. Integration test demonstrates DDoS protection under high load (10K requests/second)

### Rate Limiter Implementation

```typescript
// packages/connector/src/security/rate-limiter.ts

interface RateLimitConfig {
  maxRequestsPerSecond: number;
  maxRequestsPerMinute: number;
  burstSize: number;
  blockDuration: number; // Seconds to block after sustained violations
}

class RateLimiter {
  private tokenBuckets = new Map<string, TokenBucket>();
  private blockedPeers = new Set<string>();

  constructor(private config: RateLimitConfig) {}

  async checkLimit(peerId: string, requestType: string): Promise<boolean> {
    // Check if peer is blocked
    if (this.blockedPeers.has(peerId)) {
      this.metrics.recordBlocked(peerId, requestType);
      return false;
    }

    // Get or create token bucket for peer
    const bucket = this.getOrCreateBucket(peerId);

    // Try to consume token
    if (bucket.tryConsume()) {
      this.metrics.recordAllowed(peerId, requestType);
      return true;
    } else {
      this.metrics.recordThrottled(peerId, requestType);
      this.handleViolation(peerId);
      return false;
    }
  }

  private handleViolation(peerId: string) {
    const violations = this.violationCounter.increment(peerId);

    // Block peer if sustained violations (>100 in last minute)
    if (violations > 100) {
      this.blockPeer(peerId, this.config.blockDuration);
      this.logger.warn('Peer blocked due to sustained rate limit violations', {
        peerId,
        violations,
        blockDuration: this.config.blockDuration,
      });
    }
  }

  private blockPeer(peerId: string, durationSeconds: number) {
    this.blockedPeers.add(peerId);
    setTimeout(() => {
      this.blockedPeers.delete(peerId);
      this.logger.info('Peer unblocked', { peerId });
    }, durationSeconds * 1000);
  }
}

// Token Bucket implementation
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number // Tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
```

### Rate Limit Configuration

```yaml
# Connector rate limiting configuration
security:
  rateLimiting:
    enabled: true

    # Global limits (all peers combined)
    global:
      maxPacketsPerSecond: 10000
      maxSettlementsPerMinute: 100
      maxBTPConnectionsPerMinute: 50

    # Per-peer limits
    perPeer:
      maxPacketsPerSecond: 1000
      maxSettlementsPerMinute: 10
      burstSize: 100
      blockDuration: 300 # 5 minutes

    # Trusted peers (higher limits)
    trustedPeers:
      - peerId: peer-alice
        maxPacketsPerSecond: 5000
      - peerId: peer-bob
        maxPacketsPerSecond: 5000
```

---

## Story 12.4: Fraud Detection and Anomaly Monitoring

As a security operator,
I want automated fraud detection and anomaly monitoring,
so that suspicious activity is detected and mitigated before causing financial loss.

### Acceptance Criteria

1. `FraudDetector` service implemented in `packages/connector/src/security/fraud-detector.ts`
2. Fraud detector monitors: settlement patterns, packet volumes, balance changes, channel behaviors
3. Fraud detector implements anomaly detection: sudden traffic spikes, unusual settlement amounts, rapid channel closures
4. Fraud detector tracks peer reputation scores based on behavior history
5. Fraud detector implements alert rules: email/Slack notification for high-risk events
6. Fraud detector auto-pauses suspicious peers (requires manual review to re-enable)
7. Fraud detector maintains audit trail of all detections and actions
8. Fraud detector exposes metrics: detections/hour, false positives, blocked transactions
9. Unit tests verify fraud detection rules with simulated attack scenarios
10. Integration test demonstrates fraud detection under simulated attack (double-spend attempt, channel griefing)

### Fraud Detection Rules

```typescript
// packages/connector/src/security/fraud-detector.ts

interface FraudRule {
  name: string;
  check(event: SettlementEvent | PacketEvent): Promise<FraudDetection>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

class FraudDetector {
  private rules: FraudRule[] = [
    new SuddenTrafficSpikeRule(),
    new UnusualSettlementAmountRule(),
    new RapidChannelClosureRule(),
    new DoubleSpendDetectionRule(),
    new BalanceManipulationRule(),
  ];

  async analyzeEvent(event: SettlementEvent | PacketEvent): Promise<void> {
    for (const rule of this.rules) {
      const detection = await rule.check(event);

      if (detection.detected) {
        await this.handleFraudDetection(detection, rule);
      }
    }
  }

  private async handleFraudDetection(detection: FraudDetection, rule: FraudRule) {
    this.logger.warn('Fraud detected', {
      rule: rule.name,
      severity: rule.severity,
      peerId: detection.peerId,
      details: detection.details,
    });

    // Record in audit log
    await this.auditLog.record({
      event: 'FRAUD_DETECTED',
      rule: rule.name,
      severity: rule.severity,
      peerId: detection.peerId,
      timestamp: Date.now(),
      details: detection.details,
    });

    // Auto-pause peer if critical severity
    if (rule.severity === 'critical') {
      await this.pausePeer(detection.peerId);
      await this.sendAlert('CRITICAL', `Peer ${detection.peerId} auto-paused due to ${rule.name}`);
    } else if (rule.severity === 'high') {
      await this.sendAlert('HIGH', `Fraud detected for peer ${detection.peerId}: ${rule.name}`);
    }

    // Update peer reputation score
    await this.updateReputationScore(detection.peerId, rule.severity);
  }
}

// Example fraud rule: Sudden Traffic Spike
class SuddenTrafficSpikeRule implements FraudRule {
  name = 'SuddenTrafficSpike';
  severity = 'medium' as const;

  async check(event: PacketEvent): Promise<FraudDetection> {
    const peerId = event.peerId;
    const recentRate = await this.metricsCollector.getPacketRate(peerId, 60); // Last 60s
    const historicalAverage = await this.metricsCollector.getAveragePacketRate(peerId, 3600); // Last hour

    // Detect if current rate is >10x historical average
    if (recentRate > historicalAverage * 10) {
      return {
        detected: true,
        peerId,
        details: {
          recentRate,
          historicalAverage,
          multiplier: recentRate / historicalAverage,
        },
      };
    }

    return { detected: false };
  }
}

// Example fraud rule: Double Spend Detection
class DoubleSpendDetectionRule implements FraudRule {
  name = 'DoubleSpendDetection';
  severity = 'critical' as const;

  async check(event: SettlementEvent): Promise<FraudDetection> {
    const { peerId, channelId, claim } = event;

    // Check if we've seen a higher claim amount previously
    const previousClaim = await this.claimStore.getLatestClaim(channelId);

    if (previousClaim && claim.amount < previousClaim.amount) {
      return {
        detected: true,
        peerId,
        details: {
          channelId,
          currentClaimAmount: claim.amount,
          previousClaimAmount: previousClaim.amount,
          description: 'Attempt to submit lower claim amount (possible double-spend)',
        },
      };
    }

    return { detected: false };
  }
}
```

### Alert Configuration

```yaml
# Connector fraud detection configuration
security:
  fraudDetection:
    enabled: true

    # Alert channels
    alerts:
      email:
        enabled: true
        recipients:
          - security@example.com
          - ops@example.com
      slack:
        enabled: true
        webhookUrl: ${SLACK_WEBHOOK_URL}
        channel: '#security-alerts'

    # Detection rules
    rules:
      suddenTrafficSpike:
        enabled: true
        threshold: 10 # 10x historical average
      unusualSettlementAmount:
        enabled: true
        threshold: 1000000 # Alert if single settlement >1M units
      doubleSpend:
        enabled: true
        autoPause: true
```

---

## Story 12.5: Performance Optimization for 10K+ TPS

As a performance engineer,
I want the connector optimized for 10,000+ transactions per second throughput,
so that the platform can scale to support high-volume AI agent micropayments.

### Acceptance Criteria

1. Performance profiling completed: identify bottlenecks in packet processing, settlement, and telemetry
2. Packet handler optimized: parallel processing, zero-copy buffers, fast-path routing
3. TigerBeetle batching implemented: batch 100+ transfers per TigerBeetle request
4. Telemetry buffering implemented: batch telemetry events, send every 100ms or 1000 events
5. Connection pooling for all external services: TigerBeetle, XRPL, Base L2 RPC
6. Worker thread pool for CPU-intensive tasks: signature verification, OER encoding/decoding
7. Performance benchmarks: sustained 10K packets/second with <10ms p99 latency
8. Memory profiling: <500MB heap usage under load, no memory leaks
9. CPU profiling: <80% CPU usage under 10K TPS load
10. Load testing suite demonstrates 10K TPS sustained for 1 hour

### Performance Optimizations

**1. Packet Processing Parallelization:**

```typescript
// packages/connector/src/routing/packet-processor.ts

class PacketProcessor {
  private workerPool: WorkerPool;

  constructor() {
    // Create worker thread pool for parallel processing
    this.workerPool = new WorkerPool({
      numWorkers: os.cpus().length,
      workerScript: './packet-worker.js',
    });
  }

  async processBatch(packets: ILPPacket[]): Promise<ProcessingResult[]> {
    // Distribute packets across worker threads
    const chunks = this.chunkPackets(packets, this.workerPool.size);

    const results = await Promise.all(
      chunks.map((chunk) => this.workerPool.execute('processPackets', chunk))
    );

    return results.flat();
  }
}
```

**2. TigerBeetle Batching:**

```typescript
// packages/connector/src/settlement/tigerbeetle-batch-writer.ts

class TigerBeetleBatchWriter {
  private pendingTransfers: Transfer[] = [];
  private flushInterval = 10; // Flush every 10ms

  constructor(private client: TigerBeetleClient) {
    // Periodic flush
    setInterval(() => this.flush(), this.flushInterval);
  }

  async recordTransfer(transfer: Transfer): Promise<void> {
    this.pendingTransfers.push(transfer);

    // Flush if batch size reached (100 transfers)
    if (this.pendingTransfers.length >= 100) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.pendingTransfers.length === 0) return;

    const batch = this.pendingTransfers.splice(0);

    try {
      await this.client.createTransfers(batch);
      this.metrics.recordBatchSize(batch.length);
    } catch (error) {
      this.logger.error('TigerBeetle batch write failed', { error, batchSize: batch.length });
      // Re-queue transfers for retry
      this.pendingTransfers.unshift(...batch);
    }
  }
}
```

**3. Zero-Copy Buffer Optimization:**

```typescript
// packages/connector/src/ilp/oer-parser.ts

class OERParser {
  // Use Buffer.slice() instead of Buffer.from() to avoid copying
  parsePacket(buffer: Buffer): ILPPacket {
    const type = buffer.readUInt8(0);
    const dataOffset = this.readVarOctetStringOffset(buffer, 1);

    // Zero-copy: slice returns view into original buffer
    const data = buffer.slice(dataOffset.start, dataOffset.end);

    return { type, data };
  }
}
```

**4. Connection Pooling:**

```typescript
// packages/connector/src/settlement/connection-pool.ts

class EVMRPCConnectionPool {
  private connections: ethers.JsonRpcProvider[] = [];
  private currentIndex = 0;

  constructor(rpcUrls: string[], poolSize: number = 10) {
    for (let i = 0; i < poolSize; i++) {
      const url = rpcUrls[i % rpcUrls.length];
      this.connections.push(new ethers.JsonRpcProvider(url));
    }
  }

  getConnection(): ethers.JsonRpcProvider {
    const connection = this.connections[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
    return connection;
  }
}
```

### Performance Benchmarks

```typescript
// packages/connector/test/performance/throughput-benchmark.test.ts

describe('10K TPS Benchmark', () => {
  it('should sustain 10,000 packets/second for 1 hour', async () => {
    const targetTPS = 10000;
    const durationSeconds = 3600; // 1 hour
    const totalPackets = targetTPS * durationSeconds;

    const startTime = Date.now();
    let processedPackets = 0;

    for (let i = 0; i < totalPackets; i++) {
      const packet = generateTestPacket();
      await connector.handlePreparePacket(packet);
      processedPackets++;

      // Measure throughput every second
      if (processedPackets % targetTPS === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const currentTPS = processedPackets / elapsed;
        expect(currentTPS).toBeGreaterThan(9500); // >95% of target
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    const avgTPS = totalPackets / totalTime;

    expect(avgTPS).toBeGreaterThan(10000);
    expect(connector.metrics.p99Latency).toBeLessThan(10); // <10ms p99
  });
});
```

### Configuration

```yaml
# Connector performance configuration
performance:
  packetProcessing:
    workerThreads: 8 # Number of CPU cores
    batchSize: 100

  tigerbeetle:
    batchSize: 100
    flushIntervalMs: 10

  telemetry:
    bufferSize: 1000
    flushIntervalMs: 100

  connectionPools:
    evm:
      poolSize: 10
      rpcUrls:
        - https://mainnet.base.org
        - https://base.llamarpc.com
    xrp:
      poolSize: 5
      wssUrls:
        - wss://xrplcluster.com
        - wss://s1.ripple.com
```

---

## Story 12.6: Production Monitoring and Alerting

As a DevOps engineer,
I want comprehensive monitoring and alerting for all production connectors,
so that I can detect and respond to issues before they impact users.

### Acceptance Criteria

1. Prometheus metrics exporter implemented in `packages/connector/src/observability/prometheus-exporter.ts`
2. Metrics exposed: packets/second, settlement latency, TigerBeetle balance, channel states, error rates
3. Health check endpoint exposes: service status, dependency health, version info
4. Grafana dashboards created: network overview, connector health, settlement activity
5. Alerting rules configured: high error rate, settlement failures, TigerBeetle unavailable, channel disputes
6. Log aggregation integration: structured JSON logs to stdout, compatible with ELK/Datadog/CloudWatch
7. Distributed tracing with OpenTelemetry: trace packet flow across connectors
8. SLA monitoring: packet delivery success rate, settlement success rate, p99 latency
9. Runbook documentation for common alerts and incident response
10. Integration test verifies metrics collection and alert triggering

### Prometheus Metrics

```typescript
// packages/connector/src/observability/prometheus-exporter.ts

import { register, Counter, Histogram, Gauge } from 'prom-client';

class PrometheusExporter {
  // Packet metrics
  private packetsProcessed = new Counter({
    name: 'ilp_packets_processed_total',
    help: 'Total ILP packets processed',
    labelNames: ['type', 'status'], // prepare/fulfill/reject, success/error
  });

  private packetLatency = new Histogram({
    name: 'ilp_packet_latency_seconds',
    help: 'ILP packet processing latency',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  });

  // Settlement metrics
  private settlementsExecuted = new Counter({
    name: 'settlements_executed_total',
    help: 'Total settlements executed',
    labelNames: ['method', 'status'], // evm/xrp, success/failure
  });

  private settlementLatency = new Histogram({
    name: 'settlement_latency_seconds',
    help: 'Settlement execution latency',
    buckets: [1, 3, 5, 10, 30, 60],
  });

  // Account balance metrics
  private accountBalances = new Gauge({
    name: 'account_balance_units',
    help: 'Current account balance per peer',
    labelNames: ['peer_id', 'token_id'],
  });

  // Channel metrics
  private activeChannels = new Gauge({
    name: 'payment_channels_active',
    help: 'Number of active payment channels',
    labelNames: ['method', 'status'], // evm/xrp, open/closing/closed
  });

  // Error metrics
  private errors = new Counter({
    name: 'connector_errors_total',
    help: 'Total errors by type',
    labelNames: ['type', 'severity'],
  });

  // Record metrics
  recordPacketProcessed(type: string, status: string, latency: number) {
    this.packetsProcessed.inc({ type, status });
    this.packetLatency.observe(latency);
  }

  recordSettlement(method: string, status: string, latency: number) {
    this.settlementsExecuted.inc({ method, status });
    this.settlementLatency.observe(latency);
  }

  updateAccountBalance(peerId: string, tokenId: string, balance: number) {
    this.accountBalances.set({ peer_id: peerId, token_id: tokenId }, balance);
  }

  // Metrics endpoint for Prometheus scraping
  getMetrics(): string {
    return register.metrics();
  }
}
```

### Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "ILP Connector Overview",
    "panels": [
      {
        "title": "Packet Throughput",
        "targets": [
          {
            "expr": "rate(ilp_packets_processed_total[1m])",
            "legendFormat": "{{type}} - {{status}}"
          }
        ]
      },
      {
        "title": "Settlement Success Rate",
        "targets": [
          {
            "expr": "rate(settlements_executed_total{status=\"success\"}[5m]) / rate(settlements_executed_total[5m])",
            "legendFormat": "{{method}}"
          }
        ]
      },
      {
        "title": "Account Balances",
        "targets": [
          {
            "expr": "account_balance_units",
            "legendFormat": "{{peer_id}} - {{token_id}}"
          }
        ]
      },
      {
        "title": "p99 Packet Latency",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, rate(ilp_packet_latency_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

### Alert Rules (Prometheus Alertmanager)

```yaml
# prometheus-alerts.yml
groups:
  - name: connector_alerts
    interval: 30s
    rules:
      - alert: HighPacketErrorRate
        expr: rate(ilp_packets_processed_total{status="error"}[5m]) / rate(ilp_packets_processed_total[5m]) > 0.05
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: 'High packet error rate (>5%)'
          description: 'Connector {{$labels.instance}} has {{$value}}% packet error rate'

      - alert: SettlementFailures
        expr: rate(settlements_executed_total{status="failure"}[5m]) > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Settlement failures detected'
          description: 'Connector {{$labels.instance}} experiencing settlement failures'

      - alert: TigerBeetleUnavailable
        expr: up{job="tigerbeetle"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'TigerBeetle database unavailable'
          description: 'TigerBeetle instance {{$labels.instance}} is down'

      - alert: ChannelDispute
        expr: payment_channels_active{status="disputed"} > 0
        labels:
          severity: high
        annotations:
          summary: 'Payment channel dispute detected'
          description: 'Channel dispute on {{$labels.method}} for {{$labels.instance}}'
```

---

## Story 12.7: Production Docker Deployment and Peer Onboarding

As a new connector operator,
I want simplified Docker-based deployment with automated peer onboarding,
so that I can join the M2M network quickly without extensive technical knowledge.

### Acceptance Criteria

1. Production Docker Compose file created: `docker-compose-production.yml`
2. Docker Compose includes: connector, TigerBeetle, monitoring stack (Prometheus, Grafana)
3. One-command deployment: `docker-compose up -d` starts all services
4. Environment variable configuration: `.env.example` template provided
5. Automated peer discovery: connector broadcasts availability, peers connect automatically
6. Peer onboarding wizard: interactive CLI tool guides through configuration
7. Health checks for all services: connector, TigerBeetle, blockchain connections
8. Automatic restart policies: services restart on failure
9. Volume management: persistent data for TigerBeetle, connector state, logs
10. Production deployment guide with step-by-step instructions

### Production Docker Compose

```yaml
# docker-compose-production.yml
version: '3.8'

services:
  connector:
    image: m2m/connector:latest
    container_name: connector
    restart: unless-stopped
    ports:
      - '4000:4000' # BTP port
      - '8080:8080' # HTTP API / Health check
      - '9090:9090' # Prometheus metrics
    environment:
      - NODE_ID=${NODE_ID}
      - BTP_PORT=4000
      - TIGERBEETLE_URL=tigerbeetle:3000
      - XRPL_WSS_URL=${XRPL_WSS_URL}
      - BASE_RPC_URL=${BASE_RPC_URL}
      - KEY_BACKEND=${KEY_BACKEND:-env}
      - AWS_KMS_KEY_ID=${AWS_KMS_KEY_ID}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    volumes:
      - connector-data:/app/data
      - connector-logs:/app/logs
    depends_on:
      tigerbeetle:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
      interval: 30s
      timeout: 10s
      retries: 3

  tigerbeetle:
    image: tigerbeetle/tigerbeetle:latest
    container_name: tigerbeetle
    restart: unless-stopped
    command: start --addresses=0.0.0.0:3000
    ports:
      - '3000:3000'
    volumes:
      - tigerbeetle-data:/var/lib/tigerbeetle
    healthcheck:
      test: ['CMD', '/tigerbeetle', 'version']
      interval: 10s
      timeout: 5s
      retries: 5

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - '9091:9090'
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_INSTALL_PLUGINS=grafana-piechart-panel
    volumes:
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
      - grafana-data:/var/lib/grafana

volumes:
  connector-data:
  connector-logs:
  tigerbeetle-data:
  prometheus-data:
  grafana-data:
```

### Peer Onboarding Wizard

```typescript
// packages/connector/src/cli/onboarding-wizard.ts

import inquirer from 'inquirer';

async function runOnboardingWizard() {
  console.log('🚀 Welcome to M2M Connector Setup!\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'nodeId',
      message: 'Enter your connector node ID:',
      default: `connector-${Math.random().toString(36).substr(2, 9)}`,
    },
    {
      type: 'list',
      name: 'settlementPreference',
      message: 'Which settlement methods do you want to support?',
      choices: ['EVM only (Base L2)', 'XRP only', 'Both EVM and XRP'],
    },
    {
      type: 'input',
      name: 'evmAddress',
      message: 'Enter your Ethereum address (for EVM settlement):',
      when: (answers) => answers.settlementPreference !== 'XRP only',
      validate: (input) => /^0x[a-fA-F0-9]{40}$/.test(input) || 'Invalid Ethereum address',
    },
    {
      type: 'input',
      name: 'xrpAddress',
      message: 'Enter your XRP Ledger address (for XRP settlement):',
      when: (answers) => answers.settlementPreference !== 'EVM only (Base L2)',
      validate: (input) => /^r[a-zA-Z0-9]{24,34}$/.test(input) || 'Invalid XRP address',
    },
    {
      type: 'list',
      name: 'keyBackend',
      message: 'How do you want to manage private keys?',
      choices: [
        'Environment variables (development only)',
        'AWS KMS (recommended for production)',
        'GCP KMS',
        'Azure Key Vault',
      ],
    },
    {
      type: 'confirm',
      name: 'enableMonitoring',
      message: 'Enable Prometheus/Grafana monitoring?',
      default: true,
    },
  ]);

  // Generate .env file
  const envContent = generateEnvFile(answers);
  fs.writeFileSync('.env', envContent);

  console.log('\n✅ Configuration complete!');
  console.log('\n📝 Next steps:');
  console.log('  1. Review the generated .env file');
  console.log('  2. Fund your accounts (EVM/XRP) for settlement');
  console.log('  3. Run: docker-compose -f docker-compose-production.yml up -d');
  console.log('  4. Monitor at: http://localhost:3000 (Grafana)\n');
}

function generateEnvFile(answers: any): string {
  return `
# M2M Connector Configuration (Generated by Onboarding Wizard)

NODE_ID=${answers.nodeId}
BTP_PORT=4000

# Settlement Configuration
SETTLEMENT_PREFERENCE=${answers.settlementPreference}
${answers.evmAddress ? `EVM_ADDRESS=${answers.evmAddress}` : ''}
${answers.xrpAddress ? `XRP_ADDRESS=${answers.xrpAddress}` : ''}

# Blockchain RPC Endpoints
BASE_RPC_URL=https://mainnet.base.org
XRPL_WSS_URL=wss://xrplcluster.com

# Key Management
KEY_BACKEND=${answers.keyBackend.split(' ')[0].toLowerCase()}
${answers.keyBackend.includes('AWS') ? '# AWS_KMS_KEY_ID=<your-kms-key-id>' : ''}

# Monitoring
${answers.enableMonitoring ? 'PROMETHEUS_ENABLED=true' : 'PROMETHEUS_ENABLED=false'}
${answers.enableMonitoring ? 'GRAFANA_PASSWORD=admin' : ''}

# Logging
LOG_LEVEL=info
`.trim();
}
```

---

## Story 12.8: CI/CD Pipeline and Automated Testing

As a development team,
I want CI/CD pipelines for automated testing and deployment,
so that code changes are validated and deployed safely to production.

### Acceptance Criteria

1. GitHub Actions workflow created: `.github/workflows/ci.yml`
2. CI pipeline runs on every PR: lint, unit tests, integration tests
3. CI pipeline builds Docker images and pushes to registry
4. CD pipeline deploys to staging environment on merge to main
5. CD pipeline requires manual approval for production deployment
6. Automated security scanning: dependency vulnerabilities, container image scanning
7. Performance regression testing: benchmark TPS on every release
8. Automated changelog generation from conventional commits
9. Semantic versioning and Git tagging on releases
10. Deployment rollback capability if health checks fail post-deployment

### GitHub Actions CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:unit
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      tigerbeetle:
        image: tigerbeetle/tigerbeetle:latest
        ports:
          - 3000:3000
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: docker-compose -f docker-compose-dev.yml up -d
      - run: npm run test:integration
      - run: docker-compose -f docker-compose-dev.yml down

  performance-benchmark:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run benchmark
      - name: Check for performance regression
        run: |
          CURRENT_TPS=$(cat benchmark-results.json | jq '.tps')
          if [ "$CURRENT_TPS" -lt 10000 ]; then
            echo "Performance regression detected: $CURRENT_TPS TPS < 10000 TPS"
            exit 1
          fi

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      - name: Run Trivy container scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'm2m/connector:latest'
          format: 'sarif'
          output: 'trivy-results.sarif'

  build-and-push:
    runs-on: ubuntu-latest
    needs: [lint, unit-tests, integration-tests]
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v3
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      - name: Login to DockerHub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: |
            m2m/connector:latest
            m2m/connector:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy-staging:
    runs-on: ubuntu-latest
    needs: [build-and-push]
    if: github.ref == 'refs/heads/main'
    environment: staging
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to staging
        run: |
          ssh ${{ secrets.STAGING_HOST }} "cd /opt/m2m && docker-compose pull && docker-compose up -d"
      - name: Run health checks
        run: |
          sleep 30
          curl -f http://${{ secrets.STAGING_HOST }}:8080/health || exit 1

  deploy-production:
    runs-on: ubuntu-latest
    needs: [deploy-staging]
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to production
        run: |
          ssh ${{ secrets.PRODUCTION_HOST }} "cd /opt/m2m && docker-compose pull && docker-compose up -d"
      - name: Run health checks
        run: |
          sleep 30
          curl -f http://${{ secrets.PRODUCTION_HOST }}:8080/health || exit 1
      - name: Create GitHub release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: v${{ github.run_number }}
          release_name: Release v${{ github.run_number }}
          body: Auto-generated release from CI/CD pipeline
```

---

## Story 12.9: Comprehensive Operator Documentation

As a connector operator,
I want comprehensive documentation covering deployment, configuration, monitoring, and troubleshooting,
so that I can successfully run a production connector node.

### Acceptance Criteria

1. Operator guide created: `docs/operators/production-deployment-guide.md`
2. Documentation covers: system requirements, installation, configuration, security hardening
3. Troubleshooting guide with common issues and solutions
4. Monitoring and alerting setup guide
5. Incident response runbook for common scenarios
6. Backup and disaster recovery procedures
7. Upgrade and migration guide for new versions
8. Performance tuning guide for high-throughput scenarios
9. Security audit checklist for production deployments
10. API reference documentation for all operator endpoints

### Documentation Structure

**`docs/operators/production-deployment-guide.md`:**

1. System Requirements
   - Hardware: CPU, RAM, disk, network
   - Software: Docker, Docker Compose, OS compatibility
2. Installation
   - Clone repository
   - Run onboarding wizard
   - Configure environment variables
   - Start services with Docker Compose
3. Configuration
   - Peer configuration (settlement preferences, addresses)
   - Security configuration (key management, rate limiting, fraud detection)
   - Performance tuning (worker threads, batch sizes, connection pools)
   - Monitoring configuration (Prometheus, Grafana, alerts)
4. Security Hardening
   - HSM/KMS setup for key management
   - Firewall configuration
   - TLS certificate setup for BTP connections
   - Secret rotation procedures
5. Monitoring and Alerting
   - Grafana dashboard setup
   - Alert rule configuration
   - Incident response procedures
6. Backup and Recovery
   - TigerBeetle backup procedures
   - Connector state backup
   - Disaster recovery testing
7. Troubleshooting
   - Common issues and solutions
   - Log analysis
   - Performance debugging
   - Settlement failure diagnosis

**`docs/operators/incident-response-runbook.md`:**

```markdown
# Incident Response Runbook

## High Packet Error Rate

**Symptoms:**

- Alert: `HighPacketErrorRate` triggered
- Prometheus metric: `ilp_packets_processed_total{status="error"}` > 5%

**Diagnosis:**

1. Check connector logs: `docker logs connector | grep ERROR`
2. Identify error patterns: routing failures, peer timeouts, encoding errors
3. Check peer connectivity: `curl http://peer-address:4000/health`

**Resolution:**

1. If specific peer causing errors: pause peer temporarily
2. If routing table corrupted: restart connector
3. If OER encoding errors: verify packet format with test suite

## Settlement Failures

**Symptoms:**

- Alert: `SettlementFailures` triggered
- Prometheus metric: `settlements_executed_total{status="failure"}` > 0

**Diagnosis:**

1. Check settlement logs: `docker logs connector | grep "settlement"`
2. Verify blockchain connectivity:
   - EVM: `curl $BASE_RPC_URL -X POST -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
   - XRP: Check XRPL WebSocket connection status
3. Check channel state: query on-chain channel status

**Resolution:**

1. If RPC endpoint down: switch to backup RPC URL
2. If insufficient gas/XRP: fund settlement account
3. If channel dispute: submit latest claim during settlement delay
4. If persistent failures: pause settlements and investigate

## TigerBeetle Unavailable

**Symptoms:**

- Alert: `TigerBeetleUnavailable` triggered
- Connector unable to record transfers

**Diagnosis:**

1. Check TigerBeetle status: `docker ps | grep tigerbeetle`
2. Check TigerBeetle logs: `docker logs tigerbeetle`
3. Verify disk space: `df -h`

**Resolution:**

1. If container stopped: `docker-compose restart tigerbeetle`
2. If disk full: clean up old logs, expand volume
3. If data corruption: restore from backup
```

---

## Story 12.10: Production Acceptance Testing and Go-Live

As a project stakeholder,
I want comprehensive production acceptance testing demonstrating the system meets all requirements,
so that we can confidently launch the M2M economy platform to production.

### Acceptance Criteria

1. Production acceptance test suite created covering all epic requirements
2. Load testing: sustained 10K TPS for 24 hours without degradation
3. Multi-chain settlement testing: simultaneous EVM and XRP settlements across network
4. Security penetration testing: vulnerability assessment by third party
5. Disaster recovery testing: backup/restore, failover scenarios
6. Integration testing: end-to-end flows across all 10 epics
7. Performance benchmarking: latency, throughput, resource usage under load
8. Documentation completeness review: all operator guides, API docs, runbooks
9. Go-live checklist: production readiness assessment
10. Production launch: deploy to mainnet, onboard initial peers, monitor for 72 hours

### Production Acceptance Tests

```typescript
// packages/connector/test/acceptance/production-acceptance.test.ts

describe('Production Acceptance Tests', () => {
  describe('Epic 1-5: Core Functionality', () => {
    it('should forward ILP packets with RFC-0027 compliance', async () => {
      // Test ILPv4 packet forwarding, routing, BTP transport
    });

    it('should visualize network topology in real-time dashboard', async () => {
      // Test dashboard telemetry and visualization
    });

    it('should provide comprehensive logging and developer experience', async () => {
      // Test structured logging, configuration, documentation
    });
  });

  describe('Epic 6: Settlement Foundation', () => {
    it('should track balances accurately in TigerBeetle', async () => {
      // Forward 10K packets, verify TigerBeetle balances match expected
    });

    it('should enforce credit limits and reject over-limit packets', async () => {
      // Configure credit limit, exceed threshold, verify rejection
    });

    it('should trigger settlement when threshold exceeded', async () => {
      // Forward packets until threshold, verify settlement trigger
    });
  });

  describe('Epic 7: Local Blockchain Infrastructure', () => {
    it('should provide local Anvil for EVM contract development', async () => {
      // Deploy test contract to local Anvil, verify functionality
    });

    it('should provide local rippled for XRP channel development', async () => {
      // Create test payment channel on local rippled
    });
  });

  describe('Epic 8: EVM Payment Channels', () => {
    it('should create and fund EVM payment channels on Base L2', async () => {
      // Open channel, deposit USDC, verify on-chain state
    });

    it('should execute off-chain balance proofs with EIP-712 signatures', async () => {
      // Sign balance proof, verify signature, submit to contract
    });

    it('should settle channels with challenge period protection', async () => {
      // Close channel, wait settlement delay, finalize settlement
    });
  });

  describe('Epic 9: XRP Payment Channels', () => {
    it('should create and fund XRP payment channels on XRPL', async () => {
      // Open PayChan, fund with XRP, verify on-ledger state
    });

    it('should sign and verify XRP claims off-chain', async () => {
      // Sign claim with ed25519, verify signature
    });

    it('should support dual-settlement (EVM + XRP)', async () => {
      // Configure peer with both methods, route settlements appropriately
    });
  });

  describe('Epic 12: Production Hardening', () => {
    it('should sustain 10,000 TPS for 24 hours', async () => {
      const duration = 24 * 60 * 60 * 1000; // 24 hours
      const startTime = Date.now();
      let totalPackets = 0;

      while (Date.now() - startTime < duration) {
        await connector.processBatch(generateTestPackets(1000));
        totalPackets += 1000;

        const currentTPS = totalPackets / ((Date.now() - startTime) / 1000);
        expect(currentTPS).toBeGreaterThan(10000);
      }
    });

    it('should detect and mitigate fraud attempts', async () => {
      // Simulate double-spend attack, verify detection and blocking
    });

    it('should route settlements optimally across chains', async () => {
      // Test settlement coordinator routing logic
    });

    it('should recover from TigerBeetle failure', async () => {
      // Stop TigerBeetle, verify buffering, restart, verify replay
    });

    it('should handle blockchain RPC failures with fallback', async () => {
      // Kill primary RPC endpoint, verify fallback to secondary
    });
  });
});
```

### Production Launch Checklist

```markdown
# Production Launch Checklist

## Pre-Launch (T-7 days)

- [ ] All integration tests passing
- [ ] Performance benchmarks meet requirements (10K TPS, <10ms p99 latency)
- [ ] Security audit completed and findings remediated
- [ ] Documentation review complete
- [ ] Monitoring dashboards configured
- [ ] Alert rules configured and tested
- [ ] Incident response runbooks reviewed
- [ ] Backup and recovery procedures tested

## Launch Week (T-3 days)

- [ ] Deploy to staging environment
- [ ] Run full acceptance test suite on staging
- [ ] Load test on staging (simulate 10K TPS)
- [ ] Security penetration test on staging
- [ ] Disaster recovery drill
- [ ] Operator training completed
- [ ] Communication plan ready (status page, social media, email)

## Launch Day (T-0)

- [ ] Deploy to production (Base L2 mainnet, XRPL mainnet)
- [ ] Verify health checks passing
- [ ] Onboard initial peer connectors (3-5 peers minimum)
- [ ] Verify first settlements execute successfully
- [ ] Monitor metrics dashboard for anomalies
- [ ] Have on-call team ready for incident response

## Post-Launch (T+72 hours)

- [ ] Monitor for 72 hours with on-call team
- [ ] Verify sustained performance under production load
- [ ] Review all alerts and incidents
- [ ] Collect feedback from initial peers
- [ ] Document lessons learned
- [ ] Plan next iteration improvements
```

---

## Epic Completion Criteria

- [ ] Cross-chain settlement coordination functional with intelligent routing
- [ ] HSM/KMS key management operational for production security
- [ ] Rate limiting and DDoS protection validated under 10K+ TPS load
- [ ] Fraud detection rules active and tested against attack scenarios
- [ ] Sustained 10K+ TPS performance benchmarked for 24 hours
- [ ] Production monitoring with Prometheus/Grafana dashboards operational
- [ ] One-command Docker deployment functional with peer onboarding wizard
- [ ] CI/CD pipelines automating testing, building, and deployment
- [ ] Comprehensive operator documentation complete
- [ ] Production acceptance testing passed with go-live approval

---

## Dependencies and Integration Points

**Depends On:**

- **All Previous Epics (1-9):** This epic integrates and hardens all functionality

**Final Deliverable:**

- Production-ready M2M economy platform
- Multi-chain settlement (Base L2 + XRP Ledger)
- Enterprise-grade security and reliability
- AI agent micropayment infrastructure (10K+ TPS)
- Simplified operator experience

---

## Success Metrics

- **Performance:** Sustained 10,000+ TPS with <10ms p99 latency
- **Reliability:** 99.9% uptime SLA
- **Security:** Zero critical vulnerabilities, zero security incidents
- **Settlement Success:** >99% settlement success rate across all chains
- **Onboarding:** New peers operational within 1 hour
- **Monitoring:** 100% alert coverage for critical paths
- **Cost Efficiency:** <$0.01 average cost per settlement

---

## Timeline Estimate

**Total Duration:** 10-12 weeks

- **Weeks 1-2:** Cross-chain coordination and HSM/KMS (Stories 10.1-10.2)
- **Weeks 3-4:** Security hardening (rate limiting, fraud detection) (Stories 10.3-10.4)
- **Weeks 5-7:** Performance optimization and benchmarking (Story 12.5)
- **Weeks 8-9:** Monitoring, Docker deployment, CI/CD (Stories 10.6-10.8)
- **Week 10:** Documentation and operator guides (Story 12.9)
- **Weeks 11-12:** Production acceptance testing and launch (Story 12.10)

**Critical Path:** Performance optimization (Weeks 5-7) is the most time-intensive

---

## Documentation Deliverables

1. `docs/operators/production-deployment-guide.md` - Complete operator deployment guide
2. `docs/operators/incident-response-runbook.md` - Incident response procedures
3. `docs/operators/monitoring-setup-guide.md` - Monitoring and alerting setup
4. `docs/operators/security-hardening-checklist.md` - Production security checklist
5. `docs/operators/performance-tuning-guide.md` - Performance optimization guide
6. `docs/operators/backup-recovery-procedures.md` - Backup and disaster recovery
7. `docs/architecture/production-architecture.md` - Final production architecture
8. API documentation for all operator/admin endpoints

---

**This epic represents the culmination of Epics 1-9, delivering a production-ready M2M economy platform capable of powering the future of AI agent micropayments with real cryptocurrency settlement across multiple blockchains.**
