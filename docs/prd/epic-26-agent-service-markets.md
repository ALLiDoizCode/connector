# Epic 26: Agent Service Markets

## Executive Summary

Epic 26 implements multi-party staking markets for agent services, transforming bilateral escrow into true prediction markets where third parties can stake on service delivery outcomes. Market prices aggregate collective beliefs about provider reliability, enabling price discovery, social graph vouching, and market-based reputation.

**Key Insight:** When followers can stake YES on agents they trust, and skeptics can stake NO on agents they doubt, the resulting market odds become a real-time signal of provider reliability—more dynamic and harder to game than attestation-based reputation.

```
YES Stakers          MARKET              NO Stakers
───────────          ──────              ──────────
• Provider           "Will Provider X    • Buyer
• Vouchers            deliver Job Y?"    • Skeptics
• Reputation                             • Competitors
  backers                                • Hedgers
```

This epic is **MEDIUM** priority as it builds on Epic 25 (zkVM Verification) for automated resolution and provides the foundation for market-based reputation as an alternative to Epic 21's attestation model.

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      AGENT SERVICE MARKET FLOW                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. JOB POSTED                     2. MARKET CREATED                    │
│  ┌─────────────┐                   ┌─────────────────────┐              │
│  │ Kind 5900   │──────────────────>│ Kind 5960           │              │
│  │ Job Request │ market-enabled    │ Market Creation     │              │
│  │ + payment   │                   │ + pool initialization│              │
│  └─────────────┘                   └──────────┬──────────┘              │
│                                               │                         │
│  3. STAKING PERIOD                           │                         │
│  ┌───────────────────────────────────────────┴────────────────────────┐│
│  │                                                                     ││
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐               ││
│  │  │ Provider│  │ Voucher │  │ Skeptic │  │ Neutral │               ││
│  │  │ (YES)   │  │ (YES)   │  │ (NO)    │  │ (either)│               ││
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘               ││
│  │       │            │            │            │                      ││
│  │       └────────────┴────────────┴────────────┘                      ││
│  │                         │                                           ││
│  │                         ▼                                           ││
│  │                  ┌─────────────┐                                    ││
│  │                  │ Kind 5961   │                                    ││
│  │                  │ Stake Pool  │                                    ││
│  │                  │ YES: 1500   │                                    ││
│  │                  │ NO:  500    │                                    ││
│  │                  │ Odds: 75%   │                                    ││
│  │                  └─────────────┘                                    ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  4. RESOLUTION                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │  ZK Proof Valid? ─────YES────> RESOLVE YES ───> Payout YES pool   │ │
│  │        │                                                          │ │
│  │        NO                                                         │ │
│  │        │                                                          │ │
│  │        ▼                                                          │ │
│  │  Challenge Period ───No Challenge──> RESOLVE per buyer confirm    │ │
│  │        │                                                          │ │
│  │     Challenge                                                     │ │
│  │        │                                                          │ │
│  │        ▼                                                          │ │
│  │  Stake-Weighted Vote ─────────────> RESOLVE per majority          │ │
│  │                                                                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  5. SETTLEMENT (Kind 6960)                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Outcome: YES                                                    │   │
│  │  YES Pool: 1500 sats (winners)                                   │   │
│  │  NO Pool: 500 sats (losers)                                      │   │
│  │  Payout Multiplier: 1.333x (2000/1500)                          │   │
│  │                                                                  │   │
│  │  Distribution:                                                   │   │
│  │  - Provider: 750 sats → 1000 sats (+250)                        │   │
│  │  - Voucher:  500 sats → 666 sats (+166)                         │   │
│  │  - Voucher:  250 sats → 333 sats (+83)                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Event Kinds

| Kind | Name             | Purpose                                  |
| ---- | ---------------- | ---------------------------------------- |
| 5960 | MarketCreation   | Initialize a prediction market for a job |
| 5961 | StakeSubmission  | Submit a stake (YES or NO)               |
| 6960 | MarketResolution | Resolve market and distribute payouts    |
| 5962 | MarketChallenge  | Challenge a resolution                   |
| 5963 | ArbitrationVote  | Cast vote in disputed resolution         |

### Market Types

