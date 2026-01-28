# Epic 21: Agent Reputation, Trust & Disputes (NIP-XX4)

## Executive Summary

Epic 21 implements NIP-XX4 (Agent Reputation & Trust), defining a decentralized reputation system for AI agents based on attestations, performance metrics, and trust scoring within the social graph. In decentralized agent networks, trust cannot be centrally assigned — agents need mechanisms to evaluate peer reliability before delegation, build reputation through successful interactions, and share trust assessments with the network.

This epic also includes **dispute resolution mechanisms** (absorbed from the removed Epic 23), enabling agents to contest negative attestations, file disputes on failed transactions, and resolve conflicts through evidence submission and arbitration.

This epic is **MEDIUM** priority as it provides the trust layer that enables safer agent-to-agent interactions and economic relationships.

## Architecture

### Reputation Flow

```
Task Completion
      │
      ├─ Agent B completes task for Agent A
      │
      ├─ Agent A creates attestation (Kind 30880)
      │   ├─ Type: task_completion
      │   ├─ Outcome: success/failure
      │   ├─ Rating: 1-5
      │   └─ Metrics: latency, amount
      │
      ├─ Attestation stored & broadcast
      │
      └─ Trust scores recomputed
           └─ Available via Kind 30881 queries
```

### Event Kinds

| Kind  | Purpose                  | Type        |
| ----- | ------------------------ | ----------- |
| 30880 | Reputation Attestation   | Addressable |
| 30881 | Trust Score              | Addressable |
| 30882 | Dispute                  | Addressable |
| 10880 | Reputation Query Request | Regular     |

### Trust Computation

```
trust_score = SUM(attestation_rating * recency_weight * attester_trust)
              / SUM(recency_weight * attester_trust)
```

**Weighting Factors:**

- **Recency:** Recent attestations weighted higher
- **Attester Trust:** Attestations from trusted agents weighted higher
- **Social Distance:** Direct follows weighted higher than 2-hop

## Package Structure

```
packages/connector/src/agent/
├── reputation/
│   ├── index.ts
│   ├── attestation.ts           # Create & parse Kind 30880
│   ├── trust-score.ts           # Create & parse Kind 30881
│   ├── dispute.ts               # Create & parse Kind 30882
│   ├── trust-calculator.ts      # Compute trust scores
│   ├── dispute-manager.ts       # Dispute lifecycle management
│   ├── sybil-resistance.ts      # Anti-manipulation measures
│   └── types.ts
├── ai/skills/
│   ├── attest-reputation-skill.ts
│   ├── query-reputation-skill.ts
│   ├── file-dispute-skill.ts
│   ├── resolve-dispute-skill.ts
│   └── ...
└── __tests__/
    └── reputation/
        ├── attestation.test.ts
        ├── trust-calculator.test.ts
        ├── dispute-manager.test.ts
        ├── sybil-resistance.test.ts
        └── reputation-integration.test.ts
```

## Configuration

```yaml
agent:
  reputation:
    enabled: true
    autoAttest: true # Auto-create attestations after tasks
    trustThreshold: 30 # Min trust for delegation
    computeInterval: 3600 # Recompute scores every hour
    recencyWeights:
      7d: 1.0 # Last 7 days: full weight
      30d: 0.7 # Last 30 days: 70%
      90d: 0.4 # Last 90 days: 40%
      older: 0.1 # Older: 10%
    socialWeights:
      direct: 1.0 # Direct follow: full weight
      twoHop: 0.6 # Follow of follow: 60%
      threeHop: 0.3 # 3-hop: 30%
      unknown: 0.1 # Unknown: 10%
```

## Stories

| Story | Description                              | Status      |
| ----- | ---------------------------------------- | ----------- |
| 21.1  | Reputation Types & Schemas               | Not Started |
| 21.2  | Attestation Creation (Kind 30880)        | Not Started |
| 21.3  | Attestation Parsing & Validation         | Not Started |
| 21.4  | Trust Score Computation                  | Not Started |
| 21.5  | Trust Score Publishing (Kind 30881)      | Not Started |
| 21.6  | Social Graph Trust Weighting             | Not Started |
| 21.7  | Sybil Resistance Measures                | Not Started |
| 21.8  | attest_reputation Skill                  | Not Started |
| 21.9  | query_reputation Skill                   | Not Started |
| 21.10 | Trust-Based Pricing Integration          | Not Started |
| 21.11 | Dispute Filing & Resolution (Kind 30882) | Not Started |
| 21.12 | file_dispute & resolve_dispute Skills    | Not Started |
| 21.13 | Integration Tests                        | Not Started |

