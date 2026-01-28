# Epic 20: Multi-Agent Coordination (NIP-XX3)

## Executive Summary

Epic 20 implements NIP-XX3 (Multi-Agent Coordination), defining coordination primitives for multi-agent consensus, voting, and collective decision-making in decentralized agent networks. This enables scenarios requiring multiple agents to agree on actions: multi-signature approvals, distributed task allocation, consensus on shared state, and conflict resolution.

This epic is **MEDIUM** priority as it builds on the task delegation foundation to enable more sophisticated multi-agent behaviors.

## Architecture

### Coordination Flow

```
Coordinator Agent                    Participant Agents
      │                                    │
      │  Proposal (Kind 5910)              │
      │  + participants, threshold, action │
      │────────────────────────────────────>
      │                                    │
      │                              [Agents evaluate]
      │                                    │
      │  Vote (Kind 6910)                  │
      │<────────────────────────────────────
      │  Vote (Kind 6910)                  │
      │<────────────────────────────────────
      │                                    │
      │  [Coordinator tallies votes]       │
      │                                    │
      │  Result (Kind 7910)                │
      │  + outcome, vote counts            │
      │────────────────────────────────────>
      │                                    │
      │  [If approved, execute action]     │
```

### Event Kinds

| Kind | Purpose               |
| ---- | --------------------- |
| 5910 | Coordination Proposal |
| 6910 | Coordination Vote     |
| 7910 | Coordination Result   |

### Coordination Types

| Type         | Description                 | Use Case           |
| ------------ | --------------------------- | ------------------ |
| `consensus`  | All participants must agree | Critical actions   |
| `majority`   | >50% must agree             | Standard decisions |
| `threshold`  | N of M must agree           | Multi-sig          |
| `ranked`     | Ranked choice voting        | Option selection   |
| `allocation` | Distribute resources        | Task assignment    |

## Package Structure

```
packages/connector/src/agent/
├── coordination/
│   ├── index.ts
│   ├── proposal.ts              # Create & parse Kind 5910
│   ├── vote.ts                  # Create & parse Kind 6910
│   ├── result.ts                # Create & parse Kind 7910
│   ├── coordinator.ts           # Manage coordination lifecycle
│   ├── voting/
│   │   ├── consensus.ts         # Consensus voting logic
│   │   ├── majority.ts          # Majority voting logic
│   │   ├── threshold.ts         # Threshold voting logic
│   │   ├── ranked.ts            # Ranked choice logic
│   │   └── weighted.ts          # Weighted voting logic
│   └── types.ts
├── ai/skills/
│   ├── propose-coordination-skill.ts
│   ├── vote-coordination-skill.ts
│   └── ...
└── __tests__/
    └── coordination/
        ├── proposal.test.ts
        ├── voting.test.ts
        └── coordination-integration.test.ts
```

## Configuration

```yaml
agent:
  coordination:
    enabled: true
    maxProposalsOpen: 10 # Max concurrent proposals
    defaultExpiry: 3600 # 1 hour default
    autoVote:
      enabled: false # Auto-vote on proposals
      strategy: 'conservative' # conservative | aggressive | abstain
    trustRequired: 50 # Min trust score to participate
```

## Stories

| Story | Description                        | Status      |
| ----- | ---------------------------------- | ----------- |
| 20.1  | Coordination Types & Schemas       | Not Started |
| 20.2  | Proposal Creation (Kind 5910)      | Not Started |
| 20.3  | Proposal Parsing & Validation      | Not Started |
| 20.4  | Vote Creation (Kind 6910)          | Not Started |
| 20.5  | Vote Collection & Validation       | Not Started |
| 20.6  | Threshold Consensus Implementation | Not Started |
| 20.7  | Weighted Voting Implementation     | Not Started |
| 20.8  | Result Aggregation (Kind 7910)     | Not Started |
| 20.9  | propose_coordination Skill         | Not Started |
| 20.10 | vote_coordination Skill            | Not Started |
| 20.11 | Payment Escrow Integration         | Not Started |
| 20.12 | Integration Tests                  | Not Started |

---

## Story 20.1: Coordination Types & Schemas

### Description

Define TypeScript types and schemas for coordination events.

### Acceptance Criteria

1. `CoordinationType` enum: consensus, majority, threshold, ranked, allocation
2. `Proposal` interface with all fields
3. `Vote` interface with vote value and reasoning
4. `CoordinationResult` interface with outcome and tallies
5. Zod schemas for validation
6. Constants for tag names and kinds