| Type           | Description                               | Resolution                |
| -------------- | ----------------------------------------- | ------------------------- |
| **delivery**   | Will provider deliver job satisfactorily? | ZK proof or buyer confirm |
| **quality**    | Will output meet quality threshold?       | Multi-agent attestation   |
| **timeliness** | Will delivery occur before deadline?      | Timestamp comparison      |

## Package Structure

```
packages/connector/src/agent/
├── markets/
│   ├── index.ts
│   ├── types.ts                    # Market types, interfaces
│   ├── market-creation.ts          # Create Kind 5960
│   ├── stake-submission.ts         # Create Kind 5961
│   ├── market-resolution.ts        # Create Kind 6960
│   ├── pool-manager.ts             # YES/NO pool accounting
│   ├── eligibility.ts              # Social graph stake eligibility
│   ├── resolution-engine.ts        # Resolution logic
│   ├── payout-calculator.ts        # Proportional distribution
│   ├── __tests__/
│   │   ├── market-creation.test.ts
│   │   ├── pool-manager.test.ts
│   │   ├── resolution-engine.test.ts
│   │   └── payout-calculator.test.ts
├── ai/skills/
│   ├── create-market-skill.ts
│   ├── stake-on-market-skill.ts
│   └── resolve-market-skill.ts
└── ...
```

## Configuration

```yaml
agent:
  markets:
    enabled: true
    autoCreateOnJob: false # Auto-create market for jobs above threshold
    minJobValueForMarket: 10000 # Minimum job value (sats) for market
    defaultChallengePeriod: 7200 # 2 hours

    staking:
      minStake: 100 # Minimum stake (sats)
      maxGraphDistance: 3 # Max social graph hops for eligibility
      graphDistanceMultiplier: 0.5 # Min stake increases with distance
      stakingPeriod: 3600 # Time window for staking (seconds)

    resolution:
      zkProofAutoResolve: true # Auto-resolve on valid ZK proof
      challengeStakeMultiplier: 1 # Challenger must match provider stake
      arbitrationQuorum: 3 # Minimum arbiters for vote

    pools:
      type: 'simple' # 'simple' or 'amm'
      protocolFee: 0.02 # 2% fee on winnings
```

## Stories

| Story | Description                      | Status      |
| ----- | -------------------------------- | ----------- |
| 26.1  | Market Types & Schemas           | Not Started |
| 26.2  | Market Creation (Kind 5960)      | Not Started |
| 26.3  | Stake Submission (Kind 5961)     | Not Started |
| 26.4  | Pool Manager                     | Not Started |
| 26.5  | Social Graph Stake Eligibility   | Not Started |
| 26.6  | Resolution Engine                | Not Started |
| 26.7  | ZK Proof Auto-Resolution         | Not Started |
| 26.8  | Challenge Mechanism (Kind 5962)  | Not Started |
| 26.9  | Arbitration Voting (Kind 5963)   | Not Started |
| 26.10 | Payout Calculator & Distribution | Not Started |
| 26.11 | Market Resolution (Kind 6960)    | Not Started |
| 26.12 | create_market Skill              | Not Started |
| 26.13 | stake_on_market Skill            | Not Started |
| 26.14 | Market-Based Reputation Scoring  | Not Started |
| 26.15 | Integration Tests                | Not Started |

---

## Story 26.1: Market Types & Schemas

### Description

Define TypeScript types and schemas for service markets.

### Acceptance Criteria

1. `MarketType` type: delivery, quality, timeliness
2. `MarketState` type: open, staking, executing, resolving, resolved, disputed
3. `StakePosition` type: yes, no
4. `MarketCreation` interface (Kind 5960)
5. `StakeSubmission` interface (Kind 5961)
6. `MarketResolution` interface (Kind 6960)
7. `MarketChallenge` interface (Kind 5962)
8. `ArbitrationVote` interface (Kind 5963)
9. `PoolState` interface for YES/NO pool tracking
10. Zod schemas for all types
11. Constants for event kinds

### Technical Notes