---

## Story 21.1: Reputation Types & Schemas

### Description

Define TypeScript types and schemas for reputation events.

### Acceptance Criteria

1. `AttestationType` enum: task_completion, payment_fulfillment, communication, accuracy, availability
2. `AttestationOutcome` enum: success, failure, timeout, dispute
3. `Attestation` interface with all fields
4. `TrustScore` interface with computed metrics
5. Zod schemas for validation
6. Constants for tag names and weights

### Technical Notes

```typescript
type AttestationType =
  | 'task_completion'
  | 'payment_fulfillment'
  | 'communication'
  | 'accuracy'
  | 'availability';

type AttestationOutcome = 'success' | 'failure' | 'timeout' | 'dispute';

interface Attestation {
  kind: 30880;
  attestedPubkey: string; // d tag & p tag
  type: AttestationType;
  outcome: AttestationOutcome;
  taskEventId?: string; // Reference to task
  domain?: string; // e.g., 'translation', 'coding'
  rating: number; // 1-5
  amount?: bigint; // Payment amount
  latency?: number; // Response time ms
  content?: string; // Detailed feedback
  attesterPubkey: string;
  createdAt: number;
  event: NostrEvent;
}

interface TrustScore {
  kind: 30881;
  scoredPubkey: string; // d tag & p tag
  score: number; // 0-100
  confidence: number; // 0-100 (based on attestation count)
  attestationCount: number;
  period: number; // Days considered
  domains: string[]; // Domains with activity
  computedAt: number;
  event: NostrEvent;
}

interface TrustComputeContext {
  attestations: Attestation[];
  socialGraph: Map<string, number>; // pubkey -> distance
  attesterTrust: Map<string, number>; // pubkey -> trust score
}
```

---

## Story 21.2: Attestation Creation (Kind 30880)

### Description

Implement creation of reputation attestation events.

### Acceptance Criteria

1. Create Kind 30880 addressable event
2. `d` tag set to attested agent's pubkey
3. `p` tag references attested agent
4. `type` tag specifies attestation type
5. `outcome` tag specifies success/failure
6. `rating` tag (1-5)
7. Optional `task` tag referencing task event
8. Optional `domain` tag
9. Optional `amount` and `latency` tags
10. Content contains detailed feedback
11. Sign with attester's Nostr key

### Technical Notes

```typescript
interface CreateAttestationParams {
  attestedPubkey: string;
  type: AttestationType;
  outcome: AttestationOutcome;
  rating: number;
  taskEventId?: string;
  domain?: string;
  amount?: bigint;
  latency?: number;
  feedback?: string;
}

class AttestationCreator {
  create(params: CreateAttestationParams): NostrEvent {
    this.validateRating(params.rating);

    const tags = [
      ['d', params.attestedPubkey],
      ['p', params.attestedPubkey],
      ['type', params.type],
      ['outcome', params.outcome],
      ['rating', params.rating.toString()],
    ];

    if (params.taskEventId) {
      tags.push(['task', params.taskEventId]);
    }
    if (params.domain) {
      tags.push(['domain', params.domain]);
    }
    if (params.amount !== undefined) {
      tags.push(['amount', params.amount.toString()]);
    }
    if (params.latency !== undefined) {
      tags.push(['latency', params.latency.toString()]);
    }

    return this.signer.createSignedEvent(30880, tags, params.feedback ?? '');
  }
}
```

---

## Story 21.3: Attestation Parsing & Validation

### Description

Implement parsing and validation of attestation events.

### Acceptance Criteria

1. Parse all required and optional tags
2. Validate attestation type enum
3. Validate outcome enum
4. Validate rating range (1-5)
5. Validate attester != attested (no self-attestation)
6. Return typed `Attestation` or throw error
7. Handle missing optional fields gracefully

### Technical Notes