### Technical Notes

```typescript
type CoordinationType = 'consensus' | 'majority' | 'threshold' | 'ranked' | 'allocation';

type VoteValue = 'approve' | 'reject' | 'abstain';

type CoordinationOutcome = 'approved' | 'rejected' | 'expired' | 'inconclusive';

interface Proposal {
  kind: 5910;
  id: string; // d tag (unique proposal ID)
  type: CoordinationType;
  participants: string[]; // p tags (pubkeys)
  threshold?: number; // Required votes for threshold type
  quorum?: number; // Minimum participation
  expires: number; // Unix timestamp
  action?: ProposalAction; // Action to execute if approved
  weights?: Map<string, number>; // Optional vote weights
  content: string; // Proposal description
  event: NostrEvent;
}

interface ProposalAction {
  kind: number; // Event kind to emit
  data: string; // Action payload (JSON)
}

interface Vote {
  kind: 6910;
  proposalEventId: string;
  proposalId: string; // d tag of proposal
  vote: VoteValue;
  reason?: string;
  rank?: number[]; // For ranked choice
  voterPubkey: string;
  event: NostrEvent;
}

interface CoordinationResult {
  kind: 7910;
  proposalEventId: string;
  proposalId: string;
  outcome: CoordinationOutcome;
  votes: {
    approve: number;
    reject: number;
    abstain: number;
  };
  participants: {
    voted: number;
    total: number;
  };
  voteEventIds: string[];
  content: string; // Result summary
  event: NostrEvent;
}
```

---

## Story 20.2: Proposal Creation (Kind 5910)

### Description

Implement creation of coordination proposal events.

### Acceptance Criteria

1. Create Kind 5910 event with unique `d` tag
2. Include `type` tag for coordination type
3. Include `p` tags for all participants
4. Include `threshold` tag when applicable
5. Include `quorum` tag for minimum participation
6. Include `expires` tag with Unix timestamp
7. Include `action` tag with action event kind and data
8. Optional `weight` tags for weighted voting
9. Content contains proposal description
10. Sign with coordinator's Nostr key

### Technical Notes

```typescript
interface CreateProposalParams {
  type: CoordinationType;
  participants: string[];
  threshold?: number;
  quorum?: number;
  expiresIn: number; // Seconds from now
  action?: ProposalAction;
  weights?: Map<string, number>;
  description: string;
}

class ProposalCreator {
  create(params: CreateProposalParams): NostrEvent {
    const proposalId = this.generateProposalId();
    const expires = Math.floor(Date.now() / 1000) + params.expiresIn;

    const tags = [
      ['d', proposalId],
      ['type', params.type],
      ...params.participants.map((p) => ['p', p]),
      ['expires', expires.toString()],
    ];

    if (params.threshold !== undefined) {
      tags.push(['threshold', params.threshold.toString()]);
    }
    if (params.quorum !== undefined) {
      tags.push(['quorum', params.quorum.toString()]);
    }
    if (params.action) {
      tags.push(['action', params.action.kind.toString(), params.action.data]);
    }
    if (params.weights) {
      for (const [pubkey, weight] of params.weights) {
        tags.push(['weight', pubkey, weight.toString()]);
      }
    }

    return this.signer.createSignedEvent(5910, tags, params.description);
  }
}
```

---

## Story 20.3: Proposal Parsing & Validation

### Description

Implement parsing and validation of proposal events.

### Acceptance Criteria

1. Parse all required tags
2. Validate coordination type
3. Validate participant pubkeys
4. Validate threshold <= participant count
5. Validate expiration is in future
6. Validate action payload if present
7. Return typed `Proposal` or throw error
8. Check if proposal is still active (not expired)

### Technical Notes

```typescript
class ProposalParser {
  parse(event: NostrEvent): Proposal {
    this.validateKind(event, 5910);

    const id = this.getRequiredTag(event.tags, 'd');
    const type = this.parseCoordinationType(event.tags);
    const participants = this.getPTags(event.tags);
    const expires = this.parseExpires(event.tags);

    this.validateNotExpired(expires);
    this.validateThreshold(event.tags, participants.length);

    return {
      kind: 5910,
      id,
      type,
      participants,
      threshold: this.parseOptionalNumber(event.tags, 'threshold'),
      quorum: this.parseOptionalNumber(event.tags, 'quorum'),
      expires,
      action: this.parseAction(event.tags),
      weights: this.parseWeights(event.tags),
      content: event.content,
      event,
    };
  }
}
```