```typescript
// Event Kinds
const MARKET_CREATION_KIND = 5960;
const STAKE_SUBMISSION_KIND = 5961;
const MARKET_CHALLENGE_KIND = 5962;
const ARBITRATION_VOTE_KIND = 5963;
const MARKET_RESOLUTION_KIND = 6960;

// Types
type MarketType = 'delivery' | 'quality' | 'timeliness';
type MarketState = 'open' | 'staking' | 'executing' | 'resolving' | 'resolved' | 'disputed';
type StakePosition = 'yes' | 'no';
type ResolutionMethod = 'zk-proof' | 'buyer-confirm' | 'timeout' | 'arbitration' | 'void';

interface MarketCreation {
  kind: 5960;
  marketId: string;
  jobRequestId: string; // References Kind 5900
  buyerPubkey: string;
  providerPubkey: string;
  marketType: MarketType;
  totalJobValue: bigint;
  resolutionTime: number; // Unix timestamp
  challengePeriod: number; // Seconds
  stakeEligibility: 'open' | 'social-graph';
  maxGraphDistance?: number;
  minStake: bigint;
  event: NostrEvent;
}

interface StakeSubmission {
  kind: 5961;
  marketId: string; // References market
  stakerPubkey: string;
  position: StakePosition;
  amount: bigint;
  stakeProof: string; // ILP PREPARE ID or on-chain tx
  expectedPayout?: bigint; // At current odds
  event: NostrEvent;
}

interface PoolState {
  marketId: string;
  yesPool: bigint;
  noPool: bigint;
  yesStakers: Map<string, bigint>; // pubkey → amount
  noStakers: Map<string, bigint>;
  currentOdds: number; // 0-1, probability of YES
  lastUpdated: number;
}

interface MarketResolution {
  kind: 6960;
  marketId: string;
  outcome: 'yes' | 'no' | 'void';
  resolutionMethod: ResolutionMethod;
  yesPoolTotal: bigint;
  noPoolTotal: bigint;
  payoutMultiplier: number; // For winning side
  payouts: Array<{ pubkey: string; amount: bigint }>;
  evidence?: string; // Hash of evidence (ZK proof, vote tally)
  event: NostrEvent;
}
```

---

## Story 26.2: Market Creation (Kind 5960)

### Description

Implement market creation events for DVM jobs.

### Acceptance Criteria

1. Create Kind 5960 event for new market
2. Include `e` tag referencing job request (Kind 5900)
3. Include `market_id` tag (unique identifier)
4. Include `p` tags for buyer and provider
5. Include `market_type` tag
6. Include `job_value` tag
7. Include `resolution_time` tag
8. Include `challenge_period` tag
9. Include `stake_eligibility` tag
10. Include `min_stake` tag
11. Auto-create market when job has `market-enabled` tag

### Technical Notes

```typescript
interface CreateMarketParams {
  jobRequest: DVMJobRequest;
  resolutionTime?: number;
  challengePeriod?: number;
  stakeEligibility?: 'open' | 'social-graph';
  minStake?: bigint;
}

class MarketCreator {
  async create(params: CreateMarketParams): Promise<MarketCreation> {
    const marketId = this.generateMarketId();

    const tags = [
      ['e', params.jobRequest.event.id, '', 'job'],
      ['market_id', marketId],
      ['p', params.jobRequest.buyerPubkey, '', 'buyer'],
      ['p', params.jobRequest.providerPubkey, '', 'provider'],
      ['market_type', 'delivery'],
      ['job_value', params.jobRequest.bid.toString()],
      ['resolution_time', (params.resolutionTime ?? this.defaultResolutionTime()).toString()],
      ['challenge_period', (params.challengePeriod ?? 7200).toString()],
      ['stake_eligibility', params.stakeEligibility ?? 'social-graph'],
      ['min_stake', (params.minStake ?? 100n).toString()],
    ];

    const event = await this.signer.createSignedEvent(5960, tags, '');
    return this.parseMarketCreation(event);
  }
}
```

---

## Story 26.3: Stake Submission (Kind 5961)

### Description

Implement stake submission for market participation.

### Acceptance Criteria

1. Create Kind 5961 event for stakes
2. Include `e` tag referencing market (Kind 5960)
3. Include `market_id` tag
4. Include `position` tag (yes/no)
5. Include `amount` tag
6. Include `stake_proof` tag (ILP PREPARE ID)
7. Validate stake meets minimum
8. Validate staker eligibility (social graph)
9. Lock stake via ILP PREPARE
10. Update pool state on successful stake

### Technical Notes