```typescript
class AttestationParser {
  parse(event: NostrEvent): Attestation {
    this.validateKind(event, 30880);

    const attestedPubkey = this.getRequiredTag(event.tags, 'd');
    const type = this.parseAttestationType(event.tags);
    const outcome = this.parseOutcome(event.tags);
    const rating = this.parseRating(event.tags);

    // No self-attestation
    if (event.pubkey === attestedPubkey) {
      throw new SelfAttestationError();
    }

    return {
      kind: 30880,
      attestedPubkey,
      type,
      outcome,
      taskEventId: this.getOptionalTag(event.tags, 'task'),
      domain: this.getOptionalTag(event.tags, 'domain'),
      rating,
      amount: this.parseOptionalBigInt(event.tags, 'amount'),
      latency: this.parseOptionalNumber(event.tags, 'latency'),
      content: event.content,
      attesterPubkey: event.pubkey,
      createdAt: event.created_at,
      event,
    };
  }
}
```

---

## Story 21.4: Trust Score Computation

### Description

Implement trust score calculation from attestations.

### Acceptance Criteria

1. Collect attestations for target pubkey
2. Apply recency weighting
3. Apply attester trust weighting
4. Apply social distance weighting
5. Compute weighted average score (0-100)
6. Compute confidence based on attestation count
7. Cache computed scores
8. Handle edge cases (no attestations, new agents)

### Technical Notes

```typescript
interface TrustWeights {
  recency: Map<string, number>; // '7d' | '30d' | '90d' | 'older'
  social: Map<number, number>; // distance -> weight
}

class TrustCalculator {
  private readonly weights: TrustWeights;

  async compute(targetPubkey: string, context: TrustComputeContext): Promise<TrustScore> {
    const attestations = context.attestations.filter((a) => a.attestedPubkey === targetPubkey);

    if (attestations.length === 0) {
      return this.defaultScore(targetPubkey);
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const attestation of attestations) {
      const recencyWeight = this.getRecencyWeight(attestation.createdAt);
      const socialDistance = context.socialGraph.get(attestation.attesterPubkey) ?? 999;
      const socialWeight = this.getSocialWeight(socialDistance);
      const attesterTrust = context.attesterTrust.get(attestation.attesterPubkey) ?? 50;

      // Normalize attester trust to weight factor
      const attesterWeight = attesterTrust / 100;

      const weight = recencyWeight * socialWeight * attesterWeight;
      weightedSum += attestation.rating * 20 * weight; // Convert 1-5 to 0-100
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? weightedSum / totalWeight : 50;
    const confidence = Math.min(attestations.length * 10, 100);

    return {
      kind: 30881,
      scoredPubkey: targetPubkey,
      score: Math.round(score),
      confidence,
      attestationCount: attestations.length,
      period: 90,
      domains: this.extractDomains(attestations),
      computedAt: Math.floor(Date.now() / 1000),
      event: null as any, // Will be set when published
    };
  }

  private getRecencyWeight(createdAt: number): number {
    const ageMs = Date.now() - createdAt * 1000;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays <= 7) return this.weights.recency.get('7d') ?? 1.0;
    if (ageDays <= 30) return this.weights.recency.get('30d') ?? 0.7;
    if (ageDays <= 90) return this.weights.recency.get('90d') ?? 0.4;
    return this.weights.recency.get('older') ?? 0.1;
  }
}
```

---

## Story 21.5: Trust Score Publishing (Kind 30881)

### Description

Publish computed trust scores as addressable events.

### Acceptance Criteria

1. Create Kind 30881 addressable event
2. `d` tag set to scored agent's pubkey
3. `p` tag references scored agent
4. `score` tag (0-100)
5. `confidence` tag (0-100)
6. `attestations` tag with count
7. `period` tag with days considered
8. `domains` tag with active domains
9. Content contains methodology notes
10. Auto-publish on configurable interval

### Technical Notes

```typescript
class TrustScorePublisher {
  async publish(score: TrustScore): Promise<NostrEvent> {
    const tags = [
      ['d', score.scoredPubkey],
      ['p', score.scoredPubkey],
      ['score', score.score.toString()],
      ['confidence', score.confidence.toString()],
      ['attestations', score.attestationCount.toString()],
      ['period', score.period.toString()],
      ['domains', ...score.domains],
    ];

    const content = JSON.stringify({
      methodology: 'weighted-attestation-v1',
      computedAt: score.computedAt,
      factors: ['recency', 'social_distance', 'attester_trust'],
    });

    const event = this.signer.createSignedEvent(30881, tags, content);
    await this.store.saveEvent(event);
    await this.broadcast(event);

    return event;
  }
}
```