---

## Story 20.4: Vote Creation (Kind 6910)

### Description

Implement creation of coordination vote events.

### Acceptance Criteria

1. Create Kind 6910 event
2. Include `e` tag referencing proposal with `proposal` marker
3. Include `d` tag matching proposal's d tag
4. Include `vote` tag (approve/reject/abstain)
5. Optional `reason` tag with justification
6. Optional `rank` tag for ranked choice
7. Content contains vote justification
8. Sign with voter's Nostr key
9. Validate voter is participant in proposal

### Technical Notes

```typescript
interface CreateVoteParams {
  proposal: Proposal;
  vote: VoteValue;
  reason?: string;
  rank?: number[]; // For ranked choice
}

class VoteCreator {
  create(params: CreateVoteParams): NostrEvent {
    // Validate voter is participant
    if (!params.proposal.participants.includes(this.pubkey)) {
      throw new NotParticipantError(this.pubkey, params.proposal.id);
    }

    const tags = [
      ['e', params.proposal.event.id, '', 'proposal'],
      ['d', params.proposal.id],
      ['vote', params.vote],
    ];

    if (params.reason) {
      tags.push(['reason', params.reason]);
    }
    if (params.rank) {
      tags.push(['rank', ...params.rank.map((r) => r.toString())]);
    }

    return this.signer.createSignedEvent(6910, tags, params.reason ?? '');
  }
}
```

---

## Story 20.5: Vote Collection & Validation

### Description

Collect and validate votes for a proposal.

### Acceptance Criteria

1. Subscribe to Kind 6910 events for proposal
2. Validate vote signature
3. Validate voter is participant
4. Validate vote value is valid
5. Detect and reject duplicate votes
6. Track vote count by value
7. Emit events on new votes
8. Check quorum requirements

### Technical Notes

```typescript
class VoteCollector {
  private votes: Map<string, Vote> = new Map(); // pubkey -> vote

  async collectVote(event: NostrEvent, proposal: Proposal): Promise<void> {
    const vote = this.voteParser.parse(event);

    // Validate
    if (vote.proposalId !== proposal.id) {
      throw new ProposalMismatchError();
    }
    if (!proposal.participants.includes(vote.voterPubkey)) {
      throw new NotParticipantError(vote.voterPubkey, proposal.id);
    }
    if (this.votes.has(vote.voterPubkey)) {
      throw new DuplicateVoteError(vote.voterPubkey);
    }

    this.votes.set(vote.voterPubkey, vote);
    this.emit('vote', { proposal, vote, count: this.votes.size });
  }

  getTally(): VoteTally {
    let approve = 0,
      reject = 0,
      abstain = 0;
    for (const vote of this.votes.values()) {
      if (vote.vote === 'approve') approve++;
      else if (vote.vote === 'reject') reject++;
      else abstain++;
    }
    return { approve, reject, abstain };
  }
}
```

---

## Story 20.6: Threshold Consensus Implementation

### Description

Implement threshold-based consensus algorithm.

### Acceptance Criteria

1. Support `threshold` type requiring N votes to approve
2. Support `majority` type requiring >50%
3. Support `consensus` type requiring all participants
4. Check if threshold reached after each vote
5. Handle quorum requirements
6. Determine outcome: approved, rejected, inconclusive
7. Emit result when determined

### Technical Notes

```typescript
class ThresholdConsensus {
  evaluate(proposal: Proposal, votes: Map<string, Vote>): CoordinationOutcome | 'pending' {
    const tally = this.tallyVotes(votes);
    const total = proposal.participants.length;
    const voted = votes.size;

    // Check quorum
    if (proposal.quorum && voted < proposal.quorum) {
      if (this.isExpired(proposal)) {
        return 'inconclusive';
      }
      return 'pending';
    }

    switch (proposal.type) {
      case 'consensus':
        if (tally.approve === total) return 'approved';
        if (tally.reject > 0) return 'rejected';
        return 'pending';

      case 'majority':
        const majority = Math.floor(total / 2) + 1;
        if (tally.approve >= majority) return 'approved';
        if (tally.reject >= majority) return 'rejected';
        return voted === total ? 'inconclusive' : 'pending';

      case 'threshold':
        const threshold = proposal.threshold ?? Math.floor(total / 2) + 1;
        if (tally.approve >= threshold) return 'approved';
        const remaining = total - voted;
        if (tally.approve + remaining < threshold) return 'rejected';
        return 'pending';

      default:
        throw new UnsupportedCoordinationTypeError(proposal.type);
    }
  }
}
```