```typescript
interface SubmitStakeParams {
  marketId: string;
  position: StakePosition;
  amount: bigint;
}

class StakeSubmitter {
  async submit(params: SubmitStakeParams): Promise<StakeSubmission> {
    const market = await this.getMarket(params.marketId);

    // Validate eligibility
    const eligibility = await this.eligibilityChecker.check(
      this.pubkey,
      market.buyerPubkey,
      market.providerPubkey,
      market.stakeEligibility,
      market.maxGraphDistance
    );

    if (!eligibility.eligible) {
      throw new StakeEligibilityError(eligibility.reason);
    }

    // Validate minimum stake
    const minStake = this.calculateMinStake(market, eligibility.graphDistance);
    if (params.amount < minStake) {
      throw new InsufficientStakeError(minStake, params.amount);
    }

    // Lock stake via ILP
    const prepareId = await this.lockStake(params.amount, market.marketId);

    const tags = [
      ['e', market.event.id, '', 'market'],
      ['market_id', params.marketId],
      ['position', params.position],
      ['amount', params.amount.toString()],
      ['stake_proof', prepareId],
    ];

    const event = await this.signer.createSignedEvent(5961, tags, '');
    return this.parseStakeSubmission(event);
  }
}
```

---

## Story 26.4: Pool Manager

### Description

Manage YES/NO stake pools for markets.

### Acceptance Criteria

1. Track YES pool total and individual stakes
2. Track NO pool total and individual stakes
3. Calculate current odds (YES probability)
4. Add stakes to pools atomically
5. Handle stake cancellation (before resolution)
6. Query pool state by market ID
7. Persist pool state in database
8. Emit events on pool updates
9. Thread-safe operations
10. Calculate expected payout for new stake

### Technical Notes

```typescript
class PoolManager {
  private pools = new Map<string, PoolState>();

  async addStake(stake: StakeSubmission): Promise<PoolState> {
    const pool = this.getOrCreatePool(stake.marketId);

    if (stake.position === 'yes') {
      pool.yesPool += stake.amount;
      pool.yesStakers.set(
        stake.stakerPubkey,
        (pool.yesStakers.get(stake.stakerPubkey) ?? 0n) + stake.amount
      );
    } else {
      pool.noPool += stake.amount;
      pool.noStakers.set(
        stake.stakerPubkey,
        (pool.noStakers.get(stake.stakerPubkey) ?? 0n) + stake.amount
      );
    }

    pool.currentOdds = this.calculateOdds(pool);
    pool.lastUpdated = Date.now();

    await this.persistPool(pool);
    this.emit('pool:updated', pool);

    return pool;
  }

  calculateOdds(pool: PoolState): number {
    const total = pool.yesPool + pool.noPool;
    if (total === 0n) return 0.5;
    return Number(pool.yesPool) / Number(total);
  }

  calculateExpectedPayout(pool: PoolState, position: StakePosition, amount: bigint): bigint {
    const total = pool.yesPool + pool.noPool + amount;
    const winningPool = position === 'yes' ? pool.yesPool + amount : pool.noPool + amount;

    // Payout = (total / winningPool) * amount
    return (total * amount) / winningPool;
  }
}
```

---

## Story 26.5: Social Graph Stake Eligibility

### Description

Implement social graph-based stake eligibility.

### Acceptance Criteria

1. Check if staker is within N hops of buyer/provider
2. Query social graph for follow relationships
3. Calculate shortest path distance
4. Apply minimum stake multiplier based on distance
5. Cache eligibility results
6. Handle agents with no social graph presence
7. Allow historical accuracy to reduce minimum stake
8. Return eligibility result with reason

### Technical Notes

```typescript
interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  graphDistance?: number;
  minStakeMultiplier: number;
  historicalAccuracy?: number;
}

class StakeEligibilityChecker {
  async check(
    stakerPubkey: string,
    buyerPubkey: string,
    providerPubkey: string,
    eligibilityType: 'open' | 'social-graph',
    maxDistance: number = 3
  ): Promise<EligibilityResult> {
    if (eligibilityType === 'open') {
      return { eligible: true, minStakeMultiplier: 1 };
    }

    // Check social graph distance
    const distanceToBuyer = await this.socialGraph.shortestPath(stakerPubkey, buyerPubkey);
    const distanceToProvider = await this.socialGraph.shortestPath(stakerPubkey, providerPubkey);
    const minDistance = Math.min(distanceToBuyer ?? Infinity, distanceToProvider ?? Infinity);

    if (minDistance > maxDistance) {
      // Check historical accuracy as fallback
      const accuracy = await this.reputation.getStakingAccuracy(stakerPubkey);
      if (accuracy.totalBets < 10) {
        return {
          eligible: false,
          reason: 'too-distant-no-history',
          graphDistance: minDistance,
          minStakeMultiplier: 1,
        };
      }
    }

    // Calculate minimum stake multiplier
    const minStakeMultiplier = 1 + minDistance * 0.5;

    return {
      eligible: true,
      graphDistance: minDistance,
      minStakeMultiplier,
      historicalAccuracy: await this.reputation.getStakingAccuracy(stakerPubkey),
    };
  }
}
```