---

## Story 21.6: Social Graph Trust Weighting

### Description

Weight attestations based on social graph distance.

### Acceptance Criteria

1. Calculate hop distance from agent to attester
2. Apply distance-based weighting
3. Direct follows: full weight (1.0)
4. 2-hop: reduced weight (0.6)
5. 3-hop: further reduced (0.3)
6. Unknown: minimal weight (0.1)
7. Cache distance calculations
8. Handle circular graphs

### Technical Notes

```typescript
class SocialGraphWeighter {
  private distanceCache: Map<string, Map<string, number>> = new Map();

  async getDistance(from: string, to: string): Promise<number> {
    // Check cache
    const cached = this.distanceCache.get(from)?.get(to);
    if (cached !== undefined) return cached;

    // BFS to find shortest path
    const visited = new Set<string>();
    const queue: Array<{ pubkey: string; distance: number }> = [{ pubkey: from, distance: 0 }];

    while (queue.length > 0) {
      const { pubkey, distance } = queue.shift()!;

      if (pubkey === to) {
        this.cacheDistance(from, to, distance);
        return distance;
      }

      if (distance >= 3 || visited.has(pubkey)) continue;
      visited.add(pubkey);

      const follows = await this.followGraph.getFollowedPubkeys(pubkey);
      for (const followee of follows) {
        queue.push({ pubkey: followee, distance: distance + 1 });
      }
    }

    // Not found within 3 hops
    this.cacheDistance(from, to, 999);
    return 999;
  }

  getWeight(distance: number): number {
    switch (distance) {
      case 0:
        return 1.0; // Self
      case 1:
        return 1.0; // Direct follow
      case 2:
        return 0.6; // 2-hop
      case 3:
        return 0.3; // 3-hop
      default:
        return 0.1; // Unknown
    }
  }
}
```

---

## Story 21.7: Sybil Resistance Measures

### Description

Implement measures to prevent reputation manipulation.

### Acceptance Criteria

1. Rate limit attestations per attester per day
2. Minimum time between attestations for same pair
3. Detect collusion rings via graph analysis
4. Require social graph connection for full weight
5. Optional stake requirements for attestations
6. Anomaly detection for sudden score changes
7. Logging of suspicious patterns

### Technical Notes

```typescript
interface SybilConfig {
  maxAttestationsPerDay: number;
  minTimeBetweenAttestations: number; // Seconds
  requireSocialConnection: boolean;
  stakeRequired: bigint;
}

class SybilResistance {
  private attestationCounts: Map<string, Map<string, number>> = new Map();

  async validate(attestation: Attestation): Promise<void> {
    // Check rate limit
    const dailyCount = this.getDailyCount(attestation.attesterPubkey, attestation.attestedPubkey);
    if (dailyCount >= this.config.maxAttestationsPerDay) {
      throw new RateLimitError('Max attestations per day exceeded');
    }

    // Check minimum time
    const lastAttestation = await this.getLastAttestation(
      attestation.attesterPubkey,
      attestation.attestedPubkey
    );
    if (lastAttestation) {
      const elapsed = attestation.createdAt - lastAttestation.createdAt;
      if (elapsed < this.config.minTimeBetweenAttestations) {
        throw new RateLimitError('Min time between attestations not met');
      }
    }

    // Check social connection
    if (this.config.requireSocialConnection) {
      const distance = await this.socialGraph.getDistance(
        attestation.attesterPubkey,
        attestation.attestedPubkey
      );
      if (distance > 3) {
        throw new NoSocialConnectionError();
      }
    }
  }

  async detectCollusionRing(attestations: Attestation[]): Promise<string[]> {
    // Build attestation graph
    const graph = new Map<string, Set<string>>();
    for (const a of attestations) {
      if (!graph.has(a.attesterPubkey)) {
        graph.set(a.attesterPubkey, new Set());
      }
      graph.get(a.attesterPubkey)!.add(a.attestedPubkey);
    }

    // Find mutual attestation clusters
    const suspicious: string[] = [];
    for (const [a, attested] of graph) {
      for (const b of attested) {
        if (graph.get(b)?.has(a)) {
          suspicious.push(`${a}↔${b}`);
        }
      }
    }

    return suspicious;
  }
}
```