---

## Story 20.7: Weighted Voting Implementation

### Description

Implement weighted voting where votes have different weights.

### Acceptance Criteria

1. Parse `weight` tags from proposal
2. Apply weights to vote counts
3. Support stake-weighted voting (from ILP balances)
4. Weighted threshold calculation
5. Log weighted tallies
6. Graceful handling of missing weights (default to 1)

### Technical Notes

```typescript
class WeightedVoting {
  evaluate(
    proposal: Proposal,
    votes: Map<string, Vote>
  ): { weighted: VoteTally; outcome: CoordinationOutcome | 'pending' } {
    const weights = proposal.weights ?? new Map();
    let approveWeight = 0,
      rejectWeight = 0,
      abstainWeight = 0;
    let totalWeight = 0;

    for (const pubkey of proposal.participants) {
      const weight = weights.get(pubkey) ?? 1;
      totalWeight += weight;

      const vote = votes.get(pubkey);
      if (vote) {
        if (vote.vote === 'approve') approveWeight += weight;
        else if (vote.vote === 'reject') rejectWeight += weight;
        else abstainWeight += weight;
      }
    }

    const threshold = proposal.threshold
      ? (proposal.threshold / proposal.participants.length) * totalWeight
      : totalWeight / 2 + 1;

    let outcome: CoordinationOutcome | 'pending';
    if (approveWeight >= threshold) {
      outcome = 'approved';
    } else if (rejectWeight > totalWeight - threshold) {
      outcome = 'rejected';
    } else if (votes.size === proposal.participants.length) {
      outcome = 'inconclusive';
    } else {
      outcome = 'pending';
    }

    return {
      weighted: { approve: approveWeight, reject: rejectWeight, abstain: abstainWeight },
      outcome,
    };
  }
}
```

---

## Story 20.8: Result Aggregation (Kind 7910)

### Description

Create coordination result events when outcome is determined.

### Acceptance Criteria

1. Create Kind 7910 when threshold reached or proposal expires
2. Include `e` tag referencing proposal with `proposal` marker
3. Include `d` tag matching proposal's d tag
4. Include `outcome` tag
5. Include `votes` tag with counts
6. Include `participants` tag with participation stats
7. Include `e` tags referencing all vote events
8. Content contains result summary
9. Execute action if approved

### Technical Notes

```typescript
class ResultAggregator {
  async createResult(
    proposal: Proposal,
    votes: Map<string, Vote>,
    outcome: CoordinationOutcome
  ): Promise<NostrEvent> {
    const tally = this.tallyVotes(votes);

    const tags = [
      ['e', proposal.event.id, '', 'proposal'],
      ['d', proposal.id],
      ['outcome', outcome],
      ['votes', tally.approve.toString(), tally.reject.toString(), tally.abstain.toString()],
      ['participants', votes.size.toString(), proposal.participants.length.toString()],
    ];

    // Reference all vote events
    for (const vote of votes.values()) {
      tags.push(['e', vote.event.id, '', 'vote']);
    }

    const resultEvent = this.signer.createSignedEvent(
      7910,
      tags,
      `Proposal ${outcome} with ${tally.approve}/${tally.reject}/${tally.abstain} votes.`
    );

    await this.store.saveEvent(resultEvent);

    // Execute action if approved
    if (outcome === 'approved' && proposal.action) {
      await this.executeAction(proposal.action);
    }

    return resultEvent;
  }
}
```

---

## Story 20.9: propose_coordination Skill

### Description

Create AI skill enabling agents to propose coordinated actions.

### Acceptance Criteria

1. Skill registered as `propose_coordination`
2. Parameters: type, participants, threshold, description, action
3. Validates participant capabilities
4. Creates and publishes Kind 5910
5. Returns proposal ID for tracking
6. Handles expiration configuration

### Technical Notes