---

## Story 26.6: Resolution Engine

### Description

Implement market resolution logic.

### Acceptance Criteria

1. Determine resolution based on evidence
2. Support ZK proof auto-resolution
3. Support buyer confirmation resolution
4. Support timeout resolution
5. Support arbitration resolution
6. Validate resolution evidence
7. Handle disputed resolutions
8. Emit resolution events
9. Trigger payout distribution

### Technical Notes

```typescript
type ResolutionOutcome = 'yes' | 'no' | 'void';

interface ResolutionRequest {
  marketId: string;
  method: ResolutionMethod;
  evidence?: {
    zkProof?: SerializedProof;
    buyerSignature?: string;
    arbitrationVotes?: ArbitrationVote[];
  };
}

class ResolutionEngine {
  async resolve(request: ResolutionRequest): Promise<ResolutionOutcome> {
    const market = await this.getMarket(request.marketId);

    switch (request.method) {
      case 'zk-proof':
        return this.resolveByZKProof(market, request.evidence!.zkProof!);

      case 'buyer-confirm':
        return this.resolveByBuyerConfirm(market, request.evidence!.buyerSignature!);

      case 'timeout':
        return this.resolveByTimeout(market);

      case 'arbitration':
        return this.resolveByArbitration(market, request.evidence!.arbitrationVotes!);

      case 'void':
        return 'void';
    }
  }

  private async resolveByZKProof(
    market: MarketCreation,
    proof: SerializedProof
  ): Promise<ResolutionOutcome> {
    const verification = await this.zkVerifier.verify(proof, market.jobRequestId);
    return verification.valid ? 'yes' : 'no';
  }

  private async resolveByArbitration(
    market: MarketCreation,
    votes: ArbitrationVote[]
  ): Promise<ResolutionOutcome> {
    // Stake-weighted voting
    const yesWeight = votes
      .filter((v) => v.vote === 'yes')
      .reduce((sum, v) => sum + v.stakeWeight, 0n);

    const noWeight = votes
      .filter((v) => v.vote === 'no')
      .reduce((sum, v) => sum + v.stakeWeight, 0n);

    return yesWeight > noWeight ? 'yes' : 'no';
  }
}
```

---

## Story 26.7: ZK Proof Auto-Resolution

### Description

Automatically resolve markets when valid ZK proof is submitted.

### Acceptance Criteria

1. Monitor for ZK-verified job results
2. Check if job has associated market
3. Verify ZK proof validity
4. Auto-resolve market on valid proof
5. Skip challenge period for ZK resolution
6. Handle invalid proof (initiate dispute)
7. Log auto-resolution events

### Technical Notes

```typescript
class ZKAutoResolver {
  constructor(
    private zkVerifier: ZKVerifier,
    private resolutionEngine: ResolutionEngine,
    private poolManager: PoolManager
  ) {}

  async handleJobResult(result: DVMResult): Promise<void> {
    // Check if market exists for this job
    const market = await this.poolManager.getMarketByJobId(result.jobRequestId);
    if (!market) return;

    // Check if result has ZK proof
    const zkProof = this.extractZKProof(result);
    if (!zkProof) return;

    // Verify proof
    const verification = await this.zkVerifier.verify(zkProof, result.jobRequestId);

    if (verification.valid) {
      // Auto-resolve YES (provider delivered)
      await this.resolutionEngine.resolve({
        marketId: market.marketId,
        method: 'zk-proof',
        evidence: { zkProof },
      });

      this.emit('market:auto-resolved', {
        marketId: market.marketId,
        outcome: 'yes',
        method: 'zk-proof',
      });
    } else {
      // Initiate dispute
      this.emit('market:zk-verification-failed', {
        marketId: market.marketId,
        reason: verification.reason,
      });
    }
  }
}
```