---

## Story 21.8: attest_reputation Skill

### Description

Create AI skill enabling agents to create attestations.

### Acceptance Criteria

1. Skill registered as `attest_reputation`
2. Parameters: targetPubkey, type, outcome, rating, feedback
3. Validates attestation parameters
4. Creates and publishes Kind 30880
5. Auto-trigger after task completion (configurable)
6. Returns attestation confirmation

### Technical Notes

```typescript
const attestReputationSkill: AgentSkill<typeof schema> = {
  name: 'attest_reputation',
  description: 'Create a reputation attestation for another agent',
  parameters: z.object({
    targetPubkey: z.string().describe('Pubkey of agent to attest'),
    type: z.enum([
      'task_completion',
      'payment_fulfillment',
      'communication',
      'accuracy',
      'availability',
    ]),
    outcome: z.enum(['success', 'failure', 'timeout', 'dispute']),
    rating: z.number().min(1).max(5).describe('Rating 1-5'),
    taskEventId: z.string().optional().describe('Related task event ID'),
    domain: z.string().optional().describe('Domain of interaction'),
    feedback: z.string().optional().describe('Detailed feedback'),
  }),
  execute: async (params, context) => {
    const attestation = await context.reputation.createAttestation({
      attestedPubkey: params.targetPubkey,
      type: params.type,
      outcome: params.outcome,
      rating: params.rating,
      taskEventId: params.taskEventId,
      domain: params.domain,
      feedback: params.feedback,
    });

    return {
      attestationId: attestation.id,
      attestedPubkey: params.targetPubkey,
      rating: params.rating,
      recorded: true,
    };
  },
};
```

---

## Story 21.9: query_reputation Skill

### Description

Create AI skill enabling agents to query reputation data.

### Acceptance Criteria

1. Skill registered as `query_reputation`
2. Parameters: pubkey, includeAttestations
3. Returns trust score and confidence
4. Optionally includes recent attestations
5. Returns social distance from querying agent
6. Handles unknown agents gracefully

### Technical Notes

```typescript
const queryReputationSkill: AgentSkill<typeof schema> = {
  name: 'query_reputation',
  description: 'Query the reputation and trust score of an agent',
  parameters: z.object({
    pubkey: z.string().describe('Pubkey of agent to query'),
    includeAttestations: z.boolean().optional().describe('Include recent attestations'),
  }),
  execute: async (params, context) => {
    const trustScore = await context.reputation.getTrustScore(params.pubkey);
    const socialDistance = await context.socialGraph.getDistance(
      context.agent.pubkey,
      params.pubkey
    );

    const result: any = {
      pubkey: params.pubkey,
      score: trustScore?.score ?? 50,
      confidence: trustScore?.confidence ?? 0,
      attestationCount: trustScore?.attestationCount ?? 0,
      socialDistance,
      domains: trustScore?.domains ?? [],
    };

    if (params.includeAttestations) {
      result.recentAttestations = await context.reputation.getRecentAttestations(params.pubkey, 10);
    }

    return result;
  },
};
```

---

## Story 21.10: Trust-Based Pricing Integration

### Description

Integrate trust scores with pricing and credit decisions.

### Acceptance Criteria

1. Higher trust = potential pricing discounts
2. Lower trust = potential surcharges
3. Trust-based credit limits for delayed payment
4. Minimum trust threshold for delegation
5. Trust affects routing priority
6. Configurable trust-pricing curves

### Technical Notes