```typescript
const proposeCoordinationSkill: AgentSkill<typeof schema> = {
  name: 'propose_coordination',
  description: 'Propose a coordinated action requiring multiple agents to agree',
  parameters: z.object({
    type: z.enum(['consensus', 'majority', 'threshold']),
    participants: z.array(z.string()).describe('Pubkeys of participating agents'),
    threshold: z.number().optional().describe('Required votes for threshold type'),
    description: z.string().describe('Description of the proposal'),
    action: z
      .object({
        kind: z.number(),
        data: z.string(),
      })
      .optional()
      .describe('Action to execute if approved'),
    expiresIn: z.number().optional().describe('Seconds until expiration'),
  }),
  execute: async (params, context) => {
    const proposal = await context.coordinator.createProposal({
      type: params.type,
      participants: params.participants,
      threshold: params.threshold,
      description: params.description,
      action: params.action,
      expiresIn: params.expiresIn ?? 3600,
    });

    return {
      proposalId: proposal.id,
      eventId: proposal.event.id,
      participants: params.participants.length,
      expires: proposal.expires,
    };
  },
};
```

---

## Story 20.10: vote_coordination Skill

### Description

Create AI skill enabling agents to vote on proposals.

### Acceptance Criteria

1. Skill registered as `vote_coordination`
2. Parameters: proposalId, vote, reason
3. Fetches proposal details
4. Validates agent is participant
5. Creates and publishes Kind 6910
6. Returns vote confirmation
7. AI can reason about vote decision

### Technical Notes

```typescript
const voteCoordinationSkill: AgentSkill<typeof schema> = {
  name: 'vote_coordination',
  description: 'Cast a vote on a coordination proposal',
  parameters: z.object({
    proposalId: z.string().describe('The d-tag of the proposal'),
    vote: z.enum(['approve', 'reject', 'abstain']),
    reason: z.string().optional().describe('Justification for the vote'),
  }),
  execute: async (params, context) => {
    const proposal = await context.coordinator.getProposal(params.proposalId);
    if (!proposal) {
      throw new ProposalNotFoundError(params.proposalId);
    }

    const voteEvent = await context.coordinator.vote({
      proposal,
      vote: params.vote,
      reason: params.reason,
    });

    return {
      voteId: voteEvent.id,
      proposalId: params.proposalId,
      vote: params.vote,
      recorded: true,
    };
  },
};
```

---

## Story 20.11: Payment Escrow Integration

### Description

Integrate coordination with ILP payment escrow.

### Acceptance Criteria

1. Proposals can require stake from participants
2. Stakes held in escrow until outcome
3. Approved proposals release escrow to recipient
4. Rejected proposals refund stakes
5. Expired proposals refund stakes
6. Stake amounts configurable per proposal

### Technical Notes

```typescript
interface StakedProposal extends Proposal {
  stakeRequired: bigint;
  escrowAddress: string;
  stakes: Map<string, bigint>; // pubkey -> staked amount
}

class EscrowCoordinator {
  async requireStake(proposal: Proposal, amount: bigint): Promise<void> {
    // Create escrow ILP address for this proposal
    const escrowAddress = `${this.config.ilpAddress}.escrow.${proposal.id}`;

    // Track stakes as participants send payment
    // Release on outcome determination
  }

  async releaseEscrow(proposal: StakedProposal, outcome: CoordinationOutcome): Promise<void> {
    if (outcome === 'approved') {
      // Send to action recipient
      await this.sendToRecipient(proposal);
    } else {
      // Refund to participants
      await this.refundParticipants(proposal);
    }
  }
}
```

---

## Story 20.12: Integration Tests

### Description

Comprehensive integration tests for multi-agent coordination.

### Acceptance Criteria

1. Test full proposal-vote-result flow
2. Test threshold consensus with 3+ agents
3. Test majority voting
4. Test consensus (all agree)
5. Test expiration handling
6. Test weighted voting
7. Test duplicate vote rejection
8. Test non-participant rejection
9. Performance benchmarks

---

## Dependencies

- **Epic 13** (Agent Society Protocol) — Nostr events
- **Epic 16** (AI Agent Node) — Skills, AI dispatcher
- **Epic 18** (Capability Discovery) — Participant discovery
- **Epic 19** (Task Delegation) — Action execution

## Risk Mitigation

| Risk                  | Mitigation                                     |
| --------------------- | ---------------------------------------------- |
| Vote manipulation     | Signature verification, participant validation |
| Sybil attacks         | Social graph filtering, stake requirements     |
| Coordination deadlock | Expiration timeouts, quorum flexibility        |
| Network partitions    | Eventual consistency, relay redundancy         |

## Success Metrics

- Coordination proposals complete within configured timeout
- 99% vote delivery success
- Zero invalid vote acceptance
- Outcome determination within 1s of threshold reached