---

## Story 26.8: Challenge Mechanism (Kind 5962)

### Description

Implement challenge events for disputed resolutions.

### Acceptance Criteria

1. Create Kind 5962 challenge event
2. Include `e` tag referencing market
3. Include `challenger` tag
4. Include `challenger_stake` tag (must match provider stake)
5. Include `reason` tag
6. Validate challenge within challenge period
7. Lock challenger stake
8. Transition market to disputed state
9. Trigger arbitration process

### Technical Notes

```typescript
interface CreateChallengeParams {
  marketId: string;
  reason: string;
  evidence?: string;
}

class ChallengeCreator {
  async create(params: CreateChallengeParams): Promise<MarketChallenge> {
    const market = await this.getMarket(params.marketId);

    // Validate within challenge period
    if (Date.now() > market.resolutionTime + market.challengePeriod * 1000) {
      throw new ChallengePeriodExpiredError();
    }

    // Challenger must stake equal to provider
    const pool = await this.poolManager.getPool(params.marketId);
    const providerStake = pool.yesStakers.get(market.providerPubkey) ?? 0n;

    // Lock challenger stake
    const stakeProof = await this.lockStake(providerStake, params.marketId);

    const tags = [
      ['e', market.event.id, '', 'market'],
      ['market_id', params.marketId],
      ['challenger', this.pubkey],
      ['challenger_stake', providerStake.toString()],
      ['stake_proof', stakeProof],
      ['reason', params.reason],
    ];

    if (params.evidence) {
      tags.push(['evidence', params.evidence]);
    }

    const event = await this.signer.createSignedEvent(5962, tags, params.reason);
    return this.parseChallenge(event);
  }
}
```

---

## Story 26.9: Arbitration Voting (Kind 5963)

### Description

Implement stake-weighted arbitration voting.

### Acceptance Criteria

1. Create Kind 5963 arbitration vote event
2. Include `e` tag referencing challenge
3. Include `vote` tag (yes/no)
4. Include `stake_weight` tag
5. Select arbiters from social graph
6. Require minimum quorum
7. Weight votes by stake
8. Resolve when quorum reached
9. Slash outlier voters
10. Distribute arbiter fees

### Technical Notes

```typescript
interface CreateArbitrationVoteParams {
  challengeEventId: string;
  vote: 'yes' | 'no';
  rationale: string;
}

class ArbitrationVoter {
  async vote(params: CreateArbitrationVoteParams): Promise<ArbitrationVote> {
    const challenge = await this.getChallenge(params.challengeEventId);
    const market = await this.getMarket(challenge.marketId);

    // Validate voter is eligible arbiter
    const isEligible = await this.isEligibleArbiter(this.pubkey, market);
    if (!isEligible) {
      throw new NotEligibleArbiterError();
    }

    // Calculate vote weight (based on staker's own stake or reputation)
    const stakeWeight = await this.calculateVoteWeight(this.pubkey);

    const tags = [
      ['e', params.challengeEventId, '', 'challenge'],
      ['market_id', market.marketId],
      ['vote', params.vote],
      ['stake_weight', stakeWeight.toString()],
    ];

    const event = await this.signer.createSignedEvent(5963, tags, params.rationale);
    return this.parseArbitrationVote(event);
  }

  private async isEligibleArbiter(pubkey: string, market: MarketCreation): boolean {
    // Must be trusted by both buyer and provider
    const trustedByBuyer = await this.socialGraph.isFollowed(market.buyerPubkey, pubkey);
    const trustedByProvider = await this.socialGraph.isFollowed(market.providerPubkey, pubkey);

    return trustedByBuyer || trustedByProvider;
  }
}
```

---

## Story 26.10: Payout Calculator & Distribution

### Description

Calculate and distribute proportional payouts.

### Acceptance Criteria

1. Calculate payout multiplier for winning side
2. Calculate individual payouts proportionally
3. Deduct protocol fee
4. Distribute via ILP FULFILLs
5. Handle void markets (return stakes)
6. Handle tied markets
7. Log payout distribution
8. Update TigerBeetle accounts

### Technical Notes