```typescript
class TrustBasedPricing {
  private readonly config: {
    discountThreshold: number; // Trust >= this gets discount
    surchargeThreshold: number; // Trust < this gets surcharge
    maxDiscount: number; // e.g., 0.5 = 50%
    maxSurcharge: number; // e.g., 0.5 = 50%
    creditPerTrust: bigint; // Credit msats per trust point
  };

  calculatePrice(basePrice: bigint, trustScore: number): bigint {
    if (trustScore >= this.config.discountThreshold) {
      const discountFactor = Math.min(
        (trustScore - this.config.discountThreshold) / 50,
        this.config.maxDiscount
      );
      return basePrice - BigInt(Math.floor(Number(basePrice) * discountFactor));
    }

    if (trustScore < this.config.surchargeThreshold) {
      const surchargeFactor = Math.min(
        (this.config.surchargeThreshold - trustScore) / 30,
        this.config.maxSurcharge
      );
      return basePrice + BigInt(Math.floor(Number(basePrice) * surchargeFactor));
    }

    return basePrice;
  }

  calculateCreditLimit(trustScore: number): bigint {
    return BigInt(trustScore) * this.config.creditPerTrust;
  }

  meetsMinimumTrust(trustScore: number, requiredTrust: number): boolean {
    return trustScore >= requiredTrust;
  }
}
```

---

## Story 21.11: Dispute Filing & Resolution (Kind 30882)

### Description

Implement dispute mechanism for contested attestations and transactions, absorbed from the removed Epic 23 (Agent Payment Protocol). Disputes allow agents to contest negative attestations or flag failed transactions.

### Acceptance Criteria

1. Create Kind 30882 addressable dispute event
2. `d` tag set to disputed event ID
3. `disputed` tag references the attestation or task event
4. `p` tag references the counterparty
5. `type` tag: attestation_dispute, payment_dispute, task_dispute
6. `status` tag: open, evidence_submitted, resolved, escalated
7. `resolution` tag when resolved: upheld, dismissed, compromised
8. Content contains dispute reason and evidence
9. Counter-evidence can be submitted via reply
10. Automatic status tracking via event timeline
11. Trust score impact paused during open dispute

### Technical Notes

```typescript
type DisputeType = 'attestation_dispute' | 'payment_dispute' | 'task_dispute';
type DisputeStatus = 'open' | 'evidence_submitted' | 'resolved' | 'escalated';
type DisputeResolution = 'upheld' | 'dismissed' | 'compromised';

interface Dispute {
  kind: 30882;
  disputeId: string; // d tag
  disputedEventId: string; // disputed tag
  counterpartyPubkey: string; // p tag
  type: DisputeType;
  status: DisputeStatus;
  resolution?: DisputeResolution;
  reason: string;
  evidence: string[];
  filedBy: string;
  filedAt: number;
  resolvedAt?: number;
  event: NostrEvent;
}

class DisputeManager {
  async fileDispute(params: {
    disputedEventId: string;
    counterpartyPubkey: string;
    type: DisputeType;
    reason: string;
    evidence?: string[];
  }): Promise<Dispute> {
    const tags = [
      ['d', this.generateDisputeId()],
      ['disputed', params.disputedEventId],
      ['p', params.counterpartyPubkey],
      ['type', params.type],
      ['status', 'open'],
    ];

    const content = JSON.stringify({
      reason: params.reason,
      evidence: params.evidence ?? [],
    });

    const event = this.signer.createSignedEvent(30882, tags, content);
    await this.store.saveEvent(event);

    // Pause trust score impact for disputed attestation
    await this.trustCalculator.pauseAttestation(params.disputedEventId);

    return this.parseDispute(event);
  }

  async resolveDispute(
    disputeId: string,
    resolution: DisputeResolution,
    notes: string
  ): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);

    // Update dispute status
    const updatedTags = [
      ...dispute.event.tags.filter((t) => t[0] !== 'status' && t[0] !== 'resolution'),
      ['status', 'resolved'],
      ['resolution', resolution],
    ];

    const updatedContent = JSON.stringify({
      ...JSON.parse(dispute.event.content),
      resolutionNotes: notes,
      resolvedAt: Math.floor(Date.now() / 1000),
    });

    const event = this.signer.createSignedEvent(30882, updatedTags, updatedContent);
    await this.store.saveEvent(event);

    // Apply resolution to trust scores
    await this.applyResolution(dispute, resolution);

    return this.parseDispute(event);
  }

  private async applyResolution(dispute: Dispute, resolution: DisputeResolution): Promise<void> {
    if (dispute.type === 'attestation_dispute') {
      if (resolution === 'upheld') {
        // Remove the disputed attestation from trust calculations
        await this.trustCalculator.excludeAttestation(dispute.disputedEventId);
      } else {
        // Resume including the attestation
        await this.trustCalculator.resumeAttestation(dispute.disputedEventId);
      }
    }
  }
}
```