```typescript
interface PayoutCalculation {
  marketId: string;
  outcome: 'yes' | 'no' | 'void';
  winners: Array<{ pubkey: string; payout: bigint }>;
  losers: Array<{ pubkey: string; lost: bigint }>;
  protocolFee: bigint;
  payoutMultiplier: number;
}

class PayoutCalculator {
  calculate(pool: PoolState, outcome: 'yes' | 'no' | 'void'): PayoutCalculation {
    if (outcome === 'void') {
      return this.calculateVoidPayouts(pool);
    }

    const totalPool = pool.yesPool + pool.noPool;
    const winningPool = outcome === 'yes' ? pool.yesPool : pool.noPool;
    const losingPool = outcome === 'yes' ? pool.noPool : pool.yesPool;
    const winners = outcome === 'yes' ? pool.yesStakers : pool.noStakers;
    const losers = outcome === 'yes' ? pool.noStakers : pool.yesStakers;

    // Calculate protocol fee (2%)
    const protocolFee = (losingPool * 2n) / 100n;
    const distributablePool = totalPool - protocolFee;

    // Payout multiplier for winners
    const payoutMultiplier = Number(distributablePool) / Number(winningPool);

    // Calculate individual payouts
    const winnerPayouts = Array.from(winners.entries()).map(([pubkey, stake]) => ({
      pubkey,
      payout: (stake * distributablePool) / winningPool,
    }));

    const loserPayouts = Array.from(losers.entries()).map(([pubkey, stake]) => ({
      pubkey,
      lost: stake,
    }));

    return {
      marketId: pool.marketId,
      outcome,
      winners: winnerPayouts,
      losers: loserPayouts,
      protocolFee,
      payoutMultiplier,
    };
  }

  async distribute(calculation: PayoutCalculation): Promise<void> {
    // Distribute to winners via ILP
    for (const winner of calculation.winners) {
      await this.ilpSender.sendPayment(winner.pubkey, winner.payout);
    }

    // Transfer protocol fee
    await this.tigerbeetle.transfer({
      from: this.escrowAccount,
      to: this.protocolFeeAccount,
      amount: calculation.protocolFee,
    });

    this.emit('payouts:distributed', calculation);
  }
}
```

---

## Story 26.11: Market Resolution (Kind 6960)

### Description

Create market resolution events with final settlement.

### Acceptance Criteria

1. Create Kind 6960 resolution event
2. Include `e` tag referencing market
3. Include `outcome` tag (yes/no/void)
4. Include `resolution_method` tag
5. Include pool totals in tags
6. Include `payout_multiplier` tag
7. Include individual payouts in content
8. Include evidence hash
9. Sign with resolver's key
10. Finalize market state

### Technical Notes

```typescript
interface CreateResolutionParams {
  marketId: string;
  outcome: 'yes' | 'no' | 'void';
  method: ResolutionMethod;
  evidence?: string;
}

class ResolutionCreator {
  async create(params: CreateResolutionParams): Promise<MarketResolution> {
    const pool = await this.poolManager.getPool(params.marketId);
    const payout = this.payoutCalculator.calculate(pool, params.outcome);

    const tags = [
      ['e', await this.getMarketEventId(params.marketId), '', 'market'],
      ['market_id', params.marketId],
      ['outcome', params.outcome],
      ['resolution_method', params.method],
      ['yes_pool_total', pool.yesPool.toString()],
      ['no_pool_total', pool.noPool.toString()],
      ['payout_multiplier', payout.payoutMultiplier.toString()],
      ['protocol_fee', payout.protocolFee.toString()],
    ];

    if (params.evidence) {
      tags.push(['evidence', params.evidence]);
    }

    // Include payouts in content
    const content = JSON.stringify({
      payouts: payout.winners.map((w) => ({
        pubkey: w.pubkey,
        amount: w.payout.toString(),
      })),
    });

    const event = await this.signer.createSignedEvent(6960, tags, content);

    // Distribute payouts
    await this.payoutCalculator.distribute(payout);

    return this.parseResolution(event);
  }
}
```

---

## Story 26.12: create_market Skill

### Description

Create AI skill to create service markets.

### Acceptance Criteria

1. Skill registered as `create_market`
2. Parameters: jobRequestId, challengePeriod, stakeEligibility
3. Validate job exists and is market-eligible
4. Create market event
5. Initialize pool
6. Return market ID and URL
7. Handle already-existing market

---

## Story 26.13: stake_on_market Skill