---

## Story 21.12: file_dispute & resolve_dispute Skills

### Description

Create AI skills for dispute management.

### Acceptance Criteria

1. `file_dispute` skill registered
2. Parameters: disputedEventId, counterpartyPubkey, type, reason, evidence
3. Creates and publishes Kind 30882
4. `resolve_dispute` skill registered (for arbitration)
5. Parameters: disputeId, resolution, notes
6. Only dispute parties or designated arbitrators can resolve
7. Returns dispute status and resolution details

### Technical Notes

```typescript
const fileDisputeSkill: AgentSkill<typeof schema> = {
  name: 'file_dispute',
  description: 'File a dispute against an attestation or transaction',
  parameters: z.object({
    disputedEventId: z.string().describe('Event ID being disputed'),
    counterpartyPubkey: z.string().describe('Pubkey of counterparty'),
    type: z.enum(['attestation_dispute', 'payment_dispute', 'task_dispute']),
    reason: z.string().describe('Reason for dispute'),
    evidence: z.array(z.string()).optional().describe('Supporting evidence'),
  }),
  execute: async (params, context) => {
    const dispute = await context.disputes.fileDispute({
      disputedEventId: params.disputedEventId,
      counterpartyPubkey: params.counterpartyPubkey,
      type: params.type,
      reason: params.reason,
      evidence: params.evidence,
    });

    return {
      disputeId: dispute.disputeId,
      status: dispute.status,
      filed: true,
    };
  },
};

const resolveDisputeSkill: AgentSkill<typeof schema> = {
  name: 'resolve_dispute',
  description: 'Resolve a dispute (requires authorization)',
  parameters: z.object({
    disputeId: z.string().describe('Dispute ID to resolve'),
    resolution: z.enum(['upheld', 'dismissed', 'compromised']),
    notes: z.string().describe('Resolution notes'),
  }),
  execute: async (params, context) => {
    // Check authorization
    const dispute = await context.disputes.getDispute(params.disputeId);
    const isParty = [dispute.filedBy, dispute.counterpartyPubkey].includes(context.agent.pubkey);
    const isArbitrator = await context.disputes.isArbitrator(context.agent.pubkey);

    if (!isParty && !isArbitrator) {
      throw new UnauthorizedError('Only dispute parties or arbitrators can resolve');
    }

    const resolved = await context.disputes.resolveDispute(
      params.disputeId,
      params.resolution,
      params.notes
    );

    return {
      disputeId: resolved.disputeId,
      resolution: resolved.resolution,
      status: resolved.status,
    };
  },
};
```

---

## Story 21.13: Integration Tests

### Description

Comprehensive integration tests for reputation system.

### Acceptance Criteria

1. Test attestation creation and parsing
2. Test trust score computation
3. Test recency weighting
4. Test social distance weighting
5. Test Sybil resistance measures
6. Test trust-based pricing
7. Test dispute filing and resolution
8. Test trust score pausing during disputes
9. Test with real social graph
10. Performance benchmarks

---

## Dependencies

- **Epic 13** (Agent Society Protocol) — Nostr events, social graph
- **Epic 16** (AI Agent Node) — Skills
- **Epic 17** (NIP-90 DVM Compatibility & Task Delegation) — Task completion triggers

## Risk Mitigation

| Risk                    | Mitigation                                    |
| ----------------------- | --------------------------------------------- |
| Reputation manipulation | Sybil resistance, social graph filtering      |
| Rating inflation        | Statistical normalization, attester weighting |
| Privacy concerns        | Optional attestation visibility               |
| Cold start problem      | Bootstrap with social graph trust             |
| False attestations      | Dispute resolution mechanism                  |
| Dispute abuse           | Rate limiting, social graph requirements      |

## Success Metrics

- Trust scores converge within 10 attestations
- Sybil detection catches 90%+ manipulation attempts
- Trust-based pricing reduces bad interactions by 50%
- Zero unauthorized attestations accepted
- Disputes resolved within 24 hours average
- False attestation rate reduced by 40% via dispute mechanism