### Description

Create AI skill to stake on markets.

### Acceptance Criteria

1. Skill registered as `stake_on_market`
2. Parameters: marketId, position, amount
3. Check eligibility before staking
4. Calculate expected payout
5. Lock stake and submit
6. Return stake confirmation and current odds

---

## Story 26.14: Market-Based Reputation Scoring

### Description

Calculate reputation from market performance.

### Acceptance Criteria

1. Track provider market win rate
2. Track predictor accuracy
3. Calculate calibration score (Brier score)
4. Weight by stake amounts
5. Time-decay old results
6. Expose via reputation API
7. Create `query_market_reputation` skill to query provider/predictor reputation

### Technical Notes

```typescript
interface MarketReputation {
  // As provider
  deliverySuccessRate: number; // Markets resolved YES / total markets
  averageMarketOdds: number; // Avg odds at job acceptance (higher = more trusted)
  totalValueDelivered: bigint;

  // As predictor
  predictionAccuracy: number; // Correct predictions / total predictions
  profitLoss: bigint; // Net winnings
  calibration: number; // Brier score (lower = better calibrated)
  totalBets: number;
}

class MarketReputationCalculator {
  async calculate(pubkey: string): Promise<MarketReputation> {
    const providerMarkets = await this.getMarketsAsProvider(pubkey);
    const predictionBets = await this.getBetsAsPrediction(pubkey);

    return {
      deliverySuccessRate: this.calculateSuccessRate(providerMarkets),
      averageMarketOdds: this.calculateAvgOdds(providerMarkets),
      totalValueDelivered: this.calculateTotalValue(providerMarkets),
      predictionAccuracy: this.calculateAccuracy(predictionBets),
      profitLoss: this.calculateProfitLoss(predictionBets),
      calibration: this.calculateBrierScore(predictionBets),
      totalBets: predictionBets.length,
    };
  }
}
```

---

## Story 26.15: Integration Tests

### Description

Comprehensive integration tests for service markets.

### Acceptance Criteria

1. Test full market lifecycle: create → stake → resolve → payout
2. Test ZK auto-resolution
3. Test challenge and arbitration flow
4. Test social graph eligibility
5. Test void market handling
6. Test concurrent stakes
7. Test payout calculation accuracy
8. Test edge cases (no stakes, single staker)
9. Performance benchmarks

---

## Dependencies

- **Epic 6** (TigerBeetle) — Pool accounting
- **Epic 13** (Social Graph) — Stake eligibility
- **Epic 17** (NIP-90 DVM) — Job requests
- **Epic 25** (zkVM Verification) — Auto-resolution

## Risk Mitigation

| Risk                | Mitigation                                      |
| ------------------- | ----------------------------------------------- |
| Wash trading        | Social graph eligibility, minimum stake scaling |
| Oracle manipulation | Multi-party arbitration, stake-weighted voting  |
| Liquidity bootstrap | Allow bilateral staking only initially          |
| Complexity          | Phase rollout, simple pools before AMM          |
| Griefing challenges | Challenger must match stake                     |

## Success Metrics

- Market creation < 1 second
- Stake submission < 500ms
- Resolution (ZK auto) < 100ms
- Resolution (arbitration) < 24 hours
- Zero incorrect payouts
- 95%+ markets resolve without dispute

## Economic Model

### Fee Structure

| Fee          | Amount                | Recipient         |
| ------------ | --------------------- | ----------------- |
| Protocol fee | 2% of losing pool     | Protocol treasury |
| Arbiter fee  | 1% of challenged pool | Arbiters (split)  |

### Incentive Analysis

| Party    | Incentive                    | Behavior                     |
| -------- | ---------------------------- | ---------------------------- |
| Provider | Win market + job payment     | Deliver quality work         |
| Buyer    | Protect against non-delivery | Stake NO as hedge            |
| Voucher  | Profit from trust            | Stake YES on trusted agents  |
| Skeptic  | Profit from failures         | Stake NO on untrusted agents |
| Arbiter  | Fee income                   | Vote honestly                |

## Future Extensions

1. **AMM for Continuous Pricing** — Replace simple pools with constant-product AMM
2. **Order Book** — Limit orders for price discovery
3. **Cross-Market Positions** — Hedge across related markets
4. **Insurance Markets** — Markets on market outcomes
